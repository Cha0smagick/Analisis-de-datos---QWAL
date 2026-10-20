/**
 * Búsqueda de texto completo sobre el índice FTS5 de documentos.
 *
 * Decisiones que explican el comportamiento observable:
 *
 * - Los términos que la persona busca se tratan como texto, nunca como
 *   sintaxis: cada uno se cita (`"termino"`) antes de llegar al `MATCH`, así
 *   que `*`, `(`, `)`, `-`, `:`, `^`, `AND`, `OR` y `NEAR` escritos en la
 *   consulta no pueden romperla ni cambiarle el sentido. Solo el `*` final de
 *   una palabra suelta se interpreta, y únicamente como prefijo, porque es la
 *   sintaxis de comodín que la propia interfaz anuncia.
 * - La puntuación es el `-bm25()` de FTS5, con desempate por `d.id` para que
 *   dos documentos con la misma puntuación salgan siempre en el mismo orden.
 * - El fragmento se recorta sobre las columnas del índice y conserva los
 *   acentos, porque `documents_fts` usa `remove_diacritics 2`, que normaliza
 *   para comparar sin alterar lo que se muestra. Cuando el documento no tiene
 *   `raw_text` se devuelve su título.
 * - La proximidad (`near`) se resuelve en memoria sobre las filas que SQLite
 *   ya devolvió, y no con el operador NEAR: el FTS5 de este build rechaza
 *   tanto `NEAR/n` como `NEAR(a b, n)` con `fts5: syntax error near "/"`. La
 *   ventana se mide en tokens del término completo, lo que hace alcanzable
 *   «costo … neto» con `near: 5`; medirla por palabra suelta vuelve imposible
 *   cualquier búsqueda de dos palabras, que es el caso habitual.
 */

import type { DbDriver } from '../db/driver.js';
import { foldText, tokenize } from '../util/text.js';
import type { SearchHit } from '../types/domain.js';
import type { SearchOptions, SearchService } from '../types/services.js';

const ELLIPSIS = '…';
const DEFAULT_LIMIT = 20;
const DEFAULT_MAX_LIMIT = 200;
const SNIPPET_MAX_CHARS = 200;

export interface SearchRepos {
  driver: { query<T>(sql: string, params?: readonly unknown[]): T[] };
}

interface SearchRow {
  documentId: string;
  title: string;
  rawText: string;
  score: number;
}

/**
 * Un grupo de términos (una frase entre comillas dobles o una palabra suelta)
 * que tiene que aparecer completa dentro de la ventana de proximidad.
 */
interface Phrase {
  tokens: string[];
  span: number;
  prefix: boolean;
}

/**
 * Parte la consulta en grupos. El índice impar de `split('"')` es la parte
 * entre comillas, es decir la frase literal que la persona pidió.
 */
function buildPhrases(query: string): Phrase[] {
  const parts = query.split('"');
  const phrases: Phrase[] = [];

  parts.forEach((part, index) => {
    const words = tokenize(part);
    if (words.length === 0) return;

    if (index % 2 === 1) {
      phrases.push({ tokens: words, span: words.length, prefix: false });
      return;
    }

    const bare = part.trim();
    words.forEach((word, position) => {
      const last = position === words.length - 1;
      phrases.push({ tokens: [word], span: 1, prefix: last && bare.endsWith('*') });
    });
  });

  return phrases;
}

/** `"costo"*` para prefijos y `"la frase completa"` para frases exactas. */
function phraseToMatch(phrase: Phrase): string {
  const quoted = `"${phrase.tokens.join(' ')}"`;
  return phrase.prefix ? `${quoted}*` : quoted;
}

/** Primer plano: todos los grupos tienen que aparecer en el documento. */
function plainMatchExpression(phrases: Phrase[]): string {
  return phrases.map(phraseToMatch).join(' AND ');
}

/** Posiciones del token en que un grupo aparece completo, como inicio de frase. */
function matchPositions(terms: string[], phrase: Phrase): number[] {
  const positions: number[] = [];
  for (let start = 0; start + phrase.span <= terms.length; start++) {
    let same = true;
    for (let offset = 0; offset < phrase.span; offset++) {
      if (terms[start + offset] !== phrase.tokens[offset]) {
        same = false;
        break;
      }
    }
    if (same) positions.push(start);
  }
  return positions;
}

