import fs from "node:fs/promises";
import { readCodexThreadStateSnapshot } from "@codex-keeper/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createManagerForTest,
  createTempWorkspace,
  writeCodexStateFixture,
  writeRolloutFixture,
} from "./helpers.js";

describe("manager scan coalescing", () => {
  const managers: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    for (const manager of managers) {
      await manager.close();
    }
    managers.length = 0;
    vi.restoreAllMocks();
  });

  it("reuses the in-flight scan and the short-lived cached result", async () => {
    const workspace = await createTempWorkspace();
    const manager = await createManagerForTest({
      codexHome: workspace.codexHome,
      stateDir: workspace.stateDir,
    });
    managers.push(manager);

    let resolveScan:
      | ((value: { scannedRollouts: number; updatedSessions: number }) => void)
      | undefined;
    const deferredScan = new Promise<{ scannedRollouts: number; updatedSessions: number }>(
      (resolve) => {
        resolveScan = resolve;
      },
    );
    const performScanSpy = vi
      .spyOn(manager as never, "performScan")
      .mockReturnValue(deferredScan as never);

    const first = manager.scan();
    const second = manager.scan();
    expect(performScanSpy).toHaveBeenCalledTimes(1);

    resolveScan?.({
      scannedRollouts: 12,
      updatedSessions: 3,
    });

    await expect(first).resolves.toEqual({
      scannedRollouts: 12,
      updatedSessions: 3,
    });
    await expect(second).resolves.toEqual({
      scannedRollouts: 12,
      updatedSessions: 3,
    });

    await expect(manager.scan()).resolves.toEqual({
      scannedRollouts: 12,
      updatedSessions: 3,
    });
    expect(performScanSpy).toHaveBeenCalledTimes(1);
  });

  it("uses the indexed session for detail, transcript, rename, and delete operations", async () => {
    const workspace = await createTempWorkspace();
    const manager = await createManagerForTest({
      codexHome: workspace.codexHome,
      stateDir: workspace.stateDir,
    });
    managers.push(manager);

    await writeRolloutFixture({
      codexHome: workspace.codexHome,
      threadId: "thread-known-fast-path",
      userMessage: "加载这个 session",
      lastAgentMessage: "这是已经扫描过的 session",
      threadName: "Known fast path",
    });

    await manager.scan();
    const performScanSpy = vi
      .spyOn(manager as never, "performScan")
      .mockRejectedValue(new Error("unexpected full scan") as never);

    await expect(manager.getSessionDetail("thread-known-fast-path")).resolves.toMatchObject({
      threadId: "thread-known-fast-path",
    });
    await expect(
      manager.getSessionTranscriptPage("thread-known-fast-path", { page: 1, pageSize: 2 }),
    ).resolves.toMatchObject({
      page: 1,
      pageSize: 2,
    });
    const readFileSpy = vi.spyOn(fs, "readFile");
    await expect(manager.rename("thread-known-fast-path", "Renamed fast path")).resolves.toEqual({
      written: true,
      name: "Renamed fast path",
    });
    expect(readFileSpy).not.toHaveBeenCalled();
    await expect(manager.deleteSession("thread-known-fast-path")).resolves.toMatchObject({
      threadId: "thread-known-fast-path",
      deleted: true,
    });
    expect(performScanSpy).not.toHaveBeenCalled();
  });

  it("reuses persisted rollout titles without rereading unchanged rollout files", async () => {
    const workspace = await createTempWorkspace();
    const firstManager = await createManagerForTest({
      codexHome: workspace.codexHome,
      stateDir: workspace.stateDir,
    });
    managers.push(firstManager);

    const rolloutPath = await writeRolloutFixture({
      codexHome: workspace.codexHome,
      threadId: "thread-persisted-rollout-title",
      userMessage: "缓存 rollout 标题",
      lastAgentMessage: "标题应从本地状态复用。",
      threadName: "Persisted rollout title",
    });

    await firstManager.scan();
    firstManager.db.updateOfficialName(
      "thread-persisted-rollout-title",
      "Stale cached title",
      "2026-04-04T12:30:00.000Z",
    );
    await firstManager.close();
    managers.pop();

    const manager = await createManagerForTest({
      codexHome: workspace.codexHome,
      stateDir: workspace.stateDir,
    });
    managers.push(manager);

    const originalReadFile = fs.readFile;
    vi.spyOn(fs, "readFile").mockImplementation(((file, ...args) => {
      if (file === rolloutPath) {
        throw new Error("unexpected rollout reread");
      }
      return originalReadFile(file, ...args);
    }) as typeof fs.readFile);

    await manager.scan();

    await expect(manager.getSessionDetail("thread-persisted-rollout-title")).resolves.toMatchObject(
      {
        officialName: "Persisted rollout title",
      },
    );
  });

  it("reuses cached transcript parsing across pages until the rollout changes", async () => {
    const workspace = await createTempWorkspace();
    const manager = await createManagerForTest({
      codexHome: workspace.codexHome,
      stateDir: workspace.stateDir,
    });
    managers.push(manager);

    await writeRolloutFixture({
      codexHome: workspace.codexHome,
      threadId: "thread-transcript-cache",
      userMessage: "第一页内容",
      lastAgentMessage: "第二页内容",
      toolCallName: "shell_command",
      toolCallArguments: {
        command: "pwd",
      },
      toolCallOutput: "/tmp/project-alpha",
    });

    await manager.scan();
    const readFileSpy = vi.spyOn(fs, "readFile");

    await manager.getSessionTranscriptPage("thread-transcript-cache", { page: 1, pageSize: 2 });
    await manager.getSessionTranscriptPage("thread-transcript-cache", { page: 2, pageSize: 2 });

    expect(readFileSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps default rename writes synchronous for Codex state", async () => {
    const workspace = await createTempWorkspace();
    const manager = await createManagerForTest({
      codexHome: workspace.codexHome,
      stateDir: workspace.stateDir,
    });
    managers.push(manager);

    const rolloutPath = await writeRolloutFixture({
      codexHome: workspace.codexHome,
      threadId: "thread-sync-rename",
      userMessage: "同步改名",
      lastAgentMessage: "同步写回 state",
      threadName: "Old sync title",
    });
    await writeCodexStateFixture({
      codexHome: workspace.codexHome,
      threads: [
        {
          id: "thread-sync-rename",
          rolloutPath,
          cwd: "/tmp/project-alpha",
          title: "Old sync title",
        },
      ],
    });

    await manager.scan();
    await manager.rename("thread-sync-rename", "New sync title");

    const snapshot = await readCodexThreadStateSnapshot(workspace.codexHome);
    expect(snapshot.get("thread-sync-rename")?.title).toBe("New sync title");
  });
});
