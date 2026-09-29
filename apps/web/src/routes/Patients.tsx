import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { BuildingIcon } from "lucide-react";
import { ArrowDownIcon, ArrowUpIcon, ArrowUpDownIcon, ChevronLeftIcon, ChevronRightIcon, LoaderIcon, SearchIcon, XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SiteHeader } from "@/components/site-header";
import { ColumnPicker } from "@/components/office/column-picker";
import { DateRangePicker } from "@/components/date-range-picker";
import { rememberOffice, rememberState, rememberedState } from "@/lib/remembered";
import { api, ApiError, type Office, type Pagination, type PatientSort, type PatientSummary } from "@/lib/api";
import { ageFrom, dateLabel, fullName } from "@/lib/format";
import { useMe } from "@/lib/me";

const PAGE_SIZE = 25;

const stateKey = (officeId: string) => `um-patients-state:${officeId}`;

/** Last list state (search, page, filter, sort) for an office, restored when the list is opened without params. */
export function rememberedPatientsSearch(officeId: string): PatientsSearch {
  return rememberedState<PatientsSearch>(stateKey(officeId));
}

function rememberPatientsSearch(officeId: string, search: PatientsSearch) {
  rememberState(stateKey(officeId), search);
}

export interface PatientsSearch {
  q?: string;
  page?: number;
  active?: "true" | "false";
  sort?: PatientSort;
  order?: "asc" | "desc";
  dateField?: "lastVisitDate" | "birthDate";
  from?: string;
  to?: string;
}

type ColKey = "name" | "patientId" | "birthDate" | "sex" | "phone" | "email" | "city" | "coverage" | "lastVisitDate" | "status";

const COLUMNS: { key: ColKey; label: string; sort?: PatientSort }[] = [
  { key: "name", label: "Patient", sort: "lastName" },
  { key: "patientId", label: "ID", sort: "patientId" },
  { key: "birthDate", label: "Born", sort: "birthDate" },
  { key: "sex", label: "Sex" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "city", label: "City", sort: "city" },
  { key: "coverage", label: "Coverage" },
  { key: "lastVisitDate", label: "Last visit", sort: "lastVisitDate" },
  { key: "status", label: "Status" },
];
const ALL_KEYS = COLUMNS.map((c) => c.key);

export function CoverageCell({ coverage }: { coverage: PatientSummary["coverage"] }) {
  if (coverage.kind === "self-pay") return <Badge variant="outline" className="text-muted-foreground px-1.5">Self-pay</Badge>;
  const p = coverage.primary!;
  return (
    <span className="inline-flex flex-wrap items-center gap-1" title={[p.groupNo ? `Group ${p.groupNo}` : null, p.relation ? `Subscriber: ${p.relation}` : null, coverage.secondary ? `Secondary: ${coverage.secondary.carrier}` : null].filter(Boolean).join(" · ")}>
      <span className="text-foreground max-w-48 truncate">{p.carrier}</span>
      {p.planCategory && <Badge variant="secondary" className="px-1.5">{p.planCategory}</Badge>}
      {coverage.secondary && <Badge variant="outline" className="text-muted-foreground px-1.5">+2nd</Badge>}
    </span>
  );
}

