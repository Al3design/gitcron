// electron/ai/carto/describe-screen.ts
//
// Explica qué hace una pantalla para alguien que no programa (tarea 2.6).
// Lee de forma contenida el mapa de pantallas, arma un contexto acotado con
// los archivos de entrada (hasta 3 archivos, máximo 3.000 caracteres c/u,
// tope total 12.000 caracteres) y consulta el modelo asignado a 'gitcron-cartography'.
// Cachea el resultado por hash de contenido de los archivos y exige JSON
// válido con texto y citas comprobables dentro de la pantalla.

import { createHash } from 'node:crypto';
import type { ScreenDescription, ScreenMap } from '../../../types/screen-map';
import type { getCartoExplanation, upsertCartoExplanation } from '../../db/carto-cache';
import type { resolveForUse } from '../use-resolution';
import type { runTextUse } from '../text-use';

export interface DescribeScreenDeps {
  buildMap(): Promise<ScreenMap>;
  readFile(relPath: string): Promise<string | null>;
  resolveModel: typeof resolveForUse;
  runText: typeof runTextUse;
  cache: { get: typeof getCartoExplanation; put: typeof upsertCartoExplanation };
  now(): string;
}

const MAX_SNIPPET_CHARS = 3_000;
const MAX_TOTAL_SNIPPET_CHARS = 12_000;
const MAX_TEXT_CHARS = 400;

