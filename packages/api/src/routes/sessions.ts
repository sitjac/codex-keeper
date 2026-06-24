import type { CodexKeeper } from "@codex-keeper/core";
import {
  renameRequestSchema,
  sessionDetailQuerySchema,
  sessionListQuerySchema,
  sessionTranscriptQuerySchema,
} from "@codex-keeper/shared";
import type { FastifyInstance } from "fastify";

import type { ApiEventLog } from "../event-log.js";

export function registerSessionRoutes(
  app: FastifyInstance,
  manager: CodexKeeper,
  eventLog: ApiEventLog,
) {
  app.get("/api/v1/config", async () => manager.getConfigView());

  app.get("/api/v1/sessions", async (request) => {
    const query = sessionListQuerySchema.parse(
      (request.query as Record<string, unknown> | undefined) ?? {},
    );
    return manager.querySessions(query);
  });

  app.get("/api/v1/workspaces", async (request) => {
    const query = sessionListQuerySchema.parse(
      (request.query as Record<string, unknown> | undefined) ?? {},
    );
    return {
      items: await manager.listWorkspaces(query),
    };
  });

  app.get("/api/v1/sessions/:id", async (request, reply) => {
    const params = request.params as { id: string };
    const query = sessionDetailQuerySchema.parse(
      (request.query as Record<string, unknown> | undefined) ?? {},
    );
    const detail = await manager.getSessionDetail(params.id, {
      includeTranscript: query.includeTranscript ?? false,
    });
    if (!detail) {
      return reply.status(404).send({
        error: "not_found",
        message: `Unknown session: ${params.id}`,
      });
    }
    return detail;
  });

  app.get("/api/v1/sessions/:id/transcript", async (request) => {
    const params = request.params as { id: string };
    const query = sessionTranscriptQuerySchema.parse(
      (request.query as Record<string, unknown> | undefined) ?? {},
    );

    return manager.getSessionTranscriptPage(params.id, query);
  });

  app.get("/api/v1/sessions/:id/history", async (request) => {
    const params = request.params as { id: string };
    return manager.getRenameHistory(params.id);
  });

  app.post("/api/v1/sessions/:id/rename", async (request) => {
    const params = request.params as { id: string };
    const body = renameRequestSchema.parse(
      (request.body as Record<string, unknown> | undefined) ?? {},
    );
    const result = await manager.rename(params.id, body.name, { codexStateWrite: "defer" });
    eventLog.publish("session.renamed", {
      threadId: params.id,
      name: result.name,
      written: result.written,
    });
    return result;
  });

  app.delete("/api/v1/sessions/:id", async (request) => {
    const params = request.params as { id: string };
    const result = await manager.deleteSession(params.id);
    eventLog.publish("session.deleted", {
      threadId: params.id,
      deleted: result.deleted,
      removedIndexEntries: result.removedIndexEntries,
    });
    return result;
  });

  app.post("/api/v1/session-index/compact", async (request) => {
    const body = (request.body as Record<string, unknown> | undefined) ?? {};
    const result = await manager.compactIndex({ dryRun: body.dryRun === true });
    eventLog.publish("session.index.compacted", {
      dryRun: result.dryRun,
      originalLines: result.originalLines,
      compactedLines: result.compactedLines,
    });
    return result;
  });
}
