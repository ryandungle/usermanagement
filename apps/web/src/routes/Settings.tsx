import { useEffect, useState, type FormEvent } from "react";
import { ROLE_LABEL } from "@usermanagement/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SiteHeader } from "@/components/site-header";
import { authClient, useSession } from "@/lib/auth-client";
import { api, ApiError } from "@/lib/api";
import { useMe } from "@/lib/me";

export function SettingsPage() {
  const { data: session, refetch } = useSession();
  const { me } = useMe();
  const user = session?.user;
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) setName(user.name);
  }, [user]);

  if (!user) return null;

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

  const scopeParts = me ? [me.scope.clientName, me.scope.companyName, me.scope.offices.map((o) => o.name).join(", ") || null].filter(Boolean) : [];

  return (
    <>
      <SiteHeader title="Settings" />
      <div className="flex flex-col gap-6 p-4 lg:p-6">
        <Card className="max-w-xl">
          <form onSubmit={save}>
            <CardHeader>
              <CardTitle>Account</CardTitle>
              <CardDescription>Member since {new Date(user.createdAt).toLocaleDateString()}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 pt-4">
              {msg && <p className={msg.kind === "error" ? "text-destructive text-sm" : "text-muted-foreground text-sm"}>{msg.text}</p>}
              <div className="grid gap-2"><Label>Email</Label><Input value={user.email} disabled /></div>
              <div className="grid gap-2"><Label>Role</Label><Input value={me ? ROLE_LABEL[me.actor.role] : "…"} disabled /></div>
              <div className="grid gap-2"><Label>Scope</Label><Input value={scopeParts.length ? scopeParts.join(" › ") : "Global"} disabled /></div>
              <div className="grid gap-2"><Label htmlFor="name">Name</Label><Input id="name" required value={name} onChange={(e) => setName(e.target.value)} /></div>
            </CardContent>
            <CardFooter className="gap-2 pt-4">
              <Button type="submit" disabled={busy}>Save</Button>
              <Button type="button" variant="outline" onClick={signOutEverywhere}>Sign out other devices</Button>
            </CardFooter>
          </form>
        </Card>
      </div>
    </>
  );
}
