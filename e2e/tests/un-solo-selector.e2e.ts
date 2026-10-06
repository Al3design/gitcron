// e2e/tests/un-solo-selector.e2e.ts
//
// Protege contra la regresión del botón repetido: al desplegar la fila de un uso en
// «Motores y modelos», debe existir exactamente un botón «Elegir modelo» dentro de esa fila
// (el de las acciones de la fila, ocultando el propio de AiUseLine).

import { test, expect } from 'e2e';

test('Un solo botón Elegir modelo por fila en Motores y modelos', async ({ app, screen }) => {
  await app.open('/');
  await screen.getByRole('button', 'Configuración').click();
  await screen.getByRole('button', 'Motores y modelos').click();

  const usos = screen.getByRole('button', /Qué modelo usa cada cosa/);
  await usos.click();
  await expect(usos).toHaveAttribute('aria-expanded', 'true');

  const fila = screen.getByTestId('use-row-gitcron-commit');
  await fila.getByRole('button', /Redacción de commit/).click();

  // Con la fila desplegada hay exactamente un botón «Elegir modelo» dentro de ella
  await expect(fila.getByRole('button', 'Elegir modelo')).toHaveCount(1);
});
