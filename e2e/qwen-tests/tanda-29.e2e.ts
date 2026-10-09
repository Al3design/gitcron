// e2e/qwen-tests/tanda-29.e2e.ts
//
// Tanda 29c: IA real en GitCron con Ale-Consola (Cloudflare, LAN, Qwen 3.5 2B).
// Tests independientes por recorrido (1 a 6) con diagnóstico previo (preflight),
// localizadores por alcance y afirmaciones pertinentes sobre el contenido.

import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { parse } from 'jsonc-parser';
import { spawnSync } from 'node:child_process';
import { buildSanitizedOpenCodeConfigConsola } from '../qwen-remoto.config';

// Directorio raíz del repositorio resuelto desde la ubicación del archivo
const REPO_ROOT = path.resolve(import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname), '../../');
const REPORT_DIR = path.resolve(REPO_ROOT, process.env.TANDA_REPORT_DIR ? `tmp/reportes/${process.env.TANDA_REPORT_DIR}` : 'tmp/reportes/tanda-29d');
fs.mkdirSync(REPORT_DIR, { recursive: true });

// ─────────────────────────────────────────────────────────────
// PREFLIGHT: Diagnóstico corto desde Node antes de las pantallas
// ─────────────────────────────────────────────────────────────
interface PreflightTargetResult {
  providerId: string;
  name: string;
  url: string;
  modelsHttp?: number;
  modelsDurationMs: number;
  modelsError?: { type: string; code: string | number; message: string };
  loadedModel?: string;
  quant?: string;
  serverContextLength?: number;
  configuredContextLimit?: number;
  completionHttp?: number;
  completionDurationMs: number;
  completionTokens?: number;
  completionError?: { type: string; code: string | number; message: string };
  ok: boolean;
}

interface PreflightSummary {
  timestamp: string;
  cloudflare: PreflightTargetResult;
  lan: PreflightTargetResult;
}

let cachedPreflight: PreflightSummary | null = null;

function resolveHeaderValue(val: unknown): string {
  if (typeof val !== 'string') return '';
  const m = val.match(/^\{env:([A-Za-z0-9_]+)\}$/);
  return m ? (process.env[m[1]] ?? '') : val;
}

function getProviderHeaders(provider: any): Record<string, string> {
  const headers: Record<string, string> = {};
  if (provider?.options?.apiKey) {
    headers['Authorization'] = `Bearer ${resolveHeaderValue(provider.options.apiKey)}`;
  }
  if (provider?.options?.headers) {
    for (const [k, v] of Object.entries(provider.options.headers)) {
      headers[k] = resolveHeaderValue(v);
    }
  }
  return headers;
}

async function runPreflightProbe(): Promise<PreflightSummary> {
  if (cachedPreflight) return cachedPreflight;

  const preflightFile = path.join(REPORT_DIR, 'preflight.json');
  const aleOpenCodePath = path.join(os.homedir(), '.config', 'opencode', 'opencode.json');
  const aleOriginal = parse(fs.readFileSync(aleOpenCodePath, 'utf8'));

  async function probe(providerId: string, provider: any): Promise<PreflightTargetResult> {
    const baseURL = (provider?.options?.baseURL || '').replace(/\/+$/, '');
    const headers = getProviderHeaders(provider);
    const configuredContext = provider?.models?.['unsloth/Qwen3.5-2B-GGUF']?.limit?.context;

    const result: PreflightTargetResult = {
      providerId,
      name: provider?.name || providerId,
      url: baseURL,
      modelsDurationMs: 0,
      completionDurationMs: 0,
      configuredContextLimit: typeof configuredContext === 'number' ? configuredContext : undefined,
      ok: false,
    };

    // 1. GET /models (10 s límite)
    const t0 = Date.now();
    try {
      const res = await fetch(`${baseURL}/models`, {
        headers,
        signal: AbortSignal.timeout(10_000),
      });
      result.modelsHttp = res.status;
      result.modelsDurationMs = Date.now() - t0;
      const text = await res.text();
      try {
        const body = JSON.parse(text);
        const data = Array.isArray(body?.data) ? body.data : [];
        const loaded = data.find((m: any) => m.loaded === true) || data.find((m: any) => m.id === 'unsloth/Qwen3.5-2B-GGUF') || data[0];
        if (loaded) {
          result.loadedModel = loaded.id;
          result.quant = loaded.quant;
          result.serverContextLength = loaded.context_length;
        }
      } catch {
        // respuesta no json
      }
    } catch (err: any) {
      result.modelsDurationMs = Date.now() - t0;
      result.modelsError = {
        type: err?.name === 'TimeoutError' ? 'timeout' : 'transport',
        code: err?.code || (err?.cause as any)?.code || 'ERR',
        message: err?.message || String(err),
      };
    }

    // 2. Generación mínima (30 s límite)
    const t1 = Date.now();
    try {
      const res2 = await fetch(`${baseURL}/chat/completions`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'unsloth/Qwen3.5-2B-GGUF',
          messages: [{ role: 'user', content: 'Di OK' }],
          max_tokens: 5,
          temperature: 0.1,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      result.completionHttp = res2.status;
      result.completionDurationMs = Date.now() - t1;
      const text2 = await res2.text();
      try {
        const body2 = JSON.parse(text2);
        result.completionTokens = body2?.usage?.completion_tokens;
        if (res2.status === 200) {
          result.ok = true;
        }
      } catch {
        // respuesta no json
      }
    } catch (err: any) {
      result.completionDurationMs = Date.now() - t1;
      result.completionError = {
        type: err?.name === 'TimeoutError' ? 'timeout' : 'transport',
        code: err?.code || (err?.cause as any)?.code || 'ERR',
        message: err?.message || String(err),
      };
    }

    return result;
  }

  const cloudflare = await probe('unslothconsola', aleOriginal.provider?.unslothconsola);
  const lan = await probe('unslothconsolalocal', aleOriginal.provider?.unslothconsolalocal);

  cachedPreflight = {
    timestamp: new Date().toISOString(),
    cloudflare,
    lan,
  };

  fs.writeFileSync(preflightFile, JSON.stringify(cachedPreflight, null, 2), 'utf8');
  return cachedPreflight;
}

// ─────────────────────────────────────────────────────────────
// HELPERS COMPARTIDOS
// ─────────────────────────────────────────────────────────────

/** Espera explícita con nombre de etapa y diagnóstico de lo último visible si vence el plazo. */
async function pollUntil<T>(
  stageName: string,
  timeoutMs: number,
  checkFn: () => Promise<T | null | false | undefined>,
  getLastVisible?: () => Promise<string>,
  pollIntervalMs = 500,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await checkFn();
    if (res !== null && res !== false && res !== undefined) {
      return res;
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  const lastVisible = getLastVisible ? await getLastVisible().catch(() => 'no disponible') : 'no disponible';
  throw new Error(`[Plazo vencido en etapa "${stageName}" tras ${timeoutMs}ms] Último estado visible: ${lastVisible}`);
}

/** Configuración de rutas e inicialización de repositorios en el navegador */
async function setupTestRepoAndPaths(browser: any) {
  const paths = (await browser.evaluate(async () => {
    const config = await window.api!.aiConfig!.readFileContent({ scope: 'global' });
    if (!config.data) throw new Error('Falta el perfil aislado');
    const home = config.data.path.replace(/[\\/]\.config[\\/]gitcron[\\/]gitcron\.json$/, '');
    const repo = `${home}/tanda29-repo`;
    const gitcronJson = config.data.path;
    const opencodeJson = `${home}/.config/opencode/opencode.json`;
    await window.api!.storageSet('openRepoPaths', JSON.stringify([repo]));
    await window.api!.storageSet('activeRepoPath', repo);
    return { home, repo, gitcronJson, opencodeJson };
  })) as { home: string; repo: string; gitcronJson: string; opencodeJson: string };

  return paths;
}

/** Captura explícita sincronizada a tmp/reportes/tanda-29c */
async function capture(app: any, label: string) {
  await app.screenshot(label);
  try {
    const generatedArtifactsDir = path.resolve(REPO_ROOT, 'e2e/.e2e/artifacts');
    if (fs.existsSync(generatedArtifactsDir)) {
      const findPngs = (dir: string): string[] => {
        const results: string[] = [];
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) results.push(...findPngs(full));
          else if (entry.isFile() && entry.name.endsWith('.png') && entry.name.includes(label)) {
            results.push(full);
          }
        }
        return results;
      };
      for (const src of findPngs(generatedArtifactsDir)) {
        const destName = path.basename(src).replace(/^\d+-/, '');
        fs.copyFileSync(src, path.join(REPORT_DIR, destName));
      }
    }
  } catch {}
}

