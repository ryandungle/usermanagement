import * as React from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useIsMobile } from "@/hooks/use-mobile";
import type { Overview } from "@/lib/api";

const chartConfig = {
  signIns: { label: "Sign-ins", color: "var(--chart-1)" },
  newUsers: { label: "New users", color: "var(--chart-2)" },
} satisfies ChartConfig;

type Range = "90d" | "30d" | "7d";

const fmtDay = (v: string) => new Date(`${v}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function ChartAreaInteractive({ overview }: { overview: Overview | null }) {
  const isMobile = useIsMobile();
  const [range, setRange] = React.useState<Range>("90d");

  React.useEffect(() => {
    if (isMobile) setRange("7d");
  }, [isMobile]);

  const data = React.useMemo(() => {
    const series = overview?.series ?? [];
    const days = range === "90d" ? 90 : range === "30d" ? 30 : 7;
    return series.slice(-days);
  }, [overview, range]);

  const totals = React.useMemo(
    () => data.reduce((acc, d) => ({ signIns: acc.signIns + d.signIns, newUsers: acc.newUsers + d.newUsers }), { signIns: 0, newUsers: 0 }),
    [data],
  );

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Activity</CardTitle>
        <CardDescription>
          <span className="hidden @[540px]/card:block">
            {totals.signIns.toLocaleString()} sign-ins and {totals.newUsers.toLocaleString()} new users in the last{" "}
            {range === "90d" ? "3 months" : range === "30d" ? "30 days" : "7 days"}
          </span>
          <span className="@[540px]/card:hidden">Last {range === "90d" ? "3 months" : range === "30d" ? "30 days" : "7 days"}</span>
        </CardDescription>
        <CardAction>
          <ToggleGroup
            type="single"
            value={range}
            onValueChange={(v) => v && setRange(v as Range)}
            variant="outline"
            className="hidden *:data-[slot=toggle-group-item]:!px-4 @[767px]/card:flex"
          >
            <ToggleGroupItem value="90d">Last 3 months</ToggleGroupItem>
            <ToggleGroupItem value="30d">Last 30 days</ToggleGroupItem>
            <ToggleGroupItem value="7d">Last 7 days</ToggleGroupItem>
          </ToggleGroup>
          <Select value={range} onValueChange={(v) => setRange(v as Range)}>
            <SelectTrigger className="flex w-40 **:data-[slot=select-value]:block **:data-[slot=select-value]:truncate @[767px]/card:hidden" size="sm" aria-label="Select a range">
              <SelectValue placeholder="Last 3 months" />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="90d" className="rounded-lg">Last 3 months</SelectItem>
              <SelectItem value="30d" className="rounded-lg">Last 30 days</SelectItem>
              <SelectItem value="7d" className="rounded-lg">Last 7 days</SelectItem>
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        <ChartContainer config={chartConfig} className="aspect-auto h-[250px] w-full">
          <AreaChart data={data} margin={{ left: 4, right: 4 }}>
            <defs>
              <linearGradient id="fillSignIns" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-signIns)" stopOpacity={0.8} />
                <stop offset="95%" stopColor="var(--color-signIns)" stopOpacity={0.1} />
              </linearGradient>
              <linearGradient id="fillNewUsers" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-newUsers)" stopOpacity={0.8} />
                <stop offset="95%" stopColor="var(--color-newUsers)" stopOpacity={0.1} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={32} tickFormatter={fmtDay} />
            <YAxis width={28} tickLine={false} axisLine={false} allowDecimals={false} tickMargin={4} />
            <ChartTooltip
              cursor={{ strokeDasharray: "3 3" }}
              content={<ChartTooltipContent labelFormatter={(v) => fmtDay(String(v))} indicator="dot" />}
            />
            <Area dataKey="newUsers" type="natural" fill="url(#fillNewUsers)" stroke="var(--color-newUsers)" strokeWidth={2} />
            <Area dataKey="signIns" type="natural" fill="url(#fillSignIns)" stroke="var(--color-signIns)" strokeWidth={2} />
            <ChartLegend content={<ChartLegendContent />} />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
