// e2e/tests/arranque.e2e.ts
//
// Protege la pantalla de bienvenida de GitCron en un perfil nuevo sin repositorios:
// deben verse las opciones iniciales («Abrir existente», «Crear nuevo», «Clonar de GitHub»)
// y ninguna clave de traducción sin resolver (evita el fallo de claves en crudo como startScreen.welcome).

import { test, expect } from 'e2e';

test('Pantalla de inicio: muestra acciones iniciales y ninguna clave de traducción sin resolver', async ({ app, screen }) => {
  await app.open('/');

  // Sin repositorios se ven las tres acciones de bienvenida
  await expect(screen.getByText(/Abrir existente/i)).toBeVisible();
  await expect(screen.getByText(/Crear nuevo/i)).toBeVisible();
  await expect(screen.getByText(/Clonar de GitHub/i)).toBeVisible();

  // No debe aparecer ningún texto con forma de clave de traducción (ej: startScreen.welcome)
  await expect(screen.getByText(/^[a-z]+\.[A-Za-z.]+$/)).toHaveCount(0);
});
