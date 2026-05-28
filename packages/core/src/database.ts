import fs from "node:fs/promises";
import path from "node:path";
import type {
  MaterializedSession,
  RenameHistoryKind,
  RenameHistoryRecord,
  RenameSource,
  RenameStateRecord,
  SessionDetail,
  SessionIndexEntry,
  SessionListQuery,
  SessionRevision,
  SessionStatusEstimate,
  SessionSummary,
  WorkspaceSummary,
} from "@codex-keeper/shared";
import Database from "better-sqlite3";

import { isDirtySinceRename } from "./revision.js";
import { workspaceIdForCwd, workspaceLabelForCwd } from "./util.js";

type SessionRow = {
  thread_id: string;
  rollout_path: string;
  cwd: string | null;
  project_name: string | null;
  created_at: string | null;
  updated_at: string | null;
  model_provider: string | null;
  model: string | null;
  first_user_message: string | null;
  last_user_message: string | null;
  last_agent_message: string | null;
  task_complete_count: number;
  token_total: number;
  latest_official_name: string | null;
  latest_official_name_updated_at: string | null;
  status_estimate: string | null;
  archived_hint: number;
  current_revision?: string | null;
  last_applied_name?: string | null;
  last_applied_source?: string | null;
  last_applied_at?: string | null;
  last_applied_revision?: string | null;
  dirty_since_rename?: number | null;
};

function toBoolean(value: unknown): boolean {
  return value === true || value === 1;
}

function statusForRow(row: SessionRow): SessionStatusEstimate {
  if (toBoolean(row.archived_hint)) {
    return "archived_hint";
  }
  if (row.status_estimate) {
    return row.status_estimate as SessionStatusEstimate;
  }
  return row.task_complete_count > 0 ? "idle" : "discovered";
}

function toSummary(row: SessionRow): SessionSummary {
  const workspaceId = workspaceIdForCwd(row.cwd ?? undefined);
  return {
    threadId: row.thread_id,
    cwd: row.cwd ?? undefined,
    projectName: row.project_name ?? undefined,
    workspaceId,
    workspaceLabel: workspaceLabelForCwd(row.cwd ?? undefined, row.project_name ?? undefined),
    updatedAt: row.updated_at ?? undefined,
    officialName: row.latest_official_name ?? row.last_applied_name ?? undefined,
    dirty: toBoolean(row.dirty_since_rename),
    taskCompleteCount: row.task_complete_count,
    provider: row.model_provider ?? undefined,
    model: row.model ?? undefined,
    lastAppliedSource: (row.last_applied_source as RenameSource | null) ?? undefined,
    statusEstimate: statusForRow(row),
  };
}

function toMaterializedSession(row: SessionRow): MaterializedSession {
  return {
    threadId: row.thread_id,
    rolloutPath: row.rollout_path,
    cwd: row.cwd ?? undefined,
    projectName: row.project_name ?? undefined,
    createdAt: row.created_at ?? undefined,
    updatedAt: row.updated_at ?? undefined,
    threadName: row.latest_official_name ?? undefined,
    threadNameUpdatedAt: row.latest_official_name_updated_at ?? undefined,
    modelProvider: row.model_provider ?? undefined,
    model: row.model ?? undefined,
    firstUserMessage: row.first_user_message ?? undefined,
    lastUserMessage: row.last_user_message ?? undefined,
    lastAgentMessage: row.last_agent_message ?? undefined,
    taskCompleteCount: row.task_complete_count,
    tokenTotal: row.token_total,
    archivedHint: toBoolean(row.archived_hint),
  };
}

export class StateDatabase {
  private readonly db: Database.Database;

  constructor(public readonly dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.migrate();
  }

