import { boolean, index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

// ---------------------------------------------------------------------------
// Organization tree: client -> company -> office -> user
// ---------------------------------------------------------------------------

export const client = pgTable("client", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ...timestamps,
});

export const company = pgTable(
  "company",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => client.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    ...timestamps,
  },
  (t) => [index("company_client_id_idx").on(t.clientId)],
);

export const office = pgTable(
  "office",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    ...timestamps,
  },
  (t) => [index("office_company_id_idx").on(t.companyId)],
);

// ---------------------------------------------------------------------------
// Better Auth tables (+ admin plugin columns + our scope columns on user)
// ---------------------------------------------------------------------------

export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    ...timestamps,
    // admin plugin
    role: text("role").notNull().default("user"),
    banned: boolean("banned").notNull().default(false),
    banReason: text("ban_reason"),
    banExpires: timestamp("ban_expires"),
    // hierarchy scope (null = unrestricted at that level; see @usermanagement/shared).
    // Office memberships live in user_office so a person can belong to several offices.
    clientId: text("client_id").references(() => client.id, { onDelete: "cascade" }),
    companyId: text("company_id").references(() => company.id, { onDelete: "cascade" }),
  },
  (t) => [
    index("user_client_id_idx").on(t.clientId),
    index("user_company_id_idx").on(t.companyId),
    index("user_role_idx").on(t.role),
  ],
);

/**
 * External database hooked up to an office (its clinic/practice system).
 * The connection string is encrypted with a key derived from BETTER_AUTH_SECRET;
 * only host/database are stored in the clear for display.
 */
export const officeConnector = pgTable("office_connector", {
  officeId: text("office_id")
    .primaryKey()
    .references(() => office.id, { onDelete: "cascade" }),
  type: text("type").notNull().default("mongodb"),
  urlEncrypted: text("url_encrypted").notNull(),
  host: text("host").notNull(),
  database: text("database").notNull(),
  /** JSON array of collection names seen on the last successful test. */
  collections: text("collections").notNull().default("[]"),
  /** Practice-management system the data comes from (see @usermanagement/shared PMS_TYPES). */
  pmsType: text("pms_type").notNull().default("denticon"),
  /** JSON object of collection-name overrides keyed by the adapter's collection keys. */
  mapping: text("mapping").notNull().default("{}"),
  status: text("status").notNull().default("unknown"),
  lastError: text("last_error"),
  lastTestedAt: timestamp("last_tested_at"),
  createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
  ...timestamps,
});

/** Many-to-many: which offices a user (or office manager) belongs to. */
export const userOffice = pgTable(
  "user_office",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    officeId: text("office_id")
      .notNull()
      .references(() => office.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.officeId] }), index("user_office_office_id_idx").on(t.officeId)],
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    ...timestamps,
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // admin plugin
    impersonatedBy: text("impersonated_by"),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    ...timestamps,
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    ...timestamps,
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

export const schema = { client, company, office, officeConnector, user, userOffice, session, account, verification };

export type Client = typeof client.$inferSelect;
export type Company = typeof company.$inferSelect;
export type Office = typeof office.$inferSelect;
export type OfficeConnector = typeof officeConnector.$inferSelect;
export type User = typeof user.$inferSelect;
export type UserOffice = typeof userOffice.$inferSelect;
export type NewUser = typeof user.$inferInsert;
export type Session = typeof session.$inferSelect;
export type Account = typeof account.$inferSelect;
export type Verification = typeof verification.$inferSelect;
