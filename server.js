const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const app = express();
const port = process.env.PORT || 3000;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// The platform signs user-identity tokens with an RSA private key it never
// shares. Containers get only the PUBLIC half, so this app can verify who a
// user is but cannot mint an identity — and neither can any other app.
const JWT_PUBLIC_KEY = (process.env.USERNODE_JWT_PUBLIC_KEY || '')
  .replace(/\\n/g, '\n');

// Tokens are minted for one app: the audience is this app's numeric id, so a
// token issued for a different app is rejected below rather than accepted as
// a valid user.
const APP_AUDIENCE = process.env.USERNODE_APP_ID
  ? 'usernode:app:' + process.env.USERNODE_APP_ID
  : null;

// Visitors with no Homeroom account ("guests") may look around this app at
// its own address, read-only (every public app). The platform marks
// them with a token of their own: ES256, signed by a key of its own (its
// public half is USERNODE_GUEST_JWT_PUBLIC_KEY), this audience, `pur:
// 'guest'`, `guest: true`, and no id or username. Such a visitor is
// `req.guest`, never `req.user`, and every write they try is answered 401
// `account_required`, which the bridge turns into "Make an account to
// continue".
const GUEST_AUDIENCE = APP_AUDIENCE ? APP_AUDIENCE + ':guest' : null;
const GUEST_PUBLIC_KEY = (process.env.USERNODE_GUEST_JWT_PUBLIC_KEY || '')
  .replace(/\\n/g, '\n');

// Paths that stay open without authentication. Add a path here (and add it
// with `app.get`/`app.post` below) if you deliberately want it public.
// Everything else requires a valid platform-issued JWT.
const PUBLIC_API_PATHS = new Set(['/health']);

app.use(express.json());

// The platform's three centrally hosted files — the bridge, the native UI
// kit and the Tailwind runtime — are reachable at these paths on this app's
// OWN origin, so index.html can load them with a RELATIVE path and never
// name the platform's hostname. A hostname baked into an app is what breaks
// every app at once when the platform's domain moves.
//
// In production and on a staging preview the platform's edge answers these
// before the request ever reaches this process (a per-app Ingress rule on
// Kubernetes, the wildcard site's matcher on the docker runtime). This
// handler is what makes the same relative paths work under a plain
// `node server.js`, where there is no edge in front of the app at all.
//
// Registered BEFORE the auth middleware because these three files are
// public: the platform serves them anonymously from any app origin, and a
// login redirect arriving where a <script> was expected is exactly the
// failure a relative path is meant to avoid.
// The platform's origin, at RUNTIME, and ONLY from the variable the platform
// injects. No hostname is written into this file: a baked-in one is what left
// the whole fleet pointing at a domain the platform had moved away from.
// Unset only outside the platform (a plain local `node server.js`) — set
// USERNODE_PLATFORM_ORIGIN there too if you want the hosted assets locally.
const PLATFORM_ORIGIN = (process.env.USERNODE_PLATFORM_ORIGIN || '')
  .replace(/\/+$/, '');

app.get(/^\/usernode-(?:bridge|native|tailwind)\//, async (req, res) => {
  try {
    if (!PLATFORM_ORIGIN) return res.sendStatus(503);
    const upstream = await fetch(PLATFORM_ORIGIN + req.path);
    if (!upstream.ok) return res.sendStatus(upstream.status);
    const type = upstream.headers.get('content-type');
    if (type) res.type(type);
    // max-age=0 with revalidation, never a long TTL: the whole point of
    // central hosting is that a platform-side fix lands on the next load.
    res.set('Cache-Control', 'public, max-age=0, must-revalidate');
    return res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    console.warn('hosted asset fetch failed: ' + err.message);
    return res.sendStatus(502);
  }
});

