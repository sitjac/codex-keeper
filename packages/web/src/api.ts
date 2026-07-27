import type {
  ApiEventsResponse,
  ConfigView,
  RenameApplyResponse,
  SessionDeleteResult,
  SessionDetail,
  SessionMessageResponse,
  SessionsResponse,
  SessionTranscriptPage,
} from "./types.js";

const inflightJsonRequests = new Map<string, Promise<unknown>>();

async function requestJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  const url = typeof input === "string" ? input : input.url;
  const dedupeKey = method === "GET" ? `${method}:${url}` : null;

  if (dedupeKey) {
    const existing = inflightJsonRequests.get(dedupeKey) as Promise<T> | undefined;
    if (existing) {
      return existing;
    }
  }

  const requestPromise = (async () => {
    const headers = new Headers(init?.headers);
    if (init?.body !== undefined && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    const response = await fetch(input, {
      ...init,
      headers,
      cache: init?.cache ?? "no-store",
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `HTTP ${response.status}`);
    }

    return response.json() as Promise<T>;
  })();

  if (!dedupeKey) {
    return requestPromise;
  }

  const trackedPromise = requestPromise.finally(() => {
    if (inflightJsonRequests.get(dedupeKey) === trackedPromise) {
      inflightJsonRequests.delete(dedupeKey);
    }
  });
  inflightJsonRequests.set(dedupeKey, trackedPromise);
  return trackedPromise as Promise<T>;
}

export async function fetchSessions(params: {
  search?: string;
  workspace?: string;
}): Promise<SessionsResponse> {
  const url = new URL("/api/v1/sessions", window.location.origin);
  if (params.search) {
    url.searchParams.set("search", params.search);
  }
  if (params.workspace) {
    url.searchParams.set("workspace", params.workspace);
  }
  return requestJson<SessionsResponse>(url.toString());
}

export async function fetchSessionDetail(threadId: string): Promise<SessionDetail> {
  return requestJson<SessionDetail>(`/api/v1/sessions/${threadId}`);
}

export async function fetchSessionTranscript(
  threadId: string,
  params?: {
    page?: number;
    pageSize?: number;
    includeHidden?: boolean;
    role?: "all" | "user" | "assistant" | "tool" | "system";
    query?: string;
  },
): Promise<SessionTranscriptPage> {
  const url = new URL(`/api/v1/sessions/${threadId}/transcript`, window.location.origin);
  if (params?.page) {
    url.searchParams.set("page", String(params.page));
  }
  if (params?.pageSize) {
    url.searchParams.set("pageSize", String(params.pageSize));
  }
  if (params?.includeHidden) {
    url.searchParams.set("includeHidden", "true");
  }
  if (params?.role && params.role !== "all") {
    url.searchParams.set("role", params.role);
  }
  if (params?.query) {
    url.searchParams.set("query", params.query);
  }
  return requestJson<SessionTranscriptPage>(url.toString());
}

export async function renameSession(threadId: string, name: string): Promise<RenameApplyResponse> {
  return requestJson<RenameApplyResponse>(`/api/v1/sessions/${threadId}/rename`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export async function sendSessionMessage(
  threadId: string,
  message: string,
): Promise<SessionMessageResponse> {
  return requestJson<SessionMessageResponse>(`/api/v1/sessions/${threadId}/messages`, {
    method: "POST",
    body: JSON.stringify({ message }),
  });
}

export async function deleteSession(threadId: string): Promise<SessionDeleteResult> {
  return requestJson<SessionDeleteResult>(`/api/v1/sessions/${threadId}`, {
    method: "DELETE",
  });
}

export async function fetchConfig(): Promise<ConfigView> {
  return requestJson<ConfigView>("/api/v1/config");
}

export async function fetchEvents(cursor: number): Promise<ApiEventsResponse> {
  const url = new URL("/api/v1/events/since", window.location.origin);
  url.searchParams.set("cursor", String(cursor));
  return requestJson<ApiEventsResponse>(url.toString());
}