/** Navegar a Ajustes usando la barra lateral de forma no ambigua */
async function openSettings(screen: any) {
  const isSettingsOpen = await screen.getByRole('button', 'Motores y modelos').first().isVisible().catch(() => false);
  if (isSettingsOpen) return;
  const sidebar = screen.getByRole('complementary', 'Barra lateral');
  await sidebar.getByRole('button', 'Configuración').click();
  await new Promise((r) => setTimeout(r, 600));
}

/** Navegar a una pestaña de Ajustes */
async function ensureSettingsTab(screen: any, tabName: string) {
  await openSettings(screen);
  await screen.getByRole('button', tabName).first().click();
  await new Promise((r) => setTimeout(r, 600));
}

/** Volver al repositorio desde la pantalla principal */
async function returnToRepository(screen: any) {
  const main = screen.getByRole('main');
  const backBtn = main.getByRole('button', /Volver al Repositorio|Back to repo/i);
  if (await backBtn.isVisible().catch(() => false)) {
    await backBtn.click();
    await new Promise((r) => setTimeout(r, 400));
  }
}

/** Asegurar vista SDD desde la navegación superior */
async function ensureSddView(screen: any) {
  const nav = screen.getByRole('navigation', 'Navegación');
  expect(await nav.isVisible()).toBe(true);
  const currentViewBtn = nav.getByRole('button').first();
  const currentText = (await currentViewBtn.textContent()) ?? '';
  if (!currentText.includes('SDD')) {
    await currentViewBtn.click();
    await screen.getByRole('menuitem', /SDD/).click();
    await new Promise((r) => setTimeout(r, 400));
  }
  // Si el panel de detalles está abierto, cerrarlo para que se monte el riel de navegación de Vistas
  const hideDetailsBtn = screen.getByRole('button', /Ocultar panel de detalles|Hide details panel/i);
  if (await hideDetailsBtn.isVisible().catch(() => false)) {
    await hideDetailsBtn.click();
    await new Promise((r) => setTimeout(r, 400));
  }
}

/** Esperar a que el catálogo confirme la disponibilidad del proveedor antes de elegirlo */
async function ensureProviderAvailable(browser: any, repo: string, use: string, providerId: string) {
  await pollUntil(
    `catalogo-confirmar-${providerId}-${use}`,
    30_000,
    async () => {
      return await browser.evaluate(async (args: { repo: string; use: string; providerId: string }) => {
        let res = await window.api!.aiUse!.models({ use: args.use as any, repoPath: args.repo });
        let p = res.data?.providers.find((item: any) => item.id === args.providerId);
        if (!p?.available) {
          res = await window.api!.aiUse!.refreshModels({ use: args.use as any, repoPath: args.repo });
          p = res.data?.providers.find((item: any) => item.id === args.providerId);
        }
        return Boolean(p?.available === true && !p?.unconfirmed) ? true : null;
      }, { repo, use, providerId });
    },
    async () => `Esperando disponibilidad de ${providerId} para ${use} en catálogo`,
    1000,
  );
}

