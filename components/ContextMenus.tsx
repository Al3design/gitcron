'use client';

import { useRef, useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Archive, ArrowDown, ArrowUp, Eraser, ListChecks, Pencil, Trash2 } from 'lucide-react';
import { useT } from '@/hooks/use-translation';
import { cn } from '@/lib/utils';
import type { GitFile } from '@/lib/git-store';
import styles from './ContextMenus.module.css';

/**
 * Custom hook to dynamically adjust the context menu position
 * so it never overflows the bottom or right edges of the viewport.
 * Uses a two-pass render style (hidden first frame) to measure and
 * reposition seamlessly without flickering.
 */
function useAdjustedPosition(x: number, y: number, preferAbove?: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState({ left: x, top: y });
  const [isMeasured, setIsMeasured] = useState(false);

  useEffect(() => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      const winW = window.innerWidth;
      const winH = window.innerHeight;

      let left = x;
      let top = preferAbove && rect.height > 0 ? Math.max(8, y - rect.height - 6) : y;

      // Adjust horizontally if it goes off-screen to the right
      if (x + rect.width > winW) {
        left = Math.max(8, winW - rect.width - 8);
      }
      // Adjust vertically if it goes off-screen to the bottom (render upwards)
      if (!preferAbove && y + rect.height > winH) {
        top = Math.max(8, winH - rect.height - 8);
      }

      setCoords({ left, top });
      setIsMeasured(true);
    }
  }, [x, y, preferAbove]);

  return { ref, coords, isMeasured };
}

export function ContextMenuItem({
  onClick, text, textSecondary, disabled, title, danger, icon,
}: {
  onClick: () => void;
  text: string;
  textSecondary?: string;
  disabled?: boolean;
  title?: string;
  danger?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); if (!disabled) onClick(); }}
      disabled={disabled}
      title={title}
      className={cn(
        'w-full flex items-center justify-between px-4 py-1.5 text-[length:var(--font-size-xs)] leading-5 text-left transition-colors',
        disabled
          ? 'text-text-secondary/40 cursor-not-allowed'
          : danger
            ? 'text-text-primary hover:bg-error/20 hover:text-error'
            : 'text-text-primary hover:bg-secondary/20 hover:text-secondary',
      )}
    >
      <span className="flex items-center gap-2 text-left min-w-0">
        {icon !== undefined ? (
          <span className="w-4 shrink-0 flex items-center justify-center opacity-70" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        <span>{text}</span>
      </span>
      {textSecondary && <span className="text-[length:var(--font-size-2xs)] opacity-50 ml-4 shrink-0">{textSecondary}</span>}
    </button>
  );
}

export function ContextMenuSeparator() {
  return <div className={styles.separator} role="separator" />;
}

