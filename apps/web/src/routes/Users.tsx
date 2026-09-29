import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ROLE_LABEL, canManageUser, type Role } from "@usermanagement/shared";
import { api, ApiError, type CreateUserInput, type ListUsersParams, type ManagedUser, type Me, type Pagination } from "../lib/api";
import { useMe } from "../lib/me";
import { Dialog } from "../components/Dialog";
import { ScopePicker, type PickedScope } from "../components/ScopePicker";

const PAGE_SIZE = 20;

export interface UsersSearch {
  clientId?: string;
  companyId?: string;
  officeId?: string;
}

export function UsersPage({ search }: { search: UsersSearch }) {
  const { me, refresh } = useMe();

  const [filters, setFilters] = useState<ListUsersParams>({ q: "", role: "", banned: "", page: 1, ...search });
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<
    | { kind: "create" }
    | { kind: "edit"; user: ManagedUser }
    | { kind: "role"; user: ManagedUser }
    | { kind: "password"; user: ManagedUser }
    | { kind: "ban"; user: ManagedUser }
    | null
  >(null);

  useEffect(() => {
    setFilters((f) => ({ ...f, ...search, page: 1 }));
  }, [search.clientId, search.companyId, search.officeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listUsers({ ...filters, pageSize: PAGE_SIZE });
      setUsers(res.data);
      setPagination(res.pagination);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await load();
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed");
    }
  }

  function onSearch(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setFilters((f) => ({
      ...f,
      q: String(fd.get("q") ?? ""),
      role: (fd.get("role") as ListUsersParams["role"]) ?? "",
      banned: (fd.get("banned") as ListUsersParams["banned"]) ?? "",
      page: 1,
    }));
  }

  if (!me) return <main className="page center">Loading…</main>;

  const scopeLabel = [filters.officeId && "office", filters.companyId && "company", filters.clientId && "client"].filter(Boolean)[0];

  return (
    <main className="page">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>
          Users {scopeLabel && <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>(filtered by {scopeLabel})</span>}
        </h1>
        <div className="row">
          {scopeLabel && (
            <button className="btn sm" onClick={() => setFilters((f) => ({ ...f, clientId: undefined, companyId: undefined, officeId: undefined, page: 1 }))}>
              Clear scope filter
            </button>
          )}
          <button className="btn primary" onClick={() => setDialog({ kind: "create" })}>
            New user
          </button>
        </div>
      </div>

      <form className="toolbar" onSubmit={onSearch}>
        <input name="q" placeholder="Search name or email" defaultValue={filters.q} />
        <select name="role" defaultValue={filters.role}>
          <option value="">Any role</option>
          {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
            <option key={r} value={r}>{ROLE_LABEL[r]}</option>
          ))}
        </select>
        <select name="banned" defaultValue={filters.banned}>
          <option value="">Any status</option>
          <option value="false">Active</option>
          <option value="true">Banned</option>
        </select>
        <button className="btn" type="submit">
          Filter
        </button>
      </form>

      {error && <div className="alert error">{error}</div>}

      <div className="card table-wrap">
        {loading ? (
          <div className="center">Loading…</div>
        ) : users.length === 0 ? (
          <div className="center">No users match.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Scope</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isMe = u.id === me.actor.id;
                const manageable = canManageUser(me.actor, {
                  id: u.id,
                  role: u.role,
                  clientId: u.clientId,
                  companyId: u.companyId,
                  officeId: u.officeId,
                });
                return (
                  <tr key={u.id}>
                    <td>
                      {u.name} {isMe && <span className="muted">(you)</span>}
                    </td>
                    <td>{u.email}</td>
                    <td>
                      <span className={`badge ${u.role === "app_admin" ? "admin" : ""}`}>{ROLE_LABEL[u.role]}</span>
                    </td>
                    <td className="muted">{scopeText(u)}</td>
                    <td>
                      {u.banned ? (
                        <span className="badge banned" title={u.banReason ?? ""}>
                          banned{u.banExpires ? ` until ${new Date(u.banExpires).toLocaleDateString()}` : ""}
                        </span>
                      ) : (
                        <span className="badge ok">active</span>
                      )}
                    </td>
                    <td>
                      {manageable && (
                        <div className="row">
                          <button className="btn sm" onClick={() => setDialog({ kind: "edit", user: u })}>Edit</button>
                          <button className="btn sm" onClick={() => setDialog({ kind: "role", user: u })}>Role</button>
                          <button className="btn sm" onClick={() => setDialog({ kind: "password", user: u })}>Password</button>
                          {u.banned ? (
                            <button className="btn sm" onClick={() => run(() => api.unbanUser(u.id))}>Unban</button>
                          ) : (
                            <button className="btn sm" onClick={() => setDialog({ kind: "ban", user: u })}>Ban</button>
                          )}
                          <button className="btn sm" onClick={() => run(() => api.revokeSessions(u.id))}>Sign out</button>
                          <button
                            className="btn sm danger"
                            onClick={() => {
                              if (confirm(`Delete ${u.email}? This cannot be undone.`)) void run(() => api.deleteUser(u.id));
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {pagination && (
        <div className="pager">
          <span>
            {pagination.total} user{pagination.total === 1 ? "" : "s"} · page {pagination.page} of {pagination.totalPages}
          </span>
          <div className="row">
            <button className="btn sm" disabled={pagination.page <= 1} onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) - 1 }))}>
              Previous
            </button>
            <button className="btn sm" disabled={pagination.page >= pagination.totalPages} onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) + 1 }))}>
              Next
            </button>
          </div>
        </div>
      )}

      {dialog?.kind === "create" && (
        <CreateUserDialog
          me={me}
          initialScope={{ clientId: filters.clientId, companyId: filters.companyId, officeId: filters.officeId }}
          onClose={() => setDialog(null)}
          onConfirm={(data) => {
            setDialog(null);
            void run(() => api.createUser(data));
          }}
        />
      )}
      {dialog?.kind === "edit" && (
        <EditDialog
          user={dialog.user}
          onClose={() => setDialog(null)}
          onConfirm={(data) => {
            setDialog(null);
            void run(() => api.updateUser(dialog.user.id, data));
          }}
        />
      )}
      {dialog?.kind === "role" && (
        <RoleDialog
          me={me}
          user={dialog.user}
          onClose={() => setDialog(null)}
          onConfirm={(data) => {
            setDialog(null);
            void run(() => api.setRole(dialog.user.id, data));
          }}
        />
      )}
      {dialog?.kind === "password" && (
        <PasswordDialog
          user={dialog.user}
          onClose={() => setDialog(null)}
          onConfirm={(password) => {
            setDialog(null);
            void run(() => api.setPassword(dialog.user.id, password));
          }}
        />
      )}
      {dialog?.kind === "ban" && (
        <BanDialog
          user={dialog.user}
          onClose={() => setDialog(null)}
          onConfirm={(data) => {
            setDialog(null);
            void run(() => api.banUser(dialog.user.id, data));
          }}
        />
      )}
    </main>
  );
}

