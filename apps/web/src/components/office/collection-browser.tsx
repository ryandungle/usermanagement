import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ChevronLeftIcon, ChevronRightIcon, LoaderIcon, RefreshCwIcon, SearchIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { humanizeCollectionName } from "@usermanagement/shared";
import { api, ApiError, type CollectionInfo, type DocsPage } from "@/lib/api";
import { CollectionPicker, PreferredChips } from "./collection-picker";

const PAGE_SIZE = 25;

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const s = JSON.stringify(value);
  return s.length > 60 ? s.slice(0, 57) + "…" : s;
}

export function CollectionBrowser({ officeId }: { officeId: string }) {
  const [collections, setCollections] = useState<CollectionInfo[] | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [page, setPage] = useState<DocsPage | null>(null);
  const [pageNo, setPageNo] = useState(1);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);

  const loadCollections = useCallback(async () => {
    setError(null);
    try {
      const res = await api.listCollections(officeId);
      setCollections(res.data);
      setActive((cur) => cur && res.data.some((c) => c.name === cur) ? cur : (res.data[0]?.name ?? null));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not list collections");
      setCollections([]);
    }
  }, [officeId]);

  useEffect(() => {
    void loadCollections();
  }, [loadCollections]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .listDocuments(officeId, active, { q: q || undefined, page: pageNo, pageSize: PAGE_SIZE })
      .then((res) => { if (!cancelled) setPage(res); })
      .catch((err) => { if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load documents"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => {
      cancelled = true;
    };
  }, [officeId, active, q, pageNo]);

  function onSearch(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setQ(String(new FormData(e.currentTarget).get("q") ?? "").trim());
    setPageNo(1);
  }

  const fields = page?.fields ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Data</CardTitle>
        <CardDescription>Read-only view of the connected database. Pick a collection to browse its documents.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {collections === null ? (
          <div className="text-muted-foreground flex items-center gap-2 text-sm"><LoaderIcon className="size-4 animate-spin" /> Loading collections…</div>
        ) : collections.length === 0 ? (
          <p className="text-muted-foreground text-sm">{error ?? "No collections found in this database."}</p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <CollectionPicker collections={collections} value={active} onChange={(v) => { setActive(v); setPageNo(1); setQ(""); }} />
              <Button variant="ghost" size="icon" className="size-8" onClick={loadCollections} aria-label="Refresh collections">
                <RefreshCwIcon />
              </Button>
              <span className="text-muted-foreground text-xs">{collections.length} collections</span>
              <form onSubmit={onSearch} className="relative ml-auto">
                <SearchIcon className="text-muted-foreground absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
                <Input name="q" placeholder={active ? `Search ${humanizeCollectionName(active).toLowerCase()}` : "Search text fields"} defaultValue={q} className="h-8 w-56 pl-8" />
              </form>
            </div>
            <PreferredChips collections={collections} value={active} onChange={(v) => { setActive(v); setPageNo(1); setQ(""); }} />
          </div>
        )}

        {error && collections && collections.length > 0 && (
          <div className="text-destructive bg-destructive/10 flex items-center gap-2 rounded-md px-3 py-2 text-sm"><XIcon className="size-4" /> {error}</div>
        )}

        {active && (
          <>
            <div className="overflow-auto rounded-lg border">
              <Table>
                <TableHeader className="bg-muted">
                  <TableRow>
                    {fields.map((f) => (
                      <TableHead key={f} className="whitespace-nowrap">{f}</TableHead>
                    ))}
                    {fields.length === 0 && <TableHead>Document</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow><TableCell colSpan={Math.max(1, fields.length)} className="h-24 text-center"><LoaderIcon className="text-muted-foreground mx-auto size-4 animate-spin" /></TableCell></TableRow>
                  ) : !page || page.data.length === 0 ? (
                    <TableRow><TableCell colSpan={Math.max(1, fields.length)} className="text-muted-foreground h-24 text-center">No documents.</TableCell></TableRow>
                  ) : (
                    page.data.map((doc, i) => (
                      <TableRow key={String(doc._id ?? i)} className="cursor-pointer" onClick={() => setSelected(doc)}>
                        {fields.map((f) => (
                          <TableCell key={f} className="max-w-64 truncate whitespace-nowrap font-mono text-xs">{cell(doc[f])}</TableCell>
                        ))}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {page ? `${page.pagination.total.toLocaleString()} document${page.pagination.total === 1 ? "" : "s"}` : ""}
              </span>
              <div className="flex items-center gap-2">
                <span>Page {page?.pagination.page ?? 1} of {page?.pagination.totalPages ?? 1}</span>
                <Button variant="outline" size="icon" className="size-8" disabled={pageNo <= 1 || loading} onClick={() => setPageNo((p) => p - 1)}><ChevronLeftIcon /></Button>
                <Button variant="outline" size="icon" className="size-8" disabled={!page || pageNo >= page.pagination.totalPages || loading} onClick={() => setPageNo((p) => p + 1)}><ChevronRightIcon /></Button>
              </div>
            </div>
          </>
        )}
      </CardContent>

      <Sheet open={selected !== null} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full overflow-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>{active ? humanizeCollectionName(active) : "Document"}</SheetTitle>
            <SheetDescription className="font-mono text-xs">{selected ? String(selected._id ?? "") : ""}</SheetDescription>
          </SheetHeader>
          <pre className="bg-muted mx-4 mb-4 overflow-auto rounded-md p-3 font-mono text-xs">{selected ? JSON.stringify(selected, null, 2) : ""}</pre>
        </SheetContent>
      </Sheet>
    </Card>
  );
}
