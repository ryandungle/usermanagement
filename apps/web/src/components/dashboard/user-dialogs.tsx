import { useState, type FormEvent } from "react";
import { ROLE_LABEL, type Role } from "@usermanagement/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScopePicker, type PickedScope } from "@/components/scope-picker";
import type { CreateUserInput, ManagedUser, Me } from "@/lib/api";

function Frame({ title, description, onClose, onSubmit, submitLabel, destructive, children }: {
  title: string;
  description?: string;
  onClose: () => void;
  onSubmit: (e: FormEvent) => void;
  submitLabel: string;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          {children}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant={destructive ? "destructive" : "default"}>{submitLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RoleSelect({ roles, value, onChange }: { roles: Role[]; value: Role; onChange: (r: Role) => void }) {
  return (
    <div className="grid gap-2">
      <Label>Role</Label>
      <Select value={value} onValueChange={(v) => onChange(v as Role)}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>{roles.map((r) => <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}

export function CreateUserDialog({ me, initialScope, onClose, onConfirm }: { me: Me; initialScope: PickedScope; onClose: () => void; onConfirm: (d: CreateUserInput) => void }) {
  const roles = me.permissions.assignableRoles;
  const [role, setRole] = useState<Role>(roles[0] ?? "user");
  const [scope, setScope] = useState<PickedScope>(initialScope);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  return (
    <Frame title="New user" description="The user signs in with this email and temporary password." onClose={onClose} submitLabel="Create user"
      onSubmit={(e) => { e.preventDefault(); onConfirm({ name: name.trim(), email: email.trim(), password, role, ...scope }); }}>
      <RoleSelect roles={roles} value={role} onChange={setRole} />
      <ScopePicker me={me} role={role} value={scope} onChange={setScope} />
      <div className="grid gap-2"><Label htmlFor="c-name">Name</Label><Input id="c-name" required value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="grid gap-2"><Label htmlFor="c-email">Email</Label><Input id="c-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      <div className="grid gap-2"><Label htmlFor="c-password">Temporary password</Label><Input id="c-password" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} /></div>
    </Frame>
  );
}

export function EditUserDialog({ user, onClose, onConfirm }: { user: ManagedUser; onClose: () => void; onConfirm: (d: { name?: string; email?: string }) => void }) {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  return (
    <Frame title="Edit user" onClose={onClose} submitLabel="Save"
      onSubmit={(e) => {
        e.preventDefault();
        const d: { name?: string; email?: string } = {};
        if (name.trim() && name.trim() !== user.name) d.name = name.trim();
        if (email.trim() && email.trim() !== user.email) d.email = email.trim();
        if (Object.keys(d).length === 0) return onClose();
        onConfirm(d);
      }}>
      <div className="grid gap-2"><Label htmlFor="e-name">Name</Label><Input id="e-name" value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="grid gap-2"><Label htmlFor="e-email">Email</Label><Input id="e-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
    </Frame>
  );
}

export function RoleDialog({ me, user, onClose, onConfirm }: { me: Me; user: ManagedUser; onClose: () => void; onConfirm: (d: { role: Role } & PickedScope) => void }) {
  const roles = me.permissions.assignableRoles;
  const [role, setRole] = useState<Role>(roles.includes(user.role) ? user.role : (roles[0] ?? "user"));
  const [scope, setScope] = useState<PickedScope>({ clientId: user.clientId ?? undefined, companyId: user.companyId ?? undefined, officeIds: user.offices.map((o) => o.id) });
  return (
    <Frame title={`Change role for ${user.name}`} description="Changing the role signs the user out of all devices." onClose={onClose} submitLabel="Save"
      onSubmit={(e) => { e.preventDefault(); onConfirm({ role, ...scope }); }}>
      <RoleSelect roles={roles} value={role} onChange={setRole} />
      <ScopePicker me={me} role={role} value={scope} onChange={setScope} />
    </Frame>
  );
}

/** Change office memberships for an office-level user without changing their role. */
export function OfficesDialog({ me, user, onClose, onConfirm }: { me: Me; user: ManagedUser; onClose: () => void; onConfirm: (officeIds: string[]) => void }) {
  const [scope, setScope] = useState<PickedScope>({ clientId: user.clientId ?? undefined, companyId: user.companyId ?? undefined, officeIds: user.offices.map((o) => o.id) });
  return (
    <Frame title={`Offices for ${user.name}`} description={`Locations of ${user.companyName ?? "their company"} this person works at.`} onClose={onClose} submitLabel="Save"
      onSubmit={(e) => { e.preventDefault(); if (scope.officeIds?.length) onConfirm(scope.officeIds); }}>
      <ScopePicker me={me} role={user.role} value={scope} onChange={setScope} lockCompany />
    </Frame>
  );
}

export function PasswordDialog({ user, onClose, onConfirm }: { user: ManagedUser; onClose: () => void; onConfirm: (password: string) => void }) {
  const [password, setPassword] = useState("");
  return (
    <Frame title={`Reset password for ${user.name}`} description="The user is signed out of all devices." onClose={onClose} submitLabel="Set password"
      onSubmit={(e) => { e.preventDefault(); onConfirm(password); }}>
      <div className="grid gap-2"><Label htmlFor="p-password">New password</Label><Input id="p-password" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} /></div>
    </Frame>
  );
}

export function BanDialog({ user, onClose, onConfirm }: { user: ManagedUser; onClose: () => void; onConfirm: (d: { reason?: string; expiresIn?: number }) => void }) {
  const [reason, setReason] = useState("");
  const [days, setDays] = useState("");
  return (
    <Frame title={`Ban ${user.name}`} description="They are signed out immediately and cannot sign in until unbanned." onClose={onClose} submitLabel="Ban user" destructive
      onSubmit={(e) => { e.preventDefault(); onConfirm({ reason: reason.trim() || undefined, expiresIn: days ? Number(days) * 86400 : undefined }); }}>
      <div className="grid gap-2"><Label htmlFor="b-reason">Reason (optional)</Label><Input id="b-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      <div className="grid gap-2"><Label htmlFor="b-days">Duration in days (blank = permanent)</Label><Input id="b-days" type="number" min={1} value={days} onChange={(e) => setDays(e.target.value)} /></div>
    </Frame>
  );
}

export function ConfirmDialog({ title, description, confirmLabel, onClose, onConfirm }: { title: string; description: string; confirmLabel: string; onClose: () => void; onConfirm: () => void }) {
  return (
    <Frame title={title} description={description} onClose={onClose} submitLabel={confirmLabel} destructive onSubmit={(e) => { e.preventDefault(); onConfirm(); }}>
      <div />
    </Frame>
  );
}
