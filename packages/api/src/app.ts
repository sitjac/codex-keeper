import { existsSync } from "node:fs";
import path from "node:path";
import { CodexKeeper } from "@codex-keeper/core";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";

import { ApiEventLog } from "./event-log.js";
import { toErrorPayload } from "./lib/errors.js";
import { registerEventRoutes } from "./routes/events.js";
import { registerSessionRoutes } from "./routes/sessions.js";

export type ApiServer = FastifyInstance;

export async function buildApiServer(options?: {
  manager?: CodexKeeper;
  operator?: string;
  staticWebRoot?: string;
  cwd?: string;
  configPath?: string;
}): Promise<ApiServer> {
  const app = Fastify({
    logger: false,
  });

  const ownedManager = options?.manager
    ? undefined
    : await CodexKeeper.create({
        operator: options?.operator ?? "api",
        cwd: options?.cwd,
        configPath: options?.configPath,
      });
  const manager = options?.manager ?? ownedManager!;
  const eventLog = new ApiEventLog();

  app.addHook("onClose", async () => {
    if (ownedManager) {
      await ownedManager.close();
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    const payload = toErrorPayload(error);
    void reply.status(payload.statusCode).send(payload.body);
  });

  registerEventRoutes(app, eventLog);
  registerSessionRoutes(app, manager, eventLog);

  if (options?.staticWebRoot) {
    const staticWebRoot = path.resolve(options.staticWebRoot);
    const indexHtmlPath = path.join(staticWebRoot, "index.html");
    if (!existsSync(indexHtmlPath)) {
      throw new Error(
        `Web build not found at ${indexHtmlPath}. Run the web build first or pass a valid --web-root.`,
      );
    }

    await app.register(fastifyStatic, {
      root: staticWebRoot,
      prefix: "/",
    });

    app.setNotFoundHandler((request, reply) => {
      const requestPath = request.url.split("?")[0] ?? "/";
      const shouldServeSpaShell =
        request.method === "GET" &&
        !requestPath.startsWith("/api/") &&
        path.posix.extname(requestPath) === "";

      if (shouldServeSpaShell) {
        return reply.type("text/html; charset=utf-8").sendFile("index.html");
      }

      void reply.status(404).send({
        error: "Not Found",
        message: `Route ${request.method}:${request.url} not found`,
        statusCode: 404,
      });
    });
  }

  return app;
}
