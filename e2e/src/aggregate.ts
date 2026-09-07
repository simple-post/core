import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LiveConfig } from "./config.js";
import { interfaces } from "./types.js";
import { Journal } from "./journal.js";
import type { JournalEntry, Phase } from "./types.js";
import { catalog, materialize } from "./catalog.js";
import { createHash } from "node:crypto";

const phases: Phase[] = ["reserved", "submitting", "accepted", "verified", "failed", "inconclusive", "blocked"];

export interface AggregateAttempt {
  run: string;
  revision?: string;
  key: string;
  accountId: string;
  platform: JournalEntry["platform"];
  interface: JournalEntry["interface"];
  scenarioId: string;
  scenarioSignature: string;
  currentDefinition: boolean;
  phase: Phase;
  updatedAt: string;
  error?: string;
  historicalErrors?: string[];
  receipt?: JournalEntry["receipt"];
}

function semanticSignature(scenario: JournalEntry["scenario"]): string {
  const normalize = (value: unknown): unknown => {
    if (typeof value === "string") return value.replace(/sp[a-f0-9]{16}/g, "{token}");
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => [k, normalize(v)]),
      );
    return value;
  };
  return createHash("sha256")
    .update(
      JSON.stringify(
        normalize({
          id: scenario.id,
          platform: scenario.platform,
          media: scenario.media,
          message: scenario.message,
          expectedText: scenario.expectedText,
          expectedTitle: scenario.expectedTitle,
          options: scenario.options,
          tags: scenario.tags,
          interfaces: scenario.interfaces,
          mode: scenario.mode,
          expectedError: scenario.expectedError,
          expectedFields: scenario.expectedFields,
          thread: scenario.thread,
          requirements: scenario.requirements,
          omitOptions: scenario.omitOptions,
          input: scenario.input,
          unsupportedReason: scenario.unsupportedReason,
        }),
      ),
    )
    .digest("hex");
}

export async function aggregateJournal(config: LiveConfig) {
  const attempts: AggregateAttempt[] = [];
  const currentDefinitions = new Map<string, string>();
  for (const scenario of catalog)
    for (const iface of interfaces) {
      const account = config.accounts[scenario.platform];
      if (!account || !scenario.interfaces.includes(iface)) continue;
      try {
        currentDefinitions.set(
          `${iface}/${scenario.id}`,
          semanticSignature(
            materialize(scenario, account, iface, "aggregate-current", config.mediaBaseUrl, config.fixtureUrls),
          ),
        );
      } catch {
        // Missing setup resources are already reported by preflight; they do not make an old journal current.
      }
    }
  let runs: string[] = [];
  try {
    runs = (await readdir(config.runDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^[a-zA-Z0-9_-]{1,70}$/.test(entry.name))
      .map((entry) => entry.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  for (const run of runs) {
    const dir = path.join(config.runDir, run);
    let revision: string | undefined;
    try {
      revision = (JSON.parse(await readFile(path.join(dir, "run.json"), "utf8")) as { revision?: string }).revision;
    } catch {
      // A run can be interrupted before preflight writes run.json; its journals still count.
    }
    for (const entry of await new Journal(config, run).entries(dir)) {
      const scenarioSignature = semanticSignature(entry.scenario);
      attempts.push({
        run,
        revision,
        key: entry.key,
        accountId: entry.accountId,
        platform: entry.platform,
        interface: entry.interface,
        scenarioId: entry.scenario.id,
        scenarioSignature,
        currentDefinition:
          entry.accountId === config.accounts[entry.platform]?.id &&
          currentDefinitions.get(entry.key) === scenarioSignature,
        phase: entry.phase,
        updatedAt: entry.updatedAt,
        ...(entry.error ? { error: entry.error } : {}),
        ...(entry.historicalErrors?.length ? { historicalErrors: entry.historicalErrors } : {}),
        ...(entry.receipt ? { receipt: entry.receipt } : {}),
      });
    }
  }
  attempts.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  const grouped = new Map<string, AggregateAttempt[]>();
  for (const attempt of attempts) {
    const groupKey = `${attempt.key}|${attempt.scenarioSignature}|${attempt.accountId}`;
    grouped.set(groupKey, [...(grouped.get(groupKey) ?? []), attempt]);
  }
  const rows = [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, history]) => {
      const latest = history.at(-1)!;
      return {
        key,
        accountId: latest.accountId,
        platform: latest.platform,
        interface: latest.interface,
        scenarioId: latest.scenarioId,
        scenarioSignature: latest.scenarioSignature,
        currentDefinition: latest.currentDefinition,
        attempts: history.length,
        everVerified: history.some((entry) => entry.phase === "verified"),
        status: latest.phase,
        latestRun: latest.run,
        latestRevision: latest.revision,
        updatedAt: latest.updatedAt,
        ...(latest.error ? { error: latest.error } : {}),
        ...(latest.historicalErrors?.length ? { historicalErrors: latest.historicalErrors } : {}),
      };
    });
  const output = {
    generatedAt: new Date().toISOString(),
    summary: {
      attempts: attempts.length,
      scenarioInterfaces: rows.filter((row) => row.currentDefinition).length,
      everVerified: rows.filter((row) => row.currentDefinition && row.everVerified).length,
      currentlyVerified: rows.filter((row) => row.currentDefinition && row.status === "verified").length,
      incomplete: rows.filter((row) => row.currentDefinition && !["verified"].includes(row.status)).length,
      historicalDefinitions: rows.filter((row) => !row.currentDefinition).length,
    },
    phases,
    rows,
    attempts,
  };
  await writeFile(path.join(config.runDir, "aggregate.json"), JSON.stringify(output, null, 2) + "\n", { mode: 0o600 });
  return output;
}
