'use client';

// components/ai/settings/AiSettingsAccordionGroup.tsx
//
// Componente acordeón para los 5 grupos de «Motores y modelos» (tanda 24).
// Cabecera accesible con <button aria-expanded aria-controls>, resumen persistente,
// chevron animado y transición de altura fluida con grid-template-rows (0fr -> 1fr).

import React from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface AiSettingsAccordionGroupProps {
  id: string;
  isOpen: boolean;
  onToggle: () => void;
  icon?: React.ReactNode;
  title: string;
  summary?: React.ReactNode;
  children: React.ReactNode;
  badge?: React.ReactNode;
}

export function AiSettingsAccordionGroup({
  id,
  isOpen,
  onToggle,
  icon,
  title,
  summary,
  children,
  badge,
}: AiSettingsAccordionGroupProps) {
  const contentId = `${id}-content`;
  const headerId = `${id}-header`;

  return (
    <div
      data-testid={`accordion-group-${id}`}
      className="ai-surface rounded-lg overflow-hidden transition-colors"
    >
      <button
        type="button"
        id={headerId}
        aria-expanded={isOpen}
        aria-controls={contentId}
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-[var(--color-border-subtle)]/20 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ai)] cursor-pointer"
      >
        <div className="flex items-center gap-3 min-w-0 pr-2">
          {icon && <span className="text-[var(--color-text-secondary)] shrink-0">{icon}</span>}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm ai-gradient-text">{title}</span>
              {badge}
            </div>
            {summary && (
              <div
                data-testid={`accordion-summary-${id}`}
                className="text-xs text-[var(--color-text-secondary)] truncate mt-0.5 font-mono"
              >
                {summary}
              </div>
            )}
          </div>
        </div>
        <ChevronRight
          className={cn(
            'w-4 h-4 text-[var(--color-text-secondary)] shrink-0 transition-transform duration-200 ease-out transform motion-reduce:transition-none',
            isOpen && 'rotate-90',
          )}
        />
      </button>

      <div
        id={contentId}
        role="region"
        aria-labelledby={headerId}
        inert={!isOpen}
        className={cn(
          'grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none',
          isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="overflow-hidden min-h-0 border-t border-[var(--color-border-subtle)]">
          <div className="p-4 space-y-4">{children}</div>
        </div>
      </div>
    </div>
  );
}
