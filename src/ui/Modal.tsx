import {ActionGroup, Button} from './Controls';
import {useEffect, useRef, type ReactNode} from 'react';
// WebKit does not focus clicked buttons with the default macOS keyboard setting.
// Remember the explicit activator so focus returns to it after a modal closes.
let activator: HTMLElement | null = null;
const rememberActivation = (event: Event) => {
  if (event instanceof KeyboardEvent && !['Enter', ' '].includes(event.key)) {
    activator = null;
    return;
  }
  activator =
    event.target instanceof Element
      ? event.target.closest<HTMLElement>('button,a[href],input,select,textarea,[tabindex]')
      : null;
};
document.addEventListener('pointerdown', rememberActivation, true);
document.addEventListener('keydown', rememberActivation, true);
import.meta.hot?.dispose(() => {
  document.removeEventListener('pointerdown', rememberActivation, true);
  document.removeEventListener('keydown', rememberActivation, true);
});
export function Modal({
  title,
  onClose,
  children,
  className = 'native-dialog',
  showClose = true,
  footer,
}: {
  title: string;
  footer?: ReactNode;
  className?: string;
  showClose?: boolean;
  onClose(): void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const previous = activator?.isConnected ? activator : document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      className={`dw-dialog ${className}`}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const dialog = event.currentTarget;
        const focusable = [
          ...dialog.querySelectorAll<HTMLElement>(
            'button,input,select,textarea,a[href],[tabindex]',
          ),
        ].filter(
          (el) => el.tabIndex >= 0 && !el.matches(':disabled') && el.getClientRects().length > 0,
        );
        // Drive every Tab step: WebKit's native tab order can skip buttons,
        // so trapping only the first/last DOM element is insufficient.
        event.preventDefault();
        if (!focusable.length) return;
        const current = focusable.findIndex((el) => el === document.activeElement);
        const next =
          current < 0
            ? event.shiftKey
              ? focusable.length - 1
              : 0
            : (current + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length;
        focusable[next]?.focus();
      }}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="dw-dialog-header">
        <h2>{title}</h2>
      </div>
      <div className="dw-dialog-body">{children}</div>
      {(footer || showClose) && (
        <ActionGroup className="dw-dialog-footer">
          {showClose && <Button onClick={onClose}>Schliessen</Button>}
          {footer}
        </ActionGroup>
      )}
    </dialog>
  );
}
