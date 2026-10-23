'use client';

/**
 * PixelCard
 * Portado desde React Bits:
 * https://github.com/DavidHDev/react-bits/blob/main/src/ts-default/Components/PixelCard/PixelCard.tsx
 * Autor: DavidHDev (David Haz)
 * Licencia: MIT License + Commons Clause (uso interno en GitCron; no redistribuible como componente suelto)
 */

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type ReactNode,
} from 'react';
import styles from './PixelCard.module.css';

export interface PixelCardProps {
  gap?: number;
  /** Tamaño máximo de cada cuadradito, en píxeles del dibujo (2 por omisión). */
  pixelSize?: number;
  speed?: number;
  colors?: string[];
  noFocus?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  active?: boolean;
  'data-testid'?: string;
}

const APPEAR = 0.26;
const EXIT = 0.22;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

const easeOutBack = (t: number) => {
  const c = 1.9;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
};

function readAiColors(): string[] {
  if (typeof window === 'undefined' || typeof document === 'undefined') return [];
  const tokens = [
    '--color-ai',
    '--color-ai-violet',
    '--color-ai-blue',
    '--color-ai-teal',
    '--color-ai-rose',
  ];
  // Los tokens son `light-dark(…)` o `var(…)`, que el lienzo no entiende (pinta negro): se
  // resuelven como color de un elemento de prueba y se lee el `rgb(…)` final.
  const probe = document.createElement('span');
  probe.hidden = true;
  document.body.appendChild(probe);
  const list: string[] = [];
  try {
    for (const t of tokens) {
      probe.style.color = '';
      probe.style.color = `var(${t})`;
      const val = window.getComputedStyle(probe).color.trim();
      if (val && !list.includes(val)) {
        list.push(val);
      }
    }
  } finally {
    probe.remove();
  }
  return list;
}

function computePixelPresence(
  current: number,
  ready: boolean,
  active: boolean,
  reduce: boolean,
  appearStep: number,
  exitStep: number,
): number {
  const target = active ? (ready ? 1 : 0) : (ready ? 0 : current);
  if (reduce) return target;
  if (target > current) return Math.min(1, current + appearStep);
  if (target < current) return Math.max(0, current - exitStep);
  return current;
}

function computePixelSize(
  baseSize: number,
  presence: number,
  active: boolean,
  twinkle: number,
  wave: number,
): number {
  let size = baseSize;
  if (twinkle) {
    size *= 0.62 + 0.38 * wave;
  }
  size *= easeOutBack(presence);
  const flash = presence < 1 && active ? Math.sin(presence * Math.PI) : 0;
  return size * (1 + flash * 0.9);
}

function computePixelAlpha(
  presence: number,
  active: boolean,
  twinkle: number,
  wave: number,
  jitter: number,
): number {
  let alpha = 0.5 + presence * 0.38;
  if (twinkle) {
    alpha += 0.12 * wave + (jitter > 0.92 ? 0.35 * Math.max(0, wave) : 0);
  }
  const flash = presence < 1 && active ? Math.sin(presence * Math.PI) : 0;
  alpha += flash * 0.6;
  return Math.min(1, Math.max(0, alpha));
}

/** Separación entre puntos del lienzo, en píxeles del dibujo (no es un espacio de CSS). */
const DEFAULT_PIXEL_GAP = 5;

interface Settings {
  colors: string[];
  gap: number;
  speed: number;
  pixelSize: number;
  revealDuration: number;
}

