import { expect } from 'e2e';
import { test } from '@e2e-dev/web';
import * as fs from 'node:fs';

test('Continuar una conversación: historial real, foco, canal y modelo original', async ({ app, screen, browser }) => {
  await app.open('/');
  const repoPath = await browser.evaluate(async () => {
    const result = await window.api!.aiConfig!.readFileContent({ scope: 'global' });
    if (!result.success || !result.data) throw new Error('Falta la configuración aislada');
    // config: <perfil>/home/.config/gitcron/gitcron.json → <perfil>/home/resume-repo.
    const home = result.data.path.replace(/[\\/]\.config[\\/]gitcron[\\/]gitcron\.json$/, '');
    const repo = `${home}/resume-repo`;
    await window.api!.storageSet('openRepoPaths', JSON.stringify([repo]));
    await window.api!.storageSet('activeRepoPath', repo);
    return repo;
  });
  await browser.reload();
  await screen.getByRole('button', 'Graph', { exact: true }).click();
  await screen.getByRole('menuitem', /SDD/).click();
  const trigger = screen.getByRole('button', 'Continuar esta sesión');
  await expect(trigger).toBeVisible();
  await trigger.click();
  const input = screen.getByRole('textbox', 'Instrucción');
  await expect(input).toBeFocused();
  await expect(screen.getByRole('form', 'Continuar sesión')).toContainText('gemini-3.8-flash-low (high)');
  await app.screenshot('tanda-27-formulario');
  await input.press('Escape');
  await expect(trigger).toBeFocused();
  await trigger.click();
  await input.fill('Continuá la conversación de prueba');
  await screen.getByRole('button', 'Continuar', { exact: true }).click();
  await expect(screen.getByText('Conversación continuada en el perfil de prueba.', { exact: true })).toBeVisible();
  await expect(screen.getByText(/^continúa la sesión de /)).toBeVisible();
  const projection = await browser.evaluate(async (repo) => {
    const result = await window.api!.pipelineRuntime.get(repo);
    if (!result.success || !result.data) throw new Error('Falta la sesión continuada');
    return { runtime: result.data.runtime, model: result.data.requestedModel ?? null, effort: result.data.reasoningEffort ?? null, parent: result.data.continuesSessionId ?? null, toolId: result.data.runtimeSessionId ?? null };
  }, repoPath);
  expect(projection).toEqual({ runtime: 'agy', model: 'gemini-3.8-flash-low', effort: 'high', parent: 'parent-session', toolId: 'conversation-27' });
  const received = JSON.parse(fs.readFileSync(`${repoPath}/resume-received.json`, 'utf8')) as { args: string[] };
  expect(received.args).toContain('--conversation');
  expect(received.args).toContain('conversation-27');
  await app.screenshot('tanda-27-continuacion');
  const runtimeNameFits = await browser.evaluate(() => {
    const labels = document.querySelectorAll<HTMLElement>('[data-testid="repo-details-panel"] header strong');
    const name = Array.from(labels).find((label) => label.textContent === 'Antigravity');
    return Boolean(name && name.clientWidth >= name.scrollWidth);
  });
  expect(runtimeNameFits).toBe(true);
});