function scopeText(u: ManagedUser) {
  const parts = [u.clientName, u.companyName, u.officeName].filter(Boolean);
  return parts.length ? parts.join(" › ") : "Global";
}

function CreateUserDialog({
  me,
  initialScope,
  onClose,
  onConfirm,
}: {
  me: Me;
  initialScope: PickedScope;
  onClose: () => void;
  onConfirm: (data: CreateUserInput) => void;
}) {
  const roles = me.permissions.assignableRoles;
  const [role, setRole] = useState<Role>(roles[0] ?? "user");
  const [scope, setScope] = useState<PickedScope>(initialScope);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    onConfirm({ name: name.trim(), email: email.trim(), password, role, ...scope });
  }

  return (
    <Dialog title="New user" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="c-role">Role</label>
          <select id="c-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {roles.map((r) => (
              <option key={r} value={r}>{ROLE_LABEL[r]}</option>
            ))}
          </select>
        </div>
        <ScopePicker me={me} role={role} value={scope} onChange={setScope} />
        <div className="field">
          <label htmlFor="c-name">Name</label>
          <input id="c-name" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="c-email">Email</label>
          <input id="c-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="c-password">Temporary password (min 8 characters)</label>
          <input id="c-password" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div className="row">
          <button className="btn primary" type="submit">Create</button>
          <button className="btn" type="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Dialog>
  );
}

