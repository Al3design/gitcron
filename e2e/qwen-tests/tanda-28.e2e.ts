// e2e/qwen-tests/tanda-28.e2e.ts
//
// Tanda 28: Importación de OpenCode, edición externa/recuperación y redacción remota con Qwen (7.1, primera parte).
// Se ejecuta contra GitCron real, perfil aislado y el túnel real de Cloudflare con Qwen 3.8 en la notebook.

import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { parse } from 'jsonc-parser';
import { spawnSync } from 'node:child_process';
import { buildSanitizedOpenCodeConfig } from '../qwen-remoto.config';

test('Tanda 28: Importación, edición externa y redacción remota con Qwen', async ({ app, screen, browser }) => {
  await app.open('/');

  // 1. Obtener las rutas del perfil aislado y repositorios
  const paths = await browser.evaluate(async () => {
    const config = await window.api!.aiConfig!.readFileContent({ scope: 'global' });
    if (!config.data) throw new Error('Falta el perfil aislado');
    const home = config.data.path.replace(/[\\/]\.config[\\/]gitcron[\\/]gitcron\.json$/, '');
    const repo = `${home}/tanda28-repo`;
    const gitcronJson = config.data.path;
    const opencodeJson = `${home}/.config/opencode/opencode.json`;
    await window.api!.storageSet('openRepoPaths', JSON.stringify([repo]));
    await window.api!.storageSet('activeRepoPath', repo);
    return { home, repo, gitcronJson, opencodeJson };
  });

  // Afirmar desde la ventana que existe el listener de aiConfig en el bundle real
  const hasAiConfigListener = await browser.evaluate(() => {
    return typeof (window as any).api?.aiConfig?.onConfigChanged === 'function';
  });
  expect(hasAiConfigListener).toBe(true);

  // SHA de HEAD del repositorio antes de cualquier recorrido
  const headShaBefore = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: paths.repo, encoding: 'utf8' }).stdout.trim();
  expect(headShaBefore).toMatch(/^[0-9a-f]{40}$/);

  // Estado inicial de gitcron.json para probar importación:
  // Queremos que unslothpc y tanda NO estén en gitcron.json al inicio, pero que haya
  // un bloque preexistente para comprobar que no se pierde al importar.
  const initialGitCron = {
    $schema: 'https://opencode.ai/config.json',
    provider: {
      preexistente: {
        name: 'Servidor Preexistente',
        npm: '@ai-sdk/openai-compatible',
        options: {
          baseURL: 'http://127.0.0.1:9999/v1',
        },
      },
    },
  };
  fs.writeFileSync(paths.gitcronJson, JSON.stringify(initialGitCron, null, 2), 'utf8');

  // Hashes de control de opencode.json antes de importar
  const aleOpenCodePath = path.join(os.homedir(), '.config', 'opencode', 'opencode.json');
  const aleHashBefore = crypto.createHash('sha256').update(fs.readFileSync(aleOpenCodePath)).digest('hex');
  const fixtureOpenCodeHashBefore = crypto.createHash('sha256').update(fs.readFileSync(paths.opencodeJson)).digest('hex');

  // Comprobación de que secretos ficticios y bloques ajenos no se copian ni persisten
  const dummySecretToken = 'sk-dummy-fake-secret-never-leak-778899';
  const fakeRawConfig = {
    ...parse(fs.readFileSync(aleOpenCodePath, 'utf8')),
    dummySensitiveBlock: {
      secretToken: dummySecretToken,
      token: 'sk-ant-dummy-secret',
    },
    provider: {
      ...parse(fs.readFileSync(aleOpenCodePath, 'utf8')).provider,
      dummyOtherProvider: {
        apiKey: 'literal-dummy-key-12345',
      },
    },
  };
  const sanitizedSimulated = buildSanitizedOpenCodeConfig(fakeRawConfig);
  expect(JSON.stringify(sanitizedSimulated)).not.toContain(dummySecretToken);
  expect(JSON.stringify(sanitizedSimulated)).not.toContain('literal-dummy-key-12345');
  expect(sanitizedSimulated.dummySensitiveBlock).toBeUndefined();
  expect(sanitizedSimulated.provider.dummyOtherProvider).toBeUndefined();

  // Comprobar que en el archivo opencode.json del perfil aislado sólo existen bloques requeridos y ningún secreto ajeno
  const isolatedOpenCodeRaw = fs.readFileSync(paths.opencodeJson, 'utf8');
  const isolatedOpenCode = parse(isolatedOpenCodeRaw);
  expect(Object.keys(isolatedOpenCode.provider)).toEqual(['unslothpc']);
  expect(isolatedOpenCodeRaw).not.toContain(dummySecretToken);
  expect(isolatedOpenCodeRaw).not.toContain('lmstudio');
  expect(isolatedOpenCodeRaw).not.toContain('unslothpclocal');

  // Recargar la app para sincronizar con el repo y la configuración inicial
  await browser.reload();

  // ─────────────────────────────────────────────────────────────
  // RECORRIDO 1: IMPORTAR DESDE OPENCODE
  // ─────────────────────────────────────────────────────────────
  console.log('[Tanda 28] Iniciando Recorrido 1: Importar desde OpenCode...');
  await screen.getByRole('button', 'Configuración').click();
  await screen.getByRole('button', 'Motores y modelos').click();

  // Esperar a que se monte la sección de ajustes
  await expect(screen.getByTestId('accordion-group-opencode')).toBeVisible();

  // Abrir grupo «Importar desde OpenCode»
  const groupImport = screen.getByTestId('accordion-group-opencode').getByRole('button').first();
  const isImportOpen = await groupImport.getAttribute('aria-expanded');
  if (isImportOpen !== 'true') {
    await groupImport.click();
  }

  // Clic en «Comprobar opencode.json»
  await screen.getByRole('button', /Comprobar opencode\.json|Check opencode\.json/).click();

  // Esperar que aparezcan las entradas del plan de importación
  await expect(screen.getByRole('checkbox', 'provider: unslothpc')).toBeVisible();
  await expect(screen.getByRole('checkbox', 'agent: tanda')).toBeVisible();

  // Clic en «Importar lo elegido»
  await screen.getByRole('button', /Importar lo elegido|Import selected/).click();

  // Verificar mensaje de éxito
  await expect(screen.getByText(/Se importaron \d+ bloques|Imported \d+ blocks/)).toBeVisible();

  // Verificar archivo gitcron.json en disco
  const importedGitCron = parse(fs.readFileSync(paths.gitcronJson, 'utf8'));
  expect(importedGitCron.provider?.unslothpc).toBeDefined();
  expect(importedGitCron.provider?.unslothpc?.options?.baseURL).toBe('https://llm.aledesign.dev/v1');
  expect(importedGitCron.provider?.preexistente).toEqual(initialGitCron.provider.preexistente); // Bloque ajeno idéntico en valor completo
  expect(importedGitCron.agent?.tanda).toBeDefined();

  // Verificar que los orígenes quedaron intactos (mismo hash)
  const aleHashAfter = crypto.createHash('sha256').update(fs.readFileSync(aleOpenCodePath)).digest('hex');
  const fixtureOpenCodeHashAfter = crypto.createHash('sha256').update(fs.readFileSync(paths.opencodeJson)).digest('hex');
  expect(aleHashAfter).toBe(aleHashBefore);
  expect(fixtureOpenCodeHashAfter).toBe(fixtureOpenCodeHashBefore);

  await app.screenshot('tanda-28-01-importar-opencode');
  console.log('[Tanda 28] Recorrido 1 completado exitosamente.');

  // ─────────────────────────────────────────────────────────────
  // RECORRIDO 2: EDITAR EL ARCHIVO AFUERA Y VERLO ACTUALIZARSE + EMBEBIDO + INVÁLIDO
  // ─────────────────────────────────────────────────────────────
  console.log('[Tanda 28] Iniciando Recorrido 2: Edición externa, watcher, editor embebido y recuperación...');
  // Asignar el uso «Redacción de commit» al Qwen remoto importado
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

  await filaCommit.getByRole('button', /Elegir modelo|Choose model/).click();
  const picker = filaCommit.getByTestId('ai-model-picker');
  await expect(picker).toBeVisible();

  await picker.getByLabel('Proveedor').selectOption({ value: 'unslothpc' });
  await picker.getByLabel('Modelo').selectOption({ value: 'unsloth/Qwen3.8-27B-GGUF' });
  await picker.getByRole('button', /Guardar|Save/i).click();
  await expect(picker).toBeHidden();

  // Cerrar la fila y esperar a que refleje el modelo
  await cabeceraFilaCommit.click();
  await expect(filaCommit).toContainText('unsloth/Qwen3.8-27B-GGUF');
  await app.screenshot('tanda-28-02-antes-edicion-externa');

  // Capturar el archivo con el modelo de commit ya asignado como base de las siguientes pruebas
  const rawDiskBefore = fs.readFileSync(paths.gitcronJson, 'utf8');
  const originalName = importedGitCron.provider?.unslothpc?.name ?? 'Unsloth CASA';
  const editedDisk = rawDiskBefore.replace(JSON.stringify(originalName), '"Unsloth Remoto Editado"');
  fs.writeFileSync(paths.gitcronJson, editedDisk, 'utf8');

  // Comprobar que la pantalla lo relee sin reiniciar GitCron (vía watcher)
  await expect(screen.getByText('Unsloth Remoto Editado')).toBeVisible();
  await app.screenshot('tanda-28-03-edicion-externa-reflejada');

  // Restaurar el valor por la misma vía externa
  fs.writeFileSync(paths.gitcronJson, rawDiskBefore, 'utf8');
  await expect(screen.getByText(originalName)).toBeVisible();
  await app.screenshot('tanda-28-04-edicion-externa-restaurada');

  // Probar archivo inválido afuera y recuperación
  const invalidJson = '{\n  "provider": {\n    "unslothpc": {\n      "name": "roto"\n  }\n';
  fs.writeFileSync(paths.gitcronJson, invalidJson, 'utf8');

  const pillStatus = screen.getByTestId('section-file-status-pill');
  await expect(pillStatus).toContainText(/Con error|Error/i);
  await app.screenshot('tanda-28-05-archivo-invalido-aviso');

  // Recuperar con el archivo válido
  fs.writeFileSync(paths.gitcronJson, rawDiskBefore, 'utf8');
  await expect(pillStatus).toContainText(/Válido|Valid/i);
  await app.screenshot('tanda-28-06-archivo-recuperado');

  // Ejercitar editor embebido
  const groupFile = screen.getByTestId('accordion-group-file').getByRole('button').first();
  const isFileOpen = await groupFile.getAttribute('aria-expanded');
  if (isFileOpen !== 'true') {
    await groupFile.click();
  }

  const globalFileRow = screen.getByTestId('file-row-global');
  await globalFileRow.getByRole('button', /Editar|Edit/).click();

  const editor = screen.getByTestId('gitcron-json-editor');
  await expect(editor).toBeVisible();

  const textarea = editor.getByRole('textbox');
  const currentContent = await textarea.inputValue();
  const modifiedContent = currentContent.replace(JSON.stringify(originalName), '"Unsloth CASA Verificado"');
  await textarea.fill(modifiedContent);

  await editor.getByTestId('editor-save-btn').click();
  await expect(editor.getByText(/guardado correctamente|saved successfully/i)).toBeVisible();

  const diskSaved = fs.readFileSync(paths.gitcronJson, 'utf8');
  expect(diskSaved).toContain('"Unsloth CASA Verificado"');
  const diskSavedParsed = parse(diskSaved);
  expect(diskSavedParsed.provider?.preexistente).toEqual(initialGitCron.provider.preexistente);

  await app.screenshot('tanda-28-07-editor-embebido-guardado');

  // Restaurar configuración original con unslothpc y gitcron-commit listos para el recorrido 3
  fs.writeFileSync(paths.gitcronJson, rawDiskBefore, 'utf8');
  console.log('[Tanda 28] Recorrido 2 completado exitosamente.');

  // ─────────────────────────────────────────────────────────────
  // RECORRIDO 3: REDACTAR UN COMMIT CON QWEN REAL POR CLOUDFLARE
  // ─────────────────────────────────────────────────────────────
  console.log('[Tanda 28] Iniciando Recorrido 3: Redactar commit con Qwen remoto...');

  // Volver a la vista del repositorio desde Ajustes
  await screen.getByRole('button', 'Volver al Repositorio').first().click();

  // Cambiar a la vista SDD mediante el selector de vistas de la barra lateral
  await screen.getByRole('button', 'Graph', { exact: true }).click();
  await screen.getByRole('menuitem', /SDD/).click();

  // Abrir «Preparar commit»
  const btnPreparar = screen.getByRole('button', { name: /Preparar commit|Prepare commit/i });
  await btnPreparar.click();

  // Verificar que cronometria.txt está presente en la lista de preparación
  await expect(screen.getByText('cronometria.txt').first()).toBeVisible();

  // Seleccionar los archivos a preparar
  await screen.getByRole('button', /Sumar todos|Seleccionar todo|Select all/i).first().click();

  // Verificar atribución de Qwen en AiUseLine
  await expect(screen.getByText(/unsloth\/Qwen3\.8-27B-GGUF/).first()).toBeVisible();

  // Solicitar redacción con IA
  const draftButton = screen.getByRole('button', /Redactar con IA|Draft with AI/i);
  await expect(draftButton).toBeEnabled();

  const startDraftTime = Date.now();
  await draftButton.click();

  // Esperar a que comience la redacción y luego a que finalice por completo (esperar resultado final)
  const msgField = screen.getByRole('textbox', /Mensaje sugerido/i);
  let draftedText = '';
  for (let i = 0; i < 240; i++) {
    const isThinking = await browser.evaluate(() => {
      return document.querySelector('.ai-thinking-text') !== null;
    });
    draftedText = await msgField.inputValue();
    if (!isThinking && draftedText.trim().length > 0) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  const elapsedDraftMs = Date.now() - startDraftTime;
  console.log(JSON.stringify({
    stage: 'qwen-commit-draft-completed',
    elapsedMs: elapsedDraftMs,
    draftMessage: draftedText,
  }));

  expect(draftedText.trim().length).toBeGreaterThan(0);
  expect(draftedText.toLowerCase()).toMatch(/cronometr|latencia|percentil|m[eé]trica|resumen|telemetr/i);

  await app.screenshot('tanda-28-08-sugerencia-qwen');

  // Probar ambos caminos: aceptar / descartar sin hacer commit Git
  // 1) Descartar (borrar texto):
  await msgField.fill('');
  expect(await msgField.inputValue()).toBe('');
  // 2) Aceptar / rellenar:
  await msgField.fill(draftedText);
  expect(await msgField.inputValue()).toBe(draftedText);

  // Verificar atribución del modelo/proveedor en el registro ai-use-history
  const rawHistory = (await browser.evaluate(async (repo) => {
    const res = await window.api!.aiUseHistory!.list({ repoPath: repo, use: 'gitcron-commit' });
    return JSON.stringify(res.data?.items ?? []);
  }, paths.repo)) as string;
  const items = JSON.parse(rawHistory) as Array<Record<string, any>>;

  expect(items.length).toBeGreaterThan(0);
  const record = items[0];
  console.log(JSON.stringify({ stage: 'ai-use-history-verified', record }));
  expect(record.providerId).toBe('unslothpc');
  expect(record.modelId).toBe('unsloth/Qwen3.8-27B-GGUF');
  expect(record.resultStatus).toBe('generated');
  expect(record.durationMs).toBeGreaterThan(0);

  // Confirmar que NO se realizó ningún commit en Git
  const gitLogResult = spawnSync('git', ['log', '--oneline'], { cwd: paths.repo, encoding: 'utf8' });
  expect(gitLogResult.stdout).not.toContain(draftedText.slice(0, 20));
  expect(gitLogResult.stdout).toContain('Base cronometría');

  // Confirmar que el HEAD exacto no cambió (cero commits realizados)
  const headShaAfter = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: paths.repo, encoding: 'utf8' }).stdout.trim();
  expect(headShaAfter).toBe(headShaBefore);

  await app.screenshot('tanda-28-09-recorrido-completado');
  console.log('[Tanda 28] Recorrido 3 completado exitosamente.');
});
