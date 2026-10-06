'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Minus, Plus, X } from 'lucide-react';
import { Reorder } from 'motion/react';
import { useT } from '@/hooks/use-translation';
import type { RepoState } from '@/lib/git-store';
import { cn } from '@/lib/utils';

type RepoTabsProps = {
  repos: RepoState[];
  activeIdx: number;
  onSelect: (idx: number) => void | Promise<void>;
  onClose: (idx: number) => void | Promise<void>;
  onOpen: () => void | Promise<void>;
  onReorder: (newOrder: RepoState[]) => void;
  // Controles de disposición
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  detailsOpen?: boolean;
  onToggleDetails?: () => void;
};

/**
 * Los dos íconos de la barra de título, dibujados a mano.
 */
function MaximizeIcon({ size = 13 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="2.8" y="2.8" width="10.4" height="10.4" rx="1.4" />
    </svg>
  );
}

function RestoreIcon({ size = 13 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M5.2 4.4V3.4a1.4 1.4 0 0 1 1.4-1.4h5.4a1.4 1.4 0 0 1 1.4 1.4v5.4a1.4 1.4 0 0 1-1.4 1.4h-1" />
      <rect x="2" y="5.2" width="8.8" height="8.8" rx="1.4" />
    </svg>
  );
}

function SidebarToggleIcon({ isOpen, side = 'left' }: { isOpen?: boolean; side?: 'left' | 'right' }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      <rect width="18" height="18" x="3" y="3" rx="3" />
      {isOpen ? (
        side === 'left' ? <path d="M9 3v18" /> : <path d="M15 3v18" />
      ) : (
        side === 'left' ? <path d="M7 8v8" strokeWidth="2.2" /> : <path d="M17 8v8" strokeWidth="2.2" />
      )}
    </svg>
  );
}

