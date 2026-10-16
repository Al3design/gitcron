'use client';

// Panel layout: anchos arrastrables de sidebar/details, columnas del graph,
// estado abierto/cerrado de los paneles laterales del armazón y su persistencia en
// localStorage. Extraído de app/page.tsx para aislar el layout del resto
// del estado de la página.

import { useCallback, useEffect, useRef, useState } from 'react';

export const GRAPH_COLUMN_DEFAULTS = {
  refs: 260,
  graph: 88,
  date: 80,
  hash: 64,
};

export const GRAPH_COLUMN_LIMITS = {
  refs: { min: 160, max: 520 },
  graph: { min: 56, max: 260 },
  date: { min: 64, max: 150 },
  hash: { min: 56, max: 120 },
};

export type GraphColumnKey = keyof typeof GRAPH_COLUMN_DEFAULTS;

export const usePanelLayout = () => {
  // ── Resizable column widths ──
  const [sidebarW, setSidebarW] = useState(240);
  const [detailsW, setDetailsW] = useState(320);
  // ── Panel open/closed state ──
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [graphColumns, setGraphColumns] = useState(GRAPH_COLUMN_DEFAULTS);
  const dragRef = useRef<{
    col: 'sidebar' | 'details';
    startX: number;
    startW: number;
  } | null>(null);
  const graphDragRef = useRef<{
    col: GraphColumnKey;
    startX: number;
    startW: number;
    direction: 1 | -1;
  } | null>(null);

  // NOTE: these begin* handlers take the event as an argument (instead of the
  // curried `start(col)` form) so no ref is touched by a function invoked
  // during render — keeps react-hooks/refs happy and concurrent-safe.
  const beginColDrag = useCallback((col: 'sidebar' | 'details', e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    dragRef.current = {
      col,
      startX: e.clientX,
      startW: col === 'sidebar' ? sidebarW : detailsW,
    };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = ev.clientX - dragRef.current.startX;
      if (dragRef.current.col === 'sidebar') {
        const w = Math.max(160, Math.min(400, dragRef.current.startW + delta));
        setSidebarW(w);
        localStorage.setItem('gitcron:sidebarW', String(w));
      } else {
        // details grows to the LEFT so delta is inverted
        const w = Math.max(240, Math.min(560, dragRef.current.startW - delta));
        setDetailsW(w);
        localStorage.setItem('gitcron:detailsW', String(w));
      }
    };
    const onUp = () => {
      setIsDragging(false);
      dragRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [sidebarW, detailsW]);

  const beginGraphColDrag = useCallback((col: GraphColumnKey, e: React.MouseEvent, direction: 1 | -1 = 1) => {
    e.preventDefault();
    graphDragRef.current = {
      col,
      startX: e.clientX,
      startW: graphColumns[col],
      direction,
    };
    const onMove = (ev: MouseEvent) => {
      if (!graphDragRef.current) return;
      const { col: activeCol, startX, startW, direction: dragDirection } = graphDragRef.current;
      const delta = (ev.clientX - startX) * dragDirection;
      const limits = GRAPH_COLUMN_LIMITS[activeCol];
      const width = Math.max(limits.min, Math.min(limits.max, startW + delta));

      setGraphColumns((prev) => {
        const next = { ...prev, [activeCol]: width };
        localStorage.setItem('gitcron:graphColumns', JSON.stringify(next));
        return next;
      });
    };
    const onUp = () => {
      graphDragRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [graphColumns]);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => {
      const next = !prev;
      localStorage.setItem('gitcron:sidebarOpen', String(next));
      return next;
    });
  }, []);

  const toggleDetails = useCallback(() => {
    setDetailsOpen((prev) => {
      const next = !prev;
      localStorage.setItem('gitcron:detailsOpen', String(next));
      return next;
    });
  }, []);

  const ensureDetailsOpen = useCallback(() => {
    setDetailsOpen(true);
    localStorage.setItem('gitcron:detailsOpen', 'true');
  }, []);

  const ensureDetailsClosed = useCallback(() => {
    setDetailsOpen(false);
    localStorage.setItem('gitcron:detailsOpen', 'false');
  }, []);

  // Read persisted split widths and panel open states on the client to avoid SSR hydration mismatches.
  // (Intentional one-shot setState on mount — hydrating from localStorage.)
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const savedSidebarW = localStorage.getItem('gitcron:sidebarW');
    const savedDetailsW = localStorage.getItem('gitcron:detailsW');
    const savedGraphColumns = localStorage.getItem('gitcron:graphColumns');
    const savedSidebarOpen = localStorage.getItem('gitcron:sidebarOpen');
    const savedDetailsOpen = localStorage.getItem('gitcron:detailsOpen');
    const parsedSidebarW = savedSidebarW ? parseInt(savedSidebarW, 10) : NaN;
    const parsedDetailsW = savedDetailsW ? parseInt(savedDetailsW, 10) : NaN;

    if (!Number.isNaN(parsedSidebarW)) setSidebarW(parsedSidebarW);
    if (!Number.isNaN(parsedDetailsW)) setDetailsW(parsedDetailsW);
    if (savedSidebarOpen !== null) setSidebarOpen(savedSidebarOpen !== 'false');
    if (savedDetailsOpen !== null) setDetailsOpen(savedDetailsOpen !== 'false');
    if (savedGraphColumns) {
      try {
        const parsed = JSON.parse(savedGraphColumns) as Partial<typeof GRAPH_COLUMN_DEFAULTS>;
        setGraphColumns((prev) => {
          const next = { ...prev };
          (Object.keys(GRAPH_COLUMN_DEFAULTS) as GraphColumnKey[]).forEach((key) => {
            const value = parsed[key];
            if (typeof value !== 'number' || Number.isNaN(value)) return;
            const limits = GRAPH_COLUMN_LIMITS[key];
            next[key] = Math.max(limits.min, Math.min(limits.max, value));
          });
          return next;
        });
      } catch {
        localStorage.removeItem('gitcron:graphColumns');
      }
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  return {
    sidebarW,
    detailsW,
    sidebarOpen,
    detailsOpen,
    isDragging,
    graphColumns,
    beginColDrag,
    beginGraphColDrag,
    toggleSidebar,
    toggleDetails,
    ensureDetailsOpen,
    ensureDetailsClosed,
  };
};