export function ContextMenu({
  x,
  y,
  preferAbove,
  onClose,
  width = 'narrow',
  ariaLabel,
  children,
}: {
  x: number;
  y: number;
  preferAbove?: boolean;
  onClose: () => void;
  width?: 'narrow' | 'wide';
  ariaLabel?: string;
  children: React.ReactNode;
}) {
  const { ref, coords, isMeasured } = useAdjustedPosition(x, y, preferAbove);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    const timer = setTimeout(() => {
      window.addEventListener('click', handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('click', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, ref]);

  const menuStyle: React.CSSProperties = {
    left: coords.left,
    top: coords.top,
    visibility: isMeasured ? 'visible' : 'hidden',
  };

  return (
    <motion.div
      ref={ref}
      role="menu"
      aria-label={ariaLabel}
      initial={{ opacity: 0 }}
      animate={{ opacity: isMeasured ? 1 : 0 }}
      className={cn('glass-overlay', styles.menu, width === 'wide' ? styles.wide : styles.narrow)}
      style={menuStyle}
    >
      {children}
    </motion.div>
  );
}

export function CommitContextMenu({
  x, y, onMerge, onRevert, onCheckout, onCreateBranch, onCreateTag, onReset, onCherryPick, onCopySha, onInteractiveRebase, onClose,
}: {
  x: number; y: number;
  onMerge: () => void; onRevert: () => void; onCheckout: () => void;
  onCreateBranch: () => void; onCreateTag: () => void; onReset: () => void; onCherryPick: () => void; onCopySha: () => void;
  onInteractiveRebase: () => void; onClose: () => void;
}) {
  const t = useT();
  const { ref, coords, isMeasured } = useAdjustedPosition(x, y);

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0 }}
      animate={{ opacity: isMeasured ? 1 : 0 }}
      className="fixed glass-overlay rounded-lg py-1 z-[100] w-64"
      style={{
        left: coords.left,
        top: coords.top,
        visibility: isMeasured ? 'visible' : 'hidden',
      }}
    >
      <ContextMenuItem onClick={onMerge} text="Merge into current branch" />
      <ContextMenuItem onClick={onCherryPick} text={t('commitMenu.cherryPick')} />
      <ContextMenuItem onClick={onRevert} text="Revert commit" />
      <ContextMenuItem onClick={onReset} text={t('commitMenu.reset')} />
      <ContextMenuItem onClick={onInteractiveRebase} text={t('commitMenu.interactiveRebase')} />
      <div className="h-px bg-border-subtle my-1" />
      <ContextMenuItem onClick={onCheckout} text="Checkout" />
      <ContextMenuItem onClick={onCreateBranch} text="Create branch here" />
      <ContextMenuItem onClick={onCreateTag} text={t('commitMenu.createTag')} />
      <div className="h-px bg-border-subtle my-1" />
      <ContextMenuItem onClick={onCopySha} text="Copy commit SHA" textSecondary="Ctrl+C" />
      <ContextMenuItem onClick={onClose} text="Cerrar" />
    </motion.div>
  );
}

function BranchContextMenu({
  x, y, branch, currentBranch, tracking,
  onMerge, onRebase, onFastForward, onPull, onPush,
  onCheckout, onRename, onDeleteLocal, onDeleteRemote, onDeleteBoth, onCopyName, onCreateFrom, onClose,
}: {
  x: number; y: number; branch: string; currentBranch: string;
  tracking?: { ahead: number; behind: number; gone: boolean; upstream: string | null };
  onMerge: () => void; onRebase: () => void; onFastForward: () => void;
  onPull: () => void; onPush: () => void; onCheckout: () => void;
  onRename: () => void; onDeleteLocal: () => void; onDeleteRemote: () => void;
  onDeleteBoth: () => void; onCopyName: () => void;
  onCreateFrom: () => void; onClose: () => void;
}) {
  const t = useT();
  const isCurrent = branch === currentBranch;
  const hasUpstream = !!tracking?.upstream;
  // "Remota viva": upstream configurado y NO gone (coherente con hasRemote de la Fase 01).
  const hasRemote = hasUpstream && !tracking?.gone;
  const canPush = hasUpstream && (tracking?.ahead ?? 0) > 0;
  const canPull = hasUpstream && (tracking?.behind ?? 0) > 0;
  const { ref, coords, isMeasured } = useAdjustedPosition(x, y);

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0 }}
      animate={{ opacity: isMeasured ? 1 : 0 }}
      className="fixed glass-overlay rounded-lg py-1 z-[100] w-72"
      style={{
        left: coords.left,
        top: coords.top,
        visibility: isMeasured ? 'visible' : 'hidden',
      }}
    >
      <div className="px-4 py-1.5 text-ui-label-bold text-text-secondary/70 border-b border-border-subtle/15 truncate">{branch}</div>
      {!isCurrent && <ContextMenuItem onClick={onMerge} text={`Merge "${branch}" en "${currentBranch}"`} />}
      {!isCurrent && <ContextMenuItem onClick={onRebase} text={`Rebase "${currentBranch}" sobre "${branch}"`} />}
      {!isCurrent && tracking?.upstream && tracking.behind > 0 && tracking.ahead === 0 && (
        <ContextMenuItem onClick={onFastForward} text={`Fast-forward a origin/${branch}`} textSecondary={`↓${tracking.behind}`} />
      )}
      {!isCurrent && <div className="h-px bg-border-subtle/15 my-1" />}
      <ContextMenuItem onClick={onCheckout} text={isCurrent ? '(branch actual)' : 'Checkout (cambiar a esta)'} />
      <div className="h-px bg-border-subtle/15 my-1" />
      <ContextMenuItem onClick={onPull} text="Pull" textSecondary={canPull ? `↓${tracking?.behind}` : hasUpstream ? '✓' : '—'} />
      <ContextMenuItem onClick={onPush} text="Push" textSecondary={canPush ? `↑${tracking?.ahead}` : hasUpstream ? '✓' : '—'} />
      <div className="h-px bg-border-subtle/15 my-1" />
      <ContextMenuItem onClick={onCreateFrom} text="Crear nueva branch desde acá" />
      <ContextMenuItem onClick={onRename} text="Renombrar..." />
      {/* Borrado — opciones según estado local/remoto (Fase 01). La branch activa
          no se puede borrar: las opciones quedan deshabilitadas con tooltip. */}
      {isCurrent ? (
        <>
          <ContextMenuItem onClick={() => {}} disabled title={t('branchMenu.deleteActiveTooltip')} text={t('branchMenu.deleteLocal')} />
          {hasRemote && <ContextMenuItem onClick={() => {}} disabled title={t('branchMenu.deleteActiveTooltip')} text={t('branchMenu.deleteRemote')} />}
          {hasRemote && <ContextMenuItem onClick={() => {}} disabled title={t('branchMenu.deleteActiveTooltip')} text={t('branchMenu.deleteBoth')} />}
        </>
      ) : hasRemote ? (
        <>
          <ContextMenuItem onClick={onDeleteLocal} danger text={t('branchMenu.deleteLocal')} />
          <ContextMenuItem onClick={onDeleteRemote} danger text={t('branchMenu.deleteRemote')} />
          <ContextMenuItem onClick={onDeleteBoth} danger text={t('branchMenu.deleteBoth')} />
        </>
      ) : (
        <ContextMenuItem onClick={onDeleteLocal} danger text={t('branchMenu.deleteLocal')} />
      )}
      <div className="h-px bg-border-subtle/15 my-1" />
      <ContextMenuItem onClick={onCopyName} text="Copiar nombre" textSecondary="Ctrl+C" />
      <ContextMenuItem onClick={onClose} text="Cerrar" />
    </motion.div>
  );
}

