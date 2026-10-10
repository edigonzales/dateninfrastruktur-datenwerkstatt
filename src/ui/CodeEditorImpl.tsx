import {useEffect, useRef} from 'react';
import type {CodeModels} from '../infrastructure/monaco/models';
import {monaco} from '../infrastructure/monaco/runtime';
export interface CodeEditorProps {
  models: CodeModels;
  id: string;
  kind: 'sql' | 'r';
  code: string;
  readOnly: boolean;
  onChange: (code: string) => void;
  onSave: () => void;
  onRun?: (selection?: string) => void;
  fontSize: number;
  wordWrap: boolean;
  lineNumbers: boolean;
}
export function CodeEditor(props: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const change = useRef(props.onChange);
  change.current = props.onChange;
  const save = useRef(props.onSave);
  save.current = props.onSave;
  const run = useRef(props.onRun);
  run.current = props.onRun;
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  useEffect(() => {
    const model = props.models.model(monaco, props.id, props.kind, props.code);
    const instance = monaco.editor.create(host.current!, {
      model,
      editContext: false,
      occurrencesHighlight: 'off',
      selectionHighlight: false,
      automaticLayout: true,
      minimap: {enabled: false},
      scrollBeyondLastLine: false,
      ariaLabel: 'Analysecode',
      readOnly: props.readOnly,
      fontSize: props.fontSize,
      fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      lineNumbers: props.lineNumbers ? 'on' : 'off',
      wordWrap: props.wordWrap ? 'on' : 'off',
    });
    editor.current = instance;
    // Monaco caches glyph widths; refresh after the local font settles, including fallback.
    void document.fonts.ready.then(() => {
      if (editor.current === instance) monaco.editor.remeasureFonts();
    });
    const view = props.models.view(props.id);
    if (view) instance.restoreViewState(view);
    instance.focus();
    const subscription = model.onDidChangeContent(() => change.current(model.getValue()));
    instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      instance.pushUndoStop();
      save.current();
    });
    instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      const selection = instance.getSelection();
      run.current?.(
        selection && !selection.isEmpty() ? model.getValueInRange(selection) : undefined,
      );
    });
    return () => {
      props.models.saveView(props.id, instance.saveViewState());
      subscription.dispose();
      instance.dispose();
      editor.current = null;
    };
  }, [props.models, props.id]);
  useEffect(() => {
    editor.current?.updateOptions({
      readOnly: props.readOnly,
      fontSize: props.fontSize,
      lineNumbers: props.lineNumbers ? 'on' : 'off',
      wordWrap: props.wordWrap ? 'on' : 'off',
    });
  }, [props.readOnly, props.fontSize, props.lineNumbers, props.wordWrap]);
  return <div className="code-editor" ref={host} />;
}
