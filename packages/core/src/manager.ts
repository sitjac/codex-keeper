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
  SessionTranscript,
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
  paginateSessionTranscript,
  parseSessionTranscript,
  readLatestThreadNameUpdate,
} from "./rollout.js";
import {
  appendSessionIndexRename,
  compactSessionIndex,
  readSessionIndex,
  removeSessionIndexThread,
} from "./session-index.js";
import { basenameSafe, toUtcIso } from "./util.js";

const SCAN_FRESH_WINDOW_MS = 1_200;
const TRANSCRIPT_CACHE_LIMIT = 24;
const DEFERRED_CODEX_STATE_RETRY_DELAYS_MS = [250, 1500, 5000] as const;
const DEFERRED_CODEX_STATE_BUSY_TIMEOUT_MS = 250;

type OfficialNameCandidate = {
  threadName: string;
  updatedAt?: string;
};

function hasNewerTimestamp(left?: string, right?: string): boolean {
  const leftMs = left ? Date.parse(left) : Number.NaN;
  const rightMs = right ? Date.parse(right) : Number.NaN;
  return Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs > rightMs;
}

function preferNewerName(
  current: OfficialNameCandidate | undefined,
  next: OfficialNameCandidate | undefined,
): OfficialNameCandidate | undefined {
  if (!current) {
    return next;
  }
  if (!next) {
    return current;
  }
  return hasNewerTimestamp(next.updatedAt, current.updatedAt) ? next : current;
}

function resolveOfficialName(params: {
  manualName?: string;
  manualUpdatedAt?: string;
  codexStateName?: string;
  codexStateUpdatedAt?: string;
  rolloutName?: string;
  rolloutUpdatedAt?: string;
  indexedName?: string;
  indexedUpdatedAt?: string;
}): OfficialNameCandidate | undefined {
  const manual = params.manualName
    ? {
        threadName: params.manualName,
        updatedAt: params.manualUpdatedAt,
      }
    : undefined;
  const codexState = params.codexStateName
    ? {
        threadName: params.codexStateName,
        updatedAt: params.codexStateUpdatedAt,
      }
    : undefined;
  const contract = params.rolloutName
    ? {
        threadName: params.rolloutName,
        updatedAt: params.rolloutUpdatedAt,
      }
    : params.indexedName
      ? {
          threadName: params.indexedName,
          updatedAt: params.indexedUpdatedAt,
        }
      : undefined;

  if (manual) {
    if (!contract) {
      return manual;
    }
    if (contract.threadName === manual.threadName) {
      return preferNewerName(manual, contract);
    }
    return hasNewerTimestamp(contract.updatedAt, manual.updatedAt) ? contract : manual;
  }

  return codexState ?? contract;
}

