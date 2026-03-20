import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";
import {
  getRecentRuns,
  getFranchiseLocationById,
  getFranchiseByStoreName,
} from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const runs = await getRecentRuns();
  return NextResponse.json(runs);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    let location = "";
    let storeAddress = "";
    let storeName = "";

    if (typeof body.franchiseId === "number") {
      const franchise = await getFranchiseLocationById(body.franchiseId);
      if (!franchise) {
        return NextResponse.json(
          { error: "Franchise location not found" },
          { status: 404 }
        );
      }
      location = `${franchise.city}, ${franchise.state_initials}`;
      storeAddress = `${franchise.address}, ${franchise.city}, ${franchise.state_initials} ${franchise.zip}`;
      storeName = `${franchise.store_name}, ${franchise.state_initials}`;
    } else if (typeof body.storeName === "string" && body.storeName.trim()) {
      const franchise = await getFranchiseByStoreName(body.storeName.trim());
      if (franchise) {
        location = `${franchise.city}, ${franchise.state_initials}`;
        storeAddress = `${franchise.address}, ${franchise.city}, ${franchise.state_initials} ${franchise.zip}`;
        storeName = `${franchise.store_name}, ${franchise.state_initials}`;
      } else {
        location = body.storeName.trim();
      }
    } else {
      location =
        typeof body.location === "string" ? body.location.trim() : "";
      storeAddress =
        typeof body.storeAddress === "string" ? body.storeAddress.trim() : "";
    }

    if (!location) {
      return NextResponse.json(
        { error: "Location is required" },
        { status: 400 }
      );
    }

    const cliRoot = path.resolve(process.cwd(), "..");
    const tsx = path.join(cliRoot, "node_modules", ".bin", "tsx");
    const script = path.join(cliRoot, "src", "index.ts");

    const args = [script, "-l", location];
    if (storeAddress) {
      args.push("--store-address", storeAddress);
    }
    if (storeName) {
      args.push("--store-name", storeName);
    }

    const child = spawn(tsx, args, {
      cwd: cliRoot,
      detached: true,
      stdio: "ignore",
    });

    child.unref();

    return NextResponse.json({
      success: true,
      location,
      storeAddress,
      storeName,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
