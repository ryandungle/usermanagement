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
import { api, ApiError, type Office, type Pagination, type PatientSort, type PatientSummary } from "@/lib/api";
import { ageFrom, dateLabel, fullName } from "@/lib/format";
import { useMe } from "@/lib/me";

const PAGE_SIZE = 25;

export interface PatientsSearch {
  q?: string;
  page?: number;
  active?: "true" | "false";
  sort?: PatientSort;
  order?: "asc" | "desc";
}

type ColKey = "name" | "patientId" | "birthDate" | "sex" | "phone" | "email" | "city" | "lastVisitDate" | "status";

const COLUMNS: { key: ColKey; label: string; sort?: PatientSort }[] = [
  { key: "name", label: "Patient", sort: "lastName" },
  { key: "patientId", label: "ID", sort: "patientId" },
  { key: "birthDate", label: "Born", sort: "birthDate" },
  { key: "sex", label: "Sex" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "city", label: "City", sort: "city" },
  { key: "lastVisitDate", label: "Last visit", sort: "lastVisitDate" },
  { key: "status", label: "Status" },
];
const ALL_KEYS = COLUMNS.map((c) => c.key);

export function PatientsPage({ officeId, search }: { officeId: string; search: PatientsSearch }) {
  const { me } = useMe();
  const navigate = useNavigate();
  const [office, setOffice] = useState<Office | null>(null);
  const [offices, setOffices] = useState<Office[]>([]);
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
    try {
      localStorage.setItem("um-patients-office", officeId);
    } catch {}
  }, [officeId]);

  // Offices in the viewer's scope that have a database connector.
  useEffect(() => {
    api.listOffices({}).then((r) => setOffices(r.data.filter((o) => o.hasConnector))).catch(() => setOffices([]));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listPatients(officeId, { q: q || undefined, active, page, pageSize: PAGE_SIZE, sort, order });
      setRows(res.data);
      setPagination(res.pagination);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load patients");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [officeId, q, active, page, sort, order]);

  useEffect(() => {
    void load();
  }, [load]);

  const go = (next: Partial<PatientsSearch>) =>
    navigate({
      to: "/offices/$officeId/patients",
      params: { officeId },
      search: { q: q || undefined, page, active, sort, order, ...next },
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

  const cols = COLUMNS.filter((c) => visible.includes(c.key));

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
          {q && (
            <Button variant="outline" size="sm" className="h-8" onClick={() => go({ q: undefined, page: 1 })}>
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
