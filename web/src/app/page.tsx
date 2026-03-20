"use client";

import { useState, useEffect, useCallback, type FormEvent } from "react";
import Link from "next/link";
import { LocationCard } from "@/components/location-card";
import {
  FranchisePicker,
  type FranchiseOption,
} from "@/components/franchise-picker";

type DashboardStats = {
  totalLocations: number;
  totalEvents: number;
  activeEvents: number;
  highScoreEvents: number;
};

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

const statsDef = [
  { key: "totalLocations" as const, label: "Locations", icon: "📍" },
  { key: "totalEvents" as const, label: "Total Events", icon: "📅" },
  { key: "activeEvents" as const, label: "Active Events", icon: "⚡" },
  { key: "highScoreEvents" as const, label: "Score 60+", icon: "🎯" },
];

type RunFeedback = {
  message: string;
  isError: boolean;
};

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [locations, setLocations] = useState<LocationSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const [franchises, setFranchises] = useState<FranchiseOption[]>([]);
  const [pipelineEnabled, setPipelineEnabled] = useState(false);
  const [selectedFranchise, setSelectedFranchise] =
    useState<FranchiseOption | null>(null);
  const [runLoading, setRunLoading] = useState(false);
  const [runFeedback, setRunFeedback] = useState<RunFeedback | null>(null);
  const [runningCities, setRunningCities] = useState<Set<string>>(new Set());
  const [syncing, setSyncing] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<RunFeedback | null>(null);

  useEffect(() => {
    let mounted = true;

    async function fetchData() {
      try {
        const res = await fetch("/api/dashboard");
        if (res.ok && mounted) {
          const data = await res.json();
          setStats(data.stats);
          setLocations(data.locations);
          if (data.franchises) setFranchises(data.franchises);
          if (data.pipelineEnabled != null) setPipelineEnabled(data.pipelineEnabled);
          setLoading(false);
        }
      } catch {
        /* ignore */
      }
    }

    fetchData();

    const interval = setInterval(fetchData, 5000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const triggerRun = useCallback(
    async (franchise: FranchiseOption) => {
      try {
        const res = await fetch("/api/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ franchiseId: franchise.id }),
        });
        const data = await res.json();
        if (!res.ok) {
          return {
            success: false,
            error: data.error ?? "Failed to start pipeline",
          };
        }
        return { success: true, location: data.location };
      } catch {
        return { success: false, error: "Network error" };
      }
    },
    []
  );

  const handleFormSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!selectedFranchise || runLoading) return;

      setRunLoading(true);
      setRunFeedback(null);

      const result = await triggerRun(selectedFranchise);
      const label = `${selectedFranchise.store_name} (${selectedFranchise.city}, ${selectedFranchise.state_initials})`;

      if (result.success) {
        setRunFeedback({
          message: `Pipeline started for "${label}"`,
          isError: false,
        });
        setSelectedFranchise(null);
      } else {
        setRunFeedback({
          message: result.error ?? "Unknown error",
          isError: true,
        });
      }

      setRunLoading(false);
    },
    [selectedFranchise, runLoading, triggerRun]
  );

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setSyncFeedback(null);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setSyncFeedback({ message: "Database synced to Turso successfully", isError: false });
      } else {
        setSyncFeedback({ message: data.error ?? "Sync failed", isError: true });
      }
    } catch {
      setSyncFeedback({ message: "Network error during sync", isError: true });
    }
    setSyncing(false);
  }, []);

  const handleRerun = useCallback(
    async (city: string) => {
      setRunningCities((prev) => new Set(prev).add(city));
      setRunFeedback(null);

      try {
        const res = await fetch("/api/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ storeName: city }),
        });
        const data = await res.json();
        if (res.ok) {
          setRunFeedback({
            message: `Pipeline started for "${city}"`,
            isError: false,
          });
        } else {
          setRunFeedback({
            message: `Failed to start "${city}": ${data.error ?? "Unknown error"}`,
            isError: true,
          });
        }
      } catch {
        setRunFeedback({
          message: `Failed to start "${city}": Network error`,
          isError: true,
        });
      }

      setTimeout(() => {
        setRunningCities((prev) => {
          const next = new Set(prev);
          next.delete(city);
          return next;
        });
      }, 3000);
    },
    []
  );

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="mt-1.5 text-muted">
          Franchise event pipeline overview
        </p>
      </div>

      {loading || !stats ? (
        <div className="rounded-2xl bg-card p-16 text-center text-muted shadow-sm">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          <p className="mt-4 text-sm">Loading dashboard...</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
            {statsDef.map((s) => (
              <div
                key={s.key}
                className="rounded-2xl bg-card px-5 py-5 shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg">{s.icon}</span>
                  <p className="text-sm font-medium text-muted">{s.label}</p>
                </div>
                <p className="mt-2 text-3xl font-bold tracking-tight">
                  {stats[s.key].toLocaleString()}
                </p>
              </div>
            ))}
          </div>

          {pipelineEnabled && (
            <div className="rounded-2xl bg-card p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold">Run Pipeline</h2>
                  <p className="mt-1 text-sm text-muted">
                    Select a franchise location to collect and score local events
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <button
                    type="button"
                    onClick={handleSync}
                    disabled={syncing}
                    className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                  >
                    {syncing ? (
                      <span className="flex items-center gap-2">
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                        Syncing...
                      </span>
                    ) : (
                      "Sync to Turso"
                    )}
                  </button>
                  {syncFeedback && (
                    <span className={`text-xs font-medium ${syncFeedback.isError ? "text-red-500" : "text-emerald-600 dark:text-emerald-400"}`}>
                      {syncFeedback.isError ? "✕" : "✓"} {syncFeedback.message}
                    </span>
                  )}
                </div>
              </div>

              <form onSubmit={handleFormSubmit} className="mt-4 space-y-3">
                <div className="flex gap-3 items-end">
                  <div className="flex-1 space-y-1">
                    <label className="text-xs font-medium text-muted">
                      Franchise location
                    </label>
                    <FranchisePicker
                      franchises={franchises}
                      selected={selectedFranchise}
                      onSelect={(f) => {
                        setSelectedFranchise(f);
                        if (runFeedback) setRunFeedback(null);
                      }}
                      disabled={runLoading}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={runLoading || !selectedFranchise}
                    className="rounded-xl bg-accent px-6 py-2.5 text-sm font-bold text-white transition-colors hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                  >
                    {runLoading ? (
                      <span className="flex items-center gap-2">
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                        Starting...
                      </span>
                    ) : (
                      "Run Pipeline"
                    )}
                  </button>
                </div>
                {selectedFranchise && (
                  <p className="text-xs text-muted">
                    {selectedFranchise.address}
                  </p>
                )}
              </form>

              {runFeedback && (
                <div
                  className={`mt-3 flex items-center gap-2 text-sm ${
                    runFeedback.isError
                      ? "text-red-500"
                      : "text-emerald-600 dark:text-emerald-400"
                  }`}
                >
                  <span>{runFeedback.isError ? "✕" : "✓"}</span>
                  <span>{runFeedback.message}</span>
                  {!runFeedback.isError && (
                    <Link
                      href="/runs"
                      className="font-bold text-accent hover:underline"
                    >
                      View runs →
                    </Link>
                  )}
                </div>
              )}
            </div>
          )}

          <div>
            <h2 className="mb-5 text-xl font-bold">Franchise Locations</h2>
            {locations.length === 0 ? (
              <div className="rounded-2xl bg-card p-16 text-center text-muted shadow-sm">
                No locations found. Run the pipeline to start collecting events.
              </div>
            ) : (
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {locations.map((loc) => (
                  <LocationCard
                    key={loc.city}
                    location={loc}
                    onRun={pipelineEnabled ? handleRerun : undefined}
                    running={runningCities.has(loc.city)}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
