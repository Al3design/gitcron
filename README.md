# GitCron - Advanced Git Client

Desktop Git client built with modern web tooling. GitCron is meant to cover a personal GitKraken-like workflow without a subscription, with a strong focus on visual history, safe Git operations, and GitHub integration.

<p align="center">
  <img alt="GitCron version" src="https://img.shields.io/badge/GitCron-v1.19.0-fd9d1a?style=for-the-badge&amp;labelColor=2c3440">
  <img alt="Windows installer" src="https://img.shields.io/badge/Windows-installer-5ed8ff?style=for-the-badge&amp;labelColor=2c3440">
  <img alt="macOS DMG" src="https://img.shields.io/badge/macOS-DMG-5ed8ff?style=for-the-badge&amp;labelColor=2c3440">
  <img alt="Linux AppImage" src="https://img.shields.io/badge/Linux-AppImage-5ed8ff?style=for-the-badge&amp;labelColor=2c3440">
</p>

<p align="center">
  <img alt="Next.js version" src="https://img.shields.io/badge/Next.js-15-111827?style=flat-square&amp;labelColor=4b5563">
  <img alt="React version" src="https://img.shields.io/badge/React-19-5ed8ff?style=flat-square&amp;labelColor=4b5563">
  <img alt="Electron version" src="https://img.shields.io/badge/Electron-42-a3f185?style=flat-square&amp;labelColor=4b5563">
  <img alt="TypeScript version" src="https://img.shields.io/badge/TypeScript-5.9-3178c6?style=flat-square&amp;labelColor=4b5563">
  <img alt="Node.js requirement" src="https://img.shields.io/badge/Node.js-22%2B-8cc84b?style=flat-square&amp;labelColor=4b5563">
</p>

---

## Stack

| Layer           | Tech            |
| --------------- | --------------- |
| UI framework    | Next.js 15      |
| UI library      | React 19        |
| Desktop runtime | Electron 42     |
| State           | Zustand 5       |
| Language        | TypeScript 5.9  |
| Git backend     | simple-git 3    |
| GitHub API      | Octokit REST 22 |
| Styling         | Tailwind CSS 4  |
| Motion          | Motion          |
| Icons           | Lucide React    |

---

## What GitCron does today

### 🟢 Core & Vista Clásica (Classic View) - Estable

#### Repositories

- Open any existing Git repo from a native OS dialog. GitCron requires the selected folder to be the repository root, so a nested folder is never mistaken for a Git repository located higher in the filesystem.
- Create a new repo locally, including **intelligent initialization inside non-empty folders** without losing files or overwriting local content.
- Repository opening checks time out after 15 seconds with an actionable message instead of leaving the chooser indefinitely busy.
- When opening a folder that is not a Git repo yet, initialize locally or **initialize and link an existing GitHub remote** in one guided flow. GitCron checks remote `main` before creating the first local commit; if history already exists, it can preserve that history and link the folder without force-pushing or deleting local files.
- Automatic **GitHub collision and retry rescue**: when creating a local repository and selecting "Crear también en GitHub", GitCron can recover an existing remote and, if publication previously failed, continue from the GitHub step without trying to initialize the local repository again.
- Pushing a local-only repository with no `origin` opens a guided publication flow: create a private GitHub repository or link an existing GitHub URL, then configure the upstream and push without losing local commits.
- Clone from any Git URL or from your GitHub repos.
- Create a GitHub repo and clone it in one flow.
- Multi-repo tabs: keep several repos open at once.
- Restore open repos and the active tab automatically on app launch.
- Use the `+` tab action to open the same central chooser for open / create / clone.

#### History and graph

- SVG commit graph with stable branch colors.
- Current branch always highlighted in neon green.
- Branch / tag chips with local, remote, tag, and current-state cues. Long names truncate with ellipsis; commits with more than 3 refs show a `+N` badge.
- Filter toggle in the graph header: **All branches** (default) or **Current branch** (`git log` without `--all`). State is per-repo tab.
- WIP row at the top when the working tree is dirty.
- History tab for a flat chronological view.
- Commit tab for a staging-focused workflow summary.
- File context menus can open read-only file history (`git log --follow -- <file>`) and jump from a file-history commit into its file diff.
- File context menus can open read-only blame (`git blame --line-porcelain`) with line number, author, date, summary, and short hash.

#### Staging and commits

- Separate unstaged and staged sections.
- **Live working tree in the right panel** when files change on disk: a single recursive `fs.watch` per repository (`electron/ipc/repo-watch.ts`, 200 ms debounce; `chokidar` was removed because on Windows it held a handle per directory and blocked folder renames) emits `repo:fs-change` over IPC. Current files remain visible in a dedicated live section even while inspecting a historical commit. The watcher ignores `node_modules`, `.next`, `dist`, `release`, and `out`.
- **Git state changes arrive as events, not by polling**: the watcher observes a closed allowlist inside `.git/` — `index`, `HEAD`, `MERGE_HEAD`, `rebase-merge/`, `rebase-apply/`, and `refs/heads/` — so staging, branch switches, merges, rebases, and commits made from a terminal update the view without waiting for a timer. `.git/objects/`, `.git/logs/`, and lock files stay ignored: Git writes there constantly without changing anything the app shows. Measured on a real clone, a `checkout` of 1109 files produces 2 raw events that the debounce collapses into 1.
- **Adaptive backup heartbeat**: a `git status` timer still covers filesystem events that Windows, some editors, and atomic saves genuinely drop, but it now runs frequently only after recent activity and spaces out when the repository is idle — measured, 5× fewer reads at rest. A cheap `stat` of `.git/index` (median 16 µs, versus 42 ms for `git status`) skips the full read when nothing changed. It only ever skips a read, never discards an event.
- Batch stage / unstage to avoid `index.lock` races.
- Hunk and selected-line stage / unstage / discard directly from the diff viewer.
- Diff viewer for staged and unstaged files.
- Real commits with author, date, refs, and commit details. Clicking a commit shows the files changed **in that commit** with colored status badges (A/M/D/R) and per-file diffs.
- Amend last commit: reword the message or fold staged changes into the previous commit, with a warning if the commit was already pushed.
- Apply `.patch` and `.diff` files from the topbar with a native file picker; patches are applied to the working tree and the repository status refreshes immediately.
- Squash last N commits (2–5) into one with a custom message.
- Reset all with confirmation.
- Clean untracked in bulk: a safe `Limpiar...` / `Clean...` action appears when untracked files exist, opens a checklist modal from a fresh `git clean -n -d` dry-run, and deletes only selected untracked paths after an explicit warning.
- Recovery action for `index.lock` errors.
- Friendly recovery when Git skips ignored files: the warning explains `.gitignore` and Windows line-ending notices separately, then offers **Add anyway** for the exact selected files or **Leave out** to dismiss safely.

