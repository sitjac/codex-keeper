import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CodexTurnRunner } from "@codex-keeper/core";
import { CodexKeeper } from "@codex-keeper/core";
import type { EffectiveConfig } from "@codex-keeper/shared";
import Database from "better-sqlite3";

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Array<infer U>
    ? Array<DeepPartial<U>>
    : T[K] extends Record<string, unknown>
      ? DeepPartial<T[K]>
      : T[K];
};

export async function createTempWorkspace(): Promise<{
  root: string;
  codexHome: string;
  stateDir: string;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "csm-"));
  const codexHome = path.join(root, ".codex");
  const stateDir = path.join(root, ".state");
  await fs.mkdir(path.join(codexHome, "sessions"), { recursive: true });
  await fs.writeFile(
    path.join(codexHome, "config.toml"),
    'model_provider = "OpenAI"\nmodel = "gpt-5.4"\n',
  );
  return { root, codexHome, stateDir };
}

export async function writeRolloutFixture(params: {
  codexHome: string;
  threadId: string;
  userMessage: string;
  lastAgentMessage: string;
  userContent?: Array<Record<string, unknown>>;
  assistantContent?: Array<Record<string, unknown>>;
  updatedAt?: string;
  cwd?: string;
  source?: string;
  threadName?: string;
  toolCallName?: string;
  toolCallArguments?: Record<string, unknown>;
  toolCallOutput?: string;
  tokenEventStyle?: "top-level" | "event-msg";
}): Promise<string> {
  const updatedAt = params.updatedAt ?? "2026-04-04T12:10:00.000Z";
  const rolloutDir = path.join(params.codexHome, "sessions", "2026", "04", "04");
  await fs.mkdir(rolloutDir, { recursive: true });
  const rolloutPath = path.join(rolloutDir, `rollout-${params.threadId}.jsonl`);
  const tokenPayload = {
    info: {
      total_token_usage: {
        total_tokens: 1234,
      },
    },
  };
  const lines = [
    JSON.stringify({
      timestamp: "2026-04-04T12:00:00.000Z",
      type: "session_meta",
      payload: {
        id: params.threadId,
        timestamp: "2026-04-04T12:00:00.000Z",
        cwd: params.cwd ?? "/tmp/project-alpha",
        model_provider: "OpenAI",
        ...(params.source ? { source: params.source } : {}),
      },
    }),
    ...(params.threadName
      ? [
          JSON.stringify({
            timestamp: "2026-04-04T12:00:00.500Z",
            type: "event_msg",
            payload: {
              type: "thread_name_updated",
              thread_id: params.threadId,
              thread_name: params.threadName,
            },
          }),
        ]
      : []),
    JSON.stringify({
      timestamp: "2026-04-04T12:00:01.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: params.userContent ?? [
          {
            type: "input_text",
            text: params.userMessage,
          },
        ],
      },
    }),
    JSON.stringify({
      timestamp: "2026-04-04T12:00:01.000Z",
      type: "event_msg",
      payload: {
        type: "user_message",
        message: params.userMessage,
      },
    }),
    JSON.stringify({
      timestamp: "2026-04-04T12:00:02.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        phase: "commentary",
        content: params.assistantContent ?? [
          {
            type: "output_text",
            text: params.lastAgentMessage,
          },
        ],
      },
    }),
    ...(params.toolCallName
      ? [
          JSON.stringify({
            timestamp: "2026-04-04T12:00:03.000Z",
            type: "response_item",
            payload: {
              type: "function_call",
              name: params.toolCallName,
              arguments: JSON.stringify(params.toolCallArguments ?? {}),
              call_id: "call_test_1",
            },
          }),
          JSON.stringify({
            timestamp: "2026-04-04T12:00:04.000Z",
            type: "response_item",
            payload: {
              type: "function_call_output",
              call_id: "call_test_1",
              output: params.toolCallOutput ?? "ok",
            },
          }),
        ]
      : []),
    JSON.stringify({
      timestamp: updatedAt,
      type: "event_msg",
      payload: {
        type: "task_complete",
        last_agent_message: params.lastAgentMessage,
      },
    }),
    JSON.stringify({
      timestamp: updatedAt,
      type: "task_complete",
      payload: {
        last_agent_message: params.lastAgentMessage,
      },
    }),
    JSON.stringify({
      timestamp: updatedAt,
      type: params.tokenEventStyle === "event-msg" ? "event_msg" : "token_count",
      payload:
        params.tokenEventStyle === "event-msg"
          ? {
              type: "token_count",
              ...tokenPayload,
            }
          : tokenPayload,
    }),
  ];
  await fs.writeFile(rolloutPath, `${lines.join("\n")}\n`, "utf8");
  return rolloutPath;
}

export async function writeCodexStateFixture(params: {
  codexHome: string;
  threads: Array<{
    id: string;
    rolloutPath: string;
    cwd: string;
    title: string;
    source?: string;
    archived?: boolean;
    updatedAt?: Date;
  }>;
}): Promise<string> {
  await fs.mkdir(params.codexHome, { recursive: true });
  const dbPath = path.join(params.codexHome, "state_5.sqlite");
  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        rollout_path TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        source TEXT NOT NULL,
        model_provider TEXT NOT NULL,
        cwd TEXT NOT NULL,
        title TEXT NOT NULL,
        sandbox_policy TEXT NOT NULL,
        approval_mode TEXT NOT NULL,
        tokens_used INTEGER NOT NULL DEFAULT 0,
        has_user_event INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        archived_at INTEGER,
        updated_at_ms INTEGER
      );
    `);
    const insert = db.prepare(
      `INSERT INTO threads (
        id, rollout_path, created_at, updated_at, source, model_provider, cwd, title,
        sandbox_policy, approval_mode, archived, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const thread of params.threads) {
      const updatedAtMs = (thread.updatedAt ?? new Date("2026-04-04T12:10:00.000Z")).getTime();
      insert.run(
        thread.id,
        thread.rolloutPath,
        Math.floor(updatedAtMs / 1000),
        Math.floor(updatedAtMs / 1000),
        thread.source ?? "cli",
        "OpenAI",
        thread.cwd,
        thread.title,
        "{}",
        "never",
        thread.archived ? 1 : 0,
        updatedAtMs,
      );
    }
  } finally {
    db.close();
  }
  return dbPath;
}

export async function createManagerForTest(
  overrides: DeepPartial<EffectiveConfig> & {
    codexHome: string;
    stateDir: string;
    turnRunner?: CodexTurnRunner;
  },
): Promise<CodexKeeper> {
  const workspaceRoot = path.dirname(overrides.codexHome);
  const configPath = path.join(workspaceRoot, ".config", "codex-keeper", "config.toml");
  const { codexHome, stateDir, turnRunner, ...configOverrides } = overrides;
  const manager = await CodexKeeper.create({
    cwd: workspaceRoot,
    configPath,
    overrides: {
      ...(configOverrides as Partial<EffectiveConfig>),
      general: {
        ...(configOverrides as Partial<EffectiveConfig>).general,
        codexHome,
        stateDir,
      },
    },
    operator: "test",
    turnRunner,
  });
  return manager;
}
