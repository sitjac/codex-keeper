import type { ConfigView } from "./types.js";

export type UiLanguage = "en-US" | "zh-CN";

const COPY = {
  "en-US": {
    sessions: "Sessions",
    workspaces: "Workspaces",
    collapseAllWorkspaces: "Collapse all",
    expandAllWorkspaces: "Expand all",
    refresh: "Refresh",
    copySessionId: "Copy session ID",
    copyMessage: "Copy",
    copyMarkdownMessage: "Copy markdown",
    copyCodeBlock: "Copy code",
    copyBlock: "Copy block",
    sessionActions: "Session actions",
    copiedSessionId: "Copied session ID.",
    copySessionIdFailed: "Failed to copy session ID.",
    copiedMessage: "Copied",
    copyMessageFailed: "Copy failed",
    deleteSession: "Delete session",
    deleteSessionConfirm: "Delete this session? This removes it from Codex resume history.",
    conversationArchive: "Conversation Archive",
    sessionCountSuffix: "sessions",
    showSessions: "Show Sessions",
    switchToLightMode: "Switch to light mode",
    switchToDarkMode: "Switch to dark mode",
    back: "Back",
    searchSessionsLabel: "Search sessions",
    filterSessions: "Filter sessions...",
    loadingSessions: "Loading sessions...",
    apiNotReady: "API not ready yet. The dashboard will retry automatically.",
    noSessions: "No sessions matched the current filter.",
    selectedSession: "Selected Session",
    renameSession: "Rename session",
    sessionNameInput: "Session title",
    saveRename: "Save",
    cancelRename: "Cancel",
    renaming: "Renaming...",
    loadingSessionDetail: "Loading session detail...",
    selectSessionHint: "Select a session to inspect its transcript.",
    loading: "Loading...",
    loadEarlierMessages: "Load earlier messages",
    noTranscript: "No transcript events matched the current filters.",
    messageInputLabel: "Message",
    messageInputPlaceholder: "Continue this Codex session...",
    sendMessage: "Send",
    sendingMessage: "Sending...",
    resizeSessionList: "Resize session list",
    today: "Today",
    yesterday: "Yesterday",
    thisWeek: "This Week",
    thisMonth: "This Month",
    earlier: "Earlier",
    nA: "n/a",
  },
  "zh-CN": {
    sessions: "会话",
    workspaces: "工作区",
    collapseAllWorkspaces: "全部折叠",
    expandAllWorkspaces: "全部展开",
    refresh: "刷新",
    copySessionId: "复制会话 ID",
    copyMessage: "复制",
    copyMarkdownMessage: "复制 Markdown",
    copyCodeBlock: "复制代码",
    copyBlock: "复制块",
    sessionActions: "会话操作",
    copiedSessionId: "已复制会话 ID。",
    copySessionIdFailed: "复制会话 ID 失败。",
    copiedMessage: "已复制",
    copyMessageFailed: "复制失败",
    deleteSession: "删除会话",
    deleteSessionConfirm: "删除这个会话？它会从 Codex resume 历史中移除。",
    conversationArchive: "会话归档",
    sessionCountSuffix: "个会话",
    showSessions: "显示会话",
    switchToLightMode: "切换到白天模式",
    switchToDarkMode: "切换到黑暗模式",
    back: "返回",
    searchSessionsLabel: "搜索会话",
    filterSessions: "筛选会话...",
    loadingSessions: "正在加载会话...",
    apiNotReady: "API 还没有就绪，面板会自动重试。",
    noSessions: "当前筛选条件下没有匹配会话。",
    selectedSession: "当前会话",
    renameSession: "重命名会话",
    sessionNameInput: "会话标题",
    saveRename: "保存",
    cancelRename: "取消",
    renaming: "重命名中...",
    loadingSessionDetail: "正在加载会话详情...",
    selectSessionHint: "选择一个会话以查看 transcript。",
    loading: "加载中...",
    loadEarlierMessages: "加载更早消息",
    noTranscript: "当前筛选条件下没有匹配的 transcript 事件。",
    messageInputLabel: "消息",
    messageInputPlaceholder: "继续这个 Codex 会话...",
    sendMessage: "发送",
    sendingMessage: "发送中...",
    resizeSessionList: "调整会话列表宽度",
    today: "今天",
    yesterday: "昨天",
    thisWeek: "本周",
    thisMonth: "本月",
    earlier: "更早",
    nA: "无",
  },
} as const;

export function normalizeUiLanguage(configView?: ConfigView | null): UiLanguage {
  const raw = (configView?.effectiveConfig as Record<string, unknown> | undefined)?.general as
    | Record<string, unknown>
    | undefined;
  return raw?.uiLanguage === "zh-CN" ? "zh-CN" : "en-US";
}

export function t(language: UiLanguage, key: keyof (typeof COPY)["en-US"]): string {
  return COPY[language][key];
}

export function formatUiWhen(value: string | undefined | null, language: UiLanguage): string {
  if (!value) {
    return t(language, "nA");
  }
  return new Date(value).toLocaleString(language, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function transcriptRoleLabel(role: string, language: UiLanguage): string {
  const map =
    language === "zh-CN"
      ? { all: "全部", user: "用户", assistant: "助手", tool: "工具", system: "系统" }
      : { all: "all", user: "user", assistant: "assistant", tool: "tool", system: "system" };
  return map[role as keyof typeof map] ?? role;
}

export function timeGroupLabel(label: string, language: UiLanguage): string {
  const map =
    language === "zh-CN"
      ? {
          Today: COPY["zh-CN"].today,
          Yesterday: COPY["zh-CN"].yesterday,
          "This Week": COPY["zh-CN"].thisWeek,
          "This Month": COPY["zh-CN"].thisMonth,
          Earlier: COPY["zh-CN"].earlier,
        }
      : {
          Today: COPY["en-US"].today,
          Yesterday: COPY["en-US"].yesterday,
          "This Week": COPY["en-US"].thisWeek,
          "This Month": COPY["en-US"].thisMonth,
          Earlier: COPY["en-US"].earlier,
        };
  return map[label as keyof typeof map] ?? label;
}