export function PatientsPage({ officeId, search }: { officeId: string; search: PatientsSearch }) {
  const { me } = useMe();
  const navigate = useNavigate();
  const [office, setOffice] = useState<Office | null>(null);
  const [offices, setOffices] = useState<Office[]>([]);
  const [lastVisitSupported, setLastVisitSupported] = useState(true);
  const [rows, setRows] = useState<PatientSummary[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState<ColKey[]>(ALL_KEYS);

  const q = search.q ?? "";
  const page = search.page ?? 1;
  const active = search.active ?? "true";
  const sort = search.sort ?? "lastName";
  const order = search.order ?? "asc";
  const dateField = search.dateField ?? "lastVisitDate";
  const from = search.from;
  const to = search.to;

  // Opened with no params (sidebar, back link): restore the last state for this office.
  const bare = !search.q && !search.page && !search.active && !search.sort && !search.order && !search.from && !search.to;
  const needsRestore = bare && Object.keys(rememberedPatientsSearch(officeId)).length > 0;
  useEffect(() => {
    if (!needsRestore) return;
    const t = window.setTimeout(() => navigate({ to: "/offices/$officeId/patients", params: { officeId }, search: rememberedPatientsSearch(officeId), replace: true }), 0);
    return () => window.clearTimeout(t);
  }, [officeId, needsRestore]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!bare)
      rememberPatientsSearch(officeId, {
        q: q || undefined,
        page: page > 1 ? page : undefined,
        active: active !== "true" ? active : undefined,
        sort: sort !== "lastName" ? sort : undefined,
        order: order !== "asc" ? order : undefined,
        dateField: from || to ? dateField : undefined,
        from,
        to,
      });
  }, [officeId, bare, q, page, active, sort, order, dateField, from, to]);

  const colsKey = `um-patient-cols:${officeId}`;
  useEffect(() => {
    try {
      const raw = localStorage.getItem(colsKey);
      if (raw) setVisible((JSON.parse(raw) as ColKey[]).filter((k) => ALL_KEYS.includes(k)));
    } catch {}
  }, [colsKey]);
  function chooseColumns(next: string[]) {
    const keys = ALL_KEYS.filter((k) => next.includes(k));
    setVisible(keys);
    try {
      localStorage.setItem(colsKey, JSON.stringify(keys));
    } catch {}
  }

  useEffect(() => {
    api.getOffice(officeId).then((r) => setOffice(r.data)).catch(() => setOffice(null));
    api.getConnector(officeId).then((r) => setLastVisitSupported(r.data?.capabilities.lastVisit ?? true)).catch(() => {});
    rememberOffice("patients", officeId);
  }, [officeId]);

  // Offices in the viewer's scope that have a database connector.
  useEffect(() => {
    api.listOffices({}).then((r) => setOffices(r.data.filter((o) => o.hasConnector))).catch(() => setOffices([]));
  }, []);

  // Only the latest request may update the table (a slow query for another office must not overwrite a newer one).
  const requestSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    const current = () => seq === requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const res = await api.listPatients(officeId, { q: q || undefined, active, page, pageSize: PAGE_SIZE, sort, order, dateField: from || to ? dateField : undefined, from, to });
      if (!current()) return;
      setRows(res.data);
      setPagination(res.pagination);
    } catch (err) {
      if (!current()) return;
      setError(err instanceof ApiError ? err.message : "Could not load patients");
      setRows([]);
    } finally {
      if (current()) setLoading(false);
    }
  }, [officeId, q, active, page, sort, order, dateField, from, to]);

  useEffect(() => {
    if (!needsRestore) void load();
  }, [load, needsRestore]);

  useEffect(() => {
    setRows([]);
    setPagination(null);
  }, [officeId]);

  const go = (next: Partial<PatientsSearch>) =>
    navigate({
      to: "/offices/$officeId/patients",
      params: { officeId },
      search: { q: q || undefined, page, active, sort, order, dateField: from || to ? dateField : undefined, from, to, ...next },
    });

  function onSearch(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (debounce.current) window.clearTimeout(debounce.current);
    go({ q: String(new FormData(e.currentTarget).get("q") ?? "").trim() || undefined, page: 1 });
  }

  // Search as you type (debounced); Enter still submits immediately.
  const debounce = useRef<number | null>(null);
  function onType(value: string) {
    if (debounce.current) window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(() => {
      const next = value.trim() || undefined;
      if (next !== (q || undefined)) go({ q: next, page: 1 });
    }, 350);
  }
  useEffect(() => () => { if (debounce.current) window.clearTimeout(debounce.current); }, []);

  function toggleSort(field: PatientSort) {
    if (sort === field) go({ order: order === "asc" ? "desc" : "asc", page: 1 });
    else go({ sort: field, order: "asc", page: 1 });
  }

  if (!me) return null;

  const cols = COLUMNS.filter((c) => visible.includes(c.key) && (lastVisitSupported || c.key !== "lastVisitDate"));

  const cell = (p: PatientSummary, key: ColKey) => {
    switch (key) {
      case "name": return <span className="font-medium">{fullName(p)}</span>;
      case "patientId": return <span className="font-mono text-xs">{p.patientId}</span>;
      case "birthDate": {
        const age = ageFrom(p.birthDate);
        return <span className="whitespace-nowrap">{dateLabel(p.birthDate)}{age !== null && <span className="ml-1 text-xs">({age})</span>}</span>;
      }
      case "sex": return p.sex ?? "";
      case "phone": return <span className="whitespace-nowrap">{p.cellPhone ?? p.homePhone ?? ""}</span>;
      case "email": return <span className="block max-w-56 truncate">{p.email ?? ""}</span>;
      case "city": return [p.city, p.state].filter(Boolean).join(", ");
      case "coverage": return <CoverageCell coverage={p.coverage} />;
      case "lastVisitDate": return <span className="whitespace-nowrap">{dateLabel(p.lastVisitDate)}</span>;
      case "status": return <Badge variant="outline" className="text-muted-foreground px-1.5">{p.active ? "Active" : "Inactive"}</Badge>;
    }
  };

  return (
    <>
      <SiteHeader title="Patients">
        {offices.length > 1 ? (
          <Select value={officeId} onValueChange={(id) => navigate({ to: "/offices/$officeId/patients", params: { officeId: id }, search: {} })}>
            <SelectTrigger size="sm" className="w-56" aria-label="Office">
              <BuildingIcon className="text-muted-foreground size-4" />
              <SelectValue placeholder="Select office" />
            </SelectTrigger>
            <SelectContent>
              {offices.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name}
                  {o.companyName ? <span className="text-muted-foreground ml-1 text-xs">{o.companyName}</span> : null}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          office && (
            <Button asChild variant="ghost" size="sm">
              <Link to="/offices/$officeId" params={{ officeId }}>{office.name}</Link>
            </Button>
          )
        )}
      </SiteHeader>
      <div className="flex flex-col gap-4 p-4 lg:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <form onSubmit={onSearch} className="relative">
            <SearchIcon className="text-muted-foreground absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
            <Input name="q" placeholder="Search name, patient ID, phone or email" defaultValue={q} onChange={(e) => onType(e.target.value)} className="h-8 w-80 pl-8" autoFocus />
          </form>
          <Select value={active} onValueChange={(v) => go({ active: v as "true" | "false", page: 1 })}>
            <SelectTrigger size="sm" className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="true">Active patients</SelectItem>
              <SelectItem value="false">All patients</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1">
            <Select value={lastVisitSupported ? dateField : "birthDate"} onValueChange={(v) => go({ dateField: v as "lastVisitDate" | "birthDate", from: undefined, to: undefined, page: 1 })}>
              <SelectTrigger size="sm" className="w-32" aria-label="Date field"><SelectValue /></SelectTrigger>
              <SelectContent>
                {lastVisitSupported && <SelectItem value="lastVisitDate">Last visit</SelectItem>}
                <SelectItem value="birthDate">Birth date</SelectItem>
              </SelectContent>
            </Select>
            <DateRangePicker
              value={{ from, to }}
              onChange={(r) => go({ dateField, from: r.from, to: r.to, page: 1 })}
              placeholder={dateField === "birthDate" ? "Any birth date" : "Any visit date"}
              presets={dateField === "birthDate" ? "birthdays" : "visits"}
            />
          </div>
          {(q || from || to) && (
            <Button variant="outline" size="sm" className="h-8" onClick={() => go({ q: undefined, from: undefined, to: undefined, page: 1 })}>
              <XIcon /> Clear
            </Button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <span className="text-muted-foreground text-sm">
              {pagination ? `${pagination.total.toLocaleString()} patient${pagination.total === 1 ? "" : "s"}` : ""}
            </span>
            <ColumnPicker fields={ALL_KEYS} labels={Object.fromEntries(COLUMNS.map((c) => [c.key, c.label]))} value={visible} onChange={chooseColumns} />
          </div>
        </div>

        {error && <div className="text-destructive bg-destructive/10 rounded-md px-3 py-2 text-sm">{error}</div>}

        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader className="bg-muted">
              <TableRow>
                {cols.map((c) => (
                  <TableHead key={c.key}>
                    {c.sort ? (
                      <button
                        type="button"
                        className="hover:text-foreground -ml-2 inline-flex h-8 items-center gap-1 rounded-md px-2"
                        onClick={() => toggleSort(c.sort!)}
                        aria-sort={sort === c.sort ? (order === "asc" ? "ascending" : "descending") : "none"}
                      >
                        {c.label}
                        {sort === c.sort ? (order === "asc" ? <ArrowUpIcon className="size-3.5" /> : <ArrowDownIcon className="size-3.5" />) : <ArrowUpDownIcon className="size-3.5 opacity-40" />}
                      </button>
                    ) : (
                      c.label
                    )}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={cols.length} className="h-24 text-center"><LoaderIcon className="text-muted-foreground mx-auto size-4 animate-spin" /></TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={cols.length} className="text-muted-foreground h-24 text-center">No patients match.</TableCell></TableRow>
              ) : (
                rows.map((p) => (
                  <TableRow
                    key={p.id}
                    className="cursor-pointer"
                    onClick={() => navigate({ to: "/offices/$officeId/patients/$patientId", params: { officeId, patientId: p.patientId } })}
                  >
                    {cols.map((c) => (
                      <TableCell key={c.key} className={c.key === "name" ? "" : "text-muted-foreground"}>{cell(p, c.key)}</TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
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