export async function describeScreen(
  args: {
    repoPath: string;
    screenId: string;
    language: 'es' | 'en' | 'zh';
    cacheOnly?: boolean;
  },
  deps: DescribeScreenDeps,
): Promise<{ status: 'ok'; description: ScreenDescription } | { status: 'unavailable'; message: string } | null> {
  const map = await deps.buildMap();
  const screen = map.screens.find((s) => s.id === args.screenId);
  if (!screen) {
    return { status: 'unavailable', message: 'La pantalla ya no está en el mapa.' };
  }

  const screenFilePaths = new Set(
    screen.files
      .filter((f) => f.provenance !== 'unknown')
      .map((f) => f.path.replace(/\\/g, '/')),
  );

  // Ordenar archivos de entrada: rol 'screen' primero, luego por ruta
  const sortedFiles = [...screen.files].sort((a, b) => {
    if (a.role === 'screen' && b.role !== 'screen') return -1;
    if (a.role !== 'screen' && b.role === 'screen') return 1;
    return a.path.localeCompare(b.path);
  });

  const entrySnippets: { path: string; content: string }[] = [];
  let totalChars = 0;

  for (const fileLink of sortedFiles) {
    if (entrySnippets.length >= 3) break;
    if (fileLink.provenance === 'unknown') continue;

    const raw = await deps.readFile(fileLink.path);
    if (!raw) continue;

    const available = Math.max(0, Math.min(MAX_SNIPPET_CHARS, MAX_TOTAL_SNIPPET_CHARS - totalChars));
    if (available <= 0) break;

    const snippet = raw.slice(0, available);
    entrySnippets.push({ path: fileLink.path, content: snippet });
    totalChars += snippet.length;
  }

  // Hash por contenido: lista de archivos + snippets leídos
  const sha1 = createHash('sha1');
  const allPaths = screen.files.map((f) => f.path).sort();
  sha1.update(allPaths.join('\n'));
  sha1.update('\n---\n');
  for (const s of entrySnippets) {
    sha1.update(`${s.path}:${s.content}\n`);
  }
  const contentHash = sha1.digest('hex');

  const cacheKey = {
    repoPath: args.repoPath,
    nodePath: `screen:${screen.id}`,
    contentHash,
    lang: args.language,
  };

  const cached = deps.cache.get(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached.explanation) as { name?: unknown; text?: unknown; citedFiles?: unknown };
      if (
        parsed &&
        typeof parsed.text === 'string' &&
        Array.isArray(parsed.citedFiles) &&
        parsed.citedFiles.every((c) => typeof c === 'string')
      ) {
        const cachedName =
          typeof parsed.name === 'string' && parsed.name.trim() && parsed.name.trim().length <= 40
            ? parsed.name.trim()
            : undefined;
        return {
          status: 'ok',
          description: {
            text: parsed.text,
            source: 'ai',
            suggestedName: cachedName,
            citedFiles: parsed.citedFiles,
            model: cached.model ?? cached.provider,
            createdAt: cached.generatedAt,
          },
        };
      }
    } catch (error) {
      // Una entrada vieja o rota de la caché se trata como si no estuviera: se vuelve a pedir.
      console.warn('[describe-screen] entrada de caché ilegible, se descarta', error);
    }
  }

  if (args.cacheOnly) {
    return null;
  }

  const modelConfig = deps.resolveModel('gitcron-cartography', args.repoPath);
  if (modelConfig.status !== 'resolved') {
    const message =
      modelConfig.status === 'unset'
        ? 'Todavía no elegiste un modelo. Elegilo en el selector del chat o en Motores y modelos.'
        : 'El modelo elegido no está disponible ahora.';
    return { status: 'unavailable', message };
  }

  const langNames: Record<'es' | 'en' | 'zh', string> = {
    es: 'español',
    en: 'English',
    zh: '中文',
  };

  const system = [
    'Sos el asistente de arquitectura de software de GitCron.',
    `Idioma requerido: ${langNames[args.language]}.`,
    'Explicá en una o dos frases para alguien que no programa qué hace esta pantalla para quien la usa (no cómo está hecha) y dale un nombre corto y claro (hasta 40 caracteres) en el idioma pedido (ejemplos: "Historial de cambios", "Ajustes").',
    'Basate exclusivamente en los archivos provistos.',
    'Respondé únicamente con un objeto JSON estricto sin bloques de código ni formato adicional markdown:',
    '{"name": "...", "text": "...", "citedFiles": ["ruta/archivo1", ...]}',
    'Requisitos obligatorios:',
    '- "name": nombre corto de hasta 40 caracteres, no vacío.',
    '- "text": texto explicativo no vacío de hasta 400 caracteres.',
    '- "citedFiles": arreglo no vacío con las rutas de los archivos de la pantalla en los que te basaste.',
  ].join('\n');

  const userContext = [
    `Pantalla: ${screen.name} (${screen.kind})`,
    `Ubicación: ${screen.locator}`,
    `Declarada en: ${screen.declaredIn}`,
    'Archivos que componen la pantalla:',
    ...screen.files.map((f) => `  - [${f.role}] ${f.path}${f.shared ? ' (compartido)' : ''}`),
    '',
    'Contenido de archivos clave de entrada:',
    ...entrySnippets.map((s) => `--- ${s.path} ---\n${s.content}\n`),
  ].join('\n');

  let rawOutput: string;
  let modelIdentifier = modelConfig.resolved?.providerName ?? 'ai';

  try {
    const textResult = await deps.runText(modelConfig, {
      system,
      user: userContext,
      maxTokens: 500,
      repoPath: args.repoPath,
    });
    rawOutput = textResult.text;
    if (textResult.modelId) {
      modelIdentifier = textResult.modelId;
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { status: 'unavailable', message: msg };
  }

  let parsed: unknown;
  try {
    const cleanJson = rawOutput.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    parsed = JSON.parse(cleanJson);
  } catch {
    return { status: 'unavailable', message: 'La IA no dio una explicación que se pueda comprobar.' };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { status: 'unavailable', message: 'La IA no dio una explicación que se pueda comprobar.' };
  }

  const { name, text, citedFiles } = parsed as {
    name?: unknown;
    text?: unknown;
    citedFiles?: unknown;
  };

  // El nombre es un extra: si falta o no sirve, la explicación se muestra igual, sin nombre sugerido.
  const suggestedName =
    typeof name === 'string' && name.trim() && name.trim().length <= 40 ? name.trim() : undefined;

  if (typeof text !== 'string' || !text.trim() || text.trim().length > MAX_TEXT_CHARS) {
    return { status: 'unavailable', message: 'La IA no dio una explicación que se pueda comprobar.' };
  }

  if (!Array.isArray(citedFiles) || citedFiles.length === 0) {
    return { status: 'unavailable', message: 'La IA no dio una explicación que se pueda comprobar.' };
  }

  const normCited: string[] = [];
  for (const file of citedFiles) {
    if (typeof file !== 'string') {
      return { status: 'unavailable', message: 'La IA no dio una explicación que se pueda comprobar.' };
    }
    const norm = file.replace(/\\/g, '/');
    if (!screenFilePaths.has(norm)) {
      return { status: 'unavailable', message: 'La IA no dio una explicación que se pueda comprobar.' };
    }
    normCited.push(norm);
  }

  const createdAt = deps.now();
  const description: ScreenDescription = {
    text: text.trim(),
    source: 'ai',
    ...(suggestedName ? { suggestedName } : {}),
    citedFiles: normCited,
    model: modelIdentifier,
    createdAt,
  };

  deps.cache.put({
    repoPath: args.repoPath,
    nodePath: `screen:${screen.id}`,
    contentHash,
    lang: args.language,
    provider: 'ai',
    model: modelIdentifier,
    explanation: JSON.stringify({
      name: description.suggestedName,
      text: description.text,
      citedFiles: description.citedFiles,
    }),
    generatedAt: createdAt,
  });

  return { status: 'ok', description };
}
