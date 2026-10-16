import { expect } from 'e2e';
import { test } from '@e2e-dev/web';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

// Aceptación de retomar-trabajo-con-asistencia-contextual (tarea 4.1): volver a un cambio
// después de una ausencia, ver dónde quedó y qué sigue sin IA, recuperar una conversación
// sin que nada se mande al modelo, y que otro repositorio no vea esa conversación.
// El perfil de prueba no tiene ningún modelo configurado: todo esto anda sin IA.

function git(cwd: string, args: string[]): void {
  const result = spawnSync('git', args, {
    cwd, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
  });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
}

test('Retomar tras una ausencia: dónde quedó, qué sigue, conversación recuperada y repos separados', async ({ app, screen, browser }) => {
  await app.open('/');
  const home = await browser.evaluate(async () => {
    const result = await window.api!.aiConfig!.readFileContent({ scope: 'global' });
    if (!result.success || !result.data) throw new Error('Falta la configuración aislada');
    return result.data.path.replace(/[\\/]\.config[\\/]gitcron[\\/]gitcron\.json$/, '');
  });

  // Un cambio de SDD a medio hacer en el repo de prueba, y un segundo repo sin conversaciones.
  const repo = path.join(home, 'resume-repo');
  const change = path.join(repo, 'openspec', 'changes', 'probar-retomar');
  fs.mkdirSync(change, { recursive: true });
  fs.writeFileSync(path.join(change, 'proposal.md'), '## Why\n\nPoder volver a un trabajo después de unos días sin releer todo.\n', 'utf8');
  fs.writeFileSync(path.join(change, 'tasks.md'), '## 1. Recorrido\n\n- [x] 1.1 Guardar las conversaciones\n- [ ] 1.2 Mostrar dónde quedaste\n', 'utf8');
  const other = path.join(home, 'otro-repo');
  fs.mkdirSync(other, { recursive: true });
  git(other, ['init']);
  git(other, ['-c', 'user.name=Prueba', '-c', 'user.email=prueba@example.invalid', 'commit', '--allow-empty', '-m', 'Otro repositorio']);

  await browser.evaluate(async ([a, b]) => {
    await window.api!.storageSet('openRepoPaths', JSON.stringify([a, b]));
    await window.api!.storageSet('activeRepoPath', a);
    return true;
  }, [`${home}/resume-repo`, `${home}/otro-repo`] as [string, string]);
  await browser.reload();
  await screen.getByRole('button', 'resume-repo', { exact: true }).click();
  await expect(screen.getByText('Repositorio de prueba')).toBeVisible();

  // Cuántos mensajes hay guardados: si algo se mandara solo al modelo, este número crecería.
  const countMessages = () => browser.evaluate(async (repoPath) => {
    const api = window.api!.assistConversations!;
    const list = await api.list({ repoPath });
    if (!list.success || !list.data) throw new Error('No se pudo leer la lista');
    let total = 0;
    for (const c of list.data) {
      const detail = await api.get({ repoPath, conversationId: c.id });
      total += detail.success && detail.data ? detail.data.messages.length : 0;
    }
    return { conversations: list.data.length, total };
  }, `${home}/resume-repo`);
  const before = await countMessages();
  expect(before.conversations).toBe(3);

  // 1. Dónde quedó y qué sigue, sin IA.
  await screen.getByRole('button', 'Graph', { exact: true }).click();
  await screen.getByRole('menuitem', /SDD/).click();
  await screen.getByText('probar-retomar', { exact: true }).click();
  const card = screen.getByRole('region', 'Dónde quedaste');
  await expect(card).toBeVisible();
  await expect(card).toContainText('1.2 Mostrar dónde quedaste');
  await expect(screen.getByRole('button', /Explicarme este resumen/)).toBeVisible();
  await app.screenshot('01-donde-quedaste');

  // 2. La conversación se recupera tal cual.
  await screen.getByRole('button', 'Abrir panel de asistencia').click();
  await screen.getByText('Qué falta en retomar', { exact: true }).click();
  await expect(screen.getByText(/Faltan la/)).toBeVisible();
  await app.screenshot('02-conversacion-recuperada');

  // 3. Reabrir la app: la conversación sigue elegida y nada se mandó al modelo.
  await browser.reload();
  await expect(screen.getByText(/Faltan la/)).toBeVisible();
  expect(await countMessages()).toEqual(before);

  // 4. Otro repositorio no ve esa conversación.
  await screen.getByText('otro-repo', { exact: true }).click();
  await expect(screen.getByText('Todavía no hay conversaciones en este repositorio.')).toBeVisible();
  const otherList = await browser.evaluate(async (repoPath) => {
    const list = await window.api!.assistConversations!.list({ repoPath });
    return list.success && list.data ? list.data.length : -1;
  }, `${home}/otro-repo`);
  expect(otherList).toBe(0);
  await app.screenshot('03-otro-repo-sin-conversaciones');

  expect(await countMessages()).toEqual(before);
});
