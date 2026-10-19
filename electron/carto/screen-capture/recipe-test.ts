// electron/carto/screen-capture/recipe-test.ts
//
// Generador de la prueba e2e temporal a partir de las recetas de capturas (decisión 13).

import type { CaptureRecipes, RecipeStep, RecipeTarget } from './recipes';

export interface ShotMapping {
  shot: string;
  screenId: string;
}

function escapeRepoPathForJsString(repoPath: string): string {
  const normalized = repoPath.replace(/\\/g, '/');
  return normalized
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"');
}

function translateTarget(target: RecipeTarget): string {
  if ('testId' in target) {
    return `screen.getByTestId(${JSON.stringify(target.testId)})`;
  }
  if ('text' in target) {
    return `screen.getByText(${JSON.stringify(target.text)})`;
  }
  if ('role' in target) {
    if (target.nameMatches) {
      return `screen.getByRole(${JSON.stringify(target.role)}, new RegExp(${JSON.stringify(target.nameMatches)}))`;
    }
    if (target.name) {
      return `screen.getByRole(${JSON.stringify(target.role)}, ${JSON.stringify(target.name)})`;
    }
    return `screen.getByRole(${JSON.stringify(target.role)})`;
  }
  throw new Error('Destino desconocido');
}

function translateStep(step: RecipeStep, escapedRepoPath: string): string {
  if ('click' in step) {
    const targetExpr = translateTarget(step.click);
    return `await ${targetExpr}.click();`;
  }
  if ('waitFor' in step) {
    const targetExpr = translateTarget(step.waitFor);
    const timeout = step.timeoutMs ?? 30000;
    return `await expect(${targetExpr}).toBeVisible({ timeout: ${timeout} });`;
  }
  if ('pause' in step) {
    return `await pausa(${step.pause});`;
  }
  if ('reload' in step) {
    return `await browser.reload();`;
  }
  if ('evaluate' in step) {
    const code = step.evaluate.replaceAll('{{repoPath}}', escapedRepoPath);
    return `await browser.evaluate(${code});`;
  }
  throw new Error('Paso desconocido');
}

export function buildRecipeTest(
  recipes: CaptureRecipes,
  screens: { id: string; name: string }[],
  repoPath: string,
): { code: string; shots: ShotMapping[] } {
  const escapedRepo = escapeRepoPathForJsString(repoPath);
  const shots: ShotMapping[] = [];

  const screenBlocks: string[] = [];

  for (let idx = 0; idx < screens.length; idx++) {
    const screen = screens[idx];
    const shotName = `cap-${idx + 1}`;
    shots.push({ shot: shotName, screenId: screen.id });

    // GitCron lee estas líneas mientras corre la prueba para mostrar el avance (decisión 14).
    const lines: string[] = [];
    lines.push(`    console.log('GITCRON_RECIPE_START', ${JSON.stringify(screen.id)});`);
    lines.push(`    await app.open('/');`);

    // 1. Setup steps
    for (let sIdx = 0; sIdx < recipes.setup.length; sIdx++) {
      const step = recipes.setup[sIdx];
      lines.push(`    paso = ${JSON.stringify(`setup ${sIdx + 1}`)};`);
      lines.push(`    ${translateStep(step, escapedRepo)}`);
    }

    // 2. Screen steps
    const screenRecipe = recipes.screens[screen.id];
    const screenSteps = screenRecipe?.steps ?? [];
    for (let stIdx = 0; stIdx < screenSteps.length; stIdx++) {
      const step = screenSteps[stIdx];
      lines.push(`    paso = ${JSON.stringify(`paso ${stIdx + 1}`)};`);
      lines.push(`    ${translateStep(step, escapedRepo)}`);
    }

    // 3. Pausa 1500 ms y captura
    lines.push(`    paso = 'pausa';`);
    lines.push(`    await pausa(1500);`);
    lines.push(`    paso = 'captura';`);
    lines.push(`    await app.screenshot(${JSON.stringify(shotName)});`);
    lines.push(`    console.log('GITCRON_RECIPE_DONE', ${JSON.stringify(screen.id)});`);

    // `paso` se declara fuera del try, en un bloque propio de la pantalla: si quedara dentro, el
    // catch no la vería y una receta rota cortaría la prueba entera («paso is not defined»,
    // medido en la auditoría de carto-05d).
    const block = [
      `  // Pantalla ${idx + 1}: ${screen.name} (${screen.id})`,
      `  {`,
      `  let paso = 'inicio';`,
      `  try {`,
      lines.join('\n'),
      `  } catch (err) {`,
      `    const msg = (err instanceof Error ? err.message : String(err)).replace(/[\\r\\n]+/g, ' ').trim();`,
      `    console.log('GITCRON_RECIPE_FAIL', ${JSON.stringify(screen.id)}, \`\${paso}: \${msg}\`);`,
      `  }`,
      `  }`,
    ].join('\n');

    screenBlocks.push(block);
  }

  const code = [
    `// Prueba temporal generada automáticamente por GitCron para capturar vistas.`,
    `import { expect } from 'e2e';`,
    `import { test } from '@e2e-dev/web';`,
    ``,
    `const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));`,
    ``,
    `test('gitcron-capturas', { timeout: 1_800_000 }, async ({ app, screen, browser }) => {`,
    screenBlocks.join('\n\n'),
    `});`,
    ``,
  ].join('\n');

  return { code, shots };
}
