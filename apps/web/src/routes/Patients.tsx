import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeftIcon, ChevronRightIcon, LoaderIcon, SearchIcon, XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SiteHeader } from "@/components/site-header";
import { api, ApiError, type Office, type Pagination, type PatientSummary } from "@/lib/api";
import { ageFrom, dateLabel, fullName } from "@/lib/format";
import { useMe } from "@/lib/me";

const PAGE_SIZE = 25;

export interface PatientsSearch {
  q?: string;
  page?: number;
  active?: "true" | "false";
}

export function PatientsPage({ officeId, search }: { officeId: string; search: PatientsSearch }) {
  const { me } = useMe();
  const navigate = useNavigate();
  const [office, setOffice] = useState<Office | null>(null);
  const [rows, setRows] = useState<PatientSummary[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const q = search.q ?? "";
  const page = search.page ?? 1;
  const active = search.active ?? "true";

  useEffect(() => {
    api.getOffice(officeId).then((r) => setOffice(r.data)).catch(() => setOffice(null));
  }, [officeId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listPatients(officeId, { q: q || undefined, active, page, pageSize: PAGE_SIZE });
      setRows(res.data);
      setPagination(res.pagination);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load patients");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [officeId, q, active, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const go = (next: Partial<PatientsSearch>) =>
    navigate({ to: "/offices/$officeId/patients", params: { officeId }, search: { q: q || undefined, page, active, ...next } });

  function onSearch(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    go({ q: String(new FormData(e.currentTarget).get("q") ?? "").trim() || undefined, page: 1 });
  }

  if (!me) return null;

  return (
    <>
      <SiteHeader title="Patients">
        {office && (
          <Button asChild variant="ghost" size="sm">
            <Link to="/offices/$officeId" params={{ officeId }}>{office.name}</Link>
          </Button>
        )}
      </SiteHeader>
      <div className="flex flex-col gap-4 p-4 lg:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <form onSubmit={onSearch} className="relative">
            <SearchIcon className="text-muted-foreground absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
            <Input name="q" placeholder="Search name, patient ID, phone or email" defaultValue={q} className="h-8 w-80 pl-8" autoFocus />
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
          <span className="text-muted-foreground ml-auto text-sm">
            {pagination ? `${pagination.total.toLocaleString()} patient${pagination.total === 1 ? "" : "s"}` : ""}
          </span>
        </div>

        {error && <div className="text-destructive bg-destructive/10 rounded-md px-3 py-2 text-sm">{error}</div>}

        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader className="bg-muted">
              <TableRow>
                <TableHead>Patient</TableHead>
                <TableHead>ID</TableHead>
                <TableHead>Born</TableHead>
                <TableHead>Sex</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>City</TableHead>
                <TableHead>Last visit</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={9} className="h-24 text-center"><LoaderIcon className="text-muted-foreground mx-auto size-4 animate-spin" /></TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="text-muted-foreground h-24 text-center">No patients match.</TableCell></TableRow>
              ) : (
                rows.map((p) => {
                  const age = ageFrom(p.birthDate);
                  return (
                    <TableRow
                      key={p.id}
                      className="cursor-pointer"
                      onClick={() => navigate({ to: "/offices/$officeId/patients/$patientId", params: { officeId, patientId: p.patientId } })}
                    >
                      <TableCell className="font-medium">{fullName(p)}</TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs">{p.patientId}</TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap">{dateLabel(p.birthDate)}{age !== null && <span className="ml-1 text-xs">({age})</span>}</TableCell>
                      <TableCell className="text-muted-foreground">{p.sex ?? ""}</TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap">{p.cellPhone ?? p.homePhone ?? ""}</TableCell>
                      <TableCell className="text-muted-foreground max-w-56 truncate">{p.email ?? ""}</TableCell>
                      <TableCell className="text-muted-foreground">{[p.city, p.state].filter(Boolean).join(", ")}</TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap">{dateLabel(p.lastVisitDate)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-muted-foreground px-1.5">{p.active ? "Active" : "Inactive"}</Badge>
                      </TableCell>
                    </TableRow>
                  );
                })
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
