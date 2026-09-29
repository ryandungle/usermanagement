# User Management

A user management app built as a pnpm monorepo:

| Layer      | Tech                                                        | Where            |
| ---------- | ----------------------------------------------------------- | ---------------- |
| API        | [Hono](https://hono.dev) on Cloudflare Workers              | `apps/api`       |
| Front end  | React + Vite + TanStack Router (served as Worker static assets) | `apps/web`   |
| Auth       | [Better Auth](https://better-auth.com) with the `admin` plugin | `packages/auth` |
| Database   | [Neon](https://neon.tech) Postgres via Drizzle ORM (HTTP driver) | `packages/db` |
| RBAC       | Pure role/scope rules shared by API and UI                  | `packages/shared` |

The API and the built SPA are deployed as **one Worker**, so cookies are
same-origin and no CORS configuration is needed in production.

## Role hierarchy

```
app_admin        creates clients              global scope
 └ client_admin  creates companies            scoped to one client
    └ company_owner  creates offices          scoped to one company
       └ office_manager  creates users        scoped to one office
          └ user                              belongs to one office
```

Rules (implemented once in `packages/shared/src/rbac.ts`, enforced by the API
and mirrored in the UI):

- **Higher roles inherit everything below them, inside their own scope.** A
  company owner can create offices *and* users, but only within their company.
- **Scope is stored on the user row** as `clientId` / `companyId` / `officeId`.
  `null` means "all" at that level, so an app admin has all three null and an
  office manager has all three set. The API always derives ancestor ids from
  the leaf entity in the database; clients can never spoof them.
- **You can only hand out roles strictly below your own.** App admins may also
  create other app admins.
- **You can only manage (edit, re-role, reset password, ban, sign out, delete)
  users inside your scope with a lower role than yours.** Nobody can manage
  themselves; app admins may manage other app admins.
- **Public sign-up is disabled.** Every account is provisioned by someone
  higher in the tree, or by the seed script for the first app admin.
- Changing a role or password revokes all of that user's sessions.

## Features

- Email + password sign in (Better Auth), sign-up disabled
- Profile page: edit name, sign out other devices
- Organization browser (`/org`): drill down Clients → Companies → Offices with
  create / rename / delete gated by role
- Users console (`/users`): scoped list, search, filter by role/status/office,
  paginate, create user with role + scope picker
- User actions: edit name/email, change role and scope, reset password, ban
  (with reason and optional expiry), unban, revoke sessions, delete

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

Create the first app admin (sign-up is disabled, so this is the only way in):

```bash
pnpm seed:admin you@example.com 'a-strong-password' "Your Name"
# or set ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME in .env and run `pnpm seed:admin`
```

Open http://localhost:5173, sign in, then use **Organization** to create a
client, a company and an office, and **Users** to add people at each level.

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
| `pnpm seed:admin`   | Create (or promote) the first app admin                 |

## API

All routes live under `/api`. Better Auth owns `/api/auth/*` (`/sign-in/email`,
`/sign-out`, `/get-session`, and its `/admin/*` endpoints which only
`app_admin` may call). Everything else is hierarchy-aware.

| Method | Path                              | Min role        | Purpose                                   |
| ------ | --------------------------------- | --------------- | ----------------------------------------- |
| GET    | `/api/health`                     | none            | Liveness                                  |
| GET    | `/api/me`                         | user            | Profile, scope names, permissions         |
| PATCH  | `/api/me`                         | user            | Update own name / image                   |
| GET    | `/api/me/sessions`                | user            | List own sessions                         |
| GET    | `/api/clients`                    | user            | Clients in scope                          |
| POST   | `/api/clients`                    | app_admin       | Create client                             |
| PATCH  | `/api/clients/:id`                | client_admin    | Rename (own client)                       |
| DELETE | `/api/clients/:id`                | app_admin       | Delete (cascades)                         |
| GET    | `/api/companies?clientId=`        | user            | Companies in scope                        |
| POST   | `/api/companies`                  | client_admin    | Create company `{ clientId, name }`       |
| PATCH  | `/api/companies/:id`              | company_owner   | Rename                                    |
| DELETE | `/api/companies/:id`              | client_admin    | Delete (cascades)                         |
| GET    | `/api/offices?companyId=`         | user            | Offices in scope                          |
| POST   | `/api/offices`                    | company_owner   | Create office `{ companyId, name }`       |
| PATCH  | `/api/offices/:id`                | office_manager  | Rename                                    |
| DELETE | `/api/offices/:id`                | company_owner   | Delete (cascades)                         |
| GET    | `/api/users`                      | office_manager  | Users in scope (`q`, `role`, `banned`, `clientId`, `companyId`, `officeId`, `page`, `pageSize`, `sort`, `order`) |
| POST   | `/api/users`                      | office_manager  | Create `{ name, email, password, role, clientId? \| companyId? \| officeId? }` |
| GET    | `/api/users/:id`                  | office_manager  | Get one user                              |
| PATCH  | `/api/users/:id`                  | office_manager  | Update name / email                       |
| PUT    | `/api/users/:id/role`             | office_manager  | Change role (and scope)                   |
| PUT    | `/api/users/:id/password`         | office_manager  | Reset password                            |
| POST   | `/api/users/:id/ban`              | office_manager  | Ban (`reason?`, `expiresIn?` seconds)     |
| POST   | `/api/users/:id/unban`            | office_manager  | Lift ban                                  |
| POST   | `/api/users/:id/revoke-sessions`  | office_manager  | Sign the user out everywhere              |
| DELETE | `/api/users/:id`                  | office_manager  | Delete user                               |

"Min role" is the floor; every user mutation additionally requires the target
to be inside the caller's scope and below the caller's rank.

## Project layout

```
apps/
  api/        Hono Worker (wrangler.jsonc, src/app.ts, routes/, middleware/)
  web/        Vite + React SPA (src/router.tsx, routes/, lib/auth-client.ts)
packages/
  shared/     Role hierarchy + scope rules (no dependencies; used by API and web)
  auth/       Better Auth factory, createManagedUser(), seed script
  db/         Drizzle schema (client/company/office + auth tables), Neon client, migrations
```

Shared packages export TypeScript source directly; Wrangler and Vite bundle
them, so there is no separate build step for `packages/*`.
