'use client';

// Sidebar izquierdo de la app: flota en la vista chronometric y es inline en
// la clásica. Contiene el chooser de repos, las secciones del repositorio
// (branches locales/remotas, PRs, stash, tags, worktrees, submodules) y las
// listas de secciones de Settings/Help/Profile, más el footer con los accesos
// a Settings/Help/perfil. Extraído de app/page.tsx.
//
// Lee del store lo que es global (branches, stashes, tags, githubUser, …) y
// ejecuta él mismo las acciones de stash/tag-push. Todo lo que abre modales o
// toca estado propio de la página (context menus, confirmaciones, secciones
// activas, layout) llega por props.

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Activity, AlertCircle, AlertTriangle, Archive, ArrowLeft, Boxes, Check, CheckCircle2,
  ChevronDown, Cloud, Cpu, Download, Edit2, ExternalLink, FileInput, FileText,
  Folder, FolderOpen, FolderTree, GitBranch, GitMerge, GitPullRequest, Github, Globe, HelpCircle, Layers,
  Link2, Lock, Map, Monitor, Plus, Redo, RefreshCw, RotateCcw, Server, Settings,
  SlidersHorizontal, Sparkles, Tag, Terminal, Trash2, TreePine, Type, Undo, Upload,
  UserCircle2, Zap,
} from 'lucide-react';
import { useGitStore } from '@/lib/git-store';
import { useGitActions } from '@/hooks/use-git-actions';
import { useT } from '@/hooks/use-translation';
import { cn } from '@/lib/utils';
import { userInitials } from '@/lib/page-helpers';
import { UpdateControls } from '@/components/UpdateControls';
import { FetchIndicator, ToolbarButton } from '@/components/PageWidgets';
import { GraphSearchControl } from '@/components/GraphSearchControl';
import { useSidebarSectionState } from '@/hooks/use-sidebar-section-state';
import type { UpdateStatus, UpdateInfo } from '@/hooks/use-app-update';
import type { RepoStartMode } from '@/components/RepoModals';
import type { PullRequestEntry, RemoteEntry, WorktreeEntry, SubmoduleEntry } from '@/types/electron';
import {
  BranchTree,
  RemoteBranchTree,
  SidebarItem,
  SidebarSection,
  StashItem,
  TagItem,
} from '@/components/RepoSidebarParts';

type AppView = 'repository' | 'settings' | 'help' | 'profile';

export interface DropdownMenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  disabled?: boolean;
  active?: boolean;
  onClick: () => void;
}

interface SidebarDropdownProps {
  id: string;
  label: string;
  icon?: React.ReactNode;
  items: DropdownMenuItem[];
  disabled?: boolean;
  className?: string;
  menuClassName?: string;
  fullWidth?: boolean;
}

