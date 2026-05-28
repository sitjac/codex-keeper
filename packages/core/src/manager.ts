import fs from "node:fs/promises";
import path from "node:path";
import type {
  CompactIndexResult,
  ConfigDocument,
  ConfigView,
  EffectiveConfig,
  ScanReport,
  SessionDeleteResult,
  SessionDetail,
  SessionIndexSnapshot,
  SessionListQuery,
  SessionSummary,
  SessionsResponse,
  SessionTranscriptPage,
  WorkspaceSummary,
} from "@codex-keeper/shared";
import { SESSION_INDEX_FILENAME } from "@codex-keeper/shared";
import { readCodexThreadStateSnapshot, updateCodexThreadTitle } from "./codex-state.js";
import { loadConfigView, loadEffectiveConfig, writeUserConfig } from "./config.js";
import { StateDatabase } from "./database.js";
import { buildSessionRevision } from "./revision.js";
import {
  appendThreadNameUpdatedEvent,
  discoverRolloutFiles,
  ingestRolloutFile,
  readLatestThreadNameUpdate,
  readSessionTranscript,
  readSessionTranscriptPage,
} from "./rollout.js";
import {
  appendSessionIndexRename,
  compactSessionIndex,
  readSessionIndex,
  removeSessionIndexThread,
} from "./session-index.js";
import { basenameSafe, toUtcIso } from "./util.js";

const SCAN_FRESH_WINDOW_MS = 1_200;

export class CodexKeeper {
  private sessionIndexCache?: {
    size: number;
    mtimeMs: number;
    snapshot: SessionIndexSnapshot;
  };
  private scanPromise?: Promise<ScanReport>;
  private lastScanCompletedAt = 0;
  private lastScanResult: ScanReport = {
    scannedRollouts: 0,
    updatedSessions: 0,
  };
  private readonly cwd: string;
  private readonly configPath?: string;
  private readonly overrides?: Partial<EffectiveConfig>;

  constructor(
    public config: EffectiveConfig,
    public readonly db: StateDatabase,
    private readonly operator: string = "cli",
    options?: {
      cwd?: string;
      configPath?: string;
      overrides?: Partial<EffectiveConfig>;
    },
  ) {
    this.cwd = options?.cwd ?? process.cwd();
    this.configPath = options?.configPath;
    this.overrides = options?.overrides;
  }

  static async create(options?: {
    cwd?: string;
    configPath?: string;
    overrides?: Partial<EffectiveConfig>;
    operator?: string;
  }): Promise<CodexKeeper> {
    const config = await loadEffectiveConfig({
      cwd: options?.cwd,
      configPath: options?.configPath,
      overrides: options?.overrides,
    });
    const db = await StateDatabase.create(path.join(config.general.stateDir, "app.db"));
    return new CodexKeeper(config, db, options?.operator, {
      cwd: options?.cwd,
      configPath: options?.configPath,
      overrides: options?.overrides,
    });
  }

  get sessionIndexPath(): string {
    return path.join(this.config.general.codexHome, SESSION_INDEX_FILENAME);
  }

  get backupDir(): string {
    return path.join(this.config.general.stateDir, "backups");
  }

  async close(): Promise<void> {
    this.db.close();
  }

  async reloadConfig(): Promise<void> {
    this.config = await loadEffectiveConfig({
      cwd: this.cwd,
      configPath: this.configPath,
      overrides: this.overrides,
    });
    this.sessionIndexCache = undefined;
    this.lastScanCompletedAt = 0;
  }

  async scan(): Promise<ScanReport> {
    if (this.scanPromise) {
      return this.scanPromise;
    }

    if (Date.now() - this.lastScanCompletedAt <= SCAN_FRESH_WINDOW_MS) {
      return this.lastScanResult;
    }

    this.scanPromise = this.performScan()
      .then((result) => {
        this.lastScanResult = result;
        this.lastScanCompletedAt = Date.now();
        return result;
      })
      .finally(() => {
        this.scanPromise = undefined;
      });

    return this.scanPromise;
  }

