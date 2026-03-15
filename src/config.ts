import path from "node:path";
import { homedir } from "node:os";
import type { ExperienceReplayConfig, JsonRecord } from "./types.js";

export const experienceReplayConfigSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    enabled: { type: "boolean", default: true },
    storePath: { type: "string", default: "~/.openclaw/experience-replay.db" },
    topK: { type: "integer", minimum: 1, maximum: 10, default: 3 },
    similarityThreshold: { type: "number", minimum: 0, maximum: 1, default: 0.32 },
    maxExamples: { type: "integer", minimum: 1, maximum: 8, default: 3 },
    maxCandidates: { type: "integer", minimum: 10, maximum: 5000, default: 250 },
    embedding: {
      type: "object",
      additionalProperties: false,
      properties: {
        provider: { type: "string", enum: ["lexical", "openai"], default: "lexical" },
        model: { type: "string", default: "text-embedding-3-small" },
        openaiApiKey: { type: "string" },
        baseUrl: { type: "string", default: "https://api.openai.com/v1" },
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

export const resolvePluginConfig = (
  rawConfig: unknown,
  resolvePath: (filePath: string) => string,
): ExperienceReplayConfig => {
  const raw = asRecord(rawConfig);
  const embedding = asRecord(raw.embedding);
  const capture = asRecord(raw.capture);
  const success = asRecord(raw.success);
  const requestedProvider = asString(embedding.provider, "lexical") === "openai" ? "openai" : "lexical";
  const openaiApiKey = asString(embedding.openaiApiKey, process.env.OPENAI_API_KEY ?? "");
  return {
    enabled: asBoolean(raw.enabled, true),
    storePath: resolveFilePath(expandHome(asString(raw.storePath, "~/.openclaw/experience-replay.db")), resolvePath),
    topK: asNumber(raw.topK, 3, 1, 10),
    similarityThreshold: asNumber(raw.similarityThreshold, 0.32, 0, 1),
    maxExamples: asNumber(raw.maxExamples, 3, 1, 8),
    maxCandidates: asNumber(raw.maxCandidates, 250, 10, 5000),
    embedding: {
      provider: requestedProvider === "openai" && openaiApiKey ? "openai" : "lexical",
      requestedProvider,
      model: asString(embedding.model, "text-embedding-3-small"),
      openaiApiKey,
      baseUrl: asString(embedding.baseUrl, "https://api.openai.com/v1").replace(/\/$/, ""),
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
    },
  };
};
