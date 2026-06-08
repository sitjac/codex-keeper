import fs from "node:fs/promises";
import path from "node:path";

import Database from "better-sqlite3";
import { describe, expect, test } from "vitest";

import { buildSessionRevision } from "../packages/core/src/revision.js";
import { ingestRolloutFile } from "../packages/core/src/rollout.js";
import {
  createManagerForTest,
  createTempWorkspace,
  writeCodexStateFixture,
  writeRolloutFixture,
} from "./helpers.js";

describe("rollout ingest", () => {
  test("reads token usage from event_msg token_count payloads", async () => {
    const temp = await createTempWorkspace();
    const manager = await createManagerForTest({
      codexHome: temp.codexHome,
      stateDir: temp.stateDir,
    });

    try {
      const rolloutPath = await writeRolloutFixture({
        codexHome: temp.codexHome,
        threadId: "thread-token-event",
        userMessage: "看看 token 统计为什么是空的",
        lastAgentMessage: "我来修 token_count 解析。",
        tokenEventStyle: "event-msg",
      });
      const stat = await fs.stat(rolloutPath);
      const initial = await ingestRolloutFile({
        rolloutPath,
        stat,
      });

      expect(initial.session?.tokenTotal).toBe(1234);

      const staleSession = {
        ...initial.session!,
        tokenTotal: 0,
      };
      const revision = buildSessionRevision(
        staleSession,
        {
          sizeBytes: stat.size,
          mtime: stat.mtime.toISOString(),
        },
        undefined,
      );

      manager.db.upsertSession({
        session: staleSession,
        revision,
        cursor: {
          rolloutPath,
          lastOffset: stat.size,
          lastSize: stat.size,
          lastMtime: stat.mtime.toISOString(),
          lastScanAt: new Date().toISOString(),
        },
      });

      await manager.scan();
      const detail = await manager.getSessionDetail("thread-token-event");
      expect(detail?.tokenTotal).toBe(1234);
    } finally {
      await manager.close();
    }
  });

  test("prefers Codex rollout thread names over stale session index titles", async () => {
    const temp = await createTempWorkspace();
    let manager = await createManagerForTest({
      codexHome: temp.codexHome,
      stateDir: temp.stateDir,
    });

    try {
      await writeRolloutFixture({
        codexHome: temp.codexHome,
        threadId: "thread-title-source",
        userMessage: "修复工作区标题",
        lastAgentMessage: "已经定位标题来源",
        threadName: "CLI resume title",
      });
      await fs.writeFile(
        path.join(temp.codexHome, "session_index.jsonl"),
        `${JSON.stringify({
          id: "thread-title-source",
          thread_name: "2026-05-07 · very long stale generated title",
          updated_at: "2026-05-07T13:43:34.000Z",
        })}\n`,
        "utf8",
      );

      await manager.scan();
      manager.db.updateOfficialName(
        "thread-title-source",
        "2026-05-07 · stale title already cached in local state",
        "2026-05-07T13:43:34.000Z",
      );
      await manager.close();

      manager = await createManagerForTest({
        codexHome: temp.codexHome,
        stateDir: temp.stateDir,
      });
      await manager.scan();
      const detail = await manager.getSessionDetail("thread-title-source");
      expect(detail?.officialName).toBe("CLI resume title");
    } finally {
      await manager.close();
    }
  });

  test("uses Codex state titles and writes manual renames back for CLI resume", async () => {
    const temp = await createTempWorkspace();
    const rolloutPath = await writeRolloutFixture({
      codexHome: temp.codexHome,
      threadId: "thread-codex-state-title",
      userMessage: "评审学习最新接口改动",
      lastAgentMessage: "我会对比两个分支。",
      threadName: "评审学习最新接口改动",
    });
    const dbPath = await writeCodexStateFixture({
      codexHome: temp.codexHome,
      threads: [
        {
          id: "thread-codex-state-title",
          rolloutPath,
          cwd: "/tmp/project-alpha",
          title: "Review Change Between Different Branch",
        },
      ],
    });
    const manager = await createManagerForTest({
      codexHome: temp.codexHome,
      stateDir: temp.stateDir,
    });

    try {
      await fs.writeFile(
        path.join(temp.codexHome, "session_index.jsonl"),
        `${JSON.stringify({
          id: "thread-codex-state-title",
          thread_name: "评审学习最新接口改动",
          updated_at: "2026-04-04T12:20:00.000Z",
        })}\n`,
        "utf8",
      );

      await manager.scan();
      const before = await manager.getSessionDetail("thread-codex-state-title");
      expect(before?.officialName).toBe("Review Change Between Different Branch");

      await manager.rename("thread-codex-state-title", "手动修改后的标题");
      const db = new Database(dbPath, { readonly: true, fileMustExist: true });
      try {
        const row = db
          .prepare("SELECT title FROM threads WHERE id = ?")
          .get("thread-codex-state-title") as { title: string };
        expect(row.title).toBe("手动修改后的标题");
      } finally {
        db.close();
      }
    } finally {
      await manager.close();
    }
  });

  test("keeps manual rename when Codex state title later falls back", async () => {
    const temp = await createTempWorkspace();
    const rolloutPath = await writeRolloutFixture({
      codexHome: temp.codexHome,
      threadId: "thread-manual-rename-persisted",
      userMessage: "给这个 session 起一个稳定标题",
      lastAgentMessage: "我会保持手动标题。",
      threadName: "原始标题",
    });
    const dbPath = await writeCodexStateFixture({
      codexHome: temp.codexHome,
      threads: [
        {
          id: "thread-manual-rename-persisted",
          rolloutPath,
          cwd: "/tmp/project-alpha",
          title: "自动生成旧标题",
        },
      ],
    });
    let manager = await createManagerForTest({
      codexHome: temp.codexHome,
      stateDir: temp.stateDir,
    });

    try {
      await manager.scan();
      await manager.rename("thread-manual-rename-persisted", "手动固定标题");
      await manager.close();

      const db = new Database(dbPath);
      try {
        db.prepare(
          `UPDATE threads
           SET title = ?, updated_at = ?, updated_at_ms = ?
           WHERE id = ?`,
        ).run(
          "自动生成旧标题",
          Math.floor(new Date("2026-04-04T12:45:00.000Z").getTime() / 1000),
          new Date("2026-04-04T12:45:00.000Z").getTime(),
          "thread-manual-rename-persisted",
        );
      } finally {
        db.close();
      }

      manager = await createManagerForTest({
        codexHome: temp.codexHome,
        stateDir: temp.stateDir,
      });
      await manager.scan();
      const detail = await manager.getSessionDetail("thread-manual-rename-persisted");
      expect(detail?.officialName).toBe("手动固定标题");
    } finally {
      await manager.close();
    }
  });

  test("hides Codex internal subagent sessions from workspace counts", async () => {
    const temp = await createTempWorkspace();
    const cwd = "/tmp/dms_workflow_volkswagen";
    const normalRollout = await writeRolloutFixture({
      codexHome: temp.codexHome,
      threadId: "thread-visible-dms",
      cwd,
      userMessage: "正常 session",
      lastAgentMessage: "正常回复",
      threadName: "正常会话",
    });
    const internalRollout = await writeRolloutFixture({
      codexHome: temp.codexHome,
      threadId: "thread-internal-dms",
      cwd,
      userMessage: "内部 guardian session",
      lastAgentMessage: "内部回复",
      source: JSON.stringify({ subagent: { other: "guardian" } }),
      threadName: "适配domino最新改动",
    });
    await writeCodexStateFixture({
      codexHome: temp.codexHome,
      threads: [
        {
          id: "thread-visible-dms",
          rolloutPath: normalRollout,
          cwd,
          title: "正常会话",
          source: "cli",
        },
        {
          id: "thread-internal-dms",
          rolloutPath: internalRollout,
          cwd,
          title: "适配domino最新改动",
          source: JSON.stringify({ subagent: { other: "guardian" } }),
        },
      ],
    });
    const manager = await createManagerForTest({
      codexHome: temp.codexHome,
      stateDir: temp.stateDir,
    });

    try {
      const sessions = await manager.listSessions();
      expect(sessions.map((session) => session.threadId)).toEqual(["thread-visible-dms"]);

      const workspaces = await manager.listWorkspaces();
      const workspace = workspaces.find((item) => item.workspacePath === cwd);
      expect(workspace?.sessionCount).toBe(1);
    } finally {
      await manager.close();
    }
  });
});
