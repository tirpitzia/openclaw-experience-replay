import type { Embedder, ExperienceReplayConfig, PluginLogger, RetrievedExperience, StoredExperience } from "./types.js";

const normalize = (value: string): string => value.toLowerCase().replace(/\s+/g, " ").trim();

const slidingPairs = (value: string): string[] =>
  value.length < 2 ? (value ? [value] : []) : Array.from({ length: value.length - 1 }, (_, index) => value.slice(index, index + 2));

const tokenize = (value: string): string[] => {
  const normalized = normalize(value);
  const words = normalized.match(/[\p{L}\p{N}_-]+/gu) ?? [];
  const compact = normalized.replace(/\s+/g, "");
  return [...words, ...slidingPairs(compact)];
};

const zeroVector = (size: number): number[] => Array.from({ length: size }, () => 0);

const unitize = (vector: number[]): number[] => {
  const length = Math.sqrt(vector.reduce((sum, value) => sum + value ** 2, 0));
  return length === 0 ? vector : vector.map((value) => value / length);
};

const hashToken = (token: string, size: number): number =>
  Array.from(token).reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % size, 7);

export const lexicalEmbedding = (text: string, size = 128): number[] => {
  const buckets = tokenize(text).reduce<Record<number, number>>(
    (acc, token) => ({ ...acc, [hashToken(token, size)]: (acc[hashToken(token, size)] ?? 0) + 1 }),
    {},
  );
  return unitize(Array.from({ length: size }, (_, index) => buckets[index] ?? 0));
};

export const cosineSimilarity = (left: number[], right: number[]): number =>
  left.length === right.length
    ? left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0)
    : 0;

const openAiEmbedding = async (input: {
  text: string;
  apiKey: string;
  model: string;
  baseUrl: string;
}): Promise<number[]> => {
  const response = await fetch(`${input.baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify({ model: input.model, input: input.text }),
  });
  const payload = (await response.json()) as { data?: Array<{ embedding?: number[] }>; error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message ?? `embedding request failed: ${response.status}`);
  return payload.data?.[0]?.embedding ?? zeroVector(128);
};

const ollamaEmbedding = async (input: {
  text: string;
  model: string;
  baseUrl: string;
}): Promise<number[]> => {
  const response = await fetch(`${input.baseUrl}/api/embed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: input.model, input: input.text }),
  });
  const payload = (await response.json()) as { embeddings?: number[][]; error?: string };
  if (!response.ok) throw new Error(payload.error ?? `ollama embedding request failed: ${response.status}`);
  return payload.embeddings?.[0] ?? zeroVector(128);
};

export const createEmbedder = (config: ExperienceReplayConfig, logger: PluginLogger) => async (text: string): Promise<number[]> => {
  if (config.embedding.provider === "openai") {
    try {
      return await openAiEmbedding({
        text,
        apiKey: config.embedding.openaiApiKey,
        model: config.embedding.model,
        baseUrl: config.embedding.baseUrl,
      });
    } catch (error) {
      logger.warn(`[experience-replay] OpenAI embeddings failed, falling back to lexical: ${String(error)}`);
      return lexicalEmbedding(text);
    }
  }
  if (config.embedding.provider === "ollama") {
    try {
      return await ollamaEmbedding({
        text,
        model: config.embedding.ollamaModel,
        baseUrl: config.embedding.ollamaBaseUrl,
      });
    } catch (error) {
      logger.warn(`[experience-replay] Ollama embeddings failed, falling back to lexical: ${String(error)}`);
      return lexicalEmbedding(text);
    }
  }
  return lexicalEmbedding(text);
};

/**
 * Rank an experience against the current query using hybrid scoring.
 *
 * When provider is "openai" or "ollama" (neural), the final score is a weighted
 * blend of the neural similarity (stored embedding vs. query embedding) and the
 * lexical similarity (computed on-the-fly from stored prompt text). This improves
 * recall for queries that are semantically similar but use different keywords.
 *
 * hybridWeight = 1.0 → pure neural
 * hybridWeight = 0.0 → pure lexical
 * hybridWeight = 0.7 → default: 70% neural + 30% lexical
 */
const rankExperience = (input: {
  queryVector: number[];
  queryLexical: number[];
  experience: StoredExperience;
  hybridWeight: number;
  useHybrid: boolean;
}): RetrievedExperience => {
  const neuralScore = cosineSimilarity(input.queryVector, input.experience.vector);
  if (!input.useHybrid) return { ...input.experience, score: neuralScore };
  const storedLexical = lexicalEmbedding(input.experience.prompt);
  const lexicalScore = cosineSimilarity(input.queryLexical, storedLexical);
  const combined = input.hybridWeight * neuralScore + (1 - input.hybridWeight) * lexicalScore;
  return { ...input.experience, score: combined };
};

const byScoreThenRecency = (left: RetrievedExperience, right: RetrievedExperience): number =>
  right.score - left.score || right.createdAt.localeCompare(left.createdAt);

export const retrieveExperiences = async (input: {
  prompt: string;
  config: ExperienceReplayConfig;
  experiences: StoredExperience[];
  embed: Embedder;
}): Promise<RetrievedExperience[]> => {
  const queryVector = await input.embed(input.prompt);
  const useHybrid = input.config.embedding.provider !== "lexical" && input.config.embedding.hybridWeight < 1;
  const queryLexical = useHybrid ? lexicalEmbedding(input.prompt) : queryVector;
  return input.experiences
    .map((experience) =>
      rankExperience({
        queryVector,
        queryLexical,
        experience,
        hybridWeight: input.config.embedding.hybridWeight,
        useHybrid,
      }),
    )
    .filter(({ score }) => score >= input.config.similarityThreshold)
    .sort(byScoreThenRecency)
    .slice(0, input.config.maxExamples);
};
