import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { AgentConfig } from "./types.js";
import {
  openDb,
  diffRawEvents,
  getActiveCanonicalEvents,
  getUnscoredEventIds,
  getDbStats,
  getSourceUrlsForCanonical,
  mergeCanonicalDuplicates,
  updateCanonicalResearch,
  getCityProgress,
  upsertCityProgress,
  getAllCityProgress,
  createPipelineRun,
  appendRunLog,
  completeRun,
  failRun,
  getFranchiseByCity,
  getAllFranchiseLocations,
  getFranchiseLocationCount,
  assignEventToFranchise,
  assignEventToFranchises,
  getActiveEventsByFranchise,
  getAllActiveEventsInCities,
  getFranchiseIdsForEvent,
  getCanonicalEventNamesForFranchises,
  updateClosestFlags,
  type CanonicalEventRow,
  type FranchiseLocationRow,
} from "./db.js";
import { collectRawEvents } from "./stages/collector.js";
import { hardRejectFilter } from "./stages/qualifier.js";
import { deduplicateEvents } from "./stages/deduplicator.js";
import { triageGroups } from "./stages/triage.js";
import { researchNewEvents, refreshCanonicalEvent } from "./stages/researcher.js";
import { scoreEvents } from "./stages/scorer.js";
import {
  getNearbyCities,
  extractCityFromLocation,
  haversineDistanceMiles,
  findNearestFranchise,
  getFranchisesWithinRadius,
} from "./geo.js";

