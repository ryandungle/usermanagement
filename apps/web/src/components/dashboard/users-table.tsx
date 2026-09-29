import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  BanIcon,
  CheckCircle2Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  Columns3Icon,
  LoaderIcon,
  MoreVerticalIcon,
  PlusIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { ROLE_LABEL, canManageUser, type Role } from "@usermanagement/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, ApiError, type ListUsersParams, type ManagedUser, type Me, type Pagination } from "@/lib/api";
import { BanDialog, ConfirmDialog, CreateUserDialog, EditUserDialog, OfficesDialog, PasswordDialog, RoleDialog } from "./user-dialogs";

type ColumnKey = "email" | "role" | "scope" | "status" | "createdAt";
const COLUMNS: { key: ColumnKey; label: string }[] = [
  { key: "email", label: "Email" },
  { key: "role", label: "Role" },
  { key: "scope", label: "Scope" },
  { key: "status", label: "Status" },
  { key: "createdAt", label: "Joined" },
];

type DialogState =
  | { kind: "create" }
  | { kind: "edit"; user: ManagedUser }
  | { kind: "role"; user: ManagedUser }
  | { kind: "offices"; user: ManagedUser }
  | { kind: "password"; user: ManagedUser }
  | { kind: "ban"; user: ManagedUser }
  | { kind: "delete"; user: ManagedUser }
  | null;

export interface UsersTableProps {
  me: Me;
  scope: { clientId?: string; companyId?: string; officeId?: string };
  openCreate?: boolean;
  onCreateHandled?: () => void;
  onChanged?: () => void;
}

