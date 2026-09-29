import { useEffect, useState } from "react";
import { ROLE_LEVEL, type Role, type ScopeLevel } from "@usermanagement/shared";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, type Client, type Company, type Me, type Office } from "@/lib/api";

export interface PickedScope {
  clientId?: string;
  companyId?: string;
  officeId?: string;
}

const ORDER: ScopeLevel[] = ["global", "client", "company", "office"];
const deeper = (a: ScopeLevel, b: ScopeLevel) => ORDER.indexOf(a) > ORDER.indexOf(b);

/** Cascading client → company → office selects, limited to what the role needs and the actor can see. */
export function ScopePicker({ me, role, value, onChange }: { me: Me; role: Role; value: PickedScope; onChange: (next: PickedScope) => void }) {
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
    if (showCompany && clientId) api.listCompanies(clientId).then((r) => setCompanies(r.data)).catch(() => setCompanies([]));
    else setCompanies([]);
  }, [showCompany, clientId]);
  useEffect(() => {
    if (showOffice && companyId) api.listOffices({ companyId }).then((r) => setOffices(r.data)).catch(() => setOffices([]));
    else setOffices([]);
  }, [showOffice, companyId]);

  if (need === "global") return <p className="text-muted-foreground text-sm">App admins have global scope.</p>;

  const placed = need === "client" ? me.scope.clientName : need === "company" ? me.scope.companyName : me.scope.officeName;

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
          <Select value={value.companyId ?? ""} disabled={!clientId} onValueChange={(v) => onChange({ ...value, companyId: v || undefined, officeId: undefined })}>
            <SelectTrigger><SelectValue placeholder="Select a company" /></SelectTrigger>
            <SelectContent>{companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      )}
      {showOffice && (
        <div className="grid gap-2">
          <Label>Office</Label>
          <Select value={value.officeId ?? ""} disabled={!companyId} onValueChange={(v) => onChange({ ...value, officeId: v || undefined })}>
            <SelectTrigger><SelectValue placeholder="Select an office" /></SelectTrigger>
            <SelectContent>{offices.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      )}
      {!showClient && !showCompany && !showOffice && (
        <p className="text-muted-foreground text-sm">Will be placed in your {need}: {placed}</p>
      )}
    </div>
  );
}
