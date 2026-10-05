// electron/ai/config/opencode-service.ts
//
// Gestión del servicio de fondo de OpenCode (tarea 5.3 segunda parte, D8).
//
// OpenCode 2.x corre un servicio de fondo compartido. Si el servicio no está
// corriendo, un subcomando como `run` o `api` podría iniciarlo con el entorno
// reducido del runner de GitCron, perdiendo las variables de entorno de la persona.
// Por eso, antes de usar OpenCode, se comprueba `opencode service status`; si no corre,
// se arranca con `opencode service start` con el ENTORNO COMPLETO de GitCron (process.env).
// Los subcomandos `run`, `api` y `reload` continúan ejecutándose con el entorno reducido.
// GitCron nunca detiene ni reinicia el servicio.

import * as os from 'node:os';
import { RuntimeProcessRunner } from '../../pipeline/runtime-adapters/process-runner';

export interface EnsureOpenCodeServiceOptions {
  runner?: RuntimeProcessRunner;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface EnsureOpenCodeServiceResult {
  running: boolean;
  started: boolean;
  error?: string;
}

/**
 * Filtra y prepara las variables de entorno completas para pasarlas a `opencode service start`.
 * Descarta valores nulos o cadenas con bytes nulos que romperían spawn.
 */
export function buildFullEnvironment(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const full: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (key && typeof value === 'string' && !key.includes('\0') && !value.includes('\0')) {
      full[key] = value;
    }
  }
  return full;
}

/**
 * Asegura que el servicio compartido de OpenCode esté en ejecución.
 * Si ya corre (`opencode service status` exitoso), no hace nada.
 * Si no corre, ejecuta `opencode service start` con el entorno completo.
 */
export async function ensureOpenCodeService(
  options: EnsureOpenCodeServiceOptions = {},
): Promise<EnsureOpenCodeServiceResult> {
  const runner = options.runner ?? new RuntimeProcessRunner();
  const cwd = options.cwd ?? os.homedir();

  try {
    const statusResult = await runner.run({
      executable: 'opencode',
      args: ['service', 'status'],
      cwd,
      expectedCanonicalCwd: cwd,
      timeoutMs: 5000,
    });

    if (statusResult.exitCode === 0 && !statusResult.timedOut) {
      // Medido (2.0.20): con el servicio corriendo imprime su dirección. Sólo eso cuenta como
      // «corre»; cualquier otro texto (un aviso de que no corre, por ejemplo) no.
      const stdout = statusResult.stdout.toString('utf8').trim();
      if (/^https?:\/\/\S+$/m.test(stdout)) {
        return { running: true, started: false };
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('was not found') || msg.includes('unavailable')) {
      return { running: false, started: false, error: 'opencode_not_installed' };
    }
    // Si status falló por otra razón, intentamos arrancar el servicio.
  }

  // Si no está corriendo, arrancar el servicio con el entorno completo.
  try {
    const fullEnv = buildFullEnvironment(options.env ?? process.env);
    const startResult = await runner.run({
      executable: 'opencode',
      args: ['service', 'start'],
      cwd,
      expectedCanonicalCwd: cwd,
      env: fullEnv,
      timeoutMs: 15_000,
    });

    if (startResult.exitCode === 0 && !startResult.timedOut) {
      return { running: true, started: true };
    }

    return {
      running: false,
      started: false,
      error: 'opencode_service_start_failed',
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      running: false,
      started: false,
      error: msg,
    };
  }
}

export interface ReloadOpenCodeResult {
  ok: boolean;
  error?: string;
}

/**
 * Recarga la configuración de OpenCode en el servicio activo mediante `opencode reload`.
 * Se ejecuta siempre con el entorno reducido del runner (el servicio ya tiene su entorno).
 */
export async function reloadOpenCode(
  cwd: string = os.homedir(),
  runner: RuntimeProcessRunner = new RuntimeProcessRunner(),
): Promise<ReloadOpenCodeResult> {
  // Asegurarse de que el servicio esté corriendo antes de recargar
  await ensureOpenCodeService({ runner, cwd });

  try {
    const result = await runner.run({
      executable: 'opencode',
      args: ['reload'],
      cwd,
      expectedCanonicalCwd: cwd,
      timeoutMs: 15_000,
    });

    if (result.exitCode === 0 && !result.timedOut) {
      return { ok: true };
    }

    return { ok: false, error: 'opencode_reload_failed' };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
