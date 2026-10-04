import type * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
export class CodeModels {
  private readonly models = new Map<string, monaco.editor.ITextModel>();
  private readonly views = new Map<string, monaco.editor.ICodeEditorViewState>();
  constructor(private readonly sessionId: string) {}
  model(
    monaco: typeof import('monaco-editor/esm/vs/editor/editor.api.js'),
    id: string,
    kind: 'sql' | 'r',
    code: string,
  ) {
    let model = this.models.get(id);
    if (!model) {
      model = monaco.editor.createModel(
        code,
        kind === 'sql' ? 'sql' : 'plaintext',
        monaco.Uri.parse(`inmemory://datenwerkstatt/${this.sessionId}/${id}`),
      );
      this.models.set(id, model);
    }
    return model;
  }
  view(id: string) {
    return this.views.get(id);
  }
  saveView(id: string, view: monaco.editor.ICodeEditorViewState | null) {
    if (view) this.views.set(id, view);
  }
  dispose() {
    for (const model of this.models.values()) model.dispose();
    this.models.clear();
    this.views.clear();
  }
}
