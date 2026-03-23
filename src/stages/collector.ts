import type { AgentConfig, CollectedEvent, SourceName } from "../types.js";
import { searchFeeds } from "../sources/rss.js";
import { queryOpenAiWebCollection } from "./openai-collector-search.js";

type SearXNGResult = {
  title: string;
  url: string;
  content: string;
  publishedDate?: string;
};

type SearXNGResponse = {
  results: SearXNGResult[];
};

type WebHitInput = {
  title: string;
  url: string;
  content: string;
  publishedDate?: string;
};

function toId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 48);
}

/**
 * Web search engines heavily match the token "new" on queries like "New York, NY …",
 * which pulls in Stack Overflow (`new` operator), "new branch" tutorials, etc.
 * Use a dense metro label for NYC (and trim sloppy franchise DB spacing).
 */
export function normalizeCityStateForSearchQueries(cityState: string) {
  const trimmed = cityState.trim();
  const parts = trimmed.split(",").map((p) => p.trim());
  if (parts.length < 2) return trimmed;

  const city = parts[0].replace(/\s+/g, " ").trim();
  const stateToken = parts[1].split(/\s+/)[0]?.toLowerCase() ?? "";
  const cityLower = city.toLowerCase();

  if ((cityLower === "new york" || cityLower === "new york city") && stateToken === "ny") {
    return "NYC NY";
  }

  return `${city}, ${stateToken.toUpperCase()}`;
}

function normalizeKey(title: string, url: string) {
  const titlePart = toId(title);
  try {
    const parsed = new URL(url);
    return `${titlePart}:${parsed.hostname}${parsed.pathname}`;
  } catch {
    return `${titlePart}:${url}`;
  }
}

const JUNK_SITE_EXCLUSIONS = [
  "stackoverflow.com",
  "stackexchange.com",
  "github.com",
  "faire.com",
  "coursera.org",
  "wikipedia.org",
  "britannica.com",
  "tripadvisor.com",
  "yelp.com",
  "dictionary.cambridge.org",
  "merriam-webster.com",
  "desmos.com",
  "calculator.com",
  "medium.com",
  "reddit.com",
];

function junkSiteExclusionClause() {
  return JUNK_SITE_EXCLUSIONS.map((d) => `-site:${d}`).join(" ");
}

/** Appends -site: filters (Google/Bing/DDG) so raw SERPs are less polluted before LLM stages. */
export function applySearchQueryHygiene(query: string) {
  return `${query.trim()} ${junkSiteExclusionClause()}`.trim();
}

function yearPair() {
  const y = new Date().getUTCFullYear();
  return [y, y + 1];
}

function buildQueriesForCity(city: string, keywords: string[]) {
  const years = yearPair();
  const baseQueries = keywords.flatMap((keyword) => [
    `${keyword} ${city}`,
    `${keyword} ${city} events`,
    `${keyword} ${city} tickets`,
    ...years.map((yr) => `${keyword} ${city} ${yr}`),
  ]);
  const communityQueries = [
    `${city} fairgrounds events`,
    `${city} chamber of commerce events`,
    `${city} city events calendar`,
    `${city} upcoming festivals`,
    `${city} corporate events catering`,
    `${city} wedding reception`,
    `${city} booth registration`,
    `${city} annual events`,
    `${city} days celebration`,
    `${city} summer events`,
    `${city} holiday market`,
    `${city} craft fair`,
    `${city} car show`,
    `${city} 5K run race`,
    `${city} concert in the park`,
    `${city} parade`,
    `${city} food truck rally`,
    `${city} school carnival fundraiser`,
    `${city} sports tournament`,
    `${city} rodeo`,
    `${city} holi festival`,
    `${city} christmas lights`,
    `${city} easter egg hunt`,
    `${city} fourth of july fireworks`,
    `${city} trunk or treat halloween`,
    `${city} spring event`,
    `${city} fall event`,
    `${city} winter event`,
    `${city} outdoor recreation expo`,
    `${city} home show`,
    `${city} gun show`,
    `${city} business expo`,
    `${city} fundraiser gala dinner`,
    `${city} fun run walk`,
    `${city} community dinner`,
    `site:eventbrite.com/e/ ${city}`,
    `site:facebook.com/events ${city}`,
    `cookie vendor booth ${city}`,
    `food vendor application ${city}`,
    `dessert catering ${city}`,
    `corporate catering order ${city}`,
    `popup booth registration ${city}`,
    `food truck festival ${city}`,
    `sweet treats vendor ${city}`,
    `inurl:/events/ ${city}`,
    `inurl:eventbrite.com/e ${city}`,
  ];
  return [...baseQueries, ...communityQueries];
}

