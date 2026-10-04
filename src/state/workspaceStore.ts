import {createStore} from 'zustand/vanilla';
import type {EditingSession} from '../application/workspaceService';
import type {SaveState} from '../application/persistenceCoordinator';
export function createWorkspaceStore(session: EditingSession) {
  const store = createStore(() => ({
    document: session.document,
    saveState: session.persistence.state as SaveState,
    error: session.persistence.error,
  }));
  const connect = () =>
    session.persistence.subscribe(() =>
      store.setState({
        document: session.document,
        saveState: session.persistence.state,
        error: session.persistence.error,
      }),
    );
  return {store, connect};
}