export function UsersTable({ me, scope, openCreate, onCreateHandled, onChanged }: UsersTableProps) {
  const [filters, setFilters] = useState<ListUsersParams>({ q: "", role: "", banned: "", page: 1, pageSize: 10 });
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [visible, setVisible] = useState<Set<ColumnKey>>(new Set(COLUMNS.map((c) => c.key)));
  const [dialog, setDialog] = useState<DialogState>(null);

  useEffect(() => {
    if (openCreate) {
      setDialog({ kind: "create" });
      onCreateHandled?.();
    }
  }, [openCreate, onCreateHandled]);

  const params = useMemo(() => ({ ...filters, ...scope }), [filters, scope]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listUsers(params);
      setUsers(res.data);
      setPagination(res.pagination);
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setFilters((f) => ({ ...f, page: 1 }));
  }, [scope.clientId, scope.companyId, scope.officeId]);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed");
    }
  }

  function onSearch(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setFilters((f) => ({ ...f, q: String(fd.get("q") ?? ""), page: 1 }));
  }

  const allSelected = users.length > 0 && users.every((u) => selected.has(u.id));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <form onSubmit={onSearch} className="relative">
          <SearchIcon className="text-muted-foreground absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
          <Input name="q" placeholder="Search name or email" defaultValue={filters.q} className="h-8 w-56 pl-8" />
        </form>
        <Select value={filters.role || "all"} onValueChange={(v) => setFilters((f) => ({ ...f, role: v === "all" ? "" : (v as Role), page: 1 }))}>
          <SelectTrigger size="sm" className="w-40"><SelectValue placeholder="Role" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any role</SelectItem>
            {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.banned || "all"} onValueChange={(v) => setFilters((f) => ({ ...f, banned: v === "all" ? "" : (v as "true" | "false"), page: 1 }))}>
          <SelectTrigger size="sm" className="w-32"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any status</SelectItem>
            <SelectItem value="false">Active</SelectItem>
            <SelectItem value="true">Banned</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Columns3Icon />
                <span className="hidden lg:inline">Customize Columns</span>
                <span className="lg:hidden">Columns</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {COLUMNS.map((c) => (
                <DropdownMenuCheckboxItem
                  key={c.key}
                  checked={visible.has(c.key)}
                  onCheckedChange={(on) =>
                    setVisible((v) => {
                      const next = new Set(v);
                      if (on) next.add(c.key);
                      else next.delete(c.key);
                      return next;
                    })
                  }
                >
                  {c.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" onClick={() => setDialog({ kind: "create" })}>
            <PlusIcon />
            <span className="hidden lg:inline">Add User</span>
          </Button>
        </div>
      </div>

      {error && (
        <div className="text-destructive bg-destructive/10 flex items-center gap-2 rounded-md px-3 py-2 text-sm">
          <XIcon className="size-4" /> {error}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader className="bg-muted sticky top-0 z-10">
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={allSelected ? true : selected.size > 0 ? "indeterminate" : false}
                  onCheckedChange={(on) => setSelected(on ? new Set(users.map((u) => u.id)) : new Set())}
                  aria-label="Select all"
                />
              </TableHead>
              <TableHead>Name</TableHead>
              {visible.has("email") && <TableHead>Email</TableHead>}
              {visible.has("role") && <TableHead>Role</TableHead>}
              {visible.has("scope") && <TableHead>Scope</TableHead>}
              {visible.has("status") && <TableHead>Status</TableHead>}
              {visible.has("createdAt") && <TableHead className="text-right">Joined</TableHead>}
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center">
                  <LoaderIcon className="text-muted-foreground mx-auto size-4 animate-spin" />
                </TableCell>
              </TableRow>
            ) : users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-muted-foreground h-24 text-center">No users match.</TableCell>
              </TableRow>
            ) : (
              users.map((u) => {
                const isMe = u.id === me.actor.id;
                const manageable = canManageUser(me.actor, { id: u.id, role: u.role, clientId: u.clientId, companyId: u.companyId, officeIds: u.offices.map((o) => o.id) });
                return (
                  <TableRow key={u.id} data-state={selected.has(u.id) ? "selected" : undefined}>
                    <TableCell>
                      <Checkbox
                        checked={selected.has(u.id)}
                        onCheckedChange={(on) =>
                          setSelected((s) => {
                            const next = new Set(s);
                            if (on) next.add(u.id);
                            else next.delete(u.id);
                            return next;
                          })
                        }
                        aria-label={`Select ${u.name}`}
                      />
                    </TableCell>
                    <TableCell className="font-medium">
                      {u.name} {isMe && <span className="text-muted-foreground font-normal">(you)</span>}
                    </TableCell>
                    {visible.has("email") && <TableCell className="text-muted-foreground">{u.email}</TableCell>}
                    {visible.has("role") && (
                      <TableCell>
                        <Badge variant="outline" className="text-muted-foreground px-1.5">{ROLE_LABEL[u.role]}</Badge>
                      </TableCell>
                    )}
                    {visible.has("scope") && (
                      <TableCell className="text-muted-foreground">
                        {[u.clientName, u.companyName].filter(Boolean).join(" › ") || "Global"}
                        {u.offices.length > 0 && (
                          <>
                            {" › "}
                            {u.offices.map((o, i) => (
                              <span key={o.id}>
                                {i > 0 && ", "}
                                <Link to="/offices/$officeId" params={{ officeId: o.id }} className="hover:text-foreground underline-offset-4 hover:underline">{o.name}</Link>
                              </span>
                            ))}
                          </>
                        )}
                      </TableCell>
                    )}
                    {visible.has("status") && (
                      <TableCell>
                        {u.banned ? (
                          <Badge variant="outline" className="text-muted-foreground px-1.5" title={u.banReason ?? ""}>
                            <BanIcon className="text-destructive" />
                            Banned{u.banExpires ? ` until ${new Date(u.banExpires).toLocaleDateString()}` : ""}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground px-1.5">
                            <CheckCircle2Icon className="fill-green-500 dark:fill-green-400" />
                            Active
                          </Badge>
                        )}
                      </TableCell>
                    )}
                    {visible.has("createdAt") && (
                      <TableCell className="text-muted-foreground text-right tabular-nums">{new Date(u.createdAt).toLocaleDateString()}</TableCell>
                    )}
                    <TableCell>
                      {manageable && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" className="text-muted-foreground data-[state=open]:bg-muted flex size-8" size="icon">
                              <MoreVerticalIcon />
                              <span className="sr-only">Open menu</span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-40">
                            <DropdownMenuItem onClick={() => setDialog({ kind: "edit", user: u })}>Edit</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setDialog({ kind: "role", user: u })}>Change role</DropdownMenuItem>
                            {(u.role === "user" || u.role === "office_manager") && (
                              <DropdownMenuItem onClick={() => setDialog({ kind: "offices", user: u })}>Offices</DropdownMenuItem>
                            )}
                            <DropdownMenuItem onClick={() => setDialog({ kind: "password", user: u })}>Reset password</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => run(() => api.revokeSessions(u.id))}>Sign out everywhere</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            {u.banned ? (
                              <DropdownMenuItem onClick={() => run(() => api.unbanUser(u.id))}>Unban</DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem onClick={() => setDialog({ kind: "ban", user: u })}>Ban</DropdownMenuItem>
                            )}
                            <DropdownMenuItem variant="destructive" onClick={() => setDialog({ kind: "delete", user: u })}>Delete</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between px-1">
        <div className="text-muted-foreground hidden flex-1 text-sm lg:flex">
          {selected.size} of {users.length} row(s) selected.
        </div>
        <div className="flex w-full items-center gap-8 lg:w-fit">
          <div className="hidden items-center gap-2 lg:flex">
            <Label htmlFor="rows-per-page" className="text-sm font-medium">Rows per page</Label>
            <Select value={String(filters.pageSize)} onValueChange={(v) => setFilters((f) => ({ ...f, pageSize: Number(v), page: 1 }))}>
              <SelectTrigger size="sm" className="w-20" id="rows-per-page"><SelectValue /></SelectTrigger>
              <SelectContent side="top">
                {[10, 20, 50].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex w-fit items-center justify-center text-sm font-medium">
            Page {pagination?.page ?? 1} of {pagination?.totalPages ?? 1}
          </div>
          <div className="ml-auto flex items-center gap-2 lg:ml-0">
            <Button variant="outline" className="hidden h-8 w-8 p-0 lg:flex" disabled={(pagination?.page ?? 1) <= 1} onClick={() => setFilters((f) => ({ ...f, page: 1 }))}>
              <span className="sr-only">First page</span><ChevronsLeftIcon />
            </Button>
            <Button variant="outline" className="size-8" size="icon" disabled={(pagination?.page ?? 1) <= 1} onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) - 1 }))}>
              <span className="sr-only">Previous page</span><ChevronLeftIcon />
            </Button>
            <Button variant="outline" className="size-8" size="icon" disabled={!pagination || pagination.page >= pagination.totalPages} onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) + 1 }))}>
              <span className="sr-only">Next page</span><ChevronRightIcon />
            </Button>
            <Button variant="outline" className="hidden size-8 lg:flex" size="icon" disabled={!pagination || pagination.page >= pagination.totalPages} onClick={() => setFilters((f) => ({ ...f, page: pagination?.totalPages ?? 1 }))}>
              <span className="sr-only">Last page</span><ChevronsRightIcon />
            </Button>
          </div>
        </div>
      </div>

      {dialog?.kind === "create" && (
        <CreateUserDialog me={me} initialScope={{ clientId: scope.clientId, companyId: scope.companyId, officeIds: scope.officeId ? [scope.officeId] : [] }} onClose={() => setDialog(null)} onConfirm={(d) => { setDialog(null); void run(() => api.createUser(d)); }} />
      )}
      {dialog?.kind === "edit" && (
        <EditUserDialog user={dialog.user} onClose={() => setDialog(null)} onConfirm={(d) => { setDialog(null); void run(() => api.updateUser(dialog.user.id, d)); }} />
      )}
      {dialog?.kind === "role" && (
        <RoleDialog me={me} user={dialog.user} onClose={() => setDialog(null)} onConfirm={(d) => { setDialog(null); void run(() => api.setRole(dialog.user.id, d)); }} />
      )}
      {dialog?.kind === "offices" && (
        <OfficesDialog me={me} user={dialog.user} onClose={() => setDialog(null)} onConfirm={(ids) => { setDialog(null); void run(() => api.setOffices(dialog.user.id, ids)); }} />
      )}
      {dialog?.kind === "password" && (
        <PasswordDialog user={dialog.user} onClose={() => setDialog(null)} onConfirm={(p) => { setDialog(null); void run(() => api.setPassword(dialog.user.id, p)); }} />
      )}
      {dialog?.kind === "ban" && (
        <BanDialog user={dialog.user} onClose={() => setDialog(null)} onConfirm={(d) => { setDialog(null); void run(() => api.banUser(dialog.user.id, d)); }} />
      )}
      {dialog?.kind === "delete" && (
        <ConfirmDialog
          title={`Delete ${dialog.user.name}?`}
          description={`${dialog.user.email} will be removed permanently. This cannot be undone.`}
          confirmLabel="Delete user"
          onClose={() => setDialog(null)}
          onConfirm={() => { setDialog(null); void run(() => api.deleteUser(dialog.user.id)); }}
        />
      )}
    </div>
  );
}