function citySlug(city: string) {
  return city
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export type ParsedLocation = {
  searchCity: string;
  fullAddress: string;
  stateAbbr: string;
};

const STATE_ABBR_SET = new Set([
  "al", "ak", "az", "ar", "ca", "co", "ct", "de", "fl", "ga",
  "hi", "id", "il", "in", "ia", "ks", "ky", "la", "me", "md",
  "ma", "mi", "mn", "ms", "mo", "mt", "ne", "nv", "nh", "nj",
  "nm", "ny", "nc", "nd", "oh", "ok", "or", "pa", "ri", "sc",
  "sd", "tn", "tx", "ut", "vt", "va", "wa", "wv", "wi", "wy",
]);

export function parseLocation(input: string): ParsedLocation {
  const trimmed = input.trim();
  const parts = trimmed.split(",").map((p) => p.trim());

  if (parts.length >= 3) {
    const lastPart = parts[parts.length - 1];
    const stateZipMatch = lastPart.match(/^([A-Za-z]{2})\s*\d{0,5}$/);
    if (stateZipMatch) {
      const stateAbbr = stateZipMatch[1].toLowerCase();
      if (STATE_ABBR_SET.has(stateAbbr)) {
        const city = parts[parts.length - 2];
        return {
          searchCity: `${city}, ${stateAbbr.toUpperCase()}`,
          fullAddress: trimmed,
          stateAbbr,
        };
      }
    }
  }

  if (parts.length === 2) {
    const stateCandidate = parts[1].replace(/\d/g, "").trim().toLowerCase();
    if (STATE_ABBR_SET.has(stateCandidate)) {
      return {
        searchCity: trimmed,
        fullAddress: "",
        stateAbbr: stateCandidate,
      };
    }
  }

  return { searchCity: trimmed, fullAddress: "", stateAbbr: "" };
}

const STATE_ABBREVIATIONS: Record<string, string> = {
  al: "alabama", ak: "alaska", az: "arizona", ar: "arkansas", ca: "california",
  co: "colorado", ct: "connecticut", de: "delaware", fl: "florida", ga: "georgia",
  hi: "hawaii", id: "idaho", il: "illinois", in: "indiana", ia: "iowa",
  ks: "kansas", ky: "kentucky", la: "louisiana", me: "maine", md: "maryland",
  ma: "massachusetts", mi: "michigan", mn: "minnesota", ms: "mississippi",
  mo: "missouri", mt: "montana", ne: "nebraska", nv: "nevada", nh: "new hampshire",
  nj: "new jersey", nm: "new mexico", ny: "new york", nc: "north carolina",
  nd: "north dakota", oh: "ohio", ok: "oklahoma", or: "oregon", pa: "pennsylvania",
  ri: "rhode island", sc: "south carolina", sd: "south dakota", tn: "tennessee",
  tx: "texas", ut: "utah", vt: "vermont", va: "virginia", wa: "washington",
  wv: "west virginia", wi: "wisconsin", wy: "wyoming",
};

function isOutOfArea(
  event: CanonicalEventRow,
  searchCity: string,
  nearbyCityNames: Set<string>
): boolean {
  const textToCheck = `${event.location ?? ""} ${event.name}`.toLowerCase();
  if (!textToCheck.trim()) return false;

  const cityParts = searchCity.toLowerCase().split(",").map((p) => p.trim());
  const targetCity = cityParts[0];
  const targetStateAbbr = cityParts[1]?.trim();

  if (textToCheck.includes(targetCity)) return false;

  if (nearbyCityNames.size > 0) {
    for (const nc of nearbyCityNames) {
      if (textToCheck.includes(nc)) return false;
    }
  }

  const otherStates = Object.entries(STATE_ABBREVIATIONS)
    .filter(([abbr]) => abbr !== targetStateAbbr)
    .map(([, full]) => full);

  for (const state of otherStates) {
    if (textToCheck.includes(state)) return true;
  }

  const stateAbbrMatch = textToCheck.match(/,\s*([a-z]{2})\b/);
  if (stateAbbrMatch) {
    const foundAbbr = stateAbbrMatch[1];
    if (foundAbbr !== targetStateAbbr && STATE_ABBREVIATIONS[foundAbbr]) {
      return true;
    }
  }

  return false;
}

function lookupTargetFranchise(
  db: ReturnType<typeof openDb>,
  searchCity: string,
  storeName?: string
): FranchiseLocationRow | null {
  if (storeName) {
    const storeParts = storeName.split(",").map((p) => p.trim());
    if (storeParts.length >= 2) {
      const match = getFranchiseByCity(db, storeParts[0], storeParts[1]);
      if (match) return match;
    }
  }

  const parts = searchCity.split(",").map((p) => p.trim());
  if (parts.length < 2) return null;

  const city = parts[0];
  const stateAbbr = parts[1];
  const franchise = getFranchiseByCity(db, city, stateAbbr);
  return franchise ?? null;
}

function getEventProxyLocation(
  event: CanonicalEventRow,
  allFranchises: FranchiseLocationRow[]
): { lat: number; lng: number } | null {
  if (!event.location) return null;
  const extracted = extractCityFromLocation(event.location);
  if (!extracted) return null;

  const match = allFranchises.find(
    (f) =>
      f.lat !== null && f.lng !== null &&
      (f.city.toLowerCase() === extracted.city.toLowerCase() ||
       f.store_name.toLowerCase() === extracted.city.toLowerCase()) &&
      f.state_initials.toUpperCase() === extracted.stateAbbr.toUpperCase()
  );

  return match?.lat !== null && match?.lat !== undefined && match?.lng !== null
    ? { lat: match.lat, lng: match.lng }
    : null;
}

function assignEventToAllNearbyFranchises(
  db: ReturnType<typeof openDb>,
  event: CanonicalEventRow,
  allFranchises: FranchiseLocationRow[],
  assignmentRadiusMiles: number,
  discoveredVia: string
): { franchiseId: number; distanceMiles: number; storeName: string }[] {
  const proxy = getEventProxyLocation(event, allFranchises);
  const existingIds = new Set(getFranchiseIdsForEvent(db, event.id));
  const now = new Date().toISOString();
  const newAssignments: { franchiseId: number; distanceMiles: number; storeName: string }[] = [];

  if (!proxy) {
    return newAssignments;
  }

  let nearestDist = Infinity;
  let nearestFranchise: FranchiseLocationRow | null = null;

  for (const f of allFranchises) {
    if (f.lat === null || f.lng === null) continue;
    const dist = haversineDistanceMiles(proxy.lat, proxy.lng, f.lat, f.lng);

    if (dist < nearestDist) {
      nearestDist = dist;
      nearestFranchise = f;
    }

    if (dist > assignmentRadiusMiles) continue;
    if (existingIds.has(f.id)) continue;

    assignEventToFranchise(db, event.id, f.id, Math.round(dist * 10) / 10);
    newAssignments.push({
      franchiseId: f.id,
      distanceMiles: Math.round(dist * 10) / 10,
      storeName: f.store_name,
    });
  }

  if (nearestFranchise && nearestFranchise.id !== event.assigned_franchise_id) {
    updateCanonicalResearch(db, event.id, {
      assigned_franchise_id: nearestFranchise.id,
      discovered_via: event.discovered_via ?? discoveredVia,
      updated_at: now,
    });
  }

  if (newAssignments.length === 0 && existingIds.size === 0 && nearestFranchise) {
    assignEventToFranchise(db, event.id, nearestFranchise.id, Math.round(nearestDist * 10) / 10);
    newAssignments.push({
      franchiseId: nearestFranchise.id,
      distanceMiles: Math.round(nearestDist * 10) / 10,
      storeName: nearestFranchise.store_name,
    });
  }

  if (newAssignments.length > 0 || existingIds.size > 0) {
    updateClosestFlags(db, event.id);
  }

  return newAssignments;
}

type AssignmentResult = {
  eventsProcessed: number;
  totalNewAssignments: number;
};

function assignNewEventsToAllFranchises(
  db: ReturnType<typeof openDb>,
  eventIds: number[],
  searchCity: string,
  assignmentRadiusMiles: number,
  log: (msg: string) => void
): AssignmentResult {
  if (eventIds.length === 0) return { eventsProcessed: 0, totalNewAssignments: 0 };

  const allFranchises = getAllFranchiseLocations(db);
  let eventsProcessed = 0;
  let totalNewAssignments = 0;

  for (const eventId of eventIds) {
    const event = db
      .prepare("SELECT * FROM canonical_events WHERE id = ?")
      .get(eventId) as CanonicalEventRow | undefined;
    if (!event) continue;

    const newAssignments = assignEventToAllNearbyFranchises(
      db, event, allFranchises, assignmentRadiusMiles, searchCity
    );

    eventsProcessed++;
    totalNewAssignments += newAssignments.length;

    if (newAssignments.length > 0) {
      const names = newAssignments.map((a) => `${a.storeName} (${a.distanceMiles}mi)`);
      log(`    → "${event.name.slice(0, 45)}" → ${names.join(", ")}`);
    }
  }

  return { eventsProcessed, totalNewAssignments };
}

function crossAssignAllExistingEvents(
  db: ReturnType<typeof openDb>,
  targetFranchise: FranchiseLocationRow,
  discoveryRadiusMiles: number,
  assignmentRadiusMiles: number,
  log: (msg: string) => void
): number {
  if (targetFranchise.lat === null || targetFranchise.lng === null) return 0;

  const allFranchises = getAllFranchiseLocations(db);

  const nearbyFranchises = getFranchisesWithinRadius(
    db,
    targetFranchise.lat,
    targetFranchise.lng,
    discoveryRadiusMiles
  );

  if (nearbyFranchises.length === 0) return 0;

  const nearbyCities = [...new Set(
    nearbyFranchises.flatMap((f) => {
      const keys = [`${f.city}, ${f.state_initials}`];
      if (f.store_name.toLowerCase() !== f.city.toLowerCase()) {
        keys.push(`${f.store_name}, ${f.state_initials}`);
      }
      return keys;
    })
  )];

  const nearbyEvents = getAllActiveEventsInCities(db, nearbyCities);
  if (nearbyEvents.length === 0) return 0;

  let totalNewAssignments = 0;

  for (const event of nearbyEvents) {
    const newAssignments = assignEventToAllNearbyFranchises(
      db, event, allFranchises, assignmentRadiusMiles, `${targetFranchise.store_name}, ${targetFranchise.state_initials}`
    );

    totalNewAssignments += newAssignments.length;

    if (newAssignments.length > 0) {
      const names = newAssignments.map((a) => `${a.storeName} (${a.distanceMiles}mi)`);
      log(`    ← "${event.name.slice(0, 45)}" → ${names.join(", ")}`);
    }
  }

  return totalNewAssignments;
}

const NON_EVENT_NAME_PATTERNS = [
  /^login to meetup/i,
  /^about\s*[-–—|]?\s*meetup/i,
  /^find a meetup group/i,
  /^how to start a group/i,
  /^popular topics on meetup/i,
  /^online events\s*[-–—|]?\s*meetup/i,
  /^meetup events near/i,
  /^networking tips/i,
  /^classic cookie recipes/i,
  /^easy recipes/i,
  /cookie.*を削除/i,
  /cookie.*מוחקים/i,
  /\bcookie\s+(policy|consent|settings|notice)\b/i,
  /^business entities\s*[-–—]/i,
  /^corporate\s*\(tv series/i,
  /^account registration$/i,
];

const NON_EVENT_URL_SUBSTRINGS = [
  "meetup.com/login",
  "meetup.com/about",
  "meetup.com/how-to",
  "meetup.com/topics",
  "meetup.com/cities",
  "meetup.com/find/online-events",
  "meetup.com/apps",
  "coursera.org/articles",
  "verywellmind.com",
  "verywellhealth.com",
  "opencorporates.com",
  "support.google.com",
  "imdb.com",
  "/sso/register",
];

function isEmptyEvent(event: CanonicalEventRow): boolean {
  const hasDate = Boolean(event.date_start ?? event.date_end ?? event.date_display);
  const hasLocation = Boolean(event.location);
  const hasDescription = Boolean(event.description);
  const hasEventType = Boolean(event.event_type);

  if (!hasDate && !hasLocation && !hasDescription && !hasEventType) return true;

  return false;
}

function isNonEvent(event: CanonicalEventRow, sourceUrls: string[]): boolean {
  if (NON_EVENT_NAME_PATTERNS.some((p) => p.test(event.name))) return true;
  if (isEmptyEvent(event)) return true;
  for (const url of sourceUrls) {
    const lower = url.toLowerCase();
    if (NON_EVENT_URL_SUBSTRINGS.some((s) => lower.includes(s))) return true;
  }
  return false;
}

function deactivateNonEvents(
  db: ReturnType<typeof openDb>,
  city: string
): number {
  const events = getActiveCanonicalEvents(db, city);
  const now = new Date().toISOString();
  let count = 0;
  for (const event of events) {
    const sourceUrls = getSourceUrlsForCanonical(db, event.id);
    if (isNonEvent(event, sourceUrls)) {
      updateCanonicalResearch(db, event.id, {
        status: "invalid",
        updated_at: now,
      });
      count++;
    }
  }
  return count;
}

function deactivateOutOfArea(
  db: ReturnType<typeof openDb>,
  city: string,
  nearbyCityNames?: Set<string>,
  searchCity?: string
): number {
  const events = getActiveCanonicalEvents(db, city);
  const now = new Date().toISOString();
  let count = 0;
  const nearby = nearbyCityNames ?? new Set<string>();
  const geoCity = searchCity ?? city;
  for (const event of events) {
    if (isOutOfArea(event, geoCity, nearby)) {
      updateCanonicalResearch(db, event.id, {
        status: "invalid",
        updated_at: now,
      });
      count++;
    }
  }
  return count;
}

function isPastEvent(event: CanonicalEventRow): boolean {
  if (event.is_recurring) return false;

  const allFields = [event.date_start, event.date_end, event.date_display];
  const now = new Date();
  const currentYear = now.getFullYear();

  let latestYear = 0;
  for (const field of allFields) {
    if (!field) continue;
    const yearMatches = field.match(/\b(20\d{2})\b/g);
    if (yearMatches) {
      for (const ym of yearMatches) {
        const year = Number(ym);
        if (year > latestYear) latestYear = year;
      }
    }
  }

  if (latestYear === 0) return false;
  if (latestYear > currentYear) return false;
  if (latestYear < currentYear) return true;

  // latestYear === currentYear — use only ISO-format fields for precise comparison
  // Skip date_display (contains ranges like "March 21-22, 2026" which JS Date parses incorrectly)
  // Skip ISO fields with years older than currentYear (stale data from prior occurrences)
  const isoFields = [event.date_end, event.date_start].filter(Boolean) as string[];
  const currentYearDates = isoFields
    .map((f) => new Date(f))
    .filter((d) => !Number.isNaN(d.getTime()) && d.getFullYear() === currentYear);

  if (currentYearDates.length === 0) return false;

  const latestDate = currentYearDates.reduce((a, b) => (a > b ? a : b));
  return latestDate < now;
}

function deactivatePastEvents(
  db: ReturnType<typeof openDb>,
  city: string
): number {
  const events = getActiveCanonicalEvents(db, city);
  const now = new Date().toISOString();
  let count = 0;
  for (const event of events) {
    if (isPastEvent(event)) {
      updateCanonicalResearch(db, event.id, {
        status: "past",
        updated_at: now,
      });
      count++;
    }
  }
  return count;
}

export async function runIncrementalPipeline(config: AgentConfig) {
  const city = config.storeName || config.searchLocation;
  const storeLabel = config.storeAddress ? ` (store: ${config.storeAddress})` : "";
  console.log(`\n=== Incremental Pipeline: "${city}"${storeLabel} ===\n`);

  const db = openDb(config.dbPath);
  const runId = createPipelineRun(db, city, config.storeAddress);

  function log(msg: string) {
    console.log(msg);
    appendRunLog(db, runId, msg);
  }

  config.onLog = log;

  try {
    log(`Pipeline started for "${city}"${storeLabel}`);

    // Pre-stage: Franchise lookup + nearby cities
    const searchCity = config.searchLocation;
    const targetFranchise = lookupTargetFranchise(db, searchCity, config.storeName || undefined);
    let nearbyCityNames: string[] = [];
    let nearbyCitySet = new Set<string>();

    if (targetFranchise && targetFranchise.lat !== null && targetFranchise.lng !== null) {
      log(`  Target franchise: ${targetFranchise.store_name} (${targetFranchise.city}, ${targetFranchise.state_initials})`);

      const hasFranchises = getFranchiseLocationCount(db) > 0;
      if (hasFranchises) {
        const nearby = getNearbyCities(db, targetFranchise.lat, targetFranchise.lng, config.broadSearchRadiusMiles);
        nearbyCityNames = nearby
          .filter((nc) => nc.city.toLowerCase() !== targetFranchise.city.toLowerCase())
          .map((nc) => `${nc.city}, ${nc.stateInitials}`);
        nearbyCitySet = new Set(nearby.map((nc) => nc.city.toLowerCase()));

        if (nearbyCityNames.length > 0) {
          log(`  Broader search: ${nearbyCityNames.length} nearby cities within ${config.broadSearchRadiusMiles} mi`);
          log(`    ${nearbyCityNames.slice(0, 10).join(", ")}${nearbyCityNames.length > 10 ? ` (+${nearbyCityNames.length - 10} more)` : ""}`);
        }
      }
    } else {
      log("  No franchise match found in DB — searching target city only");
    }

    // Stage 1: Collect
    log("Stage 1: Collecting raw events...");
    const collected = await collectRawEvents(config, nearbyCityNames);
    log(`  Collected: ${collected.rawCount} raw, ${collected.dedupedCount} deduped`);

    // Stage 2: Diff
    log("Stage 2: Diffing against cache...");
    const diff = diffRawEvents(db, collected.deduped);
    log(`  ${diff.newEvents.length} new URLs, ${diff.existingCount} already cached`);

    function runCrossAssignmentAndReport(reason: string) {
      if (targetFranchise) {
        log("  Cross-assigning events to all nearby franchises...");
        const crossCount = crossAssignAllExistingEvents(
          db, targetFranchise, config.broadSearchRadiusMiles, config.assignmentRadiusMiles, log
        );
        if (crossCount > 0) {
          log(`  Created ${crossCount} new franchise assignments`);
        } else {
          log("  No new cross-assignments needed");
        }
      }

      const events = targetFranchise
        ? getActiveEventsByFranchise(db, targetFranchise.id)
        : getActiveCanonicalEvents(db, city);
      return events;
    }

    if (diff.newEvents.length === 0) {
      log("No new events found.");
      const events = runCrossAssignmentAndReport("no new URLs");
      log("Generating report from cache...");
      await writeReport(config, city, events);
      log(`Pipeline complete — ${events.length} cached events`);
      completeRun(db, runId, events.length);
      return events;
    }

    // Stage 3: Hard-reject pre-filter
    log("Stage 3: Hard-reject pre-filter...");
    const { kept: preFiltered, rejectedCount: hardRejected, rejectedTitles } = hardRejectFilter(diff.newEvents);
    log(`  Kept: ${preFiltered.length}, hard-rejected: ${hardRejected}`);
    if (rejectedTitles.length > 0) {
      log(`  Rejected: ${rejectedTitles.join(", ")}`);
    }

    if (preFiltered.length === 0) {
      log("All new events were junk.");
      const events = runCrossAssignmentAndReport("all hard-rejected");
      log("Generating report from cache...");
      await writeReport(config, city, events);
      log(`Pipeline complete — ${events.length} cached events`);
      completeRun(db, runId, events.length);
      return events;
    }

    // Stage 4: AI Dedup
    log("Stage 4: AI deduplication...");
    const nearbyFranchiseIds = targetFranchise && targetFranchise.lat !== null && targetFranchise.lng !== null
      ? getFranchisesWithinRadius(db, targetFranchise.lat, targetFranchise.lng, config.broadSearchRadiusMiles)
          .map((f) => f.id)
      : [];
    const extraCanonicalNames = nearbyFranchiseIds.length > 0
      ? getCanonicalEventNamesForFranchises(db, nearbyFranchiseIds)
      : undefined;
    const dedupResult = await deduplicateEvents(config, db, preFiltered, city, extraCanonicalNames);
    log(`  Assigned to existing: ${dedupResult.assignedToExisting.reduce((sum, a) => sum + a.events.length, 0)} URLs → ${dedupResult.assignedToExisting.length} canonical events`);
    for (const a of dedupResult.assignedToExisting) {
      const titles = a.events.map((e) => e.title.slice(0, 40)).join(", ");
      log(`    → canonical #${a.existingId}: ${titles}`);
    }
    log(`  New event groups: ${dedupResult.newGroups.length}`);
    for (const g of dedupResult.newGroups) {
      log(`    • ${g.events[0].title.slice(0, 70)} (${g.events.length} source${g.events.length > 1 ? "s" : ""})`);
    }

    // Stage 5: AI Triage
    log("Stage 5: AI triage...");
    const { kept: triaged, rejectedCount: triageRejected } = await triageGroups(
      config,
      dedupResult.newGroups,
      city
    );
    log(`  Kept: ${triaged.length}, AI-rejected: ${triageRejected}`);

    if (triaged.length === 0) {
      log("All new events rejected by triage.");
      const events = runCrossAssignmentAndReport("all triaged out");
      log("Generating report from cache...");
      await writeReport(config, city, events);
      log(`Pipeline complete — ${events.length} cached events`);
      completeRun(db, runId, events.length);
      return events;
    }

    // Stage 6: AI Research
    log("Stage 6: AI research on new events...");
    const { created, createdIds } = await researchNewEvents(config, db, triaged, city);
    log(`  Created ${created} new canonical events`);

    log("  Post-research cleanup...");
    const mergedCount = mergeCanonicalDuplicates(db, city);
    if (mergedCount > 0) {
      log(`  Merged ${mergedCount} duplicate canonical events`);
    }

    log("  Assigning new events to all nearby franchises...");
    const assignResult = assignNewEventsToAllFranchises(
      db, createdIds, searchCity, config.assignmentRadiusMiles, log
    );
    if (assignResult.totalNewAssignments > 0) {
      log(`  ${assignResult.totalNewAssignments} assignments across ${assignResult.eventsProcessed} events`);
    }

    if (targetFranchise) {
      log("  Cross-assigning existing events to all nearby franchises...");
      const crossCount = crossAssignAllExistingEvents(
        db, targetFranchise, config.broadSearchRadiusMiles, config.assignmentRadiusMiles, log
      );
      if (crossCount > 0) {
        log(`  Created ${crossCount} new franchise assignments`);
      }
    }

    const ooa = deactivateOutOfArea(db, city, nearbyCitySet, searchCity);
    if (ooa > 0) log(`  Deactivated ${ooa} out-of-area events`);
    const ne = deactivateNonEvents(db, city);
    if (ne > 0) log(`  Deactivated ${ne} non-event entries`);
    const pe = deactivatePastEvents(db, city);
    if (pe > 0) log(`  Deactivated ${pe} past events`);

    // Stage 7: AI Score
    log("Stage 7: AI scoring new events...");
    const scored = await scoreEvents(config, db, city, createdIds);
    log(`  Scored ${scored} new events`);

    const unscoredIds = getUnscoredEventIds(db, city).filter(
      (id) => !createdIds.includes(id)
    );
    if (unscoredIds.length > 0) {
      log(`  Found ${unscoredIds.length} previously unscored events, scoring them now...`);
      const rescored = await scoreEvents(config, db, city, unscoredIds);
      log(`  Scored ${rescored} previously unscored events`);
    }

    // Stage 8: Report
    log("Stage 8: Generating report...");
    const allEvents = targetFranchise
      ? getActiveEventsByFranchise(db, targetFranchise.id)
      : getActiveCanonicalEvents(db, city);

    log(`  Total active: ${allEvents.length}`);

    await writeReport(config, city, allEvents);
    log(`Pipeline complete — ${allEvents.length} active events`);
    completeRun(db, runId, allEvents.length);
    return allEvents;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`Pipeline FAILED: ${msg}`);
    failRun(db, runId, msg);
    throw err;
  } finally {
    db.close();
  }
}

export async function runRefreshCycle(config: AgentConfig) {
  const city = config.storeName || config.searchLocation;
  console.log(`\n=== Refresh Cycle: "${city}" ===\n`);

  const db = openDb(config.dbPath);
  try {
    const events = getActiveCanonicalEvents(db, city);
    if (events.length === 0) {
      console.log("No cached events to refresh. Run the pipeline first.");
      return;
    }

    console.log(`Refreshing ${events.length} active canonical events...\n`);
    let unchanged = 0;
    let updated = 0;
    let failed = 0;

    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      const label = event.name.slice(0, 55);
      process.stdout.write(`  ${i + 1}/${events.length}: "${label}"... `);

      const result = await refreshCanonicalEvent(config, db, event);
      console.log(result);

      if (result === "unchanged") unchanged++;
      else if (result === "updated") updated++;
      else failed++;
    }

    console.log(`\nRefresh complete: ${updated} updated, ${unchanged} unchanged, ${failed} failed`);

    const mergedCount = mergeCanonicalDuplicates(db, city);
    if (mergedCount > 0) {
      console.log(`Merged ${mergedCount} duplicate canonical events`);
    }

    deactivateOutOfArea(db, city);
    deactivateNonEvents(db, city);
    deactivatePastEvents(db, city);

    console.log("\nRe-scoring all events...");
    const scored = await scoreEvents(config, db, city);
    console.log(`  Scored ${scored} events`);

    const freshEvents = getActiveCanonicalEvents(db, city);

    await writeReport(config, city, freshEvents);
  } finally {
    db.close();
  }
}

