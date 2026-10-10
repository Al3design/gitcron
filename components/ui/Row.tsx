import { type HTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/utils';
import styles from './Row.module.css';

export interface RowProps extends HTMLAttributes<HTMLDivElement> {
  gap?: '1' | '2' | '3' | '4';
  wrap?: boolean;
}

const gapClassMap: Record<'1' | '2' | '3' | '4', string> = {
  '1': styles.gap1,
  '2': styles.gap2,
  '3': styles.gap3,
  '4': styles.gap4,
};

export const Row = forwardRef<HTMLDivElement, RowProps>(function Row(
  { gap, wrap, className, children, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        styles.row,
        wrap && styles.wrap,
        gap && gapClassMap[gap],
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
});

Row.displayName = 'Row';
