import type {ExecutionRun, RunStatus} from './model';
const transitions: Record<RunStatus, readonly RunStatus[]> = {
  queued: ['running', 'cancelled', 'interrupted'],
  running: ['succeeded', 'failed', 'cancelling', 'interrupted'],
  cancelling: ['cancelled', 'failed', 'interrupted'],
  succeeded: [],
  failed: [],
  cancelled: [],
  interrupted: [],
};
/** Terminal status is assigned once; a cancelling run can never succeed. */
export function transitionRun(run: ExecutionRun, status: RunStatus) {
  if (!transitions[run.status].includes(status))
    throw new Error(`Ungültiger Laufübergang: ${run.status} → ${status}`);
  run.status = status;
}
