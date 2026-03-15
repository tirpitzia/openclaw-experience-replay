import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { ExperienceStore, PluginLogger, StoredExperience } from "./types.js";

type ExperienceRow = {
  id: string;
  task_summary: string;
  prompt: string;
  trajectory_json: string;
  embedding_vector: string;
  success_score: number;
  created_at: string;
  fingerprint: string;
};

const schemaSql = `
  CREATE TABLE IF NOT EXISTS experiences (
    id TEXT PRIMARY KEY,
    task_summary TEXT NOT NULL,
    prompt TEXT NOT NULL,
    trajectory_json TEXT NOT NULL,
    embedding_vector TEXT NOT NULL,
    success_score REAL NOT NULL,
    created_at TEXT NOT NULL,
    fingerprint TEXT NOT NULL UNIQUE
  );
  CREATE INDEX IF NOT EXISTS experiences_created_at_idx ON experiences (created_at DESC);
`;

const ensureParentDir = (filePath: string): string =>
  fs.mkdirSync(path.dirname(filePath), { recursive: true }) || filePath;

const parseJson = <T>(value: string): T => JSON.parse(value) as T;

const toExperience = (row: ExperienceRow): StoredExperience => ({
  id: row.id,
  taskSummary: row.task_summary,
  prompt: row.prompt,
  trajectory: parseJson(row.trajectory_json),
  vector: parseJson(row.embedding_vector),
  successScore: row.success_score,
  createdAt: row.created_at,
  fingerprint: row.fingerprint,
});

const serializeExperience = (experience: StoredExperience) => ({
  id: experience.id,
  task_summary: experience.taskSummary,
  prompt: experience.prompt,
  trajectory_json: JSON.stringify(experience.trajectory),
  embedding_vector: JSON.stringify(experience.vector),
  success_score: experience.successScore,
  created_at: experience.createdAt,
  fingerprint: experience.fingerprint,
});

export const createExperienceStore = (params: { dbPath: string; logger: PluginLogger }): ExperienceStore => {
  ensureParentDir(params.dbPath);
  const db = new Database(params.dbPath);
  db.exec(schemaSql);
  const insert = db.prepare(`
    INSERT OR IGNORE INTO experiences (
      id, task_summary, prompt, trajectory_json, embedding_vector, success_score, created_at, fingerprint
    ) VALUES (
      @id, @task_summary, @prompt, @trajectory_json, @embedding_vector, @success_score, @created_at, @fingerprint
    )
  `);
  const selectRecent = db.prepare<[number], ExperienceRow>("SELECT * FROM experiences ORDER BY created_at DESC LIMIT ?");
  const selectCount = db.prepare<[], { total: number }>("SELECT COUNT(*) AS total FROM experiences");
  const deleteById = db.prepare<[string], void>("DELETE FROM experiences WHERE id = ?");
  const deleteAllStmt = db.prepare<[], void>("DELETE FROM experiences");
  return {
    save(experience: StoredExperience): boolean {
      const result = insert.run(serializeExperience(experience));
      result.changes === 0 && params.logger.debug?.(`[experience-replay] skipped duplicate ${experience.fingerprint}`);
      return result.changes > 0;
    },
    listRecent(limit: number): StoredExperience[] {
      return selectRecent.all(limit).map(toExperience);
    },
    count(): number {
      return selectCount.get()?.total ?? 0;
    },
    delete(id: string): boolean {
      const result = deleteById.run(id);
      return result.changes > 0;
    },
    deleteAll(): number {
      const result = deleteAllStmt.run();
      return result.changes;
    },
  };
};
