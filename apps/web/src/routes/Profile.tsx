import { useEffect, useState, type FormEvent } from "react";
import { authClient, useSession } from "../lib/auth-client";
import { api, ApiError } from "../lib/api";

export function ProfilePage() {
  const { data: session, refetch } = useSession();
  const user = session?.user;
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) setName(user.name);
  }, [user]);

  if (!user) return <main className="page center">Loading…</main>;

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api.updateMe({ name });
      await refetch();
      setMsg({ kind: "ok", text: "Profile updated." });
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof ApiError ? err.message : "Update failed" });
    } finally {
      setBusy(false);
    }
  }

  async function signOutEverywhere() {
    await authClient.revokeOtherSessions();
    setMsg({ kind: "ok", text: "Signed out of all other devices." });
  }

  return (
    <main className="page narrow">
      <h1>Your profile</h1>
      <form className="card" onSubmit={save}>
        {msg && <div className={`alert ${msg.kind}`}>{msg.text}</div>}
        <div className="field">
          <label>Email</label>
          <input value={user.email} disabled />
        </div>
        <div className="field">
          <label>Role</label>
          <input value={user.role ?? "user"} disabled />
        </div>
        <div className="field">
          <label htmlFor="name">Name</label>
          <input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="row">
          <button className="btn primary" disabled={busy} type="submit">
            Save
          </button>
          <button className="btn" type="button" onClick={signOutEverywhere}>
            Sign out other devices
          </button>
        </div>
      </form>
      <p className="muted">
        Member since {new Date(user.createdAt).toLocaleDateString()}
      </p>
    </main>
  );
}