#### Branches

- **Agrupamiento Recursivo de Ramas (Árbol de Profundidad Infinita)**: La barra lateral local y remota ahora soporta anidamiento recursivo de subcarpetas utilizando prefijos con múltiples barras diagonales (ej. `feature/cronometric/tcars-hud-shell`). Las ramas se ordenan jerárquicamente con carpetas primero y prioridades especiales para ramas principales (`main`/`master`), utilizando sangrías dinámicas y acumuladores de cantidad exactos.
- **Branch folders remember whether they are open**, per repository and across sessions. They start closed: with dozens of remote branches, expanding everything on launch made the list unusable. Jumping to a branch still opens the folder that contains it, so a freshly selected branch is never hidden.
- **Branch deletion refuses what would be destructive.** GitCron never deletes the remote's default branch — the guard lives in the IPC channel, not only in the interface, because a local branch can have `origin/main` as its upstream without its name showing it. When the upstream is `gone` it offers local-only deletion; when the remote name differs from the local one, the confirmation shows exactly which remote branch would go.
- **A branch held open by a worktree can be deleted from the app.** Instead of Git's raw `cannot delete branch used by worktree`, GitCron explains it and offers to release the worktree first, naming the directory and warning what is lost. If Git cannot remove it because ignored files remain — `node_modules`, typically — it says so, counts what is left, and offers to delete the folder outright as a separate confirmation.
- Ahead / behind counts in the sidebar.
- Ahead / behind chips now explain themselves on hover, and Pull / Push open a decision toast when the current branch is behind or diverged.
- Push performs a preflight Fetch for the active repository so ahead/behind indicators and the fast-forward/rebase/merge decision use the current remote state; a late `fetch first` rejection triggers the same recovery flow.
- **Premium Force Push workflow**: when pushing a branch whose history has diverged from the remote (e.g., during initialization/pushes of overlapping repos), GitCron displays a beautifully styled, high-priority React overlay modal (`z-[300]`) requesting explicit permission before executing a safe `--force` push.
- Checkout with conflict detection.
- Merge, rebase, fast-forward, rename, delete, and create branch flows. Remote deletion resolves the exact configured upstream, including local and remote branches whose names differ.
- **Improved Pull Success Toast**: Success toast for pull actions displays a structured header with the file count and a scrollable body containing the list of modified files (using maximum height and `overflow-y: auto`). Auto-dismiss timer pauses on hover so the user has time to read the files list.
- Cherry-pick a single commit onto the current branch from the commit context menu, with conflict-aware feedback.
- Per-file stash and full working-tree stash.
- Advanced stash workflow: create a stash with an optional name, preview stash file lists and patches before applying, and use hover actions for Apply, Pop, or Drop from the sidebar.
- Clear-all stash action with confirmation.
- **Remote branch checkout**: Double-clicking a remote branch in the sidebar or right-clicking to use the new `RemoteBranchContextMenu` will automatically download it as a local tracking branch (using `git checkout -t`) or switch to it if it already exists, featuring custom pointers and hover guides.
- **Interactive Conflict Resolver**: Conflicted files open a block-by-block resolver in the Diff Viewer. Each hunk can keep Local, keep Incoming, combine both orders, or be manually edited in a final text area. Saving writes the resolved file, removes conflict markers, and stages it automatically.

#### GitHub

- OAuth Device Flow login, similar to `gh auth login`.
- Manual personal access token fallback.
- Authenticated push / pull / fetch via a process-scoped GitHub authorization header, without writing token-bearing `origin` URLs.
- Automatic `--set-upstream` on the first push of a new branch.
- Existing-repo bootstrap: paste a GitHub remote URL during init. Empty remotes receive the first `main` push; remotes with history are detected beforehand and can be adopted with a mixed reset that preserves working files and creates a `gitcron/local-before-link-*` backup branch when a local commit already exists.
- Pull requests list in the sidebar for the current repo, with an in-app unified diff view.
- Private repo clone support after login.

#### Remotes, Worktrees & Submodules

- **Multiple Remotes Management**: Add, rename, set/update URLs, and delete remotes directly from the sidebar with safe user confirmations.
- **Worktree Operations**: Add new worktrees pointing to different branches. Safely remove worktrees by checking for uncommitted changes first, requesting force deletion if data could be lost.
- **Submodules Lifecycle**: List existing submodules, add new submodules via URL and path, update them, and sync recursively.

#### UX