  private async performScan(): Promise<ScanReport> {
    const snapshot = await this.readSessionIndexSnapshot();
    const codexThreadState = await readCodexThreadStateSnapshot(this.config.general.codexHome);
    const rolloutFiles = await discoverRolloutFiles(this.config.general.codexHome);
    let updatedSessions = 0;
    const preserveThreadIds = new Set<string>();

    for (const rolloutPath of rolloutFiles) {
      const stat = await fs.stat(rolloutPath);
      const previous = this.db.getSessionByRolloutPath(rolloutPath);
      const previousCursor = this.db.getCursor(rolloutPath);
      const result = await ingestRolloutFile({
        rolloutPath,
        stat,
        previousSession: previous,
        previousCursor: previousCursor ? { rolloutPath, ...previousCursor } : undefined,
      });
      if (!result.session) {
        continue;
      }

      const codexState = codexThreadState.get(result.session.threadId);
      if (codexState?.internal || result.session.archivedHint) {
        this.db.deleteSession(result.session.threadId);
        continue;
      }

      if (codexState?.cwd) {
        result.session.cwd = codexState.cwd;
        result.session.projectName = basenameSafe(codexState.cwd);
      }

      const indexedName = snapshot.latestByThreadId.get(result.session.threadId);
      const quickName = await readLatestThreadNameUpdate(rolloutPath);
      const officialName = codexState?.title ?? quickName.threadName ?? indexedName?.threadName;
      const officialUpdatedAt =
        codexState?.updatedAt ?? quickName.updatedAt ?? indexedName?.updatedAt;
      if (officialName) {
        result.session.threadName = officialName;
        result.session.threadNameUpdatedAt = officialUpdatedAt;
        preserveThreadIds.add(result.session.threadId);
      }

      const previousRevision = this.db.getRevision(result.session.threadId);
      const revision = buildSessionRevision(
        result.session,
        {
          sizeBytes: stat.size,
          mtime: stat.mtime.toISOString(),
        },
        previousRevision,
      );
      this.db.upsertSession({
        session: result.session,
        revision,
        cursor: result.cursor,
      });
      updatedSessions += 1;
    }

    this.db.updateOfficialNames(snapshot.latestByThreadId, preserveThreadIds);
    return {
      scannedRollouts: rolloutFiles.length,
      updatedSessions,
    };
  }

  async listSessions(query: SessionListQuery = {}): Promise<SessionSummary[]> {
    await this.scan();
    return this.db.listSessions(query);
  }

  async listWorkspaces(query: SessionListQuery = {}): Promise<WorkspaceSummary[]> {
    await this.scan();
    return this.db.listWorkspaceSummaries(query);
  }

  async querySessions(query: SessionListQuery = {}): Promise<SessionsResponse> {
    const [items, workspaces] = await Promise.all([
      this.listSessions(query),
      this.listWorkspaces(query),
    ]);
    return {
      items,
      workspaces,
      total: items.length,
      counts: {
        dirty: items.filter((item) => item.dirty).length,
      },
      nextCursor: null,
    };
  }

  async getSessionDetail(
    threadId: string,
    options?: { includeTranscript?: boolean },
  ): Promise<SessionDetail | undefined> {
    await this.scan();
    const detail = this.db.getSessionDetail(threadId);
    if (!detail) {
      return undefined;
    }
    if (!options?.includeTranscript) {
      return detail;
    }
    return {
      ...detail,
      transcript: await readSessionTranscript(detail.rolloutPath),
    };
  }

  async getSessionTranscriptPage(
    threadId: string,
    options?: {
      page?: number;
      pageSize?: number;
      includeHidden?: boolean;
      role?: "all" | "user" | "assistant" | "tool" | "system";
      query?: string;
    },
  ): Promise<SessionTranscriptPage> {
    await this.scan();
    const detail = this.requireSessionDetail(threadId);
    return readSessionTranscriptPage({
      rolloutPath: detail.rolloutPath,
      ...options,
    });
  }

