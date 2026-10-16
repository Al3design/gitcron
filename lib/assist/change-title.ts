/**
 * Transforma un identificador de cambio en un título legible.
 * Guiones a espacios, solo la primera letra en mayúscula, el resto como está.
 *
 * «retomar-trabajo-con-asistencia-contextual» → «Retomar trabajo con asistencia contextual».
 */
export function changeTitle(changeId: string): string {
  if (!changeId) return '';
  const withSpaces = changeId.replace(/-/g, ' ');
  return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1);
}
