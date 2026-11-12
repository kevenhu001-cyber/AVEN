import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-lg border px-2.5 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-border bg-secondary text-secondary-foreground',
        outline: 'border-border bg-transparent text-foreground',
        accent:
          'border-border bg-[var(--aven-color-accent-surface)] text-[var(--aven-color-accent)]',
        success:
          'border-border bg-[var(--aven-color-success-surface)] text-[var(--aven-color-success)]',
        warning:
          'border-border bg-[var(--aven-color-warning-surface)] text-[var(--aven-color-warning)]',
        destructive:
          'border-border bg-[var(--aven-color-destructive-surface)] text-[var(--aven-color-destructive)]',
      },
    },
    defaultVariants: {
      variant: 'secondary',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
