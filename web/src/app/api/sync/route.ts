import { NextResponse } from "next/server";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

/**
 * Local dev only: copies the CLI database (repo root data/lead-gen.db) into
 * web/data/lead-gen.db so you can commit it and deploy without Turso.
 */
export async function POST() {
  if (process.env.VERCEL) {
    return NextResponse.json(
      {
        error:
          "Sync runs only on your machine. From the repo: cd web && npm run copy-db — then commit web/data/lead-gen.db and push.",
      },
      { status: 501 }
    );
  }

  try {
    const webRoot = process.cwd();
    const cliRoot = path.resolve(webRoot, "..");
    const src = path.join(cliRoot, "data", "lead-gen.db");
    const dest = path.join(webRoot, "data", "lead-gen.db");

    if (!existsSync(src)) {
      return NextResponse.json(
        { error: `Source database not found: ${src}` },
        { status: 404 }
      );
    }

    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(src, dest);

    return NextResponse.json({
      success: true,
      message:
        "Copied to web/data/lead-gen.db — commit that file and redeploy (Vercel serves it read-only).",
      dest,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
