import type { AgentConfig, RawEvent } from "../types.js";

type SearXNGResult = {
  title: string;
  url: string;
  content: string;
  engine: string;
  publishedDate?: string;
};

type SearXNGResponse = {
  query: string;
  number_of_results: number;
  results: SearXNGResult[];
};

async function querySearXNG(
  baseUrl: string,
  query: string,
  params?: Record<string, string>
): Promise<SearXNGResult[]> {
  const url = new URL("/search", baseUrl);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("categories", "general");
  url.searchParams.set("pageno", "1");

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error(
      `SearXNG returned ${response.status}: ${response.statusText}`
    );
  }

  const data = (await response.json()) as SearXNGResponse;
  return data.results ?? [];
}

export async function searchSearXNG(
  config: AgentConfig
): Promise<RawEvent[]> {
  const now = new Date();

  const queries = config.searchKeywords.map(
    (kw) => `${kw} near ${config.searchLocation} ${now.getFullYear()}`
  );

  const results = await Promise.allSettled(
    queries.map((query) => querySearXNG(config.searxngBaseUrl, query))
  );

  const events: RawEvent[] = [];

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const r of result.value) {
      events.push({
        title: r.title,
        description: r.content ?? "",
        url: r.url,
        date: r.publishedDate ?? undefined,
        location: config.searchLocation,
        source: "searxng",
      });
    }
  }

  return events;
}

export async function searchEventbriteSearXNG(
  config: AgentConfig
): Promise<RawEvent[]> {
  const queries = config.searchKeywords.map(
    (kw) => `${kw} in ${config.searchLocation} site:eventbrite.com/e/`
  );

  const results = await Promise.allSettled(
    queries.map((query) => querySearXNG(config.searxngBaseUrl, query))
  );

  const events: RawEvent[] = [];

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const r of result.value) {
      events.push({
        title: r.title,
        description: r.content ?? "",
        url: r.url,
        date: r.publishedDate ?? undefined,
        location: config.searchLocation,
        source: "searxng",
      });
    }
  }

  return events;
}
