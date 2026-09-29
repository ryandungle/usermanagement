import * as React from "react";
import { CalendarIcon, XIcon } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";

export interface DateRangeValue {
  from?: string; // YYYY-MM-DD
  to?: string;
}

const toKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fromKey = (s?: string) => (s ? new Date(`${s}T00:00:00`) : undefined);
const fmt = (s?: string) => (s ? new Date(`${s}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");

function preset(days: number): DateRangeValue {
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - days);
  return { from: toKey(from), to: toKey(to) };
}

/** Popover calendar in range mode with quick presets. Values are YYYY-MM-DD strings. */
export function DateRangePicker({
  value,
  onChange,
  placeholder = "Any date",
  presets = "visits",
}: {
  value: DateRangeValue;
  onChange: (next: DateRangeValue) => void;
  placeholder?: string;
  /** Which quick presets to show: recent windows for visits, age bands for birthdays. */
  presets?: "visits" | "birthdays";
}) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<DateRange | undefined>();
  React.useEffect(() => {
    if (open) setDraft(value.from || value.to ? { from: fromKey(value.from), to: fromKey(value.to) } : undefined);
  }, [open, value.from, value.to]);

  const label = value.from && value.to ? `${fmt(value.from)} – ${fmt(value.to)}` : value.from ? `From ${fmt(value.from)}` : value.to ? `Until ${fmt(value.to)}` : placeholder;
  const active = !!(value.from || value.to);

  const apply = (next: DateRangeValue) => {
    onChange(next);
    setOpen(false);
  };

  const year = new Date().getFullYear();
  const quick: { label: string; range: DateRangeValue }[] =
    presets === "visits"
      ? [
          { label: "Last 30 days", range: preset(30) },
          { label: "Last 90 days", range: preset(90) },
          { label: "Last 12 months", range: preset(365) },
          { label: "This year", range: { from: `${year}-01-01`, to: toKey(new Date()) } },
          { label: "Over 1 year ago", range: { to: preset(365).from } },
        ]
      : [
          { label: "Children (under 18)", range: { from: `${year - 18}-01-01` } },
          { label: "Adults 18–64", range: { from: `${year - 64}-01-01`, to: `${year - 18}-12-31` } },
          { label: "Seniors (65+)", range: { to: `${year - 65}-12-31` } },
          { label: "Born this month", range: { from: toKey(new Date(year, new Date().getMonth(), 1)), to: toKey(new Date(year, new Date().getMonth() + 1, 0)) } },
        ];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={`h-8 justify-start font-normal ${active ? "" : "text-muted-foreground"}`}>
          <CalendarIcon />
          {label}
          {active && (
            <span
              role="button"
              aria-label="Clear dates"
              className="hover:bg-muted ml-1 rounded-sm"
              onClick={(e) => {
                e.stopPropagation();
                onChange({});
              }}
            >
              <XIcon className="size-3.5" />
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex">
          <div className="flex w-40 flex-col gap-1 border-r p-2">
            {quick.map((q) => (
              <Button key={q.label} variant="ghost" size="sm" className="justify-start" onClick={() => apply(q.range)}>
                {q.label}
              </Button>
            ))}
          </div>
          <div className="flex flex-col">
            <Calendar
              mode="range"
              numberOfMonths={2}
              selected={draft}
              onSelect={setDraft}
              defaultMonth={draft?.from ?? (presets === "birthdays" ? new Date(year - 30, 0, 1) : new Date())}
              captionLayout="dropdown"
              startMonth={new Date(1900, 0)}
              endMonth={new Date(year + 1, 11)}
            />
            <Separator />
            <div className="flex items-center justify-end gap-2 p-2">
              <span className="text-muted-foreground mr-auto text-xs">{draft?.from ? `${fmt(toKey(draft.from))}${draft.to ? ` – ${fmt(toKey(draft.to))}` : " – …"}` : "Pick a start and end day"}</span>
              <Button variant="ghost" size="sm" onClick={() => apply({})}>Clear</Button>
              <Button size="sm" disabled={!draft?.from} onClick={() => apply({ from: draft?.from ? toKey(draft.from) : undefined, to: toKey(draft?.to ?? draft!.from!) })}>
                Apply
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
