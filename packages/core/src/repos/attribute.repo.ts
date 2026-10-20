/**
 * Repositorio de atributos (variables de caso) y valores por documento.
 *
 * Capa de acceso a datos para las tablas `attributes` y `document_attribute_values`.
 * Traduce filas snake_case a objetos de dominio camelCase.
 */

import type { DbDriver } from '../db/driver.js';
import type { Attribute, AttributeRow, AttributeType, DocumentAttributeValue, DocumentAttributeValueRow } from '../types/domain.js';

/** Mapea AttributeRow → Attribute (snake_case → camelCase). */
function toAttribute(row: AttributeRow): Attribute {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    dataType: row.data_type,
  };
}

/** Mapea DocumentAttributeValueRow → DocumentAttributeValue. */
function toDocumentAttributeValue(row: DocumentAttributeValueRow): DocumentAttributeValue {
  return {
    documentId: row.document_id,
    attributeId: row.attribute_id,
    value: row.value,
  };
}

export class AttributeRepository {
  constructor(private readonly driver: DbDriver) {}

  /**
   * Crea un nuevo atributo en un proyecto.
   *
   * @param projectId UUID del proyecto.
   * @param input Datos del atributo (id se genera automáticamente).
   * @returns El atributo creado.
   * @throws Error si ya existe un atributo con ese nombre en el proyecto.
   */
  createAttribute(projectId: string, input: { name: string; dataType: AttributeType; description?: string }): Attribute {
    const id = crypto.randomUUID();

    try {
      this.driver.run(
        `INSERT INTO attributes (id, project_id, name, data_type)
         VALUES (?, ?, ?, ?)`,
        [id, projectId, input.name, input.dataType],
      );
    } catch (err) {
      if (err instanceof Error && /UNIQUE constraint failed: attributes\.project_id, attributes\.name/i.test(err.message)) {
        throw new Error('Ya existe un atributo con ese nombre en este proyecto');
      }
      throw err;
    }

    const created = this.getAttribute(id);
    if (!created) throw new Error(`No se pudo releer el atributo recién creado: ${id}`);
    return created;
  }

  /**
   * Obtiene un atributo por su id.
   *
   * @param id UUID del atributo.
   * @returns Atributo o undefined si no existe.
   */
  getAttribute(id: string): Attribute | undefined {
    const rows = this.driver.query<AttributeRow>(
      `SELECT id, project_id, name, data_type FROM attributes WHERE id = ?`,
      [id],
    );
    return rows[0] ? toAttribute(rows[0]) : undefined;
  }

  /**
   * Lista todos los atributos de un proyecto ordenados por nombre.
   *
   * @param projectId UUID del proyecto.
   * @returns Array de atributos.
   */
  listAttributes(projectId: string): Attribute[] {
    const rows = this.driver.query<AttributeRow>(
      `SELECT id, project_id, name, data_type FROM attributes WHERE project_id = ? ORDER BY name`,
      [projectId],
    );
    return rows.map(toAttribute);
  }

  /**
   * Establece (upsert) el valor de un atributo para un documento.
   * Si value es null, elimina el valor (borra la fila).
   *
   * @param documentId UUID del documento.
   * @param attributeId UUID del atributo.
   * @param value Valor como string o null para borrar.
   * @throws Error si el atributo no pertenece al mismo proyecto que el documento (FK).
   */
  setValue(documentId: string, attributeId: string, value: string | null): void {
    if (value === null) {
      this.driver.run(
        `DELETE FROM document_attribute_values WHERE document_id = ? AND attribute_id = ?`,
        [documentId, attributeId],
      );
    } else {
      this.driver.run(
        `INSERT INTO document_attribute_values (document_id, attribute_id, value)
         VALUES (?, ?, ?)
         ON CONFLICT(document_id, attribute_id) DO UPDATE SET value = excluded.value`,
        [documentId, attributeId, value],
      );
    }
  }

  /**
   * Obtiene todos los valores de atributos para un documento.
   *
   * @param documentId UUID del documento.
   * @returns Array de valores con attributeId y value.
   */
  getValues(documentId: string): DocumentAttributeValue[] {
    const rows = this.driver.query<DocumentAttributeValueRow>(
      `SELECT document_id, attribute_id, value FROM document_attribute_values WHERE document_id = ?`,
      [documentId],
    );
    return rows.map(toDocumentAttributeValue);
  }

  /**
   * Obtiene todos los valores de atributos para todos los documentos de un proyecto.
   * Devuelve un Map indexado por documentId.
   *
   * @param projectId UUID del proyecto.
   * @returns Map<documentId, DocumentAttributeValue[]>.
   */
  valuesForProject(projectId: string): Map<string, DocumentAttributeValue[]> {
    // Obtener documentos del proyecto primero
    const docRows = this.driver.query<{ id: string }>(
      `SELECT id FROM documents WHERE project_id = ?`,
      [projectId],
    );
    const documentIds = docRows.map((r) => r.id);

    if (documentIds.length === 0) return new Map();

    // Obtener todos los valores para esos documentos
    const placeholders = documentIds.map(() => '?').join(',');
    const rows = this.driver.query<DocumentAttributeValueRow>(
      `SELECT document_id, attribute_id, value FROM document_attribute_values WHERE document_id IN (${placeholders})`,
      documentIds,
    );

    const map = new Map<string, DocumentAttributeValue[]>();
    for (const row of rows) {
      const arr = map.get(row.document_id) ?? [];
      arr.push(toDocumentAttributeValue(row));
      map.set(row.document_id, arr);
    }

    // Asegurar que todos los documentos tengan entrada (array vacío si no tienen valores)
    for (const docId of documentIds) {
      if (!map.has(docId)) map.set(docId, []);
    }

    return map;
  }

  /**
   * Elimina un atributo (cascada borra document_attribute_values por FK).
   *
   * @param attributeId UUID del atributo.
   * @returns true si se eliminó, false si no existía.
   */
  removeAttribute(attributeId: string): boolean {
    const result = this.driver.run(
      `DELETE FROM attributes WHERE id = ?`,
      [attributeId],
    );
    return result.changes > 0;
  }
}