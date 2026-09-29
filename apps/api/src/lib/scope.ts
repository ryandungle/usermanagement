import { client, company, eq, office, type Database } from "@usermanagement/db";
import type { Scope, ScopeLevel } from "@usermanagement/shared";

export interface ResolvedOffice extends Scope {
  clientId: string;
  companyId: string;
  officeId: string;
  clientName: string;
  companyName: string;
  officeName: string;
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

export type ScopeNames = { client?: string; company?: string; office?: string };

/**
 * Given a scope level and the *leaf* id the caller supplied, derive the full
 * scope tuple from the database so ancestors can never be spoofed.
 */
export async function resolveScopeForLevel(
  db: Database,
  level: ScopeLevel,
  ids: Partial<Scope>,
): Promise<{ scope: Scope; names: ScopeNames } | { error: string }> {
  switch (level) {
    case "global":
      return { scope: { clientId: null, companyId: null, officeId: null }, names: {} };
    case "client": {
      if (!ids.clientId) return { error: "clientId is required for this role" };
      const c = await resolveClient(db, ids.clientId);
      if (!c) return { error: "Client not found" };
      return { scope: { clientId: c.clientId, companyId: null, officeId: null }, names: { client: c.clientName } };
    }
    case "company": {
      if (!ids.companyId) return { error: "companyId is required for this role" };
      const co = await resolveCompany(db, ids.companyId);
      if (!co) return { error: "Company not found" };
      return {
        scope: { clientId: co.clientId, companyId: co.companyId, officeId: null },
        names: { client: co.clientName, company: co.companyName },
      };
    }
    case "office": {
      if (!ids.officeId) return { error: "officeId is required for this role" };
      const o = await resolveOffice(db, ids.officeId);
      if (!o) return { error: "Office not found" };
      return {
        scope: { clientId: o.clientId, companyId: o.companyId, officeId: o.officeId },
        names: { client: o.clientName, company: o.companyName, office: o.officeName },
      };
    }
  }
}
