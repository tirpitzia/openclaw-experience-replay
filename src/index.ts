import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { experienceReplayConfigSchema, resolvePluginConfig } from "./config.js";
import { EXPERIENCE_REPLAY_SYSTEM_CONTEXT, formatExperienceReplay } from "./injector.js";
import { buildExperienceRecord, createToolCallTrace } from "./recorder.js";
import { createEmbedder, retrieveExperiences } from "./retriever.js";
import { createExperienceStore } from "./store.js";
import { createTraceRegistry } from "./trace-registry.js";
import type { RunTrace } from "./types.js";

const pluginDefinition = {
  id: "experience-replay",
  name: "Experience Replay",
  version: "0.1.0",
  description: "Records successful task trajectories and replays similar experiences before future runs.",
  configSchema: experienceReplayConfigSchema,
};

const emptyTrace = (prompt = ""): RunTrace => ({ prompt, assistantTexts: [], toolCalls: [] });

const appendToolCall = (trace: RunTrace, next: RunTrace["toolCalls"][number]): RunTrace => ({
  ...trace,
  toolCalls: [...trace.toolCalls, next],
});

const replaceAssistantTexts = (trace: RunTrace, assistantTexts: string[]): RunTrace => ({ ...trace, assistantTexts });

const setPrompt = (trace: RunTrace, prompt: string): RunTrace => ({ ...trace, prompt });

export const register = (api: OpenClawPluginApi): void => {
  const config = resolvePluginConfig(api.pluginConfig, api.resolvePath);
  const store = createExperienceStore({ dbPath: config.storePath, logger: api.logger });
  const embed = createEmbedder(config, api.logger);
  const traces = createTraceRegistry();
  config.embedding.requestedProvider === "openai" &&
    config.embedding.provider !== "openai" &&
    api.logger.warn("[experience-replay] OpenAI embedding provider requested but no API key was found; using lexical fallback");
  api.logger.info?.(`[experience-replay] ready with ${store.count()} stored experiences`);

  api.on("before_prompt_build", async (event, ctx) => {
    if (!config.enabled) return;
    traces.update(event, ctx, (trace) => setPrompt(trace, event.prompt));
    const experiences = await retrieveExperiences({
      prompt: event.prompt,
      config,
      experiences: store.listRecent(config.maxCandidates),
      embed,
    });
    api.logger.info?.(
      `[experience-replay] retrieved ${experiences.length} experience(s) for prompt: ${event.prompt.slice(0, 80)}`,
    );
    return experiences.length === 0
      ? { prependSystemContext: EXPERIENCE_REPLAY_SYSTEM_CONTEXT }
      : {
          prependSystemContext: EXPERIENCE_REPLAY_SYSTEM_CONTEXT,
          prependContext: formatExperienceReplay(experiences),
        };
  });

  api.on("after_tool_call", async (event, ctx) => {
    if (!config.enabled) return;
    traces.update(event, ctx, (trace) =>
      appendToolCall(
        trace,
        createToolCallTrace({
          toolName: event.toolName,
          params: event.params,
          result: event.result,
          error: event.error,
          durationMs: event.durationMs,
          maxCharsPerResult: config.capture.maxCharsPerResult,
        }),
      ),
    );
  });

  api.on("llm_output", async (event, ctx) => {
    if (!config.enabled) return;
    traces.update(event, ctx, (trace) => replaceAssistantTexts(trace, event.assistantTexts));
  });

  api.on("agent_end", async (event, ctx) => {
    if (!config.enabled) return;
    const runTrace = traces.take(event, ctx);
    const vectorPrompt = runTrace.prompt || "";
    try {
      const vector = await embed(vectorPrompt);
      const experience = buildExperienceRecord({
        runTrace,
        messages: event.messages,
        success: event.success,
        config,
        vector,
      });
      experience
        ? store.save(experience) && api.logger.info?.(`[experience-replay] stored: ${experience.taskSummary}`)
        : api.logger.info?.("[experience-replay] skipped capture for this run");
    } catch (error) {
      api.logger.warn(`[experience-replay] failed to persist experience: ${String(error)}`);
    }
  });
};

export default {
  ...pluginDefinition,
  register,
};
