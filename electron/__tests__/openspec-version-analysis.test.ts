import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import {
  analyzeOpenSpecVersion,
  readInstalledContext,
  buildStrategyProposal,
  clearOpenSpecChangelogCache,
  evaluateConsumedSurfaces,
  fetchOpenSpecChangelog,
  type ConsumedSurfaceName,
} from '../pipeline/openspec-version-analysis';
import {
  OPENSPEC_CYCLE_TARGET_VERSION,
  SUPPORTED_OPENSPEC_VERSIONS,
} from '../../lib/openspec-version';
import { authorizedRepoStore } from '../ipc/authorized-repos';

vi.mock('../pipeline/openspec-engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../pipeline/openspec-engine')>();
  return {
    ...actual,
    runAuthorizedOpenSpec: vi.fn().mockResolvedValue({ stdout: 'openspec 1.11.0', stderr: '' }),
  };
});

describe('Verificación de versión de OpenSpec con criterio (Grupo 9c)', () => {
  const ORIGINAL_FETCH = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    clearOpenSpecChangelogCache();
    authorizedRepoStore.clear();
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    clearOpenSpecChangelogCache();
    vi.restoreAllMocks();
  });

  describe('9c.1: Consulta de cambios con fuentes citadas', () => {
    it('obtiene notas con fuente citada cuando GitHub Releases responde', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          body: '## Qué cambió en 1.12.0\n- Nuevas flags en el CLI\n- Mejoras en profile',
          html_url: 'https://github.com/fission-ai/openspec/releases/tag/v1.12.0',
        }),
      });

      const res = await fetchOpenSpecChangelog('1.12.0', { fetchFn: mockFetch as unknown as typeof fetch });

      expect(res.fetched).toBe(true);
      expect(res.source).toBe('GitHub Releases (fission-ai/openspec)');
      expect(res.sourceUrl).toBe('https://github.com/fission-ai/openspec/releases/tag/v1.12.0');
      expect(res.rawText).toContain('Qué cambió en 1.12.0');
      expect(res.error).toBeNull();
    });

    it('declara honestamente "unavailable" ante 404 sin inventar lista', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });

      const res = await fetchOpenSpecChangelog('1.12.0', { fetchFn: mockFetch as unknown as typeof fetch });

      expect(res.fetched).toBe(false);
      expect(res.source).toBe('unavailable');
      expect(res.rawText).toBeNull();
      expect(res.error).toContain('HTTP 404');
    });

    it('declara honestamente "unavailable" ante caída de red sin inventar lista', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      const res = await fetchOpenSpecChangelog('1.12.0', { fetchFn: mockFetch as unknown as typeof fetch });

      expect(res.fetched).toBe(false);
      expect(res.source).toBe('unavailable');
      expect(res.rawText).toBeNull();
      expect(res.error).toContain('ECONNREFUSED');
    });
  });

  describe('9c.2: Juicio determinístico sobre las 6 superficies que GitCron consume', () => {
    const EXPECTED_SURFACES: ConsumedSurfaceName[] = [
      'status',
      'instructions',
      'validate',
      'archive',
      'sync',
      'profiles',
    ];

    it('evalúa exactamente las 6 superficies consumidas', () => {
      const { surfaces } = evaluateConsumedSurfaces('1.11.0', '1.11.0', null);
      const names = surfaces.map((s) => s.surface);
      expect(names).toEqual(EXPECTED_SURFACES);
      surfaces.forEach((s) => {
        expect(s.verdict).toBe('compatible');
        expect(s.evidence).toBeTruthy();
      });
    });

    it('declara compatible ante versión minor posterior (1.13.0) sin salto mayor', () => {
      const { surfaces, breakingChangesDetected } = evaluateConsumedSurfaces('1.12.0', '1.13.0', null);
      expect(breakingChangesDetected).toBe(false);

      const statusSurface = surfaces.find((s) => s.surface === 'status');
      expect(statusSurface?.verdict).toBe('compatible');
      expect(statusSurface?.evidence).toContain('Compatible con el mínimo soportado');

      const instructionsSurface = surfaces.find((s) => s.surface === 'instructions');
      expect(instructionsSurface?.verdict).toBe('compatible');
      expect(instructionsSurface?.evidence).toContain('Estructura de instrucción y contexto verificada');

      const validateSurface = surfaces.find((s) => s.surface === 'validate');
      expect(validateSurface?.verdict).toBe('compatible');
      expect(validateSurface?.evidence).toContain('Validación estricta compatible');
    });

    it('identifica rotura ante salto de versión mayor (2.0.0)', () => {
      const { surfaces, breakingChangesDetected } = evaluateConsumedSurfaces('1.11.0', '2.0.0', null);
      expect(breakingChangesDetected).toBe(true);
      surfaces.forEach((s) => {
        expect(s.verdict).toBe('breaking');
        expect(s.evidence).toContain('Salto mayor');
      });
    });
  });

  describe('9c.3: Propuesta de estrategia para decisión de Alejandro', () => {
    it('no genera propuesta de estrategia si la versión es totalmente compatible', () => {
      const proposal = buildStrategyProposal('1.10.0', '1.11.0', false);
      expect(proposal).toBeNull();
    });

    it('genera propuesta estructurada ante versión 1.12.0 (outside range)', () => {
      const proposal = buildStrategyProposal('1.11.0', '1.12.0', true);
      expect(proposal).not.toBeNull();
      expect(proposal?.summary).toContain('1.12.0');
      expect(proposal?.whatToModify.length).toBeGreaterThan(0);
      expect(proposal?.orderOfOperations.length).toBeGreaterThan(0);
      expect(proposal?.whatWorksUntouched.length).toBeGreaterThan(0);
      expect(proposal?.recommendation).toContain('decisión de Alejandro');
    });
  });

  describe('9c.4 & 9c.5: Redacción en criollo y separación estricta de redacción vs hechos medidos', () => {
    it('sin model devuelve status idle y NO llama a completeTextFn', async () => {
      const mockComplete = vi.fn();

      const res = await analyzeOpenSpecVersion(process.cwd(), {
        getInstalledVersion: async () => '1.12.0',
        checkLatest: async () => ({
          status: 'online',
          latestVersion: '1.13.0',
          checkedAt: new Date().toISOString(),
          fromCache: false,
          cacheAgeSeconds: 0,
          freshness: 'fresh',
          error: null,
        }),
        fetchChangelog: async () => ({
          source: 'GitHub Releases (fission-ai/openspec)',
          sourceUrl: 'https://github.com/fission-ai/openspec/releases/tag/v1.13.0',
          fetched: true,
          rawText: '- Modificaciones en CLI',
          error: null,
        }),
        completeTextFn: mockComplete as never,
      });

      expect(mockComplete).not.toHaveBeenCalled();
      expect(res.measured).toBeDefined();
      expect(res.redaction.status).toBe('idle');
      expect(res.redaction.text).toBe('');
      expect(res.redaction.provider).toBe('');
    });

    it('redacta con el modelo elegido cuando se provee model', async () => {
      const mockComplete = vi.fn().mockResolvedValue({
        text: 'Ale, mirá: salió la versión 1.12.0. Todavía no la subas porque GitCron consume el JSON de status e instructions...',
        finishReason: 'stop',
      });

      const res = await analyzeOpenSpecVersion(process.cwd(), {
        model: 'qwen2.5-coder-7b',
        getInstalledVersion: async () => '1.12.0',
        checkLatest: async () => ({
          status: 'online',
          latestVersion: '1.13.0',
          checkedAt: new Date().toISOString(),
          fromCache: false,
          cacheAgeSeconds: 0,
          freshness: 'fresh',
          error: null,
        }),
        fetchChangelog: async () => ({
          source: 'GitHub Releases (fission-ai/openspec)',
          sourceUrl: 'https://github.com/fission-ai/openspec/releases/tag/v1.13.0',
          fetched: true,
          rawText: '- Modificaciones en CLI',
          error: null,
        }),
        completeTextFn: mockComplete as never,
      });

      // 9c.5: Separación estricta
      expect(res.measured).toBeDefined();
      expect(res.redaction).toBeDefined();

      // Hechos medidos determinados por código
      expect(res.measured.installedVersion).toBe('1.12.0');
      expect(res.measured.availableVersion).toBe('1.13.0');
      expect(res.measured.versionClass).toBe('supported');
      expect(res.measured.breakingChangesDetected).toBe(false);
      expect(res.measured.consumedSurfaces.length).toBe(6);

      // Redacción del modelo
      expect(res.redaction.status).toBe('generated');
      expect(res.redaction.provider).toBe('LM Studio · qwen2.5-coder-7b');
      expect(res.redaction.text).toContain('Ale, mirá');
    });

    it('construye el prompt del modelo con superficies consumidas, notas ampliadas y estructura de informe de 4 partes llevando el modelo elegido', async () => {
      const longNotes = 'A'.repeat(2500);
      const mockComplete = vi.fn().mockResolvedValue({
        text: '## Qué hay de nuevo\nNotas.\n## Qué hace de hecho\nHechos.\n## Cómo afecta a GitCron\nSin impacto.\n## Cómo encararlo\nSin cambios.',
        finishReason: 'stop',
      });

      const res = await analyzeOpenSpecVersion(process.cwd(), {
        model: 'deepseek-r1',
        getInstalledVersion: async () => '1.12.0',
        checkLatest: async () => ({
          status: 'online',
          latestVersion: '1.13.0',
          checkedAt: new Date().toISOString(),
          fromCache: false,
          cacheAgeSeconds: 0,
          freshness: 'fresh',
          error: null,
        }),
        fetchChangelog: async () => ({
          source: 'GitHub Releases (fission-ai/openspec)',
          sourceUrl: 'https://github.com/fission-ai/openspec/releases/tag/v1.13.0',
          fetched: true,
          rawText: longNotes,
          error: null,
        }),
        completeTextFn: mockComplete as never,
      });

      expect(mockComplete).toHaveBeenCalledTimes(1);
      const [, payload] = mockComplete.mock.calls[0];
      expect(payload.model).toBe('deepseek-r1');
      expect(payload.system).toContain('## Qué hay de nuevo');
      expect(payload.system).toContain('## Qué hace de hecho');
      expect(payload.system).toContain('## Cómo afecta a GitCron');
      expect(payload.system).toContain('## Cómo encararlo');
      expect(payload.system).toContain('Escribí para alguien que usa la herramienta pero no programa en este ecosistema');
      expect(payload.system).toContain('cada término técnico');
      expect(payload.system).toContain('partir de lo que Alejandro tiene instalado');
      expect(payload.user).toContain('Superficie que GitCron consume: status');
      expect(payload.user).toContain('A'.repeat(2000));
      expect(payload.maxTokens).toBe(900);
      expect(res.redaction.provider).toBe('LM Studio · deepseek-r1');
      expect(res.redaction.status).toBe('generated');
    });

    it('incorpora lo que Alejandro tiene instalado en el prompt bajo «Lo que Alejandro tiene instalado:» cuando se provee installedContext', async () => {
      const mockComplete = vi.fn().mockResolvedValue({
        text: '## Qué hay de nuevo\nNotas.\n## Qué hace de hecho\nHechos.\n## Cómo afecta a GitCron\nSin impacto.\n## Cómo encararlo\nSin cambios.',
        finishReason: 'stop',
      });

      await analyzeOpenSpecVersion(process.cwd(), {
        model: 'deepseek-r1',
        getInstalledVersion: async () => '1.12.0',
        checkLatest: async () => ({
          status: 'online',
          latestVersion: '1.13.0',
          checkedAt: new Date().toISOString(),
          fromCache: false,
          cacheAgeSeconds: 0,
          freshness: 'fresh',
          error: null,
        }),
        fetchChangelog: async () => ({
          source: 'GitHub Releases',
          sourceUrl: null,
          fetched: true,
          rawText: 'Notas',
          error: null,
        }),
        installedContext: {
          engineVersion: '1.12.0',
          integrationState: 'up-to-date',
          globalProfile: 'core',
          globalWorkflows: ['commit', 'pr'],
          agents: [
            { name: 'claude', workflows: ['commit', 'pr'] },
            { name: 'cursor', workflows: [] },
          ],
        },
        completeTextFn: mockComplete as never,
      });

      expect(mockComplete).toHaveBeenCalledTimes(1);
      const [, payload] = mockComplete.mock.calls[0];
      expect(payload.user).toContain('Lo que Alejandro tiene instalado:');
      expect(payload.user).toContain('- Motor: 1.12.0 (estado: up-to-date)');
      expect(payload.user).toContain('- Configuración global: perfil core, workflows: commit, pr');
      expect(payload.user).toContain('- Agentes: claude (commit, pr); cursor (sin workflows)');
    });

    it('degrada a status offline sin voltear los hechos medidos ante rechazo de conexión', async () => {
      const mockComplete = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      const res = await analyzeOpenSpecVersion(process.cwd(), {
        model: 'qwen2.5-coder-7b',
        getInstalledVersion: async () => '1.12.0',
        checkLatest: async () => ({
          status: 'online',
          latestVersion: '1.13.0',
          checkedAt: new Date().toISOString(),
          fromCache: false,
          cacheAgeSeconds: 0,
          freshness: 'fresh',
          error: null,
        }),
        fetchChangelog: async () => ({
          source: 'unavailable',
          sourceUrl: null,
          fetched: false,
          rawText: null,
          error: 'Offline',
        }),
        completeTextFn: mockComplete as never,
      });

      // Hechos medidos intactos y completos
      expect(res.measured.installedVersion).toBe('1.12.0');
      expect(res.measured.availableVersion).toBe('1.13.0');
      expect(res.measured.breakingChangesDetected).toBe(false);
      expect(res.measured.consumedSurfaces.length).toBe(6);

      // Redacción informa offline
      expect(res.redaction.status).toBe('offline');
      expect(res.redaction.provider).toBe('LM Studio · qwen2.5-coder-7b');
      expect(res.redaction.error).toBeNull();
    });

    it('respuesta 400 del servidor devuelve status error con el mensaje real del servidor', async () => {
      const serverMsg = '400 {"error":{"message":"No models loaded in LM Studio"}}';
      const mockComplete = vi.fn().mockRejectedValue(new Error(serverMsg));

      const res = await analyzeOpenSpecVersion(process.cwd(), {
        model: 'qwen2.5-coder-7b',
        getInstalledVersion: async () => '1.12.0',
        checkLatest: async () => ({
          status: 'online',
          latestVersion: '1.13.0',
          checkedAt: new Date().toISOString(),
          fromCache: false,
          cacheAgeSeconds: 0,
          freshness: 'fresh',
          error: null,
        }),
        fetchChangelog: async () => ({
          source: 'GitHub Releases (fission-ai/openspec)',
          sourceUrl: null,
          fetched: true,
          rawText: 'Notes',
          error: null,
        }),
        completeTextFn: mockComplete as never,
      });

      expect(res.redaction.status).toBe('error');
      expect(res.redaction.provider).toBe('LM Studio · qwen2.5-coder-7b');
      expect(res.redaction.error).toContain('No models loaded in LM Studio');
    });

    it('usa streamText con configuración sin timeoutMs acotado (defaults a 300s) y propaga signal y onChunk', async () => {
      const mockStream = vi.fn().mockImplementation(async (_config, opts) => {
        opts.onChunk?.([{ kind: 'content', text: 'Informe parcial' }]);
        return { text: 'Informe completo', finishReason: 'stop' };
      });
      const chunksReceived: any[] = [];
      const abortController = new AbortController();

      const res = await analyzeOpenSpecVersion(process.cwd(), {
        model: 'qwen2.5-coder-7b',
        signal: abortController.signal,
        onChunk: (chunks) => chunksReceived.push(...chunks),
        getInstalledVersion: async () => '1.12.0',
        checkLatest: async () => ({
          status: 'online',
          latestVersion: '1.13.0',
          checkedAt: new Date().toISOString(),
          fromCache: false,
          cacheAgeSeconds: 0,
          freshness: 'fresh',
          error: null,
        }),
        fetchChangelog: async () => ({
          source: 'GitHub Releases',
          sourceUrl: null,
          fetched: true,
          rawText: 'Notes',
          error: null,
        }),
        streamTextFn: mockStream as never,
      });

      expect(mockStream).toHaveBeenCalledTimes(1);
      const [config, payload] = mockStream.mock.calls[0];
      // Misma configuración que el commit: sin timeoutMs explícito (default 300_000 en text-client)
      expect(config.timeoutMs).toBeUndefined();
      expect(config.providerLabel).toBe('LM Studio (redacción)');
      expect(payload.signal).toBe(abortController.signal);
      expect(typeof payload.onChunk).toBe('function');
      expect(chunksReceived).toEqual([{ kind: 'content', text: 'Informe parcial' }]);
      expect(res.redaction.status).toBe('generated');
      expect(res.redaction.text).toBe('Informe completo');
    });

    it('devuelve status error con mensaje de cancelación cuando la redacción es abortada por el usuario (no offline)', async () => {
      const abortController = new AbortController();
      abortController.abort();

      const mockStream = vi.fn().mockRejectedValue(
        new Error('LM Studio (redacción): operación cancelada por el usuario.'),
      );

      const res = await analyzeOpenSpecVersion(process.cwd(), {
        model: 'qwen2.5-coder-7b',
        signal: abortController.signal,
        getInstalledVersion: async () => '1.12.0',
        checkLatest: async () => ({
          status: 'online',
          latestVersion: '1.13.0',
          checkedAt: new Date().toISOString(),
          fromCache: false,
          cacheAgeSeconds: 0,
          freshness: 'fresh',
          error: null,
        }),
        fetchChangelog: async () => ({
          source: 'GitHub Releases',
          sourceUrl: null,
          fetched: true,
          rawText: 'Notes',
          error: null,
        }),
        streamTextFn: mockStream as never,
      });

      // Debe ser error, no offline
      expect(res.redaction.status).toBe('error');
      expect(res.redaction.provider).toBe('LM Studio · qwen2.5-coder-7b');
      expect(res.redaction.error).toContain('operación cancelada por el usuario');
    });
  });

  describe('9c.6: Rangos y versión objetivo no se modifican automáticamente', () => {
    // Subir la versión a 1.14.0 es la decisión deliberada de Ale para el ciclo OpenSpec 1.14 (opción B).
    it('SUPPORTED_OPENSPEC_VERSIONS y OPENSPEC_CYCLE_TARGET_VERSION permanecen inmutables salvo decisión deliberada de Ale', () => {
      expect(OPENSPEC_CYCLE_TARGET_VERSION).toBe('1.14.0');
      expect(SUPPORTED_OPENSPEC_VERSIONS.min).toBe('1.5.0');
      expect(SUPPORTED_OPENSPEC_VERSIONS.max).toBeUndefined();
    });
  });

  describe('9c.7: Caché de changelog y manejo de rate limit de GitHub', () => {
    it('dos llamadas sucesivas para la misma versión hacen un solo fetch y devuelven fromCache en la segunda', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          body: '## Release 1.12.0\nNovedades',
          html_url: 'https://github.com/fission-ai/openspec/releases/tag/v1.12.0',
        }),
      });

      const res1 = await fetchOpenSpecChangelog('1.12.0', { fetchFn: mockFetch as unknown as typeof fetch });
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(res1.fetched).toBe(true);
      expect(res1.fromCache).toBe(false);

      const res2 = await fetchOpenSpecChangelog('1.12.0', { fetchFn: mockFetch as unknown as typeof fetch });
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(res2.fetched).toBe(true);
      expect(res2.fromCache).toBe(true);
      expect(res2.rawText).toBe('## Release 1.12.0\nNovedades');
    });

    it('con forceRefresh: true puentea la caché y realiza un segundo fetch', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          body: '## Release 1.12.0\nNovedades actualizadas',
          html_url: 'https://github.com/fission-ai/openspec/releases/tag/v1.12.0',
        }),
      });

      await fetchOpenSpecChangelog('1.12.0', { fetchFn: mockFetch as unknown as typeof fetch });
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const resForced = await fetchOpenSpecChangelog('1.12.0', {
        fetchFn: mockFetch as unknown as typeof fetch,
        forceRefresh: true,
      });
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(resForced.fromCache).toBe(false);
      expect(resForced.rawText).toContain('actualizadas');
    });

    it('maneja rate limit (HTTP 403) con fuente "rate_limited" y mensaje con horario de reset', async () => {
      const resetEpoch = Math.floor(Date.now() / 1000) + 1200; // 20 minutos en el futuro
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        headers: new Headers({
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': String(resetEpoch),
        }),
      });

      const res = await fetchOpenSpecChangelog('1.12.0', { fetchFn: mockFetch as unknown as typeof fetch });
      expect(res.fetched).toBe(false);
      expect(res.source).toBe('rate_limited');
      expect(res.rawText).toBeNull();
      expect(res.error).toContain('HTTP 403 rate limit');
      expect(res.error).toMatch(/Reintentá después de las \d{2}:\d{2}:\d{2}/);
    });
  });

  describe('Integración IPC: canal pipeline:openspec:version-analysis tal como se registra en main', () => {
    it('registra el canal en ipcMain y rechaza repositorios no autorizados', async () => {
      const handlers = new Map<string, (_event: unknown, payload?: unknown) => Promise<unknown>>();
      const mockIpc = {
        handle: vi.fn((channel: string, handler: any) => {
          handlers.set(channel, handler);
        }),
      };

      const { registerOpenSpecIpcHandlers } = await import('../ipc/pipeline-openspec');
      registerOpenSpecIpcHandlers({
        ipcMain: mockIpc as never,
        getUserDataDir: () => os.tmpdir(),
      });

      expect(handlers.has('pipeline:openspec:version-analysis')).toBe(true);
      const handler = handlers.get('pipeline:openspec:version-analysis')!;

      // Rechaza sin repositorio autorizado
      await expect(handler({}, { repoPath: 'C:/unauthorized-repo' })).rejects.toThrow(
        /IPC Security Error: Invalid or unauthorized repository path/,
      );

      // Rechaza payloads con propiedades maliciosas/desconocidas
      authorizedRepoStore.authorizeRepo(process.cwd());
      await expect(
        handler({}, { repoPath: process.cwd(), maliciousKey: 'hack' }),
      ).rejects.toThrow(/IPC Security Error: Unknown payload property/);
    });

    // Suelta tarda ~2.8s pero bajo carga de suite excede los 5s por invocar el binario real de openspec
    it(
      'ejecuta el análisis a través del canal IPC autorizado sin inyectar dependencias falsas',
      { timeout: 15_000 },
      async () => {
        const handlers = new Map<string, (_event: unknown, payload?: unknown) => Promise<unknown>>();
        const mockIpc = {
          handle: vi.fn((channel: string, handler: any) => {
            handlers.set(channel, handler);
          }),
        };

        const realRepo = fs.realpathSync(process.cwd());
        authorizedRepoStore.authorizeRepo(realRepo);

        // Directorio de userData aislado con caché de registry precalentada
        const tmpUserDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-ver-analysis-ipc-'));
        fs.writeFileSync(
          path.join(tmpUserDir, 'openspec-registry-cache.json'),
          JSON.stringify({
            latestVersion: '1.11.0',
            checkedAt: new Date().toISOString(),
          }),
          'utf8',
        );

        // Mock de fetch para aislar peticiones de changelog y modelo local
        const mockFetch = vi.fn().mockImplementation((url: string) => {
          if (url.includes('chat/completions')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({
                choices: [{ message: { content: 'Ale, mirá: no hay cambios incompatibles' }, finish_reason: 'stop' }],
              }),
            });
          }
          if (url.includes('api.github.com')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({
                body: '## Release 1.11.0\nVersión oficial',
                html_url: 'https://github.com/fission-ai/openspec/releases/tag/v1.11.0',
              }),
            });
          }
          return Promise.reject(new Error(`Fetch inesperado: ${url}`));
        });
        globalThis.fetch = mockFetch as unknown as typeof fetch;

        try {
          const { registerOpenSpecIpcHandlers } = await import('../ipc/pipeline-openspec');
          registerOpenSpecIpcHandlers({
            ipcMain: mockIpc as never,
            getUserDataDir: () => tmpUserDir,
          });

          const handler = handlers.get('pipeline:openspec:version-analysis')!;
          const result = (await handler({}, { repoPath: realRepo })) as any;

          expect(result).toBeDefined();
          expect(result.measured).toBeDefined();
          expect(result.measured.supportedRange.max).toBeUndefined();
          expect(result.measured.consumedSurfaces.length).toBe(6);
          expect(result.redaction).toBeDefined();
          expect(result.redaction.status).toBe('idle');

          const resultWithModel = (await handler({}, { repoPath: realRepo, model: 'local-model' })) as any;
          expect(resultWithModel.redaction.status).toBe('generated');
          expect(resultWithModel.redaction.provider).toBe('LM Studio · local-model');
        } finally {
          try {
            fs.rmSync(tmpUserDir, { recursive: true, force: true });
          } catch {
            /* ignore */
          }
        }
      },
    );
  });

  describe('readInstalledContext (contexto instalado barato e inyectable)', () => {
    function exactDiskDouble(spec: { dirs?: Record<string, string[]>; files?: string[] }) {
      const dirs = spec.dirs ?? {};
      const files = new Set(spec.files ?? []);
      const dirPaths = new Set(Object.keys(dirs));
      return {
        readdir: (p: string): string[] => (dirs[p] ? [...dirs[p]] : []),
        lstat: (p: string): any => {
          if (dirPaths.has(p) || files.has(p)) {
            return {
              isDirectory: () => dirPaths.has(p),
              isFile: () => files.has(p),
              isSymbolicLink: () => false,
            };
          }
          return null;
        },
      };
    }

    it('extrae agentes y workflows correctos a partir de la evidencia real en < 100 ms', async () => {
      const repo = 'C:\\repo';
      const skills = [
        'openspec-apply-change',
        'openspec-explore',
        'openspec-propose',
        'openspec-sync-specs',
        'openspec-archive-change',
        'openspec-update-change',
      ];
      const dirs: Record<string, string[]> = {
        [repo]: ['.agents'],
        [`${repo}\\.agents`]: ['skills'],
        [`${repo}\\.agents\\skills`]: skills,
      };
      const files: string[] = [];
      for (const skill of skills) {
        dirs[`${repo}\\.agents\\skills\\${skill}`] = ['SKILL.md'];
        files.push(`${repo}\\.agents\\skills\\${skill}\\SKILL.md`);
      }
      const disk = exactDiskDouble({ dirs, files });

      const start = Date.now();
      const ctx = await readInstalledContext(repo, {
        inspectDeps: {
          ...disk,
          realpath: (p) => p,
          readFile: () => 'generatedBy: "1.8.0"',
        },
        engineVersion: '1.8.0',
        readGlobalConfig: vi.fn().mockResolvedValue({
          rawProfile: 'core',
          configuredWorkflows: ['commit', 'pr'],
        }),
      });
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(100);
      expect(ctx.engineVersion).toBe('1.8.0');
      expect(ctx.integrationState).toBe('up-to-date');
      expect(ctx.globalProfile).toBe('core');
      expect(ctx.globalWorkflows).toEqual(['commit', 'pr']);
      expect(ctx.agents).toHaveLength(1);
      expect(ctx.agents![0].name).toBe('agents');
      expect(ctx.agents![0].workflows).toEqual(
        expect.arrayContaining(['apply', 'explore', 'propose', 'sync', 'archive', 'update']),
      );
      expect(ctx.agents![0].workflows).toHaveLength(6);
    });
  });
});
