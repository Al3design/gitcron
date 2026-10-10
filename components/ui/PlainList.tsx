import { type HTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/utils';
import styles from './PlainList.module.css';

export interface PlainListProps extends HTMLAttributes<HTMLUListElement> {
  gap?: '1' | '2' | '3' | '4';
}

const gapClassMap: Record<'1' | '2' | '3' | '4', string> = {
  '1': styles.gap1,
  '2': styles.gap2,
  '3': styles.gap3,
  '4': styles.gap4,
};

export const PlainList = forwardRef<HTMLUListElement, PlainListProps>(function PlainList(
  { gap, className, children, ...props },
  ref,
) {
  return (
    <ul
      ref={ref}
      className={cn(styles.plainList, gap && gapClassMap[gap], className)}
      {...props}
    >
      {children}
    </ul>
  );
});

PlainList.displayName = 'PlainList';
