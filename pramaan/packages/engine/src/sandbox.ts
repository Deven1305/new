import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { isAbsolute } from "node:path";

export const SANDBOX_IMAGE = process.env.PRAMAAN_SANDBOX_IMAGE ?? "pramaan/sandbox:0.1.0";
export const RESULT_MARKER = "@@PRAMAAN_RESULT@@";
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

export interface SandboxLimits {
  cpus: number;
  memory: string;
  pids: number;
  tmpfsSize: string;
  timeoutMs: number;
}

export const DEFAULT_LIMITS: SandboxLimits = { cpus: 2, memory: "2g", pids: 256, tmpfsSize: "2g", timeoutMs: 10 * 60 * 1000 };

export interface SandboxRun {
  mode: "analyze" | "test";
  /** Directory with the repository (mounted read-only at /src). */
  srcDir: string;
  /** Optional directory with generated tests in tests/*.t.sol (mounted read-only at /inputs). */
  inputsDir?: string;
  suite?: boolean;
  /** forge --no-match-path glob for the regression suite (always excludes test/pramaan/*). */
  suiteExclude?: string;
  skipAderyn?: boolean;
  limits?: Partial<SandboxLimits>;
  signal?: AbortSignal;
  image?: string;
  onLog?: (line: string) => void;
}

export interface SandboxResult {
  ok: boolean;
  exitCode: number | null;
  timedOut: boolean;
  cancelled: boolean;
  durationMs: number;
  result: Record<string, unknown> | null;
  stderrTail: string;
  argv: string[];
}

function assertMountable(path: string): void {
  // Docker's --mount syntax is comma/equals separated; refuse anything that could smuggle extra options.
  if (!isAbsolute(path) || /[,=\n\r"]/.test(path)) throw new Error(`refusing to mount path ${JSON.stringify(path)}`);
}

/**
 * The exact `docker run` argument vector. Built as an array and passed to execFile/spawn without a shell, so no part
 * of a path or option is ever interpreted by a shell.
 */
export function sandboxArgv(run: SandboxRun, containerName: string): string[] {
  const limits = { ...DEFAULT_LIMITS, ...run.limits };
  assertMountable(run.srcDir);
  if (run.inputsDir) assertMountable(run.inputsDir);
  const argv = [
    "run",
    "--rm",
    "--name",
    containerName,
    "--network",
    "none",
    "--read-only",
    "--tmpfs",
    `/work:rw,nosuid,nodev,noexec,mode=1777,size=${limits.tmpfsSize}`,
    "--tmpfs",
    "/tmp:rw,nosuid,nodev,noexec,mode=1777,size=64m",
    "--cpus",
    String(limits.cpus),
    "--memory",
    limits.memory,
    "--memory-swap",
    limits.memory,
    "--pids-limit",
    String(limits.pids),
    "--user",
    "1000:1000",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--mount",
    `type=bind,source=${run.srcDir},target=/src,readonly`,
  ];
  if (run.inputsDir) argv.push("--mount", `type=bind,source=${run.inputsDir},target=/inputs,readonly`);
  argv.push(run.image ?? SANDBOX_IMAGE, run.mode, "--timeout", String(Math.floor(limits.timeoutMs / 1000) - 30));
  if (run.mode === "test" && run.suite) {
    argv.push("--suite");
    if (run.suiteExclude) {
      if (!/^[A-Za-z0-9_.*{},/-]{1,200}$/.test(run.suiteExclude)) throw new Error("invalid suite exclude glob");
      argv.push("--suite-exclude", run.suiteExclude);
    }
  }
  if (run.mode === "analyze" && run.skipAderyn) argv.push("--skip-aderyn");
  return argv;
}

function dockerKill(name: string): void {
  execFile("docker", ["kill", name], { windowsHide: true }, () => undefined);
}

/** Runs one sandbox invocation with a hard wall-clock timeout and cancellation (the container is killed, not orphaned). */
export function runSandbox(run: SandboxRun): Promise<SandboxResult> {
  const name = `pramaan-${randomBytes(6).toString("hex")}`;
  const argv = sandboxArgv(run, name);
  const limits = { ...DEFAULT_LIMITS, ...run.limits };
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn("docker", argv, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let bytes = 0;
    let timedOut = false;
    let cancelled = false;
    let overflow = false;
    const onData = (target: "out" | "err") => (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_OUTPUT_BYTES) {
        if (!overflow) {
          overflow = true;
          dockerKill(name);
        }
        return;
      }
      const text = chunk.toString("utf8");
      if (target === "out") stdout += text;
      else {
        stderr += text;
        if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
        for (const line of text.split(/\r?\n/)) if (line.trim()) run.onLog?.(line);
      }
    };
    child.stdout.on("data", onData("out"));
    child.stderr.on("data", onData("err"));
    const timer = setTimeout(() => {
      timedOut = true;
      dockerKill(name);
    }, limits.timeoutMs);
    const onAbort = () => {
      cancelled = true;
      dockerKill(name);
    };
    run.signal?.addEventListener("abort", onAbort, { once: true });
    child.on("close", (code) => {
      clearTimeout(timer);
      run.signal?.removeEventListener("abort", onAbort);
      const at = stdout.lastIndexOf(RESULT_MARKER);
      let result: Record<string, unknown> | null = null;
      if (at >= 0) {
        try {
          result = JSON.parse(stdout.slice(at + RESULT_MARKER.length).trim()) as Record<string, unknown>;
        } catch {
          result = null;
        }
      }
      resolve({
        ok: code === 0 && result !== null && !timedOut && !cancelled && !overflow,
        exitCode: code,
        timedOut,
        cancelled,
        durationMs: Date.now() - started,
        result,
        stderrTail: (overflow ? "[output exceeded the 64 MiB cap and the container was killed]\n" : "") + stderr.slice(-8000),
        argv,
      });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, exitCode: null, timedOut, cancelled, durationMs: Date.now() - started, result: null, stderrTail: String(err), argv });
    });
  });
}

export interface DockerStatus {
  available: boolean;
  serverVersion: string | null;
  imagePresent: boolean;
  detail: string;
}

export function dockerStatus(image = SANDBOX_IMAGE): Promise<DockerStatus> {
  return new Promise((resolve) => {
    execFile("docker", ["info", "--format", "{{.ServerVersion}}"], { windowsHide: true, timeout: 20_000 }, (err, out) => {
      if (err) {
        resolve({ available: false, serverVersion: null, imagePresent: false, detail: "Docker is not running or not installed" });
        return;
      }
      execFile("docker", ["image", "inspect", image, "--format", "{{.Id}}"], { windowsHide: true, timeout: 20_000 }, (err2) => {
        resolve({
          available: true,
          serverVersion: out.trim(),
          imagePresent: !err2,
          detail: err2 ? `image ${image} not built (run: pnpm pramaan sandbox build)` : "ready",
        });
      });
    });
  });
}

export function buildSandboxImage(repoRoot: string, image = SANDBOX_IMAGE, onLog?: (line: string) => void): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("docker", ["build", "-f", "docker/sandbox/Dockerfile", "-t", image, "."], { cwd: repoRoot, windowsHide: true });
    const forward = (b: Buffer) => b.toString("utf8").split(/\r?\n/).forEach((l) => l.trim() && onLog?.(l));
    child.stdout.on("data", forward);
    child.stderr.on("data", forward);
    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}
