import { describe, expect, it } from "vitest";
import { cosineSimilarity, lexicalEmbedding, retrieveExperiences } from "./retriever.js";
import type { ExperienceReplayConfig, StoredExperience } from "./types.js";

const config: ExperienceReplayConfig = {
  enabled: true,
  storePath: "/tmp/experience-replay.db",
  maxExamples: 2,
  similarityThreshold: 0.2,
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
    negativeFeedbackPatterns: ["不对"],
    scoreWeights: {
      success: 0.55,
      finalAnswer: 0.20,
      toolUse: 0.15,
      directAnswer: 0.10,
      noNegativeFeedback: 0.15,
    },
  },
};

const experiences: StoredExperience[] = [
  {
    id: "1",
    taskSummary: "预订周五会议室",
    prompt: "帮我预订周五下午的会议室",
    trajectory: { prompt: "帮我预订周五下午的会议室", steps: [], finalAnswer: "已预订", outcome: "success" },
    vector: lexicalEmbedding("帮我预订周五下午的会议室"),
    successScore: 0.9,
    createdAt: "2026-03-15T00:00:00.000Z",
    fingerprint: "a",
  },
  {
    id: "2",
    taskSummary: "生成日报",
    prompt: "整理今天的日报",
    trajectory: { prompt: "整理今天的日报", steps: [], finalAnswer: "已整理", outcome: "success" },
    vector: lexicalEmbedding("整理今天的日报"),
    successScore: 0.9,
    createdAt: "2026-03-14T00:00:00.000Z",
    fingerprint: "b",
  },
];

describe("retriever", () => {
  it("computes cosine similarity", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it("retrieves the most similar experiences", async () => {
    const results = await retrieveExperiences({
      prompt: "想预订周五的会议室",
      config,
      experiences,
      embed: async (text) => lexicalEmbedding(text),
    });
    expect(results[0]?.id).toBe("1");
    expect(results).toHaveLength(1);
  });

  it("prefers newer matches when scores tie", async () => {
    const results = await retrieveExperiences({
      prompt: "帮我预订周五下午的会议室",
      config: { ...config, similarityThreshold: 0, maxExamples: 2 },
      experiences: [
        { ...experiences[0]!, id: "newer", createdAt: "2026-03-16T00:00:00.000Z" },
        { ...experiences[0]!, id: "older", createdAt: "2026-03-13T00:00:00.000Z" },
      ],
      embed: async (text) => lexicalEmbedding(text),
    });
    expect(results.map(({ id }) => id)).toEqual(["newer", "older"]);
  });

  it("uses maxExamples to cap results", async () => {
    const manyExperiences = Array.from({ length: 10 }, (_, i) => ({
      ...experiences[0]!,
      id: String(i),
      fingerprint: String(i),
      createdAt: `2026-03-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
    }));
    const results = await retrieveExperiences({
      prompt: "帮我预订周五下午的会议室",
      config: { ...config, similarityThreshold: 0, maxExamples: 3 },
      experiences: manyExperiences,
      embed: async (text) => lexicalEmbedding(text),
    });
    expect(results).toHaveLength(3);
  });

  it("uses pure lexical score when provider is lexical (no hybrid blend)", async () => {
    // With lexical provider, hybridWeight is ignored and score = cosine(queryLexical, storedVector)
    const lexicalConfig = { ...config, embedding: { ...config.embedding, provider: "lexical" as const } };
    const results = await retrieveExperiences({
      prompt: "帮我预订周五下午的会议室",
      config: lexicalConfig,
      experiences: experiences.slice(0, 1),
      embed: async (text) => lexicalEmbedding(text),
    });
    expect(results[0]?.score).toBeGreaterThan(0.5);
  });
});