export function FileContextMenu({
  x, y, file,
  onStage, onDiscard, onStashFile, onIgnore,
  onOpenHistory, onOpenBlame, onOpenInEditor, onShowInFolder, onCopyPath, onDelete, onClose,
}: {
  x: number; y: number; file: GitFile;
  onStage: () => void; onDiscard: () => void; onStashFile: () => void;
  onIgnore: () => void; onOpenInEditor: () => void; onShowInFolder: () => void;
  onOpenHistory: () => void; onOpenBlame: () => void; onCopyPath: () => void; onDelete: () => void; onClose: () => void;
}) {
  const t = useT();
  const { ref, coords, isMeasured } = useAdjustedPosition(x, y);

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0 }}
      animate={{ opacity: isMeasured ? 1 : 0 }}
      className="fixed glass-overlay rounded-lg py-1 z-[100] w-60"
      style={{
        left: coords.left,
        top: coords.top,
        visibility: isMeasured ? 'visible' : 'hidden',
      }}
    >
      <ContextMenuItem onClick={onStage} text={file.staged ? 'Unstage' : 'Stage'} />
      <ContextMenuItem onClick={onOpenHistory} text={t('fileMenu.history')} />
      {file.status !== 'untracked' && <ContextMenuItem onClick={onOpenBlame} text={t('fileMenu.blame')} />}
      <ContextMenuItem onClick={onIgnore} text="Agregar a .gitignore" />
      <ContextMenuItem onClick={onStashFile} text="Stashear este archivo" />
      <div className="h-px bg-border-subtle/20 my-1" />
      <ContextMenuItem onClick={onOpenInEditor} text="Abrir en editor" />
      <ContextMenuItem onClick={onShowInFolder} text="Mostrar en carpeta" />
      <ContextMenuItem onClick={onCopyPath} text="Copiar path" textSecondary="Ctrl+C" />
      <div className="h-px bg-border-subtle/20 my-1" />
      <ContextMenuItem onClick={onDiscard} text="Descartar cambios" />
      <ContextMenuItem onClick={onDelete} text="Eliminar archivo" />
      <div className="h-px bg-border-subtle/20 my-1" />
      <ContextMenuItem onClick={onClose} text="Cerrar" />
    </motion.div>
  );
}

