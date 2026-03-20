import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { CollectedEvent } from "./types.js";
import type { ScrapedLocation } from "./scripts/scrape-locations.js";

export type RawEventRow = {
  url_hash: string;
  url: string;
  title: string;
  description: string;
  date_hint: string | null;
  location: string | null;
  source: string;
  first_seen_at: string;
  last_seen_at: string;
};

export type CanonicalEventRow = {
  id: number;
  name: string;
  event_type: string | null;
  location: string | null;
  date_start: string | null;
  date_end: string | null;
  date_display: string | null;
  estimated_attendance: string | null;
  is_recurring: number;
  description: string | null;
  organizer: string | null;
  contact_info: string | null;
  contact_method: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  contact_url: string | null;
  registration_url: string | null;
  suggested_message: string | null;
  score: number;
  reasoning: string | null;
  estimated_revenue_low: number | null;
  estimated_revenue_high: number | null;
  revenue_reasoning: string | null;
  research_summary: string | null;
  page_content_hash: string | null;
  status: string;
  city: string;
  assigned_franchise_id: number | null;
  discovered_via: string | null;
  created_at: string;
  researched_at: string | null;
  updated_at: string;
};

export function normalizeUrl(raw: string): string {
  try {
    const parsed = new URL(raw);
    parsed.hash = "";
    const normalized = parsed.toString().replace(/\/+$/, "");
    return normalized.toLowerCase();
  } catch {
    return raw.toLowerCase().replace(/\/+$/, "");
  }
}

export function hashUrl(url: string): string {
  return createHash("sha256").update(normalizeUrl(url)).digest("hex");
}

