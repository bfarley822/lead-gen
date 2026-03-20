import { NextResponse } from "next/server";
import { getDashboardStats, getLocations, getFranchiseLocations } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const [stats, locations, franchises] = await Promise.all([
    getDashboardStats(),
    getLocations(),
    getFranchiseLocations(),
  ]);
  return NextResponse.json({ stats, locations, franchises });
}
