import { execFileSync, spawn } from "child_process";
import { existsSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { dirnameOf } from "./runtime";
import { simctlRaw } from "./simctl";
import { withStateLock } from "./state-lock";

const __dirname = dirnameOf(import.meta.url);
const PASTEBOARD_LOCK_TIMEOUT_MS = 90_000;

export function locatePasteboardTool(): string | null {
  const override = process.env.SERVE_SIM_SIMPB_DIR;
  const candidate = [
    ...(override ? [join(override, "serve-sim-pasteboard")] : []),
    join(__dirname, "..", "dist", "simpb", "serve-sim-pasteboard"),
    join(__dirname, "simpb", "serve-sim-pasteboard"),
  ].find(existsSync);
  return candidate ? resolve(candidate) : null;
}

function buildPasteboardTool(): string {
  const buildScript = join(__dirname, "..", "Sources", "SimPasteboard", "build.sh");
  if (!existsSync(buildScript)) {
    throw new Error("SimPasteboard source not found. Reinstall from a build that includes clipboard support.");
  }
  execFileSync("bash", [buildScript], { stdio: "inherit" });
  const output = locatePasteboardTool();
  if (!output) throw new Error("SimPasteboard build succeeded but serve-sim-pasteboard was not found.");
  return output;
}

function withSimPasteboardLock<T>(udid: string, run: () => Promise<T>): Promise<T> {
  const path = join(tmpdir(), "serve-sim-pasteboard-locks", `${udid}.lock`);
  return withStateLock(
    path,
    PASTEBOARD_LOCK_TIMEOUT_MS,
    () => new Error(`Timed out waiting for the simulator pasteboard on ${udid}`),
    run,
  );
}

export function writeSimPasteboard(udid: string, text: string): Promise<void> {
  return withSimPasteboardLock(udid, () => writeSimPasteboardUnlocked(udid, text));
}

function writeSimPasteboardUnlocked(udid: string, text: string): Promise<void> {
  const tool = locatePasteboardTool() ?? buildPasteboardTool();
  return new Promise((resolveWrite, rejectWrite) => {
    const child = spawn("xcrun", ["simctl", "spawn", udid, tool], {
      stdio: ["pipe", "ignore", "pipe"],
    });
    let stderr = "";
    let pendingError: Error | null = null;
    child.stderr.setEncoding("utf-8");
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    const timeout = setTimeout(() => {
      pendingError = new Error("simctl pasteboard write timed out");
      child.kill("SIGKILL");
    }, 30_000);
    child.once("error", (error) => { clearTimeout(timeout); rejectWrite(error); });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (pendingError) rejectWrite(pendingError);
      else if (code === 0) resolveWrite();
      else rejectWrite(new Error(stderr.trim() || `simctl pasteboard write exited ${code}`));
    });
    child.stdin.once("error", (error) => {
      pendingError = error;
      child.kill("SIGKILL");
    });
    child.stdin.end(text, "utf-8");
  });
}

export interface PasteboardReadResult {
  text: string;
  relaunchedApp: string | null;
}

export async function readSimPasteboardResult(udid: string): Promise<PasteboardReadResult> {
  return {
    text: await simctlRaw(["pbpaste", udid], {
      env: { LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8" },
    }),
    relaunchedApp: null,
  };
}
