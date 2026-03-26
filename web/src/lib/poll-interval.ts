/**
 * Production defaults favor fewer requests (Turso read limits, serverless cost).
 * Override with NEXT_PUBLIC_DASHBOARD_POLL_MS / NEXT_PUBLIC_LIVE_LOG_POLL_MS (milliseconds).
 */

export function dashboardPollMs(): number {
  const raw = process.env.NEXT_PUBLIC_DASHBOARD_POLL_MS;
  if (raw !== undefined && raw !== "") {
    const n = Number(raw);
    if (!Number.isNaN(n) && n >= 1000) return n;
  }
  return process.env.NODE_ENV === "development" ? 5000 : 30000;
}

export function runsListPollMs(): number {
  return dashboardPollMs();
}

export function liveLogPollMs(): number {
  const raw = process.env.NEXT_PUBLIC_LIVE_LOG_POLL_MS;
  if (raw !== undefined && raw !== "") {
    const n = Number(raw);
    if (!Number.isNaN(n) && n >= 500) return n;
  }
  return process.env.NODE_ENV === "development" ? 1500 : 3000;
}
