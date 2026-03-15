import type { RetrievedExperience } from "./types.js";

const formatStep = (experience: RetrievedExperience): string =>
  experience.trajectory.steps.length === 0
    ? "直接回答并完成任务"
    : experience.trajectory.steps
        .map(({ toolName, resultSummary, ok }) => `${toolName}${ok ? "" : " (failed)"}: ${resultSummary}`)
        .join(" -> ");

const formatExample = (experience: RetrievedExperience, index: number): string =>
  [
    `${index + 1}. 任务: ${experience.taskSummary}`,
    `   步骤: ${formatStep(experience)}`,
    `   结果: ${experience.trajectory.finalAnswer || "成功完成"}`,
  ].join("\n");

export const EXPERIENCE_REPLAY_SYSTEM_CONTEXT = [
  "When relevant prior successes exist, use them as adaptable guidance rather than rigid templates.",
  "Prefer the same high-level strategy only when the current task matches the recalled pattern.",
  "Do not mention the replay buffer unless the user asks about it.",
].join("\n");

export const formatExperienceReplay = (experiences: RetrievedExperience[]): string =>
  experiences.length === 0
    ? ""
    : ["<experience_replay>", "你之前成功完成过类似任务，以下是可参考的成功轨迹：", ...experiences.map(formatExample), "请参考其策略，但根据当前任务灵活调整。", "</experience_replay>"].join("\n");