// "Now" for this request, as a Date: `req.now`, set for every request by
// the middleware below. Read the day and the time through it (and
// `usernode.now()` in the page), never `new Date()` or SQL's NOW(),
// wherever they decide what shows: a reminder, a rota, a deadline.
// Production always gets the real time. A staging preview may be shown as of
// a chosen moment: the platform opens it with `?un-now=<ISO time>`, and the
// page sends `usernode.now()` on as the `x-usernode-now` header. Only a
// staging container reads either. See "Time-dependent features" in the
// platform conventions.
const IS_STAGING = process.env.USERNODE_ENV === 'staging';
const PREVIEW_NOW = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
function requestNow(req) {
  const raw = IS_STAGING ? (req.headers['x-usernode-now'] || req.query['un-now']) : null;
  return typeof raw === 'string' && PREVIEW_NOW.test(raw) ? new Date(raw) : new Date();
}

// Verify platform-issued JWT if one was passed, then enforce auth on
// anything not explicitly marked public. The iframe adds `?token=…`
// on load; the frontend script forwards the token via `x-usernode-token`
// on subsequent fetches.
app.use((req, res, next) => {
  req.now = requestNow(req);
  const token = req.query.token || req.headers['x-usernode-token'];
  if (token && JWT_PUBLIC_KEY && APP_AUDIENCE) {
    try {
      // Pin the algorithm, issuer and audience. Without `algorithms` a
      // caller could hand us an HS256 token signed with the public PEM
      // (which every app knows) and forge any user.
      const claims = jwt.verify(token, JWT_PUBLIC_KEY, {
        algorithms: ['RS256'],
        issuer: 'usernode',
        audience: APP_AUDIENCE,
      });
      // `pur` names what the token is for. Only user-identity tokens
      // authenticate a person here.
      if (claims && claims.pur === 'iframe') req.user = claims;
    } catch {}
  }
  if (!req.user && token && GUEST_PUBLIC_KEY && GUEST_AUDIENCE) {
    try {
      const guest = jwt.verify(token, GUEST_PUBLIC_KEY, {
        algorithms: ['ES256'],
        issuer: 'usernode',
        audience: GUEST_AUDIENCE,
      });
      if (guest && guest.pur === 'guest' && guest.guest === true) req.guest = true;
    } catch {}
  }

  // Static assets (CSS/JS/images) are always served; the API and the HTML
  // shell are gated so direct hits to the staging/prod subdomain don't
  // leak app data to the public internet. A guest may READ: every GET,
  // `/api/*` included, so read routes must not assume req.user (use
  // `req.user ? req.user.id : null`). Every write needs an account.
  if (req.method !== 'GET' || req.path.startsWith('/api/')) {
    if (PUBLIC_API_PATHS.has(req.path)) return next();
    if (!req.user && req.guest) {
      if (req.method === 'GET' || req.method === 'HEAD') return next();
      return res.status(401).json({ error: 'account_required' });
    }
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
});

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ── Schema (idempotent, applied on boot) ─────────────────────────────────
// `reports` is the one sensitive table (who reported what): schema-only on
// staging, and no public table holds a foreign key into it.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  question TEXT NOT NULL,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  demo_for TEXT
);
CREATE TABLE IF NOT EXISTS options (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  position INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS votes (
  decision_id TEXT NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  option_id TEXT NOT NULL REFERENCES options(id) ON DELETE CASCADE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (decision_id, user_id)
);
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('decision', 'comment')),
  target_id TEXT NOT NULL,
  reporter_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS reports_once ON reports (reporter_id, kind, target_id);
