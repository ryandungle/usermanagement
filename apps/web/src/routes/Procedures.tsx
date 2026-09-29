import { Fragment, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon, BuildingIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, LoaderIcon, SearchIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SiteHeader } from "@/components/site-header";
import { DateRangePicker } from "@/components/date-range-picker";
import { ColumnPicker } from "@/components/office/column-picker";
import { rememberOffice, rememberState, rememberedState } from "@/lib/remembered";
import { api, ApiError, type GroupSort, type Office, type Pagination, type ProcedureGroup, type ProcedureGroupBy, type ProcedureRow, type ProcedureSort } from "@/lib/api";
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
  nonZero?: "true";
  sort?: ProcedureSort | GroupSort;
  order?: "asc" | "desc";
  page?: number;
}

const GROUP_LABEL: Record<ProcedureGroupBy, string> = { none: "No grouping", patient: "Patient", date: "Service date", both: "Service date, then patient" };

// ---- remembered state per office --------------------------------------------
const stateKey = (officeId: string) => `um-procedures-state:${officeId}`;
export function rememberedProceduresSearch(officeId: string): ProceduresSearch {
  return rememberedState<ProceduresSearch>(stateKey(officeId));
}
function rememberProceduresSearch(officeId: string, s: ProceduresSearch) {
  rememberState(stateKey(officeId), s);
}

// ---- columns ------------------------------------------------------------------
type FlatCol = "date" | "patient" | "code" | "description" | "tooth" | "provider" | "amount" | "paid" | "remaining" | "status";
const FLAT_COLS: { key: FlatCol; label: string; sort?: ProcedureSort; right?: boolean }[] = [
  { key: "date", label: "Date", sort: "date" },
  { key: "patient", label: "Patient", sort: "patient" },
  { key: "code", label: "Code", sort: "code" },
  { key: "description", label: "Description", sort: "description" },
  { key: "tooth", label: "Tooth" },
  { key: "provider", label: "Provider", sort: "provider" },
  { key: "amount", label: "Amount", sort: "amount", right: true },
  { key: "paid", label: "Paid", right: true },
  { key: "remaining", label: "Remaining", right: true },
  { key: "status", label: "Status" },
];
type GroupCol = "day" | "patient" | "dates" | "patients" | "procedures" | "charges" | "paid" | "remaining" | "pct";
const GROUP_COLS: { key: GroupCol; label: string; sort?: GroupSort; right?: boolean; modes: ProcedureGroupBy[] }[] = [
  { key: "day", label: "Service date", sort: "day", modes: ["date", "both"] },
  { key: "patient", label: "Patient", sort: "patient", modes: ["patient", "both"] },
  { key: "dates", label: "Dates", modes: ["patient"] },
  { key: "patients", label: "Patients", sort: "patients", right: true, modes: ["date"] },
  { key: "procedures", label: "Procedures", sort: "procedures", right: true, modes: ["date", "patient", "both"] },
  { key: "charges", label: "Charges", sort: "charges", right: true, modes: ["date", "patient", "both"] },
  { key: "paid", label: "Paid", right: true, modes: ["date", "patient", "both"] },
  { key: "remaining", label: "Remaining", right: true, modes: ["date", "patient", "both"] },
  { key: "pct", label: "Paid %", modes: ["date", "patient", "both"] },
];

function useColumns<K extends string>(storageKey: string, all: K[]) {
  const [visible, setVisible] = useState<K[]>(all);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      setVisible(raw ? (JSON.parse(raw) as K[]).filter((k) => all.includes(k)) : all);
    } catch {
      setVisible(all);
    }
  }, [storageKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const choose = (next: string[]) => {
    const keys = all.filter((k) => next.includes(k));
    setVisible(keys);
    try {
      localStorage.setItem(storageKey, JSON.stringify(keys));
    } catch {}
  };
  return [visible, choose] as const;
}