- Success and error toasts for the main Git actions.
- Search moved to a toolbar button with `Ctrl + Alt + F`.
- Search opens in a floating popover instead of living permanently in the topbar.
- Resizable app columns: sidebar / center / details.
- Resizable graph columns: Branch/Tag, Graph, Date, Commit.
- Reworked topbar layout with repo navigation on the left, Git actions centered, and tools on the right.
- Remote auto-fetch: background `git fetch --all --prune` on a configurable interval (5 / 10 / 30 / 60 min). Toggle and last-sync time in Settings. Manual trigger via the fetch button next to Stash. Local file detection is independent and stays live.
- Default folder: configurable starting directory for open and clone dialogs, saved in encrypted storage.
- Per-repo loading state: each tab shows its own spinner and error — a slow operation on repo A never blocks repo B.
- Text size setting in Settings: `Compact`, `Normal`, `Large`.
- In-app notifications share one bottom-centered, stackable viewport above the application shell. Success, errors and action prompts remain readable; destructive reset and branch deletion flows report their final outcome explicitly.
- OS notifications: native alerts when push/pull takes >3s or the window is unfocused, and when auto-fetch detects new remote commits.
- Configurable keyboard shortcuts: 14 actions (commit, push, pull, branch, fetch, search, etc.) editable from Settings with click-to-capture rebind.
- Theme toggle in Settings: dark (default) and a native light theme (v1.16): every color is a semantic `light-dark()` token, native controls (`select`, date pickers, scrollbars) follow the theme without CSS inversion, and text and accents meet WCAG AA contrast in both themes.
- Auto-update now stays inside the app UI: a version-tag dot announces updates, the tag opens the download dropdown, progress stays beside the GitHub releases icon, and `UPDATE` appears there when the download is ready.
- Settings -> Check for updates now includes a **Recent changes** view sourced from the local `CHANGELOG.md`: the newest version opens by default, older versions stay collapsible, and GitHub Releases remains available as a secondary "full history" action.
- Startup polish: the Electron splash now shows the GitCron icon with subtle geometric animation, stays visible long enough to avoid first-paint flicker, and the Graph fades in after initial repo data is ready.
- **Selective Text Selection**: Habilitación selectiva de la propiedad de selección de texto (`select-text`) quirúrgicamente sobre nombres de ramas (locales y remotas), agrupadores de carpetas, tags, stashes y todos los metadatos de commits (mensajes, hashes, email, autor, archivos) en los listados e insets, conservando el comportamiento nativo `select-none` en elementos interactivos.
- **Reordenamiento de Pestañas por Arrastre (Drag-to-Reorder Repo Tabs)**: Las pestañas de los repositorios abiertos en la barra superior ahora soportan reordenamiento visual dinámico por arrastre utilizando `Reorder` de `motion/react`, with mitigación de clics accidentales durante el arrastre (`isDraggingRef`).
- **Paneles Laterales Integrados para Configuración, Ayuda y Usuario**: Reemplazo de los antiguos modales flotantes por paneles semánticos integrados en el layout principal. Los contenidos se adaptan fluidamente a la anchura del contenedor (`w-full` y `max-w-2xl` para el perfil de usuario), eliminando límites heredados del contenedor modal.
- **Flujo de Repositorios Integrado**: Abrir existente, Crear nuevo y Clonar de GitHub ahora viven en la navegación lateral izquierda, siguiendo la misma estética y comportamiento de Configuración, Ayuda y Perfil. El contenido se muestra en el panel central con ancho controlado, fondo glass consistente y sin superposición del TCAR/LCAR o del switch Clásico/Cronométrico.
- **Transición de Desvanecimiento Puro (Fade-Only)**: Eliminación definitiva de las distorsiones de escalado bruscas por defecto. Implementación de transiciones de opacidad para una experiencia fluida y prémium al abrir y cerrar paneles.
- **Guardia de Hidratación (Hydration Guard)**: Implementación de una barrera de renderizado síncrono en el cliente basada en la técnica de Josh W. Comeau para evitar discrepancias de hidratación SSR, introduciendo una pantalla de carga y esqueleto premium durante la sincronización inicial.
- **Saneamiento Estático y Mantenibilidad de Fallow**: Saneamos la complejidad del grafo clásico (`computeGraph` en `CommitGraph.tsx` simplificada) y modularizamos la hidratación de preferencias en `use-git-actions.ts` hacia helpers modulares independientes, logrando una reducción del 90% en su complejidad cognitiva y elevando el *Maintainability Score* global del proyecto al **90.0% ("Good")**.
- **Optimización y Componentización Continua**: `app/page.tsx` bajó de ~3.984 LOC en v1.7.x a 1.711 en v1.8.x; hoy mide **1.918 LOC** (2026-09-26), porque SDD y Cartografía sumaron puntos de montaje. Tabs multi-repo, sidebar, vistas internas, modales de acción y confirmaciones destructivas viven en componentes dedicados. El *Maintainability Score* de Fallow (**90.2, "Good"**) es la medición de v1.8.x; el view-switcher central (graph tab) sigue siendo el mayor objetivo de saneamiento pendiente.
- **Spanish and English UI strings**.

### 🟣 Vista Cronométrica (Chronometric View) - En Desarrollo / Experimental

- *Esta sección documenta las características de la Vista Cronométrica.*
- **Línea de tiempo cronométrica avanzada**: Visualiza la evolución histórica de las ramas alineadas a su estampa de tiempo real, mejorando la comprensión visual de mezclas y bifurcaciones concurrentes.
- **Entrada estable de commits nuevos**: Al crear un commit desde la vista cronométrica, el viewport conserva su posición y el nodo nuevo entra con fade, mientras el conector desde el commit anterior se dibuja progresivamente.
- **Navegación temporal interactiva**: Controles para filtrar y enfocar períodos de actividad específicos, útiles en repositorios con alta densidad de commits diarios.
- **Máscara en Curva Bézier de Precisión**: La máscara de ocultación usa curvas Bézier cúbicas con una silueta fluida que calza al milímetro con la consola LCARS.
- **Enmascarado con Degradado sobre el Canvas**: Los timelines y commits se desvanecen suavemente a transparente antes de tocar el panel técnico derecho.
- **Visualización Condicional por Contexto**: El panel LCARS solo se monta en el DOM en la solapa Graph, dejando limpias las vistas de Commit, History y Diff.

### 🟡 Temporal Agent — Ramas Futuras con IA (v1.6.6+, Experimental)

