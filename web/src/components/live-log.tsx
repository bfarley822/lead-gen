"use client";

import { useState, useEffect, useRef } from "react";

type RunData = {
  id: number;
  city: string;
  store_address: string | null;
  status: string;
  started_at: string;
  completed_at: string | null;
  event_count: number;
  error: string | null;
  log: string;
};

function parseLogs(log: string) {
  return log
    .split("\n")
    .filter((l) => l.trim())
    .map((line) => {
      const match = line.match(/^\[(\d{2}:\d{2}:\d{2})\]\s(.*)$/);
      return match
        ? { time: match[1], message: match[2] }
        : { time: "", message: line };
    });
}

function stageFromMessage(msg: string): string | null {
  const match = msg.match(/^Stage (\d):/);
  return match ? match[1] : null;
}

export function LiveLog({ runId, initial }: { runId: number; initial: RunData }) {
  const [run, setRun] = useState<RunData>(initial);
  const logEndRef = useRef<HTMLDivElement>(null);
  const isActive = run.status === "running";

  useEffect(() => {
    if (!isActive) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/runs/${runId}`);
        if (res.ok) {
          const data = await res.json();
          setRun(data);
          if (data.status !== "running") {
            clearInterval(interval);
          }
        }
      } catch {
        /* ignore fetch errors */
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [runId, isActive]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [run.log]);

  const logs = parseLogs(run.log);
  const elapsed = (() => {
    const s = new Date(run.started_at).getTime();
    const e = run.completed_at ? new Date(run.completed_at).getTime() : Date.now();
    const sec = Math.round((e - s) / 1000);
    if (sec < 60) return `${sec}s`;
    return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  })();

  const currentStage = (() => {
    for (let i = logs.length - 1; i >= 0; i--) {
      const s = stageFromMessage(logs[i].message);
      if (s) return parseInt(s, 10);
    }
    return 0;
  })();

  const stages = [
    "Collect",
    "Diff",
    "Pre-filter",
    "AI Dedup",
    "AI Triage",
    "AI Research",
    "AI Score",
    "Report",
  ];

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-card p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between text-sm">
          <span className="font-bold">
            {isActive ? (
              <span className="flex items-center gap-2 text-accent">
                <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-accent" />
                Running...
              </span>
            ) : run.status === "completed" ? (
              <span className="text-foreground">Completed</span>
            ) : (
              <span className="text-foreground/60">Failed</span>
            )}
          </span>
          <span className="font-mono text-muted">{elapsed}</span>
        </div>

        <div className="flex gap-1.5">
          {stages.map((name, i) => {
            const stageNum = i + 1;
            let bg: string;
            if (run.status === "failed" && stageNum === currentStage) {
              bg = "bg-foreground/40";
            } else if (stageNum < currentStage) {
              bg = "bg-foreground";
            } else if (stageNum === currentStage) {
              bg = isActive ? "animate-pulse bg-accent" : "bg-foreground";
            } else {
              bg = "bg-card-border";
            }

            return (
              <div key={name} className="flex-1">
                <div className={`h-2.5 rounded-full ${bg}`} />
                <p className="mt-1.5 text-center text-[10px] font-medium text-muted">
                  {name}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {run.error && (
        <div className="rounded-2xl bg-subtle px-6 py-4 text-sm font-medium text-foreground/70 shadow-sm">
          {run.error}
        </div>
      )}

      <div className="rounded-2xl bg-card shadow-sm">
        <div className="flex items-center justify-between px-6 py-4">
          <h2 className="text-sm font-bold text-muted uppercase tracking-wider">Pipeline Log</h2>
          <span className="rounded-full bg-accent-light px-3 py-1 text-xs font-bold text-accent">{logs.length} lines</span>
        </div>
        <div className="max-h-[700px] overflow-y-auto border-t border-card-border/50 p-5 font-mono text-xs leading-relaxed">
          {logs.length === 0 ? (
            <p className="text-muted">Waiting for output...</p>
          ) : (
            logs.map((entry, i) => {
              const isStageHeader = stageFromMessage(entry.message) !== null;
              const isComplete = entry.message.includes("Pipeline complete");
              const isFail = entry.message.includes("FAILED");
              const isDetail = entry.message.startsWith("    ");
              const isBullet = entry.message.trimStart().startsWith("•");
              const isArrow = entry.message.trimStart().startsWith("→");
              const isRejected = entry.message.includes("Rejected:");
              const isKept = entry.message.includes("Kept:");
              const isScored = entry.message.includes("Scored #");

              return (
                <div
                  key={i}
                  className={`py-0.5 ${
                    isStageHeader
                      ? "mt-3 font-bold text-accent text-sm"
                      : isComplete
                        ? "mt-3 font-bold text-foreground text-sm"
                        : isFail
                          ? "font-bold text-foreground/60"
                          : isRejected
                            ? "text-muted"
                            : isKept
                              ? "text-foreground/80"
                              : isScored
                                ? "text-accent/70"
                                : isArrow
                                  ? "text-foreground/60"
                                  : isBullet
                                    ? "text-foreground/40"
                                    : isDetail
                                      ? "text-foreground/40"
                                      : "text-foreground/70"
                  }`}
                >
                  {entry.time && (
                    <span className="mr-3 text-muted/60">{entry.time}</span>
                  )}
                  {entry.message}
                </div>
              );
            })
          )}
          <div ref={logEndRef} />
        </div>
      </div>

      {run.status === "completed" && run.event_count > 0 && (
        <div className="rounded-2xl bg-card px-6 py-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted">
              Found <strong className="font-bold text-foreground">{run.event_count}</strong> events above threshold
            </span>
            <a
              href={`/locations/${encodeURIComponent(run.city)}`}
              className="rounded-full bg-accent px-5 py-2 text-sm font-bold text-white transition-colors hover:bg-accent-hover"
            >
              View events &rarr;
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
