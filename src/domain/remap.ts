import type {Artifact, ArtifactId, Id, WorkspaceDocument} from './model';
import {checkedId, parseWorkspace} from './workspace';
/** Explicit reference traversal. User code, aliases and external portal IDs are never rewritten. */
export function remapWorkspace(
  source: WorkspaceDocument,
  artifacts: Map<ArtifactId, Artifact>,
  newId: <K extends string>() => Id<K>,
  now: string,
  workspaceId = newId<'workspace'>(),
): WorkspaceDocument {
  const d = structuredClone(source);
  const collectionNames = [
    'datasets',
    'datasetVersions',
    'analyses',
    'runs',
    'results',
    'visualizations',
  ] as const;
  const maps = new Map<string, Map<string, string>>();
  for (const key of collectionNames)
    maps.set(key, new Map(Object.keys(d[key]).map((id) => [id, newId()])));
  const ref = <K extends string>(key: string, id: Id<K>): Id<K> => {
    const next = maps.get(key)?.get(id);
    if (!next) throw Error(`Referenz fehlt: ${key}/${id}`);
    return checkedId<K>(next);
  };
  d.workspace = {...d.workspace, id: workspaceId, createdAt: now, updatedAt: now};
  d.revision = 0;
  for (const a of Object.values(d.analyses))
    for (const input of a.inputs) {
      const s = input.source;
      if (s.kind === 'result') s.resultId = ref('results', s.resultId);
      else {
        s.datasetId = ref('datasets', s.datasetId);
        if (s.versionId) s.versionId = ref('datasetVersions', s.versionId);
      }
    }
  for (const ds of Object.values(d.datasets))
    ds.currentVersionId = ref('datasetVersions', ds.currentVersionId);
  for (const v of Object.values(d.datasetVersions)) {
    v.datasetId = ref('datasets', v.datasetId);
    if (v.origin.kind === 'result') v.origin.resultId = ref('results', v.origin.resultId);
    if (v.origin.kind === 'file' && v.origin.originalArtifactId) {
      const a = artifacts.get(v.origin.originalArtifactId);
      if (a) v.origin.originalArtifactId = a.id;
      else delete v.origin.originalArtifactId;
    }
    if (v.backing.kind === 'artifact') {
      const a = artifacts.get(v.backing.artifactId),
        expected = source.artifacts[v.backing.artifactId]?.sha256;
      v.backing = a
        ? {kind: 'artifact', artifactId: a.id}
        : {
            kind: 'missing',
            reason: 'recipe-import',
            ...(expected ? {expectedSha256: expected} : {}),
          };
    }
  }
  for (const run of Object.values(d.runs)) {
    const s = run.snapshot;
    if (s.analysisId) s.analysisId = ref('analyses', s.analysisId);
    for (const input of s.resolvedInputs)
      if (input.kind === 'result') input.resultId = ref('results', input.resultId);
      else {
        input.datasetId = ref('datasets', input.datasetId);
        input.versionId = ref('datasetVersions', input.versionId);
      }
    run.resultIds = run.resultIds.map((id) => ref('results', id));
    if (['queued', 'running', 'cancelling'].includes(run.status)) {
      run.status = 'interrupted';
      run.stopReason = 'runtime-crash';
      run.finishedAt = now;
    }
  }
  for (const result of Object.values(d.results)) {
    result.runId = ref('runs', result.runId);
    const a =
      result.materialization.kind === 'artifact'
        ? artifacts.get(result.materialization.artifactId)
        : undefined;
    result.materialization = a
      ? {kind: 'artifact', artifactId: a.id}
      : {kind: 'unavailable', reason: 'recipe-import'};
  }
  for (const v of Object.values(d.visualizations))
    v.tableResultId = ref('results', v.tableResultId);
  for (const key of collectionNames) {
    const transformed = Object.fromEntries(
      Object.values(d[key]).map((row) => {
        const id = ref(key, row.id);
        return [id, {...row, id, workspaceId}];
      }),
    );
    // The domain validator below checks each concrete discriminated record and every reference.
    Object.assign(d, {[key]: transformed});
  }
  d.artifacts = Object.fromEntries([...artifacts.values()].map((a) => [a.id, a]));
  return parseWorkspace(d);
}