  async rename(threadId: string, name: string): Promise<{ written: boolean; name: string }> {
    await this.scan();
    const detail = this.requireSessionDetail(threadId);
    const nextName = name.trim();
    if (!nextName) {
      throw new Error("Session name cannot be empty.");
    }

    const indexResult = await appendSessionIndexRename({
      filePath: this.sessionIndexPath,
      threadId,
      threadName: nextName,
    });
    this.sessionIndexCache = undefined;

    const latestRolloutThreadName = await readLatestThreadNameUpdate(detail.rolloutPath);
    const shouldWriteRolloutName =
      indexResult.written ||
      detail.officialName !== indexResult.entry.threadName ||
      latestRolloutThreadName.threadName !== indexResult.entry.threadName;
    const appliedAt =
      indexResult.written || shouldWriteRolloutName ? toUtcIso() : indexResult.entry.updatedAt;

    if (shouldWriteRolloutName) {
      await appendThreadNameUpdatedEvent({
        rolloutPath: detail.rolloutPath,
        threadId,
        threadName: indexResult.entry.threadName,
        timestamp: appliedAt,
      });
    }

    const codexTitleUpdate = await updateCodexThreadTitle({
      codexHome: this.config.general.codexHome,
      threadId,
      title: indexResult.entry.threadName,
      updatedAt: appliedAt,
    });
    const written = indexResult.written || shouldWriteRolloutName || codexTitleUpdate.updated;

    this.db.recordRename({
      threadId,
      newName: indexResult.entry.threadName,
      source: "manual",
      kind: "manual",
      status: written ? "applied" : "skipped",
      reason: written ? undefined : "unchanged",
      operator: this.operator,
      appliedAt,
      appliedRevision: detail.revision,
      persistAppliedState: true,
    });

    return {
      written,
      name: indexResult.entry.threadName,
    };
  }

  async deleteSession(threadId: string): Promise<SessionDeleteResult> {
    await this.scan();
    const detail = this.db.getSessionDetail(threadId);
    if (!detail) {
      return {
        threadId,
        deleted: false,
        removedIndexEntries: 0,
      };
    }

    const deleted = this.db.deleteSession(threadId);
    if (!deleted.deleted) {
      return {
        threadId,
        deleted: false,
        removedIndexEntries: 0,
      };
    }

    await fs.rm(detail.rolloutPath, { force: true });
    const indexRemoval = await removeSessionIndexThread({
      filePath: this.sessionIndexPath,
      threadId,
    });
    this.sessionIndexCache = undefined;

    return {
      threadId,
      deleted: true,
      rolloutPath: detail.rolloutPath,
      removedIndexEntries: indexRemoval.removed,
    };
  }

  async compactIndex(options?: { dryRun?: boolean }): Promise<CompactIndexResult> {
    const result = await compactSessionIndex({
      filePath: this.sessionIndexPath,
      backupDir: this.backupDir,
      dryRun: options?.dryRun,
    });
    this.sessionIndexCache = undefined;
    return result;
  }

  async getRenameHistory(
    threadId: string,
  ): Promise<import("@codex-keeper/shared").RenameHistoryRecord[]> {
    await this.scan();
    return this.db.getRenameHistory(threadId);
  }

  async getConfigView(): Promise<ConfigView> {
    return loadConfigView({
      cwd: this.cwd,
      configPath: this.configPath,
      overrides: this.overrides,
      effectiveConfig: this.config,
    });
  }

  async updateConfig(
    patch: ConfigDocument,
  ): Promise<{ writtenTo: string; restartRequired: boolean; config: ConfigView }> {
    const result = await writeUserConfig({
      cwd: this.cwd,
      configPath: this.configPath,
      patch,
    });
    await this.reloadConfig();
    return {
      writtenTo: result.userConfigPath,
      restartRequired: false,
      config: await this.getConfigView(),
    };
  }

  private requireSessionDetail(threadId: string): SessionDetail {
    const detail = this.db.getSessionDetail(threadId);
    if (!detail) {
      throw new Error(`Unknown session: ${threadId}`);
    }
    return detail;
  }

  private async readSessionIndexSnapshot(): Promise<SessionIndexSnapshot> {
    try {
      const stat = await fs.stat(this.sessionIndexPath);
      if (
        this.sessionIndexCache &&
        this.sessionIndexCache.size === stat.size &&
        this.sessionIndexCache.mtimeMs === stat.mtimeMs
      ) {
        return this.sessionIndexCache.snapshot;
      }

      const snapshot = await readSessionIndex(this.sessionIndexPath);
      this.sessionIndexCache = {
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        snapshot,
      };
      return snapshot;
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === "ENOENT") {
        const snapshot = await readSessionIndex(this.sessionIndexPath);
        this.sessionIndexCache = {
          size: 0,
          mtimeMs: 0,
          snapshot,
        };
        return snapshot;
      }
      throw error;
    }
  }
}