- **Predicción de ramas especulativas**: Una IA (OpenRouter) analiza el contexto del repositorio y propone 3-5 ramas futuras posibles (`improvement`, `breakthrough`, `trend`).
- **Visualización en la diagonal cronométrica**: Ramas punteadas semitransparentes en cyan que salen de HEAD hacia el futuro, con opacidad ligada a la confianza de la predicción.
- **Panel Centauro**: Al clickear una rama especulativa, el HUD inferior muestra el rationale de la IA con evidencia del repositorio.
- **Materialización one-click**: El botón "Materializar" convierte una rama soñada en un branch real de Git (`imagined/<slug>`) con tag `flight/<nivel>` y un `IDEA.md` documentando la decisión.
- **Brief copiable limpio**: La confirmación de materialización separa metadata fija del bloque copiable para agentes, manteniendo el `IDEA.md` completo en la rama creada.
- **Configuración por repositorio**: Settings → Temporal Agent permite elegir modelo de IA (catálogo de modelos OpenRouter verificados en `lib/openrouter-models.ts`), scope de privacidad, threshold de confianza, y focus areas.
- **Persistencia**: Las predicciones se guardan en `prediction.json` por repo y sobreviven a cierre/re-apertura de la app.
- **Seguridad**: API keys cifradas con `safeStorage` del OS (DPAPI/Keychain/libsecret). Fingerprint SHA-256 como identificador visible. Las keys nunca salen del proceso main.
- **Toggle FUTUROS**: Botón en la esquina superior del grafo cronométrico para mostrar/ocultar las ramas especulativas. Se activa automáticamente tras una predicción.
- **Chip en vista clásica**: Si hay predicciones disponibles, la cabecera del grafo clásico muestra un chip "N futuros →" que cambia a vista cronométrica en un click.
- **Dashboard Estadístico (Brier Score)**: Nueva sección "Dashboard temporal" en los ajustes del repositorio y pestaña "Estadísticas" en el HUD Centauro. Muestra el Brier Score del agente, la curva de calibración agrupada por 10 bins (con tamaño de punto proporcional a las muestras), el historial de decisiones temporal y la comparativa de Brier por modelo e i18n trilingüe. Soporta vista local o unificada cross-repo.

### 🧭 Cartografía — Comprensión de repos con IA (v1.10.0)

- **Vista única de Cartografía**: Un lienzo integrado para entender cualquier repo abierto sin saltar entre tres vistas separadas. El mapa muestra tarjetas por rol, archivos clave y relaciones ponderadas, con expansión on-demand para profundizar cuando hace falta.
- **Grounding CodeGraph + filesystem**: El modelo combina símbolos, edges y archivos del repo para que componentes, estilos, config, docs y assets entren en la lectura estructural.
- **Explicaciones y preguntas con citas**: "Explicame esto" abre detalle de nodos con impacto, callers/callees y explicación de IA; "Preguntar a la IA" responde sobre el repo activo citando archivos y símbolos consultados.
- **Panorama integrado y cacheado**: El resumen del repo se genera desde estructura determinística, se narra con IA cuando está habilitada y se cachea en SQLite por repo, estructura e idioma.
- **Providers opt-in**: Soporta LM Studio local y OpenRouter, reutilizando la key cifrada del Temporal Agent sin exponer secretos al renderer.

### 🔵 SDD — Workspace OpenSpec (v1.11 → v1.18)

SDD (antes «Pipeline») muestra en qué punto del ciclo de OpenSpec está el repositorio abierto y qué corresponde hacer a continuación, sin exigir conocer los comandos `/opsx:*`.

- **Workspace de tres zonas unificado**: navegación de cambios activos, archivados y especificaciones a la izquierda; trabajo al centro con el ciclo Explore → Propose → Apply → Validate → Archive; actividad y alertas a la derecha. Transición fluida con ancho unificado (`1100px`) y conmutación entre panel y riel sin saltos de maquetación.
- **Grafo de artefactos cronológico y ordenado por dependencias**: visualización devuelta por el motor CLI (ciclo SDD 1.13) en una línea horizontal continua, con estado de artefactos (`description`, `dependencies`, `unlocks`, `resolvedOutputPath`, `existingOutputPaths`) y ficha de inspección única.
- **Recorrido paso a paso del ciclo de vida**: flujo estructurado para explorar, proponer, aplicar y archivar cambios con seguimiento de la sesión del modelo de IA en tiempo real, bitácora acotada con scroll independiente e interruptores dedicados para filtrar canales.
- **Pase explícito al cambio creado**: finalizada la sesión de propuesta, la aplicación ofrece pasar al cambio generado mediante confirmación explícita sin saltos intempestivos de contexto.
- **Editor y visor interactivo de tareas (`tasks.md`)**: sincronización de casillas y estados entre el modo visual y el Markdown de disco, con rescate directo de disco si el snapshot no pobló artefactos y numeración secuencial editable al crear o modificar tareas.
- **Vigilante Git nativo y eficiente**: observador recursivo sobre `fs.watch` con filtrado y estabilización de eventos de 200 ms, eliminando bloqueos `EPERM` en Windows al renombrar carpetas o archivar cambios.
- **Guía del próximo paso**: una función pura deriva el estado real —tarea pendiente, sesión corriendo, validación fallida, listo para archivar, decisión esperando— y de ahí salen la etiqueta y la habilitación de cada acción. Archivar no aparece antes de que la validación pase.
- **Empezar un cambio sin escribir comandos**: dos ramas, Propose para una tarea definida y Explore para una idea por definir. Pide objetivo, nombre validado contra el mismo contrato del CLI y restricciones opcionales; la instrucción generada queda visible bajo divulgación progresiva.
- **Ejecutar con el runtime que tengas**: descubre los runtimes instalados, informa el alcance que cada uno declara y abre una sesión que puede editar el repositorio. Toda sesión que escriba exige confirmación explícita antes de arrancar.
- **Leer los artefactos sin salir de la app**: `proposal.md`, `design.md`, `tasks.md` y los spec delta por capacidad se abren desde la navegación y se leen en la columna central. El markdown viaja dentro de la evidencia ya contenida al repositorio; el renderer no lee archivos.
- **Evidencia sin inventar**: un dato ausente, incompatible o sin fixture se representa como `unknown` o `pending_fixture`, nunca como cero o verde. Un proceso que termina no marca una tarea como hecha: el progreso se relee de `tasks.md`.
- **Sesiones persistidas**: cada corrida guarda runtime, cambio, tarea, tiempos y resultado en SQLite, y el historial sobrevive a reinicios.

#### Configuración de OpenSpec (v1.17 → v1.18)

