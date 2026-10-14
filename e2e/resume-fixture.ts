// Repositorio y conversaciones de prueba (del pipeline y del chat de asistencia) en el perfil aislado. No usa cuentas ni motores reales.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { openTemporalAgentDatabase, temporalAgentDatabasePath } from '../electron/db/connection';
import { PipelineRepository } from '../electron/pipeline/pipeline-repository';
import { appendMessage, createConversation } from '../electron/db/assist-conversations';

export function seedResumeFixture(homeDir: string): Record<string, string> {
  const repoPath = path.join(homeDir, 'resume-repo');
  fs.mkdirSync(repoPath, { recursive: true });
  for (const args of [['init'], ['-c', 'user.name=Prueba', '-c', 'user.email=prueba@example.invalid', 'commit', '--allow-empty', '-m', 'Repositorio de prueba']]) {
    const result = spawnSync('git', args, {
      cwd: repoPath, encoding: 'utf8', windowsHide: true,
      env: { ...process.env, GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
    });
    if (result.status !== 0) throw new Error(`No se pudo preparar el repo de prueba: ${result.stderr}`);
  }
  const canonical = fs.realpathSync(repoPath);
  const db = openTemporalAgentDatabase(temporalAgentDatabasePath(path.join(homeDir, '..', 'userData')));
  try {
    const repository = new PipelineRepository(db);
    const binding = repository.getOrCreateBinding(canonical, 'fixture');
    repository.persistRuntimeProjection({
      schemaVersion: '1.0', repoId: binding.repoId, sessionId: 'parent-session', runtime: 'agy',
      changeId: null, taskId: null, role: 'builder', active: false, outcome: 'completed',
      startedAt: '2026-10-07T10:00:00.000Z', endedAt: '2026-10-07T10:01:00.000Z',
      agents: [], activity: [], reasoningVisibility: 'unknown', telemetry: null,
      controlCapabilities: [], droppedActivity: 0, diagnostics: [],
      runtimeSessionId: 'conversation-27', requestedModel: 'gemini-3.8-flash-low', reasoningEffort: 'high', continuesSessionId: null,
    });
    // Conversaciones del chat de asistencia: sin un modelo no se crean desde la pantalla.
    for (const [title, question, answer] of [
      ['Qué falta en retomar', '¿Qué falta para cerrar el cambio?', 'Faltan la **2.7** y la **3.3**.'],
      ['Por qué falla el build', '¿Por qué falla el build?', 'Porque corre encima de otro build.'],
    ]) {
      const conversation = createConversation({ checkoutPath: canonical, title, viewId: 'graph' }, { db });
      appendMessage({ checkoutPath: canonical, conversationId: conversation.id, role: 'user', text: question }, { db });
      appendMessage({ checkoutPath: canonical, conversationId: conversation.id, role: 'assistant', text: answer, providerName: 'Prueba', modelId: 'modelo-de-prueba' }, { db });
    }
  } finally { db.close(); }
  const bin = path.join(homeDir, 'fixture-bin');
  fs.mkdirSync(bin);
  const script = path.join(bin, 'agy-fixture.cjs');
  fs.writeFileSync(script, `
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('1.2.13'); process.exit(0); }
const read = (flag) => args[args.indexOf(flag) + 1];
if (read('--conversation') !== 'conversation-27' || read('--model') !== 'gemini-3.8-flash-low' || read('--effort') !== 'high') process.exit(2);
fs.writeFileSync(path.join(process.cwd(), 'resume-received.json'), JSON.stringify({args}));
console.log(JSON.stringify({ event: 'step_update', step_update: {conversation_id: 'conversation-27', step_type: 'agent_response', step_index: 1, text_delta: 'Conversación continuada en el perfil de prueba.'} }));
console.log(JSON.stringify({ event: 'result', result: {conversation_id: 'conversation-27', status: 'SUCCESS'} }));
`, 'utf8');
  for (const name of ['agy', 'opencode', 'claude', 'codex']) {
    const body = name === 'agy'
      ? `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`
      : '@echo off\r\necho Motor de prueba no instalado\r\nexit /b 1\r\n';
    fs.writeFileSync(path.join(bin, `${name}.cmd`), body);
  }
  return { PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}` };
}