function buildNearbyCityQueries(city: string) {
  return [
    `${city} city events calendar`,
    `${city} upcoming festivals`,
    `${city} annual events`,
    `${city} craft fair`,
    `${city} community event`,
    `${city} fair festival`,
    `${city} farmers market`,
    `${city} parade`,
    `${city} food truck festival`,
    `site:eventbrite.com/e/ ${city}`,
    `site:facebook.com/events ${city}`,
  ];
}

function buildCollectorQueryStrings(config: AgentConfig, nearbyCities: string[] = []) {
  const primaryCity = normalizeCityStateForSearchQueries(config.searchArea);
  const primaryQueries = buildQueriesForCity(primaryCity, config.searchKeywords);

  const nearbyQueries = nearbyCities.flatMap((city) =>
    buildNearbyCityQueries(normalizeCityStateForSearchQueries(city))
  );

  return [...new Set([...primaryQueries, ...nearbyQueries])];
}

function buildSearxngQueries(config: AgentConfig, nearbyCities: string[] = []) {
  return buildCollectorQueryStrings(config, nearbyCities).map(applySearchQueryHygiene);
}

export function resolveCollectorSearchProvider(config: AgentConfig): "searxng" | "openai" {
  const mode = config.collectorSearchProvider.trim().toLowerCase();
  if (mode === "openai") return "openai";
  if (mode === "searxng") return "searxng";
  return config.llmProvider === "openai" ? "openai" : "searxng";
}

const SEARXNG_QUERY_DELAY_MS = 200;
const SEARXNG_MAX_RETRIES = 3;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function querySearXNG(
  baseUrl: string,
  query: string,
  config: AgentConfig,
  retryCount = 0
): Promise<SearXNGResult[]> {
  const url = new URL("/search", baseUrl);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("categories", config.searxngCategories.trim() || "general");
  url.searchParams.set("pageno", "1");
  if (config.searxngLanguage.trim()) {
    url.searchParams.set("language", config.searxngLanguage.trim());
  }
  const tr = config.searxngTimeRange.trim().toLowerCase();
  if (tr && tr !== "none" && tr !== "off") {
    url.searchParams.set("time_range", tr);
  }
  const engines = config.searxngEngines
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .join(",");
  if (engines) {
    url.searchParams.set("engines", engines);
  }

  if (retryCount > 0) {
    await sleep(SEARXNG_QUERY_DELAY_MS * 2 ** retryCount);
  }

  const response = await fetch(url.toString());

  if (response.status === 429 || response.status === 503) {
    if (retryCount < SEARXNG_MAX_RETRIES) {
      return querySearXNG(baseUrl, query, config, retryCount + 1);
    }
    return [];
  }

  if (!response.ok) {
    throw new Error(`SearXNG returned ${response.status}: ${response.statusText}`);
  }

  const data = (await response.json()) as SearXNGResponse;
  return data.results ?? [];
}

function mapWebSearchResult(
  item: WebHitInput,
  city: string,
  query: string,
  source: Extract<SourceName, "searxng" | "openai_search">
): CollectedEvent {
  const idPrefix = source === "openai_search" ? "openai" : "searxng";
  return {
    id: `${idPrefix}-${toId(item.url || item.title)}`,
    title: item.title,
    description: item.content ?? "",
    url: item.url,
    date: item.publishedDate ?? null,
    locationHint: city,
    source,
    collectedBy: query,
  };
}

