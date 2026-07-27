import fs from "node:fs/promises";
import path from "node:path";
import type { CodexTurnRunner } from "@codex-keeper/core";
import { readSessionIndex } from "@codex-keeper/core";
import { afterEach, describe, expect, it } from "vitest";
import { buildApiServer } from "../packages/api/src/app.ts";

import {
  createManagerForTest,
  createTempWorkspace,
  writeCodexStateFixture,
  writeRolloutFixture,
} from "./helpers.js";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanup.length > 0) {
    const action = cleanup.pop();
    if (action) {
      await action();
    }
  }
});

describe("local api", () => {
  it("creates an owned manager from explicit cwd and config path", async () => {
    const workspace = await createTempWorkspace();
    const configPath = path.join(workspace.root, ".config", "codex-keeper", "config.toml");
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(
      configPath,
      [
        "[general]",
        `codex_home = "${workspace.codexHome}"`,
        `state_dir = "${workspace.stateDir}"`,
        "",
      ].join("\n"),
      "utf8",
    );

    const app = await buildApiServer({
      operator: "api-test",
      cwd: workspace.root,
      configPath,
    });
    cleanup.push(async () => {
      await app.close();
    });

    const config = await app.inject({
      method: "GET",
      url: "/api/v1/config",
    });
    expect(config.statusCode).toBe(200);
    expect(config.json().paths.cwd).toBe(workspace.root);
    expect(config.json().paths.userConfigPath).toBe(configPath);
  });

  it("lists, renames, and deletes sessions", async () => {
    const workspace = await createTempWorkspace();
    const manager = await createManagerForTest({
      codexHome: workspace.codexHome,
      stateDir: workspace.stateDir,
    });
    cleanup.push(async () => manager.close());

    const apiRolloutPath = await writeRolloutFixture({
      codexHome: workspace.codexHome,
      threadId: "019d-api-rename",
      userMessage: "实现 local api",
      lastAgentMessage: "已经补上 health 和 sessions 路由",
    });
    const deleteRolloutPath = await writeRolloutFixture({
      codexHome: workspace.codexHome,
      threadId: "019d-api-delete",
      userMessage: "删除测试 session",
      lastAgentMessage: "用于验证删除接口",
      cwd: "/tmp/project-beta",
    });
    await writeCodexStateFixture({
      codexHome: workspace.codexHome,
      threads: [
        {
          id: "019d-api-rename",
          rolloutPath: apiRolloutPath,
          cwd: "/tmp/project-alpha",
          title: "Old API title",
        },
        {
          id: "019d-api-delete",
          rolloutPath: deleteRolloutPath,
          cwd: "/tmp/project-beta",
          title: "Delete me",
        },
      ],
    });

    const app = await buildApiServer({ manager, operator: "api-test" });
    cleanup.push(async () => {
      await app.close();
    });

    const health = await app.inject({
      method: "GET",
      url: "/api/v1/health",
    });
    expect(health.statusCode).toBe(200);
    expect(health.json().ok).toBe(true);

    const sessions = await app.inject({
      method: "GET",
      url: "/api/v1/sessions",
    });
    expect(sessions.statusCode).toBe(200);
    expect(sessions.json().total).toBe(2);
    expect(sessions.json().workspaces).toHaveLength(2);

    const renamed = await app.inject({
      method: "POST",
      url: "/api/v1/sessions/019d-api-rename/rename",
      payload: {
        name: "Manual API title",
      },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().name).toBe("Manual API title");
    expect(renamed.json().written).toBe(true);

    const stateDb = await import("@codex-keeper/core").then((module) =>
      module.readCodexThreadStateSnapshot(workspace.codexHome),
    );
    expect(stateDb.get("019d-api-rename")?.title).toBe("Old API title");

    const renamedIndex = await readSessionIndex(
      path.join(workspace.codexHome, "session_index.jsonl"),
    );
    expect(renamedIndex.latestByThreadId.get("019d-api-rename")?.threadName).toBe(
      "Manual API title",
    );

    const deleted = await app.inject({
      method: "DELETE",
      url: "/api/v1/sessions/019d-api-delete",
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().deleted).toBe(true);
    await expect(fs.stat(deleteRolloutPath)).rejects.toMatchObject({ code: "ENOENT" });

    const sessionIndex = await readSessionIndex(
      path.join(workspace.codexHome, "session_index.jsonl"),
    );
    expect(sessionIndex.latestByThreadId.has("019d-api-delete")).toBe(false);
  });

  it("continues a selected session through Codex resume and refreshes transcript data", async () => {
    const workspace = await createTempWorkspace();
    const rolloutPath = await writeRolloutFixture({
      codexHome: workspace.codexHome,
      threadId: "019d-api-chat",
      userMessage: "第一轮",
      lastAgentMessage: "第一轮回复",
    });

    const turnRunner: CodexTurnRunner = async (request) => {
      expect(request.codexHome).toBe(workspace.codexHome);
      expect(request.threadId).toBe("019d-api-chat");
      expect(request.prompt).toBe("继续这个会话");
      await fs.appendFile(
        rolloutPath,
        [
          JSON.stringify({
            timestamp: "2026-04-04T12:11:00.000Z",
            type: "response_item",
            payload: {
              type: "message",
              role: "user",
              content: [{ type: "input_text", text: request.prompt }],
            },
          }),
          JSON.stringify({
            timestamp: "2026-04-04T12:11:00.000Z",
            type: "event_msg",
            payload: {
              type: "user_message",
              message: request.prompt,
            },
          }),
          JSON.stringify({
            timestamp: "2026-04-04T12:11:01.000Z",
            type: "response_item",
            payload: {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "第二轮回复" }],
            },
          }),
          JSON.stringify({
            timestamp: "2026-04-04T12:11:02.000Z",
            type: "event_msg",
            payload: {
              type: "task_complete",
              last_agent_message: "第二轮回复",
            },
          }),
          JSON.stringify({
            timestamp: "2026-04-04T12:11:02.000Z",
            type: "task_complete",
            payload: {
              last_agent_message: "第二轮回复",
            },
          }),
          "",
        ].join("\n"),
        "utf8",
      );
      return {
        exitCode: 0,
        stdout: "",
        stderr: "",
      };
    };

    const manager = await createManagerForTest({
      codexHome: workspace.codexHome,
      stateDir: workspace.stateDir,
      turnRunner,
    });
    cleanup.push(async () => manager.close());

    const app = await buildApiServer({ manager, operator: "api-test" });
    cleanup.push(async () => {
      await app.close();
    });

    const sent = await app.inject({
      method: "POST",
      url: "/api/v1/sessions/019d-api-chat/messages",
      payload: {
        message: "继续这个会话",
      },
    });
    expect(sent.statusCode).toBe(200);
    expect(sent.json().threadId).toBe("019d-api-chat");
    expect(sent.json().exitCode).toBe(0);

    const transcript = await app.inject({
      method: "GET",
      url: "/api/v1/sessions/019d-api-chat/transcript",
    });
    expect(transcript.statusCode).toBe(200);
    const contents = transcript.json().items.map((item: { content: string }) => item.content);
    expect(contents).toContain("继续这个会话");
    expect(contents).toContain("第二轮回复");

    const events = await app.inject({
      method: "GET",
      url: "/api/v1/events/since?cursor=0",
    });
    expect(events.statusCode).toBe(200);
    expect(events.json().items.map((item: { type: string }) => item.type)).toContain(
      "session.turn.completed",
    );
  });
});
