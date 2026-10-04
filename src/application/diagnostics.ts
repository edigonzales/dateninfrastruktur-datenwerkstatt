/** Bounded, local timings only: never record code, cell values, URLs or exception text. */
export interface Timing {
  phase: string;
  durationMs: number;
  succeeded: boolean;
  at: string;
}
const entries: Timing[] = [];
export function timings() {
  return entries.map((entry) => ({...entry}));
}
export function recordTiming(phase: string, start: number, succeeded: boolean) {
  entries.push({
    phase,
    durationMs: Math.max(0, Date.now() - start),
    succeeded,
    at: new Date().toISOString(),
  });
  if (entries.length > 200) entries.splice(0, entries.length - 200);
}
export async function measure<T>(phase: string, operation: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    const value = await operation();
    recordTiming(phase, start, true);
    return value;
  } catch (error) {
    recordTiming(phase, start, false);
    throw error;
  }
}