  static async create(dbPath: string): Promise<StateDatabase> {
    await fs.mkdir(path.dirname(dbPath), { recursive: true });
    return new StateDatabase(dbPath);
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        thread_id TEXT PRIMARY KEY,
        rollout_path TEXT NOT NULL,
        cwd TEXT,
        project_name TEXT,
        created_at TEXT,
        updated_at TEXT,
        model_provider TEXT,
        model TEXT,
        first_user_message TEXT,
        last_user_message TEXT,
        last_agent_message TEXT,
        task_complete_count INTEGER NOT NULL DEFAULT 0,
        token_total INTEGER NOT NULL DEFAULT 0,
        latest_official_name TEXT,
        latest_official_name_updated_at TEXT,
        status_estimate TEXT,
        archived_hint INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS session_revisions (
        thread_id TEXT PRIMARY KEY,
        current_revision TEXT NOT NULL,
        last_seen_rollout_size INTEGER,
        last_seen_rollout_mtime TEXT,
        last_material_change_at TEXT,
        last_task_complete_count INTEGER,
        last_agent_message_fingerprint TEXT
      );

      CREATE TABLE IF NOT EXISTS rename_state (
        thread_id TEXT PRIMARY KEY,
        last_manual_name TEXT,
        last_applied_name TEXT,
        last_applied_source TEXT,
        last_applied_at TEXT,
        last_applied_revision TEXT,
        dirty_since_rename INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS rename_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        old_name TEXT,
        new_name TEXT NOT NULL,
        source TEXT NOT NULL,
        status TEXT NOT NULL,
        reason TEXT,
        applied_at TEXT NOT NULL,
        applied_revision TEXT,
        operator TEXT
      );

      CREATE TABLE IF NOT EXISTS ingest_cursors (
        rollout_path TEXT PRIMARY KEY,
        last_offset INTEGER NOT NULL DEFAULT 0,
        last_size INTEGER NOT NULL DEFAULT 0,
        last_mtime TEXT,
        last_scan_at TEXT
      );
    `);
    this.ensureColumn("sessions", "archived_hint", "INTEGER NOT NULL DEFAULT 0");
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const exists = (
      this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<Record<string, unknown>>
    ).some((row) => row.name === column);
    if (!exists) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  getSessionByRolloutPath(rolloutPath: string): MaterializedSession | undefined {
    const row = this.db.prepare(`SELECT * FROM sessions WHERE rollout_path = ?`).get(rolloutPath) as
      | SessionRow
      | undefined;
    return row ? toMaterializedSession(row) : undefined;
  }

  getRevision(threadId: string): SessionRevision | undefined {
    const row = this.db
      .prepare(
        `SELECT current_revision, last_seen_rollout_size, last_seen_rollout_mtime,
                last_material_change_at, last_task_complete_count, last_agent_message_fingerprint
         FROM session_revisions WHERE thread_id = ?`,
      )
      .get(threadId) as Record<string, unknown> | undefined;

    if (!row) {
      return undefined;
    }

    return {
      currentRevision: row.current_revision as string,
      lastSeenRolloutSize: row.last_seen_rollout_size as number,
      lastSeenRolloutMtime: (row.last_seen_rollout_mtime as string | null) ?? undefined,
      lastMaterialChangeAt: (row.last_material_change_at as string | null) ?? undefined,
      lastTaskCompleteCount: row.last_task_complete_count as number,
      lastAgentMessageFingerprint:
        (row.last_agent_message_fingerprint as string | null) ?? undefined,
    };
  }

  getCursor(
    rolloutPath: string,
  ): { lastOffset: number; lastSize: number; lastMtime?: string } | undefined {
    const row = this.db
      .prepare(
        `SELECT last_offset, last_size, last_mtime
         FROM ingest_cursors WHERE rollout_path = ?`,
      )
      .get(rolloutPath) as Record<string, unknown> | undefined;

    if (!row) {
      return undefined;
    }

    return {
      lastOffset: row.last_offset as number,
      lastSize: row.last_size as number,
      lastMtime: (row.last_mtime as string | null) ?? undefined,
    };
  }

  upsertSession(params: {
    session: MaterializedSession;
    revision: SessionRevision;
    cursor: {
      rolloutPath: string;
      lastOffset: number;
      lastSize: number;
      lastMtime?: string;
      lastScanAt?: string;
    };
  }): void {
    const { session, revision, cursor } = params;
    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO sessions (
            thread_id, rollout_path, cwd, project_name, created_at, updated_at,
            model_provider, model, first_user_message, last_user_message,
            last_agent_message, task_complete_count, token_total,
            latest_official_name, latest_official_name_updated_at, archived_hint
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(thread_id) DO UPDATE SET
            rollout_path = excluded.rollout_path,
            cwd = excluded.cwd,
            project_name = excluded.project_name,
            created_at = COALESCE(excluded.created_at, sessions.created_at),
            updated_at = excluded.updated_at,
            model_provider = COALESCE(excluded.model_provider, sessions.model_provider),
            model = COALESCE(excluded.model, sessions.model),
            first_user_message = COALESCE(sessions.first_user_message, excluded.first_user_message),
            last_user_message = COALESCE(excluded.last_user_message, sessions.last_user_message),
            last_agent_message = COALESCE(excluded.last_agent_message, sessions.last_agent_message),
            task_complete_count = excluded.task_complete_count,
            token_total = excluded.token_total,
            latest_official_name = COALESCE(excluded.latest_official_name, sessions.latest_official_name),
            latest_official_name_updated_at = COALESCE(
              excluded.latest_official_name_updated_at,
              sessions.latest_official_name_updated_at
            ),
            archived_hint = excluded.archived_hint`,
        )
        .run(
          session.threadId,
          session.rolloutPath,
          session.cwd ?? null,
          session.projectName ?? null,
          session.createdAt ?? null,
          session.updatedAt ?? null,
          session.modelProvider ?? null,
          session.model ?? null,
          session.firstUserMessage ?? null,
          session.lastUserMessage ?? null,
          session.lastAgentMessage ?? null,
          session.taskCompleteCount,
          session.tokenTotal,
          session.threadName ?? null,
          session.threadNameUpdatedAt ?? null,
          session.archivedHint ? 1 : 0,
        );