export function SidebarDropdown({
  id,
  label,
  icon,
  items,
  disabled = false,
  className,
  menuClassName,
  fullWidth = false,
}: SidebarDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const closeMenu = useCallback((restoreFocus = true) => {
    setIsOpen(false);
    setFocusedIndex(-1);
    if (restoreFocus) {
      triggerRef.current?.focus();
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent | PointerEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        closeMenu(false);
      }
    };
    document.addEventListener('pointerdown', handleClickOutside);
    return () => document.removeEventListener('pointerdown', handleClickOutside);
  }, [isOpen, closeMenu]);

  useEffect(() => {
    if (isOpen && focusedIndex >= 0 && focusedIndex < items.length) {
      itemRefs.current[focusedIndex]?.focus();
    }
  }, [isOpen, focusedIndex, items.length]);

  const handleTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setIsOpen(true);
      setFocusedIndex(0);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIsOpen(true);
      setFocusedIndex(items.length - 1);
    }
  };

  const handleMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeMenu(true);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusedIndex((prev) => {
        let next = (prev + 1) % items.length;
        while (items[next]?.disabled && next !== prev) {
          next = (next + 1) % items.length;
        }
        return next;
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusedIndex((prev) => {
        let next = (prev - 1 + items.length) % items.length;
        while (items[next]?.disabled && next !== prev) {
          next = (next - 1 + items.length) % items.length;
        }
        return next;
      });
    } else if (e.key === 'Home') {
      e.preventDefault();
      setFocusedIndex(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setFocusedIndex(items.length - 1);
    } else if (e.key === 'Tab') {
      closeMenu(false);
    }
  };

  const handleItemClick = (item: DropdownMenuItem) => {
    if (item.disabled) return;
    item.onClick();
    closeMenu(true);
  };

  return (
    <div className={cn('relative inline-block text-left', fullWidth && 'w-full')} onKeyDown={handleMenuKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        id={`${id}-trigger`}
        disabled={disabled}
        onClick={() => {
          if (isOpen) {
            closeMenu(false);
          } else {
            setIsOpen(true);
            setFocusedIndex(0);
          }
        }}
        onKeyDown={handleTriggerKeyDown}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={`${id}-menu`}
        className={cn(
          'min-h-[38px] pl-1 pr-2 py-1 rounded-lg text-[length:var(--font-size-lg)] font-bold tracking-tight transition-colors inline-flex items-center gap-1.5',
          'text-text-primary hover:bg-text-primary/10',
          'focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2',
          isOpen && 'bg-text-primary/10 text-secondary',
          disabled && 'opacity-40 cursor-not-allowed pointer-events-none',
          fullWidth && 'w-full justify-between',
          className
        )}
      >
        <div className="flex items-center gap-2 min-w-0">
          {icon && <span className="shrink-0 text-text-secondary/80 flex items-center justify-center w-4 h-4">{icon}</span>}
          <span className="truncate text-[length:var(--font-size-lg)] font-bold">{label}</span>
        </div>
        <ChevronDown size={14} className={cn('transition-transform duration-150 shrink-0 opacity-70', isOpen && 'rotate-180 text-secondary opacity-100')} />
      </button>

      {isOpen && (
        <div
          ref={menuRef}
          id={`${id}-menu`}
          role="menu"
          aria-labelledby={`${id}-trigger`}
          className={cn(
            'absolute left-0 top-full mt-1 min-w-56 rounded-xl bg-bg-surface shadow-xl py-1 z-50 animate-in fade-in zoom-in-95 duration-100',
            fullWidth && 'w-full',
            menuClassName
          )}
        >
          {items.map((item, index) => (
            <button
              key={item.id}
              ref={(el) => { itemRefs.current[index] = el; }}
              role="menuitem"
              type="button"
              disabled={item.disabled}
              aria-current={item.active ? 'page' : undefined}
              tabIndex={focusedIndex === index ? 0 : -1}
              onClick={() => handleItemClick(item)}
              className={cn(
                'w-full px-3 py-2 flex items-center justify-between text-xs transition-colors text-left min-h-[44px]',
                item.disabled
                  ? 'opacity-40 cursor-not-allowed'
                  : item.active
                  ? 'bg-secondary/15 text-secondary font-semibold'
                  : focusedIndex === index
                  ? 'bg-text-primary/10 text-text-primary'
                  : 'text-text-secondary hover:bg-text-primary/10 hover:text-text-primary',
                'focus-visible:outline-none'
              )}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                {item.icon && <span className="shrink-0 opacity-80">{item.icon}</span>}
                <span className="truncate font-medium">{item.label}</span>
              </div>
              {item.shortcut && (
                <kbd className="ml-2 px-1.5 py-0.5 text-[length:var(--font-size-2xs)] font-mono rounded bg-text-primary/[0.06] text-text-secondary/70 shrink-0">
                  {item.shortcut}
                </kbd>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SidebarRemoteItem({
  remote,
  onRename,
  onSetUrl,
  onDelete,
}: {
  remote: RemoteEntry;
  onRename: () => void;
  onSetUrl: () => void;
  onDelete: () => void;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const t = useT();
  const titleText = `${remote.name}\nFetch: ${remote.fetchUrl || '-'}\nPush: ${remote.pushUrl || '-'}`;
  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="px-3 py-1 flex items-center gap-3 text-sm text-text-secondary hover:bg-border-subtle hover:text-text-primary transition-colors group relative"
      title={titleText}
    >
      <Globe size={14} className="shrink-0 text-text-secondary" />
      <div className="flex-1 min-w-0">
        <span className="truncate text-xs font-semibold block select-text">{remote.name}</span>
        <span className="truncate text-[length:var(--font-size-xs)] text-text-secondary/70 block select-text font-mono">{remote.fetchUrl}</span>
      </div>
      <div className={cn(
        'flex items-center gap-1 shrink-0 z-10 transition-opacity',
        isHovered ? 'opacity-100' : 'opacity-0 group-focus-within:opacity-100',
      )}>
        <button
          onClick={(e) => { e.stopPropagation(); onSetUrl(); }}
          className="p-1 hover:text-secondary transition-colors"
          title={t('sidebar.remoteSetUrl')}
        >
          <Link2 size={12} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onRename(); }}
          className="p-1 hover:text-secondary transition-colors"
          title={t('sidebar.remoteRename')}
        >
          <Edit2 size={12} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="p-1 hover:text-error transition-colors"
          title={t('sidebar.remoteRemove')}
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

function SidebarWorktreeItem({
  wt,
  onOpen,
  onDelete,
  isMain,
}: {
  wt: WorktreeEntry;
  onOpen: () => void;
  onDelete: () => void;
  isMain: boolean;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const t = useT();
  const name = wt.path.split(/[/\\]/).pop() || wt.path;
  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="px-3 py-1 flex items-center gap-3 text-sm text-text-secondary hover:bg-border-subtle hover:text-text-primary transition-colors group relative"
      title={wt.path}
    >
      <button
        onClick={onOpen}
        className="flex-1 min-w-0 text-left flex items-center gap-3"
      >
        <TreePine size={14} className={cn("shrink-0", isMain ? "text-secondary" : "text-primary")} />
        <span className="truncate text-xs flex-1 select-text">{name}</span>
        {wt.branch && (
          <span className="text-[length:var(--font-size-xs)] font-mono text-text-secondary/70 shrink-0 bg-bg-surface px-1 rounded">{wt.branch}</span>
        )}
      </button>
      {!isMain && (
        <div className={cn(
          'flex items-center gap-1 shrink-0 z-10 transition-opacity',
          isHovered ? 'opacity-100' : 'opacity-0 group-focus-within:opacity-100',
        )}>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="p-1 hover:text-error transition-colors"
            title={t('sidebar.worktreeRemove')}
          >
            <Trash2 size={12} />
          </button>
        </div>
      )}
    </div>
  );
}

function SidebarSubmoduleItem({
  sm,
  onUpdate,
  onSync,
}: {
  sm: SubmoduleEntry;
  onUpdate: () => void;
  onSync: () => void;
  }) {
  const [isHovered, setIsHovered] = useState(false);
  const t = useT();
  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="px-3 py-1.5 flex items-center gap-3 text-sm text-text-secondary hover:bg-border-subtle hover:text-text-primary transition-colors group relative"
      title={`${sm.path}\nCommit: ${sm.hash}`}
    >
      <Layers size={14} className="shrink-0 text-text-secondary" />
      <div className="flex-1 min-w-0">
        <span className="truncate text-xs block select-text font-medium">{sm.path}</span>
        <span className="truncate text-[length:var(--font-size-xs)] text-text-secondary/70 block select-text font-mono">{sm.hash.slice(0, 7)}</span>
      </div>
      <div className={cn(
        'flex items-center gap-1 shrink-0 z-10 transition-opacity',
        isHovered ? 'opacity-100' : 'opacity-0 group-focus-within:opacity-100',
      )}>
        <button
          onClick={(e) => { e.stopPropagation(); onUpdate(); }}
          className="p-1 hover:text-secondary transition-colors"
          title={t('sidebar.submoduleUpdate')}
        >
          <RefreshCw size={12} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onSync(); }}
          className="p-1 hover:text-secondary transition-colors"
          title={t('sidebar.submoduleSync')}
        >
          <Link2 size={12} />
        </button>
      </div>
    </div>
  );
}



type RepoSidebarProps = {
  // layout (estado de usePanelLayout, que vive en la página)
  graphMode: 'classic' | 'chronometric';
  activeGraphMode?: 'classic' | 'chronometric';
  onChangeGraphMode?: (mode: 'classic' | 'chronometric') => void;
  enableCronometric?: boolean;
  sidebarW: number;
  sidebarOpen: boolean;
  isDragging: boolean;
  onResizeStart: (e: React.MouseEvent) => void;
  // vistas
  activeView: AppView;
  onViewChange: (view: AppView) => void;
  isRepoStartView: boolean;
  repoStartMode: RepoStartMode;
  onRepoStartModeChange: (mode: RepoStartMode) => void;
  onCloseRepoChooser: () => void;
  // interacciones de branches (abren menús/modales de la página)
  selectedBranchName: string | null;
  onCheckoutAttempt: (branch: string) => void;
  onSelectBranchInGraph: (branch: string) => void;
  onBranchContextMenu: (menu: { x: number; y: number; branch: string }) => void;
  onRemoteBranchContextMenu: (menu: { x: number; y: number; branch: string }) => void;
  onDeleteBranchRequest: (branch: string) => void;
  // pull requests
  selectedPullRequest: PullRequestEntry | null;
  onSelectPullRequest: (pr: PullRequestEntry) => void;
  // stash/tags (modales de la página)
  onPreviewStash: (stash: { index: number; message: string }) => void;
  onCreateTagRequest: () => void;
  onDeleteTagRequest: (tag: string) => void;
  // secciones activas de settings/help (compartidas con los paneles del main)
  selectedSettingsSection: string;
  onSettingsSectionChange: (id: string) => void;
  selectedHelpSection: string;
  onHelpSectionChange: (id: string) => void;
  // Cartografía: toggle del sub-estado per-repo (entrar/volver al grafo). El
  // botón sólo se muestra con el flag on y un repo activo (ambos leídos del store).
  onToggleCartography: () => void;

  // navegación entre vistas
  activeTab?: string;
  onTabChange?: (tab: string) => void;

  // búsqueda en grafo
  filterText?: string;
  onFilterTextChange?: (value: string) => void;
  searchOpen?: boolean;
  onSearchOpenChange?: (open: boolean) => void;

  // acciones git del repositorio
  onPullIntent?: () => void;
  onPushIntent?: () => void;
  onNewBranchRequest?: () => void;
  onOpenStashModal?: () => void;
  onFetchNow?: () => void | Promise<void>;
  onUndo?: () => void;
  onRedo?: () => void;

  // updates
  updateStatus?: UpdateStatus;
  updateInfo?: UpdateInfo | null;
  downloadProgress?: number;
  showUpdateMenu?: boolean;
  setShowUpdateMenu?: React.Dispatch<React.SetStateAction<boolean>>;
  updateMenuRef?: React.RefObject<HTMLDivElement | null>;
  onCheckForUpdate?: () => void | Promise<void>;
  onDownloadUpdate?: () => void | Promise<void>;
  onInstallUpdate?: () => void | Promise<void>;

  // remotes
  onAddRemoteRequest?: () => void;
  onRenameRemoteRequest?: (remote: RemoteEntry) => void;
  onSetRemoteUrlRequest?: (remote: RemoteEntry) => void;
  onDeleteRemoteRequest?: (remote: RemoteEntry) => void;
  // worktrees
  onAddWorktreeRequest?: () => void;
  onDeleteWorktreeRequest?: (wt: WorktreeEntry) => void;
  // submodules
  onAddSubmoduleRequest?: () => void;
  onUpdateSubmodule?: (path?: string) => void;
  onSyncSubmodules?: () => void;
};

export function RepoSidebar({
  graphMode, activeGraphMode = graphMode, onChangeGraphMode, enableCronometric,
  sidebarW, sidebarOpen, isDragging, onResizeStart,
  activeView, onViewChange, isRepoStartView,
  repoStartMode, onRepoStartModeChange, onCloseRepoChooser,
  selectedBranchName, onCheckoutAttempt, onSelectBranchInGraph,
  onBranchContextMenu, onRemoteBranchContextMenu, onDeleteBranchRequest,
  selectedPullRequest, onSelectPullRequest,
  onPreviewStash, onCreateTagRequest, onDeleteTagRequest,
  selectedSettingsSection, onSettingsSectionChange,
  selectedHelpSection, onHelpSectionChange,
  onToggleCartography,
  onAddRemoteRequest, onRenameRemoteRequest, onSetRemoteUrlRequest, onDeleteRemoteRequest,
  onAddWorktreeRequest, onDeleteWorktreeRequest,
  onAddSubmoduleRequest, onUpdateSubmodule, onSyncSubmodules,
  activeTab = 'Graph', onTabChange = () => {},
  filterText, onFilterTextChange, searchOpen, onSearchOpenChange,
  onPullIntent, onPushIntent, onNewBranchRequest, onOpenStashModal, onFetchNow, onUndo, onRedo,
  updateStatus = 'idle', updateInfo = null, downloadProgress = 0,
  showUpdateMenu = false, setShowUpdateMenu = () => {}, updateMenuRef = { current: null },
  onCheckForUpdate = () => {}, onDownloadUpdate = () => {}, onInstallUpdate = () => {},
}: RepoSidebarProps) {
  const t = useT();
  const {
    repoPath, branches, currentBranch, remoteBranches, branchTracking,
    stashes, tags, submodules, remotes, worktrees, pullRequests,
    githubUser, selectedCommit, modifiedFiles, isLoading,
  } = useGitStore();
  const enableCartography = useGitStore((s) => s.enableCartography);
  const inCartography = useGitStore((s) => s.getActiveRepo()?.inCartography ?? false);
  const cartographyActive = activeView === 'repository' && inCartography;
  const sectionState = useSidebarSectionState(repoPath);
  const { stashApply, stashPop, stashDrop, stashClear, pushTag, applyPatchFile, openTerminal } = useGitActions();
  const [showStashClearConfirm, setShowStashClearConfirm] = useState(false);

  const viewOptions = [
    { key: 'Commit', label: t('tab.commit'), icon: <FileText size={14} />, shortcut: 'Ctrl + Shift + C' },
    { key: 'Graph', label: t('tab.graph'), icon: <GitMerge size={14} />, shortcut: 'Ctrl + G' },
    { key: 'History', label: t('tab.history'), icon: <RotateCcw size={14} />, shortcut: 'Ctrl + H' },
    { key: 'Pipeline', label: t('tab.pipeline'), icon: <Zap size={14} />, shortcut: 'Ctrl + Shift + O' },
    { key: 'AiHistory', label: t('tab.aiHistory'), icon: <Sparkles size={14} /> },
  ];
  const currentView = viewOptions.find((v) => v.key === activeTab) ?? viewOptions[0];

  const viewMenuItems: DropdownMenuItem[] = viewOptions.map((v) => ({
    id: v.key,
    label: v.label,
    icon: v.icon,
    shortcut: v.shortcut,
    active: v.key === activeTab,
    onClick: () => {
      if (activeView !== 'repository') {
        onViewChange('repository');
      }
      onTabChange(v.key);
    },
  }));

  // Filtrado de ramas por texto
  const filterLower = (filterText || '').toLowerCase().trim();
  const filteredLocalBranches = branches.filter((b) => !filterLower || b.toLowerCase().includes(filterLower));
  const filteredRemoteBranches = remoteBranches.filter((b) => !filterLower || b.toLowerCase().includes(filterLower));

  const quickActions = [
    {
      id: 'pull',
      label: t('toolbar.pull'),
      icon: <Download size={14} className="shrink-0 opacity-80" />,
      disabled: !repoPath || isLoading,
      onClick: onPullIntent || (() => {}),
    },
    {
      id: 'push',
      label: t('toolbar.push'),
      icon: <Upload size={14} className="shrink-0 opacity-80" />,
      disabled: !repoPath || isLoading,
      onClick: onPushIntent || (() => {}),
    },
    {
      id: 'new-branch',
      label: t('toolbar.newBranch'),
      icon: <GitBranch size={14} className="shrink-0 opacity-80" />,
      shortcut: 'Ctrl + B',
      disabled: !repoPath,
      onClick: onNewBranchRequest || (() => {}),
    },
    {
      id: 'stash',
      label: t('toolbar.stash'),
      icon: <Archive size={14} className="shrink-0 opacity-80" />,
      disabled: !repoPath || isLoading,
      onClick: onOpenStashModal || (() => {}),
    },
    {
      id: 'apply-patch',
      label: t('toolbar.applyPatchTooltip'),
      icon: <FileInput size={14} className="shrink-0 opacity-80" />,
      disabled: !repoPath || isLoading,
      onClick: () => { void applyPatchFile(); },
    },
  ];

  return (
    <aside
      className={cn(
        "flex flex-col overflow-hidden z-30 relative bg-bg-surface shrink-0",
        !isDragging && "transition-all duration-300"
      )}
      style={{
        width: sidebarOpen ? sidebarW : 0,
        minWidth: sidebarOpen ? 200 : 0,
        maxWidth: 480,
        opacity: sidebarOpen ? 1 : 0,
        visibility: sidebarOpen ? 'visible' : 'hidden',
      }}
    >
      {/* Right-edge resize handle */}
      <div
        onMouseDown={onResizeStart}
        className="group absolute top-0 right-0 h-full w-2 cursor-col-resize z-40"
        title={t('sidebar.resizeHandle')}
      >
        <div className="absolute inset-y-3 right-0.5 w-px bg-transparent group-hover:bg-secondary/45 group-active:bg-secondary/70 transition-colors" />
      </div>

      <div className="flex flex-col flex-1 min-h-0">
        {/* Repo header / start repo selector */}
        {isRepoStartView ? (
          <div className="px-3 pt-3 pb-2 flex items-center justify-between gap-2 shrink-0">
            <span className="text-xs font-bold text-text-primary uppercase tracking-wider">{t('sidebar.startRepo')}</span>
            <button
              type="button"
              onClick={onCloseRepoChooser}
              title={t('common.close')}
              className="p-1 rounded text-text-secondary hover:text-text-primary hover:bg-text-primary/10 transition-colors"
            >
              <ArrowLeft size={14} />
            </button>
          </div>
        ) : null}

        {/* View content */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <AnimatePresence mode="wait" initial={false}>
            {activeView === 'repository' ? (
              isRepoStartView ? (
                <motion.div
                  key="repo-start"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="flex-1 overflow-y-auto px-2 py-2"
                >
                  <div className="space-y-1">
                    {[
                      { id: 'open' as const, label: t('start.openExisting'), icon: <FolderOpen size={14} /> },
                      { id: 'create' as const, label: t('start.initNew'), icon: <Sparkles size={14} /> },
                      { id: 'clone' as const, label: t('start.cloneRemote'), icon: <Download size={14} /> },
                    ].map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => onRepoStartModeChange(item.id)}
                        className={cn(
                          'w-full px-3 py-2 rounded-lg text-xs font-semibold tracking-wide transition-colors flex items-center gap-2.5 text-left relative min-h-[44px]',
                          repoStartMode === item.id
                            ? 'bg-secondary/10 text-secondary'
                            : 'text-text-secondary hover:bg-bg-surface/70 hover:text-text-primary',
                        )}
                      >
                        {repoStartMode === item.id && <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-secondary" />}
                        <span className={cn('shrink-0', repoStartMode === item.id ? 'text-secondary' : 'text-text-secondary/70')}>{item.icon}</span>
                        <span className="truncate">{item.label}</span>
                      </button>
                    ))}
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="repository"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="flex flex-col flex-1 min-h-0"
                >
                  {/* ── CABECERA FIJA DEL LATERAL (No se desplaza al recorrer ramas) ── */}
                  <div className="shrink-0 bg-bg-surface flex flex-col">
                    {/* 1. Selector de vistas + Terminal + Sincronización + Búsqueda */}
                    <div className="px-2 pt-2 pb-1 flex items-center justify-between gap-1 shrink-0">
                      <div className="flex items-center min-w-0">
                        <nav
                          aria-label={t('sidebar.navigation')}
                          className="min-w-0"
                        >
                          <SidebarDropdown
                            id="sidebar-view-selector"
                            label={currentView.label}
                            icon={currentView.icon}
                            items={viewMenuItems}
                          />
                        </nav>
                      </div>

                      <div className="shrink-0 flex items-center gap-1">
                        <ToolbarButton
                          icon={<Terminal size={14} />}
                          onClick={() => { void openTerminal(); }}
                          title={t('toolbar.terminal')}
                          disabled={!repoPath}
                        />
                        <FetchIndicator onClick={onFetchNow || (() => {})} />
                        {onFilterTextChange && (
                          <GraphSearchControl
                            filterText={filterText || ''}
                            onFilterTextChange={onFilterTextChange}
                            disabled={!repoPath}
                            open={searchOpen || false}
                            onOpenChange={onSearchOpenChange || (() => {})}
                          />
                        )}
                      </div>
                    </div>

                    {/* 2. Acciones fila por fila (al estilo Codex) */}
                    <div className="px-2 pt-1 pb-3 space-y-0.5 shrink-0 border-b border-border-subtle/20 mb-2">
                      {quickActions.map((action) => (
                        <button
                          key={action.id}
                          type="button"
                          onClick={action.onClick}
                          disabled={action.disabled}
                          title={action.label}
                          aria-label={action.label}
                          className={cn(
                            'w-full pl-1.5 pr-2 py-1 rounded-md text-xs font-medium tracking-wide transition-colors flex items-center justify-between text-left min-h-[30px]',
                            'text-text-secondary hover:bg-text-primary/10 hover:text-text-primary',
                            'focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2',
                            action.disabled && 'opacity-40 cursor-not-allowed pointer-events-none'
                          )}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            {action.icon}
                            <span className="truncate font-medium">{action.label}</span>
                          </div>
                          {action.shortcut && (
                            <kbd className="ml-2 px-1.5 py-0.5 text-[length:var(--font-size-2xs)] font-mono rounded bg-text-primary/[0.06] text-text-secondary/70 shrink-0">
                              {action.shortcut}
                            </kbd>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* ── CUERPO DE SECCIONES CON SCROLL (Solo esto se desplaza) ── */}
                  <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin pt-1 pb-2 px-1 space-y-0.5">
                    <div data-testid="sidebar-branches-sections">
                        <div className="px-3 pt-1 pb-1 text-xs font-bold uppercase tracking-wider text-text-secondary/70 select-none">
                          {t('sidebar.branchesAndRefs')}
                        </div>
                        {/* LOCAL — folder tree + ahead/behind chips */}
                        <SidebarSection
                          title={t('sidebar.local')}
                          count={branches.length || undefined}
                          icon={<Monitor size={13} aria-hidden="true" />}
                          isOpen={sectionState.isOpen('local')}
                          onToggle={() => sectionState.toggle('local')}
                        >
                          {branches.length === 0 && !repoPath && (
                            <p className="px-4 py-2 text-xs text-text-secondary italic">{t('sidebar.noBranches')}</p>
                          )}
                          <BranchTree
                            branches={branches}
                            currentBranch={currentBranch}
                            selectedBranch={selectedBranchName}
                            tracking={branchTracking}
                            onCheckout={(b) => onCheckoutAttempt(b)}
                            onSelect={onSelectBranchInGraph}
                            onContextMenu={(e, b) => {
                              e.preventDefault();
                              onBranchContextMenu({ x: e.clientX, y: e.clientY, branch: b });
                            }}
                            onDelete={(b) => onDeleteBranchRequest(b)}
                          />
                        </SidebarSection>

                        {/* REMOTE branches (also as tree, grouped by 'origin/...') */}
                        <SidebarSection
                          title={t('sidebar.remote')}
                          count={remoteBranches.length || undefined}
                          icon={<Cloud size={13} aria-hidden="true" />}
                          isOpen={sectionState.isOpen('remote')}
                          onToggle={() => sectionState.toggle('remote')}
                        >
                          <RemoteBranchTree
                            branches={remoteBranches}
                            onCheckout={(b) => onCheckoutAttempt(b)}
                            onContextMenu={(e, b) => {
                              e.preventDefault();
                              onRemoteBranchContextMenu({ x: e.clientX, y: e.clientY, branch: b });
                            }}
                          />
                        </SidebarSection>

                        {/* PULL REQUESTS — only when logged in to GitHub */}
                        {githubUser && (
                          <SidebarSection
                            title={t('sidebar.pullRequests')}
                            count={pullRequests.length || undefined}
                            icon={<GitPullRequest size={13} aria-hidden="true" />}
                            isOpen={sectionState.isOpen('pullRequests')}
                            onToggle={() => sectionState.toggle('pullRequests')}
                          >
                            {pullRequests.length === 0 && (
                              <p className="px-4 py-1 text-[length:var(--font-size-xs)] text-text-secondary italic">{t('sidebar.noPRs')}</p>
                            )}
                            {pullRequests.map((pr) => (
                              <div
                                key={pr.number}
                                className={cn(
                                  'group flex items-stretch text-sm transition-colors',
                                  selectedPullRequest?.number === pr.number
                                    ? 'bg-secondary/10 text-text-primary'
                                    : 'text-text-secondary hover:bg-bg-surface/70 hover:text-text-primary',
                                )}
                              >
                                <button
                                  type="button"
                                  onClick={() => onSelectPullRequest(pr)}
                                  title={t('prDiff.view', { number: String(pr.number) })}
                                  className="flex-1 min-w-0 text-left px-3 py-1.5 flex items-start gap-2"
                                >
                                  <GitMerge size={14} className={cn('shrink-0 mt-0.5', pr.draft ? 'text-text-secondary' : 'text-secondary')} />
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1">
                                      <span className="text-[length:var(--font-size-2xs)] font-mono text-text-secondary/70">#{pr.number}</span>
                                      {pr.draft && <span className="text-[length:var(--font-size-2xs)] text-text-secondary/70 uppercase">{t('sidebar.draft')}</span>}
                                    </div>
                                    <p className="text-xs truncate">{pr.title}</p>
                                    <div className="mt-0.5 flex items-center gap-2 text-[length:var(--font-size-xs)] font-mono text-text-secondary/70">
                                      <span className="truncate">{pr.branch}</span>
                                      <span className="text-secondary">+{pr.additions}</span>
                                      <span className="text-error">-{pr.deletions}</span>
                                    </div>
                                  </div>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => window.api?.shellOpenExternal(pr.url)}
                                  title={t('sidebar.openInGitHub', { number: String(pr.number) })}
                                  className="w-8 shrink-0 flex items-center justify-center text-text-secondary/70 hover:text-secondary opacity-0 group-hover:opacity-100 transition"
                                >
                                  <ExternalLink size={12} />
                                </button>
                              </div>
                            ))}
                          </SidebarSection>
                        )}

                        {/* STASH */}
                        <SidebarSection
                          title={t('sidebar.stash')}
                          count={stashes.length || undefined}
                          icon={<Archive size={13} aria-hidden="true" />}
                          isOpen={sectionState.isOpen('stashes')}
                          onToggle={() => sectionState.toggle('stashes')}
                          extra={stashes.length > 1 ? (
                            showStashClearConfirm ? (
                              <div className="flex items-center gap-1 ml-1">
                                <button
                                  onClick={async () => { await stashClear(); setShowStashClearConfirm(false); }}
                                  className="text-[length:var(--font-size-2xs)] px-1.5 py-0.5 rounded bg-error text-white font-bold"
                                >
                                  Sí, limpiar
                                </button>
                                <button
                                  onClick={() => setShowStashClearConfirm(false)}
                                  className="text-[length:var(--font-size-2xs)] px-1.5 py-0.5 rounded bg-border-subtle text-text-secondary"
                                >
                                  No
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setShowStashClearConfirm(true)}
                                className="text-[length:var(--font-size-xs)] text-text-secondary hover:text-error transition-colors ml-1 font-medium"
                                title={t('sidebar.stashDropAll')}
                              >
                                limpiar todo
                              </button>
                            )
                          ) : undefined}
                        >
                          {stashes.length === 0 && repoPath && (
                            <p className="px-4 py-1 text-[length:var(--font-size-xs)] text-text-secondary italic">{t('sidebar.noStashes')}</p>
                          )}
                          {stashes.map((s) => (
                            <StashItem
                              key={s.index}
                              stash={s}
                              onApply={() => stashApply(s.index)}
                              onPop={() => stashPop(s.index)}
                              onPreview={() => onPreviewStash(s)}
                              onDrop={() => stashDrop(s.index)}
                            />
                          ))}
                        </SidebarSection>

                        {/* TAGS */}
                        <SidebarSection
                          title={t('sidebar.tags')}
                          count={tags.length || undefined}
                          icon={<Tag size={13} aria-hidden="true" />}
                          isOpen={sectionState.isOpen('tags')}
                          onToggle={() => sectionState.toggle('tags')}
                          extra={repoPath ? (
                            <button
                              type="button"
                              onClick={onCreateTagRequest}
                              className="p-1 rounded text-text-secondary hover:text-secondary hover:bg-secondary/10 transition-colors"
                              title={selectedCommit ? t('commitMenu.createTag') : `${t('commitMenu.createTag')} (HEAD)`}
                              aria-label={selectedCommit ? t('commitMenu.createTag') : `${t('commitMenu.createTag')} (HEAD)`}
                            >
                              <Plus size={12} />
                            </button>
                          ) : undefined}
                        >
                          {tags.length === 0 && repoPath && (
                            <p className="px-4 py-1 text-[length:var(--font-size-xs)] text-text-secondary italic">{t('sidebar.noTags')}</p>
                          )}
                          {tags.map((tg) => (
                            <TagItem key={tg} name={tg} onDelete={() => onDeleteTagRequest(tg)} onPush={() => pushTag(tg)} />
                          ))}
                        </SidebarSection>

                        {/* REMOTES */}
                        {repoPath && (
                          <SidebarSection
                            title={t('sidebar.remotes')}
                            count={remotes.length || undefined}
                            icon={<Server size={13} aria-hidden="true" />}
                            isOpen={sectionState.isOpen('remotes')}
                            onToggle={() => sectionState.toggle('remotes')}
                            extra={(
                              <button
                                type="button"
                                onClick={onAddRemoteRequest}
                                className="p-1 rounded text-text-secondary hover:text-secondary hover:bg-secondary/10 transition-colors"
                                title={t('sidebar.remoteAdd')}
                              >
                                <Plus size={12} />
                              </button>
                            )}
                          >
                            {remotes.length === 0 && (
                              <p className="px-4 py-1 text-[length:var(--font-size-xs)] text-text-secondary italic">{t('sidebar.noRemotes')}</p>
                            )}
                            {remotes.map((rm) => (
                              <SidebarRemoteItem
                                key={rm.name}
                                remote={rm}
                                onRename={() => onRenameRemoteRequest?.(rm)}
                                onSetUrl={() => onSetRemoteUrlRequest?.(rm)}
                                onDelete={() => onDeleteRemoteRequest?.(rm)}
                              />
                            ))}
                          </SidebarSection>
                        )}

                        {/* WORKTREES — git's native feature for multiple checkouts of the same repo */}
                        {repoPath && (
                          <SidebarSection
                            title={t('sidebar.worktrees')}
                            count={worktrees.length > 1 ? worktrees.length - 1 : undefined}
                            icon={<FolderTree size={13} aria-hidden="true" />}
                            isOpen={sectionState.isOpen('worktrees')}
                            onToggle={() => sectionState.toggle('worktrees')}
                            extra={(
                              <button
                                type="button"
                                onClick={onAddWorktreeRequest}
                                className="p-1 rounded text-text-secondary hover:text-secondary hover:bg-secondary/10 transition-colors"
                                title={t('sidebar.worktreeAdd')}
                              >
                                <Plus size={12} />
                              </button>
                            )}
                          >
                            {worktrees.length <= 1 ? (
                              <p className="px-4 py-1 text-[length:var(--font-size-xs)] text-text-secondary italic">{t('sidebar.noWorktrees')}</p>
                            ) : (
                              worktrees.map((wt) => {
                                const isMain = wt.path.replace(/\\/g, '/').toLowerCase() === repoPath.replace(/\\/g, '/').toLowerCase();
                                if (isMain) return null;
                                return (
                                  <SidebarWorktreeItem
                                    key={wt.path}
                                    wt={wt}
                                    isMain={isMain}
                                    onOpen={() => window.api?.shellOpenPath(wt.path)}
                                    onDelete={() => onDeleteWorktreeRequest?.(wt)}
                                  />
                                );
                              })
                            )}
                          </SidebarSection>
                        )}

                        {/* SUBMODULES */}
                        {repoPath && (
                          <SidebarSection
                            title={t('sidebar.submodules')}
                            count={submodules.length || undefined}
                            icon={<Boxes size={13} aria-hidden="true" />}
                            isOpen={sectionState.isOpen('submodules')}
                            onToggle={() => sectionState.toggle('submodules')}
                            extra={(
                              <button
                                type="button"
                                onClick={onAddSubmoduleRequest}
                                className="p-1 rounded text-text-secondary hover:text-secondary hover:bg-secondary/10 transition-colors"
                                title={t('sidebar.submoduleAdd')}
                              >
                                <Plus size={12} />
                              </button>
                            )}
                          >
                            {submodules.length === 0 ? (
                              <p className="px-4 py-1 text-[length:var(--font-size-xs)] text-text-secondary italic">{t('sidebar.noSubmodules')}</p>
                            ) : (
                              submodules.map((sm) => (
                                <SidebarSubmoduleItem
                                  key={sm.path}
                                  sm={sm}
                                  onUpdate={() => onUpdateSubmodule?.(sm.path)}
                                  onSync={() => onSyncSubmodules?.()}
                                />
                              ))
                            )}
                          </SidebarSection>
                        )}
                      </div>
                    </div>
                  </motion.div>
              )
            ) : activeView === 'settings' ? (
              <motion.div
                key="settings"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="flex flex-col h-full select-none"
              >
                <div className="px-4 py-2 flex items-center justify-between">
                  <span className="font-bold text-secondary flex items-center gap-1.5 text-xs uppercase tracking-wider">
                  <Settings size={14} /> {t('settings.title')}
                </span>
                <button
                  onClick={() => onViewChange('repository')}
                  className="text-text-secondary hover:text-text-primary text-[length:var(--font-size-2xs)] uppercase font-bold flex items-center gap-1"
                  title={t('common.backToRepo')}
                >
                  <ArrowLeft size={12} />
                </button>
              </div>
              <div className="py-2 space-y-0.5">
                {[
                  { id: 'language', label: t('settings.language'), icon: <Globe size={14} /> },
                  { id: 'fontSize', label: t('settings.fontSize'), icon: <Type size={14} /> },
                  { id: 'defaultFolder', label: t('settings.defaultFolder'), icon: <Folder size={14} /> },
                  { id: 'theme', label: t('settings.theme'), icon: <Sparkles size={14} /> },
                  { id: 'cronometric', label: t('settings.timeline'), icon: <Sparkles size={14} /> },
                  { id: 'cartography', label: t('settings.cartography'), icon: <Map size={14} /> },
                  { id: 'temporalAgent', label: t('settings.temporalAgent'), icon: <Layers size={14} /> },
                  { id: 'aiModels', label: t('settings.aiModels'), icon: <Cpu size={14} /> },
                  { id: 'agentDashboard', label: t('settings.agentDashboard'), icon: <Activity size={14} /> },
                  { id: 'autoFetch', label: t('settings.autoFetch'), icon: <RotateCcw size={14} /> },
                  { id: 'osNotifications', label: t('settings.osNotifications'), icon: <AlertCircle size={14} /> },
                  { id: 'shortcuts', label: t('settings.shortcuts'), icon: <Type size={14} /> },
                  { id: 'security', label: t('settings.security'), icon: <Lock size={14} /> },
                  { id: 'updates', label: t('settings.checkUpdates'), icon: <Download size={14} /> },
                  { id: 'about', label: t('settings.about'), icon: <HelpCircle size={14} /> },
                ].map((item) => (
                  <button
                    key={item.id}
                    onClick={() => onSettingsSectionChange(item.id)}
                    className={cn(
                      'w-full px-4 py-2 flex items-center gap-3 text-xs font-semibold tracking-wide transition-colors text-left relative',
                      selectedSettingsSection === item.id
                        ? 'bg-secondary/10 text-secondary'
                        : 'text-text-secondary hover:bg-bg-surface/70 hover:text-text-primary',
                    )}
                  >
                    {selectedSettingsSection === item.id && <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-secondary" />}
                    <span className={cn('shrink-0', selectedSettingsSection === item.id ? 'text-secondary' : 'text-text-secondary/70')}>{item.icon}</span>
                    <span className="truncate">{item.label}</span>
                  </button>
                ))}
              </div>
            </motion.div>
          ) : activeView === 'help' ? (
            <motion.div
              key="help"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex flex-col h-full select-none"
            >
              <div className="px-4 py-2 flex items-center justify-between">
                <span className="font-bold text-secondary flex items-center gap-1.5 text-xs uppercase tracking-wider">
                  <HelpCircle size={14} /> {t('toolbar.help')}
                </span>
                <button
                  onClick={() => onViewChange('repository')}
                  className="text-text-secondary hover:text-text-primary text-[length:var(--font-size-2xs)] uppercase font-bold flex items-center gap-1"
                  title={t('common.backToRepo')}
                >
                  <ArrowLeft size={12} />
                </button>
              </div>
              <div className="py-2 space-y-0.5">
                {[
                  { id: 'whatis', label: t('page.help.whatis.title'), icon: <HelpCircle size={14} /> },
                  { id: 'columns', label: t('page.help.columns.title'), icon: <Layers size={14} /> },
                  { id: 'tabs', label: t('page.help.tabs.title'), icon: <FileText size={14} /> },
                  { id: 'states', label: t('page.help.states.title'), icon: <Sparkles size={14} /> },
                  { id: 'buttons', label: t('page.help.buttons.title'), icon: <Zap size={14} /> },
                  { id: 'flow', label: t('page.help.flow.title'), icon: <RotateCcw size={14} /> },
                  { id: 'security', label: t('page.help.security.title'), icon: <Lock size={14} /> },
                ].map((item) => (
                  <button
                    key={item.id}
                    onClick={() => onHelpSectionChange(item.id)}
                    className={cn(
                      'w-full px-4 py-2 flex items-center gap-3 text-xs font-semibold tracking-wide transition-colors text-left relative',
                      selectedHelpSection === item.id
                        ? 'bg-secondary/10 text-secondary'
                        : 'text-text-secondary hover:bg-bg-surface/70 hover:text-text-primary',
                    )}
                  >
                    {selectedHelpSection === item.id && <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-secondary" />}
                    <span className={cn('shrink-0', selectedHelpSection === item.id ? 'text-secondary' : 'text-text-secondary/70')}>{item.icon}</span>
                    <span className="truncate">{item.label}</span>
                  </button>
                ))}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="profile"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex flex-col h-full select-none"
            >
              <div className="px-4 py-2 flex items-center justify-between">
                <span className="font-bold text-secondary flex items-center gap-1.5 text-xs uppercase tracking-wider">
                  <Github size={14} /> {t('toolbar.profile')}
                </span>
                <button
                  onClick={() => onViewChange('repository')}
                  className="text-text-secondary hover:text-text-primary text-[length:var(--font-size-2xs)] uppercase font-bold flex items-center gap-1"
                  title={t('common.backToRepo')}
                >
                  <ArrowLeft size={12} />
                </button>
              </div>
              <div className="py-2">
                <button
                  className="w-full px-4 py-2 flex items-center gap-3 text-xs font-semibold tracking-wide bg-secondary/10 text-secondary text-left relative"
                >
                  <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-secondary" />
                  <span className="shrink-0 text-secondary"><Github size={14} /></span>
                  <span className="truncate">{t('profile.githubAccount')}</span>
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      </div>
      <div className="shrink-0 bg-bg-surface border-t border-border-subtle/30 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onViewChange(activeView === 'settings' ? 'repository' : 'settings')}
            title={t('toolbar.settings')}
            className={cn(
              'h-11 w-11 min-h-[44px] min-w-[44px] rounded-lg flex items-center justify-center transition-colors',
              activeView === 'settings'
                ? 'bg-secondary/10 text-secondary'
                : 'bg-text-primary/[0.035] text-text-secondary hover:bg-text-primary/10 hover:text-secondary'
            )}
          >
            <Settings size={17} />
          </button>
          <button
            type="button"
            onClick={() => onViewChange(activeView === 'help' ? 'repository' : 'help')}
            title={t('toolbar.help')}
            className={cn(
              'h-11 w-11 min-h-[44px] min-w-[44px] rounded-lg flex items-center justify-center transition-colors',
              activeView === 'help'
                ? 'bg-secondary/10 text-secondary'
                : 'bg-text-primary/[0.035] text-text-secondary hover:bg-text-primary/10 hover:text-secondary'
            )}
          >
            <HelpCircle size={17} />
          </button>
          {enableCartography && repoPath && (
            <button
              type="button"
              onClick={onToggleCartography}
              title={cartographyActive ? t('cartography.backToGraph') : t('cartography.open')}
              className={cn(
                'h-11 w-11 min-h-[44px] min-w-[44px] rounded-lg flex items-center justify-center transition-colors',
                cartographyActive
                  ? 'bg-secondary/10 text-secondary'
                  : 'bg-text-primary/[0.035] text-text-secondary hover:bg-text-primary/10 hover:text-secondary'
              )}
            >
              <Map size={17} />
            </button>
          )}
          <UpdateControls
            updateStatus={updateStatus}
            updateInfo={updateInfo}
            downloadProgress={downloadProgress}
            showUpdateMenu={showUpdateMenu}
            setShowUpdateMenu={setShowUpdateMenu}
            updateMenuRef={updateMenuRef}
            onCheckForUpdate={onCheckForUpdate}
            onDownloadUpdate={onDownloadUpdate}
            onInstallUpdate={onInstallUpdate}
          />
          <div className="ml-auto">
            {githubUser ? (
              <button
                type="button"
                onClick={() => onViewChange(activeView === 'profile' ? 'repository' : 'profile')}
                title={t('toolbar.connectedAs', { user: githubUser.login })}
                className={cn(
                  'flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors',
                  activeView === 'profile'
                    ? 'bg-secondary/20'
                    : 'bg-secondary/10 hover:bg-secondary/15'
                )}
              >
                {githubUser.avatarUrl ? (
                  <img
                    src={githubUser.avatarUrl}
                    alt={githubUser.login}
                    className="h-8 w-8 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <div className="h-8 w-8 shrink-0 rounded-full bg-gradient-to-br from-git-add to-git-add/80 flex items-center justify-center text-[length:var(--font-size-2xs)] font-bold text-bg-base">
                    {userInitials(githubUser)}
                  </div>
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onViewChange(activeView === 'profile' ? 'repository' : 'profile')}
                title={t('toolbar.connectGitHub')}
                className={cn(
                  'h-10 w-10 shrink-0 rounded-full flex items-center justify-center transition-colors',
                  activeView === 'profile'
                    ? 'bg-secondary/15 text-secondary'
                    : 'bg-text-primary/[0.035] text-text-secondary hover:text-secondary hover:bg-text-primary/10'
                )}
              >
                <UserCircle2 size={24} strokeWidth={1.5} />
              </button>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
