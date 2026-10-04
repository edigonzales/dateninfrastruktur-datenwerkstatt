import {useEffect, useState} from 'react';
import {Link} from '@tanstack/react-router';
import {services} from '../../app/services';
import {report} from '../../app/router';
import {Modal} from '../../ui/Modal';
export function StorageSettings() {
  const [estimate, setEstimate] = useState<Awaited<ReturnType<typeof services.storageEstimate>>>(),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [receipt, setReceipt] = useState('');
  const refresh = () => void services.storageEstimate().then(setEstimate).catch(report);
  useEffect(refresh, []);
  const bytes = (value: number | undefined) =>
    value === undefined
      ? 'nicht verfügbar'
      : `${new Intl.NumberFormat('de-CH', {maximumFractionDigits: 1}).format(value / 1048576)} MiB`;
  return (
    <section aria-label="Browser-Speicher">
      <h2>Browser-Speicher</h2>
      <p>
        {services.mode === 'temporary'
          ? 'Nur diese Sitzung · kein dauerhafter Speicher'
          : 'Lokal im Browser · Browserdaten sind kein Backup.'}
      </p>
      <p>
        Geschätzter Verbrauch: {bytes(estimate?.usage)} · Browserbudget: {bytes(estimate?.quota)}.
        Die Schätzung reserviert keinen Speicher.
      </p>
      <button onClick={refresh}>Speicherstatus aktualisieren</button>{' '}
      <Link to="/workspaces">Projekte verwalten und gezielt löschen</Link>{' '}
      <button disabled={busy} onClick={() => setConfirm(true)}>
        Nicht referenzierte Projektreste bereinigen
      </button>
      {receipt && <p role="status">{receipt}</p>}
      {confirm && (
        <Modal
          title="Projektreste bereinigen?"
          onClose={() => {
            if (!busy) setConfirm(false);
          }}
        >
          <p>
            Entfernt ausschliesslich eigene Dateien abgebrochener oder bereits gelöschter Projekte
            ohne Projektmetadaten. Gespeicherte Projekte, benötigte Resultate und fremde Dateien
            bleiben erhalten. Aktive Writer werden ausgelassen.
          </p>
          <button
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void services.workspaces
                .cleanAbandoned(new AbortController().signal)
                .then((r) => {
                  setReceipt(`${r.removed.length} Dateien bereinigt. ${r.failures.join('; ')}`);
                  setConfirm(false);
                  refresh();
                })
                .catch(report)
                .finally(() => setBusy(false));
            }}
          >
            Bereinigung bestätigen
          </button>
        </Modal>
      )}
    </section>
  );
}
