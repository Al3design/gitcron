// electron/__tests__/opencode-export.test.ts
//
// Pruebas de «Copiar a OpenCode» (tarea 5.3 segunda parte, D8).
//
// - Proveedor ausente: se agrega el bloque entero con sus referencias {env:}.
// - Proveedor presente sin el modelo: sólo se agrega el modelo en provider.<id>.models.<modelo>.
// - Archivo opencode.json inexistente: se crea con el texto inicial y el bloque.
// - En los tres casos, lo demás del archivo queda igual byte a byte (comentarios, comas finales).
// - Sin confirmación (sólo plan) no se escribe nada.
// - Con una clave escrita a mano en gitcron.json, el valor NO aparece en el archivo ni en el plan/previa.
// - Tras escribir se llama reload en el runner.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { planOpenCodeExport, applyOpenCodeExport } from '../ai/config/opencode-export';
import type { GitCronConfig } from '../ai/config/gitcron-config';
import type { RuntimeProcessRunner, RuntimeProcessSpec, RuntimeProcessResult } from '../pipeline/runtime-adapters/process-runner';

describe('opencode-export', () => {
  const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-export-test-'));

  const mockRunner = (executed: string[] = []): RuntimeProcessRunner =>
    ({
      run: async (spec: RuntimeProcessSpec): Promise<RuntimeProcessResult> => {
        executed.push(spec.args.join(' '));
        return {
          processId: 'p1',
          exitCode: 0,
          signal: null,
          stdout: Buffer.from(spec.args[0] === 'service' && spec.args[1] === 'status' ? 'http://127.0.0.1:4096' : ''),
          stderr: Buffer.from(''),
          durationMs: 5,
          timedOut: false,
          aborted: false,
          outputLimit: null,
        };
      },
    }) as unknown as RuntimeProcessRunner;

  it('sin confirmación, el plan no escribe nada en el disco', () => {
    const dir = tmpDir();
    const opencodePath = path.join(dir, 'opencode.json');
    const config: GitCronConfig = {
      provider: {
        unsloth: {
          name: 'Unsloth CASA',
          options: { baseURL: 'http://192.168.1.7:1234' },
          models: { 'unsloth/Qwen3.8': { name: 'Qwen 3.8' } },
        },
      },
    };

    const plan = planOpenCodeExport({
      providerId: 'unsloth',
      modelId: 'unsloth/Qwen3.8',
      opencodePath,
      config,
    });

    expect(plan.canCopy).toBe(true);
    expect(plan.mode).toBe('add_provider');
    expect(fs.existsSync(opencodePath)).toBe(false);
  });

  it('proveedor ausente: copia el bloque entero con referencias y deja el resto del archivo igual byte a byte', async () => {
    const dir = tmpDir();
    const opencodePath = path.join(dir, 'opencode.json');
    // Archivo existente con comentarios y comas finales
    const initialText = `// Configuración personal de OpenCode
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    // Proveedor existente que no debe tocarse
    "ollama": {
      "name": "Ollama local",
      "options": {
        "baseURL": "http://localhost:11434",
      },
    },
  },
}
`;
    fs.writeFileSync(opencodePath, initialText, 'utf8');

    const config: GitCronConfig = {
      provider: {
        unsloth: {
          name: 'Unsloth CASA',
          options: {
            baseURL: 'http://192.168.1.7:1234',
            apiKey: '{env:UNSLOTH_API_KEY}',
          },
          models: {
            'unsloth/Qwen3.8': {
              name: 'Qwen 3.8',
            },
          },
        },
      },
    };

    const plan = planOpenCodeExport({
      providerId: 'unsloth',
      modelId: 'unsloth/Qwen3.8',
      opencodePath,
      config,
    });

    expect(plan.canCopy).toBe(true);
    expect(plan.mode).toBe('add_provider');
    expect(plan.hasLiteralSecrets).toBe(false);

    const executedCommands: string[] = [];
    const runner = mockRunner(executedCommands);
    const result = await applyOpenCodeExport(plan, { runner, cwd: dir });

    expect(result.ok).toBe(true);
    // Verifica que se llamó reload
    expect(executedCommands).toContain('reload');

    const afterText = fs.readFileSync(opencodePath, 'utf8');
    // Debe contener el comentario original intacto
    expect(afterText).toContain('// Configuración personal de OpenCode');
    expect(afterText).toContain('// Proveedor existente que no debe tocarse');
    // Debe contener el nuevo proveedor con su referencia {env:UNSLOTH_API_KEY}
    expect(afterText).toContain('"unsloth"');
    expect(afterText).toContain('{env:UNSLOTH_API_KEY}');
    expect(afterText).toContain('"unsloth/Qwen3.8"');

    // Comprobar que el tramo previo al proveedor añadido sigue exactamente igual
    const prefix = afterText.slice(0, afterText.indexOf('"unsloth"'));
    expect(initialText.startsWith(prefix.trimEnd())).toBe(true);
  });

  it('proveedor presente sin el modelo: sólo agrega el modelo y no pisa ni reordena lo demás', async () => {
    const dir = tmpDir();
    const opencodePath = path.join(dir, 'opencode.json');
    const initialText = `{\n  "$schema": "https://opencode.ai/config.json",\n  "provider": {\n    "unsloth": {\n      // Comentario dentro del proveedor existente\n      "name": "Unsloth CASA",\n      "options": {\n        "baseURL": "http://192.168.1.7:1234"\n      },\n      "models": {\n        "unsloth/model-old": {\n          "name": "Viejo"\n        }\n      }\n    }\n  }\n}\n`;
    fs.writeFileSync(opencodePath, initialText, 'utf8');

    const config: GitCronConfig = {
      provider: {
        unsloth: {
          name: 'Unsloth CASA (nombre cambiado en gitcron que no debe pisar)',
          models: {
            'unsloth/model-new': {
              name: 'Nuevo modelo',
              limit: { context: 32768 },
            },
          },
        },
      },
    };

    const plan = planOpenCodeExport({
      providerId: 'unsloth',
      modelId: 'unsloth/model-new',
      opencodePath,
      config,
    });

    expect(plan.canCopy).toBe(true);
    expect(plan.mode).toBe('add_model');
    expect(plan.segments).toEqual(['provider', 'unsloth', 'models', 'unsloth/model-new']);

    const executedCommands: string[] = [];
    const runner = mockRunner(executedCommands);
    const result = await applyOpenCodeExport(plan, { runner, cwd: dir });

    expect(result.ok).toBe(true);
    expect(executedCommands).toContain('reload');

    const afterText = fs.readFileSync(opencodePath, 'utf8');
    // El comentario dentro de unsloth se preserva byte a byte
    expect(afterText).toContain('// Comentario dentro del proveedor existente');
    // El nombre original NO fue pisado
    expect(afterText).toContain('"Unsloth CASA"');
    expect(afterText).not.toContain('nombre cambiado en gitcron que no debe pisar');
    // El modelo viejo sigue presente
    expect(afterText).toContain('"unsloth/model-old"');
    // El nuevo modelo fue agregado
    expect(afterText).toContain('"unsloth/model-new"');
  });

  it('opencode.json inexistente: se crea con el texto inicial y el proveedor', async () => {
    const dir = tmpDir();
    const opencodePath = path.join(dir, 'subfolder', 'opencode.json');

    const config: GitCronConfig = {
      provider: {
        unsloth: {
          name: 'Unsloth CASA',
          options: { baseURL: 'http://192.168.1.7:1234' },
          models: { 'unsloth/Qwen3.8': { name: 'Qwen 3.8' } },
        },
      },
    };

    const plan = planOpenCodeExport({
      providerId: 'unsloth',
      modelId: 'unsloth/Qwen3.8',
      opencodePath,
      config,
    });

    expect(plan.canCopy).toBe(true);
    expect(plan.mode).toBe('add_provider');

    const executedCommands: string[] = [];
    const runner = mockRunner(executedCommands);
    const result = await applyOpenCodeExport(plan, { runner, cwd: dir });

    expect(result.ok).toBe(true);
    expect(fs.existsSync(opencodePath)).toBe(true);

    const afterText = fs.readFileSync(opencodePath, 'utf8');
    expect(afterText).toContain('https://opencode.ai/config.json');
    expect(afterText).toContain('"unsloth"');
    expect(afterText).toContain('"unsloth/Qwen3.8"');
  });

  it('clave escrita a mano en gitcron.json: se omite del plan y del archivo, avisando en hasLiteralSecrets', async () => {
    const dir = tmpDir();
    const opencodePath = path.join(dir, 'opencode.json');
    const secretValue = 'literal-secret-xyz-987';

    const config: GitCronConfig = {
      provider: {
        servidor_privado: {
          name: 'Servidor',
          apiKey: secretValue,
          options: {
            apiKey: secretValue,
            headers: {
              authorization: `Bearer ${secretValue}`,
            },
          },
          models: {
            'servidor/m1': { name: 'M1' },
          },
        },
      },
    };

    const plan = planOpenCodeExport({
      providerId: 'servidor_privado',
      modelId: 'servidor/m1',
      opencodePath,
      config,
    });

    expect(plan.canCopy).toBe(true);
    expect(plan.hasLiteralSecrets).toBe(true);
    expect(plan.omittedSecrets.length).toBeGreaterThan(0);
    // El secreto NUNCA aparece en el previewText
    expect(plan.previewText).not.toContain(secretValue);

    const executedCommands: string[] = [];
    const runner = mockRunner(executedCommands);
    const result = await applyOpenCodeExport(plan, { runner, cwd: dir });

    expect(result.ok).toBe(true);
    const writtenText = fs.readFileSync(opencodePath, 'utf8');
    // El secreto NUNCA se escribió en el archivo
    expect(writtenText).not.toContain(secretValue);
  });
});
