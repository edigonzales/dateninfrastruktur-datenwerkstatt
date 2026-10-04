import {describe, it, expect} from 'vitest';
import {transitionRun} from '../../src/domain/run';
import {checkedId} from '../../src/domain/workspace';
import type {ExecutionRun} from '../../src/domain/model';
function run(): ExecutionRun {
  return {
    id: checkedId('00000000-0000-4000-8000-000000000001'),
    workspaceId: checkedId('00000000-0000-4000-8000-000000000002'),
    trigger: 'analysis',
    snapshot: {
      language: 'sql',
      code: 'SELECT 1',
      parameters: {},
      resolvedInputs: [],
      inputScope: 'workspace-snapshot',
      runtime: {
        appBuildId: 'test',
        engineId: 'duckdb-local',
        engineVersion: 'test',
        transferCodecVersion: '1',
        timeZone: 'UTC',
      },
      provenance: 'declared-inputs',
      notes: [],
    },
    status: 'queued',
    queuedAt: '2026-10-04T00:00:00Z',
    warnings: [],
    resultIds: [],
  };
}
describe('run terminality', () => {
  it('cannot publish a late success while cancelling or after termination', () => {
    const r = run();
    transitionRun(r, 'running');
    transitionRun(r, 'cancelling');
    expect(() => transitionRun(r, 'succeeded')).toThrow();
    transitionRun(r, 'cancelled');
    expect(() => transitionRun(r, 'failed')).toThrow();
    expect(() => transitionRun(r, 'running')).toThrow();
  });
  it('permits queued cancellation and recovery, but no queued success', () => {
    const r = run();
    expect(() => transitionRun(r, 'succeeded')).toThrow();
    transitionRun(r, 'cancelled');
    const recovered = run();
    transitionRun(recovered, 'interrupted');
    expect(() => transitionRun(recovered, 'succeeded')).toThrow();
  });
});
