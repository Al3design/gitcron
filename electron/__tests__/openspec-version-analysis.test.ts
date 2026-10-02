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
import type { ResolvedModelFor } from '../ai/config/resolve-model-for';
import { setUseConfigPathForTesting } from '../ai/use-resolution';

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
    // Desde la tarea 4.3 el modelo sale del uso `gitcron-openspec-analysis` de
    // gitcron.json y el pedido va por el camino común. Acá el uso viene resuelto a
    // un LM Studio y el servidor es simulado.
    const lmTarget = (model: string): ResolvedModelFor => ({
      status: 'resolved',
      use: 'gitcron-openspec-analysis',
      alternatives: [],
      resolved: {
        providerId: 'lmstudio',
        providerName: 'LM Studio',
        modelId: model,
        kind: 'openai-compatible',
        destination: 'this-machine',
        sourceFile: 'gitcron.json',
        baseURL: 'http://localhost:1234/v1',
        maxTokens: 3000,
        maxTokensFromModel: false,
        available: true,
        provenance: { sourceFile: 'gitcron.json', model: 'agent.gitcron-openspec-analysis.model', options: {}, headers: {} },
      },
    });

    /** Un servidor del estándar: contesta `reply`, falla con un estado o no responde. */
    function server(reply: string | number | Error, opts: { stream?: boolean } = {}) {
      const calls: Array<{ url: string; body: any }> = [];
      const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
        if (init?.signal?.aborted) {
          const err = new Error('The user aborted a request.');
          err.name = 'AbortError';
          throw err;
        }
        if (reply instanceof Error) throw reply;
        if (typeof reply === 'number') return new Response('{}', { status: reply });
        if (opts.stream) {
          const frames = [
            `data: ${JSON.stringify({ choices: [{ delta: { content: 'Informe parcial' } }] })}\n\n`,
            `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`,
            'data: [DONE]\n\n',
          ];
          return new Response(frames.join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } });
        }
        return new Response(JSON.stringify({ choices: [{ message: { content: reply }, finish_reason: 'stop' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });
      return { fetchFn: fetchFn as unknown as typeof fetch, calls };
    }

    const measuredDeps = (rawText: string | null = '- Modificaciones en CLI') => ({
      getInstalledVersion: async () => '1.12.0',
      checkLatest: async () => ({
        status: 'online' as const,
        latestVersion: '1.13.0',
        checkedAt: new Date().toISOString(),
        fromCache: false,
        cacheAgeSeconds: 0,
        freshness: 'fresh' as const,
        error: null,
      }),
      fetchChangelog: async () => ({
        source: rawText === null ? 'unavailable' : 'GitHub Releases (fission-ai/openspec)',
        sourceUrl: rawText === null ? null : 'https://github.com/fission-ai/openspec/releases/tag/v1.13.0',
        fetched: rawText !== null,
        rawText,
        error: rawText === null ? 'Offline' : null,
      }),
    });

    it('sin pedido de redacción devuelve status idle y no llama a ningún servidor', async () => {
      const srv = server('no debería');
      const res = await analyzeOpenSpecVersion(process.cwd(), {
        ...measuredDeps(),
        target: lmTarget('qwen2.5-coder-7b'),
        textDeps: { fetchFn: srv.fetchFn },
      });

      expect(srv.calls).toEqual([]);
      expect(res.measured).toBeDefined();
      expect(res.redaction.status).toBe('idle');
      expect(res.redaction.text).toBe('');
      expect(res.redaction.provider).toBe('');
    });

    it('redacta con el modelo del uso cuando se pide', async () => {
      const srv = server('Ale, mirá: salió la versión 1.12.0. Todavía no la subas porque GitCron consume el JSON de status e instructions...');
      const res = await analyzeOpenSpecVersion(process.cwd(), {
        ...measuredDeps(),
        model: 'qwen2.5-coder-7b',
        target: lmTarget('qwen2.5-coder-7b'),
        textDeps: { fetchFn: srv.fetchFn },
      });

      // 9c.5: Separación estricta
      expect(res.measured.installedVersion).toBe('1.12.0');
      expect(res.measured.availableVersion).toBe('1.13.0');
      expect(res.measured.versionClass).toBe('supported');
      expect(res.measured.breakingChangesDetected).toBe(false);
      expect(res.measured.consumedSurfaces.length).toBe(6);

      expect(srv.calls[0].url).toBe('http://localhost:1234/v1/chat/completions');
      expect(res.redaction.status).toBe('generated');
      expect(res.redaction.provider).toBe('LM Studio · qwen2.5-coder-7b');
      expect(res.redaction.text).toContain('Ale, mirá');
    });

    it('sin modelo en gitcron.json no llama a nadie y lo dice', async () => {
      const srv = server('no debería');
      const res = await analyzeOpenSpecVersion(process.cwd(), {
        ...measuredDeps(),
        model: 'qwen2.5-coder-7b',
        target: { status: 'unset', use: 'gitcron-openspec-analysis' },
        textDeps: { fetchFn: srv.fetchFn },
      });

      expect(srv.calls).toEqual([]);
      expect(res.redaction.status).toBe('no-model');
      expect(res.redaction.error).toContain('no tiene modelo en gitcron.json');
    });

    it('construye el prompt del modelo con superficies consumidas, notas ampliadas y estructura de informe de 4 partes', async () => {
      const srv = server('## Qué hay de nuevo\nNotas.\n## Qué hace de hecho\nHechos.\n## Cómo afecta a GitCron\nSin impacto.\n## Cómo encararlo\nSin cambios.');
      const res = await analyzeOpenSpecVersion(process.cwd(), {
        ...measuredDeps('A'.repeat(2500)),
        model: 'deepseek-r1',
        target: lmTarget('deepseek-r1'),
        textDeps: { fetchFn: srv.fetchFn },
      });

      expect(srv.calls).toHaveLength(1);
      const body = srv.calls[0].body;
      const system = body.messages[0].content as string;
      const user = body.messages[1].content as string;
      expect(body.model).toBe('deepseek-r1');
      expect(system).toContain('## Qué hay de nuevo');
      expect(system).toContain('## Qué hace de hecho');
      expect(system).toContain('## Cómo afecta a GitCron');
      expect(system).toContain('## Cómo encararlo');
      expect(system).toContain('Escribí para alguien que usa la herramienta pero no programa en este ecosistema');
      expect(system).toContain('cada término técnico');
      expect(system).toContain('partir de lo que Alejandro tiene instalado');
      expect(user).toContain('Superficie que GitCron consume: status');
      expect(user).toContain('A'.repeat(2000));
      // El modelo no declara limit.output: vale el techo del uso.
      expect(body.max_tokens).toBe(900);
      expect(res.redaction.provider).toBe('LM Studio · deepseek-r1');
      expect(res.redaction.status).toBe('generated');
    });

    it('incorpora lo que Alejandro tiene instalado en el prompt bajo «Lo que Alejandro tiene instalado:» cuando se provee installedContext', async () => {
      const srv = server('## Qué hay de nuevo\nNotas.');
      await analyzeOpenSpecVersion(process.cwd(), {
        ...measuredDeps('Notas'),
        model: 'deepseek-r1',
        target: lmTarget('deepseek-r1'),
        textDeps: { fetchFn: srv.fetchFn },
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
      });

      expect(srv.calls).toHaveLength(1);
      const user = srv.calls[0].body.messages[1].content as string;
      expect(user).toContain('Lo que Alejandro tiene instalado:');
      expect(user).toContain('- Motor: 1.12.0 (estado: up-to-date)');
      expect(user).toContain('- Configuración global: perfil core, workflows: commit, pr');
      expect(user).toContain('- Agentes: claude (commit, pr); cursor (sin workflows)');
    });

    it('degrada a status offline sin voltear los hechos medidos ante rechazo de conexión', async () => {
      const srv = server(new Error('fetch failed ECONNREFUSED'));
      const res = await analyzeOpenSpecVersion(process.cwd(), {
        ...measuredDeps(null),
        model: 'qwen2.5-coder-7b',
        target: lmTarget('qwen2.5-coder-7b'),
        textDeps: { fetchFn: srv.fetchFn },
      });

      expect(res.measured.installedVersion).toBe('1.12.0');
      expect(res.measured.availableVersion).toBe('1.13.0');
      expect(res.measured.breakingChangesDetected).toBe(false);
      expect(res.measured.consumedSurfaces.length).toBe(6);

      expect(res.redaction.status).toBe('offline');
      expect(res.redaction.provider).toBe('LM Studio · qwen2.5-coder-7b');
      expect(res.redaction.error).toBeNull();
    });

    it('un estado de error del servidor devuelve status error con el estado, sin el cuerpo crudo', async () => {
      const srv = server(400);
      const res = await analyzeOpenSpecVersion(process.cwd(), {
        ...measuredDeps('Notes'),
        model: 'qwen2.5-coder-7b',
        target: lmTarget('qwen2.5-coder-7b'),
        textDeps: { fetchFn: srv.fetchFn },
      });

      expect(res.redaction.status).toBe('error');
      expect(res.redaction.provider).toBe('LM Studio · qwen2.5-coder-7b');
      expect(res.redaction.error).toContain('LM Studio respondió 400');
    });

    it('con onChunk transmite: propaga la señal y lo que va llegando', async () => {
      const srv = server('', { stream: true });
      const chunksReceived: any[] = [];
      const abortController = new AbortController();

      const res = await analyzeOpenSpecVersion(process.cwd(), {
        ...measuredDeps('Notes'),
        model: 'qwen2.5-coder-7b',
        target: lmTarget('qwen2.5-coder-7b'),
        textDeps: { fetchFn: srv.fetchFn },
        signal: abortController.signal,
        onChunk: (chunks) => chunksReceived.push(...chunks),
      });

      expect(srv.calls[0].body.stream).toBe(true);
      expect(chunksReceived).toContainEqual({ kind: 'content', text: 'Informe parcial' });
      expect(res.redaction.status).toBe('generated');
      expect(res.redaction.text).toBe('Informe parcial');
    });

    it('devuelve status error con mensaje de cancelación cuando la redacción es abortada por el usuario (no offline)', async () => {
      const srv = server('no debería');
      const abortController = new AbortController();
      abortController.abort();

      const res = await analyzeOpenSpecVersion(process.cwd(), {
        ...measuredDeps('Notes'),
        model: 'qwen2.5-coder-7b',
        target: lmTarget('qwen2.5-coder-7b'),
        textDeps: { fetchFn: srv.fetchFn },
        signal: abortController.signal,
        onChunk: () => undefined,
      });

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

        // El gitcron.json de la prueba, no el de la persona: declara el proveedor
        // «lmstudio» por el que va el modelo elegido en el selector (4.3).
        const configPath = path.join(tmpUserDir, 'gitcron.json');
        fs.writeFileSync(configPath, JSON.stringify({
          provider: { lmstudio: { name: 'LM Studio', options: { baseURL: 'http://localhost:1234/v1' } } },
        }));
        setUseConfigPathForTesting(configPath);

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
          setUseConfigPathForTesting(null);
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
