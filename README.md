# Club Votes

> **Starter template** — this repo was scaffolded by Homeroom Social
> Vibecoding. Everything in it is placeholder example code until the
> app's first real feature is built.

The scaffold is a small working demo that proves the plumbing works:

- **Sign-in** — the server verifies the platform-issued user token
  (an RS256 JWT) on every request, so the app already knows who is
  using it. No accounts to build.
- **Database** — the app has its own private Postgres database, ready
  to store things.
- **Styling** — Tailwind CSS, precompiled by `npm run build` during
  image creation with either Kubernetes/Paketo or standalone Docker, in a
  light and a dark look that follow the viewer's Homeroom theme.

## Replacing the template

To change this app, ask Homeroom bot: open the app on Homeroom, tap the
Homeroom icon in the header, then **Suggest an improvement**, and describe
the app you want in plain English. The template will be replaced with your
real app. You can also run
Claude Code against this repo directly; start with `CLAUDE.md`, which
carries the app-specific notes and points at the platform rules.

Once the real app exists, rewrite this README to describe it.
