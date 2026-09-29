import { useState, type FormEvent } from "react";
import { CheckCircle2Icon, DatabaseIcon, EyeIcon, EyeOffIcon, LoaderIcon, PlugZapIcon, XCircleIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, ApiError, type OfficeConnector } from "@/lib/api";
import { ConfirmDialog } from "@/components/dashboard/user-dialogs";

export function ConnectorCard({
  officeId,
  connector,
  onChange,
}: {
  officeId: string;
  connector: OfficeConnector | null;
  onChange: (next: OfficeConnector | null) => void;
}) {
  const [editing, setEditing] = useState(connector === null);
  const [url, setUrl] = useState("");
  const [database, setDatabase] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy("save");
    setError(null);
    try {
      const res = await api.saveConnector(officeId, { type: "mongodb", url: url.trim(), database: database.trim() || undefined });
      onChange(res.data);
      setEditing(false);
      setUrl("");
      setDatabase("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save connector");
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy("test");
    setError(null);
    try {
      const res = await api.testConnector(officeId);
      onChange(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Test failed");
      // The API also stores the failure; refresh so the badge reflects it.
      api.getConnector(officeId).then((r) => onChange(r.data)).catch(() => {});
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    setConfirmDisconnect(false);
    setBusy("save");
    try {
      await api.deleteConnector(officeId);
      onChange(null);
      setEditing(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not disconnect");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DatabaseIcon className="size-4" />
          Database connector
        </CardTitle>
        <CardDescription>
          {connector && !editing
            ? "This office's practice database. Connection details are encrypted at rest."
            : "Connect this office to its practice database. The connection string is tested before it is saved and stored encrypted."}
        </CardDescription>
        {connector && !editing && (
          <CardAction>
            <StatusBadge status={connector.status} />
          </CardAction>
        )}
      </CardHeader>

      {connector && !editing ? (
        <>
          <CardContent className="grid gap-3 text-sm">
            <Row label="Type">MongoDB</Row>
            <Row label="Host">{connector.host}</Row>
            <Row label="Database">{connector.database}</Row>
            <Row label="Collections">
              {connector.collections.length === 0
                ? "none found"
                : connector.collections.length <= 6
                  ? connector.collections.join(", ")
                  : `${connector.collections.length} collections (${connector.collections.slice(0, 5).join(", ")}, …)`}
            </Row>
            <Row label="Last tested">{connector.lastTestedAt ? new Date(connector.lastTestedAt).toLocaleString() : "never"}</Row>
            {connector.status === "error" && connector.lastError && (
              <p className="text-destructive text-xs">{connector.lastError}</p>
            )}
            {error && <p className="text-destructive text-xs">{error}</p>}
          </CardContent>
          <CardFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={test} disabled={busy !== null}>
              {busy === "test" ? <LoaderIcon className="animate-spin" /> : <PlugZapIcon />}
              Test connection
            </Button>
            <Button variant="outline" size="sm" onClick={() => { setEditing(true); setError(null); }} disabled={busy !== null}>
              Replace
            </Button>
            <Button variant="ghost" size="sm" className="text-destructive ml-auto" onClick={() => setConfirmDisconnect(true)} disabled={busy !== null}>
              Disconnect
            </Button>
          </CardFooter>
        </>
      ) : (
        <form onSubmit={save}>
          <CardContent className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="conn-type">Type</Label>
              <Select value="mongodb">
                <SelectTrigger id="conn-type" className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="mongodb">MongoDB</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="conn-url">Connection string</Label>
              <div className="flex gap-2">
                <Input
                  id="conn-url"
                  type={show ? "text" : "password"}
                  required
                  autoComplete="off"
                  placeholder="mongodb+srv://user:password@cluster.mongodb.net/clinic"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
                <Button type="button" variant="outline" size="icon" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide" : "Show"}>
                  {show ? <EyeOffIcon /> : <EyeIcon />}
                </Button>
              </div>
              <p className="text-muted-foreground text-xs">Include the database name in the path, or set it below.</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="conn-db">Database name (optional)</Label>
              <Input id="conn-db" className="w-64" placeholder="clinic" value={database} onChange={(e) => setDatabase(e.target.value)} />
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
          </CardContent>
          <CardFooter className="gap-2">
            <Button type="submit" size="sm" disabled={busy !== null || !url.trim()}>
              {busy === "save" ? <LoaderIcon className="animate-spin" /> : <PlugZapIcon />}
              Test and connect
            </Button>
            {connector && (
              <Button type="button" variant="ghost" size="sm" onClick={() => { setEditing(false); setError(null); }}>
                Cancel
              </Button>
            )}
          </CardFooter>
        </form>
      )}

      {confirmDisconnect && (
        <ConfirmDialog
          title="Disconnect database?"
          description="The stored connection string is deleted. Nothing in the external database is touched."
          confirmLabel="Disconnect"
          onClose={() => setConfirmDisconnect(false)}
          onConfirm={disconnect}
        />
      )}
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="break-all">{children}</span>
    </div>
  );
}

export function StatusBadge({ status }: { status: OfficeConnector["status"] }) {
  if (status === "ok")
    return (
      <Badge variant="outline" className="text-muted-foreground px-1.5">
        <CheckCircle2Icon className="fill-green-500 dark:fill-green-400" />
        Connected
      </Badge>
    );
  if (status === "error")
    return (
      <Badge variant="outline" className="text-muted-foreground px-1.5">
        <XCircleIcon className="text-destructive" />
        Error
      </Badge>
    );
  return <Badge variant="outline" className="text-muted-foreground px-1.5">Untested</Badge>;
}
