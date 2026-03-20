import { z } from "zod";
import type { AgentConfig } from "../types.js";
import type { DedupNewGroup } from "./deduplicator.js";
import { stageChat } from "../llm.js";

const TRIAGE_BATCH_SIZE = 12;
const REQUEST_TIMEOUT_MS = 60000;

const TriageItemSchema = z.object({
  index: z.number(),
  keep: z.preprocess(
    (v) => {
      if (typeof v === "boolean") return v;
      if (typeof v === "string") return v.toLowerCase() === "true" || v.toLowerCase() === "keep" || v.toLowerCase() === "yes";
      return false;
    },
    z.boolean()
  ),
  reason: z.string().optional().default(""),
});

function buildTriageSystemPrompt(city: string, storeAddress: string): string {
  const locationContext = storeAddress
    ? `a Crumbl Cookies franchise at ${storeAddress}`
    : `a Crumbl Cookies franchise near ${city}`;

  return `You are filtering event search results for ${locationContext}.

The franchise has two revenue channels:
1. POPUP BOOTH — selling cookies at events with foot traffic
2. CATERING — large cookie orders for organizations, corporate events, weddings, etc.

For each event, decide if it is a SPECIFIC, REAL EVENT worth researching further. Events should be within about 10 miles of the store.

KEEP:
- Specific events with a name (festivals, fairs, markets, expos, parades, 5K runs, rodeos, etc.)
- Vendor registration or application pages for events
- Events that could be good for a popup cookie booth or large catering order
- Corporate events, company parties, school events, weddings that might need dessert catering
- Specific community gatherings, celebrations, or competitions

REJECT (be aggressive — when in doubt, reject):
- Generic directory/listing pages ("Free Events - Eventbrite", "Best 10 Expos", "Things to do in...", "Top 10 Venues")
- Platform pages that are NOT events (Meetup login/about/topics/find pages, Coursera articles, recipe sites, how-to guides)
- COMPETITOR FOOD BUSINESSES: Any restaurant, bakery, catering company, or food delivery service (Chick-fil-A, Chipotle, Panda Express, Cracker Barrel, local caterers, food delivery apps). These are competitors, NOT event opportunities.
- WHOLESALE/E-COMMERCE PLATFORMS: Faire, Alibaba, or any wholesale marketplace page — these are not events.
- FINANCIAL/STOCK PAGES: Stock market quotes, market indexes, trading pages (CNBC, Barchart, Yahoo Finance).
- VENUE LISTING PAGES: Pages listing "10 Best Wedding Venues", "Meeting Rooms in...", venue rental sites without a specific event. A venue is not an event.
- VENDOR SERVICE COMPANIES: Photo booth rentals, DJ services, florists, event planners — these are service providers, not events.
- FOOD TRUCK DIRECTORIES: Pages listing food trucks in an area, food truck finder/booking platforms. A directory of food trucks is not an event.
- Job postings, salary pages, real estate listings
- Wikipedia, dictionary, or reference pages
- Calendar/category pages without a specific event name
- News articles that only mention events in passing
- Events clearly far from ${city} (different state or distant city). If the URL or title mentions a city/state far from ${city}, REJECT it.
- Browser cookie/privacy pages, corporate registration databases, TV show pages
- Generic "Conferences in [city]" aggregator pages without a specific named event

Reply with ONLY a JSON array. Each element: {"index": <number>, "keep": true/false, "reason": "brief reason"}
IMPORTANT: Output ONLY the JSON array. No markdown, no explanation.`;
}

function buildTriageUserPrompt(groups: DedupNewGroup[]): string {
  return groups.map((g, i) => {
    const primary = g.events[0];
    const snippet = primary.description.slice(0, 200);
    return `${i}: "${primary.title}" | ${primary.url} | ${snippet}`;
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
  throw new Error("Could not extract JSON array from triage response");
}

async function callTriage(
  config: AgentConfig,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const chat = stageChat(config, "triage", REQUEST_TIMEOUT_MS);
  return chat([
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ]);
}

export async function triageGroups(
  config: AgentConfig,
  groups: DedupNewGroup[],
  city: string
): Promise<{ kept: DedupNewGroup[]; rejectedCount: number }> {
  if (groups.length === 0) return { kept: [], rejectedCount: 0 };

  const log = config.onLog ?? console.log;
  const systemPrompt = buildTriageSystemPrompt(city, config.storeAddress);
  const kept: DedupNewGroup[] = [];
  let rejectedCount = 0;
  const totalBatches = Math.ceil(groups.length / TRIAGE_BATCH_SIZE);

  for (let i = 0; i < groups.length; i += TRIAGE_BATCH_SIZE) {
    const batch = groups.slice(i, i + TRIAGE_BATCH_SIZE);
    const batchNum = Math.floor(i / TRIAGE_BATCH_SIZE) + 1;

    log(`  Triage batch ${batchNum}/${totalBatches} (${batch.length} groups)...`);

    const userPrompt = buildTriageUserPrompt(batch);

    try {
      const raw = await callTriage(config, systemPrompt, userPrompt);
      const results = extractJsonArray(raw);

      const decisions = new Map<number, boolean>();
      for (const item of results) {
        try {
          const parsed = TriageItemSchema.parse(item);
          if (parsed.index >= 0 && parsed.index < batch.length) {
            decisions.set(parsed.index, parsed.keep);
          }
        } catch { /* skip malformed items */ }
      }

      const batchKept: string[] = [];
      const batchRejected: string[] = [];
      for (let j = 0; j < batch.length; j++) {
        const title = batch[j].events[0].title.slice(0, 60);
        const decision = decisions.get(j);
        if (decision === true) {
          kept.push(batch[j]);
          batchKept.push(title);
        } else {
          rejectedCount++;
          batchRejected.push(title);
        }
      }
      if (batchRejected.length > 0) {
        log(`    Rejected: ${batchRejected.join(", ")}`);
      }
      if (batchKept.length > 0) {
        log(`    Kept: ${batchKept.join(", ")}`);
      }
    } catch (err) {
      log(`  Triage batch ${batchNum} failed (${err instanceof Error ? err.message : String(err)}), keeping all`);
      kept.push(...batch);
    }
  }

  return { kept, rejectedCount };
}