export async function collectRawEvents(config: AgentConfig, nearbyCities: string[] = []) {
  const log = config.onLog ?? console.log;
  const provider = resolveCollectorSearchProvider(config);

  const searchResults: PromiseSettledResult<CollectedEvent[]>[] = [];

  if (provider === "openai") {
    if (!config.openaiApiKey.trim()) {
      throw new Error(
        "Collector is set to use OpenAI web search (COLLECTOR_SEARCH_PROVIDER or LLM_PROVIDER=openai) but OPENAI_API_KEY is missing"
      );
    }
    const queries = buildCollectorQueryStrings(config, nearbyCities);
    const batchSize = Math.max(1, Math.min(10, config.openaiCollectorConcurrency));
    log(
      `  OpenAI web search: ${queries.length} queries (${batchSize} concurrent, model ${config.openaiResponsesSearchModel})...`
    );
    for (let i = 0; i < queries.length; i += batchSize) {
      const batch = queries.slice(i, i + batchSize);
      const queryBatchNum = Math.floor(i / batchSize) + 1;
      const totalQueryBatches = Math.ceil(queries.length / batchSize);
      log(`  OpenAI search batch ${queryBatchNum}/${totalQueryBatches} (${batch.length} queries)...`);
      const batchResults = await Promise.allSettled(
        batch.map(async (query) => {
          try {
            const hits = await queryOpenAiWebCollection(config, query);
            return hits.map((item) =>
              mapWebSearchResult(
                {
                  title: item.title,
                  url: item.url,
                  content: item.content,
                },
                config.searchArea,
                query,
                "openai_search"
              )
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            log(`  OpenAI search failed for "${query.slice(0, 72)}…": ${msg}`);
            return [];
          }
        })
      );
      searchResults.push(...batchResults);
      if (i + batchSize < queries.length) {
        await sleep(config.openaiCollectorBatchDelayMs);
      }
    }
  } else {
    const queries = buildSearxngQueries(config, nearbyCities);
    log(`  SearXNG: ${queries.length} search queries in batches of 10...`);
    const BATCH_SIZE = 10;
    for (let i = 0; i < queries.length; i += BATCH_SIZE) {
      const batch = queries.slice(i, i + BATCH_SIZE);
      const queryBatchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalQueryBatches = Math.ceil(queries.length / BATCH_SIZE);
      log(`  Search batch ${queryBatchNum}/${totalQueryBatches} (${batch.length} queries)...`);
      const batchResults = await Promise.allSettled(
        batch.map(async (query) => {
          const results = await querySearXNG(config.searxngBaseUrl, query, config);
          return results.map((item) => mapWebSearchResult(item, config.searchArea, query, "searxng"));
        })
      );
      searchResults.push(...batchResults);
      if (i + BATCH_SIZE < queries.length) {
        await sleep(SEARXNG_QUERY_DELAY_MS);
      }
    }
  }

  const feedEvents = await searchFeeds(config.feedUrls);
  const collected: CollectedEvent[] = [];

  for (const settled of searchResults) {
    if (settled.status === "fulfilled") {
      collected.push(...settled.value);
    }
  }

  collected.push(
    ...feedEvents.map((event) => ({
      id: `rss-${toId(event.url || event.title)}`,
      title: event.title,
      description: event.description,
      url: event.url,
      date: event.date ?? null,
      locationHint: event.location ?? config.searchArea,
      source: event.source,
      collectedBy: "rss-feed",
    }))
  );

  const rawCount = collected.length;
  const deduped = new Map<string, CollectedEvent>();
  for (const item of collected) {
    const key = normalizeKey(item.title, item.url);
    if (!deduped.has(key)) {
      deduped.set(key, item);
    }
  }

  return {
    raw: collected,
    deduped: [...deduped.values()],
    rawCount,
    dedupedCount: deduped.size,
  };
}