// ─────────────────────────────────────────────────────────────
// RECORRIDO 1: IMPORTAR ALE-CONSOLA Y ELEGIR DESDE LA PANTALLA
// ─────────────────────────────────────────────────────────────
test('Recorrido 1: Importar Ale-Consola y elegir desde la pantalla', async ({ app, screen, browser }) => {
  const preflight = await runPreflightProbe();
  if (!preflight.cloudflare.ok) {
    test.skip(`Consola no respondió adecuadamente en preflight: ${JSON.stringify(preflight.cloudflare.completionError || preflight.cloudflare.modelsError)}`);
  }

  await app.open('/');
  const paths = await setupTestRepoAndPaths(browser);

  const initialGitCron = {
    $schema: 'https://opencode.ai/config.json',
    provider: {
      preexistente: {
        name: 'Servidor Preexistente',
        npm: '@ai-sdk/openai-compatible',
        options: { baseURL: 'http://127.0.0.1:9999/v1' },
        models: { 'sentinel-model': { name: 'Sentinel Model' } },
      },
    },
    agent: {
      'gitcron-cartography': { model: 'preexistente/sentinel-model' },
      'gitcron-openspec-analysis': { model: 'preexistente/sentinel-model' },
      'gitcron-temporal': { model: 'preexistente/sentinel-model' },
      'gitcron-sdd': { model: 'preexistente/sentinel-model' },
    },
  };
  fs.writeFileSync(paths.gitcronJson, JSON.stringify(initialGitCron, null, 2), 'utf8');

  const aleOpenCodePath = path.join(os.homedir(), '.config', 'opencode', 'opencode.json');
  const aleOriginal = parse(fs.readFileSync(aleOpenCodePath, 'utf8'));
  const sanitizedConsola = buildSanitizedOpenCodeConfigConsola(aleOriginal);
  fs.writeFileSync(paths.opencodeJson, JSON.stringify(sanitizedConsola, null, 2), 'utf8');

  const aleHashBefore = crypto.createHash('sha256').update(fs.readFileSync(aleOpenCodePath)).digest('hex');
  const fixtureOpenCodeHashBefore = crypto.createHash('sha256').update(fs.readFileSync(paths.opencodeJson)).digest('hex');

  await browser.reload();
  await ensureSettingsTab(screen, 'Motores y modelos');

  await expect(screen.getByTestId('accordion-group-opencode')).toBeVisible();
  const groupImport = screen.getByTestId('accordion-group-opencode').getByRole('button').first();
  const isImportOpen = await groupImport.getAttribute('aria-expanded');
  if (isImportOpen !== 'true') {
    await groupImport.click();
  }

  await screen.getByRole('button', /Comprobar opencode\.json|Check opencode\.json/).click();
  await expect(screen.getByRole('checkbox', 'provider: unslothconsola')).toBeVisible();
  await expect(screen.getByRole('checkbox', 'provider: unslothconsolalocal')).toBeVisible();

  await screen.getByRole('button', /Importar lo elegido|Import selected/).click();
  await expect(screen.getByText(/Se importaron \d+ bloques|Imported \d+ blocks/)).toBeVisible();

  // Comprobar disco: proveedor preexistente y URLs esperadas basadas en origen, no literales fijas
  const importedGitCron = parse(fs.readFileSync(paths.gitcronJson, 'utf8'));
  expect(importedGitCron.provider?.preexistente).toEqual(initialGitCron.provider.preexistente);
  expect(importedGitCron.provider?.unslothconsola).toBeDefined();
  expect(importedGitCron.provider?.unslothconsola?.options?.baseURL).toBe(sanitizedConsola.provider.unslothconsola.options.baseURL);
  expect(importedGitCron.provider?.unslothconsolalocal).toBeDefined();
  expect(importedGitCron.provider?.unslothconsolalocal?.options?.baseURL).toBe(sanitizedConsola.provider.unslothconsolalocal.options.baseURL);

  // Comprobar que archivos fuente de OpenCode no sufrieron ninguna modificación
  const aleHashAfter = crypto.createHash('sha256').update(fs.readFileSync(aleOpenCodePath)).digest('hex');
  const fixtureOpenCodeHashAfter = crypto.createHash('sha256').update(fs.readFileSync(paths.opencodeJson)).digest('hex');
  expect(aleHashAfter).toBe(aleHashBefore);
  expect(fixtureOpenCodeHashAfter).toBe(fixtureOpenCodeHashBefore);

  // Elegir Qwen 3.5 2B para «Redacción de commit» desde la pantalla
  const groupUses = screen.getByTestId('accordion-group-uses').getByRole('button').first();
  const isUsesOpen = await groupUses.getAttribute('aria-expanded');
  if (isUsesOpen !== 'true') {
    await groupUses.click();
  }

  const filaCommit = screen.getByTestId('use-row-gitcron-commit');
  const cabeceraFilaCommit = filaCommit.getByRole('button').first();
  const isCommitRowExpanded = await cabeceraFilaCommit.getAttribute('aria-expanded');
  if (isCommitRowExpanded !== 'true') {
    await cabeceraFilaCommit.click();
  }

  await ensureProviderAvailable(browser, paths.repo, 'gitcron-commit', 'unslothconsola');

  await filaCommit.getByRole('button', /Elegir modelo|Choose model/).click();
  const picker = filaCommit.getByTestId('ai-model-picker');
  await expect(picker).toBeVisible();

  await picker.getByLabel('Proveedor').selectOption({ value: 'unslothconsola' });
  await new Promise((r) => setTimeout(r, 500));
  await picker.getByLabel('Modelo').selectOption({ value: 'unsloth/Qwen3.5-2B-GGUF' });
  await picker.getByRole('button', /Guardar|Save/i).click();
  await expect(picker).toBeHidden();

  await cabeceraFilaCommit.click();
  await expect(filaCommit).toContainText('unsloth/Qwen3.5-2B-GGUF');

  // Preservación: verificar que los demás usos centinela no cambiaron
  const gitCronAfterChoose = parse(fs.readFileSync(paths.gitcronJson, 'utf8'));
  expect(gitCronAfterChoose.agent?.['gitcron-commit']?.model).toBe('unslothconsola/unsloth/Qwen3.5-2B-GGUF');
  expect(gitCronAfterChoose.agent?.['gitcron-cartography']?.model).toBe('preexistente/sentinel-model');
  expect(gitCronAfterChoose.agent?.['gitcron-openspec-analysis']?.model).toBe('preexistente/sentinel-model');
  expect(gitCronAfterChoose.agent?.['gitcron-temporal']?.model).toBe('preexistente/sentinel-model');
  expect(gitCronAfterChoose.agent?.['gitcron-sdd']?.model).toBe('preexistente/sentinel-model');

  await capture(app, 'tanda-29-01-importar-y-elegir');
});

