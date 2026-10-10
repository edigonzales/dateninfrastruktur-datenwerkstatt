import {
  cloneElement,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type HTMLAttributes,
  type Ref,
} from 'react';
import {Icon, type IconName} from './Icon';
export type ControlSize = 'default' | 'compact';
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  ref?: Ref<HTMLButtonElement>;
  variant?: ButtonVariant;
  size?: ControlSize;
  busy?: boolean;
  icon?: IconName | undefined;
}
export function Button({
  variant = 'secondary',
  size,
  busy = false,
  icon,
  className = '',
  children,
  disabled,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`dw-button dw-button--${variant} ${size ? `dw-size-${size}` : ''} ${className}`}
    >
      {busy ? (
        <Icon name="arrow-repeat" className="dw-spin" size={16} />
      ) : icon ? (
        <Icon name={icon} size={16} />
      ) : null}
      {children}
    </button>
  );
}
export function Tooltip({
  text,
  children,
}: {
  text: string;
  children: ReactElement<{'aria-describedby'?: string | undefined}>;
}) {
  const id = useId();
  const [dismissed, setDismissed] = useState(false);
  const [position, setPosition] = useState({left: 8, top: 8});
  const reveal = (host: HTMLElement) => {
    const rect = host.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(rect.right + 8, window.innerWidth - 248)),
      top: Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - 80)),
    });
    setDismissed(false);
  };
  return (
    <span
      className="dw-tooltip-host"
      onPointerEnter={(e) => reveal(e.currentTarget)}
      onFocus={(e) => reveal(e.currentTarget)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setDismissed(true);
      }}
    >
      {cloneElement(children, {
        'aria-describedby': [children.props['aria-describedby'], id].filter(Boolean).join(' '),
      })}
      <span id={id} role="tooltip" className="dw-tooltip" style={position} hidden={dismissed}>
        {text}
      </span>
    </span>
  );
}
export function IconButton({
  label,
  tooltip = label,
  icon,
  ...props
}: Omit<ButtonProps, 'children'> & {label: string; tooltip?: string; icon: IconName}) {
  return (
    <Tooltip text={tooltip}>
      <Button {...props} aria-label={label} className={`dw-icon-button ${props.className ?? ''}`}>
        <Icon name={icon} />
      </Button>
    </Tooltip>
  );
}
export function Input({
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {ref?: Ref<HTMLInputElement>}) {
  return <input {...props} className={`dw-input ${className}`} />;
}
export function Select({className = '', ...props}: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`dw-select ${className}`} />;
}
export function Textarea({className = '', ...props}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`dw-textarea ${className}`} />;
}
type FieldControl = Pick<
  InputHTMLAttributes<HTMLInputElement>,
  'id' | 'type' | 'required' | 'aria-describedby' | 'aria-invalid'
>;
export function FormField({
  label,
  hint,
  error,
  labelHidden = false,
  children,
  className = '',
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  labelHidden?: boolean;
  children: ReactElement<FieldControl>;
  className?: string;
}) {
  const generated = useId();
  const id = children.props.id ?? generated;
  const check = ['checkbox', 'radio'].includes(children.props.type ?? '');
  const describedBy =
    [children.props['aria-describedby'], hint ? `${id}-hint` : '', error ? `${id}-error` : '']
      .filter(Boolean)
      .join(' ') || undefined;
  const input = cloneElement(children, {
    id,
    'aria-describedby': describedBy,
    'aria-invalid': error ? true : children.props['aria-invalid'],
  });
  const labelNode = (
    <label htmlFor={id} className={`dw-label ${labelHidden ? 'visually-hidden' : ''}`}>
      {label}
      {children.props.required && <span aria-hidden="true"> *</span>}
    </label>
  );
  return (
    <div
      className={`dw-field ${check ? 'dw-field--check' : ''} ${labelHidden ? 'dw-field--hidden' : ''} ${className}`}
    >
      {check ? (
        <div className="dw-check-line">
          {input}
          {labelNode}
        </div>
      ) : (
        <>
          {labelNode}
          {input}
        </>
      )}
      {hint && (
        <p id={`${id}-hint`} className="dw-field-hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="dw-field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
export function FileInput({
  buttonLabel = 'Datei auswählen',
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {buttonLabel?: string}) {
  const ref = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('Keine Datei ausgewählt');
  return (
    <span className="dw-file-input">
      <Input
        {...props}
        ref={ref}
        type="file"
        className="visually-hidden"
        tabIndex={-1}
        onChange={(e) => {
          setFileName(e.target.files?.[0]?.name ?? 'Keine Datei ausgewählt');
          props.onChange?.(e);
        }}
      />
      <Button
        icon="upload"
        aria-describedby={props['aria-describedby']}
        disabled={props.disabled}
        onClick={() => ref.current?.click()}
      >
        {buttonLabel}
      </Button>
      <span className="dw-file-name">{fileName}</span>
    </span>
  );
}
export function ActionGroup({className = '', ...props}: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`dw-actions ${className}`} />;
}
export function Toolbar({className = '', ...props}: HTMLAttributes<HTMLDivElement>) {
  return <ActionGroup {...props} className={`dw-toolbar dw-compact ${className}`} />;
}
export function StatusBadge({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
  children: ReactNode;
}) {
  return <span className={`dw-badge dw-tone-${tone}`}>{children}</span>;
}
export function Notice({
  tone = 'info',
  className = '',
  ...props
}: HTMLAttributes<HTMLDivElement> & {tone?: 'info' | 'success' | 'warning' | 'danger'}) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      {...props}
      className={`dw-notice dw-tone-${tone} ${className}`}
    />
  );
}
export function PanelHeader({title, children}: {title: string; children?: ReactNode}) {
  return (
    <div className="dw-panel-header">
      <h2>{title}</h2>
      {children}
    </div>
  );
}
export function EmptyState({children}: {children: ReactNode}) {
  return <div className="dw-empty">{children}</div>;
}
