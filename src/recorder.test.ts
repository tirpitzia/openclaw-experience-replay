import { describe, expect, it } from "vitest";
import { buildExperienceRecord, createToolCallTrace, scoreExperience } from "./recorder.js";
import type { ExperienceReplayConfig, RunTrace } from "./types.js";

const config: ExperienceReplayConfig = {
  enabled: true,
  storePath: "/tmp/experience-replay.db",
  maxExamples: 3,
  similarityThreshold: 0.3,
  maxCandidates: 10,
  language: "zh",
  embedding: {
    provider: "lexical",
    requestedProvider: "lexical",
    model: "text-embedding-3-small",
    openaiApiKey: "",
    baseUrl: "https://api.openai.com/v1",
    ollamaBaseUrl: "http://localhost:11434",
    ollamaModel: "nomic-embed-text",
    hybridWeight: 0.7,
  },
  capture: {
    maxToolCalls: 8,
    maxCharsPerResult: 280,
  },
  success: {
    minScore: 0.65,
    negativeFeedbackPatterns: ["不对", "redo"],
    scoreWeights: {
      success: 0.55,
      finalAnswer: 0.20,
      toolUse: 0.15,
      directAnswer: 0.10,
      noNegativeFeedback: 0.15,
    },
  },
};

describe("recorder", () => {
  it("scores successful runs above threshold", () => {
    const score = scoreExperience({
      success: true,
      prompt: "帮我预订周五下午会议室",
      finalAnswer: "已经完成预订。",
      toolCalls: [createToolCallTrace({ toolName: "calendar", params: {}, result: { ok: true }, maxCharsPerResult: 40 })],
      config,
    });
    expect(score).toBeGreaterThan(config.success.minScore);
  });

  it("uses directAnswer weight instead of toolUse when no tool calls", () => {
    const withTools = scoreExperience({
      success: true,
      prompt: "帮我预订会议室",
      finalAnswer: "已预订。",
      toolCalls: [createToolCallTrace({ toolName: "calendar", params: {}, result: { ok: true }, maxCharsPerResult: 40 })],
      config,
    });
    const withoutTools = scoreExperience({
      success: true,
      prompt: "帮我预订会议室",
      finalAnswer: "已预订。",
      toolCalls: [],
      config,
    });
    expect(withTools).toBeGreaterThan(withoutTools);
    // directAnswer (0.10) < toolUse (0.15)
    expect(withTools - withoutTools).toBeCloseTo(config.success.scoreWeights.toolUse - config.success.scoreWeights.directAnswer);
  });

  it("respects custom score weights", () => {
    const heavySuccess = scoreExperience({
      success: true,
      prompt: "任务",
      finalAnswer: "完成。",
      toolCalls: [],
      config: { ...config, success: { ...config.success, scoreWeights: { ...config.success.scoreWeights, success: 0.9 } } },
    });
    expect(heavySuccess).toBeGreaterThan(0.9);
  });

  it("builds an experience record from run traces", () => {
    const runTrace: RunTrace = {
      prompt: "帮我给团队安排周五下午 3 点会议室",
      assistantTexts: ["已经为你找到空闲会议室并发送确认。"],
      toolCalls: [
        createToolCallTrace({
          toolName: "calendar_lookup",
          params: { date: "Friday" },
          result: { room: "Atlas-2" },
          maxCharsPerResult: 60,
        }),
      ],
    };
    const experience = buildExperienceRecord({
      runTrace,
      messages: [{ role: "user", content: "帮我给团队安排周五下午 3 点会议室" }],
      success: true,
      config,
      vector: [0.4, 0.5],
    });
    expect(experience?.taskSummary).toContain("帮我给团队安排周五下午 3 点会议室");
    expect(experience?.trajectory.steps).toHaveLength(1);
    expect(experience?.vector).toEqual([0.4, 0.5]);
  });

  it("does not store failure-shaped final answers", () => {
    const experience = buildExperienceRecord({
      runTrace: {
        prompt: "测试请求",
        assistantTexts: ["HTTP 401: Invalid Authentication"],
        toolCalls: [],
      },
      messages: [{ role: "assistant", content: "HTTP 401: Invalid Authentication" }],
      success: true,
      config,
      vector: [0.1, 0.2],
    });
    expect(experience).toBeUndefined();
  });

  it("does not store incomplete runs with no final answer", () => {
    const experience = buildExperienceRecord({
      runTrace: {
        prompt: "测试请求",
        assistantTexts: [],
        toolCalls: [],
      },
      messages: [{ role: "user", content: "测试请求" }],
      success: true,
      config,
      vector: [0.1, 0.2],
    });
    expect(experience).toBeUndefined();
  });

  it("respects configured maxToolCalls instead of a hard-coded cap", () => {
    const toolCalls = Array.from({ length: 9 }, (_, index) =>
      createToolCallTrace({
        toolName: `tool-${index + 1}`,
        params: { index },
        result: { ok: true },
        maxCharsPerResult: 40,
      }),
    );
    const experience = buildExperienceRecord({
      runTrace: {
        prompt: "批量处理任务",
        assistantTexts: ["已经完成处理。"],
        toolCalls,
      },
      messages: [{ role: "user", content: "批量处理任务" }],
      success: true,
      config: { ...config, capture: { ...config.capture, maxToolCalls: 9 } },
      vector: [0.2, 0.3],
    });
    expect(experience?.trajectory.steps).toHaveLength(9);
  });
});