- **Actualizar el motor donde vive**: si el repositorio tiene su propia copia de OpenSpec en `package.json`, «Actualizar» actualiza esa (sin confirmar en Git y conservando la fijación exacta); si usa la del sistema, pide antes una confirmación con el comando exacto y los repositorios abiertos afectados. Instala la versión anunciada y sólo dice «Listo» si después responde esa versión; «volver a la versión anterior» vuelve en el mismo lugar.
- **Motivos verdaderos**: una actualización detenida dice su causa real, y «integración al día» se afirma sólo después de volver a medir.
- **Copias viejas de las instrucciones**: cuando OpenSpec mueve las instrucciones de una herramienta a otra carpeta (Codex de `.codex` a `.agents` en 1.13), GitCron lista las copias viejas y las retira sólo si Git puede devolverlas.
- **Las herramientas las decide el motor**: GitCron corre, en un proceso aparte, las funciones con las que el propio OpenSpec decide qué herramientas hay en un proyecto, cuáles están configuradas y cuáles necesitan actualizarse. Si no puede, usa una copia de la lista de OpenSpec 1.13 (`electron/pipeline/openspec-tools-snapshot.json`) y lo avisa.
- **Inicializar y configurar desde la pantalla**: un repositorio sin OpenSpec ofrece un solo «Inicializar OpenSpec» eligiendo herramientas; uno que ya lo usa muestra «Detectadas sin configurar: …» con un único «Configurar…».
- **Precarga sin saltos**: mientras se lee el motor se ve un esqueleto con la forma de la pantalla, nunca «Ausente» o «Desconocido» sin medición.

### 🟡 Preparar el commit desde SDD (v1.12 → v1.15)

El commit se arma donde se ve el trabajo, sin cambiar de pestaña. Preparar no confirma: confirmar sigue siendo una acción humana desde Commit.

- **Elegir qué entra, archivo por archivo**, agrupado por procedencia. Nada entra preseleccionado.
- **Atribución con su fuente declarada**: que un archivo viva bajo la carpeta de su cambio es un hecho; que lo diga la rama es una declaración. El hecho manda.
- **El mensaje se corrige en el mismo lugar donde se decide qué entra**, escribiendo sobre el mismo estado que después se confirma.

### 🟣 Redacción del asunto con IA local (v1.12 → v1.15)

El tipo convencional de un commit —`feat`, `fix`, `chore`— es el único dato que ninguna fuente del repositorio contiene: no está en el diff, ni en las rutas, ni en la rama, ni en las tareas. Un modelo local lo acierta, y por eso esta función existe.

- **Local y opt-in**: corre contra LM Studio con el endpoint declarado. Lo que viaja es el diff del repositorio, así que **el código no sale a ningún tercero**. Nunca se dispara solo: cada acción responde a un botón.
- **Elección informada del modelo**, con estado, contexto real cargado, tamaño, cuantización, si razona y en qué máquina vive. Nada viene preseleccionado: está medido que la función sirve o no según cuál sea.
- **Carga y expulsión desde el panel**, declarando el costo en VRAM antes de tomarlo y con desalojo automático por inactividad configurable.
- **Se ve pensar al modelo**: el asunto llega por SSE y se muestra según se produce, con el conteo de tokens que explica una espera larga.
- **El mensaje queda rotulado como escrito por el modelo y no por la aplicación**, y no pisa nunca lo que una persona escribió.
- **Un fallo del servidor se explica en castellano llano** —qué pasó y qué hacer— sin ocultar el motivo técnico, que es lo único que sirve para buscar el problema.

Medido: una redacción tarda entre 25 y 98 segundos según el modelo, y un prompt de 12k caracteres son 4.649 tokens. Un modelo con razonamiento y poco presupuesto de tokens devuelve contenido vacío, así que el techo es un parámetro por modelo y no una constante.

---

## Architecture

Renderer:

- `app/page.tsx` drives the main three-column UI, tabs, modals, and topbar.
- `components/RepoTabs.tsx` renders the draggable multi-repo titlebar tabs and Electron window controls.
- `components/RepoSidebarParts.tsx` renders reusable sidebar sections, local/remote branch trees, stash rows, tags, and nested branch folders.
- `components/DangerConfirmDialog.tsx` centralizes destructive confirmation dialogs for branch/tag/file removal flows.
- `components/RepoActionModals.tsx` houses the action modals extracted from the main page (checkout conflict, reset all, clean untracked, amend, squash, new branch, create tag, merge-needs-checkout, rename branch, force push) sharing one internal `ModalShell` overlay scaffold.
- `components/RepoContentViews.tsx` renders the History and Commit tab bodies plus pull-request diff, file diff, file history, and blame views.
- `components/PageWidgets.tsx` holds page mini-widgets (deferred-panel loading, graph column handle, fetch indicator, the LCARS decorative panel).
- `components/CommitGraph.tsx` renders the SVG graph and graph-table rows.
- `components/ChronometricGraph.tsx` renders the chronometric diagonal view with speculative branch overlay.
- `components/cartography/CartographyView.tsx` renders the single Cartography workspace: panorama header, role-card map, node detail, AI settings, and grounded Q&A.
- `components/SpeculativeBranches.tsx` renders AI-predicted future branches as dotted cyan overlays.
- `components/DiffViewer.tsx` renders unified diffs.
- `components/TemporalAgentSettings.tsx` per-repo settings panel for the Temporal Agent.
- `hooks/use-git-actions.ts` contains repo actions like commit, push, pull, merge, stash, and preferences persistence.
- `hooks/use-repo-loader.ts` loads repo data and restores persisted repos with selective Zustand subscriptions and shared refresh helpers.
- `hooks/use-repo-chooser.ts` holds the repo-chooser business logic (open existing, create — optionally on GitHub — and clone, including the force-push confirmation flow).
- `lib/git-store.ts` holds the Zustand store.
- `lib/display-format.ts` centralizes renderer date formatting and author initials.
- `lib/hunk-patch.ts` and `lib/blame-parse.ts` hold pure patch/blame parsing helpers covered by unit tests.
- `lib/speculative-projection.ts` computes future-branch positions along the chronometric diagonal.
- `lib/chronometric-projection.ts` projects commits into the chronometric coordinate system.
- `lib/feedback-context.ts` builds feedback blocks from the decision log for the AI context.
- `lib/materialize-idea.ts` builds the materialization plan (branch name, tag, IDEA.md content).
- `lib/carto-panorama.ts`, `lib/carto-groups.ts`, and `lib/carto-roles.ts` build the deterministic Cartography role model used by the renderer and AI prompts.

