/**
 * Role hierarchy (highest to lowest):
 *
 *   app_admin      → creates clients            (global scope)
 *   client_admin   → creates companies          (scoped to one client)
 *   company_owner  → creates offices            (scoped to one company)
 *   office_manager → creates users              (scoped to one office)
 *   user           → no management rights       (belongs to one office)
 *
 * A higher role can do everything a lower role can, but only inside its own
 * scope. Scope is (clientId, companyId, officeIds): the ids live on the user
 * row and office memberships in the user_office table. A null id / empty
 * officeIds means "all" at that level, so an app_admin has everything null and
 * an office-level role has clientId, companyId and at least one office. All of
 * a person's offices belong to their one company.
 */

export const ROLES = ["user", "office_manager", "company_owner", "client_admin", "app_admin"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_RANK: Record<Role, number> = {
  user: 0,
  office_manager: 1,
  company_owner: 2,
  client_admin: 3,
  app_admin: 4,
};

export const ROLE_LABEL: Record<Role, string> = {
  user: "User",
  office_manager: "Office manager",
  company_owner: "Company owner",
  client_admin: "Client admin",
  app_admin: "App admin",
};

/** Which level of the tree a role is attached to. */
export type ScopeLevel = "global" | "client" | "company" | "office";

export const ROLE_LEVEL: Record<Role, ScopeLevel> = {
  app_admin: "global",
  client_admin: "client",
  company_owner: "company",
  office_manager: "office",
  user: "office",
};

/** Minimum role needed to create an entity at each level. */
export const CREATE_MIN_ROLE = {
  client: "app_admin",
  company: "client_admin",
  office: "company_owner",
  user: "office_manager",
} as const satisfies Record<string, Role>;

export interface Scope {
  clientId: string | null;
  companyId: string | null;
  /** Office memberships. Empty = unrestricted at office level (roles above office). */
  officeIds: string[];
}

export const EMPTY_SCOPE: Scope = { clientId: null, companyId: null, officeIds: [] };

export interface Actor extends Scope {
  id: string;
  role: Role;
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function rankOf(role: Role): number {
  return ROLE_RANK[role];
}

/** True when `actor` holds `min` or a higher role. */
export function hasRank(actor: Pick<Actor, "role">, min: Role): boolean {
  return rankOf(actor.role) >= rankOf(min);
}

/**
 * True when `target` lies inside `actor`'s scope. Non-null client/company ids
 * must match exactly; when the actor is office-scoped the target must share at
 * least one office with them. Null ids / empty office lists match anything.
 */
export function scopeContains(actor: Scope, target: Scope): boolean {
  if (actor.clientId !== null && actor.clientId !== target.clientId) return false;
  if (actor.companyId !== null && actor.companyId !== target.companyId) return false;
  if (actor.officeIds.length > 0 && !target.officeIds.some((id) => actor.officeIds.includes(id))) return false;
  return true;
}

/** Scope of a single office, for checking an office entity against an actor. */
export function officeScope(clientId: string, companyId: string, officeId: string): Scope {
  return { clientId, companyId, officeIds: [officeId] };
}

/**
 * Roles an actor may hand out: everything strictly below their own rank.
 * App admins may also create other app admins.
 */
export function assignableRoles(actor: Pick<Actor, "role">): Role[] {
  const own = rankOf(actor.role);
  return ROLES.filter((r) => rankOf(r) < own || (actor.role === "app_admin" && r === "app_admin"));
}

export function canAssignRole(actor: Pick<Actor, "role">, role: Role): boolean {
  return assignableRoles(actor).includes(role);
}

/**
 * Whether `actor` may edit / ban / delete `target`. Never yourself; the target
 * must sit inside your scope and rank strictly below you (app admins may manage
 * other app admins).
 */
export function canManageUser(actor: Actor, target: Actor): boolean {
  if (actor.id === target.id) return false;
  if (!scopeContains(actor, target)) return false;
  return rankOf(target.role) < rankOf(actor.role) || actor.role === "app_admin";
}

/** The scope a role must carry: which ids are required and which must be null. */
export function normalizeScopeForRole(role: Role, scope: Scope): Scope {
  switch (ROLE_LEVEL[role]) {
    case "global":
      return { clientId: null, companyId: null, officeIds: [] };
    case "client":
      return { clientId: scope.clientId, companyId: null, officeIds: [] };
    case "company":
      return { clientId: scope.clientId, companyId: scope.companyId, officeIds: [] };
    case "office":
      return scope;
  }
}

/** Ids that must be present for a role's scope to be valid. */
export function scopeIsComplete(role: Role, scope: Scope): boolean {
  switch (ROLE_LEVEL[role]) {
    case "global":
      return true;
    case "client":
      return scope.clientId !== null;
    case "company":
      return scope.clientId !== null && scope.companyId !== null;
    case "office":
      return scope.clientId !== null && scope.companyId !== null && scope.officeIds.length > 0;
  }
}

/** Level of the tree the actor "starts" at when browsing the organization. */
export function homeLevel(actor: Pick<Actor, "role">): ScopeLevel {
  return ROLE_LEVEL[actor.role];
}
