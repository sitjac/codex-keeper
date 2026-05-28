#!/usr/bin/env node

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startApiServer, waitForShutdown } from "@codex-keeper/api";
import { CodexKeeper } from "@codex-keeper/core";
import { cac } from "cac";
import { inspectListeningPortOwner } from "./port-owner.js";
import {
  formatServeAddressInUseMessage,
  formatServeAlreadyRunningMessage,
  formatServeOtherRepoMessage,
  isAddressInUseError,
} from "./serve-errors.js";
import { probeRunningServeTarget } from "./serve-target.js";

type IdOptions = { id?: string };
type RenameOptions = { id?: string; name?: string };
type ServeOptions = {
  host?: string;
  port?: string | number;
  webRoot?: string;
};

async function withManager<T>(fn: (manager: CodexKeeper) => Promise<T>): Promise<T> {
  const manager = await CodexKeeper.create({ operator: "cli" });
  try {
    return await fn(manager);
  } finally {
    await manager.close();
  }
}

function normalizeArgv(argv: string[]): string[] {
  if (argv[2] === "config" && argv[3] === "print") {
    return [...argv.slice(0, 2), "config-print", ...argv.slice(4)];
  }
  return argv;
}

function resolveServeWebRoot(explicitWebRoot?: string): string | undefined {
  if (explicitWebRoot) {
    const resolved = path.resolve(explicitWebRoot);
    return existsSync(path.join(resolved, "index.html")) ? resolved : undefined;
  }

  const bundledRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/dist");
  return existsSync(path.join(bundledRoot, "index.html")) ? bundledRoot : undefined;
}

function resolvePort(portValue: string | number | undefined, fallback: number): number {
  if (typeof portValue === "number" && Number.isFinite(portValue)) {
    return portValue;
  }
  if (typeof portValue === "string" && portValue.length > 0) {
    const parsed = Number(portValue);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

const normalizedArgv = normalizeArgv(process.argv);
const cli = cac("codex-keeper");

cli
  .command("serve", "Run the local API with built Web assets")
  .option("--host <host>", "Host to bind")
  .option("--port <port>", "Port to bind")
  .option("--web-root <path>", "Directory containing a built Web app")
  .action(async (options: ServeOptions) => {
    const host = options.host ?? "127.0.0.1";
    const port = resolvePort(options.port, 42110);
    const webRoot = resolveServeWebRoot(options.webRoot);
    const expectedCwd = process.cwd();
    if (!webRoot) {
      throw new Error(
        "No built Web UI found. Run `npm run web:build` first or pass `--web-root <path>` with a directory containing index.html.",
      );
    }

    const existingTarget = await probeRunningServeTarget({
      host,
      port,
      expectedCwd,
    });
    if (existingTarget?.kind === "same-repo") {
      console.error(
        formatServeAlreadyRunningMessage({
          baseUrl: existingTarget.baseUrl,
          cwd: existingTarget.cwd,
        }),
      );
      return;
    }
    if (existingTarget?.kind === "other-repo") {
      throw new Error(
        formatServeOtherRepoMessage({
          host,
          port,
          cwd: existingTarget.cwd,
        }),
      );
    }

    let app: Awaited<ReturnType<typeof startApiServer>>;
    try {
      app = await startApiServer({
        host,
        port,
        webRoot,
        operator: "serve",
      });
    } catch (error) {
      if (!isAddressInUseError(error)) {
        throw error;
      }

      const racedTarget = await probeRunningServeTarget({
        host,
        port,
        expectedCwd,
      });
      if (racedTarget?.kind === "same-repo") {
        console.error(
          formatServeAlreadyRunningMessage({
            baseUrl: racedTarget.baseUrl,
            cwd: racedTarget.cwd,
          }),
        );
        return;
      }
      if (racedTarget?.kind === "other-repo") {
        throw new Error(
          formatServeOtherRepoMessage({
            host,
            port,
            cwd: racedTarget.cwd,
          }),
        );
      }

      const portOwner = inspectListeningPortOwner(port);
      throw new Error(
        formatServeAddressInUseMessage({
          host,
          port,
          serviceStatus: undefined,
          portOwner,
        }),
      );
    }

    console.error(`[codex-keeper] Service listening at http://${host}:${port}/`);
    console.error(`[codex-keeper] Web root: ${webRoot}`);
    await waitForShutdown(app);
  });

cli
  .command("list", "List known sessions")
  .option("--workspace <workspace>", "Filter by workspace id/path")
  .option("--search <query>", "Search session name, id, project, or cwd")
  .action(async (options: { workspace?: string; search?: string }) => {
    const sessions = await withManager((manager) =>
      manager.listSessions({
        workspace: options.workspace,
        search: options.search,
      }),
    );
    console.log(JSON.stringify(sessions, null, 2));
  });

cli.command("workspaces", "List workspaces").action(async () => {
  const workspaces = await withManager((manager) => manager.listWorkspaces());
  console.log(JSON.stringify(workspaces, null, 2));
});

cli
  .command("show", "Show one session in detail")
  .option("--id <threadId>", "Thread id")
  .action(async (options: IdOptions) => {
    if (!options.id) {
      throw new Error("--id is required");
    }
    const detail = await withManager((manager) => manager.getSessionDetail(options.id!));
    if (!detail) {
      throw new Error(`Unknown session: ${options.id}`);
    }
    console.log(JSON.stringify(detail, null, 2));
  });

cli
  .command("rename", "Apply a manual final name")
  .option("--id <threadId>", "Thread id")
  .option("--name <name>", "New thread name")
  .action(async (options: RenameOptions) => {
    if (!options.id || !options.name) {
      throw new Error("--id and --name are required");
    }
    const result = await withManager((manager) => manager.rename(options.id!, options.name!));
    console.log(JSON.stringify(result, null, 2));
  });

cli
  .command("delete", "Delete one session")
  .option("--id <threadId>", "Thread id")
  .action(async (options: IdOptions) => {
    if (!options.id) {
      throw new Error("--id is required");
    }
    const result = await withManager((manager) => manager.deleteSession(options.id!));
    console.log(JSON.stringify(result, null, 2));
  });

cli
  .command("history", "Show rename history for a session")
  .option("--id <threadId>", "Thread id")
  .action(async (options: IdOptions) => {
    if (!options.id) {
      throw new Error("--id is required");
    }
    const history = await withManager((manager) => manager.getRenameHistory(options.id!));
    console.log(JSON.stringify(history, null, 2));
  });

cli
  .command("compact-index", "Compact session_index.jsonl")
  .option("--dry-run", "Preview compaction")
  .action(async (options: { dryRun?: boolean }) => {
    const result = await withManager((manager) =>
      manager.compactIndex({ dryRun: options.dryRun || false }),
    );
    console.log(JSON.stringify(result, null, 2));
  });

cli.command("config-print", "Print effective config").action(async () => {
  const config = await withManager((manager) => manager.getConfigView());
  console.log(JSON.stringify(config, null, 2));
});

cli.help();
cli.parse(normalizedArgv);
