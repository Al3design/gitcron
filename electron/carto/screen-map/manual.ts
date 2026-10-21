// electron/carto/screen-map/manual.ts
//
// Lectura, escritura y validación de correcciones manuales (.gitcron/pantallas.json)
// (decisión 16, tarea 1.5, mapear-pantallas-y-su-codigo).

import type { ManualScreenData, ManualScreenDescription, ManualScreenLink } from '../../../types/screen-map';

export const MANUAL_PATH = '.gitcron/pantallas.json';

function isRelativeWithinRepo(p: unknown): boolean {
  if (typeof p !== 'string' || p.trim().length === 0) return false;
  const normalized = p.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
    return false;
  }
  if (normalized.length > 500) {
    return false;
  }
  const parts = normalized.split('/');
  return !parts.includes('..');
}

export function emptyManualData(): ManualScreenData {
  return {
    version: 1,
    links: [],
    descriptions: {},
  };
}

function validateSingleLink(item: unknown, i: number): { ok: true; link: ManualScreenLink } | { ok: false; error: string } {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return { ok: false, error: `Vínculo en posición ${i}: debe ser un objeto` };
  }
  const l = item as Record<string, unknown>;

  if (typeof l.screenId !== 'string' || l.screenId.length === 0 || l.screenId.length > 200) {
    return { ok: false, error: `Vínculo en posición ${i}: screenId debe tener entre 1 y 200 caracteres` };
  }

  if (!isRelativeWithinRepo(l.path)) {
    return { ok: false, error: `Vínculo en posición ${i}: path debe ser una ruta relativa válida dentro del repositorio` };
  }

  if (l.action !== 'add' && l.action !== 'remove') {
    return { ok: false, error: `Vínculo en posición ${i}: action debe ser "add" o "remove"` };
  }

  if (typeof l.createdAt !== 'string' || l.createdAt.length === 0) {
    return { ok: false, error: `Vínculo en posición ${i}: createdAt debe ser una cadena no vacía` };
  }

  return {
    ok: true,
    link: {
      screenId: l.screenId,
      path: (l.path as string).replace(/\\/g, '/'),
      action: l.action,
      createdAt: l.createdAt,
    },
  };
}

function validateLinks(rawLinks: unknown): { ok: true; links: ManualScreenLink[] } | { ok: false; error: string } {
  if (!Array.isArray(rawLinks)) {
    return { ok: false, error: 'links debe ser una lista' };
  }

  const validatedLinks: ManualScreenLink[] = [];
  for (let i = 0; i < rawLinks.length; i++) {
    const res = validateSingleLink(rawLinks[i], i);
    if (!res.ok) return res;
    validatedLinks.push(res.link);
  }
  return { ok: true, links: validatedLinks };
}

function validateDescriptionName(
  nameVal: unknown,
  screenId: string,
): { ok: true; name?: string } | { ok: false; error: string } {
  if (nameVal === undefined) return { ok: true };
  if (typeof nameVal !== 'string' || nameVal.length > 40) {
    return { ok: false, error: `Pantalla "${screenId}": name no puede superar los 40 caracteres` };
  }
  return { ok: true, name: nameVal.length > 0 ? nameVal : undefined };
}

function validateSingleDescription(
  screenId: string,
  val: unknown,
): { ok: true; desc: ManualScreenDescription } | { ok: false; error: string } {
  if (screenId.length === 0 || screenId.length > 200) {
    return { ok: false, error: `Pantalla "${screenId}": el identificador debe tener entre 1 y 200 caracteres` };
  }

  if (!val || typeof val !== 'object' || Array.isArray(val)) {
    return { ok: false, error: `Pantalla "${screenId}": la descripción debe ser un objeto` };
  }

  const d = val as Record<string, unknown>;
  if (typeof d.text !== 'string' || d.text.length === 0 || d.text.length > 2000) {
    return { ok: false, error: `Pantalla "${screenId}": text debe tener entre 1 y 2000 caracteres` };
  }

  if (typeof d.updatedAt !== 'string' || d.updatedAt.length === 0) {
    return { ok: false, error: `Pantalla "${screenId}": updatedAt debe ser una cadena no vacía` };
  }

  const nameRes = validateDescriptionName(d.name, screenId);
  if (!nameRes.ok) return nameRes;

  return {
    ok: true,
    desc: {
      text: d.text,
      name: nameRes.name,
      updatedAt: d.updatedAt,
    },
  };
}

