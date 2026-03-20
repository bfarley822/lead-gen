import OpenAI from "openai";
import type { AgentConfig } from "./types.js";

export type ChatMessage = { role: "system" | "user"; content: string };

export type LLMProvider = "ollama" | "openai";

type OllamaChatResponse = {
  message?: { content?: string };
};

type ChatOptions = {
  provider: LLMProvider;
  model: string;
  baseUrl: string;
  apiKey?: string;
  timeoutMs: number;
  temperature?: number;
};

async function ollamaChat(
  messages: ChatMessage[],
  options: ChatOptions
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  const endpoint = new URL("/api/chat", options.baseUrl).toString();

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: controller.signal,
    body: JSON.stringify({
      model: options.model,
      stream: false,
      messages,
      options: { temperature: options.temperature ?? 0 },
    }),
  });
  clearTimeout(timeout);

  const data = (await resp.json()) as OllamaChatResponse;
  return data.message?.content ?? "";
}

async function openaiChat(
  messages: ChatMessage[],
  options: ChatOptions
): Promise<string> {
  const client = new OpenAI({
    apiKey: options.apiKey,
    timeout: options.timeoutMs,
  });

  const resp = await client.chat.completions.create({
    model: options.model,
    messages,
    temperature: options.temperature ?? 0,
  });

  return resp.choices[0]?.message?.content ?? "";
}

export async function chatCompletion(
  messages: ChatMessage[],
  options: ChatOptions
): Promise<string> {
  if (options.provider === "openai") {
    return openaiChat(messages, options);
  }
  return ollamaChat(messages, options);
}

type StageName = "dedup" | "triage" | "research" | "scoring";

const OLLAMA_MODEL_KEYS: Record<StageName, keyof AgentConfig> = {
  dedup: "ollamaDedupModel",
  triage: "ollamaTriageModel",
  research: "ollamaResearchModel",
  scoring: "ollamaScoringModel",
};

const OPENAI_MODEL_KEYS: Record<StageName, keyof AgentConfig> = {
  dedup: "openaiDedupModel",
  triage: "openaiTriageModel",
  research: "openaiResearchModel",
  scoring: "openaiScoringModel",
};

export function stageChat(
  config: AgentConfig,
  stage: StageName,
  timeoutMs: number
): (messages: ChatMessage[]) => Promise<string> {
  const model =
    config.llmProvider === "openai"
      ? (config[OPENAI_MODEL_KEYS[stage]] as string)
      : (config[OLLAMA_MODEL_KEYS[stage]] as string);

  const options: ChatOptions = {
    provider: config.llmProvider,
    model,
    baseUrl: config.ollamaBaseUrl,
    apiKey: config.openaiApiKey,
    timeoutMs,
  };

  return (messages) => chatCompletion(messages, options);
}