Main process:

- `electron/main.ts` creates the window and registers the typed IPC handlers, which live by domain in `electron/ipc/*.ts` (Git operations, sync, branches, GitHub, storage, shell, watchers, Cartography, commit-message AI, and the SDD/OpenSpec channels).
- `electron/preload.ts` exposes the safe renderer bridge via `window.api`.
- `electron/pipeline/` holds the SDD back end: repository evidence reader, OpenSpec engine discovery, installation and tool report (`openspec-engine-tools.ts`), archive, runtime sessions and one adapter per runtime.
- `electron/ai/key-store.ts` manages OS-encrypted API keys (never exposed over IPC).
- `electron/ai/provider-parsing.ts` normalizes AI-provider JSON extraction and speculative branch parsing across Claude/OpenRouter adapters.
- `electron/carto/graph-engine.ts`, `electron/ipc/carto-graph.ts`, and `electron/ai/carto/*` provide CodeGraph grounding, filesystem-aware snapshots, providers, and SQLite-backed Cartography AI cache.

Data flow:

```text
UI -> hook -> window.api.* -> IPC -> Electron main -> simple-git / Octokit
UI <- Zustand update <- hook / IPC response
```

State model:

- Multi-repo is now first-class in the store.
- `openRepos: RepoState[]` stores the per-repo state.
- `activeRepoIdx: number` points to the visible repo.
- Legacy fields like `repoPath`, `branches`, `commits`, `modifiedFiles`, and `commitMessage` still exist as mirrors of the active repo to keep the rest of the app stable during the transition.

---

## Security

See [SECURITY.md](SECURITY.md) for the full hardening notes. Short version:

- GitHub tokens are stored with Electron `safeStorage` (OS keychain / DPAPI / libsecret).
- Push / pull / fetch auth uses a process-scoped `http.https://github.com/.extraheader` authorization header instead of changing `origin`, so token-bearing remote URLs are not written to `.git/config`.
- Every token-authed git op runs with `-c safe.allowUnsafeCredentialHelper=true -c credential.helper= -c core.askpass=` plus `GIT_TERMINAL_PROMPT=0` and `GCM_INTERACTIVE=never`, so the auth'd operation never gets cached in the OS credential store. `safe.allowUnsafeCredentialHelper=true` is required by git-for-windows ≥2.40, while `simple-git` also needs its own `unsafe.allowUnsafeCredentialHelper` / `unsafe.allowUnsafeAskPass` options before it will pass those `-c` overrides through. The earlier `GIT_CONFIG_GLOBAL` temp-file approach (≤v1.1.4) was replaced because git-for-windows also blocks unsafe config paths.
- `BrowserWindow` runs with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and explicit `webSecurity: true`.
- Content-Security-Policy is strict in production builds (`'unsafe-eval'` and `localhost` connect-src are dev-only).
- Error messages are sanitized before logging or returning to the renderer — token-bearing URLs from git CLI output get redacted via `sanitizeForLog()`.
- Child processes use `shell: false` with arg arrays (no command injection surface).
- Filesystem actions validate repo boundaries via `path.relative()` and use `lstatSync()` + `isFile()` guards to avoid path traversal and symlink-escape attacks.
- `pnpm audit` reports zero known vulnerabilities (postcss CVE pinned via workspace override).

---

## Development

Requirements:

- Node.js 22+
- pnpm recommended
- Git available in `PATH`

Setup:

```bash
git clone <repo>
cd gitCronos
pnpm install
```

Run in development:

```bash
pnpm run electron:dev
```

Notes:

- Do not use `npm run dev` for normal app work. That only starts Next.js without Electron.
- Changes in `electron/main.ts` or `electron/preload.ts` require a full restart.
- React-side changes hot reload normally.

Type check:

```bash
./node_modules/.bin/tsc.cmd --noEmit
```

