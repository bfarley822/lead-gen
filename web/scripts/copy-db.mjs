#!/usr/bin/env node
import { execSync } from "node:child_process";
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(webRoot, "..");
const src = path.join(repoRoot, "data", "lead-gen.db");
const dest = path.join(webRoot, "data", "lead-gen.db");

if (!existsSync(src)) {
  console.error(`copy-db: source not found: ${src}`);
  console.error("Run the lead-gen CLI first so data/lead-gen.db exists.");
  process.exit(1);
}

mkdirSync(path.dirname(dest), { recursive: true });
copyFileSync(src, dest);
console.log(`copy-db: ${src} → ${dest}`);

try {
  execSync(
    `sqlite3 "${dest}" "PRAGMA journal_mode=DELETE; PRAGMA wal_checkpoint(TRUNCATE); VACUUM;"`,
    { stdio: "pipe", timeout: 120_000 }
  );
  console.log("copy-db: journal_mode=DELETE + checkpoint (avoids WAL writes on Vercel read-only FS)");
} catch {
  console.warn(
    "copy-db: sqlite3 CLI not found or checkpoint failed — install SQLite and re-run if production returns 500"
  );
}