// ─────────────────────────────────────────────────────────────
// RECORRIDO 2: REDACCIÓN DE COMMIT CON QWEN 2B (CLOUDFLARE)
// ─────────────────────────────────────────────────────────────
test('Recorrido 2: Redacción de commit con Qwen 2B (Cloudflare)', async ({ app, screen, browser }) => {
  const preflight = await runPreflightProbe();
  if (!preflight.cloudflare.ok) {
    test.skip(`Consola no respondió adecuadamente en preflight: ${JSON.stringify(preflight.cloudflare.completionError || preflight.cloudflare.modelsError)}`);
  }

  await app.open('/');
  const paths = await setupTestRepoAndPaths(browser);

  // Preparar gitcron.json con unslothconsola asignado a gitcron-commit
  const aleOpenCodePath = path.join(os.homedir(), '.config', 'opencode', 'opencode.json');
  const aleOriginal = parse(fs.readFileSync(aleOpenCodePath, 'utf8'));
  const sanitizedConsola = buildSanitizedOpenCodeConfigConsola(aleOriginal);
  fs.writeFileSync(paths.opencodeJson, JSON.stringify(sanitizedConsola, null, 2), 'utf8');

  const configWithCommit = {
    $schema: 'https://opencode.ai/config.json',
    provider: sanitizedConsola.provider,
    agent: {
      'gitcron-commit': { model: 'unslothconsola/unsloth/Qwen3.5-2B-GGUF' },
    },
  };
  fs.writeFileSync(paths.gitcronJson, JSON.stringify(configWithCommit, null, 2), 'utf8');

  const headShaBefore = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: paths.repo, encoding: 'utf8' }).stdout.trim();
  await browser.reload();

  await ensureSddView(screen);

  const btnPreparar = screen.getByRole('button', { name: /Preparar commit|Prepare commit/i });
  await btnPreparar.click();

  const drawerRegion = screen.getByRole('region', 'Preparar el commit del repositorio');
  await expect(drawerRegion).toBeVisible();

  await expect(drawerRegion.getByText('cronometria.txt')).toBeVisible();
  const cronoCheckbox = drawerRegion.getByRole('checkbox', /cronometria\.txt/i);
  await cronoCheckbox.click();

  // Verificar atribución visible de Qwen 2B en AiUseLine dentro del cajón
  await expect(drawerRegion.getByText(/unsloth\/Qwen3\.5-2B-GGUF/)).toBeVisible();

  const draftButton = drawerRegion.getByRole('button', /Redactar con IA|Draft with AI/i);
  await expect(draftButton).toBeEnabled();

  const startDraftTime = Date.now();
  await draftButton.click();

  const msgField = drawerRegion.getByRole('textbox', /Mensaje sugerido/i);
  const draftedText = await pollUntil<string>(
    'redaccion-commit-qwen2b',
    120_000,
    async () => {
      const isThinking = await browser.evaluate(() => document.querySelector('.ai-thinking-text') !== null);
      const text = await msgField.inputValue();
      return (!isThinking && text.trim().length > 0) ? text : null;
    },
    async () => `Texto actual del mensaje sugerido: "${await msgField.inputValue()}"`,
    1000,
  );

  const elapsedDraftMs = Date.now() - startDraftTime;
  console.log(JSON.stringify({
    stage: 'qwen2b-commit-draft-completed',
    elapsedMs: elapsedDraftMs,
    draftMessage: draftedText,
  }));

  expect(draftedText.trim().length).toBeGreaterThan(0);
  expect(draftedText.toLowerCase()).toMatch(/cronometr|latencia|percentil|telemetr|mili/i);

  // Probar descartar borrador y restaurar desde la pantalla
  await msgField.fill('');
  expect(await msgField.inputValue()).toBe('');
  await msgField.fill(draftedText);
  expect(await msgField.inputValue()).toBe(draftedText);

  // Verificar que NO hubo commits en git
  const headShaAfter = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: paths.repo, encoding: 'utf8' }).stdout.trim();
  expect(headShaAfter).toBe(headShaBefore);

  // Verificar registro en ai-use-history
  const rawCommitHistory = await browser.evaluate(async (repo: string) => {
    const res = await window.api!.aiUseHistory!.list({ repoPath: repo, use: 'gitcron-commit' });
    return JSON.stringify(res.data?.items ?? []);
  }, paths.repo);
  const commitRecords = JSON.parse(rawCommitHistory as string);
  expect(commitRecords.length).toBeGreaterThan(0);
  expect(commitRecords[0].providerId).toBe('unslothconsola');
  expect(commitRecords[0].modelId).toBe('unsloth/Qwen3.5-2B-GGUF');
  expect(commitRecords[0].resultStatus).toBe('generated');

  await capture(app, 'tanda-29-02-commit-qwen2b');

  await drawerRegion.getByRole('button', 'Cerrar').click();
  await expect(drawerRegion).toBeHidden();
});

