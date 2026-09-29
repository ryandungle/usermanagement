import { useEffect, useState, type FormEvent } from "react";
import { AlertTriangleIcon, LoaderIcon, SettingsIcon } from "lucide-react";
import { PMS_COLLECTIONS, PMS_LABEL, PMS_TYPES, defaultMapping, type PmsMapping, type PmsType } from "@usermanagement/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, ApiError, type OfficeConnector } from "@/lib/api";

/** Practice-management system type and collection mapping for a connected office. */
export function PmsSettingsCard({ officeId, connector, onChange }: { officeId: string; connector: OfficeConnector; onChange: (next: OfficeConnector) => void }) {
  const [pmsType, setPmsType] = useState<PmsType>(connector.pmsType);
  const [mapping, setMapping] = useState<PmsMapping>(connector.mapping);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setPmsType(connector.pmsType);
    setMapping(connector.mapping);
  }, [connector.pmsType, connector.mapping]);

  const specs = PMS_COLLECTIONS[pmsType];
  const defaults = defaultMapping(pmsType);
  const known = new Set(connector.collections);
  const dirty = pmsType !== connector.pmsType || JSON.stringify(mapping) !== JSON.stringify(connector.mapping);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const clean: PmsMapping = Object.fromEntries(Object.entries(mapping).filter(([k, v]) => v.trim() && v.trim() !== defaults[k]));
      const res = await api.saveConnectorSettings(officeId, { pmsType, mapping: clean });
      onChange(res.data);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save settings");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <form onSubmit={save} className="contents">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><SettingsIcon className="size-4" /> Practice system</CardTitle>
          <CardDescription>
            Which practice-management system this database comes from, and the collection each page reads. Defaults follow the system's export names; override any that differ.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="pms-type">System</Label>
            <Select value={pmsType} onValueChange={(v) => { setPmsType(v as PmsType); setMapping({}); }}>
              <SelectTrigger id="pms-type" className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>{PMS_TYPES.map((t) => <SelectItem key={t} value={t}>{PMS_LABEL[t]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {specs.map((spec) => {
              const value = mapping[spec.key] ?? "";
              const effective = value.trim() || spec.default;
              const exists = known.has(effective);
              return (
                <div key={spec.key} className="grid gap-1.5">
                  <Label htmlFor={`map-${spec.key}`} className="flex items-center gap-2">
                    {spec.label}
                    {spec.required ? <Badge variant="outline" className="text-muted-foreground px-1.5">required</Badge> : null}
                    {!exists && (
                      <span className={`ml-auto flex items-center gap-1 text-xs ${spec.required ? "text-destructive" : "text-amber-600 dark:text-amber-400"}`}>
                        <AlertTriangleIcon className="size-3" /> not in database
                      </span>
                    )}
                  </Label>
                  <Input
                    id={`map-${spec.key}`}
                    list="pms-collections"
                    placeholder={spec.default}
                    value={value}
                    onChange={(e) => setMapping((m) => ({ ...m, [spec.key]: e.target.value }))}
                    className="font-mono text-xs"
                  />
                  {spec.hint && <span className="text-muted-foreground text-xs">{spec.hint}</span>}
                </div>
              );
            })}
          </div>
          <datalist id="pms-collections">
            {connector.collections.map((c) => <option key={c} value={c} />)}
          </datalist>
          {error && <p className="text-destructive text-sm">{error}</p>}
          {saved && !dirty && <p className="text-muted-foreground text-sm">Settings saved.</p>}
        </CardContent>
        <CardFooter className="gap-2">
          <Button type="submit" size="sm" disabled={busy || !dirty}>
            {busy && <LoaderIcon className="animate-spin" />}
            Save settings
          </Button>
          {dirty && (
            <Button type="button" variant="ghost" size="sm" onClick={() => { setPmsType(connector.pmsType); setMapping(connector.mapping); setError(null); }}>
              Reset
            </Button>
          )}
        </CardFooter>
      </form>
    </Card>
  );
}
