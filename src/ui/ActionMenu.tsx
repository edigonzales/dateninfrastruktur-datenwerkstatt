import {useEffect, useId, useRef, useState} from 'react';
import {Button, type ButtonVariant} from './Controls';
import type {IconName} from './Icon';
export interface MenuAction {
  label: string;
  onSelect(): void;
  disabled?: boolean;
  icon?: IconName;
  variant?: ButtonVariant;
}
export function ActionMenu({
  label = 'Weitere Aktionen',
  actions,
}: {
  label?: string;
  actions: MenuAction[];
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const host = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const last = useRef(false);
  const items = () =>
    Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
  const close = (restore: boolean) => {
    setOpen(false);
    if (restore) trigger.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    const buttons = items();
    (last.current ? buttons.at(-1) : buttons[0])?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !host.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  return (
    <div
      ref={host}
      className="dw-menu"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <Button
        ref={trigger}
        icon="three-dots"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => {
          last.current = false;
          setOpen(!open);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            last.current = e.key === 'ArrowUp';
            setOpen(true);
          }
        }}
      >
        {label}
      </Button>
      {open && (
        <div
          id={id}
          ref={menu}
          role="menu"
          aria-label={label}
          className="dw-menu-panel"
          onKeyDown={(e) => {
            const buttons = items(),
              current = buttons.indexOf(document.activeElement as HTMLButtonElement);
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              close(true);
            }
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
              e.preventDefault();
              const index =
                e.key === 'Home'
                  ? 0
                  : e.key === 'End'
                    ? buttons.length - 1
                    : (current + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) %
                      buttons.length;
              buttons[index]?.focus();
            }
          }}
        >
          {actions.map((action) => (
            <Button
              key={action.label}
              role="menuitem"
              tabIndex={-1}
              disabled={action.disabled}
              icon={action.icon}
              variant={action.variant ?? 'ghost'}
              onClick={() => {
                close(true);
                action.onSelect();
              }}
            >
              {action.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
