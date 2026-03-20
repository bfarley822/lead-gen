"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { StatusBadge } from "@/components/status-badge";

type RunSummary = {
  id: number;
  city: string;
  store_address: string | null;
  status: string;
  started_at: string;
  completed_at: string | null;
  event_count: number;
  error: string | null;
};

function formatTime(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function duration(start: string, end: string | null): string {
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const sec = Math.round((e - s) / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  return `${min}m ${sec % 60}s`;
}

export default function RunsPage() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function fetchRuns() {
      try {
        const res = await fetch("/api/runs");
        if (res.ok && mounted) {
          setRuns(await res.json());
          setLoading(false);
        }
      } catch {
        /* ignore */
      }
    }

    fetchRuns();

    const interval = setInterval(fetchRuns, 3000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const hasRunning = runs.some((r) => r.status === "running");

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Pipeline Runs</h1>
          <p className="mt-1.5 text-muted">Recent pipeline execution history</p>
        </div>
        {hasRunning && (
          <span className="flex items-center gap-2 rounded-full bg-accent-light px-4 py-2 text-sm font-bold text-accent">
            <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
            Pipeline running
          </span>
        )}
      </div>

      {loading ? (
        <div className="rounded-2xl bg-card p-16 text-center text-muted shadow-sm">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          <p className="mt-4 text-sm">Loading runs...</p>
        </div>
      ) : runs.length === 0 ? (
        <div className="rounded-2xl bg-card p-16 text-center text-muted shadow-sm">
          No pipeline runs yet. Run the CLI to start collecting events.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-card-border">
                <th className="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wider text-muted">
                  Run
                </th>
                <th className="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wider text-muted">
                  Location
                </th>
                <th className="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wider text-muted">
                  Status
                </th>
                <th className="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wider text-muted">
                  Started
                </th>
                <th className="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wider text-muted">
                  Duration
                </th>
                <th className="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wider text-muted">
                  Events
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {runs.map((run) => (
                <tr
                  key={run.id}
                  className={`transition-colors hover:bg-accent-light/40 ${
                    run.status === "running" ? "bg-accent-light/20" : ""
                  }`}
                >
                  <td className="px-5 py-4">
                    <Link
                      href={`/runs/${run.id}`}
                      className="font-mono font-bold text-accent hover:underline"
                    >
                      #{run.id}
                    </Link>
                  </td>
                  <td className="px-5 py-4">
                    <div className="font-semibold">{run.city}</div>
                    {run.store_address && (
                      <div className="text-xs text-muted truncate max-w-[250px]">
                        {run.store_address}
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    <StatusBadge status={run.status} />
                  </td>
                  <td className="px-5 py-4 whitespace-nowrap text-muted">
                    {formatTime(run.started_at)}
                  </td>
                  <td className="px-5 py-4 whitespace-nowrap font-mono text-muted">
                    {duration(run.started_at, run.completed_at)}
                  </td>
                  <td className="px-5 py-4">
                    {run.event_count > 0 ? (
                      <span className="rounded-full bg-accent-light px-3 py-1 text-xs font-bold text-accent">
                        {run.event_count}
                      </span>
                    ) : (
                      <span className="text-muted">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
