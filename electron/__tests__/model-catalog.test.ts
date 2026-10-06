// electron/__tests__/model-catalog.test.ts
//
// Pruebas del catálogo de modelos en el proceso principal (tanda 24, Pedido 5 y tanda 24b).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoadedGitCronConfig } from '../ai/config/gitcron-config';
import {
  getToolModelsForUse,
  refreshModelCatalog,
  resetModelCatalog,
  subscribeToModelCatalog,
  setModelCatalogContextProvider,
} from '../ai/config/model-catalog';
import * as providerModelsModule from '../ai/config/provider-models';
import * as toolModelsModule from '../ai/config/tool-models';

describe('Catálogo de modelos en proceso principal (model-catalog)', () => {
  const dummyLoaded: LoadedGitCronConfig = {
    config: {
      provider: {
        'server-alpha': {
          name: 'Server Alpha',
          baseUrl: 'http://localhost:11434/v1',
          models: {
            'alpha-default': { name: 'Alpha Default' },
          },
        },
        'server-beta': {
          name: 'Server Beta',
          baseUrl: 'http://localhost:1234/v1',
          models: {},
        },
      },
      model: 'server-alpha/alpha-default',
    },
    originOf: () => undefined,
    files: [
      {
        scope: 'global',
        path: '/mock/gitcron.json',
        exists: true,
      },
    ],
  };

  function mockListResult(
    providerId: string,
    overrides?: Partial<providerModelsModule.ProviderModelList>,
  ): providerModelsModule.ProviderModelList {
    return {
      providerId,
      status: 'ok',
      lmstudioLayer: false,
      models: [
        {
          id: `${providerId}-model-1`,
          name: `${providerId} Model 1`,
          declared: false,
          reported: true,
        },
      ],
      ...overrides,
    };
  }

  beforeEach(() => {
    resetModelCatalog();
    setModelCatalogContextProvider(null);
    vi.clearAllMocks();

    // CLIs rápidos por omisión
    vi.spyOn(toolModelsModule, 'fetchCodexModels').mockResolvedValue({
      ok: true,
      models: [{ id: 'codex-m1', name: 'Codex M1' }],
    });
    vi.spyOn(toolModelsModule, 'fetchAgyModels').mockResolvedValue({
      ok: true,
      models: [{ id: 'agy-m1', name: 'AGY M1' }],
    });
  });

  afterEach(() => {
    resetModelCatalog();
    setModelCatalogContextProvider(null);
    vi.restoreAllMocks();
  });

  it('la segunda apertura no espera: la respuesta sale del catálogo sin llamar a los servidores', async () => {
    const listSpy = vi.spyOn(providerModelsModule, 'listProviderModels').mockImplementation(async (providerId) => {
      return mockListResult(providerId);
    });

    // Primera apertura: puebla el catálogo
    const firstResult = await getToolModelsForUse({
      use: 'gitcron-commit',
      loaded: dummyLoaded,
    });

    expect(firstResult.providers.length).toBeGreaterThan(0);
    const alphaProvider = firstResult.providers.find((p) => p.id === 'server-alpha');
    expect(alphaProvider?.available).toBe(true);
    expect(listSpy).toHaveBeenCalledWith('server-alpha', expect.any(Object));
    expect(listSpy).toHaveBeenCalledWith('server-beta', expect.any(Object));

    const callCountAfterFirst = listSpy.mock.calls.length;

    // Segunda apertura inmediata: debe salir de memoria sin volver a consultar servidores
    const secondResult = await getToolModelsForUse({
      use: 'gitcron-commit',
      loaded: dummyLoaded,
    });

    expect(secondResult.providers.length).toBe(firstResult.providers.length);
    expect(listSpy.mock.calls.length).toBe(callCountAfterFirst);
  });

  it('los servidores se consultan en paralelo (no en serie)', async () => {
    vi.useFakeTimers();
    let concurrent = 0;
    let maxConcurrent = 0;

    vi.spyOn(providerModelsModule, 'listProviderModels').mockImplementation(async (providerId) => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      concurrent--;
      return mockListResult(providerId);
    });

    let finished = false;
    const promise = refreshModelCatalog({ loaded: dummyLoaded }).then(() => {
      finished = true;
    });

    // A los 500ms ambos servidores ya están consultándose a la vez
    await vi.advanceTimersByTimeAsync(500);
    expect(maxConcurrent).toBe(2);
    expect(finished).toBe(false);

    // Con dos servidores que tardan 1 s cada uno en paralelo, terminan en 1000 ms (~1 s, no 2)
    await vi.advanceTimersByTimeAsync(500);
    await promise;
    expect(finished).toBe(true);

    vi.useRealTimers();
  });

  it('un servidor que no responde conserva su lista anterior marcada sin confirmar y sin texto inventado', async () => {
    let shouldFail = false;

    vi.spyOn(providerModelsModule, 'listProviderModels').mockImplementation(async (providerId) => {
      if (providerId === 'server-alpha' && shouldFail) {
        return mockListResult(providerId, {
          status: 'unreachable',
          detail: 'ECONNREFUSED 127.0.0.1:11434',
          models: [],
        });
      }
      return mockListResult(providerId, {
        models: [
          {
            id: `${providerId}-discovered`,
            name: `${providerId} Discovered`,
            declared: false,
            reported: true,
          },
        ],
      });
    });

    // 1. Éxito inicial: guarda modelos descubiertos
    const initial = await refreshModelCatalog({ loaded: dummyLoaded });
    const alphaInitial = initial.find((p) => p.id === 'server-alpha');
    expect(alphaInitial?.available).toBe(true);
    expect(alphaInitial?.unconfirmed).toBe(false);
    expect(alphaInitial?.models.some((m) => m.id === 'server-alpha-discovered')).toBe(true);

    // 2. Falla del servidor en la siguiente actualización
    shouldFail = true;
    const refreshed = await refreshModelCatalog({ loaded: dummyLoaded });
    const alphaRefreshed = refreshed.find((p) => p.id === 'server-alpha');

    expect(alphaRefreshed?.available).toBe(false);
    expect(alphaRefreshed?.unavailableReason).toBe('ECONNREFUSED 127.0.0.1:11434');
    expect(alphaRefreshed?.unconfirmed).toBe(true);
    // Conserva los modelos anteriores pero marcados sin confirmar
    expect(alphaRefreshed?.models.length).toBeGreaterThan(0);
    const discoveredModel = alphaRefreshed?.models.find((m) => m.id === 'server-alpha-discovered');
    expect(discoveredModel).toBeDefined();
    expect(discoveredModel?.unconfirmed).toBe(true);
  });

  it('subscribeToModelCatalog notifica sin datos cuando el catálogo se actualiza', async () => {
    vi.spyOn(providerModelsModule, 'listProviderModels').mockImplementation(async (providerId) => {
      return mockListResult(providerId, {
        models: [{ id: 'm1', name: 'Model 1', declared: false, reported: true }],
      });
    });

    let callCount = 0;
    const unsubscribe = subscribeToModelCatalog(() => {
      callCount++;
    });

    await refreshModelCatalog({ loaded: dummyLoaded });

    expect(callCount).toBe(1);

    unsubscribe();
    await refreshModelCatalog({ loaded: dummyLoaded });
    // Tras desuscribirse no recibe más notificaciones
    expect(callCount).toBe(1);
  });

  it('dos repos con proveedores distintos no se mezclan (aislamiento por loaded config)', async () => {
    vi.spyOn(providerModelsModule, 'listProviderModels').mockImplementation(async (providerId) => mockListResult(providerId));

    const repoALoaded: LoadedGitCronConfig = {
      config: {
        provider: {
          'server-alpha': { name: 'Alpha', baseUrl: 'http://localhost:11434/v1', models: {} },
        },
      },
      originOf: () => undefined,
      files: [],
    };

    const repoBLoaded: LoadedGitCronConfig = {
      config: {
        provider: {
          'server-beta': { name: 'Beta', baseUrl: 'http://localhost:1234/v1', models: {} },
        },
      },
      originOf: () => undefined,
      files: [],
    };

    const resA = await getToolModelsForUse({ use: 'gitcron-commit', loaded: repoALoaded });
    const resB = await getToolModelsForUse({ use: 'gitcron-commit', loaded: repoBLoaded });

    // Repo A tiene CLIs + server-alpha, pero NO server-beta
    expect(resA.providers.some((p) => p.id === 'server-alpha')).toBe(true);
    expect(resA.providers.some((p) => p.id === 'server-beta')).toBe(false);

    // Repo B tiene CLIs + server-beta, pero NO server-alpha
    expect(resB.providers.some((p) => p.id === 'server-beta')).toBe(true);
    expect(resB.providers.some((p) => p.id === 'server-alpha')).toBe(false);
  });

  it('un proveedor quitado del archivo desaparece del selector', async () => {
    vi.spyOn(providerModelsModule, 'listProviderModels').mockImplementation(async (providerId) => mockListResult(providerId));

    // 1. Con server-alpha
    const withAlpha: LoadedGitCronConfig = {
      config: {
        provider: {
          'server-alpha': { name: 'Alpha', baseUrl: 'http://localhost:11434/v1', models: {} },
        },
      },
      originOf: () => undefined,
      files: [],
    };
    const res1 = await getToolModelsForUse({ use: 'gitcron-commit', loaded: withAlpha });
    expect(res1.providers.some((p) => p.id === 'server-alpha')).toBe(true);

    // 2. Se borró server-alpha del archivo
    const withoutAlpha: LoadedGitCronConfig = {
      config: {
        provider: {},
      },
      originOf: () => undefined,
      files: [],
    };
    const res2 = await getToolModelsForUse({ use: 'gitcron-commit', loaded: withoutAlpha });
    expect(res2.providers.some((p) => p.id === 'server-alpha')).toBe(false);
  });

  it('un proveedor nuevo aparece al instante con sus modelos declarados «sin confirmar» sin esperar al servidor', async () => {
    vi.spyOn(providerModelsModule, 'listProviderModels').mockImplementation(async (providerId) => {
      return mockListResult(providerId);
    });

    // Catálogo ya calentado con un primer llamado
    await getToolModelsForUse({
      use: 'gitcron-commit',
      loaded: dummyLoaded,
    });

    // Nuevo loaded con server-gamma que nunca se consultó
    const withGamma: LoadedGitCronConfig = {
      config: {
        provider: {
          'server-gamma': {
            name: 'Server Gamma',
            baseUrl: 'http://localhost:9999/v1',
            models: {
              'gamma-fast': { name: 'Gamma Fast' },
            },
          },
        },
      },
      originOf: () => undefined,
      files: [],
    };

    const res = await getToolModelsForUse({
      use: 'gitcron-commit',
      loaded: withGamma,
    });

    const gamma = res.providers.find((p) => p.id === 'server-gamma');
    expect(gamma).toBeDefined();
    expect(gamma?.unconfirmed).toBe(true);
    expect(gamma?.models.some((m) => m.id === 'gamma-fast')).toBe(true);
    expect(gamma?.models[0].unconfirmed).toBe(true);
  });

  it('el contexto se arma dinámicamente mediante el context provider (A.2)', async () => {
    const listSpy = vi.spyOn(providerModelsModule, 'listProviderModels').mockImplementation(async (providerId) => mockListResult(providerId));

    const mockStored = vi.fn((key: string) => (key === 'MY_KEY' ? 'secret-key-123' : undefined));
    setModelCatalogContextProvider(() => ({
      configPath: '/dynamic/path/gitcron.json',
      stored: mockStored,
    }));

    await refreshModelCatalog({ loaded: dummyLoaded });

    expect(listSpy).toHaveBeenCalledWith('server-alpha', expect.objectContaining({
      configPath: '/dynamic/path/gitcron.json',
      stored: mockStored,
    }));
  });
});
