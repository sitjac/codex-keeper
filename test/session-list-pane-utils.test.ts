import { describe, expect, test } from "vitest";

import {
  collapseAllWorkspaceIds,
  getWorkspaceBulkActionState,
  groupSessionsByWorkspace,
  pruneCollapsedWorkspaceIds,
} from "../packages/web/src/features/sessions/session-list-pane-utils.js";

describe("session-list-pane-utils", () => {
  test("groups sessions by workspace and keeps newest workspace first", () => {
    const groups = groupSessionsByWorkspace([
      {
        threadId: "thread-b-1",
        workspaceId: "workspace-b",
        workspaceLabel: "Workspace B",
        updatedAt: "2026-06-08T10:00:00.000Z",
        dirty: false,
        taskCompleteCount: 0,
      },
      {
        threadId: "thread-a-1",
        workspaceId: "workspace-a",
        workspaceLabel: "Workspace A",
        updatedAt: "2026-06-08T11:00:00.000Z",
        dirty: false,
        taskCompleteCount: 0,
      },
      {
        threadId: "thread-a-2",
        workspaceId: "workspace-a",
        workspaceLabel: "Workspace A",
        updatedAt: "2026-06-08T09:00:00.000Z",
        dirty: false,
        taskCompleteCount: 0,
      },
    ]);

    expect(groups.map((group) => group.workspaceId)).toEqual(["workspace-a", "workspace-b"]);
    expect(groups[0]?.sessions.map((session) => session.threadId)).toEqual([
      "thread-a-1",
      "thread-a-2",
    ]);
  });

  test("prunes collapsed workspace ids that are no longer present", () => {
    const collapsedWorkspaceIds = new Set(["workspace-a", "workspace-z"]);
    const next = pruneCollapsedWorkspaceIds(["workspace-a", "workspace-b"], collapsedWorkspaceIds);

    expect([...next]).toEqual(["workspace-a"]);
  });

  test("returns the same collapsed set when all ids are still visible", () => {
    const collapsedWorkspaceIds = new Set(["workspace-a"]);
    const next = pruneCollapsedWorkspaceIds(["workspace-a", "workspace-b"], collapsedWorkspaceIds);

    expect(next).toBe(collapsedWorkspaceIds);
  });

  test("computes bulk collapse and expand availability", () => {
    const workspaceIds = ["workspace-a", "workspace-b"];

    expect(getWorkspaceBulkActionState(workspaceIds, new Set())).toEqual({
      canCollapseAll: true,
      canExpandAll: false,
    });
    expect(
      getWorkspaceBulkActionState(workspaceIds, collapseAllWorkspaceIds(workspaceIds)),
    ).toEqual({
      canCollapseAll: false,
      canExpandAll: true,
    });
  });
});
