import crypto from "node:crypto";
import type { ExperienceReplayConfig, ExperienceTrajectory, JsonRecord, RunTrace, StoredExperience, ToolCallTrace } from "./types.js";

const asRecord = (value: unknown): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};

const asString = (value: unknown): string => (typeof value === "string" ? value : "");

const asText = (value: unknown): string[] =>
  typeof value === "string"
    ? [value]
    : Array.isArray(value)
      ? value.flatMap(asText)
      : value && typeof value === "object"
        ? [asString((value as JsonRecord).text), ...asText((value as JsonRecord).content)]
        : [];

const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();

const summarize = (value: string, size: number): string =>
  normalize(value).slice(0, size);

const readRole = (message: unknown): string => asString(asRecord(message).role);

const messageText = (message: unknown): string =>
  summarize(asText(message).join(" "), 400);

const latestTextByRole = (messages: unknown[], role: string): string =>
  messages.filter((message) => readRole(message) === role).map(messageText).filter(Boolean).at(-1) ?? "";

const dedupeToolCalls = (toolCalls: ToolCallTrace[]): ToolCallTrace[] =>
  toolCalls.filter(
    (toolCall, index, items) =>
      items.findIndex(
        (candidate) =>
          candidate.toolName === toolCall.toolName &&
          JSON.stringify(candidate.params) === JSON.stringify(toolCall.params) &&
          candidate.resultSummary === toolCall.resultSummary,
      ) === index,
  );

const buildTaskSummary = (prompt: string, toolCalls: ToolCallTrace[]): string =>
  [summarize(prompt, 96), toolCalls.length ? `via ${toolCalls.map(({ toolName }) => toolName).slice(0, 3).join(" -> ")}` : ""]
    .filter(Boolean)
    .join(" ");

const includesNegativeFeedback = (prompt: string, patterns: string[]): boolean =>
  patterns.some((pattern) => prompt.toLowerCase().includes(pattern.toLowerCase()));

const failurePatterns = [
  /^http\s+\d{3}/i,
  /^error[:\s]/i,
  /^failovererror[:\s]/i,
  /invalid authentication/i,
  /unauthorized/i,
  /no api key found/i,
  /oauth token refresh failed/i,
];

const looksLikeFailureResponse = (value: string): boolean =>
  failurePatterns.some((pattern) => pattern.test(value));

export const summarizeToolResult = (result: unknown, size: number): string =>
  summarize(typeof result === "string" ? result : JSON.stringify(result ?? {}, null, 0).replace(/\s+/g, " "), size) || "n/a";

export const createToolCallTrace = (input: {
  toolName: string;
  params: Record<string, unknown>;
  result?: unknown;
  error?: string;
  durationMs?: number;
  maxCharsPerResult: number;
}): ToolCallTrace => ({
  toolName: input.toolName,
  params: input.params,
  resultSummary: summarizeToolResult(input.error ? { error: input.error } : input.result, input.maxCharsPerResult),
  ok: !input.error,
  error: input.error ?? "",
  durationMs: input.durationMs ?? 0,
});

export const scoreExperience = (input: {
  success: boolean;
  prompt: string;
  finalAnswer: string;
  toolCalls: ToolCallTrace[];
  config: ExperienceReplayConfig;
}): number => {
  const w = input.config.success.scoreWeights;
  return [
    input.success ? w.success : 0,
    input.finalAnswer && !looksLikeFailureResponse(input.finalAnswer) ? w.finalAnswer : 0,
    input.toolCalls.length > 0 ? w.toolUse : w.directAnswer,
    includesNegativeFeedback(input.prompt, input.config.success.negativeFeedbackPatterns) ? 0 : w.noNegativeFeedback,
  ].reduce((sum, value) => sum + value, 0);
};

const buildTrajectory = (prompt: string, toolCalls: ToolCallTrace[], finalAnswer: string): ExperienceTrajectory => ({
  prompt,
  steps: dedupeToolCalls(toolCalls),
  finalAnswer,
  outcome: "success",
});

const fingerprintFor = (summary: string, trajectory: ExperienceTrajectory): string =>
  crypto.createHash("sha1").update(JSON.stringify([summary, trajectory.prompt, trajectory.steps, trajectory.finalAnswer])).digest("hex");

export const buildExperienceRecord = (input: {
  runTrace: RunTrace;
  messages: unknown[];
  success: boolean;
  config: ExperienceReplayConfig;
  vector: number[];
}): StoredExperience | undefined => {
  const prompt = summarize(input.runTrace.prompt || latestTextByRole(input.messages, "user"), 800);
  const finalAnswer = summarize(input.runTrace.assistantTexts.join(" ") || latestTextByRole(input.messages, "assistant"), 800);
  const toolCalls = dedupeToolCalls(input.runTrace.toolCalls).slice(0, input.config.capture.maxToolCalls);
  const successScore = scoreExperience({ success: input.success, prompt, finalAnswer, toolCalls, config: input.config });
  const trajectory = buildTrajectory(prompt, toolCalls, finalAnswer);
  const taskSummary = buildTaskSummary(prompt, toolCalls);
  return input.success &&
    successScore >= input.config.success.minScore &&
    prompt &&
    finalAnswer &&
    !looksLikeFailureResponse(finalAnswer)
    ? {
        id: crypto.randomUUID(),
        taskSummary,
        prompt,
        trajectory,
        vector: input.vector,
        successScore,
        createdAt: new Date().toISOString(),
        fingerprint: fingerprintFor(taskSummary, trajectory),
      }
    : undefined;
};
