import { createClient, type Client, type Row } from "@libsql/client";
import path from "node:path";

export type CanonicalEvent = {
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
  status: string;
  city: string;
  created_at: string;
  researched_at: string | null;
  updated_at: string;
  is_closest?: number;
  distance_miles?: number | null;
  closest_store_name?: string | null;
};

export type CityProgress = {
  city: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  event_count: number;
  error: string | null;
};

export type LocationSummary = {
  city: string;
  status: string;
  completed_at: string | null;
  started_at: string | null;
  event_count: number;
  active_events: number;
  high_score_events: number;
  error: string | null;
};

export type DashboardStats = {
  totalLocations: number;
  totalEvents: number;
  activeEvents: number;
  highScoreEvents: number;
};

function row<T>(r: Row): T {
  return { ...r } as T;
}

let _client: Client | null = null;

function getDb(): Client {
  if (_client) return _client;

  if (process.env.TURSO_DATABASE_URL) {
    _client = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  } else {
    const dbPath = path.resolve(process.cwd(), "..", "data", "lead-gen.db");
    _client = createClient({ url: `file:${dbPath}` });
  }

  return _client;
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const db = getDb();

  const hasJunction = row<{ c: number }>(
    (await db.execute("SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name='event_franchise_assignments'")).rows[0]
  ).c > 0;

  let locationCount: number;
  if (hasJunction) {
    locationCount = row<{ count: number }>(
      (await db.execute("SELECT COUNT(DISTINCT franchise_id) as count FROM event_franchise_assignments")).rows[0]
    ).count;
  } else {
    locationCount = row<{ count: number }>(
      (await db.execute("SELECT COUNT(DISTINCT city) as count FROM canonical_events WHERE status = 'active'")).rows[0]
    ).count;
  }

  const total = row<{ count: number }>(
    (await db.execute("SELECT COUNT(*) as count FROM canonical_events WHERE status = 'active'")).rows[0]
  );

  const highScore = row<{ count: number }>(
    (await db.execute("SELECT COUNT(*) as count FROM canonical_events WHERE status = 'active' AND score >= 60")).rows[0]
  );

  return {
    totalLocations: locationCount,
    totalEvents: total.count,
    activeEvents: total.count,
    highScoreEvents: highScore.count,
  };
}

export async function getLocations(): Promise<LocationSummary[]> {
  const db = getDb();

  const hasJunctionTable = row<{ c: number }>(
    (await db.execute("SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name='event_franchise_assignments'")).rows[0]
  ).c > 0;

  const progressRows = (await db.execute("SELECT * FROM city_progress")).rows.map((r) => row<CityProgress>(r));
  const progressMap = new Map(progressRows.map((r) => [r.city, r]));

  const latestRuns = (await db.execute(
    `SELECT city, status, started_at, completed_at, event_count, error
     FROM pipeline_runs
     WHERE id IN (SELECT MAX(id) FROM pipeline_runs GROUP BY city)`
  )).rows.map((r) => row<CityProgress>(r));
  const runsMap = new Map(latestRuns.map((r) => [r.city, r]));

  const results = new Map<string, LocationSummary>();

  if (hasJunctionTable) {
    const franchises = (await db.execute(
      `SELECT fl.id, fl.store_name, fl.city, fl.state_initials
       FROM franchise_locations fl
       WHERE fl.id IN (SELECT DISTINCT franchise_id FROM event_franchise_assignments)
       ORDER BY fl.state_initials, fl.city, fl.store_name`
    )).rows.map((r) => row<{ id: number; store_name: string; city: string; state_initials: string }>(r));

    for (const f of franchises) {
      const storeKey = `${f.store_name}, ${f.state_initials}`;
      const cityKey = `${f.city}, ${f.state_initials}`;
      const progress = progressMap.get(storeKey) ?? progressMap.get(cityKey);
      const latestRun = runsMap.get(storeKey) ?? runsMap.get(cityKey);
      const source = progress?.status && progress.status !== "unknown"
        ? progress
        : latestRun ?? null;

      const active = row<{ count: number }>(
        (await db.execute({ sql: `SELECT COUNT(DISTINCT ce.id) as count FROM canonical_events ce
           JOIN event_franchise_assignments efa ON efa.canonical_event_id = ce.id
           WHERE efa.franchise_id = ? AND ce.status = 'active'`, args: [f.id] })).rows[0]
      );

      const highScore = row<{ count: number }>(
        (await db.execute({ sql: `SELECT COUNT(DISTINCT ce.id) as count FROM canonical_events ce
           JOIN event_franchise_assignments efa ON efa.canonical_event_id = ce.id
           WHERE efa.franchise_id = ? AND ce.status = 'active' AND ce.score >= 60`, args: [f.id] })).rows[0]
      );

      const hasEvents = active.count > 0;
      const displayCity = f.store_name !== f.city
        ? `${f.store_name}, ${f.state_initials}`
        : cityKey;

      results.set(displayCity, {
        city: displayCity,
        status: source?.status ?? (hasEvents ? "completed" : "unknown"),
        completed_at: source?.completed_at ?? null,
        started_at: source?.started_at ?? null,
        event_count: source?.event_count ?? (hasEvents ? active.count : 0),
        active_events: active.count,
        high_score_events: highScore.count,
        error: source?.error ?? null,
      });
    }
  }

  const cities = (await db.execute(
    "SELECT DISTINCT city FROM canonical_events WHERE status = 'active' ORDER BY city"
  )).rows.map((r) => row<{ city: string }>(r));

  for (const c of cities) {
    if (results.has(c.city)) continue;

    const progress = progressMap.get(c.city);
    const latestRun = runsMap.get(c.city);
    const source = progress?.status && progress.status !== "unknown"
      ? progress
      : latestRun ?? null;

    const active = row<{ count: number }>(
      (await db.execute({ sql: "SELECT COUNT(*) as count FROM canonical_events WHERE city = ? AND status = 'active'", args: [c.city] })).rows[0]
    );

    const highScore = row<{ count: number }>(
      (await db.execute({ sql: "SELECT COUNT(*) as count FROM canonical_events WHERE city = ? AND status = 'active' AND score >= 60", args: [c.city] })).rows[0]
    );

    const hasEvents = active.count > 0;
    results.set(c.city, {
      city: c.city,
      status: source?.status ?? (hasEvents ? "completed" : "unknown"),
      completed_at: source?.completed_at ?? null,
      started_at: source?.started_at ?? null,
      event_count: source?.event_count ?? (hasEvents ? active.count : 0),
      active_events: active.count,
      high_score_events: highScore.count,
      error: source?.error ?? null,
    });
  }

  return [...results.values()];
}