export async function runRescore(config: AgentConfig) {
  const city = config.storeName || config.searchLocation;
  console.log(`\n=== Re-score: "${city}" ===\n`);

  const db = openDb(config.dbPath);
  try {
    const mergedCount = mergeCanonicalDuplicates(db, city);
    if (mergedCount > 0) {
      console.log(`  Merged ${mergedCount} duplicate canonical events`);
    }
    deactivateOutOfArea(db, city);
    deactivateNonEvents(db, city);
    deactivatePastEvents(db, city);

    const events = getActiveCanonicalEvents(db, city);
    if (events.length === 0) {
      console.log("No active events to score.");
      return;
    }

    console.log(`Scoring ${events.length} active events...\n`);
    const scored = await scoreEvents(config, db, city);
    console.log(`  Scored ${scored} events`);

    const freshEvents = getActiveCanonicalEvents(db, city);

    await writeReport(config, city, freshEvents);
  } finally {
    db.close();
  }
}

export async function showReport(config: AgentConfig) {
  const db = openDb(config.dbPath);
  try {
    const city = config.storeName || config.searchLocation;

    const mergedCount = mergeCanonicalDuplicates(db, city);
    if (mergedCount > 0) {
      console.log(`Merged ${mergedCount} duplicate canonical events`);
    }

    deactivateNonEvents(db, city);
    deactivateOutOfArea(db, city);
    deactivatePastEvents(db, city);

    const events = getActiveCanonicalEvents(db, city);

    if (events.length === 0) {
      console.log(`\nNo active events for "${city}".`);
      return;
    }

    await writeReport(config, city, events);
  } finally {
    db.close();
  }
}

