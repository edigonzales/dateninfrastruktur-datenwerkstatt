import {Button, Input, FormField} from '../../ui/Controls';
import {useState} from 'react';
import type {EditingSession} from '../../application/workspaceService';
import {timings} from '../../application/diagnostics';
import {services} from '../../app/services';
import {downloadStream} from '../../app/download';
import {report} from '../../app/router';
export function Diagnostics({session}: {session: EditingSession}) {
  const [code, setCode] = useState(false);
  return (
    <details className="diagnostics">
      <summary>Lokale Diagnose</summary>
      <p>
        Sitzung {session.sessionId} · {services.config?.buildId} ·{' '}
        {session.scheduler.getSnapshot() ?? 'Bereit'}
      </p>
      <p>
        Exportiert IDs, Laufstatus, tatsächliche Runtimeversionen und die letzten 200 Zeitmessungen.
        Keine Tabellenwerte, Dateien, Quellen-URLs, Parametersätze oder Fehlermeldungstexte.
      </p>
      <FormField label={<>Analysecode ausdrücklich aufnehmen</>}>
        <Input type="checkbox" checked={code} onChange={(e) => setCode(e.target.checked)} />
      </FormField>
      <Button
        onClick={() => {
          const d = session.document;
          const data = {
            formatVersion: 1,
            createdAt: new Date().toISOString(),
            buildId: services.config?.buildId,
            workspaceId: d.workspace.id,
            sessionId: session.sessionId,
            revision: d.revision,
            mode: session.mode,
            readOnly: session.readOnly,
            counts: {
              datasets: Object.keys(d.datasets).length,
              runs: Object.keys(d.runs).length,
              results: Object.keys(d.results).length,
            },
            runs: Object.values(d.runs).map((r) => ({
              id: r.id,
              status: r.status,
              durationMs: r.durationMs,
              errorCode: r.error?.code,
              runtime: r.snapshot.runtime,
            })),
            timings: timings(),
            ...(code
              ? {
                  analyses: Object.values(d.analyses).map((a) => ({
                    id: a.id,
                    language: a.kind,
                    code: a.code,
                  })),
                }
              : {}),
          };
          void downloadStream(
            new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'}).stream(),
            'datenwerkstatt-diagnose.json',
            'application/json',
          ).catch(report);
        }}
      >
        Diagnosebericht herunterladen
      </Button>
    </details>
  );
}
