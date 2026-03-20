import Link from "next/link";
import { StatusBadge } from "./status-badge";

type LocationSummary = {
  city: string;
  status: string;
  completed_at: string | null;
  started_at: string | null;
  event_count: number;
  active_events: number;
  high_score_events: number;
  error: string | null;
};

function formatDate(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.992 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182M21.015 4.356v4.992"
      />
    </svg>
  );
}

export function LocationCard({
  location,
  onRun,
  running,
}: {
  location: LocationSummary;
  onRun?: (city: string) => void;
  running?: boolean;
}) {
  return (
    <div className="group relative rounded-2xl bg-card p-6 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5">
      <Link
        href={`/locations/${encodeURIComponent(location.city)}`}
        className="absolute inset-0 rounded-2xl"
        tabIndex={-1}
        aria-hidden="true"
      />

      <div className="relative pointer-events-none">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-lg font-bold group-hover:text-accent transition-colors">
            {location.city}
          </h3>
          <div className="flex items-center gap-2 pointer-events-auto">
            {onRun && (
              <button
                onClick={() => onRun(location.city)}
                disabled={running}
                className="rounded-lg p-1.5 text-muted hover:bg-accent-light hover:text-accent transition-colors disabled:opacity-40"
                title="Re-run pipeline"
              >
                <RefreshIcon
                  className={`h-4 w-4 ${running ? "animate-spin" : ""}`}
                />
              </button>
            )}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-3 text-center">
          <div className="rounded-xl bg-accent-light py-2.5">
            <p className="text-2xl font-bold text-accent">
              {location.active_events}
            </p>
            <p className="text-xs font-medium text-muted">Active</p>
          </div>
          <div className="rounded-xl bg-emerald-50 dark:bg-emerald-900/20 py-2.5">
            <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
              {location.high_score_events}
            </p>
            <p className="text-xs font-medium text-muted">Score 60+</p>
          </div>
          <div className="rounded-xl bg-subtle py-2.5">
            <p className="text-2xl font-bold text-muted">
              {location.event_count}
            </p>
            <p className="text-xs font-medium text-muted">Total</p>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between text-xs text-muted">
          <span>Last run: {formatDate(location.completed_at)}</span>
          {location.error && (
            <span
              className="truncate text-foreground/50"
              title={location.error}
            >
              {location.error.slice(0, 40)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
