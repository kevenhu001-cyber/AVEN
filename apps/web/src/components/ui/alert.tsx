import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const alertVariants = cva(
  'relative w-full rounded-xl border border-border/60 px-4 py-3 text-sm leading-relaxed text-foreground',
  {
    variants: {
      variant: {
        default: 'bg-secondary',
        warning: 'bg-[var(--aven-color-warning-surface)]',
        destructive: 'bg-[var(--aven-color-destructive-surface)]',
        info: 'bg-[var(--aven-color-info-surface)]',
        success: 'bg-[var(--aven-color-success-surface)]',
      },
    },
    defaultVariants: {
      variant: 'warning',
    },
  },
);

export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof alertVariants> {}

const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant, role = 'status', ...props }, ref) => (
    <div
      ref={ref}
      role={role}
      data-slot="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  ),
);
Alert.displayName = 'Alert';

export { Alert, alertVariants };