async function findFranchiseForCity(
  db: Client,
  city: string
): Promise<FranchiseLocation | null> {
  const parts = city.split(",").map((p) => p.trim());
  if (parts.length < 2) return null;

  const cityName = parts[0];
  const stateInitials = parts[1];

  const byCity = (await db.execute({
    sql: `SELECT id, store_name, slug, address, city, state, state_initials, zip, lat, lng
     FROM franchise_locations
     WHERE LOWER(city) = LOWER(?) AND LOWER(state_initials) = LOWER(?)
     LIMIT 1`,
    args: [cityName, stateInitials],
  })).rows[0];
  if (byCity) return row<FranchiseLocation>(byCity);

  const byStoreName = (await db.execute({
    sql: `SELECT id, store_name, slug, address, city, state, state_initials, zip, lat, lng
     FROM franchise_locations
     WHERE LOWER(store_name) = LOWER(?) AND LOWER(state_initials) = LOWER(?)
     LIMIT 1`,
    args: [cityName, stateInitials],
  })).rows[0];

  return byStoreName ? row<FranchiseLocation>(byStoreName) : null;
}

export async function getLocationEvents(
  city: string,
  sortBy: string = "score",
  sortDir: string = "desc"
): Promise<CanonicalEvent[]> {
  const db = getDb();

  const allowedSorts: Record<string, string> = {
    score: "ce.score",
    name: "ce.name",
    date: "ce.date_start",
    updated: "ce.updated_at",
  };
  const col = allowedSorts[sortBy] ?? "ce.score";
  const dir = sortDir === "asc" ? "ASC" : "DESC";

  const franchise = await findFranchiseForCity(db, city);
  if (franchise) {
    const hasJunction = row<{ c: number }>(
      (await db.execute("SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name='event_franchise_assignments'")).rows[0]
    ).c > 0;

    if (hasJunction) {
      const events = (await db.execute({
        sql: `SELECT DISTINCT ce.*, efa.is_closest, efa.distance_miles,
                (SELECT fl2.store_name FROM event_franchise_assignments efa2
                 JOIN franchise_locations fl2 ON fl2.id = efa2.franchise_id
                 WHERE efa2.canonical_event_id = ce.id AND efa2.is_closest = 1
                 LIMIT 1) as closest_store_name
         FROM canonical_events ce
         JOIN event_franchise_assignments efa ON efa.canonical_event_id = ce.id
         WHERE efa.franchise_id = ? AND ce.status = 'active'
         ORDER BY ${col} ${dir}`,
        args: [franchise.id],
      })).rows.map((r) => row<CanonicalEvent>(r));

      if (events.length > 0) return events;
    }
  }

  return (await db.execute({
    sql: `SELECT * FROM canonical_events ce WHERE ce.city = ? AND ce.status = 'active' ORDER BY ${col} ${dir}`,
    args: [city],
  })).rows.map((r) => row<CanonicalEvent>(r));
}

