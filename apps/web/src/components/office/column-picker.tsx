import * as React from "react";
import { CheckIcon, Columns3Icon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** Searchable checklist of document fields; `value` is the ordered list of visible columns. */
export function ColumnPicker({
  fields,
  value,
  onChange,
}: {
  fields: string[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const selected = new Set(value);

  const toggle = (f: string) => {
    if (selected.has(f)) onChange(value.filter((x) => x !== f));
    else onChange(fields.filter((x) => selected.has(x) || x === f)); // keep document order
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8">
          <Columns3Icon />
          Columns
          <span className="text-muted-foreground tabular-nums">{value.length}/{fields.length}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="end">
        <Command filter={(v, s) => (v.toLowerCase().includes(s.toLowerCase()) ? 1 : 0)}>
          <CommandInput placeholder={`Search ${fields.length} fields…`} />
          <CommandList className="max-h-72">
            <CommandEmpty>No field matches.</CommandEmpty>
            <CommandGroup>
              {fields.map((f) => (
                <CommandItem key={f} value={f} onSelect={() => toggle(f)}>
                  <span className={cn("border-primary flex size-4 items-center justify-center rounded-sm border", selected.has(f) ? "bg-primary text-primary-foreground" : "opacity-50")}>
                    {selected.has(f) && <CheckIcon className="size-3" />}
                  </span>
                  <span className="truncate font-mono text-xs">{f}</span>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup>
              <CommandItem value="__all" onSelect={() => onChange(fields)}>Show all</CommandItem>
              <CommandItem value="__none" onSelect={() => onChange(fields.slice(0, 1))}>Only first column</CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