// ─────────────────────────────────────────────────────────────
// RECORRIDO 3: CONSULTA DE CARTOGRAFÍA CON QWEN 2B DESDE SU PANTALLA
// ─────────────────────────────────────────────────────────────
test('Recorrido 3: Consulta de Cartografía con Qwen 2B desde su pantalla', async ({ app, screen, browser }) => {
  const preflight = await runPreflightProbe();
  if (!preflight.cloudflare.ok) {
    test.skip(`Consola no respondió adecuadamente en preflight: ${JSON.stringify(preflight.cloudflare.completionError || preflight.cloudflare.modelsError)}`);
  }

  await app.open('/');
  const paths = await setupTestRepoAndPaths(browser);

  // Indexar el grafo de Cartografía (preparación de datos por IPC)
  await browser.evaluate(async (repo: string) => {
    await window.api!.cartoGraph!.ensure(repo);
    return true;
  }, paths.repo);

  await pollUntil(
    'carto-graph-ready',
    40_000,
    async () => {
      const isReady = await browser.evaluate(async (repo: string) => {
        const s = (await window.api!.cartoGraph!.status(repo)) as any;
        return (s?.data?.state ?? s?.state) === 'ready';
      }, paths.repo);
      return isReady ? true : null;
    },
    async () => 'Esperando indexación del grafo de Cartografía',
    500,
  );

  // Preparar proveedor en gitcron.json
  const aleOpenCodePath = path.join(os.homedir(), '.config', 'opencode', 'opencode.json');
  const aleOriginal = parse(fs.readFileSync(aleOpenCodePath, 'utf8'));
  const sanitizedConsola = buildSanitizedOpenCodeConfigConsola(aleOriginal);
  const currentGitCron = {
    $schema: 'https://opencode.ai/config.json',
    provider: sanitizedConsola.provider,
    agent: {},
  };
  fs.writeFileSync(paths.gitcronJson, JSON.stringify(currentGitCron, null, 2), 'utf8');
  await browser.reload();

  // Navegar a Ajustes -> Cartografía
  await ensureSettingsTab(screen, 'Cartografía (Beta)');

  // Activar interruptores de Cartografía e IA desde la pantalla si no están activos
  const mainSec = screen.getByRole('main');
  const btnActivarCarto = mainSec.getByRole('button', /Vista Cartografía/i);
  await expect(btnActivarCarto).toBeVisible();
  const cartoActiveLabel = (await btnActivarCarto.getAttribute('aria-label')) ?? (await btnActivarCarto.textContent()) ?? '';
  if (cartoActiveLabel.includes('Inactiva') || cartoActiveLabel.includes('Inactive')) {
    await btnActivarCarto.click();
    await new Promise((r) => setTimeout(r, 600));
  }

  const aiSection = mainSec.getByRole('region', /Asistente de IA/i);
  const btnActivarCartoAi = aiSection.getByRole('button', /IA de Cartografía/i);
  await expect(btnActivarCartoAi).toBeVisible();
  const cartoAiLabel = (await btnActivarCartoAi.getAttribute('aria-label')) ?? (await btnActivarCartoAi.textContent()) ?? '';
  if (cartoAiLabel.includes('Inactiva') || cartoAiLabel.includes('Inactive')) {
    await btnActivarCartoAi.click();
    await new Promise((r) => setTimeout(r, 600));
  }

  // Elegir modelo unslothconsola / Qwen 3.5 2B en la sección de Cartografía
  await ensureProviderAvailable(browser, paths.repo, 'gitcron-cartography', 'unslothconsola');
  const btnElegirModeloCarto = aiSection.getByRole('button', /Elegir modelo|Choose model/i);
  await expect(btnElegirModeloCarto).toBeVisible();
  await btnElegirModeloCarto.click();

  const cartoPicker = screen.getByTestId('ai-model-picker');
  await expect(cartoPicker).toBeVisible();
  await cartoPicker.getByLabel('Proveedor').selectOption({ value: 'unslothconsola' });
  await new Promise((r) => setTimeout(r, 500));
  await cartoPicker.getByLabel('Modelo').selectOption({ value: 'unsloth/Qwen3.5-2B-GGUF' });
  await cartoPicker.getByRole('button', /Guardar|Save/i).click();
  await expect(cartoPicker).toBeHidden();

  // Volver al repositorio usando el control del contenedor principal
  await returnToRepository(screen);

  // Abrir Cartografía desde la barra lateral (RepoSidebar)
  const sidebar = screen.getByRole('complementary', 'Barra lateral');
  const btnAbrirCarto = sidebar.getByRole('button', /Abrir Cartografía|Open Cartography/i);
  await expect(btnAbrirCarto).toBeVisible();
  await btnAbrirCarto.click();

  // Campo de consulta visible
  const cartoInput = screen.getByPlaceholder(/Preguntá algo sobre este repositorio/i);
  await expect(cartoInput).toBeVisible();

  // Pregunta sin dar la respuesta en la consigna (Requisito 4)
  const cartoQuestion = '¿Cuál es el nombre de la función que valida la latencia y en qué archivo está definida? Indica la función y la ruta del archivo.';
  await cartoInput.fill(cartoQuestion);
  const btnPreguntar = screen.getByRole('button', /Preguntar|Ask/i);
  await btnPreguntar.click();

  // Esperar respuesta de IA con plazo explícito
  const cartoResult = await pollUntil<{ bodyText: string; attributionText: string }>(
    'carto-ai-response',
    90_000,
    async () => {
      const isThinking = await browser.evaluate(() => document.querySelector('.ai-thinking-text') !== null);
      const data = await browser.evaluate(() => {
        const bubbles = document.querySelectorAll('.ai-surface.ai-panel');
        const last = bubbles[bubbles.length - 1];
        if (!last) return null;
        const bodyP = last.querySelector('p.whitespace-pre-wrap');
        const attrP = last.querySelector('p.font-mono');
        return {
          bodyText: bodyP ? (bodyP.textContent ?? '').trim() : '',
          attributionText: attrP ? (attrP.textContent ?? '').trim() : '',
        };
      });
      if (!isThinking && data && data.bodyText.length > 0) return data;
      return null;
    },
    async () => 'Esperando generación de respuesta en CartoAskBox',
    1000,
  );

  console.log(JSON.stringify({
    stage: 'carto-ui-ask-completed',
    bodyText: cartoResult.bodyText,
    attributionText: cartoResult.attributionText,
  }));

  // Guardar la respuesta recibida para evidencia de auditoría
  fs.writeFileSync(path.join(REPORT_DIR, 'cartografia-respuesta-qwen2b.txt'), `${cartoResult.attributionText}\n\n${cartoResult.bodyText}\n`, 'utf8');

  // Requisito 4: La respuesta debe nombrar medirLatencia y src/telemetria.ts en el cuerpo,
  // excluyendo referencias consultadas y línea de procedencia.
  expect(cartoResult.bodyText).toContain('medirLatencia');
  expect(cartoResult.bodyText).toContain('src/telemetria.ts');

  // Comprobar la atribución por separado en su propio elemento
  expect(cartoResult.attributionText).toMatch(/unslothconsola|Unsloth Ale-Consola/i);

  // Registro en ai-use-history
  const rawCartoHistory = await browser.evaluate(async (repo: string) => {
    const res = await window.api!.aiUseHistory!.list({ repoPath: repo, use: 'gitcron-cartography' });
    return JSON.stringify(res.data?.items ?? []);
  }, paths.repo);
  const cartoRecords = JSON.parse(rawCartoHistory as string);
  expect(cartoRecords.length).toBeGreaterThan(0);
  expect(cartoRecords[0].providerId).toBe('unslothconsola');
  expect(cartoRecords[0].modelId).toBe('unsloth/Qwen3.5-2B-GGUF');
  expect(cartoRecords[0].resultStatus).toBe('generated');

  await capture(app, 'tanda-29-03-cartografia-qwen2b');

  const btnCerrarCarto = screen.getByRole('main').getByRole('button', /Volver al Grafo|Back to Graph/i);
  await btnCerrarCarto.click();
});

