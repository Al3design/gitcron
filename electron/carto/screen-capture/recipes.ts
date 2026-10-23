// electron/carto/screen-capture/recipes.ts
//
// Lectura y validación de recetas de captura de vistas (.gitcron/capturas.json) (decisión 13).

export type RecipeTarget =
  | { role: string; name?: string; nameMatches?: string }
  | { testId: string }
  | { text: string };

export type RecipeStep =
  | { click: RecipeTarget }
  | { waitFor: RecipeTarget; timeoutMs?: number }
  | { pause: number }
  | { reload: true }
  | { evaluate: string };

export interface CaptureRecipes {
  version: 1;
  runner: { kind: 'e2e'; config: string; testsDir: string };
  setup: RecipeStep[];
  screens: Record<string, { steps: RecipeStep[] }>;
}

export const RECIPES_PATH = '.gitcron/capturas.json';

function isRelativeWithinRepo(p: unknown): boolean {
  if (typeof p !== 'string' || p.trim().length === 0) return false;
  const normalized = p.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
    return false;
  }
  const parts = normalized.split('/');
  return !parts.includes('..');
}

function validateRoleTarget(
  obj: Record<string, unknown>,
  context: string,
  pasoNum: number,
): string | null {
  if (typeof obj.role !== 'string' || obj.role.length === 0) {
    return `Pantalla "${context}", paso ${pasoNum}: role debe ser una cadena no vacía`;
  }
  for (const k of Object.keys(obj)) {
    if (k !== 'role' && k !== 'name' && k !== 'nameMatches') {
      return `Pantalla "${context}", paso ${pasoNum}: propiedad desconocida "${k}" en destino por rol`;
    }
  }
  if ('name' in obj && typeof obj.name !== 'string') {
    return `Pantalla "${context}", paso ${pasoNum}: name debe ser una cadena`;
  }
  if ('nameMatches' in obj) {
    if (typeof obj.nameMatches !== 'string') {
      return `Pantalla "${context}", paso ${pasoNum}: nameMatches debe ser una cadena`;
    }
    try {
      new RegExp(obj.nameMatches);
    } catch {
      return `Pantalla "${context}", paso ${pasoNum}: nameMatches no es una expresión regular válida`;
    }
  }
  return null;
}

function validateTarget(
  target: unknown,
  context: string,
  pasoNum: number,
): string | null {
  if (!target || typeof target !== 'object' || Array.isArray(target)) {
    return `Pantalla "${context}", paso ${pasoNum}: destino inválido`;
  }
  const obj = target as Record<string, unknown>;

  if ('testId' in obj) {
    if (Object.keys(obj).length !== 1 || typeof obj.testId !== 'string' || obj.testId.length === 0) {
      return `Pantalla "${context}", paso ${pasoNum}: testId debe ser una cadena no vacía sin otras propiedades`;
    }
    return null;
  }

  if ('text' in obj) {
    if (Object.keys(obj).length !== 1 || typeof obj.text !== 'string' || obj.text.length === 0) {
      return `Pantalla "${context}", paso ${pasoNum}: text debe ser una cadena no vacía sin otras propiedades`;
    }
    return null;
  }

  if ('role' in obj) {
    return validateRoleTarget(obj, context, pasoNum);
  }

  return `Pantalla "${context}", paso ${pasoNum}: el destino debe indicar role, testId o text`;
}

function validateWaitForStep(
  obj: Record<string, unknown>,
  allKeys: string[],
  context: string,
  pasoNum: number,
): string | null {
  for (const k of allKeys) {
    if (k !== 'waitFor' && k !== 'timeoutMs') {
      return `Pantalla "${context}", paso ${pasoNum}: propiedad "${k}" no permitida en waitFor`;
    }
  }
  const targetErr = validateTarget(obj.waitFor, context, pasoNum);
  if (targetErr) return targetErr;

  if ('timeoutMs' in obj) {
    if (
      typeof obj.timeoutMs !== 'number' ||
      !Number.isFinite(obj.timeoutMs) ||
      obj.timeoutMs <= 0 ||
      obj.timeoutMs > 600000
    ) {
      return `Pantalla "${context}", paso ${pasoNum}: timeoutMs debe ser un número entre 1 y 600000`;
    }
  }
  return null;
}

function validatePauseStep(
  obj: Record<string, unknown>,
  allKeys: string[],
  context: string,
  pasoNum: number,
): string | null {
  if (allKeys.length !== 1) {
    return `Pantalla "${context}", paso ${pasoNum}: un paso pause no admite propiedades adicionales`;
  }
  if (
    typeof obj.pause !== 'number' ||
    !Number.isFinite(obj.pause) ||
    obj.pause < 0 ||
    obj.pause > 30000
  ) {
    return `Pantalla "${context}", paso ${pasoNum}: pause debe ser un número entre 0 y 30000`;
  }
  return null;
}

const ACTION_VALIDATORS: Record<
  string,
  (obj: Record<string, unknown>, keys: string[], context: string, pasoNum: number) => string | null
