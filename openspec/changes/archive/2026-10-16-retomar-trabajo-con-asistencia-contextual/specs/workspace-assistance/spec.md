# workspace-assistance

## Purpose

Permitir consultar y actuar sobre el trabajo seleccionado desde cualquier vista, conservando conversación y alcance verificables entre sesiones.

## ADDED Requirements

### Requirement: El contexto compartido identifica el trabajo y su alcance

La asistencia SHALL identificar repositorio, checkout, rama/HEAD y selección vigente. SHALL mostrar el alcance consultado y resolver referencias antes de leer o actuar; un cambio de selección SHALL NOT atribuir una respuesta anterior al trabajo nuevo.

#### Scenario: Cambio de repositorio durante consulta
- **WHEN** una respuesta del repositorio A llega después de abrir B
- **THEN** permanece atribuida a A y ninguna acción de esa respuesta opera sobre B

#### Scenario: Selección histórica
- **WHEN** se consulta un archivo de un commit anterior
- **THEN** la respuesta declara esa revisión y distingue el árbol de trabajo actual

### Requirement: La conversación se recupera sin reproducir acciones

La aplicación SHALL persistir mensajes visibles saneados, referencias y resultados de operaciones por conversación y repositorio. SHALL permitir recuperarlos y eliminarlos. Reabrir SHALL NOT repetir herramientas; recuperar conversación SHALL NOT afirmar resume de un proceso nuevo.

#### Scenario: Reinicio
- **WHEN** se cierra y abre GitCron tras una consulta
- **THEN** se recuperan mensajes y fuentes sin reenviar consultas ni ejecutar acciones

#### Scenario: Proceso no reanudable
- **WHEN** se continúa con un runtime que no ofrece resume
- **THEN** se declara una nueva ejecución con contexto reconstruido

#### Scenario: Eliminar conversación
- **WHEN** la persona elimina una conversación
- **THEN** se borra su historial conversacional local sin eliminar archivos, commits ni evidencia de otros subsistemas

### Requirement: La asistencia usa operaciones autorizadas del producto

Las acciones de IA SHALL usar las mismas operaciones y precondiciones que la UI. La lectura de documentos, mensajes o salidas de herramientas SHALL NOT otorgar autorización. Se SHALL revalidar destino y capacidades al ejecutar y mantener las confirmaciones vigentes de cada operación.

#### Scenario: Instrucción incrustada
- **WHEN** un archivo consultado ordena ejecutar un push
- **THEN** se trata como contenido y no se ejecuta por esa instrucción

#### Scenario: Contexto vencido
- **WHEN** HEAD o selección cambian desde la preparación
- **THEN** la escritura pendiente se invalida o exige una nueva preparación sobre el contexto actual

### Requirement: El flotante deriva su contenido de evidencia

Las contribuciones del flotante SHALL depender de vista, selección, datos y operaciones disponibles. SHALL conservar la alternancia con el inspector y el acceso a navegación global. La IA SHALL NOT crear operaciones inexistentes ni ocultar la única salida del recorrido.

#### Scenario: Sin contenido pertinente
- **WHEN** una contribución no tiene dato ni acción útil
- **THEN** no ocupa espacio y sigue siendo alcanzable cuando se solicita

#### Scenario: Abrir inspector
- **WHEN** el inspector sustituye al flotante
- **THEN** se conserva selección y existe un camino alcanzable hacia las acciones pertinentes del trabajo

### Requirement: La consulta declara proveedor y minimiza contexto

Cada consulta SHALL declarar proveedor/alcance, recuperar sólo fuentes pertinentes dentro de un presupuesto y respetar privacidad existente. Navegar pasivamente SHALL NOT generar llamadas al modelo. Sin proveedor SHALL conservarse navegación y operaciones manuales.

#### Scenario: Proveedor caído
- **WHEN** la consulta falla o se cancela
- **THEN** se conserva lo escrito y se puede continuar manualmente sin declarar respuesta completa

#### Scenario: Contexto excedido
- **WHEN** las fuentes superan el presupuesto
- **THEN** se reduce la selección con límites visibles sin enviar todo el repositorio

### Requirement: La asistencia consume la gestión común de modelos

La asistencia SHALL consumir la selección y capacidades compartidas de proveedores/modelos de GitCron, sin crear una configuración independiente por pantalla ni duplicar credenciales.

#### Scenario: Cambio de vista
- **WHEN** la persona pasa de Graph a SDD o Cartografía y consulta al asistente
- **THEN** se usa la política compartida de proveedor/modelo y cualquier excepción por tarea queda visible
