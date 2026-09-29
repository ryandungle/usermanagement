#!/usr/bin/env node
/**
 * One-shot provisioning: create a Neon database, run migrations, seed the first
 * app admin, and deploy the Worker (with secrets) to Cloudflare.
 *
 * Required env:
 *   NEON_API_KEY        (or NEONAPIKEY)        https://console.neon.tech/app/settings/api-keys
 *   CLOUDFLARE_API_TOKEN (or CLOUDFLARETOKEN)  needs Workers Scripts:Edit + Account Settings:Read
 * Optional env:
 *   CLOUDFLARE_ACCOUNT_ID   picked automatically when the token sees exactly one account
 *   NEON_PROJECT_NAME       default "usermanagement"
 *   NEON_REGION             default "aws-us-east-1"
 *   ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME   first app admin (password generated if empty)
 *   SKIP_NEON=1             reuse DATABASE_URL from .env instead of creating a project
 *   SKIP_DEPLOY=1           stop after migrate + seed
 *
 * Usage: pnpm provision
 */
import { execSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = path.join(root, "apps/api");
const envPath = path.join(root, ".env");

const NEON_API_KEY = process.env.NEON_API_KEY ?? process.env.NEONAPIKEY;
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN ?? process.env.CLOUDFLARETOKEN;
const WORKER_NAME = "usermanagement";

const log = (m) => console.log(`\n▶ ${m}`);
const die = (m) => {
  console.error(`\n✖ ${m}`);
  process.exit(1);
};

function readEnvFile() {
  if (!existsSync(envPath)) return {};
  return Object.fromEntries(
    readFileSync(envPath, "utf8")
      .split("\n")
      .filter((l) => l.trim() && !l.trim().startsWith("#") && l.includes("="))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"(.*)"$/, "$1")];
      }),
  );
}

function writeEnvFile(vars) {
  const lines = Object.entries(vars).map(([k, v]) => `${k}="${v}"`);
  writeFileSync(envPath, lines.join("\n") + "\n");
  writeFileSync(
    path.join(apiDir, ".dev.vars"),
    `DATABASE_URL="${vars.DATABASE_URL}"\nBETTER_AUTH_SECRET="${vars.BETTER_AUTH_SECRET}"\n`,
  );
}

async function json(url, init = {}) {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${url} → ${res.status}: ${JSON.stringify(body).slice(0, 400)}`);
  return body;
}

function run(cmd, opts = {}) {
  console.log(`  $ ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: root, ...opts });
}

// ---------------------------------------------------------------------------
// 1. Neon
// ---------------------------------------------------------------------------
const existing = readEnvFile();
const env = {
  DATABASE_URL: existing.DATABASE_URL ?? "",
  BETTER_AUTH_SECRET: existing.BETTER_AUTH_SECRET || randomBytes(32).toString("base64"),
  BETTER_AUTH_URL: existing.BETTER_AUTH_URL ?? "http://localhost:8787",
  TRUSTED_ORIGINS: existing.TRUSTED_ORIGINS ?? "http://localhost:5173",
  ADMIN_EMAIL: process.env.ADMIN_EMAIL ?? existing.ADMIN_EMAIL ?? "",
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ?? existing.ADMIN_PASSWORD ?? "",
  ADMIN_NAME: process.env.ADMIN_NAME ?? existing.ADMIN_NAME ?? "App Admin",
};

if (process.env.SKIP_NEON) {
  if (!env.DATABASE_URL) die("SKIP_NEON set but DATABASE_URL missing from .env");
  log(`Reusing existing DATABASE_URL from .env`);
} else {
  if (!NEON_API_KEY) die("NEON_API_KEY is not set");
  const name = process.env.NEON_PROJECT_NAME ?? WORKER_NAME;
  const region_id = process.env.NEON_REGION ?? "aws-us-east-1";
  log(`Creating Neon project "${name}" in ${region_id}`);
  const headers = { Authorization: `Bearer ${NEON_API_KEY}`, "Content-Type": "application/json" };

  // Reuse a project with the same name if one exists (idempotent re-runs).
  const list = await json("https://console.neon.tech/api/v2/projects?limit=100", { headers });
  let project = list.projects?.find((p) => p.name === name);
  let connectionUri;
  if (project) {
    console.log(`  found existing project ${project.id}`);
    const uri = await json(
      `https://console.neon.tech/api/v2/projects/${project.id}/connection_uri?database_name=neondb&role_name=neondb_owner`,
      { headers },
    );
    connectionUri = uri.uri;
  } else {
    const created = await json("https://console.neon.tech/api/v2/projects", {
      method: "POST",
      headers,
      body: JSON.stringify({ project: { name, region_id, pg_version: 17 } }),
    });
    project = created.project;
    connectionUri = created.connection_uris?.[0]?.connection_uri;
    console.log(`  created project ${project.id}`);
  }
  if (!connectionUri) die("Neon did not return a connection URI");
  env.DATABASE_URL = connectionUri.includes("sslmode=") ? connectionUri : `${connectionUri}?sslmode=require`;
  console.log(`  host: ${new URL(env.DATABASE_URL).host}`);
}

// ---------------------------------------------------------------------------
// 2. Cloudflare account + URL (needed before migrate so .env holds the final URL)
// ---------------------------------------------------------------------------
let accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
let workerUrl = env.BETTER_AUTH_URL;
if (!process.env.SKIP_DEPLOY) {
  if (!CF_TOKEN) die("CLOUDFLARE_API_TOKEN is not set");
  const cf = { Authorization: `Bearer ${CF_TOKEN}` };
  log("Resolving Cloudflare account");
  if (!accountId) {
    const accounts = await json("https://api.cloudflare.com/client/v4/accounts", { headers: cf });
    if (accounts.result.length !== 1) {
      die(`Token sees ${accounts.result.length} accounts; set CLOUDFLARE_ACCOUNT_ID to one of: ${accounts.result.map((a) => `${a.id} (${a.name})`).join(", ")}`);
    }
    accountId = accounts.result[0].id;
  }
  const sub = await json(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`, { headers: cf });
  if (!sub.result?.subdomain) die("This account has no workers.dev subdomain yet. Open the Workers dashboard once to create it.");
  workerUrl = `https://${WORKER_NAME}.${sub.result.subdomain}.workers.dev`;
  env.BETTER_AUTH_URL = workerUrl;
  env.TRUSTED_ORIGINS = "";
  console.log(`  account ${accountId}`);
  console.log(`  url     ${workerUrl}`);
}

writeEnvFile(env);
log("Wrote .env and apps/api/.dev.vars");

// Child processes read these via dotenv, which never overrides variables that
// already exist in the environment (even empty ones), so set them explicitly.
for (const [k, v] of Object.entries(env)) process.env[k] = v;

// ---------------------------------------------------------------------------
// 3. Migrate + seed
// ---------------------------------------------------------------------------
log("Applying migrations");
run("pnpm db:migrate");

if (!env.ADMIN_PASSWORD) {
  env.ADMIN_PASSWORD = randomBytes(12).toString("base64url");
  process.env.ADMIN_PASSWORD = env.ADMIN_PASSWORD;
  writeEnvFile(env);
}
if (!env.ADMIN_EMAIL) die("ADMIN_EMAIL is required to seed the first app admin");
log(`Seeding app admin ${env.ADMIN_EMAIL}`);
run("pnpm seed:admin");

if (process.env.SKIP_DEPLOY) {
  console.log("\nSKIP_DEPLOY set — done.");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 4. Deploy
// ---------------------------------------------------------------------------
const cfEnv = {
  ...process.env,
  CLOUDFLARE_API_TOKEN: CF_TOKEN,
  CLOUDFLARE_ACCOUNT_ID: accountId,
  WRANGLER_SEND_METRICS: "false",
};

log("Building web app");
run("pnpm --filter @usermanagement/web build");

log("Deploying Worker");
run(
  `npx wrangler deploy --var BETTER_AUTH_URL:${workerUrl} --var TRUSTED_ORIGINS:${workerUrl}`,
  { cwd: apiDir, env: cfEnv },
);

log("Uploading secrets");
const secretsFile = path.join(apiDir, ".secrets.tmp.json");
writeFileSync(secretsFile, JSON.stringify({ DATABASE_URL: env.DATABASE_URL, BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET }));
try {
  const r = spawnSync("npx", ["wrangler", "secret", "bulk", secretsFile], { cwd: apiDir, env: cfEnv, stdio: "inherit" });
  if (r.status !== 0) die("wrangler secret bulk failed");
} finally {
  unlinkSync(secretsFile);
}

console.log(`
✔ Deployed

  App:       ${workerUrl}
  Sign in:   ${env.ADMIN_EMAIL}
  Password:  ${env.ADMIN_PASSWORD}   (also saved as ADMIN_PASSWORD in .env — change it after first login)
`);
