import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { api, ApiError, type Client, type Company, type Office } from "../lib/api";
import { useMe } from "../lib/me";

export interface OrgSearch {
  clientId?: string;
  companyId?: string;
}

type Level = "clients" | "companies" | "offices";

/**
 * Drill-down browser: Clients → Companies → Offices. Users for an office are
 * shown on the Users page filtered by office. Each level offers create /
 * rename / delete according to the actor's permissions.
 */
export function OrgPage({ search }: { search: OrgSearch }) {
  const { me } = useMe();
  const navigate = useNavigate();

  if (!me) return <main className="page center">Loading…</main>;

  // Resolve effective ids: URL params win, else the actor's own scope.
  const clientId = search.clientId ?? me.actor.clientId ?? undefined;
  const companyId = search.companyId ?? me.actor.companyId ?? undefined;

  const level: Level = companyId ? "offices" : clientId ? "companies" : "clients";

  return (
    <main className="page">
      <Breadcrumb clientId={clientId} companyId={companyId} canGoUp={me.scope.level} />
      {level === "clients" && <ClientsLevel canCreate={me.permissions.canCreateClients} onOpen={(id) => navigate({ to: "/org", search: { clientId: id } })} />}
      {level === "companies" && clientId && (
        <CompaniesLevel
          clientId={clientId}
          canCreate={me.permissions.canCreateCompanies}
          canEdit={me.permissions.canCreateOffices}
          onOpen={(id) => navigate({ to: "/org", search: { clientId, companyId: id } })}
        />
      )}
      {level === "offices" && companyId && (
        <OfficesLevel
          companyId={companyId}
          canCreate={me.permissions.canCreateOffices}
          canEdit={me.permissions.canManageUsers}
        />
      )}
    </main>
  );
}

function Breadcrumb({ clientId, companyId, canGoUp }: { clientId?: string; companyId?: string; canGoUp: string }) {
  const [names, setNames] = useState<{ client?: string; company?: string }>({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: { client?: string; company?: string } = {};
      if (companyId) {
        const co = await api.getCompany(companyId).catch(() => null);
        if (co) {
          next.company = co.data.name;
          next.client = co.data.clientName;
        }
      } else if (clientId) {
        const cl = await api.getClient(clientId).catch(() => null);
        if (cl) next.client = cl.data.name;
      }
      if (!cancelled) setNames(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId, companyId]);

  const showRoot = canGoUp === "global";
  const showClient = canGoUp === "global" || canGoUp === "client";

  return (
    <div className="row" style={{ marginBottom: 16 }}>
      {showRoot && (clientId ? <Link to="/org" search={{}}>Clients</Link> : <strong>Clients</strong>)}
      {clientId && showClient && (
        <>
          {showRoot && <span className="muted">›</span>}
          {companyId ? <Link to="/org" search={{ clientId }}>{names.client ?? "…"}</Link> : <strong>{names.client ?? "…"}</strong>}
        </>
      )}
      {companyId && (
        <>
          {showClient && <span className="muted">›</span>}
          <strong>{names.company ?? "…"}</strong>
        </>
      )}
    </div>
  );
}

function useList<T>(loader: () => Promise<{ data: T[] }>) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems((await loader()).data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [loader]);
  useEffect(() => {
    void reload();
  }, [reload]);
  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed");
    }
  };
  return { items, loading, error, reload, run };
}

function CreateForm({ label, onCreate }: { label: string; onCreate: (name: string) => Promise<unknown> }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    await onCreate(name.trim());
    setName("");
    setBusy(false);
  }
  return (
    <form className="row" onSubmit={submit} style={{ marginBottom: 12 }}>
      <input placeholder={`New ${label} name`} required value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1 }} />
      <button className="btn primary" disabled={busy} type="submit">
        Add {label}
      </button>
    </form>
  );
}

