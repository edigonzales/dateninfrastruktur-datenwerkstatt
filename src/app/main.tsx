import {ActionGroup, Button} from '../ui/Controls';
import './validationConfig';
import {measure} from '../application/diagnostics';
import {StrictMode, useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {RouterProvider} from '@tanstack/react-router';
import {router} from './router';
import {initializeServices, useTemporaryServices, type BootResult} from './services';
import '../styles/app.css';
function Boot() {
  const [result, setResult] = useState<BootResult>();
  useEffect(() => {
    void measure('Anwendung starten', initializeServices).then(setResult);
  }, []);
  if (!result) return <main role="status">Browser-Speicher wird geprüft …</main>;
  if (!result.ready)
    return (
      <main>
        <h1>
          {result.allowTemporary
            ? 'Browser-Speicher nicht vollständig verfügbar'
            : 'Anwendung konnte nicht gestartet werden'}
        </h1>
        <ul>
          {result.errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
        {result.allowTemporary && (
          <p>
            Ein Sitzungsprojekt verliert Daten beim Schliessen oder Neuladen. Exportiere benötigte
            Dateien vorher. Bestehende gespeicherte Projekte werden nicht verändert.
          </p>
        )}
        <ActionGroup>
          {result.allowTemporary && (
            <Button
              variant="primary"
              onClick={async () => {
                useTemporaryServices();
                await router.navigate({to: '/workspaces', replace: true});
                setResult({...result, ready: true});
              }}
            >
              Nur diese Sitzung verwenden
            </Button>
          )}
          {result.allowReadOnly && (
            <Button onClick={() => setResult({...result, ready: true})}>
              Gesicherte Projekte nur lesen
            </Button>
          )}
        </ActionGroup>
      </main>
    );
  return <RouterProvider router={router} />;
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Boot />
  </StrictMode>,
);
