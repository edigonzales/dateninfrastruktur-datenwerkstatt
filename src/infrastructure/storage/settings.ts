import {z} from 'zod';
import type {WorkspaceDatabase} from './workspaceRepository';
export const settingsSchema = z.strictObject({
  id: z.literal('default'),
  editorFontSize: z.number().int().min(12).max(22),
  showLineNumbers: z.boolean(),
  wordWrap: z.boolean(),
  sidebarCollapsed: z.boolean(),
});
export type Settings = z.infer<typeof settingsSchema>;
export const defaultSettings: Settings = {
  id: 'default',
  editorFontSize: 14,
  showLineNumbers: true,
  wordWrap: false,
  sidebarCollapsed: true,
};
export class SettingsRepository {
  constructor(private readonly db: WorkspaceDatabase) {}
  async load() {
    const row = await this.db.appSettings.get('default');
    return row ? settingsSchema.parse(row.value) : defaultSettings;
  }
  async save(value: Settings) {
    const settings = settingsSchema.parse(value);
    await this.db.appSettings.put({id: 'default', value: settings});
    return settings;
  }
}
