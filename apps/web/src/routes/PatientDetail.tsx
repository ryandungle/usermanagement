import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangleIcon, ArrowLeftIcon, CalendarIcon, ShieldCheckIcon, CheckCircle2Icon, CircleDashedIcon, CircleIcon, CreditCardIcon, LoaderIcon, MailIcon, MapPinIcon, PhoneIcon, StethoscopeIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SiteHeader } from "@/components/site-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { api, ApiError, type AllocationLink, type LedgerLine, type PaidStatus, type PatientDetail, type Visit } from "@/lib/api";
import { ageFrom, dateLabel, fullName, money } from "@/lib/format";
import { useMe } from "@/lib/me";
import { rememberedPatientsSearch } from "./Patients";

export function PatientDetailPage({ officeId, patientId }: { officeId: string; patientId: string }) {
  const { me } = useMe();
  const [detail, setDetail] = useState<PatientDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | PaidStatus>("all");
  const filteredTreatments = useMemo(
    () => (detail ? detail.treatments.filter((t) => statusFilter === "all" || t.payment?.status === statusFilter) : []),
    [detail, statusFilter],
  );

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
    api
      .getPatient(officeId, patientId)
      .then((r) => { if (!cancelled) setDetail(r.data); })
      .catch((err) => { if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load patient"); });
    return () => {
      cancelled = true;
    };
  }, [officeId, patientId]);

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
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 xl:grid-cols-7">
          <Stat label="Treatments performed" value={String(totals.procedures)} sub={`over ${totals.visits} visit${totals.visits === 1 ? "" : "s"} · ${money(totals.charges)}`} />
          <Stat label="Paid in full" value={String(totals.paid)} sub="charge fully covered" tone="good" />
          <Stat label="Partially paid" value={String(totals.partial)} sub="some money applied" tone={totals.partial ? "warn" : undefined} />
          <Stat label="Unpaid" value={String(totals.unpaid)} sub="nothing applied yet" tone={totals.unpaid ? "bad" : undefined} />
          <Stat
            label="Payments"
            value={money(totals.payments)}
            sub={`${money(payments.filter((p) => p.source === "insurance").reduce((s, p) => s - p.amount, 0))} insurance · ${money(payments.filter((p) => p.source !== "insurance").reduce((s, p) => s - p.amount, 0))} patient${totals.unallocatedPayments ? ` · ${money(totals.unallocatedPayments)} unapplied` : ""}`}
          />
          <Stat label="Unapplied" value={money(totals.unallocatedPayments)} sub={unapplied.length ? `${unapplied.length} payment${unapplied.length === 1 ? "" : "s"} not applied to a charge` : "all payments applied"} tone={totals.unallocatedPayments > 0 ? "warn" : undefined} />
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
                Money received that has not been allocated to a charge in Denticon. It still counts toward the balance but leaves the treatments below showing as unpaid until it is applied.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <LedgerTable lines={unapplied} columns={["date", "description", "source", "provider", "amount", "appliedAmount", "unapplied"]} />
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue="treatments">
          <TabsList>
            <TabsTrigger value="treatments">Treatments <Badge variant="secondary" className="ml-1 px-1.5">{totals.procedures}</Badge></TabsTrigger>
            <TabsTrigger value="visits">Visits <Badge variant="secondary" className="ml-1 px-1.5">{visits.filter((v) => v.procedures.length).length}</Badge></TabsTrigger>
            <TabsTrigger value="payments">Payments <Badge variant="secondary" className="ml-1 px-1.5">{payments.length}</Badge></TabsTrigger>
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
                <CardDescription>Every payment on the ledger, newest first.</CardDescription>
              </CardHeader>
              <CardContent>
                <LedgerTable lines={payments} columns={["date", "description", "source", "provider", "amount", "applied"]} emptyText="No payments recorded." source={detail.allocationSource} />
              </CardContent>
            </Card>
          </TabsContent>
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
          {visit.payments.length > 0 && <span>Paid {money(visit.paid)}</span>}
          {visit.adjustments.length > 0 && <span>Adjusted {money(visit.adjusted)}</span>}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {hasProcedures && (
          <LedgerTable lines={visit.procedures} columns={["code", "description", "tooth", "surface", "provider", "amount", "paid", "status"]} footer={{ label: "Charges", value: visit.charges }} source={source} />
        )}
        {visit.payments.length > 0 && (
          <Section title="Payments">
            <LedgerTable lines={visit.payments} columns={["description", "source", "provider", "amount"]} />
          </Section>
        )}
        {visit.adjustments.length > 0 && (
          <Section title="Adjustments">
            <LedgerTable lines={visit.adjustments} columns={["description", "provider", "amount"]} />
          </Section>
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
