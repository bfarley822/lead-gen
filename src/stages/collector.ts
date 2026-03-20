import type { AgentConfig, CollectedEvent } from "../types.js";
import { searchFeeds } from "../sources/rss.js";

type SearXNGResult = {
  title: string;
  url: string;
  content: string;
  publishedDate?: string;
};

type SearXNGResponse = {
  results: SearXNGResult[];
};

function toId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 48);
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

function buildQueriesForCity(city: string, keywords: string[]) {
  const baseQueries = keywords.flatMap((keyword) => [
    `${keyword} ${city}`,
    `${keyword} ${city} events`,
    `${keyword} ${city} upcoming`,
    `${keyword} ${city} registration`,
    `${keyword} ${city} application`,
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

function buildCollectorQueries(config: AgentConfig, nearbyCities: string[] = []) {
  const primaryCity = config.searchArea;
  const primaryQueries = buildQueriesForCity(primaryCity, config.searchKeywords);

  const nearbyQueries = nearbyCities.flatMap((city) => buildNearbyCityQueries(city));

  return [...new Set([...primaryQueries, ...nearbyQueries])];
}

const SEARXNG_QUERY_DELAY_MS = 200;
const SEARXNG_MAX_RETRIES = 3;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function querySearXNG(baseUrl: string, query: string, retryCount = 0): Promise<SearXNGResult[]> {
  const url = new URL("/search", baseUrl);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("categories", "general");
  url.searchParams.set("pageno", "1");

  if (retryCount > 0) {
    await sleep(SEARXNG_QUERY_DELAY_MS * 2 ** retryCount);
  }

  const response = await fetch(url.toString());

  if (response.status === 429 || response.status === 503) {
    if (retryCount < SEARXNG_MAX_RETRIES) {
      return querySearXNG(baseUrl, query, retryCount + 1);
    }
    return [];
  }

  if (!response.ok) {
    throw new Error(`SearXNG returned ${response.status}: ${response.statusText}`);
  }

  const data = (await response.json()) as SearXNGResponse;
  return data.results ?? [];
}

function mapSearxngResult(
  item: SearXNGResult,
  city: string,
  query: string
): CollectedEvent {
  return {
    id: `searxng-${toId(item.url || item.title)}`,
    title: item.title,
    description: item.content ?? "",
    url: item.url,
    date: item.publishedDate ?? null,
    locationHint: city,
    source: "searxng",
    collectedBy: query,
  };
}

export async function collectRawEvents(config: AgentConfig, nearbyCities: string[] = []) {
  const log = config.onLog ?? console.log;
  const queries = buildCollectorQueries(config, nearbyCities);
  log(`  Sending ${queries.length} search queries in batches of 10...`);

  const BATCH_SIZE = 10;
  const searchResults: PromiseSettledResult<CollectedEvent[]>[] = [];
  for (let i = 0; i < queries.length; i += BATCH_SIZE) {
    const batch = queries.slice(i, i + BATCH_SIZE);
    const queryBatchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalQueryBatches = Math.ceil(queries.length / BATCH_SIZE);
    log(`  Search batch ${queryBatchNum}/${totalQueryBatches} (${batch.length} queries)...`);
    const batchResults = await Promise.allSettled(
      batch.map(async (query) => {
        const results = await querySearXNG(config.searxngBaseUrl, query);
        return results.map((item) => mapSearxngResult(item, config.searchArea, query));
      })
    );
    searchResults.push(...batchResults);
    if (i + BATCH_SIZE < queries.length) {
      await sleep(SEARXNG_QUERY_DELAY_MS);
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
