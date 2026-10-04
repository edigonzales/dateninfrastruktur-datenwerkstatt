import {createStore} from 'zustand/vanilla';
import {defaultSettings, type Settings} from '../infrastructure/storage/settings';
export const appStore = createStore<{settings: Settings; error: string | null}>(() => ({
  settings: defaultSettings,
  error: null,
}));