COMMENT ON TABLE reports IS 'staging:private';
`;

// ── Helpers ───────────────────────────────────────────────────────────────
const isDemo = (req) => IS_STAGING && req.query.demo === '1';
const viewerId = (req) => (req.user ? String(req.user.id) : null);
const uuid = () => crypto.randomUUID();

// The winner is computed from votes at read time, never stored.
function resultOf(options) {
  const total = options.reduce((sum, o) => sum + o.count, 0);
  if (!total) return null;
  const max = Math.max(...options.map((o) => o.count));
  const labels = options.filter((o) => o.count === max).map((o) => o.label);
  return { type: labels.length > 1 ? 'tie' : 'winner', labels, count: max, totalVotes: total };
}

// ── Staging demo (the first version's populated demo, ?demo=1 only) ──────
// Written once per viewing account under fixed per-viewer ids with
// ON CONFLICT DO NOTHING, so a reload changes nothing and what the viewer
// did to the rows stays. Every row carries demo_for, so no plain route and
// no "needs your vote" count without demo=1 ever sees them.
const DEMO_PEOPLE = [
  ['maya', 'Maya'], ['dan', 'Dan'], ['priya', 'Priya'], ['tom', 'Tom'],
  ['sam', 'Sam'], ['alex', 'Alex'], ['ruth', 'Ruth'], ['nina', 'Nina'],
  ['omar', 'Omar'], ['lena', 'Lena'], ['ben', 'Ben'], ['june', 'June'],
];

const DEMO_DECISIONS = [
  {
    question: 'Where should we meet on Thursdays?',
    author: ['maya', 'Maya'],
    createdDaysAgo: 1,
    options: ['Library back room', 'Corner Cafe', "Dan's garage"],
    tally: [6, 3, 1],
    myVote: null,
    comments: [
      ['maya', 0.007, 'Thursday evenings work best for me, the library is right by my bus stop.'],
      ['dan', 0.033, 'The garage is free but has no heating, fair warning.'],
      ['priya', 0.2, 'Library room fits all of us and has the big table.'],
      ['tom', 0.3, 'Can we settle this properly? My vote is the library.'],
      ['sam', 0.367, 'Cafe has coffee, that is my whole argument.'],
      ['alex', 0.433, 'Library closes at 8, the cafe stays open later.'],
      ['ruth', 0.567, 'Parking is easier at the cafe.'],
      ['nina', 0.633, 'The library back room is quiet, we can actually hear each other.'],
      ['omar', 0.7, 'The garage means we can be loud. Games night gets animated.'],
      ['lena', 0.733, 'Library it is for me.'],
      ['ben', 0.8, 'The cafe tables are too small for boards and laptops.'],
      ['maya', 0.9, 'Leaning library, the whiteboard there is useful.'],
      ['you', 0.958, 'Cafe is nice but loud after 7.'],
      ['dan', 0.987, 'Fine, I will bring a heater anyway.'],
    ],
  },
  {
    question: 'What should we do for the spring project?',
    author: 'you',
    createdDaysAgo: 2,
    options: ['Community garden build', 'Trail cleanup day', 'Book swap fair'],
    tally: [4, 4, 2],
    myVote: 0,
    comments: [
      ['maya', 0.05, 'The garden build sounds like a good way to spend a Saturday.'],
      ['tom', 0.1, 'Trail cleanup is the cheapest, gloves and bags.'],
      ['dan', 0.3, 'A book swap fair would need a hall, that is the catch.'],
      ['priya', 0.4, 'The garden boxes at the community centre are already built.'],
      ['sam', 0.6, 'Cleanup day photographs well for the club page.'],
      ['alex', 0.75, 'Book swap could be a winter thing instead.'],
      ['ruth', 0.825, 'Garden build gets my vote, fresh air and all.'],
      ['you', 0.9, 'If the garden wins I can borrow a van for the soil.'],
      ['nina', 0.96, 'Whatever we pick, let us pick one and just go.'],
    ],
  },
  {
    question: 'Which night for the end of term dinner?',
    author: ['priya', 'Priya'],
    createdDaysAgo: 3,
    options: ['Friday 14 June', 'Saturday 15 June', 'Sunday 16 June'],
    tally: [5, 3, 2],
    myVote: 0,
    comments: [
      ['priya', 0.05, 'Friday suits the kitchen staff, they said we could use the back room.'],
      ['tom', 0.1, 'Saturday means no one rushes off for work the next morning.'],
      ['maya', 0.2, 'Friday, the earlier train is cheaper.'],
      ['sam', 0.3, 'Sunday is family night for half of us.'],
      ['dan', 0.4, 'Friday, then.'],
    ],
  },
  {
    question: 'New club T-shirt colour',
    author: ['tom', 'Tom'],
    createdDaysAgo: 8, closedDaysAgo: 5,
    options: ['Forest green', 'Maroon', 'Navy'],
    tally: [8, 3, 1], myVote: null,
    comments: [['maya', 4.5, 'The green looks good with the badge.']],
  },
  {
    question: 'Quiz night or film night for the spring social?',
    author: ['sam', 'Sam'],
    createdDaysAgo: 9, closedDaysAgo: 6,
    options: ['Quiz night', 'Film night'],
    tally: [7, 2], myVote: null,
    comments: [['ben', 7, 'Quiz night, teams of four.']],
  },
  {
    question: 'Where should the summer trip go?',
    author: ['priya', 'Priya'],
    createdDaysAgo: 11, closedDaysAgo: 8,
    options: ['Coast path walk', 'City museum', 'Farm visit'],
    tally: [6, 4, 2], myVote: null,
    comments: [['ruth', 10, 'The coast path is a good one, I walked it last year.']],
  },
  {
    question: 'How often should we meet over the summer?',
    author: ['maya', 'Maya'],
    createdDaysAgo: 12, closedDaysAgo: 9,
    options: ['Every week', 'Every other week', 'Pause until autumn'],
    tally: [8, 3, 1], myVote: null,
    comments: [],
  },
  {
    question: 'A name for the club newsletter',
    author: ['alex', 'Alex'],
    createdDaysAgo: 14, closedDaysAgo: 11,
    options: ['The Noticeboard', 'Club Columns', 'The Minutes'],
    tally: [6, 4, 2], myVote: null,
    comments: [['june', 13, 'The Noticeboard reads like us.']],
  },
  {
    question: 'Bake sale or sponsored walk for the fundraiser?',
    author: ['dan', 'Dan'],
    createdDaysAgo: 15, closedDaysAgo: 12,
    options: ['Bake sale', 'Sponsored walk'],
    tally: [8, 4], myVote: null,
    comments: [['lena', 14, 'Bake sale, I will make the flapjacks.']],
  },
  {
    question: 'Who keeps the club keys this term?',
    author: ['tom', 'Tom'],
    createdDaysAgo: 16, closedDaysAgo: 13,
    options: ['The committee room', "Dan's place"],
    tally: [5, 4], myVote: null,
    comments: [['omar', 14.5, 'Committee room, the box there fits them all.']],
  },
];

const demoSeedInFlight = new Map();

async function seedDemo(req) {
  const viewer = viewerId(req);
  if (!viewer) return false;
  const key = crypto.createHash('sha256').update(viewer).digest('hex').slice(0, 16);
  if (demoSeedInFlight.has(key)) return demoSeedInFlight.get(key);
  const run = (async () => {
    const existing = await pool.query(
      'SELECT 1 FROM decisions WHERE demo_for = $1 LIMIT 1', [viewer]
    );
    if (existing.rows.length) return true;
    const now = Date.now();
    const ago = (days) => new Date(now - days * 864e5).toISOString();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const [i, d] of DEMO_DECISIONS.entries()) {
        const did = `demo-${key}-d${i + 1}`;
        const author = d.author === 'you'
          ? [viewer, req.user.username || 'You']
          : [`demo-${d.author[0]}`, d.author[1]];
        await client.query(
          `INSERT INTO decisions (id, author_id, author_name, question, closed_at, created_at, demo_for)
           VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
          [did, author[0], author[1], d.question,
            d.closedDaysAgo ? ago(d.closedDaysAgo) : null, ago(d.createdDaysAgo), viewer]
        );
        const optIds = [];
        for (const [pos, label] of d.options.entries()) {
          const oid = `${did}-o${pos + 1}`;
          optIds.push(oid);
          await client.query(
            `INSERT INTO options (id, decision_id, label, position) VALUES ($1, $2, $3, $4)
             ON CONFLICT (id) DO NOTHING`,
            [oid, did, label, pos]
          );
        }
        // Fake voters fill the tally; the viewer takes one slot when the
        // decision is theirs to have voted on.
        let slot = 0;
        for (const [oi, count] of d.tally.entries()) {
          for (let k = 0; k < count; k++) {
            let uid;
            if (d.myVote === oi && k === 0) uid = viewer;
            else uid = `demo-${DEMO_PEOPLE[slot++ % DEMO_PEOPLE.length][0]}`;
            await client.query(
              `INSERT INTO votes (decision_id, user_id, option_id, updated_at) VALUES ($1, $2, $3, $4)
               ON CONFLICT (decision_id, user_id) DO NOTHING`,
              [did, uid, optIds[oi], ago(d.createdDaysAgo - 0.2)]
            );
          }
        }
        for (const [ci, c] of (d.comments || []).entries()) {
          const cAuthor = c[0] === 'you' ? [viewer, req.user.username || 'You'] : [`demo-${c[0]}`, DEMO_PEOPLE.find(p => p[0] === c[0])[1]];
          // c[1] is days after the decision was posted.
          await client.query(
            `INSERT INTO comments (id, decision_id, author_id, author_name, body, created_at)
             VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
            [`${did}-c${ci + 1}`, did, cAuthor[0], cAuthor[1], c[2], ago(d.createdDaysAgo - c[1])]
          );
        }
      }
      await client.query('COMMIT');
      return true;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  })();
  demoSeedInFlight.set(key, run);
  try {
    return await run;
  } finally {
    demoSeedInFlight.delete(key);
  }
}

// ── Routes ────────────────────────────────────────────────────────────────

// List decisions: options with counts, the viewer's vote, comment counts,
// and the open / needs-my-vote totals for the header line.
app.get('/api/decisions', async (req, res) => {
  try {
    const demo = isDemo(req);
    const demoFor = demo ? viewerId(req) : null;
    let demoActive = false;
    if (demo) demoActive = await seedDemo(req);
    const viewer = viewerId(req);
    const status = req.query.status === 'closed' ? 'closed' : req.query.status === 'open' ? 'open' : 'all';
    const clauses = ['d.demo_for IS NOT DISTINCT FROM $1'];
    if (status === 'open') clauses.push('d.closed_at IS NULL');
    if (status === 'closed') clauses.push('d.closed_at IS NOT NULL');
    const rows = await pool.query(
      `SELECT d.* FROM decisions d WHERE ${clauses.join(' AND ')}
       ORDER BY d.created_at DESC, d.id DESC`,
      [demoFor]
    );
    const ids = rows.rows.map((r) => r.id);
    const optRows = await pool.query(
      `SELECT o.id, o.decision_id, o.label, o.position, COUNT(v.user_id)::int AS count
       FROM options o LEFT JOIN votes v ON v.option_id = o.id
       WHERE o.decision_id = ANY($1)
       GROUP BY o.id, o.decision_id, o.label, o.position
       ORDER BY o.decision_id, o.position`,
      [ids]
    );
    const commentRows = ids.length ? await pool.query(
      `SELECT decision_id, COUNT(*)::int AS count FROM comments
       WHERE decision_id = ANY($1) GROUP BY decision_id`,
      [ids]
    ) : { rows: [] };
    const voteRows = viewer && ids.length ? await pool.query(
      `SELECT decision_id, option_id FROM votes
       WHERE user_id = $1 AND decision_id = ANY($2)`,
      [viewer, ids]
    ) : { rows: [] };
    const byComment = new Map(commentRows.rows.map((r) => [r.decision_id, r.count]));
    const byMyVote = new Map(voteRows.rows.map((r) => [r.decision_id, r.option_id]));
    const byDecision = new Map();
    for (const o of optRows.rows) {
      if (!byDecision.has(o.decision_id)) byDecision.set(o.decision_id, []);
      byDecision.get(o.decision_id).push({ id: o.id, label: o.label, count: o.count });
    }
    const decisions = rows.rows.map((r) => {
      const opts = byDecision.get(r.id) || [];
      const max = Math.max(...opts.map((o) => o.count), 0);
      const total = opts.reduce((s, o) => s + o.count, 0);
      return {
        id: r.id,
        question: r.question,
        authorId: r.author_id,
        authorName: r.author_name,
        mine: !!viewer && r.author_id === viewer,
        createdAt: r.created_at,
        closedAt: r.closed_at,
        options: opts.map((o) => ({ ...o, lead: total > 0 && o.count === max })),
        totalVotes: total,
        commentCount: byComment.get(r.id) || 0,
        myOptionId: byMyVote.get(r.id) || null,
        result: r.closed_at
          ? resultOf(opts.map((o) => ({ label: o.label, count: o.count })))
          : null,
      };
    });
    const openRows = await pool.query(
      `SELECT COUNT(*)::int AS open,
              COUNT(*) FILTER (WHERE NOT EXISTS (
                SELECT 1 FROM votes v WHERE v.decision_id = d.id AND v.user_id = $2
              ))::int AS needs
       FROM decisions d WHERE d.closed_at IS NULL AND d.demo_for IS NOT DISTINCT FROM $1`,
      [demoFor, viewer || '']
    );
    res.json({
      demo: demoActive,
      openCount: openRows.rows[0].open,
      needsMyVote: openRows.rows[0].needs,
      decisions,
    });
  } catch (err) {
    console.error('GET /api/decisions failed: ' + err.message);
    res.status(500).json({ error: 'The decisions could not be loaded.' });
  }
});

// One decision with its comments, oldest first.
app.get('/api/decisions/:id', async (req, res) => {
  try {
    const demo = isDemo(req);
    if (demo) await seedDemo(req);
    const viewer = viewerId(req);
    const demoFor = demo ? viewer : null;
    const row = await pool.query(
      'SELECT * FROM decisions WHERE id = $1 AND demo_for IS NOT DISTINCT FROM $2',
      [req.params.id, demoFor]
    );
    if (!row.rows.length) return res.status(404).json({ error: 'Decision not found.' });
    const d = row.rows[0];
    const opts = await pool.query(
      `SELECT o.id, o.label, COUNT(v.user_id)::int AS count
       FROM options o LEFT JOIN votes v ON v.option_id = o.id
       WHERE o.decision_id = $1 GROUP BY o.id, o.label, o.position
       ORDER BY o.position`,
      [d.id]
    );
    const myVote = viewer ? await pool.query(
      'SELECT option_id FROM votes WHERE decision_id = $1 AND user_id = $2',
      [d.id, viewer]
    ) : { rows: [] };
    const comments = await pool.query(
      `SELECT id, author_id, author_name, body, created_at FROM comments
       WHERE decision_id = $1 ORDER BY created_at, id`,
      [d.id]
    );
    const shaped = opts.rows.map((o) => ({ id: o.id, label: o.label, count: o.count }));
    res.json({
      id: d.id,
      question: d.question,
      authorId: d.author_id,
      authorName: d.author_name,
      mine: !!viewer && d.author_id === viewer,
      createdAt: d.created_at,
      closedAt: d.closed_at,
      demoRow: !!d.demo_for,
      options: shaped,
      totalVotes: shaped.reduce((s, o) => s + o.count, 0),
      myOptionId: myVote.rows.length ? myVote.rows[0].option_id : null,
      result: d.closed_at ? resultOf(shaped) : null,
      comments: comments.rows.map((c) => ({
        id: c.id,
        authorId: c.author_id,
        authorName: c.author_name,
        body: c.body,
        createdAt: c.created_at,
        mine: !!viewer && c.author_id === viewer,
      })),
    });
  } catch (err) {
    console.error('GET /api/decisions/:id failed: ' + err.message);
    res.status(500).json({ error: 'The decision could not be loaded.' });
  }
});

// Post a decision: a question and at least two distinct non-empty options.
app.post('/api/decisions', async (req, res) => {
  try {
    const body = req.body || {};
    const question = String(body.question || '').trim();
    const rawOptions = Array.isArray(body.options) ? body.options : [];
    const options = [...new Set(rawOptions.map((o) => String(o || '').trim()).filter(Boolean))];
    if (!question || options.length < 2) {
      return res.status(400).json({
        error: 'A decision needs a question and at least two options.',
      });
    }
    if (options.length > 8) {
      return res.status(400).json({ error: 'Eight options at most.' });
    }
    const id = uuid();
    await pool.query(
      `INSERT INTO decisions (id, author_id, author_name, question, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, req.user.id, req.user.username || 'You', question, req.now]
    );
    for (const [pos, label] of options.entries()) {
      await pool.query(
        'INSERT INTO options (id, decision_id, label, position) VALUES ($1, $2, $3, $4)',
        [uuid(), id, label, pos]
      );
    }
    res.status(201).json({ id });
  } catch (err) {
    console.error('POST /api/decisions failed: ' + err.message);
    res.status(500).json({ error: 'The decision could not be posted.' });
  }
});

