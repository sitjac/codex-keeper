import fs from "node:fs/promises";
import path from "node:path";

import Database from "better-sqlite3";

import { expandHome, normalizeWhitespace, stripControl } from "./util.js";

export interface CodexThreadState {
  threadId: string;
  title?: string;
  updatedAt?: string;
  archived: boolean;
  internal: boolean;
  source?: string;
  cwd?: string;
  rolloutPath?: string;
}

export interface CodexThreadTitleUpdateResult {
  dbPath?: string;
  updated: boolean;
  changes: number;
  skippedReason?: string;
}

function normalizeTitle(input: unknown): string | undefined {
  return normalizeWhitespace(stripControl(typeof input === "string" ? input : undefined));
}

function parseSourceValue(source: unknown): unknown {
  if (typeof source !== "string") {
    return source;
  }

  const trimmed = source.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return source;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return source;
  }
}

export function isInternalCodexThreadSource(source: unknown): boolean {
  const parsed = parseSourceValue(source);
  return Boolean(
    parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      Object.hasOwn(parsed, "subagent"),
  );
}

function timestampToIso(input: unknown): string | undefined {
  if (typeof input === "number" && Number.isFinite(input)) {
    const millis = input > 10_000_000_000 ? input : input * 1000;
    return new Date(millis).toISOString();
  }

  if (typeof input === "string" && input.trim()) {
    const numeric = Number(input);
    if (Number.isFinite(numeric)) {
      return timestampToIso(numeric);
    }
    const parsed = Date.parse(input);
    return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
  }

  return undefined;
}

async function findLatestCodexStateDb(codexHome: string): Promise<string | undefined> {
  const root = expandHome(codexHome);
  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch {
    return undefined;
  }

  const candidates = entries
    .map((entry) => {
      const match = /^state_(\d+)\.sqlite$/.exec(entry);
      return match ? { entry, version: Number(match[1]) } : undefined;
    })
    .filter((entry): entry is { entry: string; version: number } => Boolean(entry))
    .sort((left, right) => right.version - left.version);

  return candidates[0] ? path.join(root, candidates[0].entry) : undefined;
}

function hasThreadsTitleSchema(db: Database.Database): boolean {
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'threads'")
    .get();
  if (!table) {
    return false;
  }

  const columns = new Set(
    (db.prepare("PRAGMA table_info(threads)").all() as Array<Record<string, unknown>>).map(
      (row) => row.name,
    ),
  );
  return columns.has("id") && columns.has("title");
}

export async function readCodexThreadStateSnapshot(
  codexHome: string,
): Promise<Map<string, CodexThreadState>> {
  const dbPath = await findLatestCodexStateDb(codexHome);
  if (!dbPath) {
    return new Map();
  }

  let db: Database.Database | undefined;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    db.pragma("busy_timeout = 1000");
    if (!hasThreadsTitleSchema(db)) {
      return new Map();
    }

    const rows = db
      .prepare(
        `SELECT id, title, updated_at, updated_at_ms, archived, source, cwd, rollout_path
         FROM threads`,
      )
      .all() as Array<Record<string, unknown>>;
    const snapshot = new Map<string, CodexThreadState>();

    for (const row of rows) {
      if (typeof row.id !== "string" || !row.id.trim()) {
        continue;
      }
      snapshot.set(row.id, {
        threadId: row.id,
        title: normalizeTitle(row.title),
        updatedAt: timestampToIso(row.updated_at_ms) ?? timestampToIso(row.updated_at),
        archived: row.archived === 1 || row.archived === true,
        internal: isInternalCodexThreadSource(row.source),
        source: typeof row.source === "string" ? row.source : undefined,
        cwd: typeof row.cwd === "string" ? row.cwd : undefined,
        rolloutPath: typeof row.rollout_path === "string" ? row.rollout_path : undefined,
      });
    }

    return snapshot;
  } catch {
    return new Map();
  } finally {
    db?.close();
  }
}

export async function updateCodexThreadTitle(params: {
  codexHome: string;
  threadId: string;
  title: string;
  updatedAt?: string;
  busyTimeoutMs?: number;
}): Promise<CodexThreadTitleUpdateResult> {
  const dbPath = await findLatestCodexStateDb(params.codexHome);
  if (!dbPath) {
    return {
      updated: false,
      changes: 0,
      skippedReason: "state_db_not_found",
    };
  }

  const title = normalizeTitle(params.title);
  if (!title) {
    return {
      dbPath,
      updated: false,
      changes: 0,
      skippedReason: "empty_title",
    };
  }

  let db: Database.Database | undefined;
  try {
    db = new Database(dbPath, { fileMustExist: true });
    db.pragma(`busy_timeout = ${Math.max(0, Math.floor(params.busyTimeoutMs ?? 5000))}`);
    if (!hasThreadsTitleSchema(db)) {
      return {
        dbPath,
        updated: false,
        changes: 0,
        skippedReason: "threads_title_schema_not_found",
      };
    }

    const current = db.prepare("SELECT title FROM threads WHERE id = ?").get(params.threadId) as
      | { title?: string }
      | undefined;
    if (!current) {
      return {
        dbPath,
        updated: false,
        changes: 0,
        skippedReason: "thread_not_found",
      };
    }
    if (normalizeTitle(current.title) === title) {
      return {
        dbPath,
        updated: false,
        changes: 0,
        skippedReason: "unchanged",
      };
    }

    const updatedAtMs = Date.parse(params.updatedAt ?? new Date().toISOString());
    const safeUpdatedAtMs = Number.isFinite(updatedAtMs) ? updatedAtMs : Date.now();
    const result = db
      .prepare(
        `UPDATE threads
         SET title = ?, updated_at = ?, updated_at_ms = ?
         WHERE id = ?`,
      )
      .run(title, Math.floor(safeUpdatedAtMs / 1000), safeUpdatedAtMs, params.threadId);

    return {
      dbPath,
      updated: result.changes > 0,
      changes: result.changes,
    };
  } finally {
    db?.close();
  }
}
