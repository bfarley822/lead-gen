import { NextResponse } from "next/server";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function fixUnistr(sql: string): string {
  return sql.replace(/unistr\('((?:[^']|'')*?)'\)/g, (_, inner: string) => {
    const decoded = inner.replace(
      /\\u([0-9a-fA-F]{4})/g,
      (__: string, hex: string) => String.fromCharCode(parseInt(hex, 16))
    );
    return `'${decoded}'`;
  });
}

export async function POST() {
  if (process.env.VERCEL) {
    return NextResponse.json(
      { error: "Sync is only available in local development" },
      { status: 501 }
    );
  }

  try {
    const cliRoot = path.resolve(process.cwd(), "..");
    const dbPath = path.join(cliRoot, "data", "lead-gen.db");
    const dumpPath = "/tmp/lead-gen-turso-sync.sql";
    const fixedPath = "/tmp/lead-gen-turso-sync-fixed.sql";

    execSync(`sqlite3 "${dbPath}" .dump > "${dumpPath}"`, {
      timeout: 30_000,
    });

    const raw = readFileSync(dumpPath, "utf-8");
    const fixed = fixUnistr(raw);
    writeFileSync(fixedPath, fixed);

    execSync(`turso db shell lead-gen < "${fixedPath}"`, {
      timeout: 120_000,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
