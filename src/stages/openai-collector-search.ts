import OpenAI from "openai";
import type { AgentConfig } from "../types.js";

export type OpenAiWebHit = {
  title: string;
  url: string;
  content: string;
};

function userLocationFromSearchArea(searchArea: string): {
  type: "approximate";
  city?: string | null;
  region?: string | null;
  country?: string | null;
} {
  const parts = searchArea.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const city = parts[0];
    const region = parts[1].split(/\s+/)[0];
    return {
      type: "approximate",
      city,
      region: region.length === 2 ? region.toUpperCase() : parts[1],
      country: "US",
    };
  }
  return {
    type: "approximate",
    city: searchArea.trim() || "United States",
    country: "US",
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function extractHitsFromResponse(response: {
  error: unknown;
  output: unknown;
}): OpenAiWebHit[] {
  if (response.error) {
    return [];
  }
  const byUrl = new Map<string, OpenAiWebHit>();
  const output = response.output;
  if (!Array.isArray(output)) {
    return [];
  }

  for (const item of output) {
    if (!isRecord(item)) continue;
    if (item.type === "web_search_call" && isRecord(item.action)) {
      const action = item.action;
      if (action.type === "search" && Array.isArray(action.sources)) {
        for (const s of action.sources) {
          if (!isRecord(s) || s.type !== "url" || typeof s.url !== "string") continue;
          if (!byUrl.has(s.url)) {
            byUrl.set(s.url, { title: s.url, url: s.url, content: "" });
          }
        }
      }
    }

    if (item.type === "message" && Array.isArray(item.content)) {
      for (const part of item.content) {
        if (!isRecord(part) || part.type !== "output_text" || typeof part.text !== "string") {
          continue;
        }
        const snippet = part.text.slice(0, 500);
        const annotations = part.annotations;
        if (!Array.isArray(annotations)) continue;
        for (const ann of annotations) {
          if (!isRecord(ann) || ann.type !== "url_citation" || typeof ann.url !== "string") {
            continue;
          }
          const title = typeof ann.title === "string" && ann.title.trim() ? ann.title : ann.url;
          const prev = byUrl.get(ann.url);
          byUrl.set(ann.url, {
            title,
            url: ann.url,
            content: prev?.content || snippet,
          });
        }
      }
    }
  }

  return [...byUrl.values()];
}

export async function queryOpenAiWebCollection(
  config: AgentConfig,
  searchPhrase: string
): Promise<OpenAiWebHit[]> {
  if (!config.openaiApiKey.trim()) {
    throw new Error("OpenAI web collection requires OPENAI_API_KEY");
  }

  const client = new OpenAI({
    apiKey: config.openaiApiKey,
    timeout: config.openaiCollectorTimeoutMs,
  });

  const userLocation = userLocationFromSearchArea(config.searchArea);

  const response = await client.responses.create({
    model: config.openaiResponsesSearchModel,
    tool_choice: "required",
    tools: [
      {
        type: "web_search",
        search_context_size: config.openaiWebSearchContextSize,
        user_location: userLocation,
      },
    ],
    include: ["web_search_call.action.sources"],
    instructions:
      "You help a regional cookie franchise find in-person public events (fairs, festivals, farmers markets, street fairs, expos with vendor booths, races, parades, community celebrations). Use web search and prefer concrete event or ticketing pages. Skip dictionaries, Q&A sites, generic wholesale marketplaces, and pure tourism guides with no specific dated event.",
    input:
      `Find real upcoming or recurring in-person events relevant to this search: ${searchPhrase}. ` +
      "Prioritize pages where a dessert or food vendor could plausibly get a booth or catering opportunity.",
    max_output_tokens: 1200,
    temperature: 0.2,
  });

  return extractHitsFromResponse(response);
}