// Delete a decision (its votes and comments go with it, by cascade).
app.delete('/api/decisions/:id', async (req, res) => {
  try {
    const rows = await pool.query(
      'DELETE FROM decisions WHERE id = $1 AND author_id = $2 RETURNING id',
      [req.params.id, String(req.user.id)]
    );
    if (!rows.rows.length) return res.status(403).json({ error: 'Only the person who posted it can delete it.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/decisions/:id failed: ' + err.message);
    res.status(500).json({ error: 'The decision could not be deleted.' });
  }
});

// Vote: one choice per decision, changeable until it closes.
app.post('/api/decisions/:id/vote', async (req, res) => {
  try {
    const optionId = String((req.body || {}).optionId || '');
    const d = await pool.query('SELECT closed_at FROM decisions WHERE id = $1', [req.params.id]);
    if (!d.rows.length) return res.status(404).json({ error: 'Decision not found.' });
    if (d.rows[0].closed_at) return res.status(409).json({ error: 'This vote is closed.' });
    const opt = await pool.query(
      'SELECT id FROM options WHERE id = $1 AND decision_id = $2',
      [optionId, req.params.id]
    );
    if (!opt.rows.length) return res.status(400).json({ error: 'Pick one of the options.' });
    await pool.query(
      `INSERT INTO votes (decision_id, user_id, option_id, updated_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (decision_id, user_id)
       DO UPDATE SET option_id = EXCLUDED.option_id, updated_at = EXCLUDED.updated_at`,
      [req.params.id, req.user.id, optionId, req.now]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/decisions/:id/vote failed: ' + err.message);
    res.status(500).json({ error: 'The vote could not be recorded.' });
  }
});

// Close a vote: poster only, once. The winner is computed at read time.
app.post('/api/decisions/:id/close', async (req, res) => {
  try {
    const d = await pool.query('SELECT author_id, closed_at FROM decisions WHERE id = $1', [req.params.id]);
    if (!d.rows.length) return res.status(404).json({ error: 'Decision not found.' });
    if (d.rows[0].author_id !== String(req.user.id)) {
      return res.status(403).json({ error: 'Only the person who posted it can close it.' });
    }
    if (d.rows[0].closed_at) return res.status(409).json({ error: 'This vote is already closed.' });
    await pool.query(
      'UPDATE decisions SET closed_at = $2 WHERE id = $1',
      [req.params.id, req.now]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/decisions/:id/close failed: ' + err.message);
    res.status(500).json({ error: 'The vote could not be closed.' });
  }
});

// Comments, oldest first on read.
app.post('/api/decisions/:id/comments', async (req, res) => {
  try {
    const body = String((req.body || {}).body || '').trim();
    if (!body) return res.status(400).json({ error: 'Write a comment first.' });
    const d = await pool.query('SELECT id FROM decisions WHERE id = $1', [req.params.id]);
    if (!d.rows.length) return res.status(404).json({ error: 'Decision not found.' });
    const id = uuid();
    await pool.query(
      `INSERT INTO comments (id, decision_id, author_id, author_name, body, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, req.params.id, req.user.id, req.user.username || 'You', body, req.now]
    );
    res.status(201).json({ id });
  } catch (err) {
    console.error('POST /api/decisions/:id/comments failed: ' + err.message);
    res.status(500).json({ error: 'The comment could not be posted.' });
  }
});

app.delete('/api/comments/:id', async (req, res) => {
  try {
    const rows = await pool.query(
      'DELETE FROM comments WHERE id = $1 AND author_id = $2 RETURNING id',
      [req.params.id, String(req.user.id)]
    );
    if (!rows.rows.length) return res.status(403).json({ error: 'Only your own comments can be deleted.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/comments/:id failed: ' + err.message);
    res.status(500).json({ error: 'The comment could not be deleted.' });
  }
});

// Reports are recorded for the project's admins; nothing is hidden automatically.
app.post('/api/reports', async (req, res) => {
  try {
    const kind = String((req.body || {}).kind || '');
    const targetId = String((req.body || {}).targetId || '');
    if (kind !== 'decision' && kind !== 'comment') {
      return res.status(400).json({ error: 'Unknown kind of report.' });
    }
    const target = await pool.query(
      kind === 'decision'
        ? 'SELECT 1 FROM decisions WHERE id = $1'
        : 'SELECT 1 FROM comments WHERE id = $1',
      [targetId]
    );
    if (!target.rows.length) return res.status(404).json({ error: 'Not found.' });
    await pool.query(
      `INSERT INTO reports (id, kind, target_id, reporter_id, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (reporter_id, kind, target_id) DO NOTHING`,
      [uuid(), kind, targetId, req.user.id, req.now]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/reports failed: ' + err.message);
    res.status(500).json({ error: 'The report could not be recorded.' });
  }
});

// The template ships no favicon file; index.html carries an inline SVG
// icon instead. Answer 204 here so anything that still probes
// /favicon.ico (older browsers, direct visits) doesn't fall through to
// the auth-gated catch-all and surface a 401 in the console on every
// fresh load.
app.get('/favicon.ico', (_req, res) => res.status(204).end());

app.use(express.static(path.join(__dirname, 'public')));

// HTML shell: serve the app if authenticated. Unauthenticated top-level
// visits (share links pasted into a browser — Sec-Fetch-Dest: document)
// are sent to the platform's chromeless view of this app, where the shell
// embeds it with a real token so the link just works. Every other
// tokenless case (iframe loads with an expired token, old browsers
// without Sec-Fetch-*) gets the "open in Homeroom" landing page instead
// of a redirect, so the platform shell is never loaded INSIDE its own
// app iframe and stray visits still don't reveal the app.
app.get('*', (req, res) => {
  if (!req.user && !req.guest) {
    // Deep-link pass-through (platform #743): carry the visited
    // path+query into the chromeless view so share links land on the
    // shared screen, not Home. The clean platform route stores `path`
    // as one encoded query value so an inner ?, &, or = survives. The
    // shell decodes and validates it as relative-only before use. The
    // character test keeps the
    // value attribute-safe for the landing anchor below — anything
    // unusual falls back to the bare link.
    const deepPath = /^\/[A-Za-z0-9\-._~!$&()*+,;=:@\/%?]*$/.test(req.originalUrl)
      ? '?path=' + encodeURIComponent(req.originalUrl) : '';
    if (PLATFORM_ORIGIN && req.get('sec-fetch-dest') === 'document') {
      return res.redirect(302, PLATFORM_ORIGIN + '/app/club-votes-268418/full' + deepPath);
    }
    return res.status(401).send(`<!doctype html><meta charset=utf-8><title>Open in Homeroom</title>
<body style="font-family:system-ui;background:#09090b;color:#e4e4e7;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
  <div style="max-width:24rem;padding:2rem;text-align:center">
    <h1 style="font-size:1.25rem;margin:0 0 0.5rem">Open this app inside Homeroom</h1>
    <p style="color:#a1a1aa;font-size:0.9rem;margin:0 0 1.25rem">This page is served via the platform; direct visits aren't authenticated.</p>
    <a href="${PLATFORM_ORIGIN}/app/club-votes-268418/full${deepPath}" style="display:inline-block;padding:0.5rem 1rem;background:#7c3aed;color:white;border-radius:0.5rem;text-decoration:none;font-size:0.9rem">Open in Homeroom</a>
  </div>
</body>`);
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function start() {
  await pool.query(SCHEMA);
  const server = app.listen(port, () => console.log(`Listening on :${port}`));
  // Let Envoy retire idle upstream connections at 60s, with a 15s margin.
  server.keepAliveTimeout = 75_000;
  // Stop accepting connections, drain briefly, close the pool, exit.
  const shutdown = (signal) => {
    console.log(`${signal} received, shutting down`);
    server.close(() => pool.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch(err => { console.error(err); process.exit(1); });
