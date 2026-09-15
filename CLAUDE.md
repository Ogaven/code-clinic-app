# Code Clinic — instructions for AI coding agents (Claude Code, Codex, etc.)

Full architecture and rationale: [DEPLOYMENT.md](DEPLOYMENT.md). Read it
before touching anything under `scripts/deploy/`, `deploy*.sh`,
`ecosystem.config.js`, or `.github/workflows/deploy.yml`.

## Deploying — hard rules

- **Use `bash deploy.sh --yes`** for routine deploys. It classifies what
  changed and deploys only that. Don't hand-roll `ssh`/`rsync`/`scp` commands
  against the production server (`root@46.101.255.243`) instead of these
  scripts — that bypassed-the-safety-rails pattern is exactly what caused
  the 2026-09-15 incident (raw unstyled HTML in production because a manual
  build was interrupted before the static-asset copy step).
- **Backend-only task** (only `apps/api/**` or `packages/database/**`
  changed): never build web, never touch `.next`, never restart
  `codeclinic-web`. `deploy-api.sh` already guarantees this — use it, don't
  improvise.
- **Frontend-only task** (only `apps/web/**` changed): never restart or
  redeploy the API unless the change genuinely requires a backend
  dependency bump. `deploy-web.sh` already guarantees this.
- **Never run `pm2 restart all`.** Restart the specific process
  (`codeclinic-api` or `codeclinic-web`) that actually changed.
- **Never overwrite `.next` (or `apps/web/current`, or `apps/api/dist`)
  incrementally.** These are managed symlinks pointing at immutable,
  numbered release directories under `apps/web/releases/` /
  `apps/api/releases/`. Build a new release, validate it, then let the
  release script flip the symlink. Don't `cp` files into the live path by
  hand.
- **Never declare a web deploy healthy from HTTP 200 on the HTML alone.**
  Verify the actual referenced `/_next/static/*.css` and `*.js` chunks
  resolve, plus `/manifest.json` and `/sw.js`, plus that the running
  server's `BUILD_ID` matches its own served static assets. Use
  `scripts/deploy/smoke-test-web.sh` — the deploy scripts already run it;
  don't skip it if you're deploying by hand for some reason.
- **Never deploy uncommitted or unpushed work.** The server always builds
  from `git fetch` + `git checkout <sha>` against `origin`. If your change
  isn't pushed, there's nothing to deploy — commit and push first.
- **Schema/migration changes** (`packages/database/prisma/**`): `deploy.sh`
  will flag `SCHEMA_CHANGED=true` and refuse to silently apply anything.
  Never run `prisma db push` or `prisma migrate deploy` against production
  without an explicit, separate, human-confirmed step and a fresh database
  backup. The deploy scripts only regenerate the Prisma *client*.

## Production safety — hard rules

Never, as a side effect of any task:
- modify production patient records or create fake/test patients
- send a real WhatsApp message, SMS, or place a call from the production
  number/agent
- modify invoices, create appointments, or alter treatment plans
- run a destructive DB operation, or `prisma db push`, against production

## If you find production broken

1. Investigate first — check PM2 status, the deployed git SHA
   (`cd /var/www/codeclinic && git log -1`), `apps/web/current` and
   `apps/api/dist` symlink targets, and run
   `bash scripts/deploy/smoke-test-web.sh 3000 apps/web/current` — before
   changing anything.
2. Prefer `deploy.sh`/`deploy-web.sh`/`deploy-api.sh` to restore a known-good
   release over ad hoc manual fixes.
3. See "Manual recovery" in [DEPLOYMENT.md](DEPLOYMENT.md) if the automatic
   rollback path itself is unavailable.