export async function getEvent(
  id: number
): Promise<{ event: CanonicalEvent; sourceUrls: string[] } | null> {
  const db = getDb();

  const eventRow = (await db.execute({ sql: "SELECT * FROM canonical_events WHERE id = ?", args: [id] })).rows[0];
  if (!eventRow) return null;

  const event = row<CanonicalEvent>(eventRow);

  const sources = (await db.execute({
    sql: `SELECT r.url FROM event_sources es
         JOIN raw_events r ON r.url_hash = es.url_hash
         WHERE es.canonical_event_id = ?`,
    args: [id],
  })).rows.map((r) => row<{ url: string }>(r));

  return {
    event,
    sourceUrls: sources.map((s) => s.url),
  };
}

export type PipelineRun = {
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

export async function getRecentRuns(limit = 30): Promise<PipelineRun[]> {
  const db = getDb();
  return (await db.execute({
    sql: "SELECT id, city, store_address, status, started_at, completed_at, event_count, error, '' as log FROM pipeline_runs ORDER BY id DESC LIMIT ?",
    args: [limit],
  })).rows.map((r) => row<PipelineRun>(r));
}

export async function getPipelineRun(id: number): Promise<PipelineRun | null> {
  const db = getDb();
  const r = (await db.execute({ sql: "SELECT * FROM pipeline_runs WHERE id = ?", args: [id] })).rows[0];
  return r ? row<PipelineRun>(r) : null;
}

export type FranchiseLocation = {
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
};

export async function getFranchiseLocations(): Promise<FranchiseLocation[]> {
  const db = getDb();
  return (await db.execute(
    "SELECT id, store_name, slug, address, city, state, state_initials, zip, lat, lng FROM franchise_locations ORDER BY state_initials, city, store_name"
  )).rows.map((r) => row<FranchiseLocation>(r));
}

export async function getFranchiseLocationById(
  id: number
): Promise<FranchiseLocation | null> {
  const db = getDb();
  const r = (await db.execute({
    sql: "SELECT id, store_name, slug, address, city, state, state_initials, zip, lat, lng FROM franchise_locations WHERE id = ?",
    args: [id],
  })).rows[0];
  return r ? row<FranchiseLocation>(r) : null;
}

export async function getFranchiseByStoreName(
  storeName: string
): Promise<FranchiseLocation | null> {
  const db = getDb();
  const parts = storeName.split(",").map((p) => p.trim());
  if (parts.length >= 2) {
    const name = parts.slice(0, -1).join(",").trim();
    const stateInitials = parts[parts.length - 1];
    const r = (await db.execute({
      sql: "SELECT id, store_name, slug, address, city, state, state_initials, zip, lat, lng FROM franchise_locations WHERE store_name = ? AND LOWER(state_initials) = LOWER(?) LIMIT 1",
      args: [name, stateInitials],
    })).rows[0];
    if (r) return row<FranchiseLocation>(r);
  }
  const r = (await db.execute({
    sql: "SELECT id, store_name, slug, address, city, state, state_initials, zip, lat, lng FROM franchise_locations WHERE store_name = ? LIMIT 1",
    args: [storeName],
  })).rows[0];
  return r ? row<FranchiseLocation>(r) : null;
}

export async function getEventTypes(city: string): Promise<string[]> {
  const db = getDb();
  const franchise = await findFranchiseForCity(db, city);
  if (franchise) {
    const hasJunction = row<{ c: number }>(
      (await db.execute("SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name='event_franchise_assignments'")).rows[0]
    ).c > 0;

    if (hasJunction) {
      const rows = (await db.execute({
        sql: `SELECT DISTINCT ce.event_type FROM canonical_events ce
           JOIN event_franchise_assignments efa ON efa.canonical_event_id = ce.id
           WHERE efa.franchise_id = ? AND ce.status = 'active' AND ce.event_type IS NOT NULL
           ORDER BY ce.event_type`,
        args: [franchise.id],
      })).rows.map((r) => row<{ event_type: string }>(r));

      if (rows.length > 0) return rows.map((r) => r.event_type);
    }
  }

  const rows = (await db.execute({
    sql: `SELECT DISTINCT event_type FROM canonical_events
         WHERE city = ? AND status = 'active' AND event_type IS NOT NULL
         ORDER BY event_type`,
    args: [city],
  })).rows.map((r) => row<{ event_type: string }>(r));
  return rows.map((r) => r.event_type);
}
