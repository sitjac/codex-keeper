import type { ApiEventRecord } from "@codex-keeper/shared";
import { useCallback, useEffect, useRef } from "react";
import type { DataResource, TabId } from "./control-deck-model.js";
import { mergeResources, panelResourcesForTab } from "./control-deck-model.js";
import { useConfigResourceStore } from "./resources/useConfigResourceStore.js";
import { useRefreshCoordinator } from "./resources/useRefreshCoordinator.js";
import { useSessionResourceStore } from "./resources/useSessionResourceStore.js";

type UseControlDeckResourcesOptions = {
  tab: TabId;
  search: string;
  selectedWorkspaceId: string;
  selectedId?: string;
  onSelectSession: (threadId?: string) => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onFailure: (error: unknown) => void;
};

export function useControlDeckResources(options: UseControlDeckResourcesOptions) {
  const {
    tab,
    search,
    selectedWorkspaceId,
    selectedId,
    onSelectSession,
    onSelectWorkspace,
    onFailure,
  } = options;
  const eventCursorRef = useRef(0);
  const latestUiStateRef = useRef({
    tab,
    selectedId,
  });
  const latestCallbacksRef = useRef({
    onFailure,
  });

  latestUiStateRef.current = {
    tab,
    selectedId,
  };
  latestCallbacksRef.current = {
    onFailure,
  };
  const reportFailure = useCallback((error: unknown) => {
    latestCallbacksRef.current.onFailure(error);
  }, []);

  const sessions = useSessionResourceStore({
    tab,
    search,
    selectedWorkspaceId,
    selectedId,
    onSelectSession,
    onSelectWorkspace,
    onFailure,
  });
  const config = useConfigResourceStore({
    onFailure,
  });
  const {
    sessions: sessionItems,
    setSessions,
    workspaces,
    detail,
    setDetail,
    loadingSessions,
    loadingDetail,
    lastSyncAt,
    selectedSummary,
    patchSelectedSession,
    removeSession,
    refreshSessions,
    refreshDetail,
    setLastSyncAt,
  } = sessions;
  const { configView, setConfigView, refreshConfigView } = config;

  const loadResources = useCallback(
    async (resources: readonly DataResource[]) => {
      const tasks: Array<Promise<void>> = [];

      if (resources.includes("sessions")) {
        tasks.push(refreshSessions());
      }
      if (resources.includes("config")) {
        tasks.push(refreshConfigView());
      }
      if (tasks.length === 0) {
        return;
      }

      await Promise.all(tasks);
    },
    [refreshConfigView, refreshSessions],
  );

  useEffect(() => {
    let active = true;
    void refreshConfigView()
      .then(() => {
        if (active) {
          setLastSyncAt((previous) => previous ?? new Date().toISOString());
        }
      })
      .catch((error) => {
        if (active) {
          reportFailure(error);
        }
      });
    return () => {
      active = false;
    };
  }, [refreshConfigView, reportFailure, setLastSyncAt]);

  const refreshCurrentView = useCallback(
    (refreshOptions?: { threadId?: string }) => {
      const nextThreadId = refreshOptions?.threadId ?? latestUiStateRef.current.selectedId;
      const tasks: Array<Promise<unknown>> = [refreshSessions()];
      if (nextThreadId) {
        tasks.push(refreshDetail(nextThreadId));
      }
      void Promise.all(tasks).catch(() => undefined);
    },
    [refreshDetail, refreshSessions],
  );

  const refreshForEvents = useCallback(
    (events: ApiEventRecord[]) => {
      const nextThreadId = latestUiStateRef.current.selectedId;
      const shouldRefreshSessions = events.some((event) =>
        [
          "scan.completed",
          "session.renamed",
          "session.deleted",
          "session.index.compacted",
        ].includes(event.type),
      );
      const shouldRefreshDetail =
        nextThreadId !== undefined &&
        events.some((event) => {
          if (event.type === "scan.completed") {
            return true;
          }
          return (
            typeof event.payload.threadId === "string" && event.payload.threadId === nextThreadId
          );
        });
      const tasks: Array<Promise<unknown>> = [];
      if (shouldRefreshSessions) {
        tasks.push(refreshSessions());
      }
      if (shouldRefreshDetail && nextThreadId) {
        tasks.push(refreshDetail(nextThreadId));
      }
      if (tasks.length > 0) {
        void Promise.all(tasks).catch(() => undefined);
      }
    },
    [refreshDetail, refreshSessions],
  );

  useRefreshCoordinator({
    tab,
    eventCursorRef,
    refreshForEvents,
    refreshFallback: () => {
      refreshCurrentView();
    },
  });

  return {
    sessions: sessionItems,
    setSessions,
    workspaces,
    detail,
    setDetail,
    configView,
    setConfigView,
    loadingSessions,
    loadingDetail,
    lastSyncAt,
    selectedSummary,
    patchSelectedSession,
    removeSession,
    refreshCurrentView,
    refreshForEvents,
    refreshSessions,
    loadResources,
    mergeCurrentTabResources: (...groups: readonly DataResource[][]) =>
      mergeResources(...groups, panelResourcesForTab(latestUiStateRef.current.tab)),
  };
}