export function openDb(dbPath: string): Database.Database {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS raw_events (
      url_hash TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      date_hint TEXT,
      location TEXT,
      source TEXT NOT NULL DEFAULT 'searxng',
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS canonical_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      event_type TEXT,
      location TEXT,
      date_start TEXT,
      date_end TEXT,
      date_display TEXT,
      estimated_attendance TEXT,
      description TEXT,
      organizer TEXT,
      contact_info TEXT,
      registration_url TEXT,
      score INTEGER NOT NULL DEFAULT 0,
      reasoning TEXT,
      research_summary TEXT,
      page_content_hash TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      city TEXT NOT NULL,
      created_at TEXT NOT NULL,
      researched_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS event_sources (
      canonical_event_id INTEGER NOT NULL REFERENCES canonical_events(id) ON DELETE CASCADE,
      url_hash TEXT NOT NULL REFERENCES raw_events(url_hash) ON DELETE CASCADE,
      PRIMARY KEY (canonical_event_id, url_hash)
    );

    CREATE INDEX IF NOT EXISTS idx_canonical_city ON canonical_events(city);
    CREATE INDEX IF NOT EXISTS idx_canonical_status ON canonical_events(status);
    CREATE INDEX IF NOT EXISTS idx_raw_last_seen ON raw_events(last_seen_at);
  `);

  const cols = db.prepare("PRAGMA table_info(canonical_events)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "is_recurring")) {
    db.exec("ALTER TABLE canonical_events ADD COLUMN is_recurring INTEGER NOT NULL DEFAULT 0");
  }
  if (!cols.some((c) => c.name === "assigned_franchise_id")) {
    db.exec("ALTER TABLE canonical_events ADD COLUMN assigned_franchise_id INTEGER REFERENCES franchise_locations(id)");
  }
  if (!cols.some((c) => c.name === "discovered_via")) {
    db.exec("ALTER TABLE canonical_events ADD COLUMN discovered_via TEXT");
  }
  if (!cols.some((c) => c.name === "contact_method")) {
    db.exec("ALTER TABLE canonical_events ADD COLUMN contact_method TEXT");
  }
  if (!cols.some((c) => c.name === "contact_phone")) {
    db.exec("ALTER TABLE canonical_events ADD COLUMN contact_phone TEXT");
  }
  if (!cols.some((c) => c.name === "contact_email")) {
    db.exec("ALTER TABLE canonical_events ADD COLUMN contact_email TEXT");
  }
  if (!cols.some((c) => c.name === "contact_url")) {
    db.exec("ALTER TABLE canonical_events ADD COLUMN contact_url TEXT");
  }
  if (!cols.some((c) => c.name === "suggested_message")) {
    db.exec("ALTER TABLE canonical_events ADD COLUMN suggested_message TEXT");
  }
  if (!cols.some((c) => c.name === "estimated_revenue_low")) {
    db.exec("ALTER TABLE canonical_events ADD COLUMN estimated_revenue_low INTEGER");
  }
  if (!cols.some((c) => c.name === "estimated_revenue_high")) {
    db.exec("ALTER TABLE canonical_events ADD COLUMN estimated_revenue_high INTEGER");
  }
  if (!cols.some((c) => c.name === "revenue_reasoning")) {
    db.exec("ALTER TABLE canonical_events ADD COLUMN revenue_reasoning TEXT");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS franchise_locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      address TEXT NOT NULL,
      city TEXT NOT NULL,
      state TEXT NOT NULL,
      state_initials TEXT NOT NULL,
      zip TEXT NOT NULL,
      lat REAL,
      lng REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_franchise_state ON franchise_locations(state_initials);
    CREATE INDEX IF NOT EXISTS idx_franchise_city ON franchise_locations(city);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS event_franchise_assignments (
      canonical_event_id INTEGER NOT NULL REFERENCES canonical_events(id) ON DELETE CASCADE,
      franchise_id INTEGER NOT NULL REFERENCES franchise_locations(id) ON DELETE CASCADE,
      distance_miles REAL,
      is_closest INTEGER NOT NULL DEFAULT 0,
      assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (canonical_event_id, franchise_id)
    );
    CREATE INDEX IF NOT EXISTS idx_efa_franchise ON event_franchise_assignments(franchise_id);
    CREATE INDEX IF NOT EXISTS idx_efa_event ON event_franchise_assignments(canonical_event_id);
  `);

  const efaCols = db.prepare("PRAGMA table_info(event_franchise_assignments)").all() as { name: string }[];
  if (!efaCols.some((c) => c.name === "is_closest")) {
    db.exec("ALTER TABLE event_franchise_assignments ADD COLUMN is_closest INTEGER NOT NULL DEFAULT 0");
  }

  // Seed junction table from existing data
  const assignmentCount = (db.prepare(
    "SELECT COUNT(*) as c FROM event_franchise_assignments"
  ).get() as { c: number }).c;
  const activeEventCount = (db.prepare(
    "SELECT COUNT(*) as c FROM canonical_events WHERE status = 'active'"
  ).get() as { c: number }).c;

  if (assignmentCount < activeEventCount) {
    db.exec(`
      INSERT OR IGNORE INTO event_franchise_assignments (canonical_event_id, franchise_id, assigned_at)
      SELECT id, assigned_franchise_id, COALESCE(updated_at, datetime('now'))
      FROM canonical_events
      WHERE assigned_franchise_id IS NOT NULL
    `);

    db.exec(`
      INSERT OR IGNORE INTO event_franchise_assignments (canonical_event_id, franchise_id, assigned_at)
      SELECT ce.id, fl.id, COALESCE(ce.updated_at, datetime('now'))
      FROM canonical_events ce
      JOIN franchise_locations fl
        ON LOWER(fl.store_name) = LOWER(TRIM(SUBSTR(ce.city, 1, INSTR(ce.city || ',', ',') - 1)))
        AND LOWER(fl.state_initials) = LOWER(TRIM(SUBSTR(ce.city, INSTR(ce.city || ',', ',') + 1)))
      WHERE ce.status IN ('active', 'past')
        AND ce.id NOT IN (SELECT canonical_event_id FROM event_franchise_assignments)
    `);

    db.exec(`
      INSERT OR IGNORE INTO event_franchise_assignments (canonical_event_id, franchise_id, assigned_at)
      SELECT ce.id, fl.id, COALESCE(ce.updated_at, datetime('now'))
      FROM canonical_events ce
      JOIN franchise_locations fl
        ON LOWER(fl.city) = LOWER(TRIM(SUBSTR(ce.city, 1, INSTR(ce.city || ',', ',') - 1)))
        AND LOWER(fl.state_initials) = LOWER(TRIM(SUBSTR(ce.city, INSTR(ce.city || ',', ',') + 1)))
      WHERE ce.status IN ('active', 'past')
        AND ce.id NOT IN (SELECT canonical_event_id FROM event_franchise_assignments)
    `);
  }

  db.exec(
    "UPDATE event_franchise_assignments SET distance_miles = 0 WHERE distance_miles IS NULL AND is_closest = 1"
  );

  db.exec(`
    CREATE TABLE IF NOT EXISTS city_progress (
      city TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending',
      started_at TEXT,
      completed_at TEXT,
      event_count INTEGER DEFAULT 0,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS pipeline_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      city TEXT NOT NULL,
      store_address TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      started_at TEXT NOT NULL,
      completed_at TEXT,
      event_count INTEGER DEFAULT 0,
      error TEXT,
      log TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_pipeline_runs_city ON pipeline_runs(city);
    CREATE INDEX IF NOT EXISTS idx_pipeline_runs_status ON pipeline_runs(status);
  `);
}

