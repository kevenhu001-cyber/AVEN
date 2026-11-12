import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition-colors cursor-pointer disabled:pointer-events-none disabled:cursor-default disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[3px] [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground border border-transparent hover:opacity-90',
        secondary: 'bg-secondary text-secondary-foreground border border-border hover:bg-accent',
        outline:
          'bg-transparent text-foreground border border-input hover:bg-accent hover:text-accent-foreground',
        ghost:
          'bg-transparent text-muted-foreground border border-transparent hover:bg-accent hover:text-foreground',
        destructive:
          'bg-destructive text-destructive-foreground border border-transparent hover:opacity-90',
      },
      size: {
        default: 'min-h-11 px-[18px] py-2',
        sm: 'min-h-9 px-3.5 py-1.5 text-xs',
        lg: 'min-h-12 px-6 py-2.5 text-base',
        icon: 'size-11 min-h-11 p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type = 'button', ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        data-slot="button"
        type={asChild ? undefined : type}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