export class CodexKeeper {
  private sessionIndexCache?: {
    size: number;
    mtimeMs: number;
    snapshot: SessionIndexSnapshot;
  };
  private readonly transcriptCache = new Map<
    string,
    {
      size: number;
      mtimeMs: number;
      transcript: SessionTranscript;
    }
  >();
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
      const renameState = this.db.getRenameState(result.session.threadId);
      const manualName =
        renameState?.lastAppliedSource === "manual" ? renameState.lastAppliedName : undefined;
      const officialName = resolveOfficialName({
        manualName,
        manualUpdatedAt: renameState?.lastAppliedAt,
        codexStateName: codexState?.title,
        codexStateUpdatedAt: codexState?.updatedAt,
        rolloutName: quickName.threadName,
        rolloutUpdatedAt: quickName.updatedAt,
        indexedName: indexedName?.threadName,
        indexedUpdatedAt: indexedName?.updatedAt,
      });
      if (officialName) {
        result.session.threadName = officialName.threadName;
        result.session.threadNameUpdatedAt = officialName.updatedAt;
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
    let detail = this.db.getSessionDetail(threadId);
    if (!detail) {
      await this.scan();
      detail = this.db.getSessionDetail(threadId);
    }
    if (!detail) {
      return undefined;
    }
    if (!options?.includeTranscript) {
      return detail;
    }
    return {
      ...detail,
      transcript: await this.readCachedSessionTranscript(detail.rolloutPath),
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
    const detail = await this.requireKnownSessionDetail(threadId);
    const transcript = await this.readCachedSessionTranscript(detail.rolloutPath);
    return paginateSessionTranscript(transcript, {
      ...options,
    });
  }

  async rename(
    threadId: string,
    name: string,
    options?: { codexStateWrite?: "sync" | "defer" },
  ): Promise<{ written: boolean; name: string }> {
    const detail = await this.requireKnownSessionDetail(threadId);
    const nextName = name.trim();
    if (!nextName) {
      throw new Error("Session name cannot be empty.");
    }

    const indexResult = await appendSessionIndexRename({
      filePath: this.sessionIndexPath,
      threadId,
      threadName: nextName,
      snapshot: await this.readSessionIndexSnapshot(),
    });
    this.sessionIndexCache = undefined;

    let shouldWriteRolloutName =
      indexResult.written || detail.officialName !== indexResult.entry.threadName;
    if (!shouldWriteRolloutName) {
      const latestRolloutThreadName = await readLatestThreadNameUpdate(detail.rolloutPath);
      shouldWriteRolloutName = latestRolloutThreadName.threadName !== indexResult.entry.threadName;
    }
    const appliedAt =
      indexResult.written || shouldWriteRolloutName ? toUtcIso() : indexResult.entry.updatedAt;

    if (shouldWriteRolloutName) {
      await appendThreadNameUpdatedEvent({
        rolloutPath: detail.rolloutPath,
        threadId,
        threadName: indexResult.entry.threadName,
        timestamp: appliedAt,
      });
      this.invalidateTranscriptCache(detail.rolloutPath);
    }

    const codexTitleUpdate =
      options?.codexStateWrite === "defer"
        ? this.deferCodexThreadTitleUpdate({
            threadId,
            title: indexResult.entry.threadName,
            updatedAt: appliedAt,
          })
        : await updateCodexThreadTitle({
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

  private deferCodexThreadTitleUpdate(params: {
    threadId: string;
    title: string;
    updatedAt: string;
  }): { updated: false } {
    this.scheduleCodexThreadTitleUpdate(params);
    return { updated: false };
  }

  private scheduleCodexThreadTitleUpdate(params: {
    threadId: string;
    title: string;
    updatedAt: string;
  }): void {
    const codexHome = this.config.general.codexHome;
    const retryableSkippedReasons = new Set<string | undefined>([
      undefined,
      "database is locked",
      "database is busy",
      "SQLITE_BUSY",
      "SQLITE_LOCKED",
    ]);

    const scheduleAttempt = (attemptIndex: number) => {
      const delay = DEFERRED_CODEX_STATE_RETRY_DELAYS_MS[attemptIndex];
      if (delay === undefined) {
        return;
      }

      const timer = setTimeout(() => {
        void updateCodexThreadTitle({
          codexHome,
          threadId: params.threadId,
          title: params.title,
          updatedAt: params.updatedAt,
          busyTimeoutMs: DEFERRED_CODEX_STATE_BUSY_TIMEOUT_MS,
        })
          .then((result) => {
            if (result.updated || result.skippedReason === "unchanged") {
              return;
            }
            if (retryableSkippedReasons.has(result.skippedReason)) {
              scheduleAttempt(attemptIndex + 1);
            }
          })
          .catch((error) => {
            const message = error instanceof Error ? error.message : undefined;
            if (
              retryableSkippedReasons.has(message) ||
              message?.includes("SQLITE_BUSY") ||
              message?.includes("SQLITE_LOCKED") ||
              message?.includes("database is locked")
            ) {
              scheduleAttempt(attemptIndex + 1);
            }
          });
      }, delay);
      timer.unref?.();
    };

    scheduleAttempt(0);
  }

  async deleteSession(threadId: string): Promise<SessionDeleteResult> {
    let detail = this.db.getSessionDetail(threadId);
    if (!detail) {
      await this.scan();
      detail = this.db.getSessionDetail(threadId);
    }
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
    this.invalidateTranscriptCache(detail.rolloutPath);
    const indexRemoval = await removeSessionIndexThread({
      filePath: this.sessionIndexPath,
      threadId,
      snapshot: await this.readSessionIndexSnapshot(),
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

  private async requireKnownSessionDetail(threadId: string): Promise<SessionDetail> {
    const detail = this.db.getSessionDetail(threadId);
    if (detail) {
      return detail;
    }

    await this.scan();
    return this.requireSessionDetail(threadId);
  }

  private async readCachedSessionTranscript(rolloutPath: string): Promise<SessionTranscript> {
    const stat = await fs.stat(rolloutPath);
    const cached = this.transcriptCache.get(rolloutPath);
    if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
      this.transcriptCache.delete(rolloutPath);
      this.transcriptCache.set(rolloutPath, cached);
      return cached.transcript;
    }

    const raw = await fs.readFile(rolloutPath, "utf8");
    const transcript = parseSessionTranscript(raw);
    this.transcriptCache.set(rolloutPath, {
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      transcript,
    });

    while (this.transcriptCache.size > TRANSCRIPT_CACHE_LIMIT) {
      const oldest = this.transcriptCache.keys().next().value;
      if (!oldest) {
        break;
      }
      this.transcriptCache.delete(oldest);
    }

    return transcript;
  }

  private invalidateTranscriptCache(rolloutPath: string): void {
    this.transcriptCache.delete(rolloutPath);
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
        if (this.sessionIndexCache?.size === 0 && this.sessionIndexCache.mtimeMs === 0) {
          return this.sessionIndexCache.snapshot;
        }
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
