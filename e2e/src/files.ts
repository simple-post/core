import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export async function atomicJson(file: string, value: unknown) {
  await atomicText(file, JSON.stringify(value, null, 2) + "\n");
}

export async function atomicText(file: string, value: string) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, value, { mode: 0o600 });
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

export async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** Short journal transactions only. Never hold this lock around a remote mutation. */
export async function withFileLock<T>(file: string, action: () => Promise<T>, timeoutMs = 30_000): Promise<T> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + timeoutMs;
  const token = randomUUID();
  while (true) {
    try {
      const handle = await open(file, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify({ pid: process.pid, token }));
      } finally {
        await handle.close();
      }
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // Never unlink a contended lock: another waiter could have replaced it.
      // A crashed owner requires inspecting its journal before clearing the lock.
      if (Date.now() >= deadline)
        throw new Error(
          `Timed out waiting for journal transaction lock ${file}; inspect the owner and journal before clearing a stale lock`,
        );
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  try {
    return await action();
  } finally {
    const owner = await readJson<{ token: string }>(file);
    if (owner?.token === token) await unlink(file);
  }
}
