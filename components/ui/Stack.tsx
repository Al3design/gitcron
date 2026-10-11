import { type HTMLAttributes, forwardRef, type ElementType } from 'react';
import { cn } from '@/lib/utils';
import styles from './Stack.module.css';

export interface StackProps extends HTMLAttributes<HTMLElement> {
  gap?: '1' | '2' | '3' | '4';
  as?: ElementType;
}

const gapClassMap: Record<'1' | '2' | '3' | '4', string> = {
  '1': styles.gap1,
  '2': styles.gap2,
  '3': styles.gap3,
  '4': styles.gap4,
};

export const Stack = forwardRef<HTMLElement, StackProps>(function Stack(
  { gap, as: Component = 'div', className, children, ...props },
  ref,
) {
  return (
    <Component
      ref={ref}
      className={cn(styles.stack, gap && gapClassMap[gap], className)}
      {...props}
    >
      {children}
    </Component>
  );
});

Stack.displayName = 'Stack';
