/**
 * Repositorio de relaciones entre entidades.
 *
 * Capa de acceso a datos para la tabla `relations`.
 * Traduce filas snake_case a objetos de dominio camelCase.
 */

import type { DbDriver } from '../db/driver.js';
import type { Relation, RelationRow, RelationEntityType } from '../types/domain.js';

/** Mapea RelationRow → Relation (snake_case → camelCase). */
function toRelation(row: RelationRow): Relation {
  return {
    id: row.id,
    projectId: row.project_id,
    source: { type: row.source_type, id: row.source_id },
    target: { type: row.target_type, id: row.target_id },
    relationType: row.relation_type,
    label: row.label,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export class RelationRepository {
  constructor(private readonly driver: DbDriver) {}

  /**
   * Crea una nueva relación entre dos entidades.
   *
   * @param input Datos de la relación (id se genera automáticamente).
   * @returns La relación creada.
   * @throws Error si source y target son la misma entidad (CHECK constraint).
   */
  create(input: {
    projectId: string;
    source: { type: RelationEntityType; id: string };
    target: { type: RelationEntityType; id: string };
    relationType?: string;
    label?: string | null;
    createdBy?: string | null;
  }): Relation {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    try {
      this.driver.run(
        `INSERT INTO relations (id, project_id, source_type, source_id, target_type, target_id, relation_type, label, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, input.projectId, input.source.type, input.source.id, input.target.type, input.target.id, input.relationType ?? 'asociado', input.label ?? null, input.createdBy ?? null, now],
      );
    } catch (err) {
      if (err instanceof Error && /CHECK constraint failed: source_type != target_type OR source_id != target_id/i.test(err.message)) {
        throw new Error('Una entidad no puede relacionarse consigo misma');
      }
      throw err;
    }

    const created = this.get(id);
    if (!created) throw new Error(`No se pudo releer la relación recién creada: ${id}`);
    return created;
  }

  /**
   * Obtiene una relación por su id.
   *
   * @param id UUID de la relación.
   * @returns Relación o undefined si no existe.
   */
  get(id: string): Relation | undefined {
    const rows = this.driver.query<RelationRow>(
      `SELECT id, project_id, source_type, source_id, target_type, target_id, relation_type, label, created_by, created_at
       FROM relations WHERE id = ?`,
      [id],
    );
    return rows[0] ? toRelation(rows[0]) : undefined;
  }

  /**
   * Lista todas las relaciones de un proyecto.
   *
   * @param projectId UUID del proyecto.
   * @returns Array de relaciones.
   */
  listByProject(projectId: string): Relation[] {
    const rows = this.driver.query<RelationRow>(
      `SELECT id, project_id, source_type, source_id, target_type, target_id, relation_type, label, created_by, created_at
       FROM relations WHERE project_id = ? ORDER BY created_at`,
      [projectId],
    );
    return rows.map(toRelation);
  }

  /**
   * Lista relaciones donde una entidad participa como source o target.
   *
   * @param entityType Tipo de entidad.
   * @param entityId UUID de la entidad.
   * @returns Array de relaciones.
   */
  listForEntity(entityType: RelationEntityType, entityId: string): Relation[] {
    const rows = this.driver.query<RelationRow>(
      `SELECT id, project_id, source_type, source_id, target_type, target_id, relation_type, label, created_by, created_at
       FROM relations
       WHERE (source_type = ? AND source_id = ?) OR (target_type = ? AND target_id = ?)
       ORDER BY created_at`,
      [entityType, entityId, entityType, entityId],
    );
    return rows.map(toRelation);
  }

  /**
   * Elimina una relación por su id.
   *
   * @param id UUID de la relación.
   * @returns true si se eliminó, false si no existía.
   */
  remove(id: string): boolean {
    const result = this.driver.run(
      `DELETE FROM relations WHERE id = ?`,
      [id],
    );
    return result.changes > 0;
  }

  /**
   * Elimina todas las relaciones donde una entidad participa (source o target).
   *
   * @param entityType Tipo de entidad.
   * @param entityId UUID de la entidad.
   * @returns Número de relaciones eliminadas.
   */
  removeAllForEntity(entityType: RelationEntityType, entityId: string): number {
    const result = this.driver.run(
      `DELETE FROM relations
       WHERE (source_type = ? AND source_id = ?) OR (target_type = ? AND target_id = ?)`,
      [entityType, entityId, entityType, entityId],
    );
    return result.changes;
  }
}