import type { ApiEventRecord } from "@codex-keeper/shared";

export type TabId = "sessions";
export type UiNotice = {
  tone: "info" | "success" | "error";
  text: string;
};

export type DataResource = "sessions" | "config";

export const ALL_WORKSPACES_ID = "__all_workspaces__";
const SESSION_SEARCH_IN_URL = true;

export type UrlUiState = {
  tab: TabId;
  search: string;
  selectedWorkspaceId: string;
  selectedId?: string;
};

export function readUiStateFromUrl(): UrlUiState {
  const params = new URLSearchParams(window.location.search);
  const workspace = params.get("workspace");
  return {
    tab: "sessions",
    search: params.get("q") ?? "",
    selectedWorkspaceId:
      workspace && workspace !== ALL_WORKSPACES_ID ? workspace : ALL_WORKSPACES_ID,
    selectedId: params.get("session") ?? undefined,
  };
}

export function writeUiStateToUrl(state: UrlUiState): void {
  const params = new URLSearchParams(window.location.search);
  params.delete("tab");

  if (!SESSION_SEARCH_IN_URL || !state.search) {
    params.delete("q");
  } else {
    params.set("q", state.search);
  }

  if (state.selectedWorkspaceId === ALL_WORKSPACES_ID) {
    params.delete("workspace");
  } else {
    params.set("workspace", state.selectedWorkspaceId);
  }

  if (!state.selectedId) {
    params.delete("session");
  } else {
    params.set("session", state.selectedId);
  }

  params.delete("hidden");
  params.delete("requestLog");

  const nextSearch = params.toString();
  const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl !== currentUrl) {
    window.history.replaceState(window.history.state, "", nextUrl);
  }
}

export function panelResourcesForTab(_tab: TabId): DataResource[] {
  return [];
}

export function liveRefreshResourcesForTab(_tab: TabId): DataResource[] {
  return ["sessions"];
}

export function eventRefreshResourcesForTab(
  _tab: TabId,
  events: readonly Pick<ApiEventRecord, "type">[],
): DataResource[] {
  return events.some((event) =>
    [
      "scan.completed",
      "session.renamed",
      "session.deleted",
      "session.index.compacted",
      "session.turn.completed",
      "session.turn.failed",
    ].includes(event.type),
  )
    ? ["sessions"]
    : [];
}

export function mergeResources(...resourceGroups: readonly DataResource[][]): DataResource[] {
  const merged = new Set<DataResource>();
  for (const group of resourceGroups) {
    for (const resource of group) {
      merged.add(resource);
    }
  }
  return [...merged];
}
