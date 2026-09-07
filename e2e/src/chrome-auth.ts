import { chromium, type BrowserContext } from "@playwright/test";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

export function installedChrome(): string {
  const candidates =
    process.platform === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          path.join(os.homedir(), "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
        ]
      : process.platform === "win32"
        ? [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA]
            .filter((root): root is string => Boolean(root))
            .map((root) => path.join(root, "Google/Chrome/Application/chrome.exe"))
        : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/opt/google/chrome/chrome"];
  const executable = candidates.find((candidate) => existsSync(candidate));
  if (!executable) throw new Error("Google Chrome is not installed in a standard location.");
  return executable;
}

export async function saveAuthState(context: BrowserContext, file: string) {
  // Do not destroy a working session if extraction or writing fails.
  const state = await context.storageState({ indexedDB: true });
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(state), { mode: 0o600, flag: "wx" });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function localPort() {
  const server = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Cannot allocate Chrome's local debug port");
    return address.port;
  } finally {
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

export async function chromeAuth(url: string, file: string, confirmLogin: (signal: AbortSignal) => Promise<void>) {
  const executable = installedChrome();
  // Chrome prohibits debugging the default personal profile. This profile is
  // dedicated to this one saved test session and persists between invocations.
  const profile = `${file}.chrome-profile`;
  await mkdir(profile, { recursive: true, mode: 0o700 });
  await chmod(profile, 0o700);
  const lockPath = `${profile}.lock`;
  const lock = await open(lockPath, "wx", 0o600).catch(() => {
    throw new Error(`Chrome authentication is already open, or its lock needs review: ${lockPath}`);
  });
  const controller = new AbortController();
  const interrupt = () => controller.abort(new Error("Authentication cancelled; existing session retained."));
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  let child: ReturnType<typeof spawn> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
  try {
    const port = await localPort();
    child = spawn(
      executable,
      [
        `--user-data-dir=${profile}`,
        "--remote-debugging-address=127.0.0.1",
        `--remote-debugging-port=${port}`,
        "--no-first-run",
        "--no-default-browser-check",
        url,
      ],
      { stdio: "ignore" },
    );
    child.once("error", (error) => controller.abort(error));
    child.once("exit", () => controller.abort(new Error("Chrome closed before the session was saved.")));
    await confirmLogin(controller.signal);
    controller.signal.throwIfAborted();
    // No Playwright connection exists during manual login. Attaching is only
    // for exporting the user's session, with no credential entry or retries.
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 15_000 });
    const context = browser.contexts()[0];
    if (!context) throw new Error("Chrome has no session to save.");
    controller.signal.throwIfAborted();
    // CDP attachment does not mark already-open origins as visited for
    // storageState. Register them on a locally fulfilled blank page; this
    // avoids reloading the signed-in page or requesting the site again.
    const origins = new Set(
      context
        .pages()
        .flatMap((page) => page.frames().map((frame) => frame.url()))
        .filter((value) => /^https?:\/\//.test(value))
        .map((value) => new URL(value).origin),
    );
    const storagePage = await context.newPage();
    try {
      await storagePage.route("**/*", (route) => route.fulfill({ contentType: "text/html", body: "<html></html>" }));
      for (const origin of origins) await storagePage.goto(origin, { timeout: 10_000 });
      controller.signal.throwIfAborted();
      await saveAuthState(context, file);
    } finally {
      await storagePage.close();
    }
  } finally {
    await browser?.close().catch(() => {});
    // Stop only the process started here; never close the user's regular Chrome.
    if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
    await lock.close();
    await rm(lockPath, { force: true });
  }
}
