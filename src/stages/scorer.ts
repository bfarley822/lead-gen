import { z } from "zod";
import type Database from "better-sqlite3";
import type { AgentConfig } from "../types.js";
import { updateCanonicalResearch, getActiveCanonicalEvents, type CanonicalEventRow } from "../db.js";
import { stageChat } from "../llm.js";

const SCORE_BATCH_SIZE = 20;
const REQUEST_TIMEOUT_MS = 90000;

const CONVERSION_RATES: Record<string, { low: number; high: number }> = {
  low: { low: 0.05, high: 0.10 },
  mid: { low: 0.10, high: 0.20 },
  high: { low: 0.20, high: 0.35 },
};

const ITEM_PRICE = 7;

const ScoreItemSchema = z.object({
  id: z.coerce.number(),
  score: z.coerce.number().min(0).max(100),
  reasoning: z.string(),
  estimated_attendees: z.coerce.number().nullable().default(null),
  conversion_tier: z.enum(["low", "mid", "high"]).nullable().default(null),
});

const TIER_LABELS: Record<string, string> = {
  low: "Low (5–10%) — outdoor festival, lots of competition",
  mid: "Mid (10–20%) — food-focused event, moderate foot traffic",
  high: "High (20–35%) — dessert-specific event, captive audience",
};

type RevenueResult = { low: number; high: number; reasoning: string };

function parseAttendanceString(val: string | null): number | null {
  if (!val) return null;
  const nums = val.match(/[\d,]+/g);
  if (!nums || nums.length === 0) return null;
  const parsed = nums.map((n) => parseInt(n.replace(/,/g, ""), 10)).filter((n) => !isNaN(n) && n > 0);
  if (parsed.length === 0) return null;
  return Math.round(parsed.reduce((a, b) => a + b, 0) / parsed.length);
}

function computeRevenue(llmAttendees: number | null, tier: string | null, fallbackAttendance?: string | null): RevenueResult | null {
  const attendees = (llmAttendees && llmAttendees > 0) ? llmAttendees : parseAttendanceString(fallbackAttendance ?? null);
  if (!attendees || attendees <= 0) return null;
  const effectiveTier = tier ?? "low";
  const rates = CONVERSION_RATES[effectiveTier];
  if (!rates) return null;
  const low = Math.round(attendees * rates.low * ITEM_PRICE);
  const high = Math.round(attendees * rates.high * ITEM_PRICE);
  const tierLabel = TIER_LABELS[effectiveTier] ?? effectiveTier;
  const defaultNote = !tier ? " (defaulted — tier unknown)" : "";
  const reasoning = `Based on ~${attendees.toLocaleString()} estimated attendees at $${ITEM_PRICE}/item. Conversion tier: ${tierLabel}${defaultNote}. Estimated ${Math.round(rates.low * 100)}–${Math.round(rates.high * 100)}% of attendees buy, producing $${low.toLocaleString()}–$${high.toLocaleString()} in revenue.`;
  return { low, high, reasoning };
}

function buildScoringSystemPrompt(city: string, storeAddress: string): string {
  const locationContext = storeAddress
    ? `a Crumbl Cookies franchise at ${storeAddress}`
    : `a Crumbl Cookies franchise near ${city}`;

  return `You are scoring events for ${locationContext}. The franchise has TWO revenue channels:
1. POPUP BOOTH — selling Crumbl cookies at events with foot traffic (markets, fairs, festivals, expos)
2. CATERING — large Crumbl cookie orders for organizations (corporate events, weddings, company parties, school events)

Score each event on a 0-100 scale for cookie sales potential. The score should reflect BOTH the quality/proximity of the event AND the projected revenue opportunity.

SCORING:
90-100: Large local event within 10 miles with high revenue potential ($5,000+). High attendance, vendor registration available, and clear opportunity for popup or catering.
80-89: Strong event within 10 miles with good revenue potential ($2,000-$5,000). Large gathering ideal for popup booth or catering.
60-79: Promising event with moderate revenue potential ($500-$2,000). May be missing some details or slightly farther away (5-10 miles).
40-59: Small or niche event with lower revenue potential (under $500), or a decent event 10+ miles away.
20-39: Generic venue page, calendar, or listing page — not a specific event.
0-19: Wrong location, irrelevant, competitor business, not an event.

REVENUE IMPACT ON SCORE: An event with very high projected revenue (e.g. 10,000+ attendees) should score higher than a similar event with low attendance. Revenue potential is a key differentiator — prioritize events where the franchise can make the most money.

PROXIMITY: Events within ~5 miles of the store are ideal. Events 5-10 miles away are acceptable. Events over 10 miles from ${city} should be penalized. Events in a different state or distant city score 0-19.
NOT EVENTS (score 0-19):
- Generic platform pages (Meetup login/about/topics, online-only platform pages without a specific event)
- Competitor food businesses (bakeries, restaurants, catering companies)
- Articles, how-to guides, recipe pages, webinars about generic topics
- Venue listing pages without a specific event date
- Online-only events with no physical location near ${city}

REVENUE ESTIMATION:
For each event, estimate the number of attendees (your best single numeric guess) and classify the conversion tier:
- "low": outdoor festival, lots of food competition, hot weather — expect 5-10% of attendees to buy
- "mid": food-focused event, moderate foot traffic past your booth — expect 10-20% to buy
- "high": dessert-specific event, captive audience, post-meal timing — expect 20-35%+ to buy
Always provide your best estimated_attendees guess if ANY attendance info is available (even from the event description or type). Only set estimated_attendees to null if attendance is truly impossible to guess.

Reply with ONLY a JSON array. Each element: {"id": <event_id>, "score": <0-100>, "reasoning": "brief explanation", "estimated_attendees": <number_or_null>, "conversion_tier": <"low"|"mid"|"high"|null>}
IMPORTANT: Output ONLY the JSON array. No markdown, no explanation.`;
}

