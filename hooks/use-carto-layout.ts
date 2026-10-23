'use client';

// hooks/use-carto-layout.ts
//
// Cartografía — Fase 4 y cambio mapear-pantallas-y-su-codigo (tanda 01).
// Layout arrastrable de la vista: alto del panel de relaciones.
// La columna de chat de Cartografía se quitó (decisión 6 de Alejandro, 2026-10-13):
// preguntar se hace en el panel de asistencia inferior de GitCron.
//
// Divisor vertical (cursor-row-resize): entre el árbol y el panel de relaciones.
// El panel de relaciones crece HACIA ARRIBA, así que el delta se invierte.

import { useCallback, useEffect, useRef, useState } from 'react';

const RELATIONS_H = { default: 240, min: 120, max: 640 };

const LS_RELATIONS_H = 'gitcron:cartoRelationsH';

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function useCartoLayout() {
  const [relationsH, setRelationsH] = useState(RELATIONS_H.default);
  const [isDragging, setIsDragging] = useState(false);

  const dragRef = useRef<{ axis: 'relations'; start: number; startSize: number } | null>(null);

  const beginRelationsDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    dragRef.current = { axis: 'relations', start: e.clientY, startSize: relationsH };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      // El panel de relaciones está abajo: arrastrar HACIA ARRIBA lo agranda → delta invertido.
      const delta = dragRef.current.start - ev.clientY;
      const h = clamp(dragRef.current.startSize + delta, RELATIONS_H.min, RELATIONS_H.max);
      setRelationsH(h);
      localStorage.setItem(LS_RELATIONS_H, String(h));
    };
    const onUp = () => {
      setIsDragging(false);
      dragRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [relationsH]);

  // Hidratar desde localStorage en cliente (evita mismatch de SSR).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const h = parseInt(localStorage.getItem(LS_RELATIONS_H) ?? '', 10);
    if (!Number.isNaN(h)) setRelationsH(clamp(h, RELATIONS_H.min, RELATIONS_H.max));
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  return { relationsH, isDragging, beginRelationsDrag };
}
