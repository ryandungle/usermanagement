import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useSession } from "../lib/auth-client";
import { api, ApiError, type ListUsersParams, type ManagedUser, type Pagination } from "../lib/api";

const PAGE_SIZE = 20;

export function UsersPage() {
  const { data: session } = useSession();
  const me = session?.user;

  const [filters, setFilters] = useState<ListUsersParams>({ q: "", role: "", banned: "", page: 1 });
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banTarget, setBanTarget] = useState<ManagedUser | null>(null);
  const [editTarget, setEditTarget] = useState<ManagedUser | null>(null);

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
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed");
    }
  }

  function onSearch(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setFilters({
      q: String(fd.get("q") ?? ""),
      role: (fd.get("role") as ListUsersParams["role"]) ?? "",
      banned: (fd.get("banned") as ListUsersParams["banned"]) ?? "",
      page: 1,
    });
  }

  return (
    <main className="page">
      <h1>Users</h1>

      <form className="toolbar" onSubmit={onSearch}>
        <input name="q" placeholder="Search name or email" defaultValue={filters.q} />
        <select name="role" defaultValue={filters.role}>
          <option value="">Any role</option>
          <option value="user">User</option>
          <option value="admin">Admin</option>
        </select>
        <select name="banned" defaultValue={filters.banned}>
          <option value="">Any status</option>
          <option value="false">Active</option>
          <option value="true">Banned</option>
        </select>
        <button className="btn primary" type="submit">
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
                <th>Status</th>
                <th>Joined</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isMe = u.id === me?.id;
                return (
                  <tr key={u.id}>
                    <td>
                      {u.name} {isMe && <span className="muted">(you)</span>}
                    </td>
                    <td>{u.email}</td>
                    <td>
                      <span className={`badge ${u.role}`}>{u.role}</span>
                    </td>
                    <td>
                      {u.banned ? (
                        <span className="badge banned" title={u.banReason ?? ""}>
                          banned{u.banExpires ? ` until ${new Date(u.banExpires).toLocaleDateString()}` : ""}
                        </span>
                      ) : (
                        <span className="badge ok">active</span>
                      )}
                    </td>
                    <td className="muted">{new Date(u.createdAt).toLocaleDateString()}</td>
                    <td>
                      <div className="row">
                        <button className="btn sm" onClick={() => setEditTarget(u)}>
                          Edit
                        </button>
                        <button
                          className="btn sm"
                          disabled={isMe}
                          onClick={() => run(() => api.setRole(u.id, u.role === "admin" ? "user" : "admin"))}
                        >
                          {u.role === "admin" ? "Demote" : "Make admin"}
                        </button>
                        {u.banned ? (
                          <button className="btn sm" onClick={() => run(() => api.unbanUser(u.id))}>
                            Unban
                          </button>
                        ) : (
                          <button className="btn sm" disabled={isMe} onClick={() => setBanTarget(u)}>
                            Ban
                          </button>
                        )}
                        <button className="btn sm" onClick={() => run(() => api.revokeSessions(u.id))}>
                          Sign out
                        </button>
                        <button
                          className="btn sm danger"
                          disabled={isMe}
                          onClick={() => {
                            if (confirm(`Delete ${u.email}? This cannot be undone.`)) {
                              void run(() => api.deleteUser(u.id));
                            }
                          }}
                        >
                          Delete
                        </button>
                      </div>
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
            <button
              className="btn sm"
              disabled={pagination.page <= 1}
              onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) - 1 }))}
            >
              Previous
            </button>
            <button
              className="btn sm"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) + 1 }))}
            >
              Next
            </button>
          </div>
        </div>
      )}

      {banTarget && (
        <BanDialog
          user={banTarget}
          onClose={() => setBanTarget(null)}
          onConfirm={(data) => {
            setBanTarget(null);
            void run(() => api.banUser(banTarget.id, data));
          }}
        />
      )}
      {editTarget && (
        <EditDialog
          user={editTarget}
          onClose={() => setEditTarget(null)}
          onConfirm={(data) => {
            setEditTarget(null);
            void run(() => api.updateUser(editTarget.id, data));
          }}
        />
      )}
    </main>
  );
}

function useDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return ref;
}

function BanDialog({
  user,
  onClose,
  onConfirm,
}: {
  user: ManagedUser;
  onClose: () => void;
  onConfirm: (data: { reason?: string; expiresIn?: number }) => void;
}) {
  const ref = useDialog();
  const [reason, setReason] = useState("");
  const [days, setDays] = useState("");

  return (
    <dialog ref={ref} onClose={onClose}>
      <h2>Ban {user.email}</h2>
      <div className="field">
        <label htmlFor="reason">Reason (optional)</label>
        <input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="days">Duration in days (blank = permanent)</label>
        <input id="days" type="number" min={1} value={days} onChange={(e) => setDays(e.target.value)} />
      </div>
      <div className="row">
        <button
          className="btn danger"
          onClick={() =>
            onConfirm({
              reason: reason.trim() || undefined,
              expiresIn: days ? Number(days) * 86400 : undefined,
            })
          }
        >
          Ban user
        </button>
        <button className="btn" onClick={() => ref.current?.close()}>
          Cancel
        </button>
      </div>
    </dialog>
  );
}

function EditDialog({
  user,
  onClose,
  onConfirm,
}: {
  user: ManagedUser;
  onClose: () => void;
  onConfirm: (data: { name?: string; email?: string }) => void;
}) {
  const ref = useDialog();
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);

  return (
    <dialog ref={ref} onClose={onClose}>
      <h2>Edit user</h2>
      <div className="field">
        <label htmlFor="edit-name">Name</label>
        <input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="edit-email">Email</label>
        <input id="edit-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="row">
        <button
          className="btn primary"
          onClick={() => {
            const data: { name?: string; email?: string } = {};
            if (name.trim() && name.trim() !== user.name) data.name = name.trim();
            if (email.trim() && email.trim() !== user.email) data.email = email.trim();
            if (Object.keys(data).length === 0) return ref.current?.close();
            onConfirm(data);
          }}
        >
          Save
        </button>
        <button className="btn" onClick={() => ref.current?.close()}>
          Cancel
        </button>
      </div>
    </dialog>
  );
}
