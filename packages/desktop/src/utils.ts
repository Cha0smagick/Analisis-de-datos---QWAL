/** Utilidades de presentación compartidas por las vistas. */

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Nombre corto de un archivo (basename) a partir de una ruta. */
export function fileName(path: string | null): string {
  if (!path) return '';
  const parts = path.split(/[\\/]/);
  const last = parts.at(-1);
  return last ?? path;
}

/** Devuelve el primer conjunto de advertencias, acotado para mostrarse. */
export function joinWarnings(warnings: string[], max = 3): string {
  const shown = warnings.slice(0, max);
  const extra = warnings.length - shown.length;
  let text = shown.join('; ');
  if (extra > 0) text += ` (+${extra} más)`;
  return text;
}
