import { useEffect, useState } from "react";
import { ROLE_LEVEL, type Role, type ScopeLevel } from "@usermanagement/shared";
import { api, type Client, type Company, type Me, type Office } from "../lib/api";

export interface PickedScope {
  clientId?: string;
  companyId?: string;
  officeId?: string;
}

const ORDER: ScopeLevel[] = ["global", "client", "company", "office"];
const deeper = (a: ScopeLevel, b: ScopeLevel) => ORDER.indexOf(a) > ORDER.indexOf(b);

/**
 * Cascading client → company → office selects, showing only the levels the
 * chosen role needs and that lie below the current actor's own scope.
 */
export function ScopePicker({
  me,
  role,
  value,
  onChange,
}: {
  me: Me;
  role: Role;
  value: PickedScope;
  onChange: (next: PickedScope) => void;
}) {
  const need = ROLE_LEVEL[role];
  const actorLevel = me.scope.level;

  const [clients, setClients] = useState<Client[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [offices, setOffices] = useState<Office[]>([]);

  const clientId = value.clientId ?? me.actor.clientId ?? undefined;
  const companyId = value.companyId ?? me.actor.companyId ?? undefined;

  const showClient = deeper(need, "global") && actorLevel === "global";
  const showCompany = deeper(need, "client") && !deeper(actorLevel, "client");
  const showOffice = deeper(need, "company") && !deeper(actorLevel, "company");

  useEffect(() => {
    if (showClient) api.listClients().then((r) => setClients(r.data)).catch(() => setClients([]));
  }, [showClient]);

  useEffect(() => {
    if (showCompany && clientId) {
      api.listCompanies(clientId).then((r) => setCompanies(r.data)).catch(() => setCompanies([]));
    } else setCompanies([]);
  }, [showCompany, clientId]);

  useEffect(() => {
    if (showOffice && companyId) {
      api.listOffices({ companyId }).then((r) => setOffices(r.data)).catch(() => setOffices([]));
    } else setOffices([]);
  }, [showOffice, companyId]);

  if (need === "global") return <p className="muted">App admins have global scope.</p>;

  return (
    <>
      {showClient && (
        <div className="field">
          <label htmlFor="scope-client">Client</label>
          <select
            id="scope-client"
            required
            value={value.clientId ?? ""}
            onChange={(e) => onChange({ clientId: e.target.value || undefined })}
          >
            <option value="">Select a client…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      )}
      {showCompany && (
        <div className="field">
          <label htmlFor="scope-company">Company</label>
          <select
            id="scope-company"
            required
            disabled={!clientId}
            value={value.companyId ?? ""}
            onChange={(e) => onChange({ ...value, companyId: e.target.value || undefined, officeId: undefined })}
          >
            <option value="">Select a company…</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      )}
      {showOffice && (
        <div className="field">
          <label htmlFor="scope-office">Office</label>
          <select
            id="scope-office"
            required
            disabled={!companyId}
            value={value.officeId ?? ""}
            onChange={(e) => onChange({ ...value, officeId: e.target.value || undefined })}
          >
            <option value="">Select an office…</option>
            {offices.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>
      )}
      {!showClient && !showCompany && !showOffice && (
        <p className="muted">
          Will be placed in your {need}: {need === "client" ? me.scope.clientName : need === "company" ? me.scope.companyName : me.scope.officeName}
        </p>
      )}
    </>
  );
}
