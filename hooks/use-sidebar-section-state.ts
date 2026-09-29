'use client';

// Estado de apertura de las secciones del panel lateral y del panel derecho,
// recordado por repositorio y entre sesiones en localStorage.
// Se guarda como Record<string, boolean>. Si no hay registro previo, resuelve
// contra defaultOpen (o false si no se especifica).

import { useCallback, useEffect, useState } from 'react';

const STORAGE_PREFIX = 'gitcron:sidebarSections:';

type SectionRecord = Record<string, boolean>;

function storageKey(repoPath: string | null): string | null {
  return repoPath ? `${STORAGE_PREFIX}${repoPath}` : null;
}

function readStoredSections(repoPath: string | null): SectionRecord {
  const key = storageKey(repoPath);
  if (!key || typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const record: SectionRecord = {};
      for (const item of parsed) {
        if (typeof item === 'string') {
          record[item] = true;
        }
      }
      return record;
    }
    if (parsed && typeof parsed === 'object') {
      const record: SectionRecord = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === 'boolean') {
          record[k] = v;
        }
      }
      return record;
    }
    return {};
  } catch {
    return {};
  }
}

export const DEFAULT_OPEN_RIGHT_PANEL = [
  'details-commit',
  'details-commit-files',
  'details-unstaged',
  'details-staged',
  'details-draft-log',
  'details-commit-box',
  'details-activity',
  'details-attention',
] as const;

export type SidebarSectionState = {
  isOpen: (sectionId: string) => boolean;
  toggle: (sectionId: string) => void;
  open: (sectionId: string) => void;
  setOpen: (sectionId: string, open: boolean) => void;
};

function writeStoredSections(repoPath: string | null, next: SectionRecord): void {
  const key = storageKey(repoPath);
  if (key && typeof window !== 'undefined') {
    try {
      window.localStorage?.setItem(key, JSON.stringify(next));
      if (typeof window.dispatchEvent === 'function' && typeof CustomEvent !== 'undefined') {
        window.dispatchEvent(new CustomEvent('gitcron:sidebarSections', { detail: { repoPath } }));
      }
    } catch {
      // En modo privado o storage lleno no rompe la sesión
    }
  }
}

export function setSidebarSectionOpen(repoPath: string | null, sectionId: string, shouldOpen: boolean): void {
  if (!repoPath) return;
  const currentStored = readStoredSections(repoPath);
  if (currentStored[sectionId] === shouldOpen) return;
  const next: SectionRecord = {
    ...currentStored,
    [sectionId]: shouldOpen,
  };
  writeStoredSections(repoPath, next);
}

export function openSidebarSection(repoPath: string | null, sectionId: string): void {
  setSidebarSectionOpen(repoPath, sectionId, true);
}

export function closeSidebarSection(repoPath: string | null, sectionId: string): void {
  setSidebarSectionOpen(repoPath, sectionId, false);
}

export function useSidebarSectionState(
  repoPath: string | null,
  defaultOpen?: readonly string[],
): SidebarSectionState {
  const [sections, setSections] = useState<SectionRecord>(() => readStoredSections(repoPath));

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setSections(readStoredSections(repoPath));
  }, [repoPath]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    const handleSync = (event: Event) => {
      const customEvent = event as CustomEvent<{ repoPath?: string | null }>;
      if (!customEvent.detail?.repoPath || customEvent.detail.repoPath === repoPath) {
        setSections(readStoredSections(repoPath));
      }
    };
    window.addEventListener('gitcron:sidebarSections', handleSync);
    return () => {
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('gitcron:sidebarSections', handleSync);
      }
    };
  }, [repoPath]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const isOpen = useCallback(
    (sectionId: string) => {
      if (sectionId in sections) {
        return Boolean(sections[sectionId]);
      }
      return Boolean(defaultOpen?.includes(sectionId));
    },
    [sections, defaultOpen],
  );

  const setOpen = useCallback(
    (sectionId: string, shouldOpen: boolean) => {
      const currentStored = readStoredSections(repoPath);
      const next: SectionRecord = {
        ...currentStored,
        [sectionId]: shouldOpen,
      };
      writeStoredSections(repoPath, next);
      setSections(next);
    },
    [repoPath],
  );

  const open = useCallback(
    (sectionId: string) => {
      setOpen(sectionId, true);
    },
    [setOpen],
  );

  const toggle = useCallback(
    (sectionId: string) => {
      const currentStored = readStoredSections(repoPath);
      const currentlyOpen = sectionId in currentStored
        ? currentStored[sectionId]
        : Boolean(defaultOpen?.includes(sectionId));
      setOpen(sectionId, !currentlyOpen);
    },
    [repoPath, defaultOpen, setOpen],
  );

  return { isOpen, toggle, open, setOpen };
}
