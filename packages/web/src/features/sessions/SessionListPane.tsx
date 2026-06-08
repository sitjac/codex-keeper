import * as React from "react";

import { sessionListTitle } from "../../browser-utils.js";
import type { UiLanguage } from "../../i18n.js";
import { t } from "../../i18n.js";
import type { SessionSummary } from "../../types.js";
import { addAppTransitionType } from "../../view-transitions.js";
import {
  collapseAllWorkspaceIds,
  getWorkspaceBulkActionState,
  groupSessionsByWorkspace,
  pruneCollapsedWorkspaceIds,
} from "./session-list-pane-utils.js";

const SESSION_CONTEXT_MENU_WIDTH = 220;
const SESSION_CONTEXT_MENU_HEIGHT = 104;
const SESSION_CONTEXT_MENU_MARGIN = 12;

export function SessionListPane(props: {
  sessions: SessionSummary[];
  search: string;
  selectedId?: string;
  sessionPaneCollapsed: boolean;
  loadingSessions: boolean;
  error: string | null;
  uiLanguage: UiLanguage;
  onSearchChange: (value: string) => void;
  onRefresh: () => void;
  onSelectSession: (threadId: string) => void;
  onCopySessionId: (threadId: string) => void | Promise<void>;
  onDeleteSession: (threadId: string) => boolean | Promise<boolean>;
}) {
  const [contextMenu, setContextMenu] = React.useState<{
    threadId: string;
    x: number;
    y: number;
  } | null>(null);
  const [searchDraft, setSearchDraft] = React.useState(props.search);
  const [collapsedWorkspaceIds, setCollapsedWorkspaceIds] = React.useState<Set<string>>(
    () => new Set(),
  );
  const contextMenuRef = React.useRef<HTMLDivElement | null>(null);
  const contextMenuActionRef = React.useRef<HTMLButtonElement | null>(null);
  const searchCommitTimerRef = React.useRef<number | null>(null);
  const searchComposingRef = React.useRef(false);
  const workspaceGroups = React.useMemo(
    () => groupSessionsByWorkspace(props.sessions),
    [props.sessions],
  );
  const workspaceIds = React.useMemo(
    () => workspaceGroups.map((workspace) => workspace.workspaceId),
    [workspaceGroups],
  );
  const tt = React.useCallback(
    (key: Parameters<typeof t>[1]) => t(props.uiLanguage, key),
    [props.uiLanguage],
  );
  const bulkActionState = React.useMemo(
    () => getWorkspaceBulkActionState(workspaceIds, collapsedWorkspaceIds),
    [collapsedWorkspaceIds, workspaceIds],
  );
  const selectedWorkspaceId = React.useMemo(
    () =>
      props.selectedId
        ? props.sessions.find((session) => session.threadId === props.selectedId)?.workspaceId
        : undefined,
    [props.selectedId, props.sessions],
  );

  React.useEffect(() => {
    setSearchDraft(props.search);
  }, [props.search]);

  React.useEffect(() => {
    setCollapsedWorkspaceIds((previous) => {
      const pruned = pruneCollapsedWorkspaceIds(workspaceIds, previous);
      if (
        pruned.size === previous.size &&
        [...pruned].every((workspaceId) => previous.has(workspaceId))
      ) {
        return previous;
      }
      return new Set(pruned);
    });
  }, [workspaceIds]);

  React.useEffect(() => {
    if (!selectedWorkspaceId) {
      return;
    }
    setCollapsedWorkspaceIds((previous) => {
      if (!previous.has(selectedWorkspaceId)) {
        return previous;
      }
      const next = new Set(previous);
      next.delete(selectedWorkspaceId);
      return next;
    });
  }, [selectedWorkspaceId]);

  React.useEffect(() => {
    return () => {
      if (searchCommitTimerRef.current !== null) {
        window.clearTimeout(searchCommitTimerRef.current);
      }
    };
  }, []);

  React.useEffect(() => {
    if (!contextMenu) {
      return;
    }

    contextMenuActionRef.current?.focus();

    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && contextMenuRef.current?.contains(target)) {
        return;
      }
      setContextMenu(null);
    };
    const close = () => setContextMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    };

    window.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("blur", close);

    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("blur", close);
    };
  }, [contextMenu]);

  const commitSearch = React.useCallback(
    (nextValue: string) => {
      props.onSearchChange(nextValue.trim());
    },
    [props],
  );

  const scheduleSearchCommit = React.useCallback(
    (nextValue: string) => {
      if (searchCommitTimerRef.current !== null) {
        window.clearTimeout(searchCommitTimerRef.current);
      }
      searchCommitTimerRef.current = window.setTimeout(() => {
        searchCommitTimerRef.current = null;
        commitSearch(nextValue);
      }, 300);
    },
    [commitSearch],
  );

  const clearSearch = React.useCallback(() => {
    if (searchCommitTimerRef.current !== null) {
      window.clearTimeout(searchCommitTimerRef.current);
      searchCommitTimerRef.current = null;
    }
    setSearchDraft("");
    commitSearch("");
  }, [commitSearch]);

  const openSessionContextMenu = React.useCallback(
    (threadId: string, x: number, y: number) => {
      if (props.selectedId !== threadId) {
        props.onSelectSession(threadId);
      }
      setContextMenu({ threadId, x, y });
    },
    [props],
  );

  const handleSessionContextMenu = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>, threadId: string) => {
      event.preventDefault();
      openSessionContextMenu(threadId, event.clientX, event.clientY);
    },
    [openSessionContextMenu],
  );

  const handleSessionItemKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, threadId: string) => {
      if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) {
        return;
      }

      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      openSessionContextMenu(threadId, rect.left + Math.min(rect.width - 16, 120), rect.top + 12);
    },
    [openSessionContextMenu],
  );

  const handleDeleteSession = React.useCallback(
    async (threadId: string) => {
      setContextMenu(null);
      if (!window.confirm(tt("deleteSessionConfirm"))) {
        return;
      }
      await props.onDeleteSession(threadId);
    },
    [props, tt],
  );

  const toggleWorkspace = React.useCallback((workspaceId: string) => {
    setCollapsedWorkspaceIds((previous) => {
      const next = new Set(previous);
      if (next.has(workspaceId)) {
        next.delete(workspaceId);
      } else {
        next.add(workspaceId);
      }
      return next;
    });
  }, []);

  const collapseAllWorkspaces = React.useCallback(() => {
    setCollapsedWorkspaceIds(collapseAllWorkspaceIds(workspaceIds));
  }, [workspaceIds]);

  const expandAllWorkspaces = React.useCallback(() => {
    setCollapsedWorkspaceIds(new Set());
  }, []);

  const contextMenuPosition = React.useMemo(() => {
    if (!contextMenu) {
      return undefined;
    }

    const maxX =
      typeof window === "undefined"
        ? contextMenu.x
        : Math.max(
            SESSION_CONTEXT_MENU_MARGIN,
            window.innerWidth - SESSION_CONTEXT_MENU_WIDTH - SESSION_CONTEXT_MENU_MARGIN,
          );
    const maxY =
      typeof window === "undefined"
        ? contextMenu.y
        : Math.max(
            SESSION_CONTEXT_MENU_MARGIN,
            window.innerHeight - SESSION_CONTEXT_MENU_HEIGHT - SESSION_CONTEXT_MENU_MARGIN,
          );

    return {
      left: Math.max(SESSION_CONTEXT_MENU_MARGIN, Math.min(contextMenu.x, maxX)),
      top: Math.max(SESSION_CONTEXT_MENU_MARGIN, Math.min(contextMenu.y, maxY)),
    };
  }, [contextMenu]);

  return (
    <section
      className={props.sessionPaneCollapsed ? "session-list-view collapsed" : "session-list-view"}
      id="session-list-pane"
    >
      <header className="view-header session-list-header">
        <div className="session-list-heading">
          <p className="panel-kicker">{tt("conversationArchive")}</p>
          <h2>{tt("sessions")}</h2>
          <p className="session-list-summary">
            {workspaceGroups.length} {tt("workspaces")} · {props.sessions.length}{" "}
            {tt("sessionCountSuffix")}
          </p>
        </div>
        <div className="header-actions">
          <button
            className="btn-sm"
            disabled={!bulkActionState.canCollapseAll}
            onClick={collapseAllWorkspaces}
            type="button"
          >
            {tt("collapseAllWorkspaces")}
          </button>
          <button
            className="btn-sm"
            disabled={!bulkActionState.canExpandAll}
            onClick={expandAllWorkspaces}
            type="button"
          >
            {tt("expandAllWorkspaces")}
          </button>
          <button
            className="btn-refresh"
            onClick={props.onRefresh}
            title={tt("refresh")}
            type="button"
          >
            &#8635; {tt("refresh")}
          </button>
        </div>
      </header>

      <div className="session-list-toolbar">
        <label className="chat-search" htmlFor="session-list-search">
          <span className="sr-only">{tt("searchSessionsLabel")}</span>
          <input
            id="session-list-search"
            onChange={(event) => {
              const nextValue = event.target.value;
              setSearchDraft(nextValue);
              if (!searchComposingRef.current) {
                scheduleSearchCommit(nextValue);
              }
            }}
            onCompositionEnd={(event) => {
              searchComposingRef.current = false;
              scheduleSearchCommit(event.currentTarget.value);
            }}
            onCompositionStart={() => {
              searchComposingRef.current = true;
              if (searchCommitTimerRef.current !== null) {
                window.clearTimeout(searchCommitTimerRef.current);
                searchCommitTimerRef.current = null;
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (searchCommitTimerRef.current !== null) {
                  window.clearTimeout(searchCommitTimerRef.current);
                  searchCommitTimerRef.current = null;
                }
                commitSearch(searchDraft);
                return;
              }

              if (event.key === "Escape" && searchDraft) {
                event.preventDefault();
                clearSearch();
              }
            }}
            placeholder={tt("filterSessions")}
            type="search"
            value={searchDraft}
          />
        </label>
        {searchDraft ? (
          <button className="btn-sm" onClick={clearSearch} type="button">
            {props.uiLanguage === "zh-CN" ? "清空" : "Clear"}
          </button>
        ) : null}
      </div>

      <div className="session-list">
        {props.loadingSessions ? (
          <div className="loading-state history-empty">{tt("loadingSessions")}</div>
        ) : null}
        {!props.loadingSessions && props.sessions.length === 0 ? (
          <div className="history-empty">{props.error ? tt("apiNotReady") : tt("noSessions")}</div>
        ) : null}
        {workspaceGroups.map((workspace) => (
          <section className="workspace-session-group" key={workspace.workspaceId}>
            <button
              aria-expanded={!collapsedWorkspaceIds.has(workspace.workspaceId)}
              className="workspace-toggle"
              onClick={() => toggleWorkspace(workspace.workspaceId)}
              type="button"
            >
              <span className="workspace-chevron" aria-hidden="true">
                {collapsedWorkspaceIds.has(workspace.workspaceId) ? "›" : "⌄"}
              </span>
              <span className="workspace-group-title">{workspace.workspaceLabel}</span>
              <span className="workspace-group-count">{workspace.sessions.length}</span>
            </button>
            {!collapsedWorkspaceIds.has(workspace.workspaceId) ? (
              <div className="workspace-session-list">
                {workspace.sessions.map((session) => (
                  <div
                    className={
                      props.selectedId === session.threadId ? "session-row active" : "session-row"
                    }
                    key={session.threadId}
                  >
                    <button
                      className="session-row-main"
                      onContextMenu={(event) => handleSessionContextMenu(event, session.threadId)}
                      onClick={() =>
                        React.startTransition(() => {
                          addAppTransitionType("nav-forward");
                          props.onSelectSession(session.threadId);
                        })
                      }
                      onKeyDown={(event) => handleSessionItemKeyDown(event, session.threadId)}
                      title={sessionListTitle(session)}
                      type="button"
                    >
                      <span className="session-row-title">{sessionListTitle(session)}</span>
                    </button>
                    <button
                      aria-label={tt("sessionActions")}
                      className="session-row-menu"
                      onClick={(event) => {
                        const rect = event.currentTarget.getBoundingClientRect();
                        openSessionContextMenu(
                          session.threadId,
                          rect.left + rect.width,
                          rect.top + rect.height,
                        );
                      }}
                      title={tt("sessionActions")}
                      type="button"
                    >
                      <span aria-hidden="true">⋯</span>
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </section>
        ))}
      </div>

      {contextMenu && contextMenuPosition ? (
        <div
          className="session-context-menu"
          ref={contextMenuRef}
          role="menu"
          style={contextMenuPosition}
        >
          <button
            className="session-context-menu-item"
            onClick={() => {
              void props.onCopySessionId(contextMenu.threadId);
              setContextMenu(null);
            }}
            ref={contextMenuActionRef}
            role="menuitem"
            type="button"
          >
            {tt("copySessionId")}
          </button>
          <button
            className="session-context-menu-item danger"
            onClick={() => {
              void handleDeleteSession(contextMenu.threadId);
            }}
            role="menuitem"
            type="button"
          >
            {tt("deleteSession")}
          </button>
        </div>
      ) : null}
    </section>
  );
}