      this.db
        .prepare(
          `INSERT INTO session_revisions (
            thread_id, current_revision, last_seen_rollout_size, last_seen_rollout_mtime,
            last_material_change_at, last_task_complete_count, last_agent_message_fingerprint
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(thread_id) DO UPDATE SET
            current_revision = excluded.current_revision,
            last_seen_rollout_size = excluded.last_seen_rollout_size,
            last_seen_rollout_mtime = excluded.last_seen_rollout_mtime,
            last_material_change_at = excluded.last_material_change_at,
            last_task_complete_count = excluded.last_task_complete_count,
            last_agent_message_fingerprint = excluded.last_agent_message_fingerprint`,
        )
        .run(
          session.threadId,
          revision.currentRevision,
          revision.lastSeenRolloutSize,
          revision.lastSeenRolloutMtime ?? null,
          revision.lastMaterialChangeAt ?? null,
          revision.lastTaskCompleteCount,
          revision.lastAgentMessageFingerprint ?? null,
        );

      this.db
        .prepare(
          `INSERT INTO ingest_cursors (rollout_path, last_offset, last_size, last_mtime, last_scan_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(rollout_path) DO UPDATE SET
            last_offset = excluded.last_offset,
            last_size = excluded.last_size,
            last_mtime = excluded.last_mtime,
            last_scan_at = excluded.last_scan_at`,
        )
        .run(
          cursor.rolloutPath,
          cursor.lastOffset,
          cursor.lastSize,
          cursor.lastMtime ?? null,
          cursor.lastScanAt ?? null,
        );

