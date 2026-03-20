import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import pLimit from "p-limit";
import type Database from "better-sqlite3";
import type { AgentConfig, CollectedEvent, ResearchData } from "../types.js";
import { ResearchDataSchema } from "../types.js";
import { hashUrl, insertCanonicalEvent, updateCanonicalResearch, getPrimarySourceUrl, type CanonicalEventRow } from "../db.js";
import type { DedupNewGroup } from "./deduplicator.js";
import { stageChat } from "../llm.js";

const REQUEST_TIMEOUT_MS = 120000;
const FETCH_TIMEOUT_MS = 15000;
const MAX_CONTENT_CHARS = 4000;
const BATCH_CONTENT_CHARS = 2000;
const RESEARCH_BATCH_SIZE = 5;
const FETCH_CONCURRENCY = 8;

function buildResearchPrompt(searchLocation: string, storeAddress: string): string {
  const locationContext = storeAddress
    ? `a Crumbl Cookies franchise at ${storeAddress}. Events should be near ${searchLocation}.`
    : `a Crumbl Cookies franchise near ${searchLocation}.`;

  return `You are a research assistant extracting structured event data from web pages for ${locationContext}

You will receive a webpage's content along with metadata about an event. Analyze it thoroughly and extract structured details.

Reply with ONLY a JSON object, no other text.

Schema:
{
  "name": "Official event name (full name, not just page title)",
  "eventType": "festival | craft fair | farmers market | expo | wedding expo | corporate event | county fair | rodeo | parade | community event | etc.",
  "location": "Full address or venue name + city, state — use the ACTUAL city where the venue is located",
  "dateStart": "YYYY-MM-DD or null",
  "dateEnd": "YYYY-MM-DD or null",
  "dateDisplay": "Human-readable date range, e.g. 'July 4-6, 2026' or 'Every Saturday' or null",
  "estimatedAttendance": "ALWAYS provide an estimate, even a rough range — NEVER null. Use clues from venue size, event type, and context.",
  "isRecurring": "true if this event happens regularly (annually, weekly, monthly, seasonally). false if it is a one-time event.",
  "description": "1-3 sentence summary of what this event is",
  "organizer": "Organization or person running the event, or null",
  "contactInfo": "General contact info string (legacy field) — email, phone, or website for the organizer, or null",
  "contactMethod": "Best way to reach this event's organizer. One of: email | phone | text | website_form | social_media | apply_online | in_person | null. Pick the method most likely to get a response about vendor/catering opportunities.",
  "contactPhone": "Phone number for the organizer or event contact, formatted as found on the page, or null",
  "contactEmail": "Email address for the organizer or event contact, or null",
  "contactUrl": "URL to a contact form, vendor inquiry page, or the best page to reach the organizer (distinct from registrationUrl), or null",
  "registrationUrl": "Direct URL to apply/register as a vendor or participant, or null",
  "suggestedMessage": "A short, professional outreach message (2-4 sentences) from Crumbl Cookies expressing interest in participating as a vendor or providing catering for this specific event. Mention the event by name. Be friendly and specific to the event type. Always include a request for next steps or who to speak with. Or null if no contact path exists."
}

LOCATION ACCURACY: The "location" field must reflect where the event ACTUALLY takes place.
- Do NOT default to "${searchLocation}" — only use it if the page content confirms the event is there.
- If the venue is a well-known place in a different city (e.g. a university, convention center, arena), use that city.
- If the page doesn't state a specific location, use null rather than guessing.

CONTACT INFO PRIORITY: Extract ALL available contact details from the page.
- Look for phone numbers, email addresses, contact forms, social media links, and "apply here" buttons.
- contactMethod should reflect whichever channel is most likely to get a response for vendor/catering inquiries.
- If a vendor application form exists, contactMethod should be "apply_online" and contactUrl should link to it.
- If only a general contact form exists, contactMethod should be "website_form".
- Prioritize: direct email/phone > vendor application > contact form > social media > null.
- ALWAYS provide at least one of contactPhone, contactEmail, or contactUrl when any contact path exists on the page.

SUGGESTED MESSAGE: Write as if from a local Crumbl Cookies franchise owner.
- Reference the specific event name and type.
- For festivals/fairs/markets: express interest in having a popup booth.
- For corporate events/weddings/school events: offer catering with cookie boxes or a dessert table.
- Keep it concise, warm, and professional. End with a clear call to action.

ESTIMATED ATTENDANCE — always give a range based on event type when exact numbers aren't stated:
- County/state fair: 5,000-20,000
- Major festival (Holi, Fiesta Days): 10,000-50,000
- Community parade: 2,000-10,000
- Farmers market: 200-1,000
- Craft fair / holiday market: 500-3,000
- 5K / fun run: 300-2,000
- Expo / home show: 1,000-5,000
- School carnival: 200-800
- Corporate event / conference: 100-500
- Small community event: 50-300
Adjust up or down based on venue size, city population, and context clues.

IMPORTANT: Output ONLY the JSON object. No markdown, no explanation.`;
}

