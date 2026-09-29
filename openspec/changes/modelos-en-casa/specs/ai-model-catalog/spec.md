# Spec Delta

## Purpose

Que la persona elija una vez con qué motores y modelos trabaja GitCron —suscripciones por CLI o servidores
por API, propios o externos— y que esa elección valga en todos los usos de IA de la aplicación, con los
secretos cifrados y el destino del contexto siempre declarado.

## ADDED Requirements

### Requirement: Un catálogo común con dos familias de proveedores
GitCron SHALL presentar en un solo catálogo los proveedores de dos familias: *suscripción por CLI*
(Claude Code, Codex y Antigravity, que usan la cuenta con la que la persona inició sesión en cada CLI) y
*API o servidor propio* (OpenRouter, LM Studio, Unsloth y cualquier servidor compatible con la API de
OpenAI). Cada proveedor SHALL declarar a qué familia pertenece, si está disponible en esta máquina y, si
no, el motivo medido. Un CLI no instalado o sin sesión iniciada SHALL figurar con ese motivo, no omitirse.

El fundamento es que la persona ya eligió sus motores fuera de GitCron y hoy la aplicación los conoce por
separado: cada uso tiene su proveedor fijo y el agente de SDD usa lo que su CLI tenga configurado.

#### Scenario: Máquina con suscripciones y servidores propios
- **WHEN** están instalados Claude Code, Codex y Antigravity, y hay proveedores de LM Studio y Unsloth configurados
- **THEN** el catálogo los lista a todos, agrupados por familia, cada uno con su disponibilidad

#### Scenario: CLI instalado sin sesión
- **WHEN** un CLI de suscripción está instalado pero su cuenta no tiene sesión iniciada
- **THEN** figura como no disponible con el motivo y la orden para iniciar sesión, sin ocultarse

### Requirement: Importar proveedores desde la configuración de OpenCode
GitCron SHALL ofrecer importar los proveedores declarados en el bloque `provider` de
`~/.config/opencode/opencode.json`: nombre, URL base, cabeceras, clave y modelos declarados. Antes de
importar SHALL mostrar qué proveedores encontró y qué va a guardar, sin mostrar el valor de ningún secreto.
SHALL NOT modificar el archivo de OpenCode. Un proveedor también SHALL poder darse de alta a mano con los
mismos campos.

#### Scenario: Importación con secretos
- **WHEN** el archivo declara un proveedor con clave y cabeceras de Cloudflare Access
- **THEN** la vista previa lista el proveedor, su URL y los nombres de las cabeceras, con los valores enmascarados, y la importación guarda los secretos cifrados

#### Scenario: Archivo ausente o ilegible
- **WHEN** el archivo no existe o no es JSON válido
- **THEN** se informa cuál de los dos casos es y se ofrece el alta manual, sin afirmar que no hay proveedores

#### Scenario: Reimportar
- **WHEN** se importa de nuevo un proveedor que ya existe en GitCron
- **THEN** se muestra qué campos cambian y se actualiza sólo con confirmación

### Requirement: Los secretos de un proveedor se guardan cifrados y no llegan a la interfaz
Las claves y cabeceras secretas de un proveedor SHALL guardarse cifradas con el almacenamiento seguro del
sistema operativo y SHALL usarse sólo en el proceso principal al armar la petición. La interfaz SHALL
poder saber si un secreto existe y reemplazarlo o borrarlo, y SHALL NOT poder leer su valor.

#### Scenario: Consulta desde la interfaz
- **WHEN** la pantalla de ajustes muestra un proveedor con secretos guardados
- **THEN** indica qué secretos existen, con opciones para reemplazar y borrar cada uno, sin su valor

#### Scenario: Almacenamiento seguro no disponible
- **WHEN** el sistema operativo no ofrece cifrado
- **THEN** no se guarda el secreto en claro y se informa el motivo

### Requirement: Cada proveedor lista sus modelos y admite alta manual
El catálogo SHALL obtener los modelos de cada proveedor de su fuente en el momento: la lista del servidor
para los compatibles con OpenAI, la del CLI cuando la expone y la del servicio para OpenRouter. Cuando la
fuente no responde o no lista, SHALL permitir escribir el identificador del modelo a mano. El criterio de
inclusión de modelos de texto que ya rige para la redacción (sólo tipo `llm` cuando el servidor informa
el tipo) SHALL aplicarse igual en el catálogo común.

#### Scenario: Servidor que responde
- **WHEN** se abre la lista de modelos de un servidor compatible con OpenAI que responde
- **THEN** se muestran los modelos que devolvió en ese momento

#### Scenario: Servidor apagado
- **WHEN** el servidor no responde
- **THEN** se informa que no respondió, se muestran los modelos declarados al importar como no confirmados y se permite escribir uno a mano

### Requirement: Una elección por omisión con excepciones visibles por uso
GitCron SHALL guardar una elección por omisión de proveedor y modelo, y SHALL permitir una excepción por
uso: redacción de commit, Cartografía, análisis de versión de OpenSpec, Temporal Agent y agente de SDD.
Cada uso SHALL poder preferir un modelo rápido o uno de razonamiento. El proveedor y el modelo efectivos
de un uso SHALL verse en la pantalla donde ese uso ocurre; una excepción SHALL NOT quedar visible sólo en
ajustes.

#### Scenario: Elección sin excepciones
- **WHEN** hay una elección por omisión y ningún uso tiene excepción
- **THEN** todos los usos usan ese proveedor y ese modelo, y cada pantalla lo nombra

#### Scenario: Excepción en un uso
- **WHEN** Temporal Agent tiene una excepción que elige un modelo de suscripción por CLI
- **THEN** Temporal Agent usa ese modelo, su pantalla lo nombra como excepción, y los demás usos siguen con la elección por omisión

### Requirement: El destino del contexto se declara y no hay caída silenciosa a un servicio externo
Antes de mandar contenido del repositorio a un modelo, la pantalla SHALL declarar adónde va: esta
máquina, un servidor propio en otra máquina o un servicio externo. Si el proveedor elegido no responde,
GitCron SHALL informarlo y SHALL NOT pasar a otro proveedor sin una acción humana. La única alternancia
automática permitida es entre direcciones declaradas del mismo proveedor.

#### Scenario: Servidor propio apagado con un servicio externo configurado
- **WHEN** el proveedor elegido es un servidor propio que no responde y OpenRouter también está configurado
- **THEN** se informa que el servidor no respondió y no se manda nada a OpenRouter

#### Scenario: Destino externo
- **WHEN** el uso tiene elegido un proveedor externo
- **THEN** la pantalla lo nombra como servicio externo antes de mandar el contenido

### Requirement: Un mismo proveedor puede tener una dirección local y una remota
Un proveedor SHALL poder declarar una dirección local y una remota del mismo servidor (por ejemplo la red de
la casa y un túnel). Al usarlo, GitCron SHALL probar primero la local con un límite de tiempo corto y, si no
responde, la remota, y SHALL decir cuál usó. Dos proveedores importados que difieren sólo en la URL SHALL
poder unirse en uno con dos direcciones, con confirmación.

#### Scenario: En la PC de la casa
- **WHEN** la dirección local responde
- **THEN** se usa la local y la pantalla dice «local»

#### Scenario: Fuera de casa
- **WHEN** la dirección local no responde dentro del límite y la remota sí
- **THEN** se usa la remota y la pantalla dice «remoto»

### Requirement: El lanzador de SDD manda el modelo elegido
Al lanzar un agente desde SDD, GitCron SHALL pasarle el modelo efectivo del uso «agente de SDD». Los
proveedores de API o servidor propio SHALL lanzarse como agente a través de OpenCode, con ese proveedor y
ese modelo. La confirmación de lanzamiento SHALL nombrar el motor y el modelo.

#### Scenario: Agente de suscripción con modelo elegido
- **WHEN** se lanza Codex con un modelo elegido
- **THEN** la sesión arranca con ese modelo y la confirmación lo nombra

#### Scenario: Agente sobre un servidor propio
- **WHEN** el uso «agente de SDD» tiene elegido un modelo de Unsloth
- **THEN** la sesión se lanza con OpenCode usando ese proveedor y ese modelo

#### Scenario: OpenCode ausente
- **WHEN** el modelo elegido es de un servidor propio y OpenCode no está instalado
- **THEN** el lanzador informa que hace falta OpenCode para usarlo como agente, sin lanzar otro motor en su lugar

### Requirement: Los controles de carga aparecen sólo donde el proveedor los tiene
Cargar, expulsar, elegir contexto y tiempo de vida de un modelo SHALL ofrecerse sólo para proveedores que
declaran esa capacidad. Con un proveedor que no la tiene, esos controles SHALL NOT mostrarse
deshabilitados como si faltara algo.

#### Scenario: Proveedor sin carga explícita
- **WHEN** el modelo elegido es de OpenRouter o de un CLI de suscripción
- **THEN** el panel no muestra los controles de carga y expulsión
