import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";

export type StageTimings = Record<string, { durationMs: number; calls: number }>;
const current = new AsyncLocalStorage<TimingRecorder>();
export class TimingRecorder {
  readonly stages: StageTimings = {};
  run<T>(action: () => Promise<T>) {
    return current.run(this, action);
  }
  async measure<T>(stage: string, action: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      return await action();
    } finally {
      const timing = (this.stages[stage] ??= { durationMs: 0, calls: 0 });
      timing.durationMs += performance.now() - start;
      timing.calls++;
    }
  }
}
export function timed<T>(stage: string, action: () => Promise<T>): Promise<T> {
  return current.getStore()?.measure(stage, action) ?? action();
}
