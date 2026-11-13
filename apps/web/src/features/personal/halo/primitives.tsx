'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Icon, type IconName } from '../icon';

/** 44px round icon button with a dark fill (Halo top bar / composer). */
export const RoundButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    icon: IconName;
    label: string;
    tone?: 'dark' | 'light' | 'ghost';
  }
>(function RoundButton({ icon, label, tone = 'dark', className = '', ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={`halo-round halo-round-${tone} halo-press ${className}`.trim()}
      {...props}
    >
      <Icon name={icon} size={22} />
    </button>
  );
});

/**
 * Bottom sheet on Radix Dialog. Keep it mounted and toggle `open` so Radix Presence can play
 * the slide-down / backdrop-fade exit animation before unmounting the content.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  headerExtra,
  variant = 'sheet',
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  headerExtra?: ReactNode;
  variant?: 'sheet' | 'full';
  footer?: ReactNode;
}) {
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="halo-overlay" />
        <DialogPrimitive.Content
          className={`personal-app aven-theme-halo halo-sheet halo-sheet-${variant}`}
          aria-describedby={undefined}
        >
          <header className="halo-sheet-head">
            <DialogPrimitive.Close
              aria-label="关闭面板"
              title="关闭面板"
              className="halo-round halo-round-dark halo-press"
            >
              <Icon name="x" size={22} />
            </DialogPrimitive.Close>
            <DialogPrimitive.Title className="halo-sheet-title">{title}</DialogPrimitive.Title>
            {headerExtra}
          </header>
          <div className="halo-sheet-body">{children}</div>
          {footer && <div className="halo-sheet-footer">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export type MenuItem = {
  id: string;
  label: string;
  icon: IconName;
  onSelect: () => void;
  disabled?: boolean;
};

/** Dropdown menu that scales and fades from the trigger's corner. Keyboard: arrows, Home/End, Esc. */
export function Menu({
  label,
  items,
  icon = 'ellipsis',
}: {
  label: string;
  items: MenuItem[];
  icon?: IconName;
}) {
  const [phase, setPhase] = useState<'closed' | 'open' | 'closing'>('closed');
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const id = useId();

  const close = useCallback((focusTrigger = true) => {
    setPhase((current) => (current === 'open' ? 'closing' : current));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPhase('closed'), 150);
    if (focusTrigger) trigger.current?.focus();
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  useEffect(() => {
    if (phase !== 'open') return;
    list.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')
      ?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!list.current?.contains(target) && !trigger.current?.contains(target)) close(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [phase, close]);

  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    const nodes = [
      ...(list.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ??
        []),
    ];
    const index = nodes.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      close();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      nodes[(index + 1) % nodes.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      nodes[(index - 1 + nodes.length) % nodes.length]?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      nodes[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      nodes[nodes.length - 1]?.focus();
    }
  }

  return (
    <div className="halo-menu-anchor">
      <RoundButton
        ref={trigger}
        icon={icon}
        label={label}
        aria-haspopup="menu"
        aria-expanded={phase === 'open'}
        aria-controls={phase !== 'closed' ? id : undefined}
        onClick={() => (phase === 'open' ? close() : setPhase('open'))}
      />
      {phase !== 'closed' && (
        <div
          id={id}
          ref={list}
          role="menu"
          aria-label={label}
          className="halo-menu"
          data-state={phase}
          onKeyDown={onKey}
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className="halo-menu-item"
              disabled={item.disabled}
              onClick={() => {
                close(false);
                item.onSelect();
              }}
            >
              <Icon name={item.icon} size={22} />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** iOS-like switch with a spring thumb. The visible label is supplied by the caller via aria-labelledby. */
export function Switch({
  checked,
  mixed = false,
  disabled,
  onChange,
  labelledBy,
  describedBy,
}: {
  checked: boolean;
  mixed?: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  labelledBy: string;
  describedBy?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={mixed ? 'mixed' : checked}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      disabled={disabled}
      className="halo-switch halo-press"
      data-checked={checked && !mixed}
      data-mixed={mixed}
      onClick={() => onChange(!checked || mixed)}
    >
      <span className="halo-switch-thumb" />
    </button>
  );
}

/** One live status line for transient confirmations (copied, saved, not yet available). */
export function useToast() {
  const [message, setMessage] = useState('');
  const [seq, setSeq] = useState(0);
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback((text: string) => {
    setMessage(text);
    setSeq((value) => value + 1);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMessage(''), 2600);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const node = (
    <div className="halo-toast-region" role="status" aria-live="polite">
      {message && (
        <p key={seq} className="halo-toast">
          {message}
        </p>
      )}
    </div>
  );
  return [node, show] as const;
}

/** Grouped list row (资料库 >, 电脑 空闲 >). */
export function ListRow({
  icon,
  label,
  value,
  onClick,
}: {
  icon: IconName;
  label: string;
  value?: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="halo-row halo-press-soft" onClick={onClick}>
      <Icon name={icon} size={22} className="halo-row-icon" />
      <span className="halo-row-label">{label}</span>
      {value && <span className="halo-row-value">{value}</span>}
      <Icon name="chevron" size={20} className="halo-row-chevron" />
    </button>
  );
}
