import { spawn } from "node:child_process";

export type CodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export interface CodexResumeTurnRequest {
  codexHome: string;
  threadId: string;
  prompt: string;
  cwd: string;
  model?: string;
  sandboxMode?: CodexSandboxMode;
}

export interface CodexResumeTurnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type CodexTurnRunner = (request: CodexResumeTurnRequest) => Promise<CodexResumeTurnResult>;

const OUTPUT_TAIL_LIMIT = 64_000;

function appendBoundedOutput(previous: string, chunk: Buffer): string {
  const next = `${previous}${chunk.toString("utf8")}`;
  if (next.length <= OUTPUT_TAIL_LIMIT) {
    return next;
  }
  return next.slice(next.length - OUTPUT_TAIL_LIMIT);
}

export const runCodexExecResume: CodexTurnRunner = (request) =>
  new Promise<CodexResumeTurnResult>((resolve, reject) => {
    const args = ["exec", "--json", "--skip-git-repo-check"];
    if (request.sandboxMode) {
      args.push("-s", request.sandboxMode);
    }
    if (request.model) {
      args.push("-m", request.model);
    }
    args.push("resume", request.threadId, "-");

    const child = spawn("codex", args, {
      cwd: request.cwd,
      env: {
        ...process.env,
        CODEX_HOME: request.codexHome,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = appendBoundedOutput(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = appendBoundedOutput(stderr, chunk);
    });
    child.stdin.on("error", () => {
      // The process-level error/close handlers surface the actionable failure.
    });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code) => {
      const exitCode = code ?? 1;
      const result = {
        exitCode,
        stdout,
        stderr,
      };
      if (exitCode === 0) {
        resolve(result);
        return;
      }

      const message = stderr.trim() || stdout.trim() || `codex exited with code ${exitCode}`;
      const error = new Error(message) as Error & {
        exitCode?: number;
        stdout?: string;
        stderr?: string;
      };
      error.exitCode = exitCode;
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });

    child.stdin.end(`${request.prompt}\n`, "utf8");
  });