// ─────────────────────────────────────────────────────────────
// RECORRIDO 4: ANÁLISIS DE VERSIÓN OPENSPEC DESDE LA PANTALLA
// ─────────────────────────────────────────────────────────────
test('Recorrido 4: Análisis de versión OpenSpec desde la pantalla', async ({ app, screen, browser }) => {
  const preflight = await runPreflightProbe();
  if (!preflight.cloudflare.ok) {
    test.skip(`Consola no respondió adecuadamente en preflight: ${JSON.stringify(preflight.cloudflare.completionError || preflight.cloudflare.modelsError)}`);
  }

  await app.open('/');
  const paths = await setupTestRepoAndPaths(browser);

  const aleOpenCodePath = path.join(os.homedir(), '.config', 'opencode', 'opencode.json');
  const aleOriginal = parse(fs.readFileSync(aleOpenCodePath, 'utf8'));
  const sanitizedConsola = buildSanitizedOpenCodeConfigConsola(aleOriginal);
  const currentGitCron = {
    $schema: 'https://opencode.ai/config.json',
    provider: sanitizedConsola.provider,
    agent: {},
  };
  fs.writeFileSync(paths.gitcronJson, JSON.stringify(currentGitCron, null, 2), 'utf8');
  await browser.reload();

  await ensureSddView(screen);

  // Abrir la pantalla de revisión de OpenSpec desde la navegación "Vistas" del riel (sin ambigüedad)
  const railVistas = screen.getByRole('navigation', 'Vistas');
  if (await railVistas.isVisible().catch(() => false)) {
    await railVistas.getByRole('button', 'Configuración').click();
  } else {
    await screen.getByRole('status', /OpenSpec v/i).click();
  }

  const reviewRegion = screen.getByRole('region', 'Configuración de OpenSpec');
  await expect(reviewRegion).toBeVisible();

  // Elegir modelo Qwen 2B para el análisis de OpenSpec desde el botón dentro de la región
  await ensureProviderAvailable(browser, paths.repo, 'gitcron-openspec-analysis', 'unslothconsola');
  const btnElegirOpenSpec = reviewRegion.getByRole('button', /Elegir modelo|Choose model/i);
  await expect(btnElegirOpenSpec).toBeVisible();
  await btnElegirOpenSpec.click();

  const openSpecPicker = reviewRegion.getByTestId('ai-model-picker');
  await expect(openSpecPicker).toBeVisible();
  await openSpecPicker.getByLabel('Proveedor').selectOption({ value: 'unslothconsola' });
  await new Promise((r) => setTimeout(r, 500));
  await openSpecPicker.getByLabel('Modelo').selectOption({ value: 'unsloth/Qwen3.5-2B-GGUF' });
  await openSpecPicker.getByRole('button', /Guardar|Save/i).click();
  await expect(openSpecPicker).toBeHidden();

  // Botón visible de redacción de informe
  const btnRedactarReporte = reviewRegion.getByRole('button', /Redactar informe|Redactar reporte|Draft report/i);
  await expect(btnRedactarReporte).toBeVisible();

  // Atribución visible
  await expect(reviewRegion.getByText(/^Usa unsloth\/Qwen3\.5-2B-GGUF/)).toBeVisible();

  const t0OpenSpec = Date.now();
  await btnRedactarReporte.click();

  const openSpecReportText = await pollUntil<string>(
    'openspec-report-redaction',
    120_000,
    async () => {
      const isThinking = await browser.evaluate(() => document.querySelector('.ai-thinking-text') !== null);
      const text = await browser.evaluate(() => {
        const box = document.querySelector('[class*="releaseNotesReportBox"]');
        return box ? (box.textContent ?? '').trim() : '';
      });
      return (!isThinking && text.length > 0) ? text : null;
    },
    async () => 'Esperando finalización de redacción en OpenSpecReleaseNotes',
    1000,
  );

  const elapsedOpenSpecMs = Date.now() - t0OpenSpec;
  console.log(JSON.stringify({
    stage: 'openspec-ui-analysis-completed',
    elapsedMs: elapsedOpenSpecMs,
    reportLength: openSpecReportText.length,
  }));

  // Requisito 3: Terminar generado, sin error, con las secciones requeridas
  const normalizedReport = openSpecReportText
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  expect(normalizedReport).toContain('que hay de nuevo');
  expect(normalizedReport).toContain('que hace de hecho');
  expect(normalizedReport).toContain('como afecta a gitcron');
  const hasApproach = /como encararlo|encarar|adaptaci|no se requieren adaptaciones|pasos concretos/i.test(normalizedReport);
  expect(hasApproach).toBe(true);

  // Atribución en el elemento propio
  const openSpecMeta = await browser.evaluate(() => {
    const metas = Array.from(document.querySelectorAll('[class*="releaseNotesReport"] [class*="axisMeta"]'));
    return metas.map((m) => m.textContent ?? '').join(' | ');
  });
  expect(openSpecMeta).toMatch(/Unsloth Ale-Consola \(Cloudflare\)/i);
  expect(openSpecMeta).toMatch(/unsloth\/Qwen3\.5-2B-GGUF/);
  fs.writeFileSync(path.join(REPORT_DIR, 'openspec-informe-qwen2b.txt'), `${openSpecMeta}\n\n${openSpecReportText}\n`, 'utf8');

  // Historial
  const rawOpenSpecHistory = await browser.evaluate(async (repo: string) => {
    const res = await window.api!.aiUseHistory!.list({ repoPath: repo, use: 'gitcron-openspec-analysis' });
    return JSON.stringify(res.data?.items ?? []);
  }, paths.repo);
  const openSpecRecords = JSON.parse(rawOpenSpecHistory as string);
  expect(openSpecRecords.length).toBeGreaterThan(0);
  expect(openSpecRecords[0].providerId).toBe('unslothconsola');
  expect(openSpecRecords[0].modelId).toBe('unsloth/Qwen3.5-2B-GGUF');
  expect(openSpecRecords[0].resultStatus).toBe('generated');

  await capture(app, 'tanda-29-04-openspec-analisis-qwen2b');

  await reviewRegion.getByRole('button', 'Cerrar').click();
  await expect(reviewRegion).toBeHidden();
});

