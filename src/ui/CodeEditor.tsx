import {lazy, Suspense} from 'react';
import type {CodeEditorProps} from './CodeEditorImpl';
const Editor = lazy(() => import('./CodeEditorImpl').then((m) => ({default: m.CodeEditor})));
export function CodeEditor(props: CodeEditorProps) {
  return (
    <Suspense fallback={<div role="status">Editor wird geladen …</div>}>
      <Editor {...props} />
    </Suspense>
  );
}
