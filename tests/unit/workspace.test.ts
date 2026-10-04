import {describe, it, expect, vi, afterEach} from 'vitest';
import empty from '../../fixtures/workspace.empty.json';
import recipe from '../../fixtures/workspace.recipe.json';
import {
  parseWorkspace,
  nameSchema,
  sqlNameSchema,
  bindingNameSchema,
  checkedId,
  suggestSqlName,
} from '../../src/domain/workspace';
import {assertImmutableHistory} from '../../src/domain/immutability';
import {PersistenceCoordinator} from '../../src/application/persistenceCoordinator';
import {WorkspaceEditingSession} from '../../src/application/workspaceService';
import type {WorkspaceRepository} from '../../src/application/ports';
import type {WorkspaceDocument} from '../../src/domain/model';
function repository(document = parseWorkspace(empty)) {
  let saved = structuredClone(document);
  const port: WorkspaceRepository = {
    list: async () => [],
    load: async () => structuredClone(saved),
    create: async (d) => (saved = structuredClone(d)),
    commit: vi.fn(async (d, revision) => {
      if (saved.revision !== revision) throw Error('conflict');
      saved = structuredClone({...d, revision: revision + 1});
      return saved;
    }),
    remove: async () => {},
  };
  return port;
}
afterEach(() => vi.useRealTimers());
describe('AT-004 / AT-007 strict workspace boundary', () => {
  it('accepts supplied fixtures and rejects unknown fields/format', () => {
    expect(parseWorkspace(empty).workspace.name).toBe(empty.workspace.name);
    expect(parseWorkspace(recipe).formatVersion).toBe(1);
    expect(() => parseWorkspace({...empty, formatVersion: 99})).toThrow(
      expect.objectContaining({code: 'FORMAT_UNSUPPORTED'}),
    );
    expect(() => parseWorkspace({...empty, engine: {}})).toThrow(
      expect.objectContaining({code: 'VALIDATION_FAILED'}),
    );
  });
  it('validates names without damaging Unicode', () => {
    expect(nameSchema.parse('  Ölten  ')).toBe('Ölten');
    for (const s of ['', '   ', 'bad\nname', 'x'.repeat(121)])
      expect(nameSchema.safeParse(s).success).toBe(false);
    for (const s of ['__dw_test', '42name', 'a b', 'Ä', 'A'])
      expect(sqlNameSchema.safeParse(s).success).toBe(false);
    for (const s of ['params', 'lab_data', 'if', 'TRUE', '_data', '.data'])
      expect(bindingNameSchema.safeParse(s).success).toBe(false);
    expect(suggestSqlName('Äpfel.csv', ['aepfel', 'aepfel_2'])).toBe('aepfel_3');
  });
  it('reports wrong workspace, record keys, version ownership, result references and tombstone collisions', () => {
    const d = parseWorkspace(recipe);
    const first = Object.values(d.datasets)[0]!;
    const second = Object.values(d.datasets)[1]!;
    for (const edit of [
      (d: WorkspaceDocument) => {
        d.datasets[first.id]!.workspaceId = checkedId<'workspace'>(crypto.randomUUID());
      },
      (d: WorkspaceDocument) => {
        d.datasets[first.id]!.id = checkedId<'dataset'>(crypto.randomUUID());
      },
      (d: WorkspaceDocument) => {
        d.datasets[first.id]!.currentVersionId = second.currentVersionId;
      },
      (d: WorkspaceDocument) => {
        d.datasets[second.id]!.sqlName = first.sqlName;
        d.datasets[second.id]!.removedAt = '2026-10-03T00:00:00Z';
      },
      (d: WorkspaceDocument) => {
        Object.values(d.analyses)[0]!.inputs = [
          {
            name: 'daten',
            source: {kind: 'result', resultId: checkedId<'result'>(crypto.randomUUID())},
          },
        ];
      },
    ]) {
      const bad = structuredClone(d);
      edit(bad);
      expect(() => parseWorkspace(bad)).toThrow(
        expect.objectContaining({code: 'REFERENCE_INVALID', path: expect.any(String)}),
      );
    }
  });
});
describe('AT-005 / AT-006 analysis and history', () => {
  it('creates SQL/R independently, increments code revision, duplicates and archives without deleting history', async () => {
    vi.useFakeTimers();
    const doc = parseWorkspace(empty);
    const repo = repository(doc);
    const session = new WorkspaceEditingSession(
      doc,
      {workspaceId: doc.workspace.id, mode: 'writer', release: async () => {}},
      {
        repository: repo,
        lock: {
          acquire: async () => {
            throw Error('unused');
          },
        },
        newId: () => checkedId(crypto.randomUUID()),
        now: () => new Date().toISOString(),
      },
    );
    const sql = session.createAnalysis('sql');
    const r = session.createAnalysis('r');
    session.updateAnalysis(sql, {code: 'SELECT 9', name: 'Änderung'});
    const copy = session.duplicateAnalysis(sql);
    session.archiveAnalysis(sql);
    await session.flush();
    expect(session.document.analyses[sql]).toMatchObject({
      code: 'SELECT 9',
      revision: 1,
      archivedAt: expect.any(String),
    });
    expect(session.document.analyses[copy]).toMatchObject({code: 'SELECT 9', revision: 0});
    expect(session.document.analyses[r]).toMatchObject({
      kind: 'r',
      engineId: 'webr-local',
      revision: 0,
    });
    expect(session.document.formatVersion).toBe(1);
    expect(session.document.revision).toBe(1);
    await session.close();
  });
  it('does not allow mutation of immutable historical version metadata', () => {
    const before = parseWorkspace(recipe);
    const after = structuredClone(before);
    Object.values(after.datasetVersions)[0]!.rowCount = '999';
    expect(() => assertImmutableHistory(before, after)).toThrow(/Historischer Inhalt/);
    const renamed = structuredClone(before);
    renamed.workspace.name = 'Neuer Name';
    expect(() => assertImmutableHistory(before, renamed)).not.toThrow();
  });
});
describe('AT-011 autosave generations', () => {
  it('never marks a newer generation saved by an older in-flight commit', async () => {
    vi.useFakeTimers();
    const doc = parseWorkspace(empty);
    const repo = repository(doc);
    let resolveFirst: (d: WorkspaceDocument) => void = () => {};
    const first = new Promise<WorkspaceDocument>((r) => {
      resolveFirst = r;
    });
    const commit = vi
      .fn()
      .mockImplementationOnce(() => first)
      .mockImplementation(async (d: WorkspaceDocument) => ({...d, revision: d.revision + 1}));
    repo.commit = commit;
    const coordinator = new PersistenceCoordinator(doc, repo);
    for (let i = 1; i <= 4; i++)
      coordinator.mutate((d) => {
        d.workspace.name = `Generation ${i}`;
      });
    const saving = coordinator.flush();
    coordinator.mutate((d) => {
      d.workspace.name = 'Generation 5';
    });
    const snapshot = structuredClone(coordinator.document);
    snapshot.workspace.name = 'Generation 4';
    snapshot.revision = 1;
    const observations: {name: string; saved: number; generation: number}[] = [];
    coordinator.subscribe(() =>
      observations.push({
        name: coordinator.document.workspace.name,
        saved: coordinator.savedGeneration,
        generation: coordinator.generation,
      }),
    );
    resolveFirst(snapshot);
    await saving;
    expect(observations).toContainEqual({name: 'Generation 5', saved: 4, generation: 5});
    expect(coordinator.document.workspace.name).toBe('Generation 5');
    expect(coordinator.savedGeneration).toBe(5);
    expect(coordinator.state).toBe('saved');
    expect(commit).toHaveBeenCalledTimes(2);
  });
  it('starts at 600 ms debounce and at 3000 ms during sustained typing', async () => {
    vi.useFakeTimers();
    const repo = repository();
    const c = new PersistenceCoordinator(parseWorkspace(empty), repo);
    c.mutate((d) => {
      d.workspace.name = 'A';
    });
    await vi.advanceTimersByTimeAsync(599);
    expect(repo.commit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(repo.commit).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 6; i++) {
      c.mutate((d) => {
        d.workspace.name = `Typing ${i}`;
      });
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(repo.commit).toHaveBeenCalledTimes(2);
    await c.flush();
  });
  it('preserves dirty content and exposes commit errors', async () => {
    vi.useFakeTimers();
    const repo = repository();
    repo.commit = async () => {
      throw Error('quota');
    };
    const c = new PersistenceCoordinator(parseWorkspace(empty), repo);
    c.mutate((d) => {
      d.workspace.name = 'Still here';
    });
    await expect(c.flush()).rejects.toThrow('quota');
    expect(c.document.workspace.name).toBe('Still here');
    expect(c.savedGeneration).toBe(0);
    expect(c.state).toBe('error');
    c.stopTimers();
  });
});

describe('AT-006 immutable execution/result references', () => {
  it('keeps snapshot and result content while analysis code and dataset current version advance', () => {
    const before = parseWorkspace(recipe);
    const source = Object.values(before.datasets)[0]!;
    const analysis = Object.values(before.analyses).find((a) => a.kind === 'sql')!;
    const runId = checkedId<'run'>(crypto.randomUUID());
    const resultId = checkedId<'result'>(crypto.randomUUID());
    before.runs[runId] = {
      id: runId,
      workspaceId: before.workspace.id,
      trigger: 'analysis',
      status: 'succeeded',
      queuedAt: '2026-10-03T12:00:00Z',
      startedAt: '2026-10-03T12:00:00Z',
      finishedAt: '2026-10-03T12:00:01Z',
      warnings: [],
      resultIds: [resultId],
      snapshot: {
        analysisId: analysis.id,
        analysisRevision: analysis.revision,
        language: 'sql',
        code: analysis.code,
        parameters: analysis.parameters,
        resolvedInputs: [
          {
            kind: 'dataset-version',
            bindingName: source.sqlName,
            datasetId: source.id,
            versionId: source.currentVersionId,
            usage: 'possibly-used',
          },
        ],
        inputScope: 'workspace-snapshot',
        runtime: {
          appBuildId: 'unit-fixture',
          engineId: 'duckdb-local',
          engineVersion: 'unit-fixture',
          transferCodecVersion: '1',
          timeZone: 'UTC',
        },
        provenance: 'declared-inputs',
        notes: [],
      },
    };
    before.results[resultId] = {
      id: resultId,
      workspaceId: before.workspace.id,
      runId,
      name: 'Snapshot',
      createdAt: '2026-10-03T12:00:01Z',
      kind: 'table',
      schema: {columns: [], metadata: {}},
      rowCount: '0',
      coverage: {kind: 'complete'},
      retention: 'temporary',
      materialization: {kind: 'unavailable', reason: 'session-ended'},
    };
    const valid = parseWorkspace(before);
    const after = structuredClone(valid);
    const newVersion = checkedId<'dataset-version'>(crypto.randomUUID());
    after.datasetVersions[newVersion] = {
      ...structuredClone(after.datasetVersions[source.currentVersionId]!),
      id: newVersion,
      createdAt: '2026-10-03T12:02:00Z',
    };
    after.datasets[source.id]!.currentVersionId = newVersion;
    after.analyses[analysis.id]!.code = 'SELECT 99';
    after.analyses[analysis.id]!.revision++;
    expect(() => assertImmutableHistory(valid, parseWorkspace(after))).not.toThrow();
    expect(after.runs[runId]!.snapshot).toEqual(valid.runs[runId]!.snapshot);
    expect(after.results[resultId]).toEqual(valid.results[resultId]);
    after.runs[runId]!.snapshot.code = 'SELECT 99';
    expect(() => assertImmutableHistory(valid, after)).toThrow(/Historischer Inhalt/);
    const wrong = structuredClone(valid);
    wrong.runs[runId]!.resultIds = [];
    expect(() => parseWorkspace(wrong)).toThrow(
      expect.objectContaining({code: 'REFERENCE_INVALID'}),
    );
  });
});
