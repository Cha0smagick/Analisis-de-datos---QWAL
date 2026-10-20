/**
 * Repositorio de citas (quotations) y su relación con códigos.
 *
 * Capa de acceso a datos para la tabla `quotations` y tabla puente `code_quotation`.
 * Traduce filas snake_case a objetos de dominio camelCase.
 */

import type { DbDriver } from '../db/driver.js';
import type {
  Quotation,
  QuotationRow,
  QuotationAnchor,
  TextAnchor,
  MediaAnchor,
  ImageAnchor,
  CodeQuotationRow,
  CodeQuotation,
  CodeRow,
  Code,
} from '../types/domain.js';
import { parseJson, stringifyJson } from '../types/json.js';

/** Mapea QuotationRow → Quotation (snake_case → camelCase + parse anchor + JSON). */
function toQuotation(row: QuotationRow): Quotation {
  let anchor: QuotationAnchor;

  if (row.start_pos !== null && row.end_pos !== null) {
    anchor = {
      kind: 'text',
      documentId: row.document_id,
      startPos: row.start_pos,
      endPos: row.end_pos,
    };
  } else if (row.start_ts !== null && row.end_ts !== null) {
    anchor = {
      kind: 'media',
      documentId: row.document_id,
      startTs: row.start_ts,
      endTs: row.end_ts,
    };
  } else if (row.bbox_json !== null) {
    const bbox = parseJson<{ x: number; y: number; w: number; h: number }>(row.bbox_json);
    anchor = {
      kind: 'image',
      documentId: row.document_id,
      bbox: { x: bbox.x ?? 0, y: bbox.y ?? 0, w: bbox.w ?? 0, h: bbox.h ?? 0 },
    };
  } else {
    // Fallback (no debería ocurrir por CHECK constraint)
    anchor = { kind: 'text', documentId: row.document_id, startPos: 0, endPos: 0 };
  }

  return {
    id: row.id,
    documentId: row.document_id,
    anchor,
    segmentText: row.segment_text,
    context: parseJson(row.context_json),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Mapea CodeQuotationRow → CodeQuotation. */
function toCodeQuotation(row: CodeQuotationRow): CodeQuotation {
  return {
    id: row.id,
    codeId: row.code_id,
    quotationId: row.quotation_id,
    researcherId: row.researcher_id,
    createdAt: row.created_at,
  };
}

/** Columnas de `quotations` en orden canónico, prefijadas con el alias indicado. */
function columns(alias = ''): string {
  const p = alias ? `${alias}.` : '';
  return [
    'id',
    'document_id',
    'start_pos',
    'end_pos',
    'start_ts',
    'end_ts',
    'bbox_json',
    'segment_text',
    'context_json',
    'created_by',
    'created_at',
    'updated_at',
  ]
    .map((c) => `${p}${c}`)
    .join(', ');
}

export class QuotationRepository {
  constructor(private readonly driver: DbDriver) {}

  /**
   * Crea una nueva cita.
   *
   * @param input Datos de la cita con anchor tipado (id se genera automáticamente).
   * @returns La cita creada.
   */
  create(input: {
    documentId: string;
    anchor: QuotationAnchor;
    segmentText: string;
    context?: Record<string, unknown>;
    createdBy?: string | null;
  }): Quotation {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const contextJson = stringifyJson(input.context ?? {});

    let startPos: number | null = null;
    let endPos: number | null = null;
    let startTs: number | null = null;
    let endTs: number | null = null;
    let bboxJson: string | null = null;

    if (input.anchor.kind === 'text') {
      startPos = input.anchor.startPos;
      endPos = input.anchor.endPos;
    } else if (input.anchor.kind === 'media') {
      startTs = input.anchor.startTs;
      endTs = input.anchor.endTs;
    } else if (input.anchor.kind === 'image') {
      bboxJson = stringifyJson(input.anchor.bbox);
    }

    this.driver.run(
      `INSERT INTO quotations (id, document_id, start_pos, end_pos, start_ts, end_ts, bbox_json, segment_text, context_json, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, input.documentId, startPos, endPos, startTs, endTs, bboxJson, input.segmentText, contextJson, input.createdBy ?? null, now, now],
    );

    const created = this.get(id);
    if (!created) {
      // Imposible salvo corrupción de la fila recién insertada; se propaga en vez
      // de devolver `undefined` tipado como Quotation.
      throw new Error(`No se pudo releer la cita recién creada: ${id}`);
    }
    return created;
  }

  /**
   * Obtiene una cita por su id.
   *
   * @param id UUID de la cita.
   * @returns Cita o undefined si no existe.
   */
  get(id: string): Quotation | undefined {
    const rows = this.driver.query<QuotationRow>(
      `SELECT ${columns()} FROM quotations WHERE id = ?`,
      [id],
    );
    return rows[0] ? toQuotation(rows[0]) : undefined;
  }

  /**
   * Lista todas las citas de un documento ordenadas por posición/tiempo.
   *
   * @param documentId UUID del documento.
   * @returns Array de citas.
   */
  listByDocument(documentId: string): Quotation[] {
    const rows = this.driver.query<QuotationRow>(
      `SELECT ${columns()} FROM quotations WHERE document_id = ?
       ORDER BY COALESCE(start_pos, 0), COALESCE(start_ts, 0)`,
      [documentId],
    );
    return rows.map(toQuotation);
  }

  /**
   * Lista todas las citas de un proyecto (a través de sus documentos).
   *
   * @param projectId UUID del proyecto.
   * @returns Array de citas ordenadas por creación.
   */
  listByProject(projectId: string): Quotation[] {
    const rows = this.driver.query<QuotationRow>(
      `SELECT ${columns('q')} FROM quotations q
       JOIN documents d ON d.id = q.document_id
       WHERE d.project_id = ?
       ORDER BY q.created_at, q.id`,
      [projectId],
    );
    return rows.map(toQuotation);
  }

  /**
   * Lista todas las citas asociadas a un código.
   *
   * @param codeId UUID del código.
   * @returns Array de citas.
   */
  listByCode(codeId: string): Quotation[] {
    const rows = this.driver.query<QuotationRow>(
      `SELECT q.id, q.document_id, q.start_pos, q.end_pos, q.start_ts, q.end_ts, q.bbox_json, q.segment_text, q.context_json, q.created_by, q.created_at, q.updated_at
       FROM quotations q
       JOIN code_quotation cq ON q.id = cq.quotation_id
       WHERE cq.code_id = ?
       ORDER BY q.created_at`,
      [codeId],
    );
    return rows.map(toQuotation);
  }

  /**
   * Actualiza el texto del segmento de una cita.
   *
   * @param id UUID de la cita.
   * @param segmentText Nuevo texto del segmento.
   * @returns Cita actualizada o undefined si no existe.
   */
  updateSegmentText(id: string, segmentText: string): Quotation | undefined {
    const quotation = this.get(id);
    if (!quotation) return undefined;

    this.driver.run(
      `UPDATE quotations SET segment_text = ?, updated_at = ? WHERE id = ?`,
      [segmentText, new Date().toISOString(), id],
    );

    return this.get(id);
  }

  /**
   * Elimina una cita (cascada borra code_quotation por FK).
   *
   * @param id UUID de la cita.
   * @returns true si se eliminó, false si no existía.
   */
  remove(id: string): boolean {
    const result = this.driver.run(
      `DELETE FROM quotations WHERE id = ?`,
      [id],
    );
    return result.changes > 0;
  }

  /**
   * Obtiene las citas asociadas a un código, opcionalmente incluyendo descendientes.
   *
   * El recorrido del árbol se hace con un CTE recursivo (`UNION`, que deduplica,
   * no `UNION ALL`) en vez de materializar el árbol en TypeScript.
   *
   * @param codeId UUID del código.
   * @param includeDescendants Si true, incluye citas de códigos hijos recursivamente.
   * @returns Array de citas.
   */
  quotationsForCode(codeId: string, includeDescendants: boolean = false): Quotation[] {
    if (!includeDescendants) {
      return this.listByCode(codeId);
    }

    const rows = this.driver.query<QuotationRow>(
      `WITH RECURSIVE code_tree(id) AS (
         SELECT ? UNION
         SELECT c.id FROM codes c JOIN code_tree ct ON c.parent_id = ct.id
       )
       SELECT ${columns('q')} FROM quotations q
       JOIN code_quotation cq ON q.id = cq.quotation_id
       WHERE cq.code_id IN (SELECT id FROM code_tree)
       GROUP BY q.id
       ORDER BY q.created_at`,
      [codeId],
    );
    return rows.map(toQuotation);
  }
}