import { type HTMLAttributes, forwardRef, type ElementType } from 'react';
import { cn } from '@/lib/utils';
import styles from './Text.module.css';

export interface TextProps extends HTMLAttributes<HTMLElement> {
  variant?: 'secondary-xs' | 'mono-xs';
  as?: ElementType;
}

const variantClassMap: Record<'secondary-xs' | 'mono-xs', string> = {
  'secondary-xs': styles.secondaryXs,
  'mono-xs': styles.monoXs,
};

export const Text = forwardRef<HTMLElement, TextProps>(function Text(
  { variant = 'secondary-xs', as: Component = 'span', className, children, ...props },
  ref,
) {
  return (
    <Component
      ref={ref}
      className={cn(variant && variantClassMap[variant], className)}
      {...props}
    >
      {children}
    </Component>
  );
});

Text.displayName = 'Text';
