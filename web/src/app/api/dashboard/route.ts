import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { getDashboardStats, getLocations, getFranchiseLocations } from "@/lib/db";

function cacheSeconds() {
  const raw = process.env.DASHBOARD_CACHE_SECONDS;
  if (raw !== undefined && raw !== "") {
    const n = Number(raw);
    if (!Number.isNaN(n) && n >= 0) return n;
  }
  return 60;
}

const loadDashboardPayload = unstable_cache(
  async () => {
    const [stats, locations, franchises] = await Promise.all([
      getDashboardStats(),
      getLocations(),
      getFranchiseLocations(),
    ]);
    return { stats, locations, franchises };
  },
  ["dashboard-api-bundle"],
  { revalidate: cacheSeconds() }
);

export async function GET() {
  const { stats, locations, franchises } = await loadDashboardPayload();
  return NextResponse.json({
    stats,
    locations,
    franchises,
    pipelineEnabled: !process.env.VERCEL,
  });
}
