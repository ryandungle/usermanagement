# User Management

A user management app built as a pnpm monorepo:

| Layer      | Tech                                                        | Where            |
| ---------- | ----------------------------------------------------------- | ---------------- |
| API        | [Hono](https://hono.dev) on Cloudflare Workers              | `apps/api`       |
| Front end  | React + Vite + TanStack Router (served as Worker static assets) | `apps/web`   |
| Auth       | [Better Auth](https://better-auth.com) with the `admin` plugin | `packages/auth` |
| Database   | [Neon](https://neon.tech) Postgres via Drizzle ORM (HTTP driver) | `packages/db` |

The API and the built SPA are deployed as **one Worker**, so cookies are
same-origin and no CORS configuration is needed in production.

## Features

- Email + password sign up / sign in / sign out (Better Auth)
- Profile page: edit name, sign out other devices
- Admin console (`/users`): search, filter by role/status, paginate
- Admin actions: edit name/email, promote/demote admin, ban (with reason and
  optional expiry), unban, revoke sessions, delete
- Server-side role enforcement via Hono middleware and Better Auth's admin API

## Prerequisites

- Node 20+
- pnpm 10 (`corepack enable` picks the pinned version from `package.json`)
- A Neon project (free tier is fine)
- A Cloudflare account for deployment (`wrangler login`)

## Setup

```bash
pnpm install

# 1. Root env (used by Drizzle Kit and the seed script)
cp .env.example .env            # fill in DATABASE_URL and BETTER_AUTH_SECRET

# 2. Worker local secrets (used by `wrangler dev`)
cp apps/api/.dev.vars.example apps/api/.dev.vars   # same values

# 3. Create the tables in Neon
pnpm db:migrate                 # applies packages/db/drizzle/*.sql
```

Generate a secret with `openssl rand -base64 32`.

## Develop

```bash
pnpm dev
```

This starts two processes:

- `wrangler dev` for the API on http://localhost:8787
- Vite for the UI on http://localhost:5173 (proxies `/api/*` to the Worker)

Open http://localhost:5173, create an account, then promote it to admin:

```bash
pnpm seed:admin you@example.com
```

Sign out and back in (or wait for the session cookie cache to refresh) and the
**Users** link appears in the nav.

## Deploy to Cloudflare

```bash
cd apps/api
npx wrangler login
npx wrangler secret put DATABASE_URL
npx wrangler secret put BETTER_AUTH_SECRET
```

Then set the production URL in `apps/api/wrangler.jsonc` under `vars`:

```jsonc
"vars": {
  "BETTER_AUTH_URL": "https://usermanagement.<your-subdomain>.workers.dev",
  "TRUSTED_ORIGINS": ""
}
```

and deploy (this builds the web app first, then uploads the Worker plus assets):

```bash
pnpm deploy
```

Run `pnpm db:migrate` against the production database before the first deploy.

## Scripts

| Command             | What it does                                            |
| ------------------- | ------------------------------------------------------- |
| `pnpm dev`          | API + web dev servers                                   |
| `pnpm build`        | Build web, typecheck API                                |
| `pnpm typecheck`    | Typecheck every workspace                               |
| `pnpm deploy`       | Build web and `wrangler deploy`                         |
| `pnpm db:generate`  | Generate a migration from `packages/db/src/schema.ts`   |
| `pnpm db:migrate`   | Apply migrations to `DATABASE_URL`                      |
| `pnpm db:push`      | Push schema directly (dev only, skips migration files)  |
| `pnpm db:studio`    | Open Drizzle Studio                                     |
| `pnpm seed:admin`   | Promote a user to admin by email                        |

## API

All routes live under `/api`. Better Auth owns `/api/auth/*`
(`/sign-up/email`, `/sign-in/email`, `/sign-out`, `/get-session`, admin
endpoints, etc.).

| Method | Path                            | Auth  | Purpose                          |
| ------ | ------------------------------- | ----- | -------------------------------- |
| GET    | `/api/health`                   | none  | Liveness                         |
| GET    | `/api/me`                       | user  | Current user + session           |
| PATCH  | `/api/me`                       | user  | Update own name / image          |
| GET    | `/api/me/sessions`              | user  | List own sessions                |
| GET    | `/api/users`                    | admin | List users (`q`, `role`, `banned`, `page`, `pageSize`, `sort`, `order`) |
| GET    | `/api/users/:id`                | admin | Get one user                     |
| PATCH  | `/api/users/:id`                | admin | Update name / email              |
| PUT    | `/api/users/:id/role`           | admin | Set role (`user` or `admin`)     |
| POST   | `/api/users/:id/ban`            | admin | Ban (`reason?`, `expiresIn?` seconds) |
| POST   | `/api/users/:id/unban`          | admin | Lift ban                         |
| POST   | `/api/users/:id/revoke-sessions`| admin | Sign the user out everywhere     |
| DELETE | `/api/users/:id`                | admin | Delete user                      |

## Project layout

```
apps/
  api/        Hono Worker (wrangler.jsonc, src/app.ts, routes/, middleware/)
  web/        Vite + React SPA (src/router.tsx, routes/, lib/auth-client.ts)
packages/
  auth/       Better Auth instance factory (getAuth(env))
  db/         Drizzle schema, Neon client, migrations, seed script
```

Shared packages export TypeScript source directly; Wrangler and Vite bundle
them, so there is no separate build step for `packages/*`.