// ─────────────────────────────────────────────────────────────
// RECORRIDO 5: TEMPORAL AGENT CON QWEN 2B DESDE LA PANTALLA
// ─────────────────────────────────────────────────────────────
test('Recorrido 5: Temporal Agent con Qwen 2B desde la pantalla', async ({ app, screen, browser }) => {
  const preflight = await runPreflightProbe();
  if (!preflight.cloudflare.ok) {
    test.skip(`Consola no respondió adecuadamente en preflight: ${JSON.stringify(preflight.cloudflare.completionError || preflight.cloudflare.modelsError)}`);
  }

  await app.open('/');
  const paths = await setupTestRepoAndPaths(browser);

  const aleOpenCodePath = path.join(os.homedir(), '.config', 'opencode', 'opencode.json');
  const aleOriginal = parse(fs.readFileSync(aleOpenCodePath, 'utf8'));
  const sanitizedConsola = buildSanitizedOpenCodeConfigConsola(aleOriginal);
  const currentGitCron = {
    $schema: 'https://opencode.ai/config.json',
    provider: sanitizedConsola.provider,
    agent: {},
  };
  fs.writeFileSync(paths.gitcronJson, JSON.stringify(currentGitCron, null, 2), 'utf8');
  await browser.reload();

  // Navegar a Ajustes -> Temporal Agent desde la barra lateral sin ambigüedad
  await ensureSettingsTab(screen, 'Temporal Agent');

  const mainSection5 = screen.getByRole('main');
  const btnElegirTemporal = mainSection5.getByRole('button', /Elegir modelo|Choose model/i);
  await expect(btnElegirTemporal).toBeVisible();

  // Abrir selector
  await ensureProviderAvailable(browser, paths.repo, 'gitcron-temporal', 'unslothconsola');
  await btnElegirTemporal.click();
  const temporalPicker = screen.getByTestId('ai-model-picker');
  await expect(temporalPicker).toBeVisible();
  await temporalPicker.getByLabel('Proveedor').selectOption({ value: 'unslothconsola' });
  await new Promise((r) => setTimeout(r, 500));
  await temporalPicker.getByLabel('Modelo').selectOption({ value: 'unsloth/Qwen3.5-2B-GGUF' });
  await temporalPicker.getByRole('button', /Guardar|Save/i).click();
  await expect(temporalPicker).toBeHidden();

  // Botón visible «Predecir futuros»
  const btnPredecir = mainSection5.getByRole('button', /Predecir futuros|Predict/i);
  await expect(btnPredecir).toBeVisible();

  const t0Temporal = Date.now();
  await btnPredecir.click();

  // Esperar a que la predicción termine en pantalla con plazo explícito
  const branchesText = await pollUntil<string[]>(
    'temporal-prediction-branches',
    180_000,
    async () => {
      const isGenerating = await browser.evaluate(() => {
        const btn = document.querySelector('button[disabled]');
        return Boolean(btn && btn.textContent?.toLowerCase().includes('generando'));
      });
      const list = (await browser.evaluate(() => {
        const items = document.querySelectorAll('li strong');
        return Array.from(items).map((el) => (el.textContent ?? '').trim());
      })) as string[];
      if (!isGenerating && list.length > 0) return list;
      return null;
    },
    async () => 'Esperando conclusión de ramas en TemporalAgentSettings',
    1000,
  );

  const elapsedTemporalMs = Date.now() - t0Temporal;
  console.log(JSON.stringify({
    stage: 'temporal-ui-prediction-completed',
    elapsedMs: elapsedTemporalMs,
    branchesCount: branchesText.length,
    branches: branchesText,
  }));

  // Requisito 4: Guardar todas las ramas en tmp/reportes/tanda-29c/temporal-ramas.txt
  fs.writeFileSync(path.join(REPORT_DIR, 'temporal-ramas.txt'), branchesText.join('\n') + '\n', 'utf8');

  // Requisito 4: Exigir que al menos una nombre algo propio del repo temporal
  // (telemetría, latencia, percentiles p95/p99, muestras, cronometría), sin aceptar palabras genéricas.
  expect(branchesText.length).toBeGreaterThan(0);
  const relevantBranches = branchesText.filter((b) =>
    /telemetr|latencia|percentil|p95|p99|muestra|cronometr/i.test(b)
  );
  expect(relevantBranches.length).toBeGreaterThan(0);

  // Historial
  const rawTemporalHistory = await browser.evaluate(async (repo: string) => {
    const res = await window.api!.aiUseHistory!.list({ repoPath: repo, use: 'gitcron-temporal' });
    return JSON.stringify(res.data?.items ?? []);
  }, paths.repo);
  const temporalRecords = JSON.parse(rawTemporalHistory as string);
  expect(temporalRecords.length).toBeGreaterThan(0);
  expect(temporalRecords[0].providerId).toBe('unslothconsola');
  expect(temporalRecords[0].modelId).toBe('unsloth/Qwen3.5-2B-GGUF');
  expect(temporalRecords[0].resultStatus).toBe('generated');

  await capture(app, 'tanda-29-05-temporal-qwen2b');
});

