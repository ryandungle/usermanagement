import { useEffect, useState } from "react";
import { ROLE_LEVEL, type Role, type ScopeLevel } from "@usermanagement/shared";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
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
          <Label>Offices</Label>
          {!companyId ? (
            <p className="text-muted-foreground text-sm">Choose a company first.</p>
          ) : offices.length === 0 ? (
            <p className="text-muted-foreground text-sm">This company has no offices yet.</p>
          ) : (
            <div className="grid max-h-48 gap-2 overflow-y-auto rounded-md border p-3">
              {offices.map((o) => {
                const checked = (value.officeIds ?? []).includes(o.id);
                return (
                  <label key={o.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(on) => {
                        const set = new Set(value.officeIds ?? []);
                        if (on) set.add(o.id);
                        else set.delete(o.id);
                        onChange({ ...value, officeIds: [...set] });
                      }}
                    />
                    {o.name}
                  </label>
                );
              })}
            </div>
          )}
          <p className="text-muted-foreground text-xs">A person can work at several locations of the same legal entity.</p>
        </div>
      )}
      {!showClient && !showCompany && !showOffice && (
        <p className="text-muted-foreground text-sm">Will be placed in your {need}: {placed}</p>
      )}
    </div>
  );
}