function RemoteBranchContextMenu({
  x, y, branch,
  onCheckout, onCopyName, onCreateFrom, onClose,
}: {
  x: number; y: number; branch: string;
  onCheckout: () => void; onCopyName: () => void;
  onCreateFrom: () => void; onClose: () => void;
}) {
  const { ref, coords, isMeasured } = useAdjustedPosition(x, y);

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0 }}
      animate={{ opacity: isMeasured ? 1 : 0 }}
      className="fixed glass-overlay rounded-lg py-1 z-[100] w-72"
      style={{
        left: coords.left,
        top: coords.top,
        visibility: isMeasured ? 'visible' : 'hidden',
      }}
    >
      <div className="px-4 py-1.5 text-ui-label-bold text-text-secondary/70 border-b border-border-subtle/15 truncate">{branch}</div>
      <ContextMenuItem onClick={onCheckout} text="Checkout (descargar localmente)" />
      <div className="h-px bg-border-subtle/15 my-1" />
      <ContextMenuItem onClick={onCreateFrom} text="Crear nueva branch desde acá" />
      <div className="h-px bg-border-subtle/15 my-1" />
      <ContextMenuItem onClick={onCopyName} text="Copiar nombre" textSecondary="Ctrl+C" />
      <ContextMenuItem onClick={onClose} text="Cerrar" />
    </motion.div>
  );
}

type BranchContextMenuLayerProps = {
  branchMenu: { x: number; y: number; branch: string } | null;
  remoteBranchMenu: { x: number; y: number; branch: string } | null;
  currentBranch: string;
  branchTracking: Record<string, { ahead: number; behind: number; gone: boolean; upstream: string | null }>;
  onMerge: (branch: string) => void;
  onRebase: (branch: string) => void;
  onFastForward: (branch: string) => void;
  onPull: (branch: string) => void;
  onPush: (branch: string) => void;
  onCheckout: (branch: string) => void;
  onRename: (branch: string) => void;
  onDeleteLocal: (branch: string) => void;
  onDeleteRemote: (branch: string) => void;
  onDeleteBoth: (branch: string) => void;
  onCopyName: (branch: string) => void;
  onCreateFrom: (branch: string) => void;
  onCloseBranchMenu: () => void;
  onCloseRemoteBranchMenu: () => void;
};