function buildScoringUserPrompt(events: CanonicalEventRow[]): string {
  return events.map((e) => {
    const parts = [
      `ID=${e.id}: "${e.name}"`,
      e.event_type ? `Type: ${e.event_type}` : null,
      e.location ? `Location: ${e.location}` : null,
      e.date_display
        ? `Date: ${e.date_display}`
        : e.date_start
          ? `Date: ${e.date_start}${e.date_end ? ` to ${e.date_end}` : ""}`
          : null,
      e.estimated_attendance ? `Attendance: ${e.estimated_attendance}` : null,
      e.description ? `Desc: ${e.description}` : null,
      e.registration_url ? `Has vendor registration` : null,
    ].filter(Boolean);
    return parts.join(" | ");
  }).join("\n");
}

function extractJsonArray(raw: string): unknown[] {
  const stripped = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  try {
    const parsed = JSON.parse(stripped);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* fallback */ }
  const start = stripped.indexOf("[");
  const end = stripped.lastIndexOf("]");
  if (start !== -1 && end > start) {
    const parsed = JSON.parse(stripped.slice(start, end + 1));
    if (Array.isArray(parsed)) return parsed;
  }
  throw new Error("Could not extract JSON array from scoring response");
}

async function callScore(
  config: AgentConfig,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const chat = stageChat(config, "scoring", REQUEST_TIMEOUT_MS);
  return chat([
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ]);
}

export async function scoreEvents(
  config: AgentConfig,
  db: Database.Database,
  city: string,
  eventIds?: number[]
): Promise<number> {
  let events: CanonicalEventRow[];
  if (eventIds && eventIds.length > 0) {
    const all = getActiveCanonicalEvents(db, city);
    events = all.filter((e) => eventIds.includes(e.id));
  } else {
    events = getActiveCanonicalEvents(db, city);
  }

  if (events.length === 0) return 0;

  const log = config.onLog ?? console.log;
  const systemPrompt = buildScoringSystemPrompt(city, config.storeAddress);
  let scored = 0;
  const totalBatches = Math.ceil(events.length / SCORE_BATCH_SIZE);

  for (let i = 0; i < events.length; i += SCORE_BATCH_SIZE) {
    const batch = events.slice(i, i + SCORE_BATCH_SIZE);
    const batchNum = Math.floor(i / SCORE_BATCH_SIZE) + 1;
    log(`  Score batch ${batchNum}/${totalBatches} (${batch.length} events)...`);

    const userPrompt = buildScoringUserPrompt(batch);

    let batchScored = 0;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const raw = await callScore(config, systemPrompt, userPrompt);
        let results: unknown[];
        try {
          results = extractJsonArray(raw);
        } catch {
          log(`    Batch ${batchNum} JSON parse failed (attempt ${attempt}), raw preview: ${raw.slice(0, 200)}`);
          if (attempt < 2) continue;
          break;
        }

        log(`    Batch ${batchNum} returned ${results.length} items`);
        const now = new Date().toISOString();
        const batchById = new Map(batch.map((e) => [e.id, e]));

        for (const item of results) {
          const parseResult = ScoreItemSchema.safeParse(item);
          if (!parseResult.success) {
            log(`    Skip malformed item: ${JSON.stringify(item).slice(0, 120)}`);
            continue;
          }
          const parsed = parseResult.data;
          const originalEvent = batchById.get(parsed.id);
          if (originalEvent) {
            const revenue = computeRevenue(parsed.estimated_attendees, parsed.conversion_tier, originalEvent.estimated_attendance);
            updateCanonicalResearch(db, parsed.id, {
              score: parsed.score,
              reasoning: parsed.reasoning,
              estimated_revenue_low: revenue?.low ?? null,
              estimated_revenue_high: revenue?.high ?? null,
              revenue_reasoning: revenue?.reasoning ?? null,
              updated_at: now,
            });
            scored++;
            batchScored++;
            const revStr = revenue ? ` | Est. revenue: $${revenue.low.toLocaleString()}–$${revenue.high.toLocaleString()}` : "";
            log(`    Scored #${parsed.id}: ${parsed.score}/100 — ${parsed.reasoning.slice(0, 80)}${revStr}`);
          } else {
            log(`    Skipped unknown id ${parsed.id}`);
          }
        }

        if (batchScored === 0 && batch.length > 0 && attempt < 2) {
          log(`    Batch ${batchNum} returned 0 valid scores, retrying...`);
          continue;
        }
        break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`  Score batch ${batchNum} failed (attempt ${attempt}): ${msg}`);
        if (attempt >= 2) {
          log(`  Score batch ${batchNum} exhausted retries, ${batch.length} events left unscored`);
        }
      }
    }
    if (batchScored < batch.length) {
      log(`    Batch ${batchNum}: scored ${batchScored}/${batch.length} events`);
    }
  }

  return scored;
}
