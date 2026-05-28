import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { probeRunningServeTarget } from "../packages/cli/src/serve-target.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubRunningService(params: { cwd?: string; includeConfig?: boolean }): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = input instanceof URL ? input : new URL(String(input));
      if (url.pathname === "/api/v1/health") {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.pathname === "/api/v1/config" && params.includeConfig !== false) {
        return new Response(
          JSON.stringify({
            paths: {
              cwd: params.cwd,
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      return new Response("not found", { status: 404 });
    }),
  );
}

describe("probeRunningServeTarget", () => {
  it("classifies a healthy service from the same repo", async () => {
    const expectedCwd = path.join(os.tmpdir(), "codex-keeper-same");
    const port = 42110;
    stubRunningService({ cwd: expectedCwd });

    await expect(
      probeRunningServeTarget({
        host: "127.0.0.1",
        port,
        expectedCwd,
      }),
    ).resolves.toEqual({
      kind: "same-repo",
      baseUrl: `http://127.0.0.1:${port}/`,
      cwd: expectedCwd,
    });
  });

  it("classifies a healthy service from another repo", async () => {
    const port = 42111;
    stubRunningService({ cwd: "/tmp/another-repo" });

    await expect(
      probeRunningServeTarget({
        host: "127.0.0.1",
        port,
        expectedCwd: "/tmp/current-repo",
      }),
    ).resolves.toEqual({
      kind: "other-repo",
      baseUrl: `http://127.0.0.1:${port}/`,
      cwd: path.resolve("/tmp/another-repo"),
    });
  });

  it("falls back to healthy-unknown when config metadata is missing", async () => {
    const port = 42112;
    stubRunningService({ includeConfig: false });

    await expect(
      probeRunningServeTarget({
        host: "127.0.0.1",
        port,
        expectedCwd: "/tmp/current-repo",
      }),
    ).resolves.toEqual({
      kind: "healthy-unknown",
      baseUrl: `http://127.0.0.1:${port}/`,
    });
  });
});
