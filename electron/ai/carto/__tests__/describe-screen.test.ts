import { describe, it, expect, vi } from 'vitest';
import { describeScreen, type DescribeScreenDeps } from '../describe-screen';
import type { ScreenMap } from '../../../../types/screen-map';

describe('describeScreen', () => {
  const mockMap: ScreenMap = {
    repoPath: '/mock/repo',
    headSha: 'abc1234',
    detectors: ['test-detector'],
    coverage: { state: 'complete' },
    readAt: '2026-10-16T12:00:00Z',
    screens: [
      {
        id: 'screen-main',
        kind: 'route',
        name: 'Inicio',
        locator: '/',
        declaredIn: 'app/page.tsx',
        description: null,
        files: [
          { path: 'app/page.tsx', role: 'screen', provenance: 'static', shared: false },
          { path: 'components/Header.tsx', role: 'component', provenance: 'static', shared: false },
          { path: 'components/Footer.tsx', role: 'component', provenance: 'static', shared: false },
          { path: 'components/Extra.tsx', role: 'component', provenance: 'static', shared: false },
        ],
      },
    ],
  };

  function createMockDeps(overrides: Partial<DescribeScreenDeps> = {}): DescribeScreenDeps {
    return {
      buildMap: vi.fn().mockResolvedValue(mockMap),
      readFile: vi.fn().mockImplementation(async (relPath: string) => `// Contenido de ${relPath}`),
      resolveModel: vi.fn().mockReturnValue({
        status: 'resolved',
        resolved: { providerId: 'test-p', providerName: 'Test Provider', modelId: 'test-model' },
      } as any),
      runText: vi.fn().mockResolvedValue({
        text: JSON.stringify({
          text: 'Esta pantalla muestra la página de inicio.',
          citedFiles: ['app/page.tsx'],
        }),
        modelId: 'test-model',
        providerId: 'test-p',
      } as any),
      cache: {
        get: vi.fn().mockReturnValue(null),
        put: vi.fn(),
      },
      now: vi.fn().mockReturnValue('2026-10-16T12:00:00Z'),
      ...overrides,
    };
  }

  it('contexto con hasta 3 archivos y el tope de 12.000', async () => {
    let capturedUserPrompt = '';
    const readFiles: string[] = [];

    const deps = createMockDeps({
      readFile: vi.fn().mockImplementation(async (relPath: string) => {
        readFiles.push(relPath);
        return 'x'.repeat(5_000); // 5000 chars por archivo
      }),
      runText: vi.fn().mockImplementation(async (_cfg, prompt) => {
        capturedUserPrompt = prompt.user;
        return {
          text: JSON.stringify({
            text: 'Explicación válida.',
            citedFiles: ['app/page.tsx'],
          }),
          modelId: 'test-model',
          providerId: 'test-p',
        };
      }),
    });

    const res = await describeScreen(
      { repoPath: '/mock/repo', screenId: 'screen-main', language: 'es' },
      deps,
    );

    expect(res).toEqual({
      status: 'ok',
      description: {
        text: 'Explicación válida.',
        source: 'ai',
        citedFiles: ['app/page.tsx'],
        model: 'test-model',
        createdAt: '2026-10-16T12:00:00Z',
      },
    });

    // Se leyeron como máximo 3 archivos de entrada
    expect(readFiles.length).toBeLessThanOrEqual(3);
    // Primero el archivo principal y después por ruta: el cuarto (Header) queda afuera.
    expect(readFiles).toEqual(['app/page.tsx', 'components/Extra.tsx', 'components/Footer.tsx']);

    // Cada recorte de archivo no supera 3.000 caracteres
    expect(capturedUserPrompt).toContain('app/page.tsx');
    expect(capturedUserPrompt).toContain('components/Footer.tsx');
    expect(capturedUserPrompt.length).toBeLessThanOrEqual(12_000);
  });

  it('acierto de caché sin llamar al modelo', async () => {
    const deps = createMockDeps({
      cache: {
        get: vi.fn().mockReturnValue({
          explanation: JSON.stringify({
            text: 'Explicación recuperada de caché.',
            citedFiles: ['app/page.tsx'],
          }),
          provider: 'cached-provider',
          model: 'cached-model',
          generatedAt: '2026-10-16T09:00:00Z',
        }),
        put: vi.fn(),
      },
    });

    const res = await describeScreen(
      { repoPath: '/mock/repo', screenId: 'screen-main', language: 'es' },
      deps,
    );

    expect(res).toEqual({
      status: 'ok',
      description: {
        text: 'Explicación recuperada de caché.',
        source: 'ai',
        citedFiles: ['app/page.tsx'],
        model: 'cached-model',
        createdAt: '2026-10-16T09:00:00Z',
      },
    });

    expect(deps.resolveModel).not.toHaveBeenCalled();
    expect(deps.runText).not.toHaveBeenCalled();
    expect(deps.cache.put).not.toHaveBeenCalled();
  });

  it('cacheOnly no llama al modelo', async () => {
    const deps = createMockDeps({
      cache: {
        get: vi.fn().mockReturnValue(null),
        put: vi.fn(),
      },
    });

    const res = await describeScreen(
      { repoPath: '/mock/repo', screenId: 'screen-main', language: 'es', cacheOnly: true },
      deps,
    );

    expect(res).toBeNull();
    expect(deps.resolveModel).not.toHaveBeenCalled();
    expect(deps.runText).not.toHaveBeenCalled();
  });

  it('respuesta con un citado fuera de la pantalla → unavailable', async () => {
    const deps = createMockDeps({
      runText: vi.fn().mockResolvedValue({
        text: JSON.stringify({
          text: 'Explicación con archivo inventado.',
          citedFiles: ['archivo/inexistente/en/pantalla.ts'],
        }),
        modelId: 'test-model',
        providerId: 'test-p',
      }),
    });

    const res = await describeScreen(
      { repoPath: '/mock/repo', screenId: 'screen-main', language: 'es' },
      deps,
    );

    expect(res).toEqual({
      status: 'unavailable',
      message: 'La IA no dio una explicación que se pueda comprobar.',
    });
    expect(deps.cache.put).not.toHaveBeenCalled();
  });

  it('sin citas → unavailable', async () => {
    const deps = createMockDeps({
      runText: vi.fn().mockResolvedValue({
        text: JSON.stringify({
          text: 'Explicación sin ninguna cita.',
          citedFiles: [],
        }),
        modelId: 'test-model',
        providerId: 'test-p',
      }),
    });

    const res = await describeScreen(
      { repoPath: '/mock/repo', screenId: 'screen-main', language: 'es' },
      deps,
    );

    expect(res).toEqual({
      status: 'unavailable',
      message: 'La IA no dio una explicación que se pueda comprobar.',
    });
    expect(deps.cache.put).not.toHaveBeenCalled();
  });

  it('sin modelo → el mensaje simple', async () => {
    const deps = createMockDeps({
      resolveModel: vi.fn().mockReturnValue({
        status: 'unset',
      } as any),
    });

    const res = await describeScreen(
      { repoPath: '/mock/repo', screenId: 'screen-main', language: 'es' },
      deps,
    );

    expect(res).toEqual({
      status: 'unavailable',
      message: 'Todavía no elegiste un modelo. Elegilo en el selector del chat o en Motores y modelos.',
    });
    expect(deps.runText).not.toHaveBeenCalled();
  });
});
