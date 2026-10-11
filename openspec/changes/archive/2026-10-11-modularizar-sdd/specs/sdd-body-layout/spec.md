# sdd-body-layout

## ADDED Requirements

### Requirement: Cada zona y vista de SDD SHALL ser un módulo propio

La pantalla de SDD SHALL componerse de módulos separados por zona (barra de estado, preparación del commit, encabezado del cambio, cada vista del cambio, cambio archivado, pantallas de inicio). Cada módulo SHALL recibir por props o por un hook con nombre sólo los datos que muestra, y SHALL tener su propio módulo de estilos. Una vista SHALL poder montarse en una prueba sin montar la pantalla entera. La partición NO SHALL cambiar lo que se ve, los textos, los nombres accesibles ni la navegación.

#### Scenario: Probar una vista sola
- **WHEN** una prueba monta la vista Tareas con un cambio de ejemplo
- **THEN** la vista se muestra sin montar la barra de estado, la preparación del commit ni las otras vistas

#### Scenario: Cambio acotado
- **WHEN** una tanda modifica sólo la vista Resumen
- **THEN** los archivos tocados son los de esa vista y sus estilos, y la verificación de lo tocado no arrastra las pruebas de las otras zonas

#### Scenario: Misma pantalla
- **WHEN** se abre un cambio antes y después de la partición
- **THEN** la vista inicial, las entradas del menú de vistas, los textos y los nombres accesibles son los mismos
