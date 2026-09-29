# Seguridad de GitCron

Notas sobre el modelo de amenazas, lo que ya está protegido y lo que falta si algún día se distribuye públicamente.

## ✅ Hardening implementado

### 1. Command injection eliminada
- `terminal:open` ahora usa `child_process.spawn` con array de argumentos (no `exec` con string).
- Antes: `exec(\`start "" wt -d "${targetPath}"\`)` → vulnerable si el path tenía `"` o `&`.
- Ahora: `spawn('wt.exe', ['-d', targetPath], { shell: false })` → el path nunca se interpreta por un shell.
- Validación extra: verifica que el path exista y sea un directorio antes de spawn.

### 2. Token cifrado por el OS (no localStorage)
- Se eliminó `localStorage` para el token de GitHub.
- Se usa **`safeStorage` de Electron** que delega en:
  - **Windows** → DPAPI (Data Protection API)
  - **macOS** → Keychain
  - **Linux** → libsecret / kwallet
- El archivo cifrado vive en `app.getPath('userData')/storage.enc` con permisos `0600`.
- La clave de cifrado la maneja el OS y está atada al usuario logueado — otros usuarios de la misma máquina no pueden descifrarla.

### 3. Token y credential cache durante push/pull
- **Sin URL token en `.git/config`**: `withGitHubToken()` ya no modifica `origin`. Para push/pull/fetch sobre `https://github.com/...`, GitCron pasa el token mediante `http.https://github.com/.extraheader=AUTHORIZATION: basic ...` en la configuración efímera del proceso Git.
- **Sin caché en OS keychain**: cada invocación de git va con `-c safe.allowUnsafeCredentialHelper=true -c credential.helper= -c core.askpass=`. Eso evita que GCM o el keychain del SO almacenen credenciales de la operación autenticada. `safe.allowUnsafeCredentialHelper=true` autoriza el override vacío en git-for-windows ≥2.40; además, las instancias autenticadas de `simple-git` habilitan `unsafe.allowUnsafeCredentialHelper` y `unsafe.allowUnsafeAskPass` para que su guard interno deje pasar esos `-c`. Hasta v1.1.4 usábamos un `.gitconfig` temporal apuntado por `GIT_CONFIG_GLOBAL`, y hasta v1.1.7 se usaba `remote set-url` temporal; ambos approaches quedaron reemplazados en v1.2.0.
- **Clone autenticado sin URL token**: `git:clone` también usa el extraheader temporal y clona con la URL HTTPS limpia, así que el `origin` inicial queda sin `x-access-token`.
- **Prompts deshabilitados**: `GIT_TERMINAL_PROMPT=0` (no prompts de terminal) y `GCM_INTERACTIVE=never` (GCM nunca abre su diálogo nativo).
- **Logs sanitizados**: cualquier output que pase por `sanitizeForLog()` reemplaza `x-access-token:<TOKEN>@` y `AUTHORIZATION: basic <TOKEN>` antes de loguearse o devolverse al renderer.

### 4. Content Security Policy (CSP)
- Agregada en `app/layout.tsx` via meta tag.
- Bloquea scripts/conexiones a dominios no permitidos.
- Se permite `connect-src` a `api.github.com`, `github.com`, `https://openrouter.ai` (proveedor de IA **online**, usado por Temporal Agent y Cartografía) y `http://localhost:1234` (proveedor de IA **local** de Cartografía: LM Studio, API compatible OpenAI), más `localhost`/`ws://localhost` **solo en dev**.
- **`http://localhost:1234` (LM Studio).** Es el endpoint del proveedor de IA local de Cartografía. Se declara explícito **también en producción** (donde el comodín `localhost:*` de dev se elimina) porque la doctrina del repo es mantener la CSP en lockstep con el modelo de amenaza, aunque la petición salga del proceso main. Es tráfico hacia *tu propia máquina*: el contexto del repo no sale a ningún tercero cuando se usa el modo local.
- Regla: se agrega **únicamente el dominio de un proveedor que realmente se usa**, nunca todos a la vez. Si en el futuro se suma otro proveedor online, se agrega ese endpoint y se quita el que no se use.
- `'unsafe-eval'` y los orígenes `ws://localhost`/`localhost:*` (comodín) siguen siendo **dev-only** (se eliminan en el build empaquetado de producción).
- `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`.

### 5. Electron baseline secure
- `contextIsolation: true` ✅
- `nodeIntegration: false` ✅
- `sandbox: true` y `webSecurity: true` en `webPreferences`
- DevTools solo en dev (`if (isDev)`) ✅
- Preload usa `contextBridge.exposeInMainWorld` (no expone toda la API Node) ✅

### 6. Temporal Agent — envío de contexto a un proveedor de IA (opt-in)

El Temporal Agent es una función **opt-in** que proyecta ramas especulativas usando un modelo de IA. Esto introduce una superficie nueva: **enviar contexto del repo a un tercero** (OpenRouter). Se documenta como **riesgo aceptado**, mitigado así:

- **Opt-in explícito.** Está desactivado por defecto (`enabled: false`). No se manda nada a ningún lado hasta que el usuario activa el agente *y* dispara una predicción manualmente. No hay análisis automático ni en background sin acción del usuario.
- **Scope per-repo configurable.** El contexto se limita por `privacyScope`: el default `metadata` envía solo mensajes de commit, lenguajes y dependencias. Los **nombres de archivo** solo se incluyen si el usuario elige `metadata-plus-files` para ese repo; nunca auto-escala. **Nunca se envía contenido de archivos ni diffs.**
- **Claves cifradas por el OS, nunca en el renderer.** Las API keys de IA viven en `app.getPath('userData')/ai-keys.enc` cifradas con `safeStorage` (DPAPI/Keychain/libsecret), una por proveedor, con permisos `0600`. El proceso main es el único que las lee (`getKey()` es interno y **no se expone por IPC**). El renderer solo puede preguntar si existe una key (booleano) y dar de alta una nueva (one-way: entra, se cifra, nunca sale). Las keys nunca se loguean.
- **La petición sale del proceso main.** El `fetch` al proveedor se arma y dispara en main (`electron/ai/providers/*`), no en el renderer, así la CSP del renderer permanece cerrada.
- **CSP en lockstep.** Solo el dominio del proveedor activo (`https://openrouter.ai`) está en `connect-src`, documentado arriba.
- **Materialización con confirmación.** La única escritura de Git nueva (`git:materialize-idea`) se ejecuta solo tras confirmación explícita del usuario que previsualiza branch, tag y contenido del `IDEA.md`. Usa plumbing (índice temporal + `commit-tree`), sin tocar working tree, índice real ni la branch actual.

### 7. Cartografía — capa de proveedor de IA (opt-in, local u online)

La vista **Cartografía** suma una capa de IA para explicar nodos del grafo y responder preguntas. Reutiliza la infra del Temporal Agent (vault cifrado, `fetchWithTimeout`, doctrina de CSP) y agrega un proveedor **local**. Mitigaciones:

- **Opt-in y apagada por defecto.** `carto-ai.json` en `userData` arranca con `enabled: false`. La IA **nunca se dispara sola**: cada explain/ask sale de una acción explícita del usuario. Con la IA apagada o el proveedor caído, los handlers `carto:ai-*` devuelven un error claro y la vista sigue funcionando sin IA.
- **Local primero (privacidad).** El default al activar es **LM Studio** en `http://localhost:1234` (compatible OpenAI, **sin API key**). En modo local el contexto del repo **no sale a ningún tercero** — la inferencia es en tu máquina. Si el servidor local no está levantado, se muestra un mensaje accionable y no se rompe nada.
- **Online reutiliza el vault.** El modo online usa **OpenRouter** con la **misma key cifrada** del Temporal Agent (`getKey('openrouter')`, sólo en main, nunca al renderer ni a logs). No se agrega un dominio nuevo: `https://openrouter.ai` ya estaba en el CSP.
- **La petición sale del proceso main.** El `fetch` (local u online) se arma y dispara en `electron/ai/carto/*`, no en el renderer. Los settings (`enabled`/`mode`/`model`) no son secreto y viven en JSON plano; las keys siguen sólo en el vault cifrado.

### 8. Informe de herramientas de OpenSpec — código del motor en un proceso aparte (v1.18.0)

Para saber qué herramientas de OpenSpec hay en un repositorio, GitCron ejecuta funciones internas del paquete `@fission-ai/openspec` que ese repositorio usa (`electron/pipeline/openspec-engine-tools.ts`). Mitigaciones:

- **Nunca dentro del proceso main.** El código del motor corre en un proceso hijo (`process.execPath` con `ELECTRON_RUN_AS_NODE=1`), sin shell, con tope de 10 s, salida acotada a 1 MB y `windowsHide`. Un fallo o un cuelgue del motor no toca los privilegios ni la estabilidad de GitCron.
- **Sólo el paquete que ya responde.** El paquete se ubica desde la copia del repositorio (`node_modules/@fission-ai/openspec`, resuelto con `realpath`) o desde el lanzador del motor del sistema que GitCron ya ejecuta; se usa sólo si su `package.json` se llama `@fission-ai/openspec` y su versión coincide con la que responde `openspec --version`. Más de una candidata en el lanzador → no se usa.
- **Sólo lectura del repositorio.** Las funciones invocadas leen el sistema de archivos; lo que devuelven se valida con un esquema estricto y, si no coincide, GitCron usa su propia copia de la lista y lo avisa en pantalla.

### 9. IAs lanzadas desde SDD que escriben y corren comandos (v1.19.0)

Desde esta versión, toda IA lanzable desde SDD puede leer, escribir y correr comandos dentro del repositorio, igual que desde su propia aplicación o la terminal. Antes GitCron las recortaba al lanzarlas. Mitigaciones:

- **Confirmación explícita antes de lanzar.** El lanzador dice que la IA «va a poder modificar archivos y correr comandos» y no arranca sin una acción humana.
- **Sin opciones que quiten la contención.** Codex corre con `exec --sandbox workspace-write`: escribe y ejecuta dentro del repositorio, con la red bloqueada por su sandbox. Claude corre con `--permission-mode acceptEdits` y `--allowedTools=Read,Grep,Glob,Edit,Write,Bash`. Se descartan `--dangerously-bypass-approvals-and-sandbox` y `--dangerously-skip-permissions` (`electron/pipeline/runtime-adapters/codex-adapter.ts`, `claude-adapter.ts`).
- **Disponibilidad por capacidades declaradas**, no por el nombre de la IA (`pipeline-intent-capabilities.ts`): una IA sin `runsCommands` no se ofrece para implementar.
- **Nada de lo que se muestra como aviso manda comandos.** «Ver evidencia» abre el archivo del reporte con el sistema; no se envía nada al canal de control de la sesión.

## ⚠️ Vulnerabilidades conocidas en dependencias

Estado actual en `v1.2.0`:
- `pnpm audit --audit-level moderate` no reporta vulnerabilidades conocidas.
- El override de `postcss >=8.5.10` queda en `pnpm-workspace.yaml` para evitar la regresión del CVE transitivo previo.

Para revisar en el futuro:
```bash
pnpm audit --audit-level=moderate
```

## 🔄 Package manager

El proyecto usa `pnpm` como package manager recomendado.

```bash
corepack enable
corepack prepare pnpm@latest --activate
pnpm run electron:dev
```

**Ventajas de pnpm para seguridad:**
- **Strict dependency tree**: las dependencias no listadas explícitamente no son accesibles. Esto previene ciertos ataques de supply chain donde una dependencia "huérfana" puede ser importada.
- **Content-addressable store**: cada paquete se guarda una sola vez en `~/.pnpm-store/` y se hardlinkea. Más fácil auditar.
- **`pnpm audit`** permite revisar vulnerabilidades desde el mismo lockfile usado por la app.

## 🛡️ Modelo de amenazas actual

**Threat model para uso personal (vos en tu máquina):**

| Amenaza | Probabilidad | Mitigación |
|---|---|---|
| Atacante remoto explotando la app | Casi cero | No hay ports abiertos, no es servidor web |
| Malware en tu máquina lee el token | Baja con DPAPI | safeStorage usa cifrado del OS atado a tu usuario |
| Dependencia maliciosa (supply chain) | Real pero baja | CSP limita exfiltración. Auditá con `pnpm audit` regularmente |
| Token leak via git config | Mitigado | No se escribe URL con token en `origin`; auth efímera por `http.extraheader` + `credential.helper=` vacío autorizado en Git y `simple-git` |
| Command injection en spawn | Eliminado | `shell: false` + args array |
| Fuga de contexto del repo a un tercero (IA) | Riesgo aceptado, bajo | Opt-in + disparo manual; `privacyScope` per-repo (default solo metadata, sin contenido de archivos); CSP limita el `connect-src` al proveedor activo |
| API key de IA leída por malware / renderer | Baja con safeStorage | Cifrada por el OS (`ai-keys.enc`), solo en main, `getKey()` no se expone por IPC, nunca al renderer ni a logs |

## 🚧 Pendiente para producción / distribución pública

La app ya se está publicando en GitHub Releases. Para endurecerla antes de una distribución más amplia:

1. **Code signing**
   - Windows: certificado EV (~300 USD/año), evita el SmartScreen warning
   - macOS: Apple Developer Account (~99 USD/año) + notarización
   - Sin firma → los usuarios ven warnings (la app funciona igual)

2. **Mantener `sandbox: true` y CSP estricta**
   - Ya están habilitados en producción; revisar regresiones después de upgrades de Electron/Next.

3. **ASAR integrity checks** en electron-builder
   - Detecta si alguien modificó el bundle después de la instalación
   - Activar con `asarIntegrity: true` en electron-builder config

4. **Auto-update con firma**
   - `electron-updater` ya usa GitHub Releases; sumar releases firmados cuando haya code signing.

5. **Telemetría/error tracking opcional** (con opt-in)
   - Sentry, etc. — pero respetando privacidad

6. **Auditoría profesional**
   - Para un launch público real, un pentest formal (~1500-5000 USD) vale la pena
   - Servicios como Cure53, Trail of Bits, o pentesters freelance

7. **Política de revelación de vulnerabilidades**
   - Crear `SECURITY.md` (este archivo cuenta) con email de contacto
   - Considerar bug bounty si la base de usuarios crece

## 📋 Checklist rápido antes de cualquier release

```
[ ] pnpm audit --audit-level=moderate → 0 vulns
[ ] npx electron-builder@latest --check
[ ] CSP verificado en DevTools Console (no warnings)
[ ] Token NO aparece en .git/config tras push/pull/fetch normal
[ ] `git remote -v` sigue mostrando URL HTTPS limpia tras clone privado
[ ] storage.enc existe y NO es legible sin la sesión del usuario
[ ] DevTools cerradas en build de prod
[ ] Sin console.log de tokens, passwords, o paths sensibles
```
