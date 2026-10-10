import { type HTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/utils';
import styles from './Stack.module.css';

export interface StackProps extends HTMLAttributes<HTMLDivElement> {
  gap?: '1' | '2' | '3' | '4';
}

const gapClassMap: Record<'1' | '2' | '3' | '4', string> = {
  '1': styles.gap1,
  '2': styles.gap2,
  '3': styles.gap3,
  '4': styles.gap4,
};

export const Stack = forwardRef<HTMLDivElement, StackProps>(function Stack(
  { gap, className, children, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(styles.stack, gap && gapClassMap[gap], className)}
      {...props}
    >
      {children}
    </div>
  );
});

Stack.displayName = 'Stack';
