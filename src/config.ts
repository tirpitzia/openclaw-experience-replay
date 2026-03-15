import path from "node:path";
import { homedir } from "node:os";
import type { ExperienceReplayConfig, JsonRecord } from "./types.js";

export const experienceReplayConfigSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    enabled: { type: "boolean", default: true },
    storePath: { type: "string", default: "~/.openclaw/experience-replay.db" },
    maxExamples: {
      type: "integer",
      minimum: 1,
      maximum: 10,
      default: 3,
      description: "Maximum number of similar past experiences to retrieve and inject per run.",
    },
    similarityThreshold: { type: "number", minimum: 0, maximum: 1, default: 0.32 },
    maxCandidates: { type: "integer", minimum: 10, maximum: 5000, default: 250 },
    language: {
      type: "string",
      enum: ["auto", "zh", "en"],
      default: "auto",
      description: "Language for experience replay prompts. 'auto' detects from LANG env variable, falls back to 'zh'.",
    },
    embedding: {
      type: "object",
      additionalProperties: false,
      properties: {
        provider: {
          type: "string",
          enum: ["lexical", "openai", "ollama"],
          default: "lexical",
          description: "'lexical' is offline. 'openai' and 'ollama' use neural embeddings and enable hybrid retrieval.",
        },
        model: { type: "string", default: "text-embedding-3-small" },
        openaiApiKey: { type: "string" },
        baseUrl: { type: "string", default: "https://api.openai.com/v1" },
        ollamaBaseUrl: { type: "string", default: "http://localhost:11434" },
        ollamaModel: { type: "string", default: "nomic-embed-text" },
        hybridWeight: {
          type: "number",
          minimum: 0,
          maximum: 1,
          default: 0.7,
          description: "Weight of neural (semantic) score in hybrid retrieval. 1.0 = pure neural, 0.0 = pure lexical. Only used when provider is 'openai' or 'ollama'.",
        },
      },
    },
    capture: {
      type: "object",
      additionalProperties: false,
      properties: {
        maxToolCalls: { type: "integer", minimum: 1, maximum: 20, default: 8 },
        maxCharsPerResult: { type: "integer", minimum: 40, maximum: 2000, default: 280 },
      },
    },
    success: {
      type: "object",
      additionalProperties: false,
      properties: {
        minScore: { type: "number", minimum: 0, maximum: 1, default: 0.65 },
        negativeFeedbackPatterns: {
          type: "array",
          items: { type: "string" },
          default: ["不对", "重来", "错了", "失败", "that is wrong", "try again", "redo"],
        },
        scoreWeights: {
          type: "object",
          additionalProperties: false,
          description: "Weights used to compute a run's quality score (0–1). Tune to match your success criteria.",
          properties: {
            success: {
              type: "number",
              minimum: 0,
              maximum: 1,
              default: 0.55,
              description: "Awarded when the run is flagged as succeeded.",
            },
            finalAnswer: {
              type: "number",
              minimum: 0,
              maximum: 1,
              default: 0.20,
              description: "Awarded when a non-empty, non-error final answer is present.",
            },
            toolUse: {
              type: "number",
              minimum: 0,
              maximum: 1,
              default: 0.15,
              description: "Awarded when the run used at least one tool call.",
            },
            directAnswer: {
              type: "number",
              minimum: 0,
              maximum: 1,
              default: 0.10,
              description: "Awarded (instead of toolUse) when answered directly without any tool calls.",
            },
            noNegativeFeedback: {
              type: "number",
              minimum: 0,
              maximum: 1,
              default: 0.15,
              description: "Awarded when the prompt contains none of the negativeFeedbackPatterns.",
            },
          },
        },
      },
    },
  },
} as const;

const asRecord = (value: unknown): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const asBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const asNumber = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

const asStringArray = (value: unknown, fallback: string[]): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : fallback;

const expandHome = (input: string): string =>
  input === "~" ? homedir() : input.startsWith("~/") ? path.join(homedir(), input.slice(2)) : input;

const resolveFilePath = (input: string, resolvePath: (filePath: string) => string): string =>
  path.isAbsolute(input) ? input : resolvePath(input);

const resolveLanguage = (raw: unknown): "auto" | "zh" | "en" => {
  const value = asString(raw, "");
  return value === "zh" || value === "en" ? value : "auto";
};

const resolveProvider = (value: string): "lexical" | "openai" | "ollama" =>
  value === "openai" ? "openai" : value === "ollama" ? "ollama" : "lexical";

export const resolvePluginConfig = (
  rawConfig: unknown,
  resolvePath: (filePath: string) => string,
): ExperienceReplayConfig => {
  const raw = asRecord(rawConfig);
  const embedding = asRecord(raw.embedding);
  const capture = asRecord(raw.capture);
  const success = asRecord(raw.success);
  const scoreWeights = asRecord(success.scoreWeights);
  const requestedProvider = resolveProvider(asString(embedding.provider, "lexical"));
  const openaiApiKey = asString(embedding.openaiApiKey, process.env.OPENAI_API_KEY ?? "");
  const effectiveOpenai = requestedProvider === "openai" && openaiApiKey ? "openai" : null;
  const effectiveOllama = requestedProvider === "ollama" ? "ollama" : null;
  const provider = effectiveOpenai ?? effectiveOllama ?? (requestedProvider === "lexical" ? "lexical" : "lexical");
  return {
    enabled: asBoolean(raw.enabled, true),
    storePath: resolveFilePath(expandHome(asString(raw.storePath, "~/.openclaw/experience-replay.db")), resolvePath),
    maxExamples: asNumber(raw.maxExamples ?? (raw as JsonRecord).topK, 3, 1, 10),
    similarityThreshold: asNumber(raw.similarityThreshold, 0.32, 0, 1),
    maxCandidates: asNumber(raw.maxCandidates, 250, 10, 5000),
    language: resolveLanguage(raw.language),
    embedding: {
      provider,
      requestedProvider,
      model: asString(embedding.model, "text-embedding-3-small"),
      openaiApiKey,
      baseUrl: asString(embedding.baseUrl, "https://api.openai.com/v1").replace(/\/$/, ""),
      ollamaBaseUrl: asString(embedding.ollamaBaseUrl, "http://localhost:11434").replace(/\/$/, ""),
      ollamaModel: asString(embedding.ollamaModel, "nomic-embed-text"),
      hybridWeight: asNumber(embedding.hybridWeight, 0.7, 0, 1),
    },
    capture: {
      maxToolCalls: asNumber(capture.maxToolCalls, 8, 1, 20),
      maxCharsPerResult: asNumber(capture.maxCharsPerResult, 280, 40, 2000),
    },
    success: {
      minScore: asNumber(success.minScore, 0.65, 0, 1),
      negativeFeedbackPatterns: asStringArray(success.negativeFeedbackPatterns, [
        "不对",
        "重来",
        "错了",
        "失败",
        "that is wrong",
        "try again",
        "redo",
      ]),
      scoreWeights: {
        success: asNumber(scoreWeights.success, 0.55, 0, 1),
        finalAnswer: asNumber(scoreWeights.finalAnswer, 0.20, 0, 1),
        toolUse: asNumber(scoreWeights.toolUse, 0.15, 0, 1),
        directAnswer: asNumber(scoreWeights.directAnswer, 0.10, 0, 1),
        noNegativeFeedback: asNumber(scoreWeights.noNegativeFeedback, 0.15, 0, 1),
      },
    },
  };
};
