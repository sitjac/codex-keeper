export type UiLanguage = "en-US" | "zh-CN";
export type RenameSource = "manual" | "recovered";
export type RenameHistoryKind = "manual" | "compact-rewrite";
export type RenameStatus = "applied" | "skipped" | "failed";
export type SessionStatusEstimate = "discovered" | "active" | "idle" | "archived_hint";
export type SessionTranscriptRole = "user" | "assistant" | "tool" | "system";
export type SessionTranscriptKind =
  | "message"
  | "tool_call"
  | "tool_output"
  | "reasoning"
  | "status";

export interface GeneralConfig {
  codexHome: string;
  stateDir: string;
  uiLanguage: UiLanguage;
}

export interface EffectiveConfig {
  general: GeneralConfig;
}

export interface ConfigDocument {
  general?: Partial<GeneralConfig>;
}

export interface ConfigView {
  paths: {
    cwd: string;
    userConfigPath: string;
    projectConfigPath: string;
  };
  userConfig: ConfigDocument;
  projectOverride: ConfigDocument;
  effectiveConfig: {
    general: GeneralConfig;
  };
}

export type ApiEventType =
  | "scan.completed"
  | "session.renamed"
  | "session.deleted"
  | "session.index.compacted"
  | "session.turn.completed"
  | "session.turn.failed";

export interface ApiEventRecord {
  cursor: number;
  type: ApiEventType;
  at: string;
  payload: Record<string, unknown>;
}

export interface ApiEventBatch {
  items: ApiEventRecord[];
  nextCursor: number;
}

export interface SessionIndexEntry {
  id: string;
  threadName: string;
  updatedAt: string;
  lineNumber?: number;
}

export interface SessionIndexStats {
  totalLines: number;
  uniqueThreadIds: number;
  duplicateThreadIds: number;
  sizeBytes: number;
}

export interface SessionIndexSnapshot {
  entries: SessionIndexEntry[];
  latestByThreadId: Map<string, SessionIndexEntry>;
  stats: SessionIndexStats;
}

export interface CompactIndexResult {
  dryRun: boolean;
  originalLines: number;
  compactedLines: number;
  originalSizeBytes: number;
  compactedSizeBytes: number;
  outputPath?: string;
  backupPath?: string;
}

export interface MaterializedSession {
  threadId: string;
  rolloutPath: string;
  cwd?: string;
  projectName?: string;
  createdAt?: string;
  updatedAt?: string;
  threadName?: string;
  threadNameUpdatedAt?: string;
  modelProvider?: string;
  model?: string;
  firstUserMessage?: string;
  lastUserMessage?: string;
  lastAgentMessage?: string;
  taskCompleteCount: number;
  tokenTotal: number;
  archivedHint?: boolean;
}

export interface WorkspaceSummary {
  workspaceId: string;
  workspaceLabel: string;
  workspacePath?: string;
  sessionCount: number;
  latestUpdatedAt?: string;
  projects: string[];
}

export type SessionListSortField = "updatedAt" | "project" | "officialName";
export type SortOrder = "asc" | "desc";

export interface SessionListQuery {
  workspace?: string;
  search?: string;
  sort?: SessionListSortField;
  order?: SortOrder;
  limit?: number;
}

export interface SessionDetailQuery {
  includeTranscript?: boolean;
}

export interface SessionTranscriptQuery {
  page?: number;
  pageSize?: number;
  includeHidden?: boolean;
  role?: "all" | SessionTranscriptRole;
  query?: string;
}

export interface RenameRequest {
  name: string;
}

export interface SessionMessageRequest {
  message: string;
}

export interface SessionMessageResponse {
  threadId: string;
  completedAt: string;
  durationMs: number;
  exitCode: number;
}

export interface SessionDeleteResult {
  threadId: string;
  deleted: boolean;
  rolloutPath?: string;
  removedIndexEntries: number;
}

export interface SessionTranscriptEntry {
  id: string;
  timestamp?: string;
  role: SessionTranscriptRole;
  kind: SessionTranscriptKind;
  content: string;
  name?: string;
  callId?: string;
  phase?: string;
  hidden?: boolean;
  hiddenReason?: string;
}

export interface SessionTranscript {
  items: SessionTranscriptEntry[];
  counts: {
    total: number;
    visible: number;
    hidden: number;
    tools: number;
  };
}

export interface SessionTranscriptPage {
  items: SessionTranscriptEntry[];
  counts: SessionTranscript["counts"];
  totalItems: number;
  totalPages: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface SessionRevision {
  currentRevision: string;
  lastSeenRolloutSize: number;
  lastSeenRolloutMtime?: string;
  lastMaterialChangeAt?: string;
  lastTaskCompleteCount: number;
  lastAgentMessageFingerprint?: string;
}

export interface RenameStateRecord {
  threadId: string;
  lastManualName?: string;
  lastAppliedName?: string;
  lastAppliedSource?: RenameSource;
  lastAppliedAt?: string;
  lastAppliedRevision?: string;
  dirtySinceRename: boolean;
}

export interface RenameHistoryRecord {
  kind: RenameHistoryKind;
  oldName?: string;
  newName: string;
  source: RenameSource;
  status: RenameStatus;
  reason?: string;
  appliedAt: string;
  appliedRevision?: string;
  operator?: string;
}

export interface SessionSummary {
  threadId: string;
  cwd?: string;
  projectName?: string;
  workspaceId: string;
  workspaceLabel: string;
  updatedAt?: string;
  officialName?: string;
  dirty: boolean;
  taskCompleteCount: number;
  provider?: string;
  model?: string;
  lastAppliedSource?: RenameSource;
  statusEstimate?: SessionStatusEstimate;
}

export interface SessionDetail extends SessionSummary {
  rolloutPath: string;
  createdAt?: string;
  firstUserMessage?: string;
  lastUserMessage?: string;
  lastAgentMessage?: string;
  tokenTotal: number;
  revision?: string;
  lastAppliedAt?: string;
  lastAppliedRevision?: string;
  renameHistory?: RenameHistoryRecord[];
  transcript?: SessionTranscript;
}

export interface ScanReport {
  scannedRollouts: number;
  updatedSessions: number;
}

export interface SessionsResponse {
  items: SessionSummary[];
  workspaces: WorkspaceSummary[];
  total: number;
  counts: {
    dirty: number;
  };
  nextCursor: string | null;
}

export type ApiEventsResponse = ApiEventBatch;

export interface RenameApplyResponse {
  written: boolean;
  name: string;
}

export type ConfigUpdateResponse = {
  writtenTo: string;
  restartRequired: boolean;
  config: ConfigView;
};