Full verification (build → tests twice → types → eslint on touched files → `openspec validate --strict` on the branch's change → `git diff --check` → known pitfalls), with the full log in `tmp/verificacion.log`:

```bash
pnpm verificar
```

---

## Project structure

```text
gitCronos/
|- app/
|  |- layout.tsx
|  |- page.tsx
|  `- globals.css
|- components/
|  |- CommitGraph.tsx
|  |- DiffViewer.tsx
|  `- pipeline/            # workspace OpenSpec: guia, flujo y lanzador
|- electron/
|  |- main.ts
|  |- preload.ts
|  |- db/                  # SQLite (node:sqlite), migraciones aditivas
|  `- pipeline/
|     |- repo-evidence-reader.ts   # lee OpenSpec y Git del repo abierto
|     |- runtime/                  # sesiones, proyeccion y persistencia
|     `- runtime-adapters/         # un adaptador por runtime, con fixture
|- hooks/
|  |- use-git-actions.ts
|  |- use-repo-loader.ts
|  `- use-translation.ts
|- lib/
|  |- git-store.ts
|  |- i18n.ts
|  `- utils.ts
|- openspec/               # metodo de trabajo: changes y specs vigentes
|  |- changes/
|  `- specs/
|- types/
|  |- electron.d.ts
|  `- pipeline/
|- AGENTS.md               # instrucciones operativas para agentes
|- SECURITY.md
|- CHANGELOG.md
`- README.md
```

---

## Design system & CSS Tokenization

The design system («Carbon Soul», Nord-based) is fully tokenized inside [globals.css](app/globals.css) using Tailwind CSS v4 `@theme` and `@utility` rules. Every color token is declared once with `light-dark(<light>, <dark>)`; `color-scheme` (`dark` by default, `light` under `html.light`) picks the value. Tests keep the palette honest: `lib/__tests__/ui-color-scan.test.ts` rejects color literals outside the baseline and `palette-contrast` checks WCAG AA pairs in both themes.

* **Core Base Tokens** (light · dark):
  - Canvas (`--color-bg-base`): `#d0d7e4` · `#2e3440`
  - Frames, toolbars, sidebars (`--color-bg-surface`): `#c2ccdb` · `#272c36`
  - Dialogs, dropdowns, cards (`--color-bg-overlay`): `#c2ccdb` · `#3b4252`
  - Editable inputs (`--color-bg-input`): `#e7edf7` · `#242933`
  - Primary text (`--color-text-primary`): `#202632` · `#eceff4`
  - Secondary text (`--color-text-secondary`): `#434d5f` · `#d8dee9`
  - Brand cyan (`--color-primary`): `#065877` · `#5ed8ff`
  - Modified / warning orange (`--color-git-mod`): `#8f3c00` · `#fd9d1a`
  - Error / delete red (`--color-error`): `#a81c1c` · `#ff716c`
  - HEAD highlight (`--color-secondary`): alias of `--color-git-add`

* **Advanced Glassmorphism Utilities**:
  - `glass-overlay`: Unified blurred glass overlay for dialogs, context menus, and tooltips.
  - `glass-header`: Glass top titlebar/toolbar separator.
  - `glass-sticky-header`: Pinned list categorizer bars.
  - `glass-alert-success` / `glass-alert-warning` / `glass-alert-error`: Semantically themed notification toast overlays.

> [!IMPORTANT]
> **Namespace Division Reference (For future AI agents):**
> There is a strict architectural split in the token design system located inside `app/globals.css`:
> 1. **Shared / Global Tokens:** Core typography, spacing, border radiuses, and glass filters affecting layouts, popovers, and dialogs.
> 2. **Classic Specific Tokens** (`components/CommitGraph.tsx`): Focuses on the dynamic commit lane color palette (`--color-graph-branch-1` to `--color-graph-branch-12`) and classic HEAD indicators (`--color-secondary`).
> 3. **Cronometric Specific References** (`components/ChronometricGraph.tsx`): Focuses on Canvas timeline color mapping (grid ticks, outer WIP orbits, stash decks). All canvas shapes reference these tokens under the hood, ensuring the timeline engine can be customized independently.

---

## Single-Branch Workflow & Feature Flags

To ensure rapid, secure development without branch drifts or versioning mismatches, GitCron operates under a **Trunk-Based Development** model with **Feature Flags** (Feature Toggles):

1. **Developing under a Flag**: Any experimental feature (like the advanced Cronometric timeline canvas, interactive HUD satellites, or floating sidebars) must be wrapped inside a conditional block using the `enableCronometric` global state:
   ```tsx
   const enableCronometric = useGitStore((s) => s.enableCronometric);
   
   return enableCronometric ? <ChronometricLayout /> : <ClassicLayout />;
   ```
2. **Local Testing**: During development, turn the feature flag **On** using the interactive toggle in Settings (Settings Modal -> Vista Cronométrica (Beta) -> Activa).
3. **Safe Deployments**: The feature flag is turned **Off** by default in production. This guarantees that unstable features cannot crash the stable Classic view since React will never mount or execute the experimental components.
4. **Gradual Rollout**: When the feature is 100% stable, perform a single change to swap the default store state to `true` or expose it permanently to all users.

---

## Styling Best Practices (Conflict Prevention)

Since the Classic and Cronometric views share the same global file and base variables, we enforce strict styling boundaries to avoid visual collisions (e.g. overlapping panels, distorted text sizes, or unexpected margins):

1. **Strict CSS Namespacing**: Custom Tailwind v4 variables inside [globals.css](app/globals.css) must live in labeled, commented block namespaces (`Shared / Global`, `Classic Specific`, `Cronometric Specific`).
2. **Prefixing Variable Names**: Any color, size, animation, or opacity unique to the timeline canvas view must use the `--crono-` or `--cronometric-` prefix. Never override a base token like `--color-bg-surface` directly for experimental changes.
3. **Isolated Layout Shells**:
   * **Classic Layout**: Rectangular panel columns flush against each other, with rigid col-resize handles.
   * **Cronometric Layout**: Absolute-positioned floating panels with micro-margins (`FLOATING_PANEL_INSET`), glass backgrounds, and rounded corners.
   * *Never mix layout classes directly*. Keep them fully isolated inside `<ClassicLayoutShell>` and `<ChronometricLayoutShell>` to prevent margin/padding spillover.
4. **CSS Dead-Code Elimination (Tailwind Compiler)**: During compilation (`npm run build`), Tailwind scans your active JSX files. If a component is commented out or deleted, its matching custom classes are automatically purged from the production CSS bundle.

---

## Roadmap

### 🟢 Core & Vista Clásica (Classic View) - Estable

#### Tier 1

- [x] Auto-fetch in the background with configurable intervals.
- [x] Default folder for open / clone dialogs.
- [x] Filter graph commits by branch.

#### Tier 2

- [x] Electron builder packaging — Windows (NSIS), macOS (DMG), Linux (AppImage).
- [ ] Windows / macOS code signing.
- [x] Auto-update flow.

#### Tier 3

- [x] OS notifications for long push / pull operations.
- [x] Configurable keyboard shortcuts.
- [x] Light theme — native, token-based, WCAG AA (v1.16.0).

#### Future / Reciente

- [x] Amend last commit (v0.1.7).
- [x] Cherry-pick from context menu (v0.1.7).
- [x] Squash last N commits (v1.0.0).
- [ ] Multi-account GitHub support.
- [ ] GitLab / Bitbucket support.
- [x] Pull request diff view (v1.2.0).
- [x] Interactive rebase (reorder / drop / reword) (v1.8.3).
- [x] Apply patch files (`.patch` / `.diff`) from the topbar (v1.10.6).
- [x] Actionable ignored-file staging warning with exact-path force add (v1.10.9).
- [x] Remote branch checkout (v1.3.7).
- [x] Premium Conflict Resolver Card (v1.3.7).
- [x] Agrupamiento recursivo de ramas en el sidebar (v1.3.7).
- [x] Multiple Remotes management, Worktrees, and Submodules operations (v1.8.4).
- [x] Local AI via LM Studio for commit subjects, from the SDD commit preparation (v1.12.0).
- [ ] Local AI for changelog drafting, project-history notes, and other offline writing helpers.
- [ ] One AI engine and model choice for the whole app (Temporal Agent, Cartography, SDD runtimes), including OpenCode and self-hosted Unsloth servers.
- [ ] Add and remove OpenSpec tools per repository from the interface (adding already works through «Inicializar» / «Configurar…»).
- [ ] Upgrade Next.js beyond 15.4.x (currently pinned — verify Electron + Tailwind 4 compatibility before bumping).
- [x] Remove token-bearing temporary `origin` URLs from authenticated Git operations (v1.2.0).

#### 🟡 Backlog / Operaciones Git Faltantes (Auditadas en v1.6.5)

- [x] **Descarte de cambios robusto**:
  - [x] Diálogo de confirmación de seguridad antes de descartar.
  - [x] Descartar un archivo *untracked* lo elimina físicamente mediante `fs:delete-file` en lugar de fallar con `git restore`.
- [x] **Creación y Push de Tags**:
  - [x] Creación de tags (livianos y anotados) desde el menú contextual del Commit (`git:create-tag`).
  - [x] Empujar un tag al remoto (`git:push-tag`).
- [x] **Reset a commit puntual**: Añadir opciones de reset (`soft`, `mixed`, `hard`) hacia un commit específico seleccionado en el grafo (menú contextual).
- [x] **Clean untracked en bloque**: Crear diálogo interactivo con checklist para limpiar archivos no trackeados del working tree (`git clean`).
- [x] **Stash Avanzado**:
  - [x] **Stash Pop**: Añadir botón hover en la barra lateral para aplicar y descartar un stash al mismo tiempo.
  - [x] **Previsualizar contenido del Stash**: Crear diálogo o panel expansible para revisar archivos modificados y diffs contenidos en el stash.
  - [x] **Stash con nombre**: Solicitar nombre descriptivo opcional al stashear cambios.
- [x] **Editor de fusión interactivo de 3 vías**: Resolver archivos conflictuados por bloques, combinando Local/Entrante o editando el resultado final antes de guardar y stagear.

---

### 🟣 Vista Cronométrica (Chronometric View) - En Desarrollo / Experimental

#### Core & Timeline Engine
- [x] Representación visual alternativa de los commits enfocada en su estampa temporal real.
- [x] Navegación temporal interactiva para filtrar períodos de actividad específicos.
- [ ] Diseño responsivo y fluidas micro-animaciones en la línea de tiempo.
- [ ] Comparación de ramas y estados históricos alineados cronológicamente.

---

## Installation

Download the latest release from [GitHub Releases](https://github.com/alejandropd-1/gitcron/releases).

| Platform | File                                                                  |
| -------- | --------------------------------------------------------------------- |
| Windows  | `GitCron Setup 1.19.0.exe`                                            |
| macOS    | `GitCron-1.19.0.dmg` _(build on macOS with `pnpm package:mac`)_       |
| Linux    | `GitCron-1.19.0.AppImage` _(build on Linux with `pnpm package:linux`)_ |

> **Note:** Installers are not code-signed. Windows will show a SmartScreen warning — click **"More info" → "Run anyway"** to proceed.

---

## Auto-update

GitCron checks for updates silently 3 seconds after the main window appears and then keeps checking every 30 minutes while the app is open. If a new version is available on [GitHub Releases](https://github.com/alejandropd-1/gitcron/releases), a dot appears on the version tag in the topbar. Clicking the tag opens an in-app dropdown with the new version and a download action. Download progress appears beside the GitHub releases icon, and an `UPDATE` button appears there once the update is ready to install.

Settings -> _Buscar actualizaciones_ / _Check for updates_ also shows **Cambios recientes** / **Recent changes**, sourced from the packaged `CHANGELOG.md`. The newest entry is expanded by default, previous versions are collapsible, and the full GitHub Releases page remains one click away for technical release details.

- **No update:** no dialog, no toast for silent background checks.
- **Manual check:** open Settings -> _Buscar actualizaciones_ / _Check for updates_, or click the version tag.
- **Platforms:** Windows (NSIS) and Linux (AppImage) auto-update without code signing. macOS auto-update is inactive until the app is signed.
- **Dev mock:** set `NEXT_PUBLIC_MOCK_UPDATE=1` before `pnpm run electron:dev` to preview the update dot, dropdown, progress bar, and `UPDATE` button without publishing a release.

---

## Publishing a release

Requirements: `GH_TOKEN` env var with permission to create GitHub Releases and upload assets. For this public repo, `public_repo` is enough for a classic token; `repo` also works.

Before publishing:

- Bump `package.json`.
- Add a top entry in `CHANGELOG.md`.
- Update the current version and security notes in this README and `SECURITY.md` when behavior changed.
- Run `./node_modules/.bin/tsc.cmd --noEmit`, `pnpm run build:electron`, and `pnpm audit --audit-level moderate`.

```bash
# Windows
pnpm publish:win

# macOS  (must build on macOS)
pnpm publish:mac

# Linux
pnpm publish:linux
```

`electron-builder` uploads a draft release to GitHub. Publish it manually from the GitHub Releases page after verifying the installer. The `latest.yml` / `latest-mac.yml` / `latest-linux.yml` metadata files must be included in the release for auto-update to work.

After publishing, install the update from GitCron and run one authenticated push from the app to validate the release path.

---

## Current version

- **GitCron**: `v1.19.0` (2026-09-29) — ver [CHANGELOG.md](CHANGELOG.md) para el detalle de cada versión.
- **Vista Cronométrica (Beta)**: *(Integrada bajo Feature Flag en la rama principal — Activar desde Ajustes)*

---

## License

No formal open-source license has been published yet. Treat the code as source-available until a license is added.