function EntityTable<T extends { id: string; name: string }>({
  items,
  loading,
  countLabel,
  count,
  onOpen,
  canEdit,
  canDelete,
  onRename,
  onDelete,
  openLabel,
}: {
  items: T[];
  loading: boolean;
  countLabel: string;
  count: (t: T) => number | undefined;
  onOpen?: (t: T) => void;
  openLabel?: string;
  canEdit: boolean;
  canDelete: boolean;
  onRename: (t: T, name: string) => void;
  onDelete: (t: T) => void;
}) {
  if (loading) return <div className="center">Loading…</div>;
  if (items.length === 0) return <div className="center">Nothing here yet.</div>;
  return (
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>{countLabel}</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {items.map((t) => (
          <tr key={t.id}>
            <td>{onOpen ? <a href="#" onClick={(e) => { e.preventDefault(); onOpen(t); }}>{t.name}</a> : t.name}</td>
            <td className="muted">{count(t) ?? "–"}</td>
            <td>
              <div className="row">
                {onOpen && (
                  <button className="btn sm" onClick={() => onOpen(t)}>
                    {openLabel ?? "Open"}
                  </button>
                )}
                {canEdit && (
                  <button
                    className="btn sm"
                    onClick={() => {
                      const name = prompt("New name", t.name);
                      if (name && name.trim() && name.trim() !== t.name) onRename(t, name.trim());
                    }}
                  >
                    Rename
                  </button>
                )}
                {canDelete && (
                  <button
                    className="btn sm danger"
                    onClick={() => {
                      if (confirm(`Delete "${t.name}" and everything inside it? This cannot be undone.`)) onDelete(t);
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ClientsLevel({ canCreate, onOpen }: { canCreate: boolean; onOpen: (id: string) => void }) {
  const loader = useCallback(() => api.listClients(), []);
  const { items, loading, error, run } = useList<Client>(loader);
  return (
    <>
      <h1>Clients</h1>
      {error && <div className="alert error">{error}</div>}
      {canCreate && <CreateForm label="client" onCreate={(name) => run(() => api.createClient(name))} />}
      <div className="card table-wrap">
        <EntityTable
          items={items}
          loading={loading}
          countLabel="Companies"
          count={(c) => c.companyCount}
          onOpen={(c) => onOpen(c.id)}
          canEdit={canCreate}
          canDelete={canCreate}
          onRename={(c, name) => run(() => api.renameClient(c.id, name))}
          onDelete={(c) => run(() => api.deleteClient(c.id))}
        />
      </div>
    </>
  );
}

function CompaniesLevel({
  clientId,
  canCreate,
  canEdit,
  onOpen,
}: {
  clientId: string;
  canCreate: boolean;
  canEdit: boolean;
  onOpen: (id: string) => void;
}) {
  const loader = useCallback(() => api.listCompanies(clientId), [clientId]);
  const { items, loading, error, run } = useList<Company>(loader);
  return (
    <>
      <h1>Companies</h1>
      {error && <div className="alert error">{error}</div>}
      {canCreate && <CreateForm label="company" onCreate={(name) => run(() => api.createCompany(clientId, name))} />}
      <div className="card table-wrap">
        <EntityTable
          items={items}
          loading={loading}
          countLabel="Offices"
          count={(c) => c.officeCount}
          onOpen={(c) => onOpen(c.id)}
          canEdit={canEdit}
          canDelete={canCreate}
          onRename={(c, name) => run(() => api.renameCompany(c.id, name))}
          onDelete={(c) => run(() => api.deleteCompany(c.id))}
        />
      </div>
    </>
  );
}

function OfficesLevel({ companyId, canCreate, canEdit }: { companyId: string; canCreate: boolean; canEdit: boolean }) {
  const navigate = useNavigate();
  const loader = useCallback(() => api.listOffices({ companyId }), [companyId]);
  const { items, loading, error, run } = useList<Office>(loader);
  return (
    <>
      <h1>Offices</h1>
      {error && <div className="alert error">{error}</div>}
      {canCreate && <CreateForm label="office" onCreate={(name) => run(() => api.createOffice(companyId, name))} />}
      <div className="card table-wrap">
        <EntityTable
          items={items}
          loading={loading}
          countLabel="Users"
          count={(o) => o.userCount}
          onOpen={canEdit ? (o) => navigate({ to: "/users", search: { officeId: o.id } }) : undefined}
          openLabel="View users"
          canEdit={canEdit}
          canDelete={canCreate}
          onRename={(o, name) => run(() => api.renameOffice(o.id, name))}
          onDelete={(o) => run(() => api.deleteOffice(o.id))}
        />
      </div>
    </>
  );
}
