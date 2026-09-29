import { client, company, eq, inArray, office, type Database } from "@usermanagement/db";
import type { Scope, ScopeLevel } from "@usermanagement/shared";

export interface ResolvedOffice {
  clientId: string;
  companyId: string;
  officeId: string;
  clientName: string;
  companyName: string;
  officeName: string;
}

/** Scope tuple for a single office entity. */
export function officeAsScope(o: ResolvedOffice): Scope {
  return { clientId: o.clientId, companyId: o.companyId, officeIds: [o.officeId] };
}

/** Load several offices with ancestors; they must all belong to one company. */
export async function resolveOffices(db: Database, officeIds: string[]): Promise<ResolvedOffice[] | { error: string }> {
  const ids = [...new Set(officeIds)];
  if (ids.length === 0) return { error: "At least one office is required" };
  const rows = await db
    .select({
      officeId: office.id,
      officeName: office.name,
      companyId: company.id,
      companyName: company.name,
      clientId: client.id,
      clientName: client.name,
    })
    .from(office)
    .innerJoin(company, eq(company.id, office.companyId))
    .innerJoin(client, eq(client.id, company.clientId))
    .where(inArray(office.id, ids));
  if (rows.length !== ids.length) return { error: "One or more offices were not found" };
  if (new Set(rows.map((r) => r.companyId)).size > 1) return { error: "All offices must belong to the same company" };
  return rows;
}

/** Load an office with its ancestors. Never trust client-supplied ancestor ids. */
export async function resolveOffice(db: Database, officeId: string): Promise<ResolvedOffice | null> {
  const [row] = await db
    .select({
      officeId: office.id,
      officeName: office.name,
      companyId: company.id,
      companyName: company.name,
      clientId: client.id,
      clientName: client.name,
    })
    .from(office)
    .innerJoin(company, eq(company.id, office.companyId))
    .innerJoin(client, eq(client.id, company.clientId))
    .where(eq(office.id, officeId));
  return row ?? null;
}

export interface ResolvedCompany {
  clientId: string;
  companyId: string;
  clientName: string;
  companyName: string;
}

export async function resolveCompany(db: Database, companyId: string): Promise<ResolvedCompany | null> {
  const [row] = await db
    .select({
      companyId: company.id,
      companyName: company.name,
      clientId: client.id,
      clientName: client.name,
    })
    .from(company)
    .innerJoin(client, eq(client.id, company.clientId))
    .where(eq(company.id, companyId));
  return row ?? null;
}

export async function resolveClient(db: Database, clientId: string) {
  const [row] = await db
    .select({ clientId: client.id, clientName: client.name })
    .from(client)
    .where(eq(client.id, clientId));
  return row ?? null;
}

export type ScopeNames = { client?: string; company?: string; offices?: string[] };

/**
 * Given a scope level and the *leaf* id the caller supplied, derive the full
 * scope tuple from the database so ancestors can never be spoofed.
 */
export async function resolveScopeForLevel(
  db: Database,
  level: ScopeLevel,
  ids: { clientId?: string | null; companyId?: string | null; officeIds?: string[] },
): Promise<{ scope: Scope; names: ScopeNames } | { error: string }> {
  switch (level) {
    case "global":
      return { scope: { clientId: null, companyId: null, officeIds: [] }, names: {} };
    case "client": {
      if (!ids.clientId) return { error: "clientId is required for this role" };
      const c = await resolveClient(db, ids.clientId);
      if (!c) return { error: "Client not found" };
      return { scope: { clientId: c.clientId, companyId: null, officeIds: [] }, names: { client: c.clientName } };
    }
    case "company": {
      if (!ids.companyId) return { error: "companyId is required for this role" };
      const co = await resolveCompany(db, ids.companyId);
      if (!co) return { error: "Company not found" };
      return {
        scope: { clientId: co.clientId, companyId: co.companyId, officeIds: [] },
        names: { client: co.clientName, company: co.companyName },
      };
    }
    case "office": {
      if (!ids.officeIds?.length) return { error: "officeIds is required for this role" };
      const offices = await resolveOffices(db, ids.officeIds);
      if ("error" in offices) return offices;
      const first = offices[0]!;
      return {
        scope: { clientId: first.clientId, companyId: first.companyId, officeIds: offices.map((o) => o.officeId) },
        names: { client: first.clientName, company: first.companyName, offices: offices.map((o) => o.officeName) },
      };
    }
  }
}
