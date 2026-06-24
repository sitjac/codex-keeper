import fs from "node:fs/promises";
import path from "node:path";
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
});