export function PixelCard({
  gap,
  pixelSize,
  speed,
  colors,
  noFocus = false,
  className = '',
  style,
  children,
  active: controlledActive,
  'data-testid': dataTestId,
}: PixelCardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const settingsRef = useRef<Settings>({
    colors: [],
    gap: DEFAULT_PIXEL_GAP,
    speed: 35,
    pixelSize: 2,
    revealDuration: 600,
  });
  const [internalActive, setInternalActive] = useState(false);
  const setActiveStateRef = useRef<((value: boolean, x?: number, y?: number) => void) | null>(null);
  // Lo lee el efecto de los eventos sin volver a armar el lienzo cuando cambia.
  const controlledActiveRef = useRef(controlledActive);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return undefined;

    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    const state = {
      alive: true,
      raf: 0,
      last: 0,
      time: 0,
      visible: true,
      width: 0,
      height: 0,
      ratio: 1,
      key: '',
      count: 0,
      x: new Float32Array(0),
      y: new Float32Array(0),
      tint: new Uint8Array(0),
      size: new Float32Array(0),
      phase: new Float32Array(0),
      rate: new Float32Array(0),
      jitter: new Float32Array(0),
      presence: new Float32Array(0),
      delay: new Float32Array(0),
      active: false,
      changedAt: 0,
      originX: 0,
      originY: 0,
      maxDistance: 1,
      pointerX: 0,
      pointerY: 0,
      hovering: false,
      focused: false,
      dt: 1 / 60,
    };

    const updatePalette = () => {
      const palette = colors && colors.length > 0 ? colors : readAiColors();
      settingsRef.current = {
        colors: palette,
        gap: Math.max(2, Number(gap ?? DEFAULT_PIXEL_GAP) || DEFAULT_PIXEL_GAP),
        speed: clamp(Number(speed ?? 35) || 0, 0, 100),
        pixelSize: clamp(Number(pixelSize ?? 2) || 2, 1, 16),
        revealDuration: 600,
      };
    };

    updatePalette();

    const schedule = () => {
      const s = settingsRef.current;
      const span = s.revealDuration / 1000;
      let far = 1;
      for (let i = 0; i < state.count; i++) {
        far = Math.max(far, Math.hypot(state.x[i] - state.originX, state.y[i] - state.originY));
      }
      state.maxDistance = far;
      for (let i = 0; i < state.count; i++) {
        const distance = Math.hypot(state.x[i] - state.originX, state.y[i] - state.originY) / far;
        state.delay[i] = state.active
          ? distance * span * 0.82 + state.jitter[i] * span * 0.18
          : (1 - distance) * span * 0.45 + state.jitter[i] * span * 0.1;
      }
    };

    const build = () => {
      const s = settingsRef.current;
      const rect = container.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width || container.clientWidth || 300));
      const height = Math.max(1, Math.round(rect.height || container.clientHeight || 200));
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const key = [width, height, ratio, s.gap, s.pixelSize, s.colors.join(',')].join('|');
      if (key === state.key) return;

      state.key = key;
      state.width = width;
      state.height = height;
      state.ratio = ratio;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);

      const columns = Math.floor((width - 1) / s.gap) + 1;
      const rows = Math.floor((height - 1) / s.gap) + 1;
      const offsetX = (width - (columns - 1) * s.gap) / 2;
      const offsetY = (height - (rows - 1) * s.gap) / 2;
      const count = columns * rows;
      const previous = state.presence;

      state.count = count;
      state.x = new Float32Array(count);
      state.y = new Float32Array(count);
      state.tint = new Uint8Array(count);
      state.size = new Float32Array(count);
      state.phase = new Float32Array(count);
      state.rate = new Float32Array(count);
      state.jitter = new Float32Array(count);
      state.presence = new Float32Array(count);
      state.delay = new Float32Array(count);

      const colorCount = Math.max(1, s.colors.length);
      let i = 0;
      for (let column = 0; column < columns; column++) {
        for (let row = 0; row < rows; row++) {
          state.x[i] = offsetX + column * s.gap;
          state.y[i] = offsetY + row * s.gap;
          state.tint[i] = Math.floor(Math.random() * colorCount);
          state.size[i] = s.pixelSize * (0.25 + Math.random() * 0.75);
          state.phase[i] = Math.random() * Math.PI * 2;
          state.rate[i] = 0.55 + Math.random() * 0.9;
          state.jitter[i] = Math.random();
          if (previous.length) state.presence[i] = previous[Math.min(i, previous.length - 1)];
          i++;
        }
      }
      state.maxDistance = Math.hypot(width, height);
      schedule();
    };

    const updateAllPresence = (elapsed: number, appearStep: number, exitStep: number): number => {
      let presenceSum = 0;
      for (let i = 0; i < state.count; i++) {
        const ready = elapsed >= state.delay[i] || reduce;
        const next = computePixelPresence(state.presence[i], ready, state.active, reduce, appearStep, exitStep);
        state.presence[i] = next;
        presenceSum += next;
      }
      return presenceSum;
    };

    const drawColorGroup = (colorIdx: number, twinkle: number, frequency: number) => {
      for (let i = 0; i < state.count; i++) {
        if (state.tint[i] !== colorIdx) continue;
        const presence = state.presence[i];
        if (presence <= 0.002) continue;

        const wave = twinkle ? Math.sin(state.phase[i] + state.time * frequency * state.rate[i]) : 0;
        const size = computePixelSize(state.size[i], presence, state.active, twinkle, wave);
        const alpha = computePixelAlpha(presence, state.active, twinkle, wave, state.jitter[i]);

        if (alpha <= 0.004 || size <= 0.05) continue;
        ctx.globalAlpha = alpha;
        ctx.fillRect(state.x[i] - size * 0.5, state.y[i] - size * 0.5, size, size);
      }
    };

    const draw = (): number => {
      const s = settingsRef.current;
      const { width, height, ratio } = state;
      if (!ctx || width <= 0 || height <= 0 || s.colors.length === 0) return 0;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const elapsed = state.time - state.changedAt;
      const appearStep = state.dt / APPEAR;
      const exitStep = state.dt / EXIT;
      const presenceSum = updateAllPresence(elapsed, appearStep, exitStep);

      const twinkle = reduce ? 0 : smoothstep(0, 100, s.speed) > 0 ? 1 : 0;
      const frequency = (s.speed / 35) * 1.35;

      for (let colorIdx = 0; colorIdx < s.colors.length; colorIdx++) {
        ctx.fillStyle = s.colors[colorIdx];
        drawColorGroup(colorIdx, twinkle, frequency);
      }
      ctx.globalAlpha = 1;
      return presenceSum;
    };

    const wake = () => {
      if (reduce) {
        draw();
        return;
      }
      if (!state.raf && state.alive && state.visible) {
        state.raf = requestAnimationFrame(frame);
      }
    };

    const frame = (now: number) => {
      state.raf = 0;
      if (!state.alive) return;
      const dt = state.last ? Math.min(0.05, (now - state.last) / 1000) : 1 / 60;
      state.last = now;
      state.dt = dt;
      state.time += dt;

      build();
      const presence = draw();
      const settling = state.active || presence > 0;
      if (settling && state.visible && !reduce) {
        state.raf = requestAnimationFrame(frame);
      } else {
        state.last = 0;
      }
    };

    const setActiveState = (value: boolean, x?: number, y?: number) => {
      if (state.active === value) return;
      state.active = value;
      state.changedAt = state.time;
      if (value) {
        state.originX = x !== undefined ? x : state.width / 2;
        state.originY = y !== undefined ? y : state.height / 2;
      }
      schedule();
      setInternalActive(value);
      wake();
    };

    setActiveStateRef.current = setActiveState;

    const localCoords = (event: PointerEvent): [number, number] => {
      const rect = container.getBoundingClientRect();
      return [event.clientX - rect.left, event.clientY - rect.top];
    };

    const onEnter = (event: PointerEvent) => {
      const [x, y] = localCoords(event);
      state.hovering = event.pointerType !== 'touch';
      state.pointerX = x;
      state.pointerY = y;
      setActiveState(true, x, y);
    };

    const onMove = (event: PointerEvent) => {
      const [x, y] = localCoords(event);
      state.pointerX = x;
      state.pointerY = y;
      wake();
    };

    const onLeave = () => {
      state.hovering = false;
      if (!state.focused && controlledActiveRef.current === undefined) {
        setActiveState(false);
      }
    };

    container.addEventListener('pointerenter', onEnter);
    container.addEventListener('pointermove', onMove);
    container.addEventListener('pointerleave', onLeave);

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        build();
        wake();
      });
      resizeObserver.observe(container);
    }

    let visibilityObserver: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== 'undefined') {
      visibilityObserver = new IntersectionObserver((entries) => {
        state.visible = entries.some((e) => e.isIntersecting);
        if (state.visible) wake();
      });
      visibilityObserver.observe(container);
    }

    build();
    state.originX = state.width / 2;
    state.originY = state.height / 2;

    return () => {
      state.alive = false;
      cancelAnimationFrame(state.raf);
      resizeObserver?.disconnect();
      visibilityObserver?.disconnect();
      container.removeEventListener('pointerenter', onEnter);
      container.removeEventListener('pointermove', onMove);
      container.removeEventListener('pointerleave', onLeave);
      setActiveStateRef.current = null;
    };
  }, [gap, pixelSize, speed, colors]);

  useEffect(() => {
    controlledActiveRef.current = controlledActive;
    if (controlledActive !== undefined) {
      setActiveStateRef.current?.(controlledActive);
    }
  }, [controlledActive]);

  const handleFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setActiveStateRef.current?.(true);
  };

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    if (controlledActive === undefined) {
      setActiveStateRef.current?.(false);
    }
  };

  return (
    <div
      ref={containerRef}
      className={`${styles.pixelCard} ${className}`.trim()}
      data-active={(controlledActive ?? internalActive) || undefined}
      data-testid={dataTestId}
      style={style}
      onFocus={noFocus ? undefined : handleFocus}
      onBlur={noFocus ? undefined : handleBlur}
      tabIndex={noFocus ? undefined : 0}
    >
      <canvas className={styles.canvas} ref={canvasRef} aria-hidden="true" />
      {children}
    </div>
  );
}