export async function fetchPageContent(url: string): Promise<{ text: string; hash: string } | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; LeadGenBot/1.0; +https://example.com)",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    clearTimeout(timeout);

    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
      return null;
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    $("script, style, nav, footer, header, iframe, noscript, svg").remove();
    $("[role='navigation'], [role='banner'], [role='contentinfo']").remove();

    const title = $("title").text().trim();
    const metaDesc =
      $('meta[name="description"]').attr("content")?.trim() ?? "";

    const mainContent =
      $("main").text() ||
      $("article").text() ||
      $('[role="main"]').text() ||
      $(".content, .main, #content, #main").text() ||
      $("body").text();

    const cleaned = mainContent
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_CONTENT_CHARS);

    const text = `Page title: ${title}\nMeta description: ${metaDesc}\n\nContent:\n${cleaned}`;
    const hash = createHash("sha256").update(text).digest("hex").slice(0, 16);

    return { text, hash };
  } catch {
    return null;
  }
}

function extractJson(raw: string): unknown {
  const stripped = raw
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();
  try {
    return JSON.parse(stripped);
  } catch {
    // fallback
  }
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start !== -1 && end > start) {
    return JSON.parse(stripped.slice(start, end + 1));
  }
  throw new Error("Could not extract JSON from research response");
}

async function callResearch(
  config: AgentConfig,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const chat = stageChat(config, "research", REQUEST_TIMEOUT_MS);
  return chat([
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ]);
}

function buildUserPrompt(
  events: CollectedEvent[],
  pageContent: string | null
): string {
  const metadata = events
    .map(
      (e) =>
        `- Title: ${e.title}\n  URL: ${e.url}\n  Snippet: ${e.description.slice(0, 300)}`
    )
    .join("\n");

  if (pageContent) {
    return `SOURCE PAGES:\n${metadata}\n\nFETCHED PAGE CONTENT:\n${pageContent}`;
  }
  return `SOURCE PAGES (could not fetch page content, analyze from metadata only):\n${metadata}`;
}

