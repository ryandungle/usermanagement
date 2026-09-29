import { Fragment, useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { BuildingIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, LoaderIcon, SearchIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SiteHeader } from "@/components/site-header";
import { DateRangePicker } from "@/components/date-range-picker";
import { api, ApiError, type Office, type Pagination, type ProcedureGroup, type ProcedureGroupBy, type ProcedureRow } from "@/lib/api";
import { dateLabel, money } from "@/lib/format";
import { useMe } from "@/lib/me";
import { PaidBadge } from "./PatientDetail";

const PAGE_SIZE = 25;

export interface ProceduresSearch {
  groupBy?: ProcedureGroupBy;
  from?: string;
  to?: string;
  q?: string;
  providerId?: string;
  page?: number;
}

const GROUP_LABEL: Record<ProcedureGroupBy, string> = { none: "No grouping", patient: "Patient", date: "Service date", both: "Service date, then patient" };

export function ProceduresPage({ officeId, search }: { officeId: string; search: ProceduresSearch }) {
  const { me } = useMe();
  const navigate = useNavigate();
  const [office, setOffice] = useState<Office | null>(null);
  const [offices, setOffices] = useState<Office[]>([]);
  const [rows, setRows] = useState<ProcedureRow[]>([]);
  const [groups, setGroups] = useState<ProcedureGroup[]>([]);
  const [providers, setProviders] = useState<Record<string, string>>({});
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const groupBy = search.groupBy ?? "date";
  const { from, to, q = "", providerId = "" } = search;
  const page = search.page ?? 1;

  useEffect(() => {
    api.getOffice(officeId).then((r) => setOffice(r.data)).catch(() => setOffice(null));
    api.listOffices({}).then((r) => setOffices(r.data.filter((o) => o.hasConnector))).catch(() => setOffices([]));
  }, [officeId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const base = { from, to, q: q || undefined, providerId: providerId || undefined, page, pageSize: PAGE_SIZE };
      if (groupBy === "none") {
        const res = await api.listProcedures(officeId, { ...base, groupBy });
        setRows(res.data);
        setGroups([]);
        setProviders(res.providers);
        setPagination(res.pagination);
      } else {
        const res = await api.groupProcedures(officeId, { ...base, groupBy });
        setGroups(res.data);
        setRows([]);
        setProviders(res.providers);
        setPagination(res.pagination);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load procedures");
      setRows([]);
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, [officeId, groupBy, from, to, q, providerId, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const go = (next: Partial<ProceduresSearch>) =>
    navigate({ to: "/offices/$officeId/procedures", params: { officeId }, search: { groupBy, from, to, q: q || undefined, providerId: providerId || undefined, page, ...next } });

  function onSearch(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    go({ q: String(new FormData(e.currentTarget).get("q") ?? "").trim() || undefined, page: 1 });
  }

  if (!me) return null;

  const filtersActive = !!(from || to || q || providerId);

  return (
    <>
      <SiteHeader title="Procedures">
        {offices.length > 1 ? (
          <Select value={officeId} onValueChange={(id) => navigate({ to: "/offices/$officeId/procedures", params: { officeId: id }, search: {} })}>
            <SelectTrigger size="sm" className="w-56" aria-label="Office">
              <BuildingIcon className="text-muted-foreground size-4" />
              <SelectValue placeholder="Select office" />
            </SelectTrigger>
            <SelectContent>
              {offices.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : (
          office && <Button asChild variant="ghost" size="sm"><Link to="/offices/$officeId" params={{ officeId }}>{office.name}</Link></Button>
        )}
      </SiteHeader>
      <div className="flex flex-col gap-4 p-4 lg:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={groupBy} onValueChange={(v) => go({ groupBy: v as ProcedureGroupBy, page: 1 })}>
            <SelectTrigger size="sm" className="w-60" aria-label="Group by">
              <span className="text-muted-foreground">Group by</span>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(GROUP_LABEL) as ProcedureGroupBy[]).map((k) => <SelectItem key={k} value={k}>{GROUP_LABEL[k]}</SelectItem>)}
            </SelectContent>
          </Select>
          <DateRangePicker value={{ from, to }} onChange={(r) => go({ from: r.from, to: r.to, page: 1 })} placeholder="Any service date" presets="visits" />
          <Select value={providerId || "all"} onValueChange={(v) => go({ providerId: v === "all" ? undefined : v, page: 1 })}>
            <SelectTrigger size="sm" className="w-52" aria-label="Provider"><SelectValue placeholder="Any provider" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any provider</SelectItem>
              {Object.entries(providers).sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
            </SelectContent>
          </Select>
          <form onSubmit={onSearch} className="relative">
            <SearchIcon className="text-muted-foreground absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
            <Input name="q" placeholder="Code or description" defaultValue={q} className="h-8 w-56 pl-8" />
          </form>
          {filtersActive && (
            <Button variant="outline" size="sm" className="h-8" onClick={() => go({ from: undefined, to: undefined, q: undefined, providerId: undefined, page: 1 })}>
              <XIcon /> Clear
            </Button>
          )}
          <span className="text-muted-foreground ml-auto text-sm">
            {pagination ? `${pagination.total.toLocaleString()} ${groupBy === "none" ? "procedure" : groupBy === "patient" ? "patient" : groupBy === "date" ? "service day" : "patient-day"}${pagination.total === 1 ? "" : "s"}` : ""}
          </span>
        </div>

        {error && <div className="text-destructive bg-destructive/10 rounded-md px-3 py-2 text-sm">{error}</div>}

        <div className="overflow-hidden rounded-lg border">
          {groupBy === "none" ? (
            <FlatTable rows={rows} loading={loading} officeId={officeId} />
          ) : (
            <GroupTable groups={groups} groupBy={groupBy} loading={loading} officeId={officeId} filters={{ from, to, q: q || undefined, providerId: providerId || undefined }} />
          )}
        </div>

        <div className="flex items-center justify-end gap-2 text-sm">
          <span>Page {pagination?.page ?? 1} of {pagination?.totalPages ?? 1}</span>
          <Button variant="outline" size="icon" className="size-8" disabled={page <= 1 || loading} onClick={() => go({ page: page - 1 })}><ChevronLeftIcon /></Button>
          <Button variant="outline" size="icon" className="size-8" disabled={!pagination || page >= pagination.totalPages || loading} onClick={() => go({ page: page + 1 })}><ChevronRightIcon /></Button>
        </div>
      </div>
    </>
  );
}

function FlatTable({ rows, loading, officeId, compact }: { rows: ProcedureRow[]; loading: boolean; officeId: string; compact?: boolean }) {
  return (
    <Table>
      <TableHeader className="bg-muted">
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Patient</TableHead>
          <TableHead>Code</TableHead>
          <TableHead>Description</TableHead>
          <TableHead>Tooth</TableHead>
          <TableHead>Provider</TableHead>
          <TableHead className="text-right">Amount</TableHead>
          <TableHead className="text-right">Paid</TableHead>
          <TableHead className="text-right">Remaining</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading ? (
          <TableRow><TableCell colSpan={10} className={`${compact ? "h-12" : "h-24"} text-center`}><LoaderIcon className="text-muted-foreground mx-auto size-4 animate-spin" /></TableCell></TableRow>
        ) : rows.length === 0 ? (
          <TableRow><TableCell colSpan={10} className="text-muted-foreground h-16 text-center">No procedures match.</TableCell></TableRow>
        ) : (
          rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="text-muted-foreground whitespace-nowrap">{dateLabel(r.date)}</TableCell>
              <TableCell>
                <Link to="/offices/$officeId/patients/$patientId" params={{ officeId, patientId: r.patientId }} className="font-medium underline-offset-4 hover:underline">{r.patientName}</Link>
                <span className="text-muted-foreground ml-1 font-mono text-xs">{r.patientId}</span>
              </TableCell>
              <TableCell className="font-mono text-xs">{r.code ?? ""}</TableCell>
              <TableCell>{r.description}</TableCell>
              <TableCell className="text-muted-foreground">{[r.tooth, r.surface].filter(Boolean).join(" ")}</TableCell>
              <TableCell className="text-muted-foreground whitespace-nowrap">{r.provider ?? ""}</TableCell>
              <TableCell className="text-right tabular-nums">{money(r.amount)}</TableCell>
              <TableCell className="text-muted-foreground text-right tabular-nums">{r.payment ? money(r.payment.paid + r.payment.adjusted) : ""}</TableCell>
              <TableCell className="text-muted-foreground text-right tabular-nums">{r.payment ? money(r.payment.remaining) : ""}</TableCell>
              <TableCell><PaidBadge status={r.payment?.status} /></TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

function GroupTable({ groups, groupBy, loading, officeId, filters }: {
  groups: ProcedureGroup[];
  groupBy: Exclude<ProcedureGroupBy, "none">;
  loading: boolean;
  officeId: string;
  filters: { from?: string; to?: string; q?: string; providerId?: string };
}) {
  const [open, setOpen] = useState<Record<string, ProcedureRow[] | "loading" | undefined>>({});
  const keyOf = (g: ProcedureGroup) => `${g.day ?? ""}|${g.patientId ?? ""}`;

  useEffect(() => setOpen({}), [groups]);

  async function toggle(g: ProcedureGroup) {
    const k = keyOf(g);
    if (open[k]) return setOpen((o) => ({ ...o, [k]: undefined }));
    setOpen((o) => ({ ...o, [k]: "loading" }));
    try {
      const res = await api.listProcedures(officeId, { groupBy: "none", ...filters, day: g.day ?? undefined, patientId: g.patientId ?? undefined, pageSize: 500 });
      setOpen((o) => ({ ...o, [k]: res.data }));
    } catch {
      setOpen((o) => ({ ...o, [k]: [] }));
    }
  }

  const showDay = groupBy !== "patient";
  const showPatient = groupBy !== "date";
  const cols = 1 + (showDay ? 1 : 0) + (showPatient ? 1 : 0) + (groupBy === "date" ? 1 : 0) + 5;

  return (
    <Table>
      <TableHeader className="bg-muted">
        <TableRow>
          <TableHead className="w-8" />
          {showDay && <TableHead>Service date</TableHead>}
          {showPatient && <TableHead>Patient</TableHead>}
          {groupBy === "patient" && <TableHead>Dates</TableHead>}
          {groupBy === "date" && <TableHead className="text-right">Patients</TableHead>}
          <TableHead className="text-right">Procedures</TableHead>
          <TableHead className="text-right">Charges</TableHead>
          <TableHead className="text-right">Paid</TableHead>
          <TableHead className="text-right">Remaining</TableHead>
          <TableHead className="w-32">Paid %</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading ? (
          <TableRow><TableCell colSpan={cols + 1} className="h-24 text-center"><LoaderIcon className="text-muted-foreground mx-auto size-4 animate-spin" /></TableCell></TableRow>
        ) : groups.length === 0 ? (
          <TableRow><TableCell colSpan={cols + 1} className="text-muted-foreground h-16 text-center">No procedures match.</TableCell></TableRow>
        ) : (
          groups.map((g) => {
            const k = keyOf(g);
            const state = open[k];
            const pct = g.charges > 0 ? Math.min(100, Math.round(((g.paid + g.adjusted) / g.charges) * 100)) : 0;
            return (
              <Fragment key={k}>
                <TableRow className="cursor-pointer" onClick={() => toggle(g)} data-state={state ? "selected" : undefined}>
                  <TableCell><ChevronDownIcon className={`text-muted-foreground size-4 transition-transform ${state ? "" : "-rotate-90"}`} /></TableCell>
                  {showDay && <TableCell className="whitespace-nowrap font-medium">{dateLabel(g.day)}</TableCell>}
                  {showPatient && (
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Link to="/offices/$officeId/patients/$patientId" params={{ officeId, patientId: g.patientId! }} className="font-medium underline-offset-4 hover:underline">{g.patientName}</Link>
                      <span className="text-muted-foreground ml-1 font-mono text-xs">{g.patientId}</span>
                    </TableCell>
                  )}
                  {groupBy === "patient" && (
                    <TableCell className="text-muted-foreground whitespace-nowrap">{g.firstDate.slice(0, 10) === g.lastDate.slice(0, 10) ? dateLabel(g.firstDate) : `${dateLabel(g.firstDate)} – ${dateLabel(g.lastDate)}`}</TableCell>
                  )}
                  {groupBy === "date" && <TableCell className="text-right tabular-nums">{g.patients}</TableCell>}
                  <TableCell className="text-right tabular-nums">{g.procedures}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(g.charges)}</TableCell>
                  <TableCell className="text-muted-foreground text-right tabular-nums">{money(g.paid + g.adjusted)}</TableCell>
                  <TableCell className={`text-right tabular-nums ${g.remaining > 0 ? "text-destructive" : "text-muted-foreground"}`}>{money(g.remaining)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="bg-muted h-1.5 flex-1 overflow-hidden rounded-full"><div className="h-full rounded-full bg-green-500 dark:bg-green-400" style={{ width: `${pct}%` }} /></div>
                      <span className="text-muted-foreground w-9 text-right text-xs tabular-nums">{pct}%</span>
                    </div>
                  </TableCell>
                </TableRow>
                {state && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={cols + 1} className="bg-muted/30 p-0">
                      <div className="border-t">
                        {state === "loading" ? (
                          <div className="text-muted-foreground flex items-center gap-2 p-3 text-sm"><LoaderIcon className="size-4 animate-spin" /> Loading procedures…</div>
                        ) : (
                          <FlatTable rows={state} loading={false} officeId={officeId} compact />
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}

