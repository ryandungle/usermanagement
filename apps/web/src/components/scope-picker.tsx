import { useEffect, useState } from "react";
import { ROLE_LEVEL, type Role, type ScopeLevel } from "@usermanagement/shared";
import { Label } from "@/components/ui/label";
import { MultiSelect } from "@/components/multi-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, type Client, type Company, type Me, type Office } from "@/lib/api";

export interface PickedScope {
  clientId?: string;
  companyId?: string;
  officeIds?: string[];
}

const ORDER: ScopeLevel[] = ["global", "client", "company", "office"];
const deeper = (a: ScopeLevel, b: ScopeLevel) => ORDER.indexOf(a) > ORDER.indexOf(b);

/** Cascading client → company → office selects, limited to what the role needs and the actor can see. */
export function ScopePicker({ me, role, value, onChange, lockCompany = false }: { me: Me; role: Role; value: PickedScope; onChange: (next: PickedScope) => void; lockCompany?: boolean }) {
  const need = ROLE_LEVEL[role];
  const actorLevel = me.scope.level;

  const [clients, setClients] = useState<Client[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [offices, setOffices] = useState<Office[]>([]);

  const clientId = value.clientId ?? me.actor.clientId ?? undefined;
  const companyId = value.companyId ?? me.actor.companyId ?? undefined;

  const showClient = !lockCompany && deeper(need, "global") && actorLevel === "global";
  const showCompany = !lockCompany && deeper(need, "client") && !deeper(actorLevel, "client");
  // Office-scoped actors pick among their own offices (only worth showing when they have several).
  const actorOffices = me.scope.offices;
  const actorIsOfficeScoped = actorLevel === "office";
  const showOffice = deeper(need, "company") && (!actorIsOfficeScoped || actorOffices.length > 1);

  useEffect(() => {
    if (showClient) api.listClients().then((r) => setClients(r.data)).catch(() => setClients([]));
  }, [showClient]);
  useEffect(() => {
    if (showCompany && clientId) api.listCompanies(clientId).then((r) => setCompanies(r.data)).catch(() => setCompanies([]));
    else setCompanies([]);
  }, [showCompany, clientId]);
  useEffect(() => {
    if (actorIsOfficeScoped) setOffices(actorOffices.map((o) => ({ id: o.id, name: o.name, companyId: me.actor.companyId ?? "" })));
    else if (showOffice && companyId) api.listOffices({ companyId }).then((r) => setOffices(r.data)).catch(() => setOffices([]));
    else setOffices([]);
  }, [showOffice, companyId, actorIsOfficeScoped, actorOffices, me.actor.companyId]);

  // An office-scoped actor's picks default to all of their offices.
  useEffect(() => {
    if (need === "office" && actorIsOfficeScoped && !(value.officeIds?.length)) {
      onChange({ ...value, officeIds: actorOffices.map((o) => o.id) });
    }
  }, [need, actorIsOfficeScoped]); // eslint-disable-line react-hooks/exhaustive-deps

  if (need === "global") return <p className="text-muted-foreground text-sm">App admins have global scope.</p>;

  const placed = need === "client" ? me.scope.clientName : need === "company" ? me.scope.companyName : me.scope.offices.map((o) => o.name).join(", ");

  return (
    <div className="grid gap-4">
      {showClient && (
        <div className="grid gap-2">
          <Label>Client</Label>
          <Select value={value.clientId ?? ""} onValueChange={(v) => onChange({ clientId: v || undefined })}>
            <SelectTrigger><SelectValue placeholder="Select a client" /></SelectTrigger>
            <SelectContent>{clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      )}
      {showCompany && (
        <div className="grid gap-2">
          <Label>Company</Label>
          <Select value={value.companyId ?? ""} disabled={!clientId} onValueChange={(v) => onChange({ ...value, companyId: v || undefined, officeIds: [] })}>
            <SelectTrigger><SelectValue placeholder="Select a company" /></SelectTrigger>
            <SelectContent>{companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      )}
      {showOffice && (
        <div className="grid gap-2">
          <Label htmlFor="scope-offices">Offices</Label>
          <MultiSelect
            id="scope-offices"
            disabled={!companyId}
            options={offices.map((o) => ({ value: o.id, label: o.name }))}
            value={value.officeIds ?? []}
            onChange={(ids) => onChange({ ...value, officeIds: ids })}
            placeholder={!companyId ? "Choose a company first" : offices.length === 0 ? "This company has no offices yet" : "Select offices"}
            searchPlaceholder="Search offices…"
            emptyText="No office matches."
          />
          <p className="text-muted-foreground text-xs">A person can work at several locations of the same legal entity.</p>
        </div>
      )}
      {!showClient && !showCompany && !showOffice && (
        <p className="text-muted-foreground text-sm">Will be placed in your {need}: {placed}</p>
      )}
    </div>
  );
}