/**
 * Ventana máxima admitida para un producto cartesiano de posiciones. Un texto
 * puede repetir un término muchas veces y una búsqueda legítima puede caer en
 * una combinación posterior; el tope solo protege de textos patológicos.
 */
const MAX_POSITION_COMBINATIONS = 5000;

/**
 * Predicado de proximidad: devuelve `true` cuando el texto NO contiene, dentro
 * de una ventana de `near` tokens, todos los grupos no-prefijo a la vez. El
 * prefijo se excluye porque no se puede comparar de forma exacta sin expandirse
 * contra el índice.
 *
 * Se prueba cada grupo por separado y luego se combinan sus posiciones: así se
 * puede exigir que «alpha» y «epsilon» estén a 3 tokens de distancia aunque
 * cada uno aparezca varias veces en el texto, en vez de aceptar la primera
 * coincidencia que se encuentre.
 */
function proximityFilter(query: string, near: number): (text: string) => boolean {
  const phrases = buildPhrases(query).filter((phrase) => !phrase.prefix);
  if (phrases.length === 0) return () => true;

  return (text: string): boolean => {
    const terms = tokenize(text);
    const positions = phrases.map((phrase) => matchPositions(terms, phrase));
    if (positions.some((found) => found.length === 0)) return true;

    let combinations = 1;
    for (const found of positions) combinations *= found.length;
    if (combinations > MAX_POSITION_COMBINATIONS) return false;

    const chosen: number[] = [];
    const fits = (index: number): boolean => {
      if (index === positions.length) {
        return Math.max(...chosen) - Math.min(...chosen) <= near;
      }
      for (const position of positions[index] ?? []) {
        chosen.push(position);
        if (fits(index + 1)) {
          chosen.pop();
          return true;
        }
        chosen.pop();
      }
      return false;
    };

    return !fits(0);
  };
}

/** Fragmento centrado en la primera coincidencia, recortado por caracteres. */
function makeSnippet(text: string, query: string, maxChars = SNIPPET_MAX_CHARS): string {
  const terms = buildPhrases(query)
    .flatMap((phrase) => phrase.tokens)
    .filter((term) => term.length > 1);

  const haystack = foldText(text);
  let index = -1;
  let matchLength = 0;

  for (const term of terms) {
    const at = haystack.indexOf(term);
    if (at !== -1 && (index === -1 || at < index)) {
      index = at;
      matchLength = term.length;
    }
  }

  if (index === -1) {
    return text.length <= maxChars ? text : `${text.slice(0, maxChars).trimEnd()}${ELLIPSIS}`;
  }

  const start = Math.max(0, index - Math.floor((maxChars - matchLength) / 2));
  const end = Math.min(text.length, start + maxChars);
  const prefix = start > 0 ? ELLIPSIS : '';
  const suffix = end < text.length ? ELLIPSIS : '';
  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}

export class SearchServiceImpl implements SearchService {
  constructor(private readonly repos: SearchRepos) {}

  async search(projectId: string, query: string, options: SearchOptions = {}): Promise<SearchHit[]> {
    const normalized = query.trim();
    if (normalized.length === 0 || projectId.length === 0) return [];

    const phrases = buildPhrases(normalized);
    if (phrases.length === 0) return [];

    const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), DEFAULT_MAX_LIMIT);
    const offset = Math.max(options.offset ?? 0, 0);
    const near = options.near;
    const useProximity = typeof near === 'number' && Number.isInteger(near) && near > 0;

    const select = `
      SELECT d.id AS documentId,
             d.title AS title,
             d.raw_text AS rawText,
             -bm25(documents_fts) AS score
        FROM documents_fts
        JOIN documents d ON d.rowid = documents_fts.rowid
       WHERE documents_fts MATCH ?
         AND d.project_id = ?
       ORDER BY score DESC, d.id
       LIMIT ? OFFSET ?`;

    const rows = this.repos.driver.query<SearchRow>(select, [
      plainMatchExpression(phrases),
      projectId,
      limit,
      offset,
    ]);

    const outsideWindow = useProximity ? proximityFilter(normalized, near) : null;
    const hits: SearchHit[] = [];

    for (const row of rows) {
      if (outsideWindow && outsideWindow(row.rawText)) continue;
      hits.push({
        documentId: row.documentId,
        title: row.title,
        snippet: makeSnippet(row.rawText, normalized),
        score: row.score,
      });
      if (hits.length >= limit) break;
    }

    return hits;
  }
}