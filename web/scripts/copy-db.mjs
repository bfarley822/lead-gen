#!/usr/bin/env node
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
