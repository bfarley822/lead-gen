import { z } from "zod";
import type Database from "better-sqlite3";
import type { AgentConfig, CollectedEvent } from "../types.js";
import { getCanonicalEventNames, hashUrl, linkSourceToCanonical } from "../db.js";
import { stageChat } from "../llm.js";

const BATCH_SIZE = 30;
const REQUEST_TIMEOUT_MS = 60000;

export type DedupAssignment = {
  existingId: number;
  events: CollectedEvent[];
};

export type DedupNewGroup = {
  events: CollectedEvent[];
};

export type DedupResult = {
  assignedToExisting: DedupAssignment[];
  newGroups: DedupNewGroup[];
};

const DedupResponseSchema = z.object({
  existing: z.array(
    z.object({
      canonicalId: z.number(),
      indices: z.array(z.number()),
    })
  ).default([]),
  newGroups: z.array(z.array(z.number())),
});

function flattenNewGroups(raw: unknown): number[][] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item: unknown) => {
    if (typeof item === "number") return [item];
    if (Array.isArray(item)) {
      const flat = item.flat(Infinity) as number[];
      return flat.filter((n) => typeof n === "number");
    }
    return [];
  }).filter((g) => g.length > 0);
}

function extractJson(raw: string): unknown {
  const stripped = raw
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();
  try {
    return JSON.parse(stripped);
  } catch {
    // fallback: find first { to last }
  }
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start !== -1 && end > start) {
    return JSON.parse(stripped.slice(start, end + 1));
  }
  throw new Error("Could not extract JSON from dedup response");
}

function buildDedupPrompt(
  newEvents: CollectedEvent[],
  existingNames: { id: number; name: string }[]
): string {
  const newListing = newEvents
    .map((e, i) => `  ${i}: "${e.title}" | ${e.url}`)
    .join("\n");

  const existingListing =
    existingNames.length > 0
      ? existingNames.map((e) => `  id=${e.id}: "${e.name}"`).join("\n")
      : "  (none)";

  return `You are grouping event URLs. Some may be pages about the same real-world event.

EXISTING canonical events:
${existingListing}

NEW events to classify:
${newListing}

RULES:
- If a new event is clearly about the same real-world event as an existing canonical event, assign it to that canonical ID.
- If multiple new events are about the same real-world event (but not matching any existing), group them together.
- If a new event is unique, put it in its own new group.
- Two entries are the same event if: same event name (even partially), same venue + date, one is a registration page for the other, or different websites covering the same event.
- Every new event index (0-${newEvents.length - 1}) must appear exactly once.

Reply with ONLY JSON:
{"existing":[{"canonicalId":1,"indices":[0,3]}],"newGroups":[[1,4],[2],[5,6]]}`;
}

async function callDedup(config: AgentConfig, prompt: string): Promise<string> {
  const chat = stageChat(config, "dedup", REQUEST_TIMEOUT_MS);
  return chat([{ role: "user", content: prompt }]);
}

async function dedupBatch(
  config: AgentConfig,
  events: CollectedEvent[],
  existingNames: { id: number; name: string }[]
): Promise<DedupResult> {
  const prompt = buildDedupPrompt(events, existingNames);
  const raw = await callDedup(config, prompt);

  const parsed = extractJson(raw) as Record<string, unknown>;

  if (parsed && typeof parsed === "object" && "newGroups" in parsed) {
    (parsed as Record<string, unknown>).newGroups = flattenNewGroups(
      (parsed as Record<string, unknown>).newGroups
    );
  }

  const validated = DedupResponseSchema.parse(parsed);
  const validExistingIds = new Set(existingNames.map((e) => e.id));

  const assignedToExisting: DedupAssignment[] = validated.existing
    .filter((a) => validExistingIds.has(a.canonicalId))
    .map((assignment) => ({
      existingId: assignment.canonicalId,
      events: assignment.indices
        .filter((i) => i >= 0 && i < events.length)
        .map((i) => events[i]),
    }))
    .filter((a) => a.events.length > 0);

  const assignedIndices = new Set(
    validated.existing.flatMap((a) => a.indices)
  );
  const newGroups: DedupNewGroup[] = validated.newGroups
    .map((indices) => ({
      events: indices
        .filter((i) => i >= 0 && i < events.length && !assignedIndices.has(i))
        .map((i) => events[i]),
    }))
    .filter((g) => g.events.length > 0);

  const coveredIndices = new Set([
    ...validated.existing.flatMap((a) => a.indices),
    ...validated.newGroups.flat(),
  ]);
  for (let i = 0; i < events.length; i++) {
    if (!coveredIndices.has(i)) {
      newGroups.push({ events: [events[i]] });
    }
  }

  return { assignedToExisting, newGroups };
}

export async function deduplicateEvents(
  config: AgentConfig,
  db: Database.Database,
  newEvents: CollectedEvent[],
  city: string,
  extraCanonicalNames?: { id: number; name: string }[]
): Promise<DedupResult> {
  if (newEvents.length === 0) {
    return { assignedToExisting: [], newGroups: [] };
  }

  const log = config.onLog ?? console.log;
  const cityNames = getCanonicalEventNames(db, city);
  const seenIds = new Set(cityNames.map((e) => e.id));
  const existingNames = [...cityNames];
  if (extraCanonicalNames) {
    for (const extra of extraCanonicalNames) {
      if (!seenIds.has(extra.id)) {
        existingNames.push(extra);
        seenIds.add(extra.id);
      }
    }
  }
  log(
    `  Dedup: ${newEvents.length} new events against ${existingNames.length} existing canonical events (${cityNames.length} local + ${existingNames.length - cityNames.length} nearby)`
  );

  if (newEvents.length <= BATCH_SIZE) {
    try {
      log(`  Analyzing ${newEvents.length} events for duplicates...`);
      const result = await dedupBatch(config, newEvents, existingNames);
      applyExistingAssignments(db, result);
      return result;
    } catch (err) {
      log(
        `  Dedup LLM failed, treating all as new: ${err instanceof Error ? err.message : String(err)}`
      );
      return fallbackAllNew(newEvents);
    }
  }

  const combined: DedupResult = { assignedToExisting: [], newGroups: [] };
  for (let i = 0; i < newEvents.length; i += BATCH_SIZE) {
    const batch = newEvents.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(newEvents.length / BATCH_SIZE);
    log(`  Dedup batch ${batchNum}/${totalBatches} (${batch.length} events)...`);

    try {
      const result = await dedupBatch(config, batch, existingNames);
      combined.assignedToExisting.push(...result.assignedToExisting);
      combined.newGroups.push(...result.newGroups);
      log(`    → ${result.assignedToExisting.length} matched existing, ${result.newGroups.length} new groups`);
    } catch (err) {
      log(
        `  Dedup batch ${batchNum} failed, treating as new: ${err instanceof Error ? err.message : String(err)}`
      );
      combined.newGroups.push(...batch.map((e) => ({ events: [e] })));
    }
  }

  applyExistingAssignments(db, combined);
  return combined;
}

function applyExistingAssignments(db: Database.Database, result: DedupResult) {
  for (const assignment of result.assignedToExisting) {
    for (const event of assignment.events) {
      try {
        const urlHash = hashUrl(event.url);
        linkSourceToCanonical(db, assignment.existingId, urlHash);
      } catch {
        // FK constraint can fail if the canonical ID is hallucinated
      }
    }
  }
}

function fallbackAllNew(events: CollectedEvent[]): DedupResult {
  return {
    assignedToExisting: [],
    newGroups: events.map((e) => ({ events: [e] })),
  };
}