export function RepoTabs({
  repos,
  activeIdx,
  onSelect,
  onClose,
  onOpen,
  onReorder,
  sidebarOpen,
  onToggleSidebar,
  detailsOpen,
  onToggleDetails,
}: RepoTabsProps) {
  const t = useT();
  const [maximized, setMaximized] = useState(false);
  const isDraggingRef = useRef(false);

  useEffect(() => {
    let alive = true;
    void window.api?.windowIsMaximized?.().then((result) => {
      if (alive && result?.data) setMaximized(result.data.maximized);
    }).catch(() => undefined);
    const unsubscribe = window.api?.onWindowState?.((state) => {
      if (alive) setMaximized(state.maximized);
    });
    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, []);

  if (repos.length === 0) return null;

  return (
    <div className="app-titlebar h-12 rounded-t-2xl bg-transparent flex items-stretch shrink-0 overflow-hidden gap-1">
      {/* Logo / Brand - Visual anchor in Window Frame */}
      <div className="app-titlebar-control h-12 flex items-center gap-2 pl-3 pr-1 shrink-0 select-none">
        <img
          src="/gitcron-icon.png"
          alt="GitCron"
          className="w-4 h-4 rounded-sm"
        />
        <span className="text-sm font-bold text-primary tracking-tight">GitCron</span>
      </div>

      {/* Control de plegado de panel izquierdo (entre el logo y las solapas) */}
      {onToggleSidebar && (
        <div className="app-titlebar-control h-12 flex items-center px-1 shrink-0">
          <button
            type="button"
            onClick={onToggleSidebar}
            aria-label={sidebarOpen ? t('toolbar.hideSidebar') : t('toolbar.showSidebar')}
            aria-pressed={sidebarOpen}
            title={sidebarOpen ? t('toolbar.hideSidebar') : t('toolbar.showSidebar')}
            className={cn(
              'app-titlebar-control min-h-[44px] min-w-[44px] h-7 w-7 p-1.5 shrink-0 rounded-lg text-text-secondary',
              'flex items-center justify-center transition-colors',
              'hover:bg-border-subtle hover:text-text-primary',
              'focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2',
            )}
          >
            <SidebarToggleIcon isOpen={sidebarOpen} side="left" />
          </button>
        </div>
      )}

      <div className="min-w-0 flex-1 flex items-end gap-1 px-3 pt-1.5 pb-1.5 overflow-x-auto overflow-y-hidden">
        <Reorder.Group
          axis="x"
          values={repos}
          onReorder={onReorder}
          className="flex items-end gap-1 min-w-0"
        >
          {repos.map((repo, idx) => {
            const isActive = idx === activeIdx;
            return (
              <Reorder.Item
                key={repo.path}
                value={repo}
                onDragStart={() => {
                  isDraggingRef.current = true;
                }}
                onDragEnd={() => {
                  setTimeout(() => {
                    isDraggingRef.current = false;
                  }, 50);
                }}
                className={cn(
                  'app-titlebar-control group h-8 min-w-0 max-w-52 rounded-md flex items-center transition-colors shadow-[inset_0_1px_0_color-mix(in_srgb,var(--color-text-primary)_4%,transparent)] cursor-grab active:cursor-grabbing',
                  isActive
                    ? 'bg-text-primary/10 text-text-primary shadow-[0_0_6px_color-mix(in_srgb,var(--color-git-add)_22%,transparent),inset_0_1px_0_color-mix(in_srgb,var(--color-text-primary)_10%,transparent)]'
                    : 'bg-text-primary/[0.035] text-text-secondary hover:text-text-primary hover:bg-text-primary/[0.07]',
                )}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (!isDraggingRef.current) onSelect(idx);
                  }}
                  title={t('repoTabs.switchTo', { repo: repo.name })}
                  className="min-w-0 flex-1 h-full px-2.5 flex items-center gap-2 text-left"
                >
                  {repo.isLoading ? (
                    <Loader2 size={10} className="shrink-0 animate-spin text-secondary" />
                  ) : (
                    <span
                      className={cn(
                        'w-1.5 h-1.5 rounded-full shrink-0',
                        (repo.modifiedFiles && repo.modifiedFiles.length > 0)
                          ? 'bg-git-mod shadow-[0_0_6px_color-mix(in_srgb,var(--color-git-mod)_60%,transparent)]'
                          : 'bg-secondary shadow-[0_0_6px_color-mix(in_srgb,var(--color-git-add)_50%,transparent)]',
                      )}
                    />
                  )}
                  <span className="truncate text-xs font-medium">{repo.name}</span>
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!isDraggingRef.current) onClose(idx);
                  }}
                  aria-label={t('repoTabs.close', { repo: repo.name })}
                  title={t('repoTabs.close', { repo: repo.name })}
                  className="h-full px-1.5 text-text-secondary/50 hover:text-text-primary transition-colors flex items-center"
                >
                  <X size={11} />
                </button>
              </Reorder.Item>
            );
          })}
        </Reorder.Group>

        <button
          type="button"
          onClick={onOpen}
          aria-label={t('repoTabs.openAnother')}
          title={t('repoTabs.openAnother')}
          className="app-titlebar-control h-7 w-7 min-h-[32px] min-w-[32px] p-1.5 rounded-lg flex items-center justify-center text-text-secondary hover:bg-border-subtle hover:text-text-primary transition-colors shrink-0"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Control de plegado de panel derecho */}
      {onToggleDetails && (
        <div className="app-titlebar-control h-12 self-stretch flex items-center shrink-0 px-1">
          <button
            type="button"
            onClick={onToggleDetails}
            aria-label={detailsOpen ? t('toolbar.hideDetails') : t('toolbar.showDetails')}
            aria-pressed={detailsOpen}
            title={detailsOpen ? t('toolbar.hideDetails') : t('toolbar.showDetails')}
            className={cn(
              'app-titlebar-control min-h-[44px] min-w-[44px] h-7 w-7 p-1.5 shrink-0 rounded-lg text-text-secondary',
              'flex items-center justify-center transition-colors',
              'hover:bg-border-subtle hover:text-text-primary',
              'focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2',
            )}
          >
            <SidebarToggleIcon isOpen={detailsOpen} side="right" />
          </button>
        </div>
      )}

      <div className="app-titlebar-control h-12 self-stretch flex items-stretch shrink-0 pr-3 gap-1">
        <button
          type="button"
          aria-label={t('window.minimize')}
          title={t('window.minimize')}
          onClick={() => window.api?.windowMinimize()}
          className="h-8 w-10 my-2 rounded-md flex items-center justify-center text-text-secondary hover:bg-text-primary/[0.09] hover:text-text-primary transition-colors"
        >
          <Minus size={14} />
        </button>
        <button
          type="button"
          aria-label={maximized ? t('window.restore') : t('window.maximize')}
          title={maximized ? t('window.restore') : t('window.maximize')}
          onClick={() => void window.api?.windowToggleMaximize()}
          className="h-8 w-10 my-2 rounded-md flex items-center justify-center text-text-secondary hover:bg-text-primary/[0.09] hover:text-text-primary transition-colors"
        >
          {maximized ? <RestoreIcon /> : <MaximizeIcon />}
        </button>
        <button
          type="button"
          aria-label={t('window.close')}
          title={t('window.close')}
          onClick={() => window.api?.windowClose()}
          className="h-8 w-10 my-2 rounded-md flex items-center justify-center text-text-secondary hover:bg-error/20 hover:text-error transition-colors"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