export async function showStatus(config: AgentConfig) {
  const db = openDb(config.dbPath);
  try {
    const stats = getDbStats(db);
    console.log("\n=== Database Status ===\n");
    console.log(`Raw URLs cached:       ${stats.rawCount}`);
    console.log(`Canonical events:      ${stats.canonicalCount}`);
    console.log(`Active events:         ${stats.activeCount}`);
    console.log(
      `Cities:                ${stats.cities.length > 0 ? stats.cities.join(", ") : "(none)"}`
    );
  } finally {
    db.close();
  }
}

function printEvents(events: CanonicalEventRow[]) {
  console.log(`\n--- ${events.length} Events ---\n`);
  for (const [i, event] of events.entries()) {
    console.log(`${i + 1}. [${event.score}/100] ${event.name}`);
    if (event.date_display) console.log(`   Date: ${event.date_display}`);
    else if (event.date_start)
      console.log(
        `   Date: ${event.date_start}${event.date_end ? ` to ${event.date_end}` : ""}`
      );
    if (event.location) console.log(`   Location: ${event.location}`);
    if (event.event_type) console.log(`   Type: ${event.event_type}`);
    if (event.estimated_attendance)
      console.log(`   Est. attendance: ${event.estimated_attendance}`);
    if (event.is_recurring)
      console.log(`   Recurring: yes`);
    if (event.organizer) console.log(`   Organizer: ${event.organizer}`);
    if (event.contact_info) console.log(`   Contact: ${event.contact_info}`);
    if (event.registration_url)
      console.log(`   Register: ${event.registration_url}`);
    if (event.description) console.log(`   ${event.description}`);
    if (event.reasoning) console.log(`   Reasoning: ${event.reasoning}`);
    if (event.discovered_via)
      console.log(`   Discovered via: ${event.discovered_via}`);
    console.log();
  }
}

