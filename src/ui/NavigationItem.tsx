import {cloneElement, type ReactElement, type ReactNode} from 'react';
import {Tooltip} from './Controls';
import {Icon, type IconName} from './Icon';
type NavigationControl = {
  'aria-describedby'?: string | undefined;
  'aria-label'?: string;
  'aria-current'?: 'page' | undefined;
  className?: string;
  children?: ReactNode;
};
export function NavigationItem({
  icon,
  label,
  tooltip = label,
  expanded,
  current = false,
  children,
}: {
  icon: IconName;
  label: string;
  tooltip?: string;
  expanded: boolean;
  current?: boolean;
  children: ReactElement<NavigationControl>;
}) {
  return (
    <Tooltip text={tooltip}>
      {cloneElement(children, {
        className: 'dw-nav-item',
        'aria-label': label,
        'aria-current': current ? 'page' : undefined,
        children: (
          <>
            <Icon name={icon} />
            {expanded && <span>{label}</span>}
          </>
        ),
      })}
    </Tooltip>
  );
}