function RoleDialog({
  me,
  user,
  onClose,
  onConfirm,
}: {
  me: Me;
  user: ManagedUser;
  onClose: () => void;
  onConfirm: (data: { role: Role } & PickedScope) => void;
}) {
  const roles = me.permissions.assignableRoles;
  const [role, setRole] = useState<Role>(roles.includes(user.role) ? user.role : roles[0] ?? "user");
  const [scope, setScope] = useState<PickedScope>({
    clientId: user.clientId ?? undefined,
    companyId: user.companyId ?? undefined,
    officeId: user.officeId ?? undefined,
  });

  return (
    <Dialog title={`Change role for ${user.email}`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onConfirm({ role, ...scope });
        }}
      >
        <div className="field">
          <label htmlFor="r-role">Role</label>
          <select id="r-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {roles.map((r) => (
              <option key={r} value={r}>{ROLE_LABEL[r]}</option>
            ))}
          </select>
        </div>
        <ScopePicker me={me} role={role} value={scope} onChange={setScope} />
        <p className="muted">Changing the role signs the user out of all devices.</p>
        <div className="row">
          <button className="btn primary" type="submit">Save</button>
          <button className="btn" type="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Dialog>
  );
}

function EditDialog({ user, onClose, onConfirm }: { user: ManagedUser; onClose: () => void; onConfirm: (d: { name?: string; email?: string }) => void }) {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  return (
    <Dialog title="Edit user" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const data: { name?: string; email?: string } = {};
          if (name.trim() && name.trim() !== user.name) data.name = name.trim();
          if (email.trim() && email.trim() !== user.email) data.email = email.trim();
          if (Object.keys(data).length === 0) return onClose();
          onConfirm(data);
        }}
      >
        <div className="field">
          <label htmlFor="e-name">Name</label>
          <input id="e-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="e-email">Email</label>
          <input id="e-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="row">
          <button className="btn primary" type="submit">Save</button>
          <button className="btn" type="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Dialog>
  );
}

function PasswordDialog({ user, onClose, onConfirm }: { user: ManagedUser; onClose: () => void; onConfirm: (password: string) => void }) {
  const [password, setPassword] = useState("");
  return (
    <Dialog title={`Reset password for ${user.email}`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onConfirm(password);
        }}
      >
        <div className="field">
          <label htmlFor="p-password">New password (min 8 characters)</label>
          <input id="p-password" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <p className="muted">The user is signed out of all devices.</p>
        <div className="row">
          <button className="btn primary" type="submit">Set password</button>
          <button className="btn" type="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Dialog>
  );
}

function BanDialog({ user, onClose, onConfirm }: { user: ManagedUser; onClose: () => void; onConfirm: (d: { reason?: string; expiresIn?: number }) => void }) {
  const [reason, setReason] = useState("");
  const [days, setDays] = useState("");
  return (
    <Dialog title={`Ban ${user.email}`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onConfirm({ reason: reason.trim() || undefined, expiresIn: days ? Number(days) * 86400 : undefined });
        }}
      >
        <div className="field">
          <label htmlFor="b-reason">Reason (optional)</label>
          <input id="b-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="b-days">Duration in days (blank = permanent)</label>
          <input id="b-days" type="number" min={1} value={days} onChange={(e) => setDays(e.target.value)} />
        </div>
        <div className="row">
          <button className="btn danger" type="submit">Ban user</button>
          <button className="btn" type="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Dialog>
  );
}
