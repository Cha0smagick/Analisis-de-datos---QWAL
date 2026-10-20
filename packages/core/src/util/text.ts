/**
 * Utilidades de texto compartidas por el análisis y la búsqueda.
 *
 * Antes de este módulo cada servicio tenía su propio tokenizador
 * (`analysis.service.ts` usaba `/\b\w+\b/`, `search.service.ts` usaba
 * `split(/[^a-z0-9]+/)`). Ninguno era consciente de alfabetos no latinos y
 * producían conteos distintos para el mismo texto.
 */

/**
 * Normaliza para comparar: minúsculas y sin diacríticos.
 * En español `ñ`→`n` y `ü`→`u`, que es el comportamiento deseado para buscar
 * e indexar. Coincide con lo que hace el tokenizador `unicode61
 * remove_diacritics 2` de FTS5 en los índices de `documents_fts` y
 * `quotations_fts`.
 */
export function foldText(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** Divide el texto en términos Unicode, ya plegados. */
export function tokenize(text: string): string[] {
  return foldText(text).match(/[\p{L}\p{N}]+/gu) ?? [];
}

export interface Token {
  /** Término plegado: sin diacríticos y en minúsculas. */
  term: string;
  /** Posición inicial dentro del texto ORIGINAL. */
  start: number;
  /** Posición final (exclusiva) dentro del texto ORIGINAL. */
  end: number;
}

/**
 * Tokeniza indicando dónde está cada término en el texto original.
 *
 * Las posiciones deben calcularse sobre el texto sin plegar: la
 * normalización NFD cambia la longitud de los caracteres, así que buscar
 * sobre el texto plegado devolvería índices desplazados y las citas se
 * cortarían por el lugar equivocado.
 */
export function tokenizeWithOffsets(text: string): Token[] {
  const tokens: Token[] = [];
  for (const match of text.matchAll(/[\p{L}\p{N}]+/gu)) {
    const start = match.index;
    tokens.push({ term: foldText(match[0]), start, end: start + match[0].length });
  }
  return tokens;
}