function SortHead({ label, field, sort, order, onSort, right }: { label: string; field?: string; sort?: string; order: "asc" | "desc"; onSort: (f: string) => void; right?: boolean }) {
  if (!field) return <TableHead className={right ? "text-right" : ""}>{label}</TableHead>;
  const active = sort === field;
  return (
    <TableHead className={right ? "text-right" : ""}>
      <button type="button" className={`hover:text-foreground inline-flex h-8 items-center gap-1 rounded-md px-2 ${right ? "-mr-2" : "-ml-2"}`} onClick={() => onSort(field)} aria-sort={active ? (order === "asc" ? "ascending" : "descending") : "none"}>
        {label}
        {active ? (order === "asc" ? <ArrowUpIcon className="size-3.5" /> : <ArrowDownIcon className="size-3.5" />) : <ArrowUpDownIcon className="size-3.5 opacity-40" />}
      </button>
    </TableHead>
  );
}

// ---- page -----------------------------------------------------------------------
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
  const nonZero = search.nonZero === "true";
  const page = search.page ?? 1;
  const defaultSort = groupBy === "none" ? "date" : groupBy === "patient" ? "charges" : "day";
  const sort = search.sort ?? defaultSort;
  const order = search.order ?? "desc";

  // Restore the last state when opened without params (sidebar, back, office switch); remember otherwise.
  // Derived, not stored in state, so switching office never loads defaults before the restore navigation lands.
  const bare = Object.values(search).every((v) => v === undefined);
  const needsRestore = bare && Object.keys(rememberedProceduresSearch(officeId)).length > 0;
  useEffect(() => {
    if (!needsRestore) return;
    // Defer so the navigation is not swallowed by the router transition that mounted this page.
    const t = window.setTimeout(() => navigate({ to: "/offices/$officeId/procedures", params: { officeId }, search: rememberedProceduresSearch(officeId), replace: true }), 0);
    return () => window.clearTimeout(t);
  }, [officeId, needsRestore]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!bare) rememberProceduresSearch(officeId, search);
  }, [officeId, bare, search]);

  useEffect(() => {
    api.getOffice(officeId).then((r) => setOffice(r.data)).catch(() => setOffice(null));
    api.listOffices({}).then((r) => setOffices(r.data.filter((o) => o.hasConnector))).catch(() => setOffices([]));
    rememberOffice("procedures", officeId);
  }, [officeId]);

  // Only the latest request may update the table: a slow query for the previous office or filter must not overwrite a newer one.
  const requestSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    const current = () => seq === requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const base = { from, to, q: q || undefined, providerId: providerId || undefined, nonZero: nonZero ? ("true" as const) : undefined, sort, order, page, pageSize: PAGE_SIZE };
      if (groupBy === "none") {
        const res = await api.listProcedures(officeId, { ...base, groupBy });
        if (!current()) return;
        setRows(res.data);
        setGroups([]);
        setProviders(res.providers);
        setPagination(res.pagination);
      } else {
        const res = await api.groupProcedures(officeId, { ...base, groupBy });
        if (!current()) return;
        setGroups(res.data);
        setRows([]);
        setProviders(res.providers);
        setPagination(res.pagination);
      }
    } catch (err) {
      if (!current()) return;
      setError(err instanceof ApiError ? err.message : "Could not load procedures");
      setRows([]);
      setGroups([]);
    } finally {
      if (current()) setLoading(false);
    }
  }, [officeId, groupBy, from, to, q, providerId, nonZero, sort, order, page]);

  useEffect(() => {
    if (!needsRestore) void load();
  }, [load, needsRestore]);

  // Clear the previous office's rows the moment the office changes.
  useEffect(() => {
    setRows([]);
    setGroups([]);
    setPagination(null);
  }, [officeId]);

  const go = (next: Partial<ProceduresSearch>) =>
    navigate({
      to: "/offices/$officeId/procedures",
      params: { officeId },
      search: { groupBy, from, to, q: q || undefined, providerId: providerId || undefined, nonZero: nonZero ? "true" : undefined, sort: search.sort, order: search.order, page, ...next },
    });

  function onSearch(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    go({ q: String(new FormData(e.currentTarget).get("q") ?? "").trim() || undefined, page: 1 });
  }

  function toggleSort(field: string) {
    if (sort === field) go({ sort: field as ProceduresSearch["sort"], order: order === "asc" ? "desc" : "asc", page: 1 });
    else go({ sort: field as ProceduresSearch["sort"], order: field === "patient" || field === "code" || field === "description" || field === "provider" ? "asc" : "desc", page: 1 });
  }

  const [flatVisible, chooseFlat] = useColumns<FlatCol>(`um-proc-cols:${officeId}:flat`, FLAT_COLS.map((c) => c.key));
  const groupAll = GROUP_COLS.filter((c) => c.modes.includes(groupBy)).map((c) => c.key);
  const [groupVisible, chooseGroup] = useColumns<GroupCol>(`um-proc-cols:${officeId}:${groupBy}`, groupAll);

  if (!me) return null;

  const filtersActive = !!(from || to || q || providerId || nonZero);

  return (
    <>
      <SiteHeader title="Procedures">
        {offices.length > 1 ? (
          <Select value={officeId} onValueChange={(id) => navigate({ to: "/offices/$officeId/procedures", params: { officeId: id }, search: {} })}>
            <SelectTrigger size="sm" className="w-56" aria-label="Office">
              <BuildingIcon className="text-muted-foreground size-4" />
              <SelectValue placeholder="Select office" />
            </SelectTrigger>
            <SelectContent>{offices.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}</SelectContent>
          </Select>
        ) : (
          office && <Button asChild variant="ghost" size="sm"><Link to="/offices/$officeId" params={{ officeId }}>{office.name}</Link></Button>
        )}
      </SiteHeader>
      <div className="flex flex-col gap-4 p-4 lg:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={groupBy} onValueChange={(v) => go({ groupBy: v as ProcedureGroupBy, sort: undefined, order: undefined, page: 1 })}>
            <SelectTrigger size="sm" className="w-60" aria-label="Group by">
              <span className="text-muted-foreground">Group by</span>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>{(Object.keys(GROUP_LABEL) as ProcedureGroupBy[]).map((k) => <SelectItem key={k} value={k}>{GROUP_LABEL[k]}</SelectItem>)}</SelectContent>
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
            <Input name="q" placeholder="Code or description" defaultValue={q} className="h-8 w-52 pl-8" />
          </form>
          <label className="flex h-8 items-center gap-2 rounded-md border px-2.5 text-sm">
            <Checkbox checked={nonZero} onCheckedChange={(on) => go({ nonZero: on ? "true" : undefined, page: 1 })} aria-label="Exclude $0 procedures" />
            Exclude $0
          </label>
          {filtersActive && (
            <Button variant="outline" size="sm" className="h-8" onClick={() => go({ from: undefined, to: undefined, q: undefined, providerId: undefined, nonZero: undefined, page: 1 })}>
              <XIcon /> Clear
            </Button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <span className="text-muted-foreground text-sm">
              {pagination ? `${pagination.total.toLocaleString()} ${groupBy === "none" ? "procedure" : groupBy === "patient" ? "patient" : groupBy === "date" ? "service day" : "patient-day"}${pagination.total === 1 ? "" : "s"}` : ""}
            </span>
            {groupBy === "none" ? (
              <ColumnPicker fields={FLAT_COLS.map((c) => c.key)} labels={Object.fromEntries(FLAT_COLS.map((c) => [c.key, c.label]))} value={flatVisible} onChange={chooseFlat} />
            ) : (
              <ColumnPicker fields={groupAll} labels={Object.fromEntries(GROUP_COLS.map((c) => [c.key, c.label]))} value={groupVisible} onChange={chooseGroup} />
            )}
          </div>
        </div>

        {error && <div className="text-destructive bg-destructive/10 rounded-md px-3 py-2 text-sm">{error}</div>}

        <div className="overflow-hidden rounded-lg border">
          {groupBy === "none" ? (
            <FlatTable rows={rows} loading={loading} officeId={officeId} visible={flatVisible} sort={sort} order={order} onSort={toggleSort} />
          ) : (
            <GroupTable
              groups={groups}
              groupBy={groupBy}
              loading={loading}
              officeId={officeId}
              visible={groupVisible}
              sort={sort}
              order={order}
              onSort={toggleSort}
              filters={{ from, to, q: q || undefined, providerId: providerId || undefined, nonZero: nonZero ? "true" : undefined }}
            />
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

function FlatTable({ rows, loading, officeId, visible, sort, order, onSort, compact }: {
  rows: ProcedureRow[];
  loading: boolean;
  officeId: string;
  visible: FlatCol[];
  sort?: string;
  order?: "asc" | "desc";
  onSort?: (f: string) => void;
  compact?: boolean;
}) {
  const cols = FLAT_COLS.filter((c) => visible.includes(c.key));
  const cell = (r: ProcedureRow, key: FlatCol) => {
    switch (key) {
      case "date": return <span className="text-muted-foreground whitespace-nowrap">{dateLabel(r.date)}</span>;
      case "patient": return (
        <>
          <Link to="/offices/$officeId/patients/$patientId" params={{ officeId, patientId: r.patientId }} className="font-medium underline-offset-4 hover:underline">{r.patientName}</Link>
          <span className="text-muted-foreground ml-1 font-mono text-xs">{r.patientId}</span>
        </>
      );
      case "code": return <span className="font-mono text-xs">{r.code ?? ""}</span>;
      case "description": return r.description;
      case "tooth": return <span className="text-muted-foreground">{[r.tooth, r.surface].filter(Boolean).join(" ")}</span>;
      case "provider": return <span className="text-muted-foreground whitespace-nowrap">{r.provider ?? ""}</span>;
      case "amount": return <span className="tabular-nums">{money(r.amount)}</span>;
      case "paid": return <span className="text-muted-foreground tabular-nums">{r.payment ? money(r.payment.paid + r.payment.adjusted) : ""}</span>;
      case "remaining": return <span className="text-muted-foreground tabular-nums">{r.payment ? money(r.payment.remaining) : ""}</span>;
      case "status": return <PaidBadge status={r.payment?.status} />;
    }
  };
  return (
    <Table>
      <TableHeader className="bg-muted">
        <TableRow>
          {cols.map((c) => onSort ? <SortHead key={c.key} label={c.label} field={c.sort} sort={sort} order={order ?? "desc"} onSort={onSort} right={c.right} /> : <TableHead key={c.key} className={c.right ? "text-right" : ""}>{c.label}</TableHead>)}
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading ? (
          <TableRow><TableCell colSpan={cols.length} className={`${compact ? "h-12" : "h-24"} text-center`}><LoaderIcon className="text-muted-foreground mx-auto size-4 animate-spin" /></TableCell></TableRow>
        ) : rows.length === 0 ? (
          <TableRow><TableCell colSpan={cols.length} className="text-muted-foreground h-16 text-center">No procedures match.</TableCell></TableRow>
        ) : (
          rows.map((r) => (
            <TableRow key={r.id}>
              {cols.map((c) => <TableCell key={c.key} className={c.right ? "text-right" : ""}>{cell(r, c.key)}</TableCell>)}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

function GroupTable({ groups, groupBy, loading, officeId, visible, sort, order, onSort, filters }: {
  groups: ProcedureGroup[];
  groupBy: Exclude<ProcedureGroupBy, "none">;
  loading: boolean;
  officeId: string;
  visible: GroupCol[];
  sort: string;
  order: "asc" | "desc";
  onSort: (f: string) => void;
  filters: { from?: string; to?: string; q?: string; providerId?: string; nonZero?: "true" };
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

  const cols = GROUP_COLS.filter((c) => c.modes.includes(groupBy) && visible.includes(c.key));
  const cell = (g: ProcedureGroup, key: GroupCol) => {
    const pct = g.charges > 0 ? Math.min(100, Math.round(((g.paid + g.adjusted) / g.charges) * 100)) : 0;
    switch (key) {
      case "day": return <span className="whitespace-nowrap font-medium">{dateLabel(g.day)}</span>;
      case "patient": return (
        <span onClick={(e) => e.stopPropagation()}>
          <Link to="/offices/$officeId/patients/$patientId" params={{ officeId, patientId: g.patientId! }} className="font-medium underline-offset-4 hover:underline">{g.patientName}</Link>
          <span className="text-muted-foreground ml-1 font-mono text-xs">{g.patientId}</span>
        </span>
      );
      case "dates": return <span className="text-muted-foreground whitespace-nowrap">{g.firstDate.slice(0, 10) === g.lastDate.slice(0, 10) ? dateLabel(g.firstDate) : `${dateLabel(g.firstDate)} – ${dateLabel(g.lastDate)}`}</span>;
      case "patients": return <span className="tabular-nums">{g.patients}</span>;
      case "procedures": return <span className="tabular-nums">{g.procedures}</span>;
      case "charges": return <span className="tabular-nums">{money(g.charges)}</span>;
      case "paid": return <span className="text-muted-foreground tabular-nums">{money(g.paid + g.adjusted)}</span>;
      case "remaining": return <span className={`tabular-nums ${g.remaining > 0 ? "text-destructive" : "text-muted-foreground"}`}>{money(g.remaining)}</span>;
      case "pct": return (
        <div className="flex w-32 items-center gap-2">
          <div className="bg-muted h-1.5 flex-1 overflow-hidden rounded-full"><div className="h-full rounded-full bg-green-500 dark:bg-green-400" style={{ width: `${pct}%` }} /></div>
          <span className="text-muted-foreground w-9 text-right text-xs tabular-nums">{pct}%</span>
        </div>
      );
    }
  };

  return (
    <Table>
      <TableHeader className="bg-muted">
        <TableRow>
          <TableHead className="w-8" />
          {cols.map((c) => <SortHead key={c.key} label={c.label} field={c.sort} sort={sort} order={order} onSort={onSort} right={c.right} />)}
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading ? (
          <TableRow><TableCell colSpan={cols.length + 1} className="h-24 text-center"><LoaderIcon className="text-muted-foreground mx-auto size-4 animate-spin" /></TableCell></TableRow>
        ) : groups.length === 0 ? (
          <TableRow><TableCell colSpan={cols.length + 1} className="text-muted-foreground h-16 text-center">No procedures match.</TableCell></TableRow>
        ) : (
          groups.map((g) => {
            const k = keyOf(g);
            const state = open[k];
            return (
              <Fragment key={k}>
                <TableRow className="cursor-pointer" onClick={() => toggle(g)} data-state={state ? "selected" : undefined}>
                  <TableCell><ChevronDownIcon className={`text-muted-foreground size-4 transition-transform ${state ? "" : "-rotate-90"}`} /></TableCell>
                  {cols.map((c) => <TableCell key={c.key} className={c.right ? "text-right" : ""}>{cell(g, c.key)}</TableCell>)}
                </TableRow>
                {state && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={cols.length + 1} className="bg-muted/30 p-0">
                      <div className="border-t">
                        {state === "loading" ? (
                          <div className="text-muted-foreground flex items-center gap-2 p-3 text-sm"><LoaderIcon className="size-4 animate-spin" /> Loading procedures…</div>
                        ) : (
                          <FlatTable rows={state} loading={false} officeId={officeId} visible={FLAT_COLS.map((c) => c.key).filter((c) => (groupBy === "patient" ? c !== "patient" : groupBy === "both" ? c !== "patient" && c !== "date" : c !== "date"))} compact />
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

