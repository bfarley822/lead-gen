import type { DashboardStats } from "@/lib/db";

const stats = [
  { key: "totalLocations" as const, label: "Locations" },
  { key: "totalEvents" as const, label: "Total Events" },
  { key: "activeEvents" as const, label: "Active Events" },
  { key: "highScoreEvents" as const, label: "Score 60+" },
];

export function StatsBar({ data }: { data: DashboardStats }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {stats.map((s) => (
        <div
          key={s.key}
          className="rounded-xl border border-card-border bg-card px-5 py-4"
        >
          <p className="text-sm text-muted">{s.label}</p>
          <p className="mt-1 text-2xl font-bold tracking-tight">
            {data[s.key].toLocaleString()}
          </p>
        </div>
      ))}
    </div>
  );
}