async function writeReport(
  config: AgentConfig,
  city: string,
  events: CanonicalEventRow[]
) {
  const outputDir = path.resolve("output");
  await mkdir(outputDir, { recursive: true });

  const dateStr = new Date().toISOString().split("T")[0];
  const slug = citySlug(city);
  const outputPath = path.join(outputDir, `events-${dateStr}-${slug}.json`);

  const filtered = events.filter((e) => e.score >= 1);

  const db = openDb(config.dbPath);
  try {
    const dbStats = getDbStats(db);

    const output = {
      generatedAt: new Date().toISOString(),
      location: city,
      storeAddress: config.storeAddress || null,
      pipeline: "incremental",
      cache: {
        rawUrlsCached: dbStats.rawCount,
        totalCanonicalEvents: dbStats.canonicalCount,
        activeCanonicalEvents: dbStats.activeCount,
      },
      minRelevanceScore: config.minRelevanceScore,
      totalEvents: filtered.length,
      events: filtered.map((e) => {
        const sourceUrls = getSourceUrlsForCanonical(db, e.id);

        let assignedFranchise: { storeName: string; address: string } | null = null;
        if (e.assigned_franchise_id) {
          const franchise = db
            .prepare("SELECT store_name, address FROM franchise_locations WHERE id = ?")
            .get(e.assigned_franchise_id) as { store_name: string; address: string } | undefined;
          if (franchise) {
            assignedFranchise = {
              storeName: franchise.store_name,
              address: franchise.address,
            };
          }
        }

        return {
          id: e.id,
          name: e.name,
          eventType: e.event_type,
          location: e.location,
          dateDisplay: e.date_display,
          dateStart: e.date_start,
          dateEnd: e.date_end,
          estimatedAttendance: e.estimated_attendance,
          isRecurring: Boolean(e.is_recurring),
          description: e.description,
          organizer: e.organizer,
          contactInfo: e.contact_info,
          registrationUrl: e.registration_url,
          score: e.score,
          reasoning: e.reasoning,
          estimatedRevenueLow: e.estimated_revenue_low,
          estimatedRevenueHigh: e.estimated_revenue_high,
          revenueReasoning: e.revenue_reasoning,
          status: e.status,
          sourceUrls,
          researchedAt: e.researched_at,
          ...(assignedFranchise ? { assignedFranchise } : {}),
          ...(e.discovered_via ? { discoveredVia: e.discovered_via } : {}),
        };
      }),
    };

    await writeFile(outputPath, JSON.stringify(output, null, 2));
    console.log(`\nResults written to ${outputPath}`);

    printEvents(filtered);
  } finally {
    db.close();
  }
}

