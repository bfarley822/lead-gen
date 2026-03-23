import dotenv from "dotenv";
import type { AgentConfig } from "./types.js";

dotenv.config();

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) {
    throw new Error(`Missing required env var: ${key}. See .env.example`);
  }
  return val;
}

function optionalEnv(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

function csvEnv(key: string, fallback: string): string[] {
  const raw = optionalEnv(key, fallback);
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function delimitedEnv(key: string, fallback: string, delimiter: string): string[] {
  const raw = optionalEnv(key, fallback);
  return raw
    .split(delimiter)
    .map((s) => s.trim())
    .filter(Boolean);
}

function webSearchContextSize(): "low" | "medium" | "high" {
  const v = optionalEnv("OPENAI_WEB_SEARCH_CONTEXT_SIZE", "medium").toLowerCase();
  if (v === "low" || v === "high") return v;
  return "medium";
}

export function loadConfig(overrides?: Partial<AgentConfig>): AgentConfig {
  const llmProvider = optionalEnv("LLM_PROVIDER", "ollama");
  const ollamaModel = optionalEnv("OLLAMA_MODEL", "llama3.1:8b");
  const openaiModel = optionalEnv("OPENAI_MODEL", "gpt-4o-mini");
  const openaiApiKey =
    llmProvider === "openai" ? requireEnv("OPENAI_API_KEY") : optionalEnv("OPENAI_API_KEY", "");

  return {
    llmProvider: llmProvider === "openai" ? "openai" : "ollama",
    ollamaBaseUrl: optionalEnv("OLLAMA_BASE_URL", "http://localhost:11434"),
    ollamaModel,
    ollamaDedupModel: optionalEnv("OLLAMA_DEDUP_MODEL", ollamaModel),
    ollamaTriageModel: optionalEnv("OLLAMA_TRIAGE_MODEL", ollamaModel),
    ollamaResearchModel: optionalEnv("OLLAMA_RESEARCH_MODEL", ollamaModel),
    ollamaScoringModel: optionalEnv("OLLAMA_SCORING_MODEL", ollamaModel),
    openaiApiKey,
    openaiModel,
    openaiDedupModel: optionalEnv("OPENAI_DEDUP_MODEL", openaiModel),
    openaiTriageModel: optionalEnv("OPENAI_TRIAGE_MODEL", openaiModel),
    openaiResearchModel: optionalEnv("OPENAI_RESEARCH_MODEL", openaiModel),
    openaiScoringModel: optionalEnv("OPENAI_SCORING_MODEL", openaiModel),
    searxngBaseUrl: optionalEnv("SEARXNG_BASE_URL", "http://localhost:8888"),
    searxngLanguage: optionalEnv("SEARXNG_LANGUAGE", "en"),
    searxngTimeRange: optionalEnv("SEARXNG_TIME_RANGE", "year"),
    searxngCategories: optionalEnv("SEARXNG_CATEGORIES", "general"),
    searxngEngines: optionalEnv("SEARXNG_ENGINES", ""),
    collectorSearchProvider: optionalEnv("COLLECTOR_SEARCH_PROVIDER", "auto"),
    openaiResponsesSearchModel: optionalEnv("OPENAI_RESPONSES_SEARCH_MODEL", "gpt-4o-mini"),
    openaiWebSearchContextSize: webSearchContextSize(),
    openaiCollectorConcurrency: Number(optionalEnv("OPENAI_COLLECTOR_CONCURRENCY", "4")),
    openaiCollectorBatchDelayMs: Number(optionalEnv("OPENAI_COLLECTOR_BATCH_DELAY_MS", "600")),
    openaiCollectorTimeoutMs: Number(optionalEnv("OPENAI_COLLECTOR_TIMEOUT_MS", "120000")),
    searchLocation: optionalEnv("SEARCH_LOCATION", "Austin, TX"),
    searchArea: optionalEnv("SEARCH_LOCATION", "Austin, TX"),
    storeAddress: optionalEnv("STORE_ADDRESS", ""),
    storeName: "",
    searchCities: delimitedEnv("SEARCH_CITIES", "", ";"),
    cityConcurrency: Number(optionalEnv("CITY_CONCURRENCY", "4")),
    searchRadiusMiles: Number(optionalEnv("SEARCH_RADIUS_MILES", "25")),
    assignmentRadiusMiles: Number(optionalEnv("ASSIGNMENT_RADIUS_MILES", "10")),
    broadSearchRadiusMiles: Number(optionalEnv("BROAD_SEARCH_RADIUS_MILES", "10")),
    searchKeywords: csvEnv(
      "SEARCH_KEYWORDS",
      "farmers market, food festival, craft fair, holiday market, community event, bake sale"
    ),
    feedUrls: csvEnv("FEED_URLS", ""),
    maxEventsForScoring: Number(optionalEnv("MAX_EVENTS_FOR_SCORING", "40")),
    minRelevanceScore: Number(optionalEnv("MIN_RELEVANCE_SCORE", "60")),
    qualifierMinSignalScore: Number(optionalEnv("QUALIFIER_MIN_SIGNAL_SCORE", "2")),
    qualifierMaxCandidates: Number(
      optionalEnv("QUALIFIER_MAX_CANDIDATES", optionalEnv("MAX_EVENTS_FOR_SCORING", "40"))
    ),
    writeStageArtifacts: optionalEnv("WRITE_STAGE_ARTIFACTS", "true") === "true",
    dbPath: optionalEnv("DB_PATH", "data/lead-gen.db"),
    ...overrides,
  };
}
