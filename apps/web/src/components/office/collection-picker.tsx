import * as React from "react";
import { CheckIcon, ChevronsUpDownIcon, TableIcon } from "lucide-react";
import { humanizeCollectionName, preferredKey } from "@usermanagement/shared";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { CollectionInfo } from "@/lib/api";

const fmt = (n: number | null) => (n === null ? "" : n.toLocaleString());

/** Searchable single-select over collections; scales to hundreds of names. */
export function CollectionPicker({
  collections,
  value,
  onChange,
}: {
  collections: CollectionInfo[];
  value: string | null;
  onChange: (name: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const current = collections.find((c) => c.name === value) ?? null;
  const preferred = collections.filter((c) => preferredKey(c.name));
  const others = collections.filter((c) => !preferredKey(c.name));

  const Item = ({ c }: { c: CollectionInfo }) => (
    <CommandItem
      value={`${c.name} ${humanizeCollectionName(c.name)}`}
      onSelect={() => {
        onChange(c.name);
        setOpen(false);
      }}
    >
      <CheckIcon className={cn("size-4", c.name === value ? "opacity-100" : "opacity-0")} />
      <span className="flex-1 truncate">{humanizeCollectionName(c.name)}</span>
      {c.count !== null && <span className="text-muted-foreground font-mono text-xs tabular-nums">{fmt(c.count)}</span>}
    </CommandItem>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="w-72 justify-between font-normal">
          <span className="flex min-w-0 items-center gap-2">
            <TableIcon className="text-muted-foreground size-4 shrink-0" />
            <span className="truncate">{current ? humanizeCollectionName(current.name) : "Select a collection"}</span>
            {current && current.count !== null && <Badge variant="secondary" className="px-1.5 tabular-nums">{fmt(current.count)}</Badge>}
          </span>
          <ChevronsUpDownIcon className="text-muted-foreground size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Command filter={(value, search) => (value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0)}>
          <CommandInput placeholder={`Search ${collections.length} collections…`} />
          <CommandList className="max-h-80">
            <CommandEmpty>No collection matches.</CommandEmpty>
            {preferred.length > 0 && (
              <CommandGroup heading="Clinic">
                {preferred.map((c) => <Item key={c.name} c={c} />)}
              </CommandGroup>
            )}
            {others.length > 0 && (
              <CommandGroup heading={preferred.length ? "All collections" : undefined}>
                {others.map((c) => <Item key={c.name} c={c} />)}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Quick chips for the clinic collections that exist in this database. */
export function PreferredChips({
  collections,
  value,
  onChange,
}: {
  collections: CollectionInfo[];
  value: string | null;
  onChange: (name: string) => void;
}) {
  const preferred = collections.filter((c) => preferredKey(c.name));
  if (preferred.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {preferred.map((c) => (
        <Button
          key={c.name}
          type="button"
          size="sm"
          variant={c.name === value ? "default" : "outline"}
          className="h-8"
          onClick={() => onChange(c.name)}
        >
          {humanizeCollectionName(c.name)}
          {c.count !== null && (
            <Badge variant={c.name === value ? "secondary" : "outline"} className="ml-1 px-1.5 tabular-nums">
              {fmt(c.count)}
            </Badge>
          )}
        </Button>
      ))}
    </div>
  );
}
