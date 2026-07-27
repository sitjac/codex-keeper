import * as React from "react";
import { TopNoticeBanner } from "./app-shell/TopNoticeBanner.js";
import { usePaneLayoutState } from "./app-shell/usePaneLayoutState.js";
import { useThemeMode } from "./app-shell/useThemeMode.js";
import { copyTextToClipboard } from "./clipboard.js";
import { normalizeUiLanguage, t } from "./i18n.js";
import { SessionBrowser } from "./SessionBrowser.js";
import { ALL_WORKSPACES_ID, useControlDeckState } from "./useControlDeckState.js";

export function App() {
  const state = useControlDeckState();
  const paneLayout = usePaneLayoutState({
    tab: state.tab,
    selectedId: state.selectedId,
  });
  const theme = useThemeMode();
  const uiLanguage = normalizeUiLanguage(state.configView);

  React.useEffect(() => {
    document.documentElement.lang = uiLanguage;
  }, [uiLanguage]);

  React.useEffect(() => {
    if (state.selectedWorkspaceId !== ALL_WORKSPACES_ID) {
      state.setSelectedWorkspaceId(ALL_WORKSPACES_ID);
    }
  }, [state.selectedWorkspaceId, state.setSelectedWorkspaceId]);

  const handleCopySessionId = React.useCallback(
    async (threadId: string) => {
      try {
        await copyTextToClipboard(threadId);
        state.setNotice({
          tone: "success",
          text: t(uiLanguage, "copiedSessionId"),
        });
      } catch {
        state.setNotice({
          tone: "error",
          text: t(uiLanguage, "copySessionIdFailed"),
        });
      }
    },
    [state, uiLanguage],
  );

  return (
    <div
      id="app"
      className={
        paneLayout.sessionFocusMode ? "session-focus-mode simple-reader-app" : "simple-reader-app"
      }
      style={
        {
          "--session-list-width": `${paneLayout.sessionPaneCollapsed ? 0 : paneLayout.sessionPaneWidth}px`,
        } as React.CSSProperties
      }
    >
      <main id="content">
        <TopNoticeBanner notice={state.notice} />

        <SessionBrowser
          actionLabel={state.actionLabel}
          actioning={state.actioning}
          detail={state.detail}
          error={state.error}
          focusMode={paneLayout.sessionFocusMode}
          loadingDetail={state.loadingDetail}
          loadingSessions={state.loadingSessions}
          onCopySessionId={(threadId) => void handleCopySessionId(threadId)}
          onDeleteSession={(threadId) => state.actions.delete(threadId)}
          onConversationSettled={() => state.refreshCurrentView()}
          onExitFocusMode={() => paneLayout.setSessionFocusMode(false)}
          onRefresh={() => void state.refreshCurrentView()}
          onRename={(name) => state.actions.rename(name)}
          onSearchChange={state.setSearch}
          onSelectSession={(threadId) => state.setSelectedId(threadId)}
          onSessionPaneWidthChange={paneLayout.handleSessionPaneWidthChange}
          onStartSessionResize={paneLayout.startSessionResize}
          onToggleThemeMode={theme.toggleThemeMode}
          search={state.search}
          selectedId={state.selectedId}
          sessionPaneCollapsed={paneLayout.sessionPaneCollapsed}
          sessionPaneWidth={paneLayout.sessionPaneWidth}
          sessions={state.sessions}
          themeMode={theme.themeMode}
          transcriptRefreshToken={state.transcriptRefreshToken}
          uiLanguage={uiLanguage}
        />
      </main>
    </div>
  );
}