export type DiffResult = {
  newEvents: CollectedEvent[];
  existingCount: number;
  totalCount: number;
};

export function diffRawEvents(db: Database.Database, events: CollectedEvent[]): DiffResult {
  const now = new Date().toISOString();
  const findStmt = db.prepare("SELECT url_hash FROM raw_events WHERE url_hash = ?");
  const insertStmt = db.prepare(`
    INSERT INTO raw_events (url_hash, url, title, description, date_hint, location, source, first_seen_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const touchStmt = db.prepare("UPDATE raw_events SET last_seen_at = ? WHERE url_hash = ?");

  const newEvents: CollectedEvent[] = [];
  let existingCount = 0;

  const runAll = db.transaction(() => {
    for (const event of events) {
      const hash = hashUrl(event.url);
      const existing = findStmt.get(hash) as RawEventRow | undefined;
      if (existing) {
        touchStmt.run(now, hash);
        existingCount++;
      } else {
        insertStmt.run(hash, event.url, event.title, event.description, event.date ?? null, event.locationHint, event.source, now, now);
        newEvents.push(event);
      }
    }
  });
  runAll();

  return { newEvents, existingCount, totalCount: events.length };
}

export function getCanonicalEventsByCity(db: Database.Database, city: string): CanonicalEventRow[] {
  const stmt = db.prepare("SELECT * FROM canonical_events WHERE city = ? ORDER BY score DESC");
  return stmt.all(city) as CanonicalEventRow[];
}

export function getActiveCanonicalEvents(db: Database.Database, city: string): CanonicalEventRow[] {
  const stmt = db.prepare("SELECT * FROM canonical_events WHERE city = ? AND status = 'active' ORDER BY score DESC");
  return stmt.all(city) as CanonicalEventRow[];
}

export function getUnscoredEventIds(db: Database.Database, city: string): number[] {
  const stmt = db.prepare(
    "SELECT id FROM canonical_events WHERE city = ? AND status = 'active' AND score = 0 AND reasoning IS NULL"
  );
  return (stmt.all(city) as { id: number }[]).map((r) => r.id);
}

export function getCanonicalEventNames(db: Database.Database, city: string): { id: number; name: string }[] {
  const stmt = db.prepare("SELECT id, name FROM canonical_events WHERE city = ? AND status = 'active'");
  return stmt.all(city) as { id: number; name: string }[];
}

export function insertCanonicalEvent(
  db: Database.Database,
  event: Omit<CanonicalEventRow, "id">,
  sourceUrlHashes: string[]
): number {
  const insertStmt = db.prepare(`
    INSERT INTO canonical_events (name, event_type, location, date_start, date_end, date_display,
      estimated_attendance, is_recurring, description, organizer, contact_info,
      contact_method, contact_phone, contact_email, contact_url,
      registration_url, suggested_message,
      score, reasoning, estimated_revenue_low, estimated_revenue_high, revenue_reasoning,
      research_summary, page_content_hash, status, city,
      assigned_franchise_id, discovered_via, created_at, researched_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const linkStmt = db.prepare("INSERT OR IGNORE INTO event_sources (canonical_event_id, url_hash) VALUES (?, ?)");

  const result = insertStmt.run(
    event.name, event.event_type, event.location, event.date_start, event.date_end, event.date_display,
    event.estimated_attendance, event.is_recurring, event.description, event.organizer, event.contact_info,
    event.contact_method, event.contact_phone, event.contact_email, event.contact_url,
    event.registration_url, event.suggested_message,
    event.score, event.reasoning, event.estimated_revenue_low ?? null, event.estimated_revenue_high ?? null, event.revenue_reasoning ?? null,
    event.research_summary, event.page_content_hash, event.status,
    event.city, event.assigned_franchise_id, event.discovered_via, event.created_at, event.researched_at, event.updated_at
  );

  const canonId = Number(result.lastInsertRowid);
  for (const hash of sourceUrlHashes) {
    linkStmt.run(canonId, hash);
  }
  return canonId;
}

export function linkSourceToCanonical(db: Database.Database, canonicalId: number, urlHash: string) {
  const stmt = db.prepare("INSERT OR IGNORE INTO event_sources (canonical_event_id, url_hash) VALUES (?, ?)");
  stmt.run(canonicalId, urlHash);
}

export function updateCanonicalResearch(
  db: Database.Database,
  id: number,
  fields: Partial<Omit<CanonicalEventRow, "id" | "created_at">>
) {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(fields)) {
    sets.push(`${key} = ?`);
    values.push(value);
  }
  if (sets.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE canonical_events SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

export function getSourceUrlsForCanonical(db: Database.Database, canonicalId: number): string[] {
  const stmt = db.prepare(`
    SELECT r.url FROM raw_events r
    JOIN event_sources es ON es.url_hash = r.url_hash
    WHERE es.canonical_event_id = ?
  `);
  return (stmt.all(canonicalId) as { url: string }[]).map((r) => r.url);
}

export function getPrimarySourceUrl(db: Database.Database, canonicalId: number): string | null {
  const stmt = db.prepare(`
    SELECT r.url FROM raw_events r
    JOIN event_sources es ON es.url_hash = r.url_hash
    WHERE es.canonical_event_id = ?
    LIMIT 1
  `);
  const row = stmt.get(canonicalId) as { url: string } | undefined;
  return row?.url ?? null;
}

function normalizeForDedup(name: string, city?: string): string {
  let n = name.toLowerCase();
  if (city) {
    const cityName = city.split(",")[0].trim().toLowerCase();
    n = n.replace(new RegExp(`\\b${cityName}\\b`, "g"), "");
  }
  return n
    .replace(/['\u2018\u2019\u201A\u0060\u00B4]s\b/g, "")
    .replace(/\b(free|20\d{2}|annual|yearly|the|a|in|at|of|and|city)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tokenSet(s: string): Set<string> {
  return new Set(s.split(/\s+/).filter((t) => t.length > 0));
}

function tokenOverlap(a: string, b: string): number {
  const setA = tokenSet(a);
  const setB = tokenSet(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const t of setA) {
    if (setB.has(t)) shared++;
  }
  const smaller = Math.min(setA.size, setB.size);
  return shared / smaller;
}

function stripNumericSuffix(s: string): string {
  return s.replace(/\s*#?\d+\s*$/, "").trim();
}

function shouldMerge(a: string, b: string): boolean {
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  if (shorter.length < 5) return false;

  if (longer.includes(shorter)) {
    if (shorter.length / longer.length >= 0.5 || longer.startsWith(shorter)) {
      return true;
    }
  }

  const tokensA = tokenSet(a);
  const tokensB = tokenSet(b);
  const minTokens = Math.min(tokensA.size, tokensB.size);
  if (minTokens >= 2 && tokenOverlap(a, b) >= 0.65) return true;

  const strippedA = stripNumericSuffix(a);
  const strippedB = stripNumericSuffix(b);
  if (strippedA.length >= 5 && strippedB.length >= 5) {
    if (strippedA === strippedB) return true;
    const shortStrip = strippedA.length <= strippedB.length ? strippedA : strippedB;
    const longStrip = strippedA.length > strippedB.length ? strippedA : strippedB;
    if (longStrip.includes(shortStrip) && shortStrip.length / longStrip.length >= 0.5) return true;
  }

  return false;
}

export function mergeCanonicalDuplicates(db: Database.Database, city: string): number {
  const events = db
    .prepare("SELECT * FROM canonical_events WHERE city = ? AND status = 'active' ORDER BY score DESC")
    .all(city) as CanonicalEventRow[];

  const assigned = new Set<number>();
  const mergeGroups: CanonicalEventRow[][] = [];

  for (const event of events) {
    if (assigned.has(event.id)) continue;
    const norm = normalizeForDedup(event.name, city);
    const group = [event];
    const groupNorms = [norm];
    assigned.add(event.id);

    for (const other of events) {
      if (assigned.has(other.id)) continue;
      const otherNorm = normalizeForDedup(other.name, city);
      if (groupNorms.some((gn) => shouldMerge(gn, otherNorm))) {
        group.push(other);
        groupNorms.push(otherNorm);
        assigned.add(other.id);
      }
    }

    if (group.length > 1) {
      mergeGroups.push(group);
    }
  }

  let merged = 0;
  const deleteOverlapStmt = db.prepare(
    `DELETE FROM event_sources
     WHERE canonical_event_id = ?
     AND url_hash IN (SELECT url_hash FROM event_sources WHERE canonical_event_id = ?)`
  );
  const moveSourcesStmt = db.prepare(
    "UPDATE event_sources SET canonical_event_id = ? WHERE canonical_event_id = ?"
  );
  const deactivateStmt = db.prepare(
    "UPDATE canonical_events SET status = 'merged', updated_at = ? WHERE id = ?"
  );
  const now = new Date().toISOString();

  for (const group of mergeGroups) {
    group.sort((a, b) => b.score - a.score);
    const keeper = group[0];

    for (let i = 1; i < group.length; i++) {
      const dupe = group[i];
      deleteOverlapStmt.run(dupe.id, keeper.id);
      moveSourcesStmt.run(keeper.id, dupe.id);
      deactivateStmt.run(now, dupe.id);
      merged++;
    }
  }

  return merged;
}

export type CityProgressRow = {
  city: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  event_count: number;
  error: string | null;
};

export function getCityProgress(db: Database.Database, city: string): CityProgressRow | undefined {
  return db.prepare("SELECT * FROM city_progress WHERE city = ?").get(city) as CityProgressRow | undefined;
}

export function upsertCityProgress(db: Database.Database, city: string, fields: Partial<CityProgressRow>) {
  const existing = getCityProgress(db, city);
  if (existing) {
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [key, value] of Object.entries(fields)) {
      if (key === "city") continue;
      sets.push(`${key} = ?`);
      values.push(value);
    }
    if (sets.length > 0) {
      values.push(city);
      db.prepare(`UPDATE city_progress SET ${sets.join(", ")} WHERE city = ?`).run(...values);
    }
  } else {
    db.prepare(
      "INSERT INTO city_progress (city, status, started_at, completed_at, event_count, error) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(
      city,
      fields.status ?? "pending",
      fields.started_at ?? null,
      fields.completed_at ?? null,
      fields.event_count ?? 0,
      fields.error ?? null
    );
  }
}

export function getAllCityProgress(db: Database.Database): CityProgressRow[] {
  return db.prepare("SELECT * FROM city_progress ORDER BY city").all() as CityProgressRow[];
}

export type PipelineRunRow = {
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

export function createPipelineRun(
  db: Database.Database,
  city: string,
  storeAddress: string
): number {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      "INSERT INTO pipeline_runs (city, store_address, status, started_at, log) VALUES (?, ?, 'running', ?, '')"
    )
    .run(city, storeAddress || null, now);
  return Number(result.lastInsertRowid);
}

export function appendRunLog(
  db: Database.Database,
  runId: number,
  message: string
) {
  const timestamp = new Date().toISOString().split("T")[1].slice(0, 8);
  const line = `[${timestamp}] ${message}\n`;
  db.prepare("UPDATE pipeline_runs SET log = log || ? WHERE id = ?").run(
    line,
    runId
  );
}

export function completeRun(
  db: Database.Database,
  runId: number,
  eventCount: number
) {
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE pipeline_runs SET status = 'completed', completed_at = ?, event_count = ? WHERE id = ?"
  ).run(now, eventCount, runId);
}

export function failRun(
  db: Database.Database,
  runId: number,
  error: string
) {
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE pipeline_runs SET status = 'failed', completed_at = ?, error = ? WHERE id = ?"
  ).run(now, error, runId);
}

export function getPipelineRun(
  db: Database.Database,
  runId: number
): PipelineRunRow | undefined {
  return db
    .prepare("SELECT * FROM pipeline_runs WHERE id = ?")
    .get(runId) as PipelineRunRow | undefined;
}

export function getRecentRuns(
  db: Database.Database,
  limit = 20
): PipelineRunRow[] {
  return db
    .prepare(
      "SELECT id, city, store_address, status, started_at, completed_at, event_count, error, '' as log FROM pipeline_runs ORDER BY id DESC LIMIT ?"
    )
    .all(limit) as PipelineRunRow[];
}

export type FranchiseLocationRow = {
  id: number;
  store_name: string;
  slug: string;
  address: string;
  city: string;
  state: string;
  state_initials: string;
  zip: string;
  lat: number | null;
  lng: number | null;
  created_at: string;
};

export function importFranchiseLocations(
  db: Database.Database,
  locations: ScrapedLocation[]
): { inserted: number; updated: number } {
  const upsertStmt = db.prepare(`
    INSERT INTO franchise_locations (store_name, slug, address, city, state, state_initials, zip, lat, lng)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      store_name = excluded.store_name,
      address = excluded.address,
      city = excluded.city,
      state = excluded.state,
      state_initials = excluded.state_initials,
      zip = excluded.zip,
      lat = excluded.lat,
      lng = excluded.lng
  `);

  let inserted = 0;
  let updated = 0;

  const runAll = db.transaction(() => {
    for (const loc of locations) {
      const result = upsertStmt.run(
        loc.storeName,
        loc.slug,
        loc.address,
        loc.city,
        loc.state,
        loc.stateInitials,
        loc.zip,
        Number.isNaN(loc.lat) ? null : loc.lat,
        Number.isNaN(loc.lng) ? null : loc.lng
      );
      if (result.changes > 0) {
        if (result.lastInsertRowid) {
          inserted++;
        } else {
          updated++;
        }
      }
    }
  });
  runAll();

  return { inserted, updated };
}

export function getFranchiseByCity(
  db: Database.Database,
  city: string,
  stateInitials: string
): FranchiseLocationRow | undefined {
  const byCity = db
    .prepare(
      "SELECT * FROM franchise_locations WHERE LOWER(city) = LOWER(?) AND LOWER(state_initials) = LOWER(?) LIMIT 1"
    )
    .get(city, stateInitials) as FranchiseLocationRow | undefined;
  if (byCity) return byCity;

  return db
    .prepare(
      "SELECT * FROM franchise_locations WHERE LOWER(store_name) = LOWER(?) AND LOWER(state_initials) = LOWER(?) LIMIT 1"
    )
    .get(city, stateInitials) as FranchiseLocationRow | undefined;
}

export function getFranchiseLocationCount(db: Database.Database): number {
  return (db.prepare("SELECT COUNT(*) as c FROM franchise_locations").get() as { c: number }).c;
}

export function getAllFranchiseLocations(db: Database.Database): FranchiseLocationRow[] {
  return db.prepare("SELECT * FROM franchise_locations ORDER BY state_initials, city, store_name").all() as FranchiseLocationRow[];
}

export function getFranchiseLocationsByState(db: Database.Database, stateInitials: string): FranchiseLocationRow[] {
  return db.prepare("SELECT * FROM franchise_locations WHERE state_initials = ? ORDER BY city, store_name").all(stateInitials) as FranchiseLocationRow[];
}

export function getDbStats(db: Database.Database) {
  const rawCount = (db.prepare("SELECT COUNT(*) as c FROM raw_events").get() as { c: number }).c;
  const canonicalCount = (db.prepare("SELECT COUNT(*) as c FROM canonical_events").get() as { c: number }).c;
  const activeCount = (db.prepare("SELECT COUNT(*) as c FROM canonical_events WHERE status = 'active'").get() as { c: number }).c;
  const cities = (db.prepare("SELECT DISTINCT city FROM canonical_events ORDER BY city").all() as { city: string }[]).map((r) => r.city);
  const franchiseCount = getFranchiseLocationCount(db);
  return { rawCount, canonicalCount, activeCount, cities, franchiseCount };
}

export function assignEventToFranchise(
  db: Database.Database,
  eventId: number,
  franchiseId: number,
  distanceMiles: number | null,
  isClosest = false
) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO event_franchise_assignments (canonical_event_id, franchise_id, distance_miles, is_closest, assigned_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(eventId, franchiseId, distanceMiles, isClosest ? 1 : 0, now);
}

export function updateClosestFlags(db: Database.Database, eventId: number) {
  db.prepare(
    "UPDATE event_franchise_assignments SET is_closest = 0 WHERE canonical_event_id = ?"
  ).run(eventId);

  db.prepare(
    `UPDATE event_franchise_assignments SET is_closest = 1
     WHERE canonical_event_id = ? AND franchise_id = (
       SELECT franchise_id FROM event_franchise_assignments
       WHERE canonical_event_id = ?
       ORDER BY COALESCE(distance_miles, 0) ASC LIMIT 1
     )`
  ).run(eventId, eventId);
}

export function updateAllClosestFlags(db: Database.Database) {
  db.exec("UPDATE event_franchise_assignments SET is_closest = 0");

  const eventIds = (db.prepare(
    "SELECT DISTINCT canonical_event_id FROM event_franchise_assignments"
  ).all() as { canonical_event_id: number }[]).map((r) => r.canonical_event_id);

  const stmt = db.prepare(
    `UPDATE event_franchise_assignments SET is_closest = 1
     WHERE canonical_event_id = ? AND franchise_id = (
       SELECT franchise_id FROM event_franchise_assignments
       WHERE canonical_event_id = ?
       ORDER BY COALESCE(distance_miles, 0) ASC LIMIT 1
     )`
  );

  const run = db.transaction(() => {
    for (const id of eventIds) {
      stmt.run(id, id);
    }
  });
  run();
}

export function assignEventToFranchises(
  db: Database.Database,
  eventId: number,
  assignments: { franchiseId: number; distanceMiles: number | null }[]
) {
  const now = new Date().toISOString();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO event_franchise_assignments (canonical_event_id, franchise_id, distance_miles, assigned_at)
     VALUES (?, ?, ?, ?)`
  );
  const run = db.transaction(() => {
    for (const a of assignments) {
      stmt.run(eventId, a.franchiseId, a.distanceMiles, now);
    }
  });
  run();
}

export function getFranchiseIdsForEvent(db: Database.Database, eventId: number): number[] {
  return (db.prepare(
    "SELECT franchise_id FROM event_franchise_assignments WHERE canonical_event_id = ?"
  ).all(eventId) as { franchise_id: number }[]).map((r) => r.franchise_id);
}

export function getActiveEventsByFranchise(db: Database.Database, franchiseId: number): CanonicalEventRow[] {
  return db.prepare(
    `SELECT DISTINCT ce.* FROM canonical_events ce
     JOIN event_franchise_assignments efa ON efa.canonical_event_id = ce.id
     WHERE efa.franchise_id = ? AND ce.status = 'active'
     ORDER BY ce.score DESC`
  ).all(franchiseId) as CanonicalEventRow[];
}

export function getCanonicalEventNamesForFranchises(
  db: Database.Database,
  franchiseIds: number[]
): { id: number; name: string }[] {
  if (franchiseIds.length === 0) return [];
  const placeholders = franchiseIds.map(() => "?").join(",");
  return db.prepare(
    `SELECT DISTINCT ce.id, ce.name FROM canonical_events ce
     JOIN event_franchise_assignments efa ON efa.canonical_event_id = ce.id
     WHERE efa.franchise_id IN (${placeholders}) AND ce.status = 'active'`
  ).all(...franchiseIds) as { id: number; name: string }[];
}

export function getAllActiveEventsInCities(
  db: Database.Database,
  cities: string[]
): CanonicalEventRow[] {
  if (cities.length === 0) return [];
  const placeholders = cities.map(() => "?").join(",");
  return db.prepare(
    `SELECT * FROM canonical_events WHERE city IN (${placeholders}) AND status = 'active' ORDER BY score DESC`
  ).all(...cities) as CanonicalEventRow[];
}
