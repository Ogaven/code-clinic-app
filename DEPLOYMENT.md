# Code Clinic — Deployment Architecture

Read this before deploying, and before changing any file under `scripts/deploy/`,
`deploy-api.sh`, `deploy-web.sh`, `deploy.sh`, `ecosystem.config.js`, or
`.github/workflows/deploy.yml`.

## Why this exists

On 2026-09-15, production served raw unstyled HTML: HTTP 200 on `/login`,
but every `/_next/static/*.css` and `*.js` chunk the page referenced 404'd.
Root cause: a manual `pnpm --filter web build` had completed, but the
required copy step (Next.js standalone output does not include
`.next/static/` or `public/` — those must be copied in separately) never
ran, apparently because a prior deploy attempt was interrupted between the
build and the copy. Because the build had directly overwritten the live
`.next/standalone` directory in place, there was no way to tell — and no
previous good version to fall back to — until someone inspected the
filesystem by hand.

Everything below exists to make that specific failure mode, and the general
class it belongs to (partial deploys, wrong-runtime restarts, drift between
git and what's actually running), structurally impossible rather than just
"unlikely if everyone remembers the steps."

## Architecture

```
/var/www/codeclinic/                       git checkout — source of truth, API runtime cwd
├── apps/api/
│   ├── dist -> releases/<sha>-<ts>/dist   symlink, swapped atomically
│   ├── previous_dist -> releases/...      symlink to last-known-good, for rollback
│   └── releases/<sha>-<ts>/dist/          each release = one complete compiled API
├── apps/web/
│   ├── current -> releases/<sha>-<ts>     symlink, swapped atomically — PM2 points here
│   ├── previous -> releases/...           symlink to last-known-good, for rollback
│   └── releases/<sha>-<ts>/               each release = COMPLETE standalone build:
│       apps/web/server.js                   server.js + .next (incl. static) + public + node_modules
│       apps/web/.next/{server,static}/
│       apps/web/public/
├── .deploy-state.json                     {api_sha, web_sha, web_build_id, updated_at}
└── .deploy.lock/                          mkdir-based lock, held for the duration of one deploy
```

PM2's process definitions (`ecosystem.config.js`) point at fixed paths —
`apps/api/dist/main.js` and `apps/web/current/apps/web/server.js` — that
happen to be symlinks. Deploys never touch those paths directly; they build
a brand new numbered release, validate it completely, and only then flip the
symlink. A process that's already running keeps using the real directory it
started with even after the symlink moves on — Node resolves `__dirname` to
the real path at load time — so a deploy in progress can never corrupt a
request in flight.

## The three commands

```
bash deploy.sh              # dry run: shows what changed and what it would do
bash deploy.sh --yes        # classifies, then deploys only what changed
bash deploy-api.sh          # force an API-only deploy (build locally, upload, atomic swap, health check, auto-rollback)
bash deploy-web.sh          # force a web-only deploy (build on server, atomic swap, smoke test, auto-rollback)
```

`deploy.sh` is the normal entrypoint. `deploy-api.sh` / `deploy-web.sh` are
for when you already know exactly what needs deploying (e.g. a targeted
hotfix) — they're the same scripts `deploy.sh` calls internally.

All three refuse to deploy uncommitted or unpushed work. The server always
builds from `git fetch` + `git checkout <sha>` against `origin`, never from
rsync/scp/tar of a local working tree. If your change isn't pushed, there is
nothing for these scripts to deploy.

## Change detection (`scripts/deploy/classify.sh`)

Reads `.deploy-state.json` off the server (the SHA each runtime was last
successfully deployed at) and diffs it against `origin/main` HEAD, scoped by
path:

| Paths changed                                  | Counts as       |
|-------------------------------------------------|-----------------|
| `apps/api/**`, `packages/database/**`           | API changed     |
| `apps/web/**`                                    | Web changed     |

Classification: `API_ONLY`, `WEB_ONLY`, `API_AND_WEB`, or
`NO_RUNTIME_CHANGE`. If the state file is missing, corrupt, or its recorded
SHA isn't in local git history (e.g. after a force-push), classification
**fails closed** — it errors out rather than guessing, and nothing deploys.

## Deployment matrix

| Change classification | API deploy | Web deploy | API restart | Web restart |
|------------------------|:---:|:---:|:---:|:---:|
| `API_ONLY`             | YES | NO  | YES | NO  |
| `WEB_ONLY`              | NO  | YES | NO  | YES |
| `API_AND_WEB`           | YES | YES | YES | YES |
| `NO_RUNTIME_CHANGE`     | NO  | NO  | NO  | NO  |

A backend-only change is structurally incapable of touching `.next`,
`apps/web/`, or `codeclinic-web` — `deploy-api.sh` never builds web, never
copies web files, never restarts `codeclinic-web`. The reverse holds for
`deploy-web.sh` and `codeclinic-api`. Nothing in this repo ever runs
`pm2 restart all` for a routine deploy.

## Atomic web releases

1. `pnpm --filter web build` runs into the scratch `apps/web/.next` directory
   (not the live release — a failed or partial build here cannot affect
   production, because nothing serving traffic reads from it).
2. The complete `standalone` output, plus `.next/static/` and `public/`
   copied in, is assembled into a brand new `apps/web/releases/<sha>-<ts>/`.
3. **Build-before-switch validation**: the release must contain
   `apps/web/server.js`, `.next/BUILD_ID`, `.next/server/`, `.next/static/`,
   and `public/` before anything downstream of this step runs.
4. **Pre-flight smoke test**: the candidate release is started on a scratch
   port (3001) and smoke-tested (below) *before production is touched at
   all*. If this fails, the release is deleted and the deploy fails —
   production was never in the loop.
5. Only then: `apps/web/previous` is set to whatever `current` currently
   points at, `apps/web/current` is atomically repointed
   (`ln -sfn`) at the new release, and `pm2 restart codeclinic-web` runs.
6. **Post-restart smoke test** against the real port 3000. If it fails,
   `current` is flipped back to `previous`, `codeclinic-web` is restarted
   again, and *that* is smoke-tested too, before the deploy is marked
   `FAILED_ROLLED_BACK`. Users are never left on a broken candidate.
7. On success, older releases beyond the last 3 are pruned (the release
   `current` or `previous` still point at is never pruned).

## Static-asset smoke test (`scripts/deploy/smoke-test-web.sh`)

This is the check that would have caught the incident — HTTP 200 on the
HTML is explicitly *not* treated as success. Given a port and a release
directory, it:

1. Fetches `/login`, requires `200`.
2. Extracts every `/_next/static/*.css` and `*.js` the HTML actually
   references and fetches each one, requiring `200`. Requires at least one
   CSS asset to exist at all (zero CSS referenced = the raw-HTML failure
   mode, fails immediately).
3. Fetches `/manifest.json` and `/sw.js`, requires `200` each.
4. **Build ID consistency**: reads `.next/BUILD_ID` from the release
   directory and fetches `/_next/static/<BUILD_ID>/_buildManifest.js` from
   the running server. If that 404s, the running server code and its static
   assets came from different builds — fails immediately. This is the
   general form of "server = new build, static = old build" or vice versa.

Any failure aborts the deploy (pre-flight) or triggers rollback (post-switch).

## Atomic API releases

Same shape, smaller footprint: `apps/api/dist` is a symlink into
`apps/api/releases/<sha>-<ts>/dist/`. `deploy-api.sh` builds TypeScript
**locally** (the 2GB production droplet OOMs running `tsc` — this is
already a known constraint, don't build API on the server), uploads the
compiled `dist/` into a brand-new release directory, regenerates the
Prisma client against the current `schema.prisma`, atomically swaps the
symlink, restarts `codeclinic-api`, and polls `GET /health` (expects
`{"status":"ok","checks":{"database":"ok"}}`) before declaring success. A
failed health check rolls the symlink back to `previous_dist` and restarts
again.

## Deployment lock

`scripts/deploy/lib.sh`'s `acquire_lock` does an atomic `mkdir
/var/www/codeclinic/.deploy.lock`. If it already exists, the lock's `pid`
file is checked — a dead PID means a crashed previous deploy, and the lock
is reclaimed automatically; a live PID means a deploy is genuinely in
progress, and the new one aborts immediately rather than racing it. This
protects `apps/api` and `apps/web` deploys equally, since both mutate the
same shared git checkout at `/var/www/codeclinic` during their
`git fetch`/`git checkout` step.

## Schema / migrations

Automatic `prisma db push` at API startup was already removed (a prior
fix — see git history). Deploys here go further: they regenerate the
Prisma **client** to match `schema.prisma` (needed so the compiled API
doesn't throw "Unknown argument" on new fields) but never run
`prisma migrate deploy` or `db push` themselves. `classify.sh` flags
`SCHEMA_CHANGED=true` whenever `packages/database/prisma/**` changed, and
`deploy.sh` prints a loud warning requiring the migration to be applied
manually, after a database backup, before the API deploy proceeds. This is
intentional — schema changes are exactly the "no destructive DB action"
category this hardening does not attempt to automate.

## Rollback

Both `remote-release-web.sh` and `remote-release-api.sh` keep exactly one
previous release addressable via a `previous` / `previous_dist` symlink,
updated right before every cutover. Automatic rollback triggers only on a
failed **post-restart** health/smoke check (a failed **pre-flight** check
never touches production in the first place, so there's nothing to roll
back). If the rollback target *also* fails its check — which would mean two
consecutive releases are both broken, or something is wrong with the host
itself — the script stops there and prints `FAILED_ROLLBACK_ALSO_FAILED`
rather than looping. That state needs a human.

## Manual recovery

If a deploy leaves things broken and the automatic rollback also failed:

```bash
ssh root@46.101.255.243
cd /var/www/codeclinic

# Web: point back at whatever the previous release actually is
ls -la apps/web/releases/                      # find a known-good release dir
ln -sfn apps/web/releases/<good-sha>-<ts> apps/web/current
pm2 restart codeclinic-web
bash scripts/deploy/smoke-test-web.sh 3000 apps/web/releases/<good-sha>-<ts>

# API: same idea
ln -sfn apps/api/releases/<good-sha>-<ts>/dist apps/api/dist
pm2 restart codeclinic-api
curl localhost:4000/health

# If the deploy lock is stuck after a crashed script:
rm -rf .deploy.lock
```

Never run `pm2 restart all` as a fix — restart only the specific process
that's actually broken.

## CI (`.github/workflows/deploy.yml`)

Runs on every push to `main`. Builds the API on the GitHub Actions runner
(plenty of RAM there — never on the production droplet), then invokes the
exact same `scripts/deploy/classify.sh` → `deploy-api.sh` / `deploy-web.sh`
path described above. There is no separate, less-safe CI-only deploy
mechanism — CI and manual deploys are the same code.

## Bootstrapping `.deploy-state.json`

If it's ever missing (fresh server, or deliberately reset), `classify.sh`
and `deploy.sh` refuse to run rather than guess. Recreate it by hand,
setting `api_sha` and `web_sha` to whatever commit is *actually* running in
production right now (check `cd /var/www/codeclinic && git log -1` and
cross-reference against the deployed `BUILD_ID` — don't assume they match
`origin/main`):

```bash
ssh root@46.101.255.243 'cat > /var/www/codeclinic/.deploy-state.json <<EOF
{"api_sha": "<sha>", "web_sha": "<sha>", "web_build_id": "<build-id>", "updated_at": "<iso8601>"}
EOF'
```