// ─────────────────────────────────────────────────────────────
// RECORRIDO 6: MEDICIÓN LAN, FALLO RECUPERABLE Y CANCELACIÓN
// ─────────────────────────────────────────────────────────────
test('Recorrido 6: Medición LAN, fallo recuperable y cancelación', async ({ app, screen, browser }) => {
  const preflight = await runPreflightProbe();
  if (!preflight.cloudflare.ok) {
    test.skip(`Consola no respondió adecuadamente en preflight: ${JSON.stringify(preflight.cloudflare.completionError || preflight.cloudflare.modelsError)}`);
  }

  await app.open('/');
  const paths = await setupTestRepoAndPaths(browser);

  // 1) Requisito 5: Medición LAN desde Node. Se registra y no se afirma en ningún sentido (no depende de la red de la casa)
  console.log(JSON.stringify({ stage: 'lan-node-measurement', lanMeasurement: preflight.lan }));

  // 2) Proveedor caído controlado (puerto 59999) en el perfil aislado con el mismo modelo declarado
  const aleOpenCodePath = path.join(os.homedir(), '.config', 'opencode', 'opencode.json');
  const aleOriginal = parse(fs.readFileSync(aleOpenCodePath, 'utf8'));
  const sanitizedConsola = buildSanitizedOpenCodeConfigConsola(aleOriginal);

  const configWithDown = {
    $schema: 'https://opencode.ai/config.json',
    provider: {
      ...sanitizedConsola.provider,
      downconsola: {
        name: 'Unsloth Consola (Caído)',
        npm: '@ai-sdk/openai-compatible',
        options: { baseURL: 'http://127.0.0.1:59999/v1' },
        models: {
          'unsloth/Qwen3.5-2B-GGUF': { name: 'Qwen 3.5 2B GGUF' },
        },
      },
    },
    agent: {
      'gitcron-commit': { model: 'downconsola/unsloth/Qwen3.5-2B-GGUF' },
    },
  };
  fs.writeFileSync(paths.gitcronJson, JSON.stringify(configWithDown, null, 2), 'utf8');

  await browser.reload();
  await ensureSddView(screen);

  const btnPrepararCommit6 = screen.getByRole('button', { name: /Preparar commit|Prepare commit/i });
  await btnPrepararCommit6.click();

  const drawerRegion = screen.getByRole('region', 'Preparar el commit del repositorio');
  await expect(drawerRegion).toBeVisible();

  const cronoCheckbox6 = drawerRegion.getByRole('checkbox', /cronometria\.txt/i);
  await cronoCheckbox6.click();

  const commitMsgField = drawerRegion.getByRole('textbox', /Mensaje sugerido/i);
  await commitMsgField.fill('');

  // Disparar redacción con el proveedor caído
  const draftButtonDown = drawerRegion.getByRole('button', /Redactar con IA|Draft with AI/i);
  await draftButtonDown.click();

  // Esperar el fallo y verificar que la pantalla muestra el motivo y la oferta de la alternativa Cloudflare
  // Leído desde el propio aviso dentro del cajón de commit (el párrafo que dice «no responde»)
  const failureNoticeText = await pollUntil<string>(
    'failure-notice-and-cloudflare-alternative',
    40_000,
    async () => {
      const noticeEl = drawerRegion.getByText(/no responde/);
      const isVis = await noticeEl.isVisible().catch(() => false);
      if (!isVis) return null;
      const text = ((await noticeEl.textContent().catch(() => '')) ?? '').trim();
      return (text.includes('no responde') && text.includes('declaran')) ? text : null;
    },
    async () => 'Esperando cartel de proveedor caído en el cajón de commit',
    500,
  );

  console.log(JSON.stringify({ stage: 'down-provider-ui-notice', failureNoticeText }));
  expect(failureNoticeText).toMatch(/Unsloth Ale-Consola \(Cloudflare\)/i);
  expect(failureNoticeText).toMatch(/declaran? los mismos modelos/i);

  // Comprobar que GitCron NO cambió solo al compatible en gitcron.json
  const gitCronStillDown = parse(fs.readFileSync(paths.gitcronJson, 'utf8'));
  expect(gitCronStillDown.agent?.['gitcron-commit']?.model).toBe('downconsola/unsloth/Qwen3.5-2B-GGUF');

  // 3) Elección explícita de la alternativa compatible desde la pantalla
  await ensureProviderAvailable(browser, paths.repo, 'gitcron-commit', 'unslothconsola');
  await drawerRegion.getByRole('button', /Elegir modelo|Choose model/i).click();
  const commitPicker6 = drawerRegion.getByTestId('ai-model-picker');
  await expect(commitPicker6).toBeVisible();
  await commitPicker6.getByLabel('Proveedor').selectOption({ value: 'unslothconsola' });
  await new Promise((r) => setTimeout(r, 500));
  await commitPicker6.getByLabel('Modelo').selectOption({ value: 'unsloth/Qwen3.5-2B-GGUF' });
  await commitPicker6.getByRole('button', /Guardar|Save/i).click();
  await expect(commitPicker6).toBeHidden();

  // Reintento exitoso tras la elección explícita
  await commitMsgField.fill('');
  const draftButtonRecovery = drawerRegion.getByRole('button', /Redactar con IA|Draft with AI/i);
  await draftButtonRecovery.click();

  const recoveryText = await pollUntil<string>(
    'recovery-draft-after-choose',
    60_000,
    async () => {
      const isThinking = await browser.evaluate(() => document.querySelector('.ai-thinking-text') !== null);
      const text = await commitMsgField.inputValue();
      return (!isThinking && text.trim().length > 0) ? text : null;
    },
    async () => 'Esperando borrador recuperado',
    500,
  );
  expect(recoveryText.trim().length).toBeGreaterThan(0);
  console.log(JSON.stringify({ stage: 'recovery-draft-completed', text: recoveryText }));

  // 4) Cancelación en curso desde el control visible:
  // Verificar que la redacción estaba en curso antes del clic, que el clic fue sobre el Cancelar
  // del cajón de commit y que quedó el estado o registro de cancelación de ese intento.
  await commitMsgField.fill('');
  const draftButtonForCancel = drawerRegion.getByRole('button', /Redactar con IA|Draft with AI/i);
  await draftButtonForCancel.click();

  // Esperar a que el botón Cancelar visible del cajón aparezca mientras está en curso
  const cancelBtn = await pollUntil(
    'commit-drawer-cancel-button-visible',
    15_000,
    async () => {
      const btn = drawerRegion.getByRole('button', /Cancelar|Cancel/i);
      const isVisible = await btn.isVisible().catch(() => false);
      const isThinking = await browser.evaluate(() => document.querySelector('.ai-thinking-text') !== null);
      return (isVisible && isThinking) ? btn : null;
    },
    async () => 'Esperando botón Cancelar visible durante redacción en curso',
    100,
  );

  // Clic sobre el botón Cancelar del cajón de commit
  await cancelBtn.click();

  // Verificar que el estado volvió de la cancelación (el botón cancelar desaparece y cesa ai-thinking-text)
  await pollUntil(
    'cancel-state-restored',
    15_000,
    async () => {
      const isThinking = await browser.evaluate(() => document.querySelector('.ai-thinking-text') !== null);
      const isCancelVis = await drawerRegion.getByRole('button', /Cancelar|Cancel/i).isVisible().catch(() => false);
      return (!isThinking && !isCancelVis) ? true : null;
    },
    async () => 'Esperando cese de thinking y ocultamiento de Cancelar',
    200,
  );

  // Verificar ai-use-history para confirmar que quedó el registro con estado 'cancelled'
  const rawCancelHistory = await browser.evaluate(async (repo: string) => {
    const res = await window.api!.aiUseHistory!.list({ repoPath: repo, use: 'gitcron-commit' });
    return JSON.stringify(res.data?.items ?? []);
  }, paths.repo);
  const cancelRecords = JSON.parse(rawCancelHistory as string);
  expect(cancelRecords.length).toBeGreaterThan(0);
  const latestRecord = cancelRecords[0];
  console.log(JSON.stringify({ stage: 'cancel-history-record', latestRecordStatus: latestRecord.resultStatus }));
  expect(latestRecord.resultStatus).toBe('cancelled');

  // 5) Comprobación de Un Slot (Requisito 8):
  // Tras cancelar, una generación mínima nueva desde Node hacia Consola debe responder en tiempo
  // comparable al del preflight (~10-15s), demostrando que la petición HTTP hacia Consola se cerró
  // de verdad y no quedó trabando el único slot de GPU disponible.
  const t0SlotProbe = Date.now();
  const cfHeaders = getProviderHeaders(sanitizedConsola.provider.unslothconsola);
  const slotProbeRes = await fetch(`${sanitizedConsola.provider.unslothconsola.options.baseURL.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { ...cfHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'unsloth/Qwen3.5-2B-GGUF',
      messages: [{ role: 'user', content: 'Di OK' }],
      max_tokens: 5,
      temperature: 0.1,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const slotProbeDurationMs = Date.now() - t0SlotProbe;
  console.log(JSON.stringify({
    stage: 'single-slot-post-cancel-probe',
    http: slotProbeRes.status,
    durationMs: slotProbeDurationMs,
    preflightCompletionMs: preflight.cloudflare.completionDurationMs,
  }));
  expect(slotProbeRes.status).toBe(200);
  // Debe haber respondido en menos de 25 segundos (comparable a preflight, no encolado tras minutos)
  expect(slotProbeDurationMs).toBeLessThan(25_000);

  await capture(app, 'tanda-29-06-fallo-recuperable-cancelacion');
});