async function researchGroup(
  config: AgentConfig,
  group: DedupNewGroup,
  city: string,
  systemPrompt: string
): Promise<{
  research: ResearchData;
  contentHash: string | null;
  sourceUrlHashes: string[];
} | null> {
  const primaryUrl = group.events[0].url;
  const pageResult = await fetchPageContent(primaryUrl);

  const userPrompt = buildUserPrompt(
    group.events,
    pageResult?.text ?? null
  );

  try {
    const raw = await callResearch(config, systemPrompt, userPrompt);
    const parsed = extractJson(raw);
    const result = ResearchDataSchema.parse(parsed);

    if (!result.name) {
      result.name = group.events[0].title;
    }

    const sourceUrlHashes = group.events.map((e) => hashUrl(e.url));

    return {
      research: result as ResearchData,
      contentHash: pageResult?.hash ?? null,
      sourceUrlHashes,
    };
  } catch (err) {
    console.warn(
      `  Research failed for "${group.events[0].title.slice(0, 60)}": ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}

export async function refreshCanonicalEvent(
  config: AgentConfig,
  db: Database.Database,
  event: CanonicalEventRow
): Promise<"unchanged" | "updated" | "failed"> {
  const url = getPrimarySourceUrl(db, event.id);
  if (!url) return "failed";

  const pageResult = await fetchPageContent(url);
  if (!pageResult) return "failed";

  if (pageResult.hash === event.page_content_hash) {
    return "unchanged";
  }

  const systemPrompt = buildResearchPrompt(event.city, config.storeAddress);
  const userPrompt = `SOURCE PAGE:\n- Title: ${event.name}\n  URL: ${url}\n\nFETCHED PAGE CONTENT:\n${pageResult.text}`;

  try {
    const raw = await callResearch(config, systemPrompt, userPrompt);
    const parsed = extractJson(raw);
    const result = ResearchDataSchema.parse(parsed);

    const now = new Date().toISOString();
    updateCanonicalResearch(db, event.id, {
      name: result.name ?? event.name,
      event_type: result.eventType,
      location: result.location,
      date_start: result.dateStart,
      date_end: result.dateEnd,
      date_display: result.dateDisplay,
      estimated_attendance: result.estimatedAttendance,
      is_recurring: result.isRecurring ? 1 : 0,
      description: result.description,
      organizer: result.organizer,
      contact_info: result.contactInfo,
      contact_method: result.contactMethod,
      contact_phone: result.contactPhone,
      contact_email: result.contactEmail,
      contact_url: result.contactUrl,
      registration_url: result.registrationUrl,
      suggested_message: result.suggestedMessage,
      page_content_hash: pageResult.hash,
      researched_at: now,
      updated_at: now,
    });

    return "updated";
  } catch (err) {
    console.warn(
      `    Research failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return "failed";
  }
}

type FetchedGroup = {
  group: DedupNewGroup;
  pageResult: { text: string; hash: string } | null;
};

function buildBatchSystemPrompt(searchLocation: string, storeAddress: string, count: number): string {
  const base = buildResearchPrompt(searchLocation, storeAddress);
  return base.replace(
    "Reply with ONLY a JSON object, no other text.",
    `You will receive ${count} events to research. Reply with ONLY a JSON array of ${count} objects (one per event, in the same order). No other text.`
  );
}

function buildBatchUserPrompt(fetched: FetchedGroup[]): string {
  return fetched.map((f, i) => {
    const metadata = f.group.events
      .map((e) => `- Title: ${e.title}\n  URL: ${e.url}\n  Snippet: ${e.description.slice(0, 200)}`)
      .join("\n");
    const content = f.pageResult?.text?.slice(0, BATCH_CONTENT_CHARS) ?? "(could not fetch page)";
    return `=== EVENT ${i + 1} ===\n${metadata}\n\nPage content:\n${content}`;
  }).join("\n\n");
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
  throw new Error("Could not extract JSON array from batch response");
}

function saveResearchResult(
  db: Database.Database,
  research: ResearchData,
  group: DedupNewGroup,
  contentHash: string | null,
  city: string
): number {
  const now = new Date().toISOString();
  const row: Omit<CanonicalEventRow, "id"> = {
    name: research.name || group.events[0].title,
    event_type: research.eventType,
    location: research.location,
    date_start: research.dateStart,
    date_end: research.dateEnd,
    date_display: research.dateDisplay,
    estimated_attendance: research.estimatedAttendance,
    is_recurring: research.isRecurring ? 1 : 0,
    description: research.description,
    organizer: research.organizer,
    contact_info: research.contactInfo,
    contact_method: research.contactMethod,
    contact_phone: research.contactPhone,
    contact_email: research.contactEmail,
    contact_url: research.contactUrl,
    registration_url: research.registrationUrl,
    suggested_message: research.suggestedMessage,
    score: 0,
    reasoning: null,
    estimated_revenue_low: null,
    estimated_revenue_high: null,
    revenue_reasoning: null,
    research_summary: null,
    page_content_hash: contentHash,
    status: "active",
    city,
    assigned_franchise_id: null,
    discovered_via: null,
    created_at: now,
    researched_at: now,
    updated_at: now,
  };

  const sourceUrlHashes = group.events.map((e) => hashUrl(e.url));
  return insertCanonicalEvent(db, row, sourceUrlHashes);
}

async function researchBatch(
  config: AgentConfig,
  db: Database.Database,
  groups: DedupNewGroup[],
  city: string,
  batchLabel: string
): Promise<number[]> {
  const limit = pLimit(FETCH_CONCURRENCY);
  const fetched: FetchedGroup[] = await Promise.all(
    groups.map((group) =>
      limit(async () => ({
        group,
        pageResult: await fetchPageContent(group.events[0].url),
      }))
    )
  );

  const systemPrompt = buildBatchSystemPrompt(city, config.storeAddress, fetched.length);
  const userPrompt = buildBatchUserPrompt(fetched);
  const createdIds: number[] = [];

  try {
    const raw = await callResearch(config, systemPrompt, userPrompt);
    const results = extractJsonArray(raw);

    for (let j = 0; j < Math.min(results.length, fetched.length); j++) {
      try {
        const parsed = ResearchDataSchema.parse(results[j]);
        const research = parsed as ResearchData;
        if (!research.name) research.name = fetched[j].group.events[0].title;

        const id = saveResearchResult(db, research, fetched[j].group, fetched[j].pageResult?.hash ?? null, city);
        createdIds.push(id);
      } catch {
        console.warn(`    ${batchLabel}[${j + 1}] parse failed, falling back to individual`);
        const fallback = await researchGroup(config, fetched[j].group, city, buildResearchPrompt(city, config.storeAddress));
        if (fallback) {
          const id = saveResearchResult(db, fallback.research, fetched[j].group, fallback.contentHash, city);
          createdIds.push(id);
        }
      }
    }
    return createdIds;
  } catch (err) {
    console.warn(`    Batch failed (${err instanceof Error ? err.message : String(err)}), falling back to individual`);
    const singlePrompt = buildResearchPrompt(city, config.storeAddress);
    for (const f of fetched) {
      const result = await researchGroup(config, f.group, city, singlePrompt);
      if (result) {
        const id = saveResearchResult(db, result.research, f.group, result.contentHash, city);
        createdIds.push(id);
      }
    }
    return createdIds;
  }
}

export async function researchNewEvents(
  config: AgentConfig,
  db: Database.Database,
  newGroups: DedupNewGroup[],
  city: string
): Promise<{ created: number; createdIds: number[] }> {
  if (newGroups.length === 0) return { created: 0, createdIds: [] };

  const log = config.onLog ?? console.log;
  const allCreatedIds: number[] = [];
  const totalBatches = Math.ceil(newGroups.length / RESEARCH_BATCH_SIZE);

  for (let i = 0; i < newGroups.length; i += RESEARCH_BATCH_SIZE) {
    const batch = newGroups.slice(i, i + RESEARCH_BATCH_SIZE);
    const batchNum = Math.floor(i / RESEARCH_BATCH_SIZE) + 1;
    const labels = batch.map((g) => g.events[0].title.slice(0, 50)).join(" | ");
    log(`  Research batch ${batchNum}/${totalBatches} (${batch.length} events):`);
    for (const g of batch) {
      log(`    • ${g.events[0].title.slice(0, 80)} → ${g.events[0].url.slice(0, 60)}`);
    }

    const batchIds = await researchBatch(config, db, batch, city, `B${batchNum}`);
    allCreatedIds.push(...batchIds);
    log(`    → created ${batchIds.length}/${batch.length} events from batch ${batchNum}`);
  }

  return { created: allCreatedIds.length, createdIds: allCreatedIds };
}
