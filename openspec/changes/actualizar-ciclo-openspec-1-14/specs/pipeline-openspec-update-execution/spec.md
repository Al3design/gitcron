# Spec Delta

## ADDED Requirements

### Requirement: El resumen de una actualización SHALL contar los archivos que la actualización cambió, uno por uno
Al terminar `openspec update`, el resumen SHALL informar cuántos archivos cambió la actualización, contando cada
archivo creado, modificado o borrado por ella, y SHALL NOT contar cambios que ya estaban en el árbol de trabajo
antes de actualizar y que la actualización no tocó. Una carpeta nueva SHALL contar por los archivos que tiene,
no como uno.

El fundamento es que el número que se muestra tiene que ser el que pasó. Medido el 2026-10-01: el resumen decía
«8 archivos actualizados» cuando cambiaron 16, porque Git informa una carpeta nueva entera como una sola entrada
(en odontoPro, 14 entradas agrupadas contra 55 archivos), y sumaba archivos que ya estaban modificados antes,
como un `tasks.md` del cambio en curso.

#### Scenario: Carpetas nuevas de instrucciones
- **WHEN** la actualización crea `.agents/skills/openspec-explore/` con varios archivos adentro
- **THEN** cada archivo cuenta, y la carpeta no cuenta como uno

#### Scenario: Cambios previos ajenos a la actualización
- **WHEN** antes de actualizar ya había un `tasks.md` modificado y la actualización no lo toca
- **THEN** ese archivo no suma al número del resumen

#### Scenario: La actualización vuelve a tocar un archivo ya modificado
- **WHEN** un archivo administrado por OpenSpec ya estaba modificado y la actualización lo reescribe con otro contenido
- **THEN** cuenta como cambiado por la actualización
