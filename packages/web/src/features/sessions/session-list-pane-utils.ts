import type { SessionSummary } from "../../types.js";

export type WorkspaceSessionGroup = {
  workspaceId: string;
  workspaceLabel: string;
  sessions: SessionSummary[];
};

export function groupSessionsByWorkspace(sessions: SessionSummary[]): WorkspaceSessionGroup[] {
  const groups = new Map<string, WorkspaceSessionGroup>();
  for (const session of sessions) {
    const existing = groups.get(session.workspaceId);
    if (existing) {
      existing.sessions.push(session);
      continue;
    }
    groups.set(session.workspaceId, {
      workspaceId: session.workspaceId,
      workspaceLabel: session.workspaceLabel,
      sessions: [session],
    });
  }

  return [...groups.values()].sort((left, right) => {
    const leftLatest = left.sessions[0]?.updatedAt ?? "";
    const rightLatest = right.sessions[0]?.updatedAt ?? "";
    return rightLatest.localeCompare(leftLatest);
  });
}

export function collapseAllWorkspaceIds(workspaceIds: readonly string[]): Set<string> {
  return new Set(workspaceIds);
}

export function pruneCollapsedWorkspaceIds(
  workspaceIds: readonly string[],
  collapsedWorkspaceIds: ReadonlySet<string>,
): ReadonlySet<string> {
  const validWorkspaceIds = new Set(workspaceIds);
  for (const workspaceId of collapsedWorkspaceIds) {
    if (!validWorkspaceIds.has(workspaceId)) {
      return new Set(
        [...collapsedWorkspaceIds].filter((candidateWorkspaceId) =>
          validWorkspaceIds.has(candidateWorkspaceId),
        ),
      );
    }
  }
  return collapsedWorkspaceIds;
}

export function getWorkspaceBulkActionState(
  workspaceIds: readonly string[],
  collapsedWorkspaceIds: ReadonlySet<string>,
): {
  canCollapseAll: boolean;
  canExpandAll: boolean;
} {
  const collapsedCount = workspaceIds.filter((workspaceId) =>
    collapsedWorkspaceIds.has(workspaceId),
  ).length;
  return {
    canCollapseAll: workspaceIds.length > 0 && collapsedCount < workspaceIds.length,
    canExpandAll: collapsedCount > 0,
  };
}
