import { z } from "zod";

export type SourceName = "searxng" | "rss";

export type RawEvent = {
  title: string;
  description: string;
  url: string;
  date: string | undefined;
  location: string | undefined;
  source: SourceName;
};

export const CollectedEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  url: z.string(),
  date: z.string().nullable(),
  locationHint: z.string().nullable(),
  source: z.enum(["searxng", "rss"]),
  collectedBy: z.string(),
});

export type CollectedEvent = z.infer<typeof CollectedEventSchema>;

export const QualifiedEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  url: z.string(),
  date: z.string().nullable(),
  locationHint: z.string().nullable(),
  source: z.enum(["searxng", "rss"]),
  qualityScore: z.number(),
  keptBecause: z.array(z.string()),
  droppedBecause: z.array(z.string()),
  evidence: z.array(z.string()),
});

export type QualifiedEvent = z.infer<typeof QualifiedEventSchema>;

export const ScoredEventSchema = z.object({
  name: z.string(),
  eventType: z.string().nullable().default("unknown"),
  location: z.string().nullable(),
  date: z.string().nullable(),
  estimatedAttendance: z.string().nullable().default(null),
  score: z.number().min(0).max(100),
  reasoning: z.string(),
  sourceUrl: z.string(),
});

export type ScoredEvent = z.infer<typeof ScoredEventSchema>;

export const ScoredEventsResponseSchema = z.object({
  events: z.array(ScoredEventSchema),
});

export type StageMetrics = {
  rawCount: number;
  dedupedCount: number;
  qualifiedCount: number;
  scoredCount: number;
  finalKeptCount: number;
};

export type PipelineLogger = (msg: string) => void;

export type AgentConfig = {
  llmProvider: "ollama" | "openai";
  ollamaBaseUrl: string;
  ollamaModel: string;
  ollamaDedupModel: string;
  ollamaTriageModel: string;
  ollamaResearchModel: string;
  ollamaScoringModel: string;
  openaiApiKey: string;
  openaiModel: string;
  openaiDedupModel: string;
  openaiTriageModel: string;
  openaiResearchModel: string;
  openaiScoringModel: string;
  searxngBaseUrl: string;
  searchLocation: string;
  searchArea: string;
  storeAddress: string;
  storeName: string;
  searchCities: string[];
  cityConcurrency: number;
  searchRadiusMiles: number;
  assignmentRadiusMiles: number;
  broadSearchRadiusMiles: number;
  searchKeywords: string[];
  feedUrls: string[];
  maxEventsForScoring: number;
  minRelevanceScore: number;
  qualifierMinSignalScore: number;
  qualifierMaxCandidates: number;
  writeStageArtifacts: boolean;
  dbPath: string;
  onLog?: PipelineLogger;
};

export type ResearchData = {
  name: string;
  eventType: string | null;
  location: string | null;
  dateStart: string | null;
  dateEnd: string | null;
  dateDisplay: string | null;
  estimatedAttendance: string | null;
  isRecurring: boolean;
  description: string | null;
  organizer: string | null;
  contactInfo: string | null;
  contactMethod: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  contactUrl: string | null;
  registrationUrl: string | null;
  suggestedMessage: string | null;
};

export const ResearchDataSchema = z.object({
  name: z.string().nullable().default(null),
  eventType: z.string().nullable().default(null),
  location: z.string().nullable().default(null),
  dateStart: z.string().nullable().default(null),
  dateEnd: z.string().nullable().default(null),
  dateDisplay: z.string().nullable().default(null),
  estimatedAttendance: z.string().nullable().default(null),
  isRecurring: z.preprocess(
    (v) => (typeof v === "string" ? v.toLowerCase() === "true" : v),
    z.boolean().default(false)
  ),
  description: z.string().nullable().default(null),
  organizer: z.string().nullable().default(null),
  contactInfo: z.string().nullable().default(null),
  contactMethod: z.string().nullable().default(null),
  contactPhone: z.string().nullable().default(null),
  contactEmail: z.string().nullable().default(null),
  contactUrl: z.string().nullable().default(null),
  registrationUrl: z.string().nullable().default(null),
  suggestedMessage: z.string().nullable().default(null),
});