      const state = this.getRenameState(session.threadId);
      const dirty = isDirtySinceRename(revision.currentRevision, state?.lastAppliedRevision);
      this.db
        .prepare(
          `INSERT INTO rename_state (thread_id, dirty_since_rename)
           VALUES (?, ?)
           ON CONFLICT(thread_id) DO UPDATE SET dirty_since_rename = excluded.dirty_since_rename`,
        )
        .run(session.threadId, dirty ? 1 : 0);
    });

    transaction();
  }

  updateOfficialNames(
    snapshot: Map<string, SessionIndexEntry>,
    preserveThreadIds = new Set<string>(),
  ): void {
    const transaction = this.db.transaction(() => {
      for (const entry of snapshot.values()) {
        if (preserveThreadIds.has(entry.id)) {
          continue;
        }
        this.updateOfficialName(entry.id, entry.threadName, entry.updatedAt);
      }
    });
    transaction();
  }

  updateOfficialName(threadId: string, threadName: string, updatedAt?: string): void {
    this.db
      .prepare(
        `UPDATE sessions
         SET latest_official_name = ?, latest_official_name_updated_at = ?
         WHERE thread_id = ?`,
      )
      .run(threadName, updatedAt ?? null, threadId);
  }

  getRenameState(threadId: string): RenameStateRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM rename_state WHERE thread_id = ?`).get(threadId) as
      | Record<string, unknown>
      | undefined;

    if (!row) {
      return undefined;
    }

    return {
      threadId,
      lastManualName: (row.last_manual_name as string | null) ?? undefined,
      lastAppliedName: (row.last_applied_name as string | null) ?? undefined,
      lastAppliedSource: (row.last_applied_source as RenameSource | null) ?? undefined,
      lastAppliedAt: (row.last_applied_at as string | null) ?? undefined,
      lastAppliedRevision: (row.last_applied_revision as string | null) ?? undefined,
      dirtySinceRename: toBoolean(row.dirty_since_rename),
    };
  }

  recordRename(params: {
    threadId: string;
    newName: string;
    source: RenameSource;
    kind: RenameHistoryKind;
    status: "applied" | "skipped" | "failed";
    reason?: string;
    operator: string;
    appliedAt: string;
    appliedRevision?: string;
    persistAppliedState?: boolean;
  }): void {
    const previous = this.getRenameState(params.threadId);
    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO rename_history (
            thread_id, kind, old_name, new_name, source, status, reason, applied_at, applied_revision, operator
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          params.threadId,
          params.kind,
          previous?.lastAppliedName ?? null,
          params.newName,
          params.source,
          params.status,
          params.reason ?? null,
          params.appliedAt,
          params.appliedRevision ?? null,
          params.operator,
        );

      if (params.status === "applied" || params.persistAppliedState) {
        this.db
          .prepare(
            `INSERT INTO rename_state (
              thread_id, last_manual_name, last_applied_name, last_applied_source,
              last_applied_at, last_applied_revision, dirty_since_rename
            ) VALUES (?, ?, ?, ?, ?, ?, 0)
            ON CONFLICT(thread_id) DO UPDATE SET
              last_manual_name = excluded.last_manual_name,
              last_applied_name = excluded.last_applied_name,
              last_applied_source = excluded.last_applied_source,
              last_applied_at = excluded.last_applied_at,
              last_applied_revision = excluded.last_applied_revision,
              dirty_since_rename = 0`,
          )
          .run(
            params.threadId,
            params.newName,
            params.newName,
            params.source,
            params.appliedAt,
            params.appliedRevision ?? null,
          );

        this.updateOfficialName(params.threadId, params.newName, params.appliedAt);
      }
    });

    transaction();
  }

  listSessions(query: SessionListQuery = {}): SessionSummary[] {
    const rows = this.db
      .prepare(
        `SELECT s.*, r.current_revision, rs.last_applied_name, rs.last_applied_source,
                rs.last_applied_at, rs.last_applied_revision, rs.dirty_since_rename
         FROM sessions s
         LEFT JOIN session_revisions r ON r.thread_id = s.thread_id
         LEFT JOIN rename_state rs ON rs.thread_id = s.thread_id`,
      )
      .all() as SessionRow[];

    const search = query.search?.trim().toLowerCase();
    let items = rows.map(toSummary).filter((item) => {
      if (query.workspace && item.workspaceId !== query.workspace) {
        return false;
      }
      if (!search) {
        return true;
      }
      return [item.officialName, item.threadId, item.cwd, item.projectName]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(search));
    });

    const sort = query.sort ?? "updatedAt";
    const direction = query.order === "asc" ? 1 : -1;
    items = items.sort((left, right) => {
      const leftValue =
        sort === "project"
          ? left.projectName
          : sort === "officialName"
            ? left.officialName
            : left.updatedAt;
      const rightValue =
        sort === "project"
          ? right.projectName
          : sort === "officialName"
            ? right.officialName
            : right.updatedAt;
      return direction * String(leftValue ?? "").localeCompare(String(rightValue ?? ""));
    });

    return typeof query.limit === "number" ? items.slice(0, query.limit) : items;
  }

  listWorkspaceSummaries(query: SessionListQuery = {}): WorkspaceSummary[] {
    const sessions = this.listSessions({ ...query, workspace: undefined });
    const groups = new Map<string, WorkspaceSummary>();

    for (const session of sessions) {
      const existing = groups.get(session.workspaceId);
      if (existing) {
        existing.sessionCount += 1;
        if (
          session.updatedAt &&
          (!existing.latestUpdatedAt || session.updatedAt > existing.latestUpdatedAt)
        ) {
          existing.latestUpdatedAt = session.updatedAt;
        }
        if (session.projectName && !existing.projects.includes(session.projectName)) {
          existing.projects.push(session.projectName);
        }
        continue;
      }
      groups.set(session.workspaceId, {
        workspaceId: session.workspaceId,
        workspaceLabel: session.workspaceLabel,
        workspacePath: session.cwd,
        sessionCount: 1,
        latestUpdatedAt: session.updatedAt,
        projects: session.projectName ? [session.projectName] : [],
      });
    }

    return [...groups.values()].sort((left, right) =>
      String(right.latestUpdatedAt ?? "").localeCompare(String(left.latestUpdatedAt ?? "")),
    );
  }

  getSessionDetail(threadId: string): SessionDetail | undefined {
    const row = this.db
      .prepare(
        `SELECT s.*, r.current_revision, rs.last_applied_name, rs.last_applied_source,
                rs.last_applied_at, rs.last_applied_revision, rs.dirty_since_rename
         FROM sessions s
         LEFT JOIN session_revisions r ON r.thread_id = s.thread_id
         LEFT JOIN rename_state rs ON rs.thread_id = s.thread_id
         WHERE s.thread_id = ?`,
      )
      .get(threadId) as SessionRow | undefined;

    if (!row) {
      return undefined;
    }

    return {
      ...toSummary(row),
      rolloutPath: row.rollout_path,
      createdAt: row.created_at ?? undefined,
      firstUserMessage: row.first_user_message ?? undefined,
      lastUserMessage: row.last_user_message ?? undefined,
      lastAgentMessage: row.last_agent_message ?? undefined,
      tokenTotal: row.token_total,
      revision: row.current_revision ?? undefined,
      lastAppliedAt: row.last_applied_at ?? undefined,
      lastAppliedRevision: row.last_applied_revision ?? undefined,
      renameHistory: this.getRenameHistory(threadId),
    };
  }

  deleteSession(threadId: string): { deleted: boolean; rolloutPath?: string } {
    const detail = this.getSessionDetail(threadId);
    if (!detail) {
      return { deleted: false };
    }

    const transaction = this.db.transaction(() => {
      this.db.prepare(`DELETE FROM sessions WHERE thread_id = ?`).run(threadId);
      this.db.prepare(`DELETE FROM session_revisions WHERE thread_id = ?`).run(threadId);
      this.db.prepare(`DELETE FROM rename_state WHERE thread_id = ?`).run(threadId);
      this.db.prepare(`DELETE FROM rename_history WHERE thread_id = ?`).run(threadId);
      this.db.prepare(`DELETE FROM ingest_cursors WHERE rollout_path = ?`).run(detail.rolloutPath);
    });
    transaction();
    return { deleted: true, rolloutPath: detail.rolloutPath };
  }

  getRenameHistory(threadId: string): RenameHistoryRecord[] {
    return this.db
      .prepare(
        `SELECT kind, old_name, new_name, source, status, reason, applied_at, applied_revision, operator
         FROM rename_history WHERE thread_id = ? ORDER BY applied_at DESC`,
      )
      .all(threadId)
      .map((row) => {
        const item = row as Record<string, unknown>;
        return {
          kind: item.kind as RenameHistoryKind,
          oldName: (item.old_name as string | null) ?? undefined,
          newName: item.new_name as string,
          source: item.source as RenameSource,
          status: item.status as RenameHistoryRecord["status"],
          reason: (item.reason as string | null) ?? undefined,
          appliedAt: item.applied_at as string,
          appliedRevision: (item.applied_revision as string | null) ?? undefined,
          operator: (item.operator as string | null) ?? undefined,
        };
      });
  }
}