> = {
  click: (obj, keys, context, pasoNum) =>
    keys.length !== 1
      ? `Pantalla "${context}", paso ${pasoNum}: un paso click no admite propiedades adicionales`
      : validateTarget(obj.click, context, pasoNum),
  waitFor: validateWaitForStep,
  pause: validatePauseStep,
  reload: (obj, keys, context, pasoNum) =>
    keys.length !== 1
      ? `Pantalla "${context}", paso ${pasoNum}: un paso reload no admite propiedades adicionales`
      : obj.reload === true
        ? null
        : `Pantalla "${context}", paso ${pasoNum}: reload debe ser true`,
  evaluate: (obj, keys, context, pasoNum) =>
    keys.length !== 1
      ? `Pantalla "${context}", paso ${pasoNum}: un paso evaluate no admite propiedades adicionales`
      : typeof obj.evaluate === 'string'
        ? null
        : `Pantalla "${context}", paso ${pasoNum}: evaluate debe ser una cadena`,
};

function validateStep(
  step: unknown,
  context: string,
  pasoNum: number,
): string | null {
  if (!step || typeof step !== 'object' || Array.isArray(step)) {
    return `Pantalla "${context}", paso ${pasoNum}: el paso debe ser un objeto`;
  }

  const obj = step as Record<string, unknown>;
  const allKeys = Object.keys(obj);
  const presentActions = allKeys.filter((k) => Object.hasOwn(ACTION_VALIDATORS, k));

  if (presentActions.length !== 1) {
    return `Pantalla "${context}", paso ${pasoNum}: debe tener exactamente una acción (${presentActions.length} encontradas)`;
  }

  const validator = ACTION_VALIDATORS[presentActions[0]];
  return validator(obj, allKeys, context, pasoNum);
}

function validateRunner(runner: unknown): { ok: true; data: CaptureRecipes['runner'] } | { ok: false; error: string } {
  if (!runner || typeof runner !== 'object' || Array.isArray(runner)) {
    return { ok: false, error: 'runner debe ser un objeto' };
  }
  const r = runner as Record<string, unknown>;
  if (r.kind !== 'e2e') {
    return { ok: false, error: 'runner.kind debe ser "e2e"' };
  }
  if (!isRelativeWithinRepo(r.config)) {
    return { ok: false, error: 'runner.config debe ser una ruta relativa dentro del repositorio' };
  }
  if (!isRelativeWithinRepo(r.testsDir)) {
    return { ok: false, error: 'runner.testsDir debe ser una ruta relativa dentro del repositorio' };
  }
  return {
    ok: true,
    data: {
      kind: 'e2e',
      config: r.config as string,
      testsDir: r.testsDir as string,
    },
  };
}

function validateSetup(setup: unknown): string | null {
  if (!Array.isArray(setup)) {
    return 'setup debe ser una lista de pasos';
  }
  for (let i = 0; i < setup.length; i++) {
    const err = validateStep(setup[i], 'setup', i + 1);
    if (err) return err;
  }
  return null;
}

function validateScreens(screens: unknown): string | null {
  if (!screens || typeof screens !== 'object' || Array.isArray(screens)) {
    return 'screens debe ser un objeto';
  }
  for (const [screenId, screenVal] of Object.entries(screens as Record<string, unknown>)) {
    if (!screenVal || typeof screenVal !== 'object' || Array.isArray(screenVal)) {
      return `Pantalla "${screenId}": debe ser un objeto`;
    }
    const sObj = screenVal as Record<string, unknown>;
    if (!Array.isArray(sObj.steps)) {
      return `Pantalla "${screenId}": steps debe ser una lista de pasos`;
    }
    for (let i = 0; i < sObj.steps.length; i++) {
      const err = validateStep(sObj.steps[i], screenId, i + 1);
      if (err) return err;
    }
  }
  return null;
}

export async function readRecipes(
  readFile: (rel: string) => Promise<string | null>,
): Promise<{ ok: true; recipes: CaptureRecipes } | { ok: false; error: string } | null> {
  const content = await readFile(RECIPES_PATH);
  if (content === null) {
    return null;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return { ok: false, error: 'JSON inválido en .gitcron/capturas.json' };
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'El archivo .gitcron/capturas.json debe contener un objeto' };
  }

  const obj = raw as Record<string, unknown>;

  if (obj.version !== 1) {
    return { ok: false, error: 'Versión de recetas inválida (se espera version: 1)' };
  }

  const runnerResult = validateRunner(obj.runner);
  if (!runnerResult.ok) {
    return runnerResult;
  }

  const setupErr = validateSetup(obj.setup);
  if (setupErr) {
    return { ok: false, error: setupErr };
  }

  const screensErr = validateScreens(obj.screens);
  if (screensErr) {
    return { ok: false, error: screensErr };
  }

  return {
    ok: true,
    recipes: {
      version: 1,
      runner: runnerResult.data,
      setup: obj.setup as RecipeStep[],
      screens: obj.screens as Record<string, { steps: RecipeStep[] }>,
    },
  };
}
