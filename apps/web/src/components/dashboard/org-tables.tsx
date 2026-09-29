import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { LoaderIcon, MoreVerticalIcon, PlusIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, ApiError, type Client, type Company, type Me, type Office } from "@/lib/api";
import { ConfirmDialog } from "./user-dialogs";

type Entity = { id: string; name: string; createdAt?: string };

interface Config<T extends Entity> {
  label: string;
  plural: string;
  countLabel: string;
  count: (t: T) => number | undefined;
  list: () => Promise<{ data: T[] }>;
  create?: (name: string) => Promise<unknown>;
  rename?: (t: T, name: string) => Promise<unknown>;
  remove?: (t: T) => Promise<unknown>;
  open?: (t: T) => void;
  openLabel?: string;
}

function EntityTable<T extends Entity>({ cfg, onChanged }: { cfg: Config<T>; onChanged?: () => void }) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ kind: "create" } | { kind: "rename"; item: T } | { kind: "delete"; item: T } | null>(null);
  const [name, setName] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems((await cfg.list()).data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [cfg.list]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void reload();
  }, [reload]);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await reload();
      onChanged?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed");
    }
  }

  function submitName(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n || !dialog) return;
    if (dialog.kind === "create" && cfg.create) void run(() => cfg.create!(n));
    if (dialog.kind === "rename" && cfg.rename) void run(() => cfg.rename!(dialog.item, n));
    setDialog(null);
    setName("");
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <p className="text-muted-foreground text-sm">{items.length} {items.length === 1 ? cfg.label : cfg.plural}</p>
        {cfg.create && (
          <Button size="sm" className="ml-auto" onClick={() => { setName(""); setDialog({ kind: "create" }); }}>
            <PlusIcon />
            Add {cfg.label}
          </Button>
        )}
      </div>
      {error && (
        <div className="text-destructive bg-destructive/10 flex items-center gap-2 rounded-md px-3 py-2 text-sm"><XIcon className="size-4" /> {error}</div>
      )}
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader className="bg-muted">
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>{cfg.countLabel}</TableHead>
              <TableHead className="text-right">Created</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={4} className="h-24 text-center"><LoaderIcon className="text-muted-foreground mx-auto size-4 animate-spin" /></TableCell></TableRow>
            ) : items.length === 0 ? (
              <TableRow><TableCell colSpan={4} className="text-muted-foreground h-24 text-center">Nothing here yet.</TableCell></TableRow>
            ) : (
              items.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">
                    {cfg.open ? (
                      <button className="hover:underline" onClick={() => cfg.open!(t)}>{t.name}</button>
                    ) : t.name}
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">{cfg.count(t) ?? "–"}</TableCell>
                  <TableCell className="text-muted-foreground text-right tabular-nums">{t.createdAt ? new Date(t.createdAt).toLocaleDateString() : "–"}</TableCell>
                  <TableCell>
                    {(cfg.open || cfg.rename || cfg.remove) && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" className="text-muted-foreground data-[state=open]:bg-muted flex size-8" size="icon">
                            <MoreVerticalIcon /><span className="sr-only">Open menu</span>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          {cfg.open && <DropdownMenuItem onClick={() => cfg.open!(t)}>{cfg.openLabel ?? "Open"}</DropdownMenuItem>}
                          {cfg.rename && <DropdownMenuItem onClick={() => { setName(t.name); setDialog({ kind: "rename", item: t }); }}>Rename</DropdownMenuItem>}
                          {cfg.remove && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem variant="destructive" onClick={() => setDialog({ kind: "delete", item: t })}>Delete</DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {(dialog?.kind === "create" || dialog?.kind === "rename") && (
        <Dialog open onOpenChange={(o) => !o && setDialog(null)}>
          <DialogContent className="sm:max-w-sm">
            <form onSubmit={submitName} className="grid gap-4">
              <DialogHeader><DialogTitle>{dialog.kind === "create" ? `New ${cfg.label}` : `Rename ${dialog.item.name}`}</DialogTitle></DialogHeader>
              <div className="grid gap-2">
                <Label htmlFor="entity-name">Name</Label>
                <Input id="entity-name" autoFocus required value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialog(null)}>Cancel</Button>
                <Button type="submit">{dialog.kind === "create" ? "Create" : "Save"}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
      {dialog?.kind === "delete" && (
        <ConfirmDialog
          title={`Delete ${dialog.item.name}?`}
          description={`Everything inside this ${cfg.label} (and its users) is removed permanently.`}
          confirmLabel={`Delete ${cfg.label}`}
          onClose={() => setDialog(null)}
          onConfirm={() => { const item = dialog.item; setDialog(null); void run(() => cfg.remove!(item)); }}
        />
      )}
    </div>
  );
}

export function ClientsTable({ me, onChanged }: { me: Me; onChanged?: () => void }) {
  const navigate = useNavigate();
  const admin = me.permissions.canCreateClients;
  const cfg: Config<Client> = {
    label: "client", plural: "clients", countLabel: "Companies",
    count: (c) => c.companyCount,
    list: useCallback(() => api.listClients(), []),
    create: admin ? (n) => api.createClient(n) : undefined,
    rename: admin || me.permissions.canCreateCompanies ? (c, n) => api.renameClient(c.id, n) : undefined,
    remove: admin ? (c) => api.deleteClient(c.id) : undefined,
    open: (c) => navigate({ to: "/", search: { tab: "companies", clientId: c.id } }),
    openLabel: "View companies",
  };
  return <EntityTable cfg={cfg} onChanged={onChanged} />;
}

export function CompaniesTable({ me, clientId, onChanged }: { me: Me; clientId?: string; onChanged?: () => void }) {
  const navigate = useNavigate();
  const cfg: Config<Company> = {
    label: "company", plural: "companies", countLabel: "Offices",
    count: (c) => c.officeCount,
    list: useCallback(() => api.listCompanies(clientId), [clientId]),
    create: me.permissions.canCreateCompanies && (clientId || me.actor.clientId) ? (n) => api.createCompany((clientId ?? me.actor.clientId)!, n) : undefined,
    rename: me.permissions.canCreateOffices ? (c, n) => api.renameCompany(c.id, n) : undefined,
    remove: me.permissions.canCreateCompanies ? (c) => api.deleteCompany(c.id) : undefined,
    open: (c) => navigate({ to: "/", search: { tab: "offices", clientId: c.clientId, companyId: c.id } }),
    openLabel: "View offices",
  };
  return <EntityTable cfg={cfg} onChanged={onChanged} />;
}

export function OfficesTable({ me, clientId, companyId, onChanged }: { me: Me; clientId?: string; companyId?: string; onChanged?: () => void }) {
  const navigate = useNavigate();
  const cfg: Config<Office> = {
    label: "office", plural: "offices", countLabel: "Users",
    count: (o) => o.userCount,
    list: useCallback(() => api.listOffices({ companyId, clientId }), [companyId, clientId]),
    create: me.permissions.canCreateOffices && (companyId || me.actor.companyId) ? (n) => api.createOffice((companyId ?? me.actor.companyId)!, n) : undefined,
    rename: me.permissions.canManageUsers ? (o, n) => api.renameOffice(o.id, n) : undefined,
    remove: me.permissions.canCreateOffices ? (o) => api.deleteOffice(o.id) : undefined,
    open: me.permissions.canManageUsers ? (o) => navigate({ to: "/", search: { tab: "users", officeId: o.id } }) : undefined,
    openLabel: "View users",
  };
  return <EntityTable cfg={cfg} onChanged={onChanged} />;
}
