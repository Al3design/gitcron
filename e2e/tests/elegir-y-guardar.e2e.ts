// e2e/tests/elegir-y-guardar.e2e.ts
//
// Protege el flujo completo de selección y guardado de modelo para un uso:
// abre el selector en «Redacción de commit», guarda el modelo seleccionado y
// verifica que la fila cerrada refleje el modelo elegido.

import { test, expect } from 'e2e';

test('Elegir y guardar: seleccionar un modelo y verificar que la fila cerrada lo muestre', async ({ app, screen }) => {
  await app.open('/');
  await screen.getByRole('button', 'Configuración').click();
  await screen.getByRole('button', 'Motores y modelos').click();

  const usos = screen.getByRole('button', /Qué modelo usa cada cosa/);
  await usos.click();
  await expect(usos).toHaveAttribute('aria-expanded', 'true');

  const fila = screen.getByTestId('use-row-gitcron-commit');
  const cabeceraFila = fila.getByRole('button', /Redacción de commit/);
  await cabeceraFila.click();

  // Abrir el selector de modelo dentro de la fila
  await fila.getByRole('button', 'Elegir modelo').click();
  const picker = fila.getByTestId('ai-model-picker');
  await expect(picker).toBeVisible();

  // El modelo que ofrece el selector (del primer proveedor disponible)
  const selectModelo = picker.getByLabel('Modelo');
  const modeloElegido = await selectModelo.inputValue();
  expect(modeloElegido.length).toBeGreaterThan(0);

  // Guardar la elección (el botón se llama «Usar este modelo» desde retomar 4.1)
  await picker.getByRole('button', /Usar este modelo|Guardar/i).click();

  // El selector se cierra
  await expect(picker).toBeHidden();

  // Cerrar la fila y verificar que muestra el modelo guardado
  await cabeceraFila.click();
  await expect(cabeceraFila).toHaveAttribute('aria-expanded', 'false');
  await expect(fila).toContainText(modeloElegido);
});
