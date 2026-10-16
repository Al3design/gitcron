import { describe, expect, it, vi } from 'vitest';
import {
  defaultResumeNarrationDeps,
  narrateResume,
  type ResumeNarrationDeps,
} from '../resume-narration';
import type { ResolvedModelFor } from '../../ai/config/resolve-model-for';
import type { TextUseRequest, TextUseResult } from '../../ai/text-use';
import type { SafeReadResult } from '../../pipeline/repo-paths';
import type { ContextResolution } from '../context-reference';

describe('resume-narration service (Tarea 3.3)', () => {
  const authorizedRoot = '/canonical/repo';
  const headSha = '1111222233334444555566667777888899990000';
  const sampleProposal = `# Mi Propuesta\n\n## Why\n\nObjetivo principal del cambio para retomar el trabajo fácilmente.\n\n## What Changes\n\n- Algo.`;
  const sampleTasks = `# Tasks\n\n## 1. Fase 1\n\n- [x] 1.1 **IA local:** Tarea completada uno. **Comprobación:** Pasa test.\n- [x] 1.2 **IA local:** Tarea completada dos. **Comprobación:** Pasa test.\n- [ ] 1.3 **IA local:** Tarea pendiente tres. **Comprobación:** Pasa verificación.\n`;

  const validModelConfig: ResolvedModelFor = {
    status: 'resolved',
    use: 'gitcron-assist',
    resolved: {
      providerId: 'lmstudio',
      providerName: 'LM Studio',
      modelId: 'qwen-2.5-coder',
      kind: 'openai-compatible',
      destination: 'this-machine',
      sourceFile: 'gitcron.json',
      available: true,
      provenance: {
        sourceFile: 'gitcron.json',
        model: 'qwen-2.5-coder',
        options: {},
        headers: {},
      },
    },
    alternatives: [],
  };

  const validModelAnswer = JSON.stringify({
    paragraphs: [
      {
        text: 'Se completaron las tareas iniciales y queda pendiente la verificación de la fase 1.',
        sourceIds: ['tasks', 'proposal'],
      },
    ],
  });

  function makeDeps(overrides: Partial<ResumeNarrationDeps> = {}): ResumeNarrationDeps {
    const fileContents: Record<string, string> = {
      'openspec/changes/mi-cambio/proposal.md': sampleProposal,
      'openspec/changes/mi-cambio/tasks.md': sampleTasks,
    };

    return {
      authorizedRoot: vi.fn((p) => (p === authorizedRoot || p === '/canonical/repo' ? authorizedRoot : null)),
      resolveContext: vi.fn(async (): Promise<ContextResolution> => ({
        status: 'ok' as const,
        checkoutPath: authorizedRoot,
        head: { sha: headSha, branch: 'main' },
        selection: { kind: 'none' as const },
      })),
      safeReadFile: vi.fn(async (_root, relPath): Promise<SafeReadResult> => {
        const normalized = relPath.replace(/\\/g, '/');
        if (normalized in fileContents) {
          return {
            status: 'ok' as const,
            content: fileContents[normalized],
            sourceRef: normalized,
            diagnostics: [],
          };
        }
        return {
          status: 'missing' as const,
          content: null,
          sourceRef: normalized,
          diagnostics: [],
        };
      }),
      resolveModel: vi.fn(() => validModelConfig),
      runText: vi.fn(async (_config, _req: TextUseRequest): Promise<TextUseResult> => ({
        text: validModelAnswer,
        finishReason: 'stop',
        usage: null,
        label: 'LM Studio · qwen-2.5-coder',
        providerId: 'lmstudio',
        modelId: 'qwen-2.5-coder',
      })),
      clock: () => new Date('2026-10-15T12:00:00.000Z'),
      ...overrides,
    };
  }

  it('defaultResumeNarrationDeps está definido correctamente', () => {
    expect(defaultResumeNarrationDeps).toBeDefined();
    expect(defaultResumeNarrationDeps.authorizedRoot).toBeTypeOf('function');
  });

  it('autorización: repo no autorizado devuelve unavailable y no lee ni llama al modelo', async () => {
    const deps = makeDeps();
    const result = await narrateResume(
      {
        repoPath: '/ajeno',
        changeId: 'mi-cambio',
        archivedAt: null,
        language: 'es',
      },
      deps,
    );

    expect(result.status).toBe('unavailable');
    expect(result).toHaveProperty('message');
    expect(deps.safeReadFile).not.toHaveBeenCalled();
    expect(deps.resolveModel).not.toHaveBeenCalled();
    expect(deps.runText).not.toHaveBeenCalled();
  });

  it('slug y fecha inválidos impiden lecturas y llamada al modelo', async () => {
    const deps = makeDeps();

    // Slug con caracteres prohibidos
    const res1 = await narrateResume(
      {
        repoPath: authorizedRoot,
        changeId: 'Cambio_Invalido!',
        archivedAt: null,
        language: 'es',
      },
      deps,
    );
    expect(res1.status).toBe('unavailable');
    expect(deps.safeReadFile).not.toHaveBeenCalled();

    // Fecha archivada inválida
    const res2 = await narrateResume(
      {
        repoPath: authorizedRoot,
        changeId: 'mi-cambio',
        archivedAt: 'fecha-invalida',
        language: 'es',
      },
      deps,
    );
    expect(res2.status).toBe('unavailable');
    expect(deps.safeReadFile).not.toHaveBeenCalled();

    // Idioma no soportado
    const res3 = await narrateResume(
      {
        repoPath: authorizedRoot,
        changeId: 'mi-cambio',
        archivedAt: null,
        language: 'fr' as any,
      },
      deps,
    );
    expect(res3.status).toBe('unavailable');
    expect(deps.safeReadFile).not.toHaveBeenCalled();
  });

  it('rutas activas y archivadas se componen correctamente', async () => {
    const readCalls: string[] = [];
    const deps = makeDeps({
      safeReadFile: vi.fn(async (_root, relPath) => {
        readCalls.push(relPath.replace(/\\/g, '/'));
        return {
          status: 'ok' as const,
          content: 'contenido',
          sourceRef: relPath,
          diagnostics: [],
        };
      }),
    });

    // Activo
    await narrateResume(
      {
        repoPath: authorizedRoot,
        changeId: 'mi-cambio',
        archivedAt: null,
        language: 'es',
      },
      deps,
    );
    expect(readCalls).toContain('openspec/changes/mi-cambio/proposal.md');
    expect(readCalls).toContain('openspec/changes/mi-cambio/tasks.md');

    readCalls.length = 0;

    // Archivado
    await narrateResume(
      {
        repoPath: authorizedRoot,
        changeId: 'mi-cambio',
        archivedAt: '2026-09-18',
        language: 'es',
      },
      deps,
    );
    expect(readCalls).toContain('openspec/changes/archive/2026-09-18-mi-cambio/proposal.md');
    expect(readCalls).toContain('openspec/changes/archive/2026-09-18-mi-cambio/tasks.md');
  });

  it('fuente ausente, enorme o rechazada no llama al modelo y devuelve unavailable', async () => {
    // Missing
    const depsMissing = makeDeps({
      safeReadFile: vi.fn(async () => ({
        status: 'missing' as const,
        content: null,
        sourceRef: 'x',
        diagnostics: [],
      })),
    });
    const resMissing = await narrateResume(
      {
        repoPath: authorizedRoot,
        changeId: 'mi-cambio',
        archivedAt: null,
        language: 'es',
      },
      depsMissing,
    );
    expect(resMissing.status).toBe('unavailable');
    expect(depsMissing.runText).not.toHaveBeenCalled();

    // Too large
    const depsLarge = makeDeps({
      safeReadFile: vi.fn(async () => ({
        status: 'too-large' as const,
        content: null,
        sourceRef: 'x',
        diagnostics: [],
      })),
    });
    const resLarge = await narrateResume(
      {
        repoPath: authorizedRoot,
        changeId: 'mi-cambio',
        archivedAt: null,
        language: 'es',
      },
      depsLarge,
    );
    expect(resLarge.status).toBe('unavailable');
    expect(depsLarge.runText).not.toHaveBeenCalled();

    // Rejected (e.g. symlink fuera del repo)
    const depsRejected = makeDeps({
      safeReadFile: vi.fn(async () => ({
        status: 'rejected' as const,
        content: null,
        sourceRef: 'x',
        diagnostics: [],
      })),
    });
    const resRejected = await narrateResume(
      {
        repoPath: authorizedRoot,
        changeId: 'mi-cambio',
        archivedAt: null,
        language: 'es',
      },
      depsRejected,
    );
    expect(resRejected.status).toBe('unavailable');
    expect(depsRejected.runText).not.toHaveBeenCalled();
  });

  it('presupuesto: si el paquete de datos supera 12.000 caracteres no llama al modelo', async () => {
    // El identificador no se recorta como el título: fuerza el límite del paquete
    // sin simular una lectura de archivo superior al límite de 128 KiB.
    const hugeTasks = `- [ ] ${'1'.repeat(12_100)} Tarea pendiente`;
    const deps = makeDeps({
      safeReadFile: vi.fn(async (_root, relPath) => ({
        status: 'ok' as const,
        content: relPath.includes('tasks') ? hugeTasks : sampleProposal,
        sourceRef: relPath,
        diagnostics: [],
      })),
    });

    const res = await narrateResume(
      {
        repoPath: authorizedRoot,
        changeId: 'mi-cambio',
        archivedAt: null,
        language: 'es',
      },
      deps,
    );
    expect(res.status).toBe('unavailable');
    expect(deps.runText).not.toHaveBeenCalled();
    expect(deps.resolveModel).not.toHaveBeenCalled();
  });

  it('rechaza una fecha que Date.parse normaliza a otro día antes de leer fuentes', async () => {
    const deps = makeDeps();
    const result = await narrateResume({ repoPath: authorizedRoot, changeId: 'mi-cambio', archivedAt: '2026-02-30', language: 'es' }, deps);
    expect(result.status).toBe('unavailable');
    expect(deps.safeReadFile).not.toHaveBeenCalled();
    expect(deps.runText).not.toHaveBeenCalled();
  });

  it('mismo uso compartido: resuelve gitcron-assist y usa su configuración', async () => {
    const deps = makeDeps();
    await narrateResume(
      {
        repoPath: authorizedRoot,
        changeId: 'mi-cambio',
        archivedAt: null,
        language: 'es',
      },
      deps,
    );

    expect(deps.resolveModel).toHaveBeenCalledWith('gitcron-assist', authorizedRoot);
    expect(deps.runText).toHaveBeenCalledWith(validModelConfig, expect.objectContaining({
      maxTokens: 600,
      timeoutMs: 30_000,
      repoPath: authorizedRoot,
    }));
    const request = vi.mocked(deps.runText).mock.calls[0][1];
    expect(request.user).not.toContain(authorizedRoot);
    expect(request.user).toContain('openspec/changes/mi-cambio/tasks.md');
  });

  it('falta de modelo o caída deja unavailable con el motivo', async () => {
    // Modelo no configurado
    const depsUnset = makeDeps({
      resolveModel: vi.fn(() => ({
        status: 'unset' as const,
        use: 'gitcron-assist' as const,
        alternatives: [],
      })),
    });
    const resUnset = await narrateResume(
      {
        repoPath: authorizedRoot,
        changeId: 'mi-cambio',
        archivedAt: null,
        language: 'es',
      },
      depsUnset,
    );
    expect(resUnset.status).toBe('unavailable');
    if (resUnset.status === 'unavailable') {
      expect(resUnset.message).toBe(
        'Todavía no elegiste un modelo para el chat. Elegilo en el selector del chat o en Motores y modelos.',
      );
    }

    // Modelo caído
    const depsFailed = makeDeps({
      runText: vi.fn(async () => {
        throw new Error('Servidor LM Studio fuera de línea en http://127.0.0.1:1234');
      }),
    });
    const resFailed = await narrateResume(
      {
        repoPath: authorizedRoot,
        changeId: 'mi-cambio',
        archivedAt: null,
        language: 'es',
      },
      depsFailed,
    );
    expect(resFailed.status).toBe('unavailable');
    if (resFailed.status === 'unavailable') {
      expect(resFailed.message).toContain('LM Studio fuera de línea');
    }
  });

  it('JSON malformado o de prosa se rechaza sin mostrarlo como narración', async () => {
    const deps = makeDeps({
      runText: vi.fn(async () => ({
        text: '```json\n{"paragraphs": [{"text": "hola", "sourceIds": ["tasks"]}]}\n```',
        finishReason: 'stop',
        usage: null,
        label: 'test',
        providerId: 'lmstudio',
        modelId: 'qwen',
      })),
    });
    const res = await narrateResume(
      {
        repoPath: authorizedRoot,
        changeId: 'mi-cambio',
        archivedAt: null,
        language: 'es',
      },
      deps,
    );
    expect(res.status).toBe('unavailable');
    if (res.status === 'unavailable') {
      expect(res.message).toContain('JSON válido');
    }
  });

  it('citas inválidas o cantidad de párrafos fuera de límite se rechazan', async () => {
    // Citas libres / desconocidas
    const depsBadSource = makeDeps({
      runText: vi.fn(async () => ({
        text: JSON.stringify({
          paragraphs: [{ text: 'Hola', sourceIds: ['fuente-inventada'] }],
        }),
        finishReason: 'stop',
        usage: null,
        label: 'test',
        providerId: 'lmstudio',
        modelId: 'qwen',
      })),
    });
    const resBadSource = await narrateResume(
      {
        repoPath: authorizedRoot,
        changeId: 'mi-cambio',
        archivedAt: null,
        language: 'es',
      },
      depsBadSource,
    );
    expect(resBadSource.status).toBe('unavailable');

    // Más de 3 párrafos
    const depsTooMany = makeDeps({
      runText: vi.fn(async () => ({
        text: JSON.stringify({
          paragraphs: [
            { text: 'Uno', sourceIds: ['tasks'] },
            { text: 'Dos', sourceIds: ['tasks'] },
            { text: 'Tres', sourceIds: ['tasks'] },
            { text: 'Cuatro', sourceIds: ['tasks'] },
          ],
        }),
        finishReason: 'stop',
        usage: null,
        label: 'test',
        providerId: 'lmstudio',
        modelId: 'qwen',
      })),
    });
    const resTooMany = await narrateResume(
      {
        repoPath: authorizedRoot,
        changeId: 'mi-cambio',
        archivedAt: null,
        language: 'es',
      },
      depsTooMany,
    );
    expect(resTooMany.status).toBe('unavailable');
  });

  it('modificación de contenido durante el pedido deja stale sin texto', async () => {
    let callCount = 0;
    const deps = makeDeps({
      safeReadFile: vi.fn(async (_root, relPath) => {
        callCount++;
        // En la segunda lectura (callCount > 2), el archivo cambió de contenido
        const content = callCount > 2 ? 'contenido modificado externamente' : sampleProposal;
        return {
          status: 'ok' as const,
          content,
          sourceRef: relPath,
          diagnostics: [],
        };
      }),
    });

    const res = await narrateResume(
      {
        repoPath: authorizedRoot,
        changeId: 'mi-cambio',
        archivedAt: null,
        language: 'es',
      },
      deps,
    );
    expect(res.status).toBe('stale');
    expect(res).not.toHaveProperty('data');
  });

  it('cambio de HEAD durante el pedido deja stale sin texto', async () => {
    let contextCalls = 0;
    const deps = makeDeps({
      resolveContext: vi.fn(async () => {
        contextCalls++;
        return {
          status: 'ok' as const,
          checkoutPath: authorizedRoot,
          head: { sha: contextCalls > 1 ? '9999888877776666555544443333222211110000' : headSha, branch: 'main' },
          selection: { kind: 'none' as const },
        };
      }),
    });

    const res = await narrateResume(
      {
        repoPath: authorizedRoot,
        changeId: 'mi-cambio',
        archivedAt: null,
        language: 'es',
      },
      deps,
    );
    expect(res.status).toBe('stale');
    expect(res).not.toHaveProperty('data');
  });

  it('éxito: devuelve narrated con párrafos, fuentes, huella, fecha y proveedor/modelo', async () => {
    const deps = makeDeps();
    const res = await narrateResume(
      {
        repoPath: authorizedRoot,
        changeId: 'mi-cambio',
        archivedAt: null,
        language: 'es',
      },
      deps,
    );

    expect(res.status).toBe('narrated');
    if (res.status === 'narrated') {
      expect(res.data.paragraphs).toHaveLength(1);
      expect(res.data.paragraphs[0].text).toContain('Se completaron las tareas iniciales');
      expect(res.data.paragraphs[0].sourceIds).toEqual(['tasks', 'proposal']);
      expect(res.data.sources).toEqual([
        { id: 'proposal', ref: 'openspec/changes/mi-cambio/proposal.md' },
        { id: 'tasks', ref: 'openspec/changes/mi-cambio/tasks.md' },
        { id: 'head', ref: `HEAD:${headSha}` },
      ]);
      expect(res.data.fingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(res.data.createdAt).toBe('2026-10-15T12:00:00.000Z');
      expect(res.data.providerName).toBe('LM Studio');
      expect(res.data.modelId).toBe('qwen-2.5-coder');
    }
  });
});
