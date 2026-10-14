# Club Votes

Your club's shared space for deciding things together. Anyone in the club
posts a question with its options, everyone picks one, people talk it
through in comments, and the person who posted closes the vote when they
are ready.

- **Post a decision** — the round plus button opens a short form: the
  question, then two or more options.
- **Vote** — one choice per decision, shown as live counts with a tally
  bar per option. You can change your vote while it is open.
- **Discuss** — a comment thread under each decision, oldest first.
- **Close a vote** — the poster closes it when ready; the option with the
  most votes becomes the winner, a tie is shown as a tie. Closed decisions
  move to the Decided tab.

Voting, posting and commenting need a Homeroom account; visitors without
one can read everything. Who voted for what is never shown, only counts.

## Design

- **Palette:** warm neutrals (cream ground, white surfaces, warm grey
  text and lines) with one action colour, brick red, used for the primary
  action, the leading tally bar and focus. An "ok" green marks Decided.
  Tokens live in `styles/tailwind-input.css`, a light and a dark value
  each, both looks following the viewer's Homeroom theme.
- **Signature element:** each option's tally bar, like a ballot box
  filling up. The leading option's bar is brick red; the others are
  muted grey. It appears on the cards and on the opened decision.
- **Type:** the rounded system face (`ui-rounded` fallback `system-ui`)
  throughout, on the kit's four sizes (`text-title`, `text-heading`,
  `text-body`, `text-small`).
- Icons are thin line drawings: a speech bubble for comments, a plus to
  post, a back arrow.

## Running locally

`node server.js` against a Postgres `DATABASE_URL`. `npm run build`
compiles the Tailwind stylesheet. On staging, open `?demo=1` for the
populated demo.