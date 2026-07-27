import { useEffect } from "react";

import { useControlDeckActions } from "./actions/useControlDeckActions.js";
import {
  ALL_WORKSPACES_ID,
  liveRefreshResourcesForTab,
  panelResourcesForTab,
} from "./control-deck-model.js";
import { useControlDeckUiState } from "./state/useControlDeckUiState.js";
import { useControlDeckResources } from "./useControlDeckResources.js";

export function useControlDeckState() {
  const ui = useControlDeckUiState();

  const setFailure = (nextError: unknown) => {
    const message = nextError instanceof Error ? nextError.message : "Unknown error";
    ui.setError(message);
    ui.setNotice({
      tone: "error",
      text: message,
    });
  };

  const resources = useControlDeckResources({
    tab: ui.tab,
    search: ui.search,
    selectedWorkspaceId: ui.selectedWorkspaceId,
    selectedId: ui.selectedId,
    onSelectSession: ui.setSelectedId,
    onSelectWorkspace: ui.setSelectedWorkspaceId,
    onFailure: setFailure,
  });
  const refreshCurrentView = resources.refreshCurrentView;

  useEffect(() => {
    if (!ui.error) {
      return;
    }

    const timer = window.setInterval(() => {
      refreshCurrentView();
    }, 3_000);

    return () => {
      window.clearInterval(timer);
    };
  }, [refreshCurrentView, ui.error]);

  const actionState = useControlDeckActions({
    resources: {
      detail: resources.detail,
      patchSelectedSession: resources.patchSelectedSession,
      removeSession: resources.removeSession,
    },
    ui: {
      setError: ui.setError,
      setNotice: ui.setNotice,
    },
  });

  return {
    tab: ui.tab,
    setTab: ui.setTab,
    sessions: resources.sessions,
    workspaces: resources.workspaces,
    selectedWorkspaceId: ui.selectedWorkspaceId,
    setSelectedWorkspaceId: ui.setSelectedWorkspaceId,
    selectedId: ui.selectedId,
    setSelectedId: ui.setSelectedId,
    detail: resources.detail,
    configView: resources.configView,
    search: ui.search,
    setSearch: ui.setSearch,
    loadingSessions: resources.loadingSessions,
    loadingDetail: resources.loadingDetail,
    actioning: actionState.actioning,
    actionLabel: actionState.actionLabel,
    error: ui.error,
    notice: ui.notice,
    setNotice: ui.setNotice,
    lastSyncAt: resources.lastSyncAt,
    selectedSummary: resources.selectedSummary,
    transcriptRefreshToken: resources.transcriptRefreshToken,
    refreshSessions: resources.refreshSessions,
    refreshCurrentView: resources.refreshCurrentView,
    actions: actionState.actions,
  };
}

export { ALL_WORKSPACES_ID, liveRefreshResourcesForTab, panelResourcesForTab };