export async function runMultiCity(config: AgentConfig, locationsFilePath: string) {
  const raw = await readFile(locationsFilePath, "utf-8");
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

  if (lines.length === 0) {
    console.log("No locations found in file.");
    return;
  }

  const locations = lines.map((line) => parseLocation(line));

  const db = openDb(config.dbPath);
  const startTime = Date.now();

  console.log(`\n=== Multi-Location Pipeline: ${locations.length} franchise locations ===\n`);

  let completed = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < locations.length; i++) {
    const loc = locations[i];
    const label = loc.fullAddress || loc.searchCity;
    const progress = getCityProgress(db, loc.searchCity);

    if (progress?.status === "completed") {
      skipped++;
      console.log(`[${i + 1}/${locations.length}] "${label}" — already completed (${progress.event_count} events), skipping`);
      continue;
    }

    console.log(`\n[${i + 1}/${locations.length}] "${label}" — starting...`);
    upsertCityProgress(db, loc.searchCity, { status: "running", started_at: new Date().toISOString() });

    try {
      const locationConfig = {
        ...config,
        searchLocation: loc.searchCity,
        searchArea: loc.searchCity,
        storeAddress: loc.fullAddress,
      };
      const locStart = Date.now();
      const events = await runIncrementalPipeline(locationConfig);
      const eventCount = events?.length ?? 0;
      const elapsed = ((Date.now() - locStart) / 1000).toFixed(1);

      upsertCityProgress(db, loc.searchCity, {
        status: "completed",
        completed_at: new Date().toISOString(),
        event_count: eventCount,
      });
      completed++;
      console.log(`[${i + 1}/${locations.length}] "${label}" — done in ${elapsed}s (${eventCount} events)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      upsertCityProgress(db, loc.searchCity, { status: "failed", error: msg });
      failed++;
      console.error(`[${i + 1}/${locations.length}] "${label}" — FAILED: ${msg}`);
    }
  }

  db.close();

  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log(`\n=== Multi-Location Complete ===`);
  console.log(`  Completed: ${completed}, Skipped: ${skipped}, Failed: ${failed}`);
  console.log(`  Total time: ${totalElapsed}s`);
}

export async function showMultiCityStatus(config: AgentConfig) {
  const db = openDb(config.dbPath);
  try {
    const all = getAllCityProgress(db);
    if (all.length === 0) {
      console.log("No multi-city runs found.");
      return;
    }
    const completedRows = all.filter((c) => c.status === "completed");
    const pending = all.filter((c) => c.status === "pending" || c.status === "running");
    const failedRows = all.filter((c) => c.status === "failed");

    console.log(`\n=== Multi-City Status ===`);
    console.log(`  Total: ${all.length}, Completed: ${completedRows.length}, Pending/Running: ${pending.length}, Failed: ${failedRows.length}`);
    console.log(`  Total events: ${completedRows.reduce((sum, c) => sum + c.event_count, 0)}`);

    if (failedRows.length > 0) {
      console.log(`\n  Failed cities:`);
      failedRows.forEach((c) => console.log(`    - ${c.city}: ${c.error?.slice(0, 80)}`));
    }
  } finally {
    db.close();
  }
}
