import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from "lucide-react";
import { TableHead } from "@/components/ui/table";

/** Table header cell that toggles a sort field; plain header when no field is given. */
export function SortHead({ label, field, sort, order, onSort, right, className = "" }: {
  label: string;
  field?: string;
  sort?: string;
  order: "asc" | "desc";
  onSort: (f: string) => void;
  right?: boolean;
  className?: string;
}) {
  if (!field) return <TableHead className={`${right ? "text-right" : ""} ${className}`.trim()}>{label}</TableHead>;
  const active = sort === field;
  return (
    <TableHead className={`${right ? "text-right" : ""} ${className}`.trim()}>
      <button
        type="button"
        className={`hover:text-foreground inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-md px-2 ${right ? "-mr-2" : "-ml-2"}`}
        onClick={() => onSort(field)}
        aria-sort={active ? (order === "asc" ? "ascending" : "descending") : "none"}
      >
        {label}
        {active ? (order === "asc" ? <ArrowUpIcon className="size-3.5" /> : <ArrowDownIcon className="size-3.5" />) : <ArrowUpDownIcon className="size-3.5 opacity-40" />}
      </button>
    </TableHead>
  );
}