function validateDescriptions(
  rawDescriptions: unknown,
): { ok: true; descriptions: Record<string, ManualScreenDescription> } | { ok: false; error: string } {
  if (!rawDescriptions || typeof rawDescriptions !== 'object' || Array.isArray(rawDescriptions)) {
    return { ok: false, error: 'descriptions debe ser un objeto' };
  }

  const validatedDescriptions: Record<string, ManualScreenDescription> = {};
  for (const [screenId, val] of Object.entries(rawDescriptions as Record<string, unknown>)) {
    const res = validateSingleDescription(screenId, val);
    if (!res.ok) return res;
    validatedDescriptions[screenId] = res.desc;
  }
  return { ok: true, descriptions: validatedDescriptions };
}

export function validateManualData(raw: unknown): { ok: true; data: ManualScreenData } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'El archivo .gitcron/pantallas.json debe contener un objeto' };
  }

  const obj = raw as Record<string, unknown>;

  if (obj.version !== 1) {
    return { ok: false, error: 'Versión inválida (se espera version: 1)' };
  }

  const linksRes = validateLinks(obj.links);
  if (!linksRes.ok) {
    return linksRes;
  }

  const descRes = validateDescriptions(obj.descriptions);
  if (!descRes.ok) {
    return descRes;
  }

  const excludeRes = validateExclude(obj.exclude);
  if (!excludeRes.ok) {
    return excludeRes;
  }

  return {
    ok: true,
    data: {
      version: 1,
      links: linksRes.links,
      descriptions: descRes.descriptions,
      ...(excludeRes.exclude.length > 0 ? { exclude: excludeRes.exclude } : {}),
    },
  };
}

const MAX_EXCLUDE = 100;

/** Carpetas relativas sin `..`, normalizadas a `/` y con `/` al final (decisión 17). */
function validateExclude(raw: unknown): { ok: true; exclude: string[] } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, exclude: [] };
  if (!Array.isArray(raw)) return { ok: false, error: 'exclude debe ser una lista de carpetas' };
  if (raw.length > MAX_EXCLUDE) return { ok: false, error: `exclude admite hasta ${MAX_EXCLUDE} carpetas` };
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (typeof item !== 'string' || item.trim() === '' || item.length > 200) {
      return { ok: false, error: `exclude[${i}] debe ser una carpeta de 1 a 200 caracteres` };
    }
    const norm = item.trim().replace(/\\/g, '/').replace(/^\.\//, '');
    if (norm.startsWith('/') || /^[a-zA-Z]:/.test(norm) || norm.split('/').includes('..')) {
      return { ok: false, error: `exclude[${i}] no puede ser absoluta ni contener ".."` };
    }
    const folder = norm.endsWith('/') ? norm : `${norm}/`;
    if (!out.includes(folder)) out.push(folder);
  }
  return { ok: true, exclude: out };
}

/** La ruta cae dentro de alguna carpeta excluida. */
export function isExcluded(relPath: string, exclude: string[] | undefined): boolean {
  if (!exclude || exclude.length === 0) return false;
  const norm = relPath.replace(/\\/g, '/');
  return exclude.some((folder) => norm.startsWith(folder));
}

export async function readManualData(
  readFile: (rel: string) => Promise<string | null>,
): Promise<{ ok: true; data: ManualScreenData } | { ok: false; error: string }> {
  const content = await readFile(MANUAL_PATH);
  if (content === null) {
    return { ok: true, data: emptyManualData() };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return { ok: false, error: 'JSON inválido en .gitcron/pantallas.json' };
  }

  return validateManualData(raw);
}

export function serializeManualData(data: ManualScreenData): string | null {
  if (data.links.length === 0 && Object.keys(data.descriptions).length === 0 && !data.exclude?.length) {
    return null;
  }
  return `${JSON.stringify(data, null, 2)}\n`;
}

export function setLink(
  data: ManualScreenData,
  screenId: string,
  filePath: string,
  action: 'add' | 'remove',
  now: string,
): ManualScreenData {
  const normPath = filePath.replace(/\\/g, '/');
  const filtered = data.links.filter((l) => !(l.screenId === screenId && l.path === normPath));
  return {
    ...data,
    links: [...filtered, { screenId, path: normPath, action, createdAt: now }],
  };
}

export function clearLink(data: ManualScreenData, screenId: string, filePath: string): ManualScreenData {
  const normPath = filePath.replace(/\\/g, '/');
  return {
    ...data,
    links: data.links.filter((l) => !(l.screenId === screenId && l.path === normPath)),
  };
}

export function setDescription(
  data: ManualScreenData,
  screenId: string,
  text: string,
  name: string | undefined,
  now: string,
): ManualScreenData {
  return {
    ...data,
    descriptions: {
      ...data.descriptions,
      [screenId]: {
        text,
        name: name && name.trim().length > 0 ? name.trim() : undefined,
        updatedAt: now,
      },
    },
  };
}

export function clearDescription(data: ManualScreenData, screenId: string): ManualScreenData {
  const descriptions = { ...data.descriptions };
  delete descriptions[screenId];
  return {
    ...data,
    descriptions,
  };
}
