#!/usr/bin/env node
/**
 * experience-replay CLI
 *
 * Usage:
 *   npx experience-replay list   [--limit <n>] [--db <path>]
 *   npx experience-replay delete <id>          [--db <path>]
 *   npx experience-replay reset                [--db <path>] [--yes]
 *   npx experience-replay stats                [--db <path>]
 */

import fs from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import Database from "better-sqlite3";

// ── helpers ─────────────────────────────────────────────────────────────────

const expandHome = (p: string): string =>
  p === "~" ? homedir() : p.startsWith("~/") ? path.join(homedir(), p.slice(2)) : p;

const parseArgs = (argv: string[]): { command: string; args: string[]; flags: Record<string, string | true> } => {
  const args: string[] = [];
  const flags: Record<string, string | true> = {};
  let command = "";
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else if (!command) {
      command = token;
    } else {
      args.push(token);
    }
  }
  return { command, args, flags };
};

const confirm = async (question: string): Promise<boolean> => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
};

// ── DB layer ─────────────────────────────────────────────────────────────────

type Row = {
  id: string;
  task_summary: string;
  success_score: number;
  created_at: string;
};

const openDb = (dbPath: string): Database.Database => {
  const resolved = expandHome(dbPath);
  if (!fs.existsSync(resolved)) {
    console.error(`DB not found: ${resolved}`);
    process.exit(1);
  }
  return new Database(resolved, { readonly: false });
};

// ── commands ──────────────────────────────────────────────────────────────────

const cmdList = (db: Database.Database, limit: number): void => {
  const rows = db.prepare<[number], Row>(
    "SELECT id, task_summary, success_score, created_at FROM experiences ORDER BY created_at DESC LIMIT ?",
  ).all(limit);
  if (rows.length === 0) {
    console.log("No experiences stored yet.");
    return;
  }
  console.log(`\n${"ID".padEnd(10)} ${"Score".padEnd(7)} ${"Created".padEnd(25)} Task`);
  console.log("─".repeat(90));
  for (const row of rows) {
    const id = row.id.slice(0, 8);
    const score = row.success_score.toFixed(2);
    const date = row.created_at.slice(0, 19).replace("T", " ");
    const task = row.task_summary.slice(0, 50);
    console.log(`${id.padEnd(10)} ${score.padEnd(7)} ${date.padEnd(25)} ${task}`);
  }
  console.log(`\nShowing ${rows.length} experience(s).\n`);
};

const cmdDelete = (db: Database.Database, id: string): void => {
  if (!id) {
    console.error("Usage: experience-replay delete <id>");
    process.exit(1);
  }
  // Support prefix match (first 8 chars)
  const fullRow = db.prepare<[string, string], { id: string }>(
    "SELECT id FROM experiences WHERE id = ? OR id LIKE ?",
  ).get(id, `${id}%`);
  if (!fullRow) {
    console.error(`No experience found with id starting with: ${id}`);
    process.exit(1);
  }
  db.prepare("DELETE FROM experiences WHERE id = ?").run(fullRow.id);
  console.log(`Deleted experience ${fullRow.id.slice(0, 8)}…`);
};

const cmdReset = async (db: Database.Database, yes: boolean): Promise<void> => {
  const count = (db.prepare<[], { total: number }>("SELECT COUNT(*) AS total FROM experiences").get()?.total) ?? 0;
  if (count === 0) {
    console.log("Nothing to delete.");
    return;
  }
  if (!yes) {
    const ok = await confirm(`This will permanently delete all ${count} experience(s). Continue?`);
    if (!ok) { console.log("Aborted."); return; }
  }
  db.prepare("DELETE FROM experiences").run();
  console.log(`Deleted ${count} experience(s).`);
};

const cmdStats = (db: Database.Database, dbPath: string): void => {
  const count = (db.prepare<[], { total: number }>("SELECT COUNT(*) AS total FROM experiences").get()?.total) ?? 0;
  const resolved = expandHome(dbPath);
  const sizeBytes = fs.existsSync(resolved) ? fs.statSync(resolved).size : 0;
  const sizeMb = (sizeBytes / 1024 / 1024).toFixed(2);
  const oldest = db.prepare<[], { created_at: string }>("SELECT created_at FROM experiences ORDER BY created_at ASC LIMIT 1").get();
  const newest = db.prepare<[], { created_at: string }>("SELECT created_at FROM experiences ORDER BY created_at DESC LIMIT 1").get();
  console.log(`\nExperience Replay DB stats`);
  console.log(`  Path      : ${resolved}`);
  console.log(`  Size      : ${sizeMb} MB`);
  console.log(`  Total     : ${count} experience(s)`);
  if (oldest) console.log(`  Oldest    : ${oldest.created_at.slice(0, 19).replace("T", " ")}`);
  if (newest) console.log(`  Newest    : ${newest.created_at.slice(0, 19).replace("T", " ")}`);
  console.log();
};

// ── main ──────────────────────────────────────────────────────────────────────

const USAGE = `
experience-replay CLI

Commands:
  list   [--limit <n>]  List stored experiences (default: 20)
  delete <id>           Delete an experience by id or id prefix
  reset  [--yes]        Delete all experiences
  stats                 Show DB stats

Options:
  --db <path>           Path to SQLite DB (default: ~/.openclaw/experience-replay.db)
`.trim();

const main = async (): Promise<void> => {
  const { command, args, flags } = parseArgs(process.argv.slice(2));
  const dbPath = typeof flags.db === "string" ? flags.db : "~/.openclaw/experience-replay.db";

  if (!command || command === "help" || flags.help === true) {
    console.log(USAGE);
    return;
  }

  const db = openDb(dbPath);

  switch (command) {
    case "list":
      cmdList(db, typeof flags.limit === "string" ? parseInt(flags.limit, 10) || 20 : 20);
      break;
    case "delete":
      cmdDelete(db, args[0] ?? "");
      break;
    case "reset":
      await cmdReset(db, flags.yes === true);
      break;
    case "stats":
      cmdStats(db, dbPath);
      break;
    default:
      console.error(`Unknown command: ${command}\n`);
      console.log(USAGE);
      process.exit(1);
  }
};

main().catch((err: unknown) => {
  console.error(String(err));
  process.exit(1);
});
