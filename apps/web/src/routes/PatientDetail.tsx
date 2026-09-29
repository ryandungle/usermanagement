import React, { useMemo, useState } from "react";
import { PMS_LABEL } from "@usermanagement/shared";
import { Link } from "@tanstack/react-router";
import { AlertTriangleIcon, ArrowLeftIcon, CalendarIcon, ShieldCheckIcon, CheckCircle2Icon, CircleDashedIcon, CircleIcon, CreditCardIcon, LoaderIcon, MailIcon, MapPinIcon, PhoneIcon, StethoscopeIcon, UsersIcon, ChevronRightIcon, FileTextIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SiteHeader } from "@/components/site-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useQuery } from "@tanstack/react-query";
import { SortHead } from "@/components/sort-head";
import { api, errorMessage, type AllocationLink, type Claim, type FamilySummary, type LedgerLine, type PaidStatus, type PatientDetail, type Visit } from "@/lib/api";
import { ageFrom, dateLabel, fullName, money } from "@/lib/format";
import { useMe } from "@/lib/me";
import { rememberedPatientsSearch } from "./Patients";

export function PatientDetailPage({ officeId, patientId }: { officeId: string; patientId: string }) {
  const { me } = useMe();
  const [statusFilter, setStatusFilter] = useState<"all" | PaidStatus>("all");
  const detailQuery = useQuery({ queryKey: ["patient", officeId, patientId], queryFn: ({ signal }) => api.getPatient(officeId, patientId, signal) });
  const detail: PatientDetail | null = detailQuery.data?.data ?? null;
  const error = detailQuery.error ? errorMessage(detailQuery.error, "Could not load patient") : null;
  const filteredTreatments = useMemo(
    () => (detail ? detail.treatments.filter((t) => statusFilter === "all" || t.payment?.status === statusFilter) : []),
    [detail, statusFilter],
  );

  const familyAvailable = detail?.familyAvailable ?? false;
  const familyQuery = useQuery({ queryKey: ["family", officeId, patientId], queryFn: ({ signal }) => api.getFamily(officeId, patientId, signal), enabled: familyAvailable });
  const family: FamilySummary | null = familyQuery.data?.data ?? null;
  const familyError = familyQuery.error ? errorMessage(familyQuery.error, "Could not load family") : null;

  if (!me) return null;

  const backLink = (
    <Button asChild variant="ghost" size="sm">
      <Link to="/offices/$officeId/patients" params={{ officeId }} search={rememberedPatientsSearch(officeId)}><ArrowLeftIcon /> Patients</Link>
    </Button>
  );

  if (error) {
    return (
      <>
        <SiteHeader title="Patient">{backLink}</SiteHeader>
        <div className="text-destructive p-6 text-sm">{error}</div>
      </>
    );
  }
  if (!detail) {
    return (
      <>
        <SiteHeader title="Patient">{backLink}</SiteHeader>
        <div className="text-muted-foreground flex items-center gap-2 p-6 text-sm"><LoaderIcon className="size-4 animate-spin" /> Loading patient…</div>
      </>
    );
  }

  const { summary: p, totals, visits, payments, patient } = detail;
  const unapplied = payments.filter((l) => (l.applied?.unallocated ?? 0) > 0.005);
  const openClaims = detail.claims.filter((c) => c.status === "sent" || c.status === "unsent").length;
  const age = ageFrom(p.birthDate);
  const address = [patient.addressLine1, patient.addressLine2, [p.city, p.state].filter(Boolean).join(", "), patient.zip]
    .filter((x): x is string => typeof x === "string" && x.trim() !== "")
    .join(", ");
  const preferredProvider = p.preferredProviderId ? detail.providers[p.preferredProviderId] ?? p.preferredProviderId : null;

  return (
    <>
      <SiteHeader title={fullName(p)}>{backLink}</SiteHeader>
      <div className="flex flex-col gap-4 p-4 md:gap-6 lg:p-6">
        {/* Identity */}
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-xl">
              {fullName(p)}
              <Badge variant="outline" className="text-muted-foreground px-1.5">{p.active ? "Active" : "Inactive"}</Badge>
              <span className="text-muted-foreground font-mono text-xs font-normal">#{p.patientId}</span>
            </CardTitle>
            <CardDescription>
              {[p.birthDate ? `Born ${dateLabel(p.birthDate)}${age !== null ? ` (${age})` : ""}` : null, p.sex ? `Sex ${p.sex}` : null, preferredProvider ? `Preferred provider ${preferredProvider}` : null]
                .filter(Boolean)
                .join(" · ")}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-muted-foreground grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Fact icon={PhoneIcon} label="Cell" value={p.cellPhone} />
            <Fact icon={PhoneIcon} label="Home" value={p.homePhone} />
            <Fact icon={MailIcon} label="Email" value={p.email} />
            <Fact icon={MapPinIcon} label="Address" value={address || null} />
            <Fact
              icon={ShieldCheckIcon}
              label="Coverage"
              value={p.coverage.kind === "self-pay" ? "Self-pay" : [p.coverage.label, p.coverage.primary?.groupNo ? `group ${p.coverage.primary.groupNo}` : null, p.coverage.secondary ? `secondary ${p.coverage.secondary.carrier}` : null].filter(Boolean).join(" · ")}
            />
            <Fact icon={CalendarIcon} label="First visit" value={dateLabel(typeof patient.firstVisitDate === "string" ? patient.firstVisitDate : null) || null} />
            <Fact icon={CalendarIcon} label="Last visit" value={dateLabel(p.lastVisitDate) || null} />
          </CardContent>
        </Card>

        {/* Totals */}
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(10.5rem,1fr))]">
          <Stat label="Treatments performed" value={String(totals.procedures)} sub={`over ${totals.visits} visit${totals.visits === 1 ? "" : "s"} · ${money(totals.charges)}`} />
          <Stat label="Paid in full" value={String(totals.paid)} sub="charge fully covered" tone="good" />
          <Stat label="Partially paid" value={String(totals.partial)} sub="some money applied" tone={totals.partial ? "warn" : undefined} />
          <Stat label="Unpaid" value={String(totals.unpaid)} sub="nothing applied yet" tone={totals.unpaid ? "bad" : undefined} />
          <Stat
            label="Payments"
            value={money(totals.payments)}
            sub={`${money(payments.filter((p) => p.source === "insurance").reduce((s, p) => s - p.amount, 0))} insurance · ${money(payments.filter((p) => p.source !== "insurance").reduce((s, p) => s - p.amount, 0))} patient${totals.unallocatedPayments ? ` · ${money(totals.unallocatedPayments)} patient credit` : ""}`}
          />
          <Stat label="Patient credit" value={money(totals.unallocatedPayments)} sub={unapplied.length ? `${unapplied.length} payment${unapplied.length === 1 ? "" : "s"} not applied to a charge` : "all patient payments applied"} tone={totals.unallocatedPayments > 0 ? "warn" : undefined} />
          {(totals.insuranceOver ?? 0) > 0.005 && (
            <Stat label="Insurance over fee" value={money(totals.insuranceOver ?? 0)} sub={`on ${totals.insuranceOverCount ?? 0} procedure${totals.insuranceOverCount === 1 ? "" : "s"} · needs review`} tone="bad" />
          )}
          <Stat
            label="Balance"
            value={money(totals.balance)}
            sub={typeof detail.pmsBalance === "number" && Math.abs(detail.pmsBalance - totals.balance) > 0.5 ? `practice system reports ${money(detail.pmsBalance)}` : totals.adjustments ? `after ${money(Math.abs(totals.adjustments))} in adjustments` : totals.balance > 0 ? "outstanding" : "settled"}
            tone={totals.balance > 0 ? "bad" : undefined}
          />
        </div>

        {detail.notes.length > 0 && (
          <div className="text-muted-foreground flex items-start gap-2 rounded-md border px-3 py-2 text-xs">
            <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
            <div className="grid gap-1">{detail.notes.map((n, i) => <span key={i}>{n}</span>)}</div>
          </div>
        )}

        {unapplied.length > 0 && (
          <Card className="border-amber-500/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><AlertTriangleIcon className="size-4 text-amber-500" /> Unapplied payments</CardTitle>
              <CardDescription>
                Money received that is not applied to any charge in {PMS_LABEL[detail.pmsType] ?? "the practice system"}. It still counts toward the balance but is not covering any treatment below.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <LedgerTable lines={unapplied} columns={["date", "description", "source", "provider", "amount", "appliedAmount", "unapplied"]} />
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue="treatments">
          <TabsList className="h-auto flex-wrap">
            <TabsTrigger value="treatments">Treatments <Badge variant="secondary" className="ml-1 px-1.5">{totals.procedures}</Badge></TabsTrigger>
            <TabsTrigger value="visits">Visits <Badge variant="secondary" className="ml-1 px-1.5">{visits.filter((v) => v.procedures.length).length}</Badge></TabsTrigger>
            <TabsTrigger value="payments">Payments <Badge variant="secondary" className="ml-1 px-1.5">{payments.length}</Badge></TabsTrigger>
            <TabsTrigger value="claims">
              Claims <Badge variant="secondary" className="ml-1 px-1.5">{detail.claims.length}</Badge>
              {openClaims > 0 && <Badge className="ml-1 bg-amber-500/15 px-1.5 text-amber-700 dark:text-amber-300">{openClaims} out</Badge>}
            </TabsTrigger>
            {detail.familyAvailable && (
              <TabsTrigger value="family">Family {family && <Badge variant="secondary" className="ml-1 px-1.5">{family.members.length}</Badge>}</TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="treatments">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><StethoscopeIcon className="size-4" /> Treatments performed</CardTitle>
                <CardDescription>Every procedure charged to this patient with what has been paid against it, newest first.</CardDescription>
                <div className="pt-2">
                  <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
                    <SelectTrigger size="sm" className="w-44"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All ({totals.procedures})</SelectItem>
                      <SelectItem value="paid">Paid in full ({totals.paid})</SelectItem>
                      <SelectItem value="partial">Partially paid ({totals.partial})</SelectItem>
                      <SelectItem value="unpaid">Unpaid ({totals.unpaid})</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent>
                <LedgerTable
                  lines={filteredTreatments}
                  columns={["date", "code", "description", "tooth", "provider", "amount", "paid", "remaining", "status"]}
                  emptyText="No treatments match."
                  source={detail.allocationSource}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="visits" className="flex flex-col gap-4">
            {visits.length === 0 && <p className="text-muted-foreground text-sm">No transactions on file for this patient.</p>}
            {visits.map((v) => <VisitCard key={v.dateOfService} visit={v} source={detail.allocationSource} />)}
          </TabsContent>

          <TabsContent value="payments">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><CreditCardIcon className="size-4" /> Payments</CardTitle>
                <CardDescription>Every payment on the ledger, newest first. Insurance checks are also tracked per claim in the Claims tab.</CardDescription>
              </CardHeader>
              <CardContent>
                <LedgerTable lines={payments} columns={["date", "description", "source", "provider", "amount", "applied"]} emptyText="No payments recorded." source={detail.allocationSource} />
              </CardContent>
            </Card>
            {detail.adjustments.length > 0 && (
              <Card className="mt-4">
                <CardHeader>
                  <CardTitle className="text-base">Adjustments</CardTitle>
                  <CardDescription>Write-offs and corrections on the account, newest first. They reduce the balance without money changing hands.</CardDescription>
                </CardHeader>
                <CardContent>
                  <LedgerTable lines={detail.adjustments} columns={["date", "description", "source", "provider", "amount", "applied"]} source={detail.allocationSource} />
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="claims">
            <ClaimsCard claims={detail.claims} pmsLabel={PMS_LABEL[detail.pmsType] ?? "the practice system"} />
          </TabsContent>

          {detail.familyAvailable && (
            <TabsContent value="family">
              <FamilyCard family={family} error={familyError} officeId={officeId} currentId={patientId} pmsLabel={PMS_LABEL[detail.pmsType] ?? "the practice system"} />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </>
  );
}

function Fact({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string | null }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        <div className="text-xs">{label}</div>
        <div className={value ? "text-foreground truncate" : "italic"}>{value ?? "not on file"}</div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "good" | "warn" | "bad" }) {
  const color = tone === "good" ? "text-green-600 dark:text-green-400" : tone === "warn" ? "text-amber-600 dark:text-amber-400" : tone === "bad" ? "text-destructive" : "";
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className={`text-2xl font-semibold tabular-nums ${color}`}>{value}</CardTitle>
      </CardHeader>
      <CardContent className="text-muted-foreground -mt-2 text-xs">{sub}</CardContent>
    </Card>
  );
}

function VisitCard({ visit, source }: { visit: Visit; source?: string }) {
  const hasProcedures = visit.procedures.length > 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <StethoscopeIcon className="size-4" />
          {dateLabel(visit.dateOfService)}
          {visit.providers.map((pr) => <Badge key={pr} variant="outline" className="text-muted-foreground px-1.5">{pr}</Badge>)}
          {!hasProcedures && <Badge variant="secondary" className="px-1.5">no procedures</Badge>}
        </CardTitle>
        <CardDescription className="flex flex-wrap gap-x-4">
          {hasProcedures && <span>{visit.procedures.length} procedure{visit.procedures.length === 1 ? "" : "s"} · {money(visit.charges)}</span>}
          {visit.procedures.length > 0 && <span>Insurance + patient paid {money(visit.procedures.reduce((a, l) => a + (l.payment?.paid ?? 0) + (l.payment?.adjusted ?? 0), 0))}</span>}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {hasProcedures && (
          <LedgerTable lines={visit.procedures} columns={["code", "description", "tooth", "surface", "provider", "amount", "paid", "status"]} footer={{ label: "Charges", value: visit.charges }} source={source} />
        )}
        {visit.notes.length > 0 && (
          <ul className="text-muted-foreground grid gap-1 text-xs">
            {visit.notes.map((n) => <li key={n.id}>• {n.description}</li>)}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Lists the allocation rows behind a paid amount or an "applied to" count.
 * `side` says what the linked line is: the charge a payment settled, or the
 * payment/adjustment that settled a charge.
 */
function AllocationPopover({ title, description, items, side, source, children }: {
  title: string;
  source?: string;
  description: string;
  items: AllocationLink[];
  side: "procedure" | "payment";
  children: React.ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="decoration-muted-foreground/50 hover:decoration-foreground underline decoration-dotted underline-offset-4">{children}</button>
      </PopoverTrigger>
      <PopoverContent className="w-[28rem] max-w-[calc(100vw-2rem)] p-0" align="end" onClick={(e) => e.stopPropagation()}>
        <div className="border-b px-4 py-3">
          <div className="text-sm font-medium">{title}</div>
          <p className="text-muted-foreground mt-0.5 text-xs">{description}</p>
        </div>
        <Table>
          <TableHeader className="bg-muted">
            <TableRow>
              <TableHead>Date</TableHead>
              {side === "procedure" && <TableHead>Code</TableHead>}
              <TableHead>{side === "procedure" ? "Procedure" : "Payment"}</TableHead>
              <TableHead className="text-right">Allocated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="text-muted-foreground whitespace-nowrap text-xs">{dateLabel(a.linkedDate)}</TableCell>
                {side === "procedure" && <TableCell className="font-mono text-xs">{a.linkedCode ?? ""}</TableCell>}
                <TableCell className="text-xs">
                  {a.linkedDescription}
                  {side === "payment" && (
                    <span className="text-muted-foreground ml-1">
                      {a.ledgerType === "A" ? "(write-off)" : a.linkedSource === "insurance" || a.claimId ? "(insurance)" : a.linkedSource === "patient" ? "(patient)" : ""}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right text-xs tabular-nums">{money(Math.abs(a.amount))}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="text-muted-foreground border-t px-4 py-2 text-[11px]">
          {(() => {
            const fifo = items.filter((a) => a.id.startsWith("fifo:")).length;
            const real = items.length - fifo;
            const parts = [
              real > 0 && source ? `${real} row${real === 1 ? "" : "s"} from ${source}` : null,
              fifo > 0 ? `${fifo} patient payment${fifo === 1 ? "" : "s"} applied oldest-first (no paysplit export)` : null,
            ].filter(Boolean);
            const ids = items.map((a) => a.paymentAllocationId).filter(Boolean).join(", ").slice(0, 80);
            return `${parts.join(" · ")}${ids ? ` · ids ${ids}` : ""}`;
          })()}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <div className="text-muted-foreground text-xs font-medium uppercase tracking-wide">{title}</div>
      {children}
    </div>
  );
}

type Col = "date" | "code" | "description" | "tooth" | "surface" | "provider" | "fee" | "amount" | "paid" | "remaining" | "status" | "applied" | "source" | "appliedAmount" | "unapplied";
const COL_LABEL: Record<Col, string> = { date: "Date", code: "Code", description: "Description", tooth: "Tooth", surface: "Surface", provider: "Provider", fee: "Fee", amount: "Amount", paid: "Paid", remaining: "Remaining", status: "Status", applied: "Applied to", source: "Source", appliedAmount: "Applied", unapplied: "Unapplied" };
const RIGHT: Col[] = ["fee", "amount", "paid", "remaining", "appliedAmount", "unapplied"];

export function PaidBadge({ status }: { status: PaidStatus | undefined }) {
  switch (status) {
    case "paid":
      return <Badge variant="outline" className="text-muted-foreground px-1.5"><CheckCircle2Icon className="fill-green-500 dark:fill-green-400" />Paid</Badge>;
    case "partial":
      return <Badge variant="outline" className="text-muted-foreground px-1.5"><CircleDashedIcon className="text-amber-500" />Partial</Badge>;
    case "unpaid":
      return <Badge variant="outline" className="text-muted-foreground px-1.5"><CircleIcon className="text-destructive" />Unpaid</Badge>;
    default:
      return <Badge variant="outline" className="text-muted-foreground px-1.5">No charge</Badge>;
  }
}

function LedgerTable({ lines, columns, footer, emptyText, source }: { lines: LedgerLine[]; columns: Col[]; footer?: { label: string; value: number }; emptyText?: string; source?: string }) {
  const cell = (l: LedgerLine, c: Col): React.ReactNode => {
    switch (c) {
      case "paid": {
        const p = l.payment;
        if (!p) return "";
        if (p.allocations.length === 0) return money(0);
        return (
          <AllocationPopover
            title="Settled by"
            description={`${money(p.paid)} paid${p.adjusted ? ` and ${money(p.adjusted)} written off` : ""} against this ${money(l.amount)} charge.`}
            items={p.allocations}
            side="payment"
            source={source}
          >
            {money(p.paid + p.adjusted)}
          </AllocationPopover>
        );
      }
      case "remaining": return l.payment ? money(l.payment.remaining) : "";
      case "status": return <PaidBadge status={l.payment?.status} />;
      case "appliedAmount": return l.applied ? money(l.applied.total) : "";
      case "unapplied": return l.applied ? <span className="text-amber-600 dark:text-amber-400">{money(l.applied.unallocated)}</span> : "";
      case "source": return l.source ? <Badge variant="outline" className="text-muted-foreground px-1.5">{l.source === "insurance" ? "Insurance" : l.source === "patient" ? "Patient" : "Other"}</Badge> : "";
      case "applied": {
        const a = l.applied;
        if (!a) return "";
        const label = `${a.procedures} procedure${a.procedures === 1 ? "" : "s"}${a.unallocated ? ` · ${money(a.unallocated)} unapplied` : ""}`;
        if (a.items.length === 0) return label;
        return (
          <AllocationPopover
            title="Applied to"
            description={`${money(a.total)} of this ${money(Math.abs(l.amount))} ${l.kind} was allocated to the charges below.${a.unallocated ? ` ${money(a.unallocated)} is not applied to anything yet.` : ""}`}
            items={a.items}
            side="procedure"
            source={source}
          >
            {label}
          </AllocationPopover>
        );
      }
      case "date": return dateLabel(l.date);
      case "code": return l.code ?? "";
      case "description": return l.description;
      case "tooth": return l.tooth ?? "";
      case "surface": return l.surface ?? "";
      case "provider": return l.provider ?? "";
      case "fee": return l.fee === null ? "" : money(l.fee);
      case "amount": return money(l.kind === "payment" ? -l.amount : l.amount);
    }
  };
  return (
    <div className="overflow-auto rounded-lg border">
      <Table>
        <TableHeader className="bg-muted">
          <TableRow>
            {columns.map((c) => <TableHead key={c} className={RIGHT.includes(c) ? "text-right" : ""}>{COL_LABEL[c]}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.length === 0 ? (
            <TableRow><TableCell colSpan={columns.length} className="text-muted-foreground h-16 text-center">{emptyText ?? "Nothing here."}</TableCell></TableRow>
          ) : (
            lines.map((l) => (
              <TableRow key={l.id}>
                {columns.map((c) => (
                  <TableCell key={c} className={`${RIGHT.includes(c) ? "text-right tabular-nums" : ""} ${c === "code" ? "font-mono text-xs" : ""} ${c === "description" ? "" : "whitespace-nowrap"} ${c !== "description" && c !== "amount" ? "text-muted-foreground" : ""}`}>
                    {cell(l, c)}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
          {footer && lines.length > 0 && (
            <TableRow className="bg-muted/50 font-medium">
              <TableCell colSpan={columns.length - 1} className="text-right">{footer.label}</TableCell>
              <TableCell className="text-right tabular-nums">{money(footer.value)}</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

/** Everyone on the same guarantor account, with payments pooled the way the practice system splits them. */
function FamilyCard({ family, error, officeId, currentId, pmsLabel }: { family: FamilySummary | null; error: string | null; officeId: string; currentId: string; pmsLabel: string }) {
  if (error) return <div className="text-destructive p-4 text-sm">{error}</div>;
  if (!family) return <div className="text-muted-foreground flex items-center gap-2 p-4 text-sm"><LoaderIcon className="size-4 animate-spin" /> Loading family account…</div>;
  const t = family.totals;
  const mine = family.transfers.filter((x) => x.fromPatientId === currentId);
  const toMe = family.transfers.filter((x) => x.toPatientId === currentId);
  const me = family.members.find((m) => m.patientId === currentId);
  const num = (v: number, tone?: "warn" | "good") => <span className={`tabular-nums ${tone === "warn" ? "text-amber-600 dark:text-amber-400" : tone === "good" ? "text-green-600 dark:text-green-400" : ""}`}>{money(v)}</span>;
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><UsersIcon className="size-4" /> Family account</CardTitle>
          <CardDescription>
            {family.members.length} member{family.members.length === 1 ? "" : "s"} under guarantor #{family.guarantorId}. {pmsLabel} splits a payment across the family, so a credit on one member usually covers another member's portion.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(11rem,1fr))]">
            <Stat label="Family patient portion" value={money(t.patientPortion)} sub={`${money(t.charges)} charged · ${money(t.insurancePaid)} insurance · ${money(t.writeOff)} written off`} />
            <Stat label="Family payments" value={money(t.patientPaid)} sub={`${money(t.covered)} applied to portions`} />
            <Stat label="Still outstanding" value={money(t.outstanding)} sub={t.outstanding > 0 ? "portions no family payment reaches" : "every portion covered"} tone={t.outstanding > 0 ? "bad" : "good"} />
            <Stat label="Family credit" value={money(t.credit)} sub={t.credit > 0 ? "patient money left after pooling" : "no patient money left over"} tone={t.credit > 0 ? "warn" : undefined} />
            <Stat
              label="Insurance over fee"
              value={money(t.insuranceOver)}
              sub={typeof t.pmsBalance === "number" ? `${pmsLabel} nets this: family balance ${money(t.pmsBalance)}${Math.abs(t.pmsBalance - (t.outstanding - t.credit - t.insuranceOver)) < 0.01 ? " · reconciles" : ""}` : "not patient money · needs review"}
              tone={t.insuranceOver > 0.005 ? "bad" : undefined}
            />
          </div>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader className="bg-muted">
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead className="text-right">Procedures</TableHead>
                  <TableHead className="text-right">Charges</TableHead>
                  <TableHead className="text-right">Insurance</TableHead>
                  <TableHead className="text-right">Write-off</TableHead>
                  <TableHead className="text-right">Ins. over fee</TableHead>
                  <TableHead className="text-right">Patient portion</TableHead>
                  <TableHead className="text-right">Own payments</TableHead>
                  <TableHead className="text-right">Covered (pooled)</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                  <TableHead className="text-right">{pmsLabel} balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {family.members.map((m) => (
                  <TableRow key={m.patientId} className={m.isCurrent ? "bg-muted/40" : undefined}>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {m.isCurrent ? <span className="font-medium">{m.name}</span> : (
                          <Link to="/offices/$officeId/patients/$patientId" params={{ officeId, patientId: m.patientId }} className="font-medium underline-offset-4 hover:underline">{m.name}</Link>
                        )}
                        <span className="text-muted-foreground font-mono text-xs">{m.patientId}</span>
                        {m.isGuarantor && <Badge variant="outline" className="px-1.5">Guarantor</Badge>}
                        {m.isCurrent && <Badge variant="secondary" className="px-1.5">This patient</Badge>}
                        {!m.active && <Badge variant="outline" className="text-muted-foreground px-1.5">Inactive</Badge>}
                      </div>
                      {m.birthDate && <div className="text-muted-foreground text-xs">Born {dateLabel(m.birthDate)}</div>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{m.procedures}</TableCell>
                    <TableCell className="text-right">{num(m.charges)}</TableCell>
                    <TableCell className="text-right">{num(m.insurancePaid)}</TableCell>
                    <TableCell className="text-right">{num(m.writeOff)}</TableCell>
                    <TableCell className="text-right">{num(m.insuranceOver)}</TableCell>
                    <TableCell className="text-right">{num(m.patientPortion)}</TableCell>
                    <TableCell className="text-right">{num(m.patientPaid)}</TableCell>
                    <TableCell className="text-right">{num(m.familyCovered, m.familyCovered > m.ownApplied + 0.005 ? "good" : undefined)}</TableCell>
                    <TableCell className="text-right">{num(m.outstanding, m.outstanding > 0 ? "warn" : undefined)}</TableCell>
                    <TableCell className="text-right">{typeof m.pmsBalance === "number" ? num(m.pmsBalance) : <span className="text-muted-foreground">—</span>}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/50 font-medium">
                  <TableCell>Family</TableCell>
                  <TableCell className="text-right tabular-nums">{family.members.reduce((a, m) => a + m.procedures, 0)}</TableCell>
                  <TableCell className="text-right">{num(t.charges)}</TableCell>
                  <TableCell className="text-right">{num(t.insurancePaid)}</TableCell>
                  <TableCell className="text-right">{num(t.writeOff)}</TableCell>
                  <TableCell className="text-right">{num(t.insuranceOver)}</TableCell>
                  <TableCell className="text-right">{num(t.patientPortion)}</TableCell>
                  <TableCell className="text-right">{num(t.patientPaid)}</TableCell>
                  <TableCell className="text-right">{num(t.covered)}</TableCell>
                  <TableCell className="text-right">{num(t.outstanding, t.outstanding > 0 ? "warn" : undefined)}</TableCell>
                  <TableCell className="text-right">{typeof t.pmsBalance === "number" ? num(t.pmsBalance) : <span className="text-muted-foreground">—</span>}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {(mine.length > 0 || toMe.length > 0 || (me && me.patientPaid - me.familyCovered > 0.005)) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Where this patient's money goes</CardTitle>
            <CardDescription>After pooling the family's payments and any insurance paid above the fee, applied oldest-first.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-1.5 text-sm">
            {me && <div>{money(me.familyCovered)} covers this patient's own portion{me.familyCovered < me.patientPortion - 0.005 ? ` (${money(me.patientPortion - me.familyCovered)} still open)` : ""}.</div>}
            {mine.map((x) => (
              <div key={x.toPatientId}>
                {money(x.amount)} of this patient's credit covers {x.procedures} procedure{x.procedures === 1 ? "" : "s"} for{" "}
                <Link to="/offices/$officeId/patients/$patientId" params={{ officeId, patientId: x.toPatientId }} className="font-medium underline-offset-4 hover:underline">{x.toName}</Link>.
              </div>
            ))}
            {toMe.map((x) => (
              <div key={x.fromPatientId}>
                {money(x.amount)} of{" "}
                <Link to="/offices/$officeId/patients/$patientId" params={{ officeId, patientId: x.fromPatientId }} className="font-medium underline-offset-4 hover:underline">{x.fromName}</Link>
                's credit covers {x.procedures} of this patient's procedure{x.procedures === 1 ? "" : "s"}.
              </div>
            ))}
            {t.credit > 0.005 && <div className="text-amber-600 dark:text-amber-400">{money(t.credit)} remains as family credit that no procedure in this export uses.</div>}
            {t.insuranceOver > 0.005 && <div className="text-destructive">{money(t.insuranceOver)} was paid by insurance above the recorded fees. It is not applied to any charge here; the office needs to correct the fee, refund the carrier, or expect a recoupment.</div>}
          </CardContent>
        </Card>
      )}

      {family.notes.length > 0 && (
        <div className="text-muted-foreground flex items-start gap-2 rounded-md border px-3 py-2 text-xs">
          <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
          <div className="grid gap-1">{family.notes.map((n, i) => <span key={i}>{n}</span>)}</div>
        </div>
      )}
    </div>
  );
}

const CLAIM_TONE: Record<Claim["status"], string> = {
  unsent: "bg-muted text-muted-foreground",
  sent: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  received: "bg-green-500/15 text-green-700 dark:text-green-300",
  closed: "bg-green-500/15 text-green-700 dark:text-green-300",
  denied: "bg-red-500/15 text-red-700 dark:text-red-300",
  other: "bg-muted text-muted-foreground",
};

/** Claims sent to carriers and what came back, with the procedures and checks behind each one. */
type ClaimSort = "service" | "sent" | "carrier" | "status" | "billed" | "estimate" | "paid" | "writeOff" | "received";
const CLAIM_STATUS_RANK: Record<Claim["status"], number> = { unsent: 0, sent: 1, denied: 2, received: 3, closed: 4, other: 5 };
const CLAIM_SORT_VALUE: Record<ClaimSort, (c: Claim) => string | number> = {
  service: (c) => c.dateOfService ?? "",
  sent: (c) => c.dateSent ?? "",
  carrier: (c) => (c.carrier ?? "").toLowerCase(),
  status: (c) => CLAIM_STATUS_RANK[c.status],
  billed: (c) => c.billed,
  estimate: (c) => c.estimate,
  paid: (c) => c.insurancePaid,
  writeOff: (c) => c.writeOff,
  received: (c) => c.dateReceived ?? (c.status === "sent" ? `~${String(c.daysOutstanding ?? 0).padStart(6, "0")}` : ""),
};

function ClaimsCard({ claims: input, pmsLabel }: { claims: Claim[]; pmsLabel: string }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<ClaimSort>("service");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const onSort = (f: string) => {
    const field = f as ClaimSort;
    if (field === sort) setOrder(order === "asc" ? "desc" : "asc");
    else {
      setSort(field);
      setOrder(field === "carrier" || field === "status" ? "asc" : "desc");
    }
  };
  const claims = useMemo(() => {
    const val = CLAIM_SORT_VALUE[sort];
    const dir = order === "asc" ? 1 : -1;
    return [...input].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      const cmp = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return cmp !== 0 ? cmp * dir : b.claimId.localeCompare(a.claimId);
    });
  }, [input, sort, order]);
  const toggle = (id: string) => setOpen((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const out = claims.filter((c) => c.status === "sent");
  const unsent = claims.filter((c) => c.status === "unsent");
  const paid = claims.filter((c) => c.status === "received" || c.status === "closed");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><FileTextIcon className="size-4" /> Claims</CardTitle>
        <CardDescription>
          {claims.length === 0 ? `No claims in the ${pmsLabel} export for this patient.` : (
            <>
              {claims.length} claim{claims.length === 1 ? "" : "s"} · {money(sum(claims.map((c) => c.billed)))} billed · {money(sum(claims.map((c) => c.insurancePaid)))} received
              {out.length > 0 && <> · <span className="text-amber-600 dark:text-amber-400">{out.length} still out, {money(sum(out.map((c) => c.estimate)))} expected</span></>}
              {unsent.length > 0 && <> · {unsent.length} not sent yet</>}
              {paid.length > 0 && <> · {paid.length} received</>}
            </>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {claims.length > 0 && (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader className="bg-muted">
                <TableRow>
                  <TableHead className="w-8" />
                  <SortHead label="Service" field="service" sort={sort} order={order} onSort={onSort} />
                  <SortHead label="Sent" field="sent" sort={sort} order={order} onSort={onSort} />
                  <SortHead label="Carrier" field="carrier" sort={sort} order={order} onSort={onSort} />
                  <TableHead className="hidden 2xl:table-cell">Type</TableHead>
                  <SortHead label="Status" field="status" sort={sort} order={order} onSort={onSort} />
                  <SortHead label="Billed" field="billed" sort={sort} order={order} onSort={onSort} right />
                  <SortHead label="Est. ins." field="estimate" sort={sort} order={order} onSort={onSort} right className="hidden md:table-cell" />
                  <SortHead label="Ins. paid" field="paid" sort={sort} order={order} onSort={onSort} right />
                  <SortHead label="Write-off" field="writeOff" sort={sort} order={order} onSort={onSort} right className="hidden lg:table-cell" />
                  <SortHead label="Received" field="received" sort={sort} order={order} onSort={onSort} />
                </TableRow>
              </TableHeader>
              <TableBody>
                {claims.map((c) => {
                  const isOpen = open.has(c.claimId);
                  const short = c.insurancePaid + 0.005 < c.estimate && (c.status === "received" || c.status === "closed");
                  return (
                    <React.Fragment key={c.claimId}>
                      <TableRow className="cursor-pointer" onClick={() => toggle(c.claimId)}>
                        <TableCell><ChevronRightIcon className={`text-muted-foreground size-4 transition-transform ${isOpen ? "rotate-90" : ""}`} /></TableCell>
                        <TableCell className="whitespace-nowrap text-xs">{c.dateOfService ? dateLabel(c.dateOfService) : <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className="whitespace-nowrap text-xs">{c.dateSent ? dateLabel(c.dateSent) : <span className="text-muted-foreground italic">not sent</span>}</TableCell>
                        <TableCell>
                          <div className="max-w-44 truncate xl:max-w-64" title={c.carrier ?? undefined}>{c.carrier ?? <span className="text-muted-foreground">—</span>}</div>
                          <div className="text-muted-foreground max-w-44 truncate font-mono text-[11px] xl:max-w-64">#{c.claimId}<span className="2xl:hidden"> · {c.type}</span>{c.provider ? ` · ${c.provider}` : ""}</div>
                        </TableCell>
                        <TableCell className="hidden whitespace-nowrap 2xl:table-cell">{c.type}</TableCell>
                        <TableCell><span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium ${CLAIM_TONE[c.status]}`}>{c.statusLabel}</span></TableCell>
                        <TableCell className="text-right tabular-nums">{money(c.billed)}</TableCell>
                        <TableCell className="hidden text-right tabular-nums md:table-cell">{money(c.estimate)}</TableCell>
                        <TableCell className={`text-right tabular-nums ${short ? "text-amber-600 dark:text-amber-400" : c.insurancePaid > 0 ? "text-green-600 dark:text-green-400" : ""}`}>{money(c.insurancePaid)}{short && <div className="text-[11px]">{money(c.estimate - c.insurancePaid)} under estimate</div>}</TableCell>
                        <TableCell className="hidden text-right tabular-nums lg:table-cell">{c.writeOff ? money(c.writeOff) : ""}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          {c.dateReceived ? dateLabel(c.dateReceived)
                            : c.status === "sent" ? <span className="text-amber-600 dark:text-amber-400">{c.daysOutstanding ?? "?"} days out</span>
                            : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                      </TableRow>
                      {isOpen && (
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableCell />
                          <TableCell colSpan={10} className="max-w-0 py-3">
                            <div className="grid gap-4 min-[1600px]:grid-cols-[minmax(0,1fr)_20rem]">
                              <div className="grid gap-1.5">
                                <div className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Procedures on this claim</div>
                                {c.procedures.length === 0 ? <div className="text-muted-foreground text-sm">No procedure lines in the export.</div> : (
                                  <Table>
                                    <TableHeader>
                                      <TableRow>
                                        <TableHead className="hidden md:table-cell">Date</TableHead>
                                        <TableHead>Code</TableHead>
                                        <TableHead>Procedure</TableHead>
                                        <TableHead className="text-right">Billed</TableHead>
                                        <TableHead className="text-right">Est.</TableHead>
                                        <TableHead className="text-right">Ins. paid</TableHead>
                                        <TableHead className="text-right">Write-off</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {c.procedures.map((p, i) => (
                                        <TableRow key={`${p.procedureLedgerId ?? p.code}-${i}`}>
                                          <TableCell className="text-muted-foreground hidden whitespace-nowrap text-xs md:table-cell">{p.date ? dateLabel(p.date) : ""}</TableCell>
                                          <TableCell className="font-mono text-xs">{p.code ?? ""}</TableCell>
                                          <TableCell className="text-xs"><div className="max-w-56 truncate lg:max-w-md" title={p.description}>{p.description}</div></TableCell>
                                          <TableCell className="text-right text-xs tabular-nums">{money(p.feeBilled)}</TableCell>
                                          <TableCell className="text-right text-xs tabular-nums">{p.estimate == null ? "" : money(p.estimate)}</TableCell>
                                          <TableCell className="text-right text-xs tabular-nums">{money(p.insurancePaid)}</TableCell>
                                          <TableCell className="text-right text-xs tabular-nums">{p.writeOff ? money(p.writeOff) : ""}</TableCell>
                                        </TableRow>
                                      ))}
                                      <TableRow className="bg-muted/50 font-medium">
                                        <TableCell className="hidden md:table-cell" /><TableCell colSpan={2} className="text-xs">Total across {c.procedures.length} procedure{c.procedures.length === 1 ? "" : "s"}</TableCell>
                                        <TableCell className="text-right text-xs tabular-nums">{money(sum(c.procedures.map((p) => p.feeBilled)))}</TableCell>
                                        <TableCell className="text-right text-xs tabular-nums">{money(sum(c.procedures.map((p) => p.estimate ?? 0)))}</TableCell>
                                        <TableCell className="text-right text-xs tabular-nums">{money(sum(c.procedures.map((p) => p.insurancePaid)))}</TableCell>
                                        <TableCell className="text-right text-xs tabular-nums">{sum(c.procedures.map((p) => p.writeOff)) ? money(sum(c.procedures.map((p) => p.writeOff))) : ""}</TableCell>
                                      </TableRow>
                                    </TableBody>
                                  </Table>
                                )}
                              </div>
                              <div className="grid content-start gap-1.5">
                                <div className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Payments received</div>
                                {c.payments.length === 0 ? (
                                  <div className="text-muted-foreground text-sm">{c.status === "sent" ? "Nothing received yet." : c.status === "unsent" ? "Claim has not been sent." : "No insurance payment recorded."}</div>
                                ) : c.payments.map((p) => (
                                  <div key={p.id} className="flex items-baseline justify-between gap-3 text-sm">
                                    <span><span className="text-muted-foreground mr-2 text-xs">{dateLabel(p.date)}</span>{p.description}</span>
                                    <span className="tabular-nums">{money(p.amount)}</span>
                                  </div>
                                ))}
                                {c.payments.length > 0 && (
                                  <div className="text-muted-foreground mt-1 text-xs">
                                    {money(sum(c.payments.map((p) => p.amount)))} received, split across the procedures at left as the carrier's explanation of benefits lists them.
                                  </div>
                                )}
                                {c.deductible > 0 && <div className="text-muted-foreground text-xs">{money(c.deductible)} applied to deductible.</div>}
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
