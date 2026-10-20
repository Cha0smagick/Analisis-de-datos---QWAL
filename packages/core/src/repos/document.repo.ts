/**
 * Repositorio de documentos (fuentes primarias).
 *
 * Capa de acceso a datos para la tabla `documents`.
 * Traduce filas snake_case a objetos de dominio camelCase.
 */

import type { DbDriver } from '../db/driver.js';
import type { SourceDocument, DocumentRow, FileType } from '../types/domain.js';
import { parseJson, stringifyJson } from '../types/json.js';

/** Mapea DocumentRow → SourceDocument (snake_case → camelCase + parse JSON). */
function toDocument(row: DocumentRow): SourceDocument {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    fileType: row.file_type,
    filePath: row.file_path,
    rawText: row.raw_text,
    language: row.language,
    metadata: parseJson(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class DocumentRepository {
  constructor(private readonly driver: DbDriver) {}

  /**
   * Crea un nuevo documento en un proyecto.
   *
   * @param projectId UUID del proyecto.
   * @param input Datos del documento (id se genera automáticamente).
   * @returns El documento creado.
   */
  create(
    projectId: string,
    input: {
      title: string;
      fileType: FileType;
      filePath?: string | null;
      rawText: string;
      language?: string | null;
      metadata?: Record<string, unknown>;
    },
  ): SourceDocument {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const metadataJson = stringifyJson(input.metadata ?? {});

    this.driver.run(
      `INSERT INTO documents (id, project_id, title, file_type, file_path, raw_text, language, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, projectId, input.title, input.fileType, input.filePath ?? null, input.rawText, input.language ?? null, metadataJson, now, now],
    );

    const created = this.get(id);
    if (!created) throw new Error(`No se pudo releer el documento recién creado: ${id}`);
    return created;
  }

  /**
   * Obtiene un documento por su id.
   *
   * @param id UUID del documento.
   * @returns Documento o undefined si no existe.
   */
  get(id: string): SourceDocument | undefined {
    const rows = this.driver.query<DocumentRow>(
      `SELECT id, project_id, title, file_type, file_path, raw_text, language, metadata_json, created_at, updated_at
       FROM documents WHERE id = ?`,
      [id],
    );
    return rows[0] ? toDocument(rows[0]) : undefined;
  }

  /**
   * Lista todos los documentos de un proyecto ordenados por título.
   *
   * @param projectId UUID del proyecto.
   * @returns Array de documentos.
   */
  listByProject(projectId: string): SourceDocument[] {
    const rows = this.driver.query<DocumentRow>(
      `SELECT id, project_id, title, file_type, file_path, raw_text, language, metadata_json, created_at, updated_at
       FROM documents WHERE project_id = ? ORDER BY title`,
      [projectId],
    );
    return rows.map(toDocument);
  }

  /**
   * Obtiene solo el texto plano (raw_text) de un documento.
   *
   * @param id UUID del documento.
   * @returns Texto plano o undefined si no existe.
   */
  getRawText(id: string): string | undefined {
    const rows = this.driver.query<{ raw_text: string }>(
      `SELECT raw_text FROM documents WHERE id = ?`,
      [id],
    );
    return rows[0]?.raw_text;
  }

  /**
   * Actualiza campos de un documento.
   *
   * @param id UUID del documento.
   * @param patch Campos a actualizar (title, fileType, filePath, rawText, language, metadata).
   * @returns Documento actualizado o undefined si no existe.
   */
  update(
    id: string,
    patch: {
      title?: string;
      fileType?: FileType;
      filePath?: string | null;
      rawText?: string;
      language?: string | null;
      metadata?: Record<string, unknown>;
    },
  ): SourceDocument | undefined {
    const document = this.get(id);
    if (!document) return undefined;

    const updates: string[] = [];
    const params: unknown[] = [];

    if (patch.title !== undefined) {
      updates.push('title = ?');
      params.push(patch.title);
    }
    if (patch.fileType !== undefined) {
      updates.push('file_type = ?');
      params.push(patch.fileType);
    }
    if (patch.filePath !== undefined) {
      updates.push('file_path = ?');
      params.push(patch.filePath);
    }
    if (patch.rawText !== undefined) {
      updates.push('raw_text = ?');
      params.push(patch.rawText);
    }
    if (patch.language !== undefined) {
      updates.push('language = ?');
      params.push(patch.language);
    }
    if (patch.metadata !== undefined) {
      updates.push('metadata_json = ?');
      params.push(stringifyJson(patch.metadata));
    }

    if (updates.length === 0) return document;

    updates.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);

    this.driver.run(
      `UPDATE documents SET ${updates.join(', ')} WHERE id = ?`,
      params,
    );

    return this.get(id);
  }

  /**
   * Actualiza solo el texto plano y opcionalmente el idioma de un documento.
   *
   * @param id UUID del documento.
   * @param rawText Nuevo texto plano.
   * @param language Nuevo idioma (opcional).
   * @returns Documento actualizado o undefined si no existe.
   */
  updateRawText(id: string, rawText: string, language?: string | null): SourceDocument | undefined {
    return this.update(id, { rawText, language: language ?? undefined });
  }

  /**
   * Elimina un documento.
   *
   * @param id UUID del documento.
   * @returns true si se eliminó, false si no existía.
   */
  remove(id: string): boolean {
    const result = this.driver.run(
      `DELETE FROM documents WHERE id = ?`,
      [id],
    );
    return result.changes > 0;
  }

  /**
   * Cuenta los documentos de un proyecto.
   *
   * @param projectId UUID del proyecto.
   * @returns Número de documentos.
   */
  countByProject(projectId: string): number {
    const rows = this.driver.query<{ count: number }>(
      `SELECT COUNT(*) as count FROM documents WHERE project_id = ?`,
      [projectId],
    );
    return rows[0]?.count ?? 0;
  }
}