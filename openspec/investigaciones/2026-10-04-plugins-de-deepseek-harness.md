# Plugins al estilo de DeepSeek Harness: qué hace y qué le sirve a GitCron

Investigación pedida por Ale el 2026-10-04: «me interesa la idea de que se puedan agregar cosas por separado, en
GitCron». Leído en el repositorio [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness)
(rama `master`, último cambio el 2026-10-03, licencia MIT, en vista previa para desarrolladores y con cambios que
rompen compatibilidad) y en su documentación de arquitectura, de Cordis y del administrador de plugins. No es una
propuesta: es la base para decidir si se abre un cambio después de modelos-en-casa.

## Qué es

DeepSeek Harness (`dsh`) es el «arnés» de un agente: lo que rodea al modelo y le da herramientas, sesiones,
archivos y pantalla. Salió el 13 de agosto de 2026. Su apuesta es que **todo es un plugin**, también las piezas
centrales: el adaptador del modelo, el registro de herramientas, el historial de la sesión y el propio bucle del
agente. No hay un núcleo que se modifique por dentro: se agrega un plugin al lado de los otros, y cualquiera se
puede reemplazar desde la configuración. Tiene una aplicación web, una de terminal, un SDK y una **aplicación de
escritorio en Electron**, como GitCron.

## Cómo funciona por dentro (Cordis)

Debajo hay un marco de plugins llamado [Cordis](https://github.com/cordiverse/cordis) (MIT). Cinco ideas:

1. **Un plugin es una función `apply(ctx)`** (o una clase `Service`). Recibe un contexto y registra cosas en él.
2. **El contexto es un depósito de servicios con nombre**: `ctx.tools`, `ctx.llm`, `ctx.sessions`. Un plugin no
   importa la implementación de otro: pide el servicio por su nombre.
3. **Las dependencias se declaran con `inject`**: un plugin que pide `['tools']` espera a que exista ese servicio.
   El orden de arranque sale solo de lo que cada uno pide; no hay una secuencia escrita a mano.
4. **Se hablan por eventos con tipo**, y cada evento dice cómo se reparte: avisar a todos, pasar por una cadena
   donde cada uno puede modificar o cortar (`waterfall`), en paralelo, en orden, o hasta que uno responda.
5. **Todo registro se puede deshacer**: lo que un plugin agrega (una herramienta, un adaptador, un escuchador) queda
   atado a él. Al apagarlo o recargarlo, se quita solo. Eso permite prender y apagar plugins sin reiniciar.

Las piezas que se pueden cambiar se diseñan en tres papeles: la **definición** (qué ofrece la capacidad), el
**proveedor** (una implementación) y el **consumidor** (quien la usa). Por ejemplo, si el proveedor de archivos y
el de procesos apuntan a un sandbox remoto, Bash, la terminal y el LSP se mudan con ellos sin tocar nada más.

## Cómo se arma y cómo se agrega un plugin

- **Por capas de configuración.** Al arrancar se arma un árbol de plugins: el **perfil** (`web`, `headless`, `sdk`,
  `acp`, `desktop`) lista los **bundles** que apila; cada bundle es un paquete npm que trae su código y sus filas
  de configuración; después se aplican los parches `cordis.patch.yml` del perfil, del usuario y de la orden. Cada
  fila tiene `id`, `disabled` y `config`; un parche reemplaza una fila por su `id` o agrega una nueva.
  `dsh --profile web --dump-config` muestra el árbol que arranca.
- **Instalar es instalar un paquete npm** en la carpeta del perfil, con pnpm. La aplicación de escritorio trae su
  propio pnpm, así que no hace falta tenerlo instalado.
- **Administrador de plugins**: una página en la barra lateral y una herramienta para el agente (con aprobación
  en cada uso) que **revisan antes de instalar** (nombre, versión, si es un bundle), instalan, prenden o apagan
  fila por fila y quitan. Si algo falla, vuelven `package.json` y el lockfile como estaban.
- **Compatibilidad**: cada plugin declara con qué versión de `dsh` anda; uno incompatible se rechaza antes de bajar
  nada. Se puede forzar, una versión exacta por vez, aceptando el riesgo de forma explícita.
- **Scripts de instalación bloqueados** hasta que la persona los aprueba, paquete por paquete.
- **Pantalla**: un plugin de interfaz se enchufa en **slots**, lugares con nombre que cada vista declara (por
  ejemplo `tool.call.toolview`). Un plugin sólo dibuja en los slots que declara, y sus textos van en
  `locale/en.json` y `locale/zh.json`.
- **Descubrimiento**: los plugins de la comunidad se marcan con el tema `dsh-plugin` en GitHub; hay uno que busca
  plugins y propone cómo instalarlos.
- **MCP es un plugin más**: `mcp-client` conecta un servidor MCP y suma sus herramientas al agente.

## El costo que asume

**El código de un plugin instalado corre dentro del mismo proceso, fuera del sandbox, con los permisos de la
persona.** dsh lo dice así en su documentación: es confianza total. Lo compensa con la revisión previa, la
comprobación de versión y la aprobación de scripts, pero un plugin malicioso o roto puede leer cualquier cosa.

## Qué le sirve a GitCron

GitCron ya tiene, sin llamarlos así, varios lugares donde «se agregan cosas por separado»: los adaptadores de
runtime de Pipeline (Claude, Codex, OpenCode, Antigravity), los proveedores y usos de `gitcron.json`, y los
servidores de `mcp.json`. La idea de dsh se puede tomar en tres niveles, de menos a más riesgo:

1. **Plugins sin código (seguros).** Lo que se agrega es configuración o texto: proveedores y usos de IA (ya está),
   servidores MCP (ya está el archivo; falta que GitCron los use), y podrían sumarse instrucciones de Pipeline,
   perfiles del Agente Temporal o habilidades para los agentes. No corren código dentro de GitCron.
2. **Puntos de extensión adentro de GitCron** (lo más valioso de dsh, sin abrir la puerta a terceros). Rehacer de a
   una las piezas que ya son intercambiables como «plugins internos» con registro, dependencias declaradas y
   registros que se deshacen solos: los adaptadores de runtime, los proveedores de IA, y **slots en las pantallas**
   (barra lateral, inspector del commit, Cartografía). Los slots son también el camino natural para la idea de Ale
   de «una IA en todas las pantallas» que sabe en qué repositorio está.
3. **Plugins de terceros con código** (como dsh). En GitCron el riesgo es mayor que en dsh: el proceso principal
   tiene el baúl de claves, acceso a todos los repositorios autorizados y puede hacer `git push`. Si se llega acá,
   no en el mismo proceso: cada plugin en un proceso aparte (`utilityProcess` de Electron) que sólo habla con
   GitCron por canales con permisos declarados y aprobados, y su pantalla aislada. Con la revisión previa, la
   compatibilidad de versión y la aprobación de scripts de dsh.

**Recomendación:** no adoptar Cordis entero ni abrir plugins de terceros ahora. Después de modelos-en-casa, un
cambio chico que haga del nivel 2 una sola pieza (los adaptadores de runtime de Pipeline, que ya tienen registro y
descriptor) y mida cuánto cuesta; y que GitCron use los servidores de `mcp.json`, que ya son «plugins» del estándar,
corren en su propio proceso y los eligió la persona. Con eso a la vista se decide si Cordis conviene como base.

## Fuentes

- [README de DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) y
  [arquitectura](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)
- [Introducción a Cordis](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-primer.md)
- [Administrador de plugins](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/boot/plugin-manager/README.md)
- [Reglas de los paquetes](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/AGENTS.md),
  [cómo agregar un paquete](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-a-package.md)
  y [reglas de la interfaz y los slots](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/AGENTS.md)
- [Aplicación de escritorio](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/README.md)
- [Grupo MCP](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/mcp/README.md)
- [The New Stack sobre los plugins de DeepSeek Harness](https://thenewstack.io/deepseek-harness-open-source-plugins/)
