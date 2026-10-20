/**
 * Envoltorio HTTP del servidor local.
 *
 * Regla de oro: aquí NO se re-declaran formas de datos. Todo lo que describe el
 * dominio (proyectos, códigos, citas, y los diez informes de análisis) se
 * importa de `@qualicanvas/core`, de modo que la capa HTTP y la capa IPC
 * responden con exactamente el mismo objeto.
 *
 * Antes este archivo declaraba sus propios `CodeFrequencyItem`,
 * `CooccurrenceItem`, `WordFrequencyItem` y `DocumentCodeMatrixItem`, que no
 * coincidían con nada de lo que el núcleo devolvía; por eso el servidor
 * necesitaba una capa de "normalizadores" que aplanaba los informes y que hoy ya no
 * existe. Lo único propio de HTTP es el sobre `{ ok, data | error }` y el
 * resultado de abrir la base de datos.
 */
import type { DomainErrorCode, Project, SourceDocument } from '@qualicanvas/core';

/** Sobre de respuesta: el cliente debe mirar `ok`, no el código HTTP. */
export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: DomainErrorCode };

/** Backend SQLite effective. `sqljs` significa base en memoria (WASM). */
export type DbBackend = 'node' | 'sqljs';

export interface DbOpenResult {
  dbPath: string;
  projects: Project[];
  /** Se reporta en lugar de degradar en silencio a WASM en memoria. */
  backend: DbBackend;
}

export interface DocumentWithText {
  document: SourceDocument;
  text: string | null;
}