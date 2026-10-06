// e2e/tests/motores-y-modelos.e2e.ts
//
// Protege el orden de los grupos de «Motores y modelos» y la ubicación del selector de modelos:
// «Proveedores y modelos» debe estar primero y abierto por omisión, «Qué modelo usa cada cosa»
// debe estar cerrado y, al desplegar la fila de «Redacción de commit» y pedir «Elegir modelo»,
// el selector debe aparecer embebido dentro de la fila del uso (no suelto al final de la página).

import { test, expect } from 'e2e';

test('Motores y modelos: grupos en orden y el selector se abre dentro del uso', async ({ app, screen }) => {
  await app.open('/');
  await screen.getByRole('button', 'Configuración').click();
  await screen.getByRole('button', 'Motores y modelos').click();

  // «Proveedores y modelos» primero y abierto; «Qué modelo usa cada cosa» después, cerrado.
  const proveedores = screen.getByRole('button', /Proveedores y modelos/);
  const usos = screen.getByRole('button', /Qué modelo usa cada cosa/);
  await expect(proveedores).toHaveAttribute('aria-expanded', 'true');
  await expect(usos).toHaveAttribute('aria-expanded', 'false');

  // Abrir el grupo de usos, desplegar la redacción de commit y pedir el selector desde su fila.
  await usos.click();
  await expect(usos).toHaveAttribute('aria-expanded', 'true');
  const fila = screen.getByTestId('use-row-gitcron-commit');
  await fila.getByRole('button', /Redacción de commit/).click();
  await fila.getByRole('button', 'Elegir modelo').click();

  // El selector aparece dentro de la fila del uso, no al final de la página.
  await expect(fila.getByTestId('ai-model-picker')).toBeVisible();
  await expect(fila.getByLabel('Proveedor')).toBeVisible();
  await expect(fila.getByLabel('Modelo')).toBeVisible();
});