export function BranchContextMenuLayer({
  branchMenu,
  remoteBranchMenu,
  currentBranch,
  branchTracking,
  onMerge,
  onRebase,
  onFastForward,
  onPull,
  onPush,
  onCheckout,
  onRename,
  onDeleteLocal,
  onDeleteRemote,
  onDeleteBoth,
  onCopyName,
  onCreateFrom,
  onCloseBranchMenu,
  onCloseRemoteBranchMenu,
}: BranchContextMenuLayerProps) {
  return (
    <>
      <AnimatePresence>
        {branchMenu && (
          <BranchContextMenu
            x={branchMenu.x}
            y={branchMenu.y}
            branch={branchMenu.branch}
            currentBranch={currentBranch}
            tracking={branchTracking[branchMenu.branch]}
            onMerge={() => onMerge(branchMenu.branch)}
            onRebase={() => onRebase(branchMenu.branch)}
            onFastForward={() => onFastForward(branchMenu.branch)}
            onPull={() => onPull(branchMenu.branch)}
            onPush={() => onPush(branchMenu.branch)}
            onCheckout={() => onCheckout(branchMenu.branch)}
            onRename={() => onRename(branchMenu.branch)}
            onDeleteLocal={() => onDeleteLocal(branchMenu.branch)}
            onDeleteRemote={() => onDeleteRemote(branchMenu.branch)}
            onDeleteBoth={() => onDeleteBoth(branchMenu.branch)}
            onCopyName={() => onCopyName(branchMenu.branch)}
            onCreateFrom={() => onCreateFrom(branchMenu.branch)}
            onClose={onCloseBranchMenu}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {remoteBranchMenu && (
          <RemoteBranchContextMenu
            x={remoteBranchMenu.x}
            y={remoteBranchMenu.y}
            branch={remoteBranchMenu.branch}
            onCheckout={() => onCheckout(remoteBranchMenu.branch)}
            onCopyName={() => onCopyName(remoteBranchMenu.branch)}
            onCreateFrom={() => onCreateFrom(remoteBranchMenu.branch)}
            onClose={onCloseRemoteBranchMenu}
          />
        )}
      </AnimatePresence>
    </>
  );
}

export function TaskContextMenu({
  x,
  y,
  canMoveUp,
  canMoveDown,
  howToCheckOpen,
  onToggleHowToCheck,
  onEdit,
  onMoveUp,
  onMoveDown,
  onDelete,
  onClose,
}: {
  x: number;
  y: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  howToCheckOpen?: boolean;
  onToggleHowToCheck?: () => void;
  onEdit: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const t = useT();

  return (
    <ContextMenu x={x} y={y} onClose={onClose} width="narrow">
      {onToggleHowToCheck && (
        <ContextMenuItem
          onClick={() => { onClose(); onToggleHowToCheck(); }}
          icon={<ListChecks size={13} />}
          text={t(howToCheckOpen ? 'pipeline.openspec.task.hideHowToCheck' : 'pipeline.openspec.task.howToCheck')}
        />
      )}
      <ContextMenuItem
        onClick={() => { onClose(); onEdit(); }}
        icon={<Pencil size={13} />}
        text={t('pipeline.openspec.task.edit')}
      />
      <ContextMenuItem
        onClick={() => { onClose(); onMoveUp(); }}
        disabled={!canMoveUp}
        icon={<ArrowUp size={13} />}
        text={t('pipeline.openspec.task.moveUp')}
        textSecondary="Alt+↑"
      />
      <ContextMenuItem
        onClick={() => { onClose(); onMoveDown(); }}
        disabled={!canMoveDown}
        icon={<ArrowDown size={13} />}
        text={t('pipeline.openspec.task.moveDown')}
        textSecondary="Alt+↓"
      />
      <ContextMenuSeparator />
      <ContextMenuItem
        onClick={() => { onClose(); onDelete(); }}
        danger
        icon={<Trash2 size={13} />}
        text={t('pipeline.openspec.task.delete')}
      />
    </ContextMenu>
  );
}

export function UnstagedActionsMenu({
  x,
  y,
  untrackedCount,
  hasModifiedFiles,
  isLoading,
  onOpenStashModal,
  onRequestCleanUntracked,
  onRequestResetAll,
  onClose,
}: {
  x: number;
  y: number;
  untrackedCount: number;
  hasModifiedFiles: boolean;
  isLoading?: boolean;
  onOpenStashModal: () => void;
  onRequestCleanUntracked: () => void;
  onRequestResetAll: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const { ref, coords, isMeasured } = useAdjustedPosition(x, y);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    const timer = setTimeout(() => {
      window.addEventListener('click', handleClickOutside);
      window.addEventListener('keydown', handleKeyDown);
    }, 0);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('click', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, ref]);

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0 }}
      animate={{ opacity: isMeasured ? 1 : 0 }}
      className="fixed glass-overlay rounded-lg py-1 z-[100] w-72 shadow-lg"
      style={{
        left: coords.left,
        top: coords.top,
        visibility: isMeasured ? 'visible' : 'hidden',
      }}
    >
      <ContextMenuItem
        onClick={() => { onClose(); onOpenStashModal(); }}
        disabled={isLoading}
        icon={<Archive size={13} />}
        text={t('staging.actionStash')}
      />
      <ContextMenuItem
        onClick={() => { onClose(); onRequestCleanUntracked(); }}
        disabled={isLoading || untrackedCount === 0}
        icon={<Eraser size={13} />}
        text={t('staging.actionCleanUntracked')}
      />
      <div className="h-px bg-border-subtle/15 my-1" />
      <ContextMenuItem
        onClick={() => { onClose(); onRequestResetAll(); }}
        disabled={isLoading || !hasModifiedFiles}
        danger
        icon={<Trash2 size={13} />}
        text={t('staging.actionResetAll')}
      />
    </motion.div>
  );
}
