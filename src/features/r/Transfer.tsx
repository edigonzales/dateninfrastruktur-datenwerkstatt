import {Button, Input, Select, FormField, Notice} from '../../ui/Controls';
import {useState} from 'react';
import {useNavigate} from '@tanstack/react-router';
import type {EditingSession} from '../../application/workspaceService';
import type {ResultId, AnalysisId} from '../../domain/model';
import type {TransferPlan} from '../../application/ports';
import {Modal} from '../../ui/Modal';
export function PlanView({
  plan,
  approved,
  onChange,
}: {
  plan: TransferPlan;
  approved: string[];
  onChange(ids: string[]): void;
}) {
  return (
    <>
      <p>
        {plan.rowCount} Zeilen · {plan.estimatedBytes.toLocaleString('de-CH')} Bytes
        Transferpayload. Es werden alle Resultatzeilen übernommen.
      </p>
      <ul>
        {plan.issues.map((i) => (
          <li key={i.id}>
            {i.requiresApproval ? (
              <FormField label={<>{i.message}</>}>
                <Input
                  type="checkbox"
                  checked={approved.includes(i.id)}
                  onChange={(e) =>
                    onChange(
                      e.target.checked ? [...approved, i.id] : approved.filter((id) => id !== i.id),
                    )
                  }
                />
              </FormField>
            ) : (
              i.message
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
export function TransferToR({
  session,
  resultId,
  onClose,
}: {
  session: EditingSession;
  resultId: ResultId;
  onClose(): void;
}) {
  const navigate = useNavigate();
  const analyses = Object.values(session.document.analyses).filter(
    (a) => a.kind === 'r' && !a.archivedAt,
  );
  const [analysisId, setAnalysisId] = useState<string>(analyses[0]?.id ?? 'new');
  const [variable, setVariable] = useState('daten');
  const [plan, setPlan] = useState<TransferPlan>();
  const [approved, setApproved] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Resultat in R übernehmen"
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <Button
            disabled={busy}
            onClick={() =>
              void act(async () => {
                const id =
                  analysisId === 'new' ? session.createAnalysis('r') : (analysisId as AnalysisId);
                setAnalysisId(id);
                setApproved([]);
                setPlan(
                  await session
                    .getR()
                    .planToR(resultId, id, variable, new AbortController().signal),
                );
              })
            }
          >
            Transfer prüfen
          </Button>
          {plan && (
            <Button
              variant="primary"
              disabled={
                busy || plan.issues.some((i) => i.requiresApproval && !approved.includes(i.id))
              }
              onClick={() =>
                void act(async () => {
                  await session.getR().commitToR(plan.id, approved, new AbortController().signal);
                  onClose();
                  await navigate({
                    to: '/workspaces/$workspaceId/r/$analysisId',
                    params: {workspaceId: session.document.workspace.id, analysisId},
                  });
                })
              }
            >
              In R übernehmen
            </Button>
          )}
        </>
      }
    >
      <FormField label={<>R-Analyse</>}>
        <Select
          value={analysisId}
          disabled={busy}
          onChange={(e) => {
            setAnalysisId(e.target.value);
            setPlan(undefined);
          }}
        >
          <option value="new">Neue R-Analyse</option>
          {analyses.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label={<>R-Variablenname</>}>
        <Input
          value={variable}
          disabled={busy}
          onChange={(e) => {
            setVariable(e.target.value);
            setPlan(undefined);
          }}
        />
      </FormField>

      {plan && (
        <>
          <PlanView plan={plan} approved={approved} onChange={setApproved} />
          <p>
            Das Resultat wird vor der dauerhaften Eingabebindung gesichert. Das R-Skript wird nicht
            gestartet.
          </p>
        </>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
      {busy && <Notice tone="info">Transfer wird verarbeitet …</Notice>}
    </Modal>
  );
}
