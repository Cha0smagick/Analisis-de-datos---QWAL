/**
 * Repositorio de investigadores (codificadores).
 *
 * Capa de acceso a datos para la tabla `researchers`.
 * Traduce filas snake_case a objetos de dominio camelCase.
 */

import type { DbDriver } from '../db/driver.js';
import type { Researcher, ResearcherRow } from '../types/domain.js';

/** Mapea ResearcherRow → Researcher (snake_case → camelCase). */
function toResearcher(row: ResearcherRow): Researcher {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    initials: row.initials,
    color: row.color,
    isPrimary: row.is_primary === 1,
    createdAt: row.created_at,
  };
}

export class ResearcherRepository {
  constructor(private readonly driver: DbDriver) {}

  /**
   * Crea un nuevo investigador en un proyecto.
   *
   * @param projectId UUID del proyecto.
   * @param input Datos del investigador (id se genera automáticamente).
   * @returns El investigador creado.
   * @throws Error si ya existe un investigador con ese nombre en el proyecto.
   */
  create(projectId: string, input: { name: string; initials?: string | null; color?: string | null; isPrimary?: boolean }): Researcher {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    try {
      this.driver.run(
        `INSERT INTO researchers (id, project_id, name, initials, color, is_primary, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, projectId, input.name, input.initials ?? null, input.color ?? null, input.isPrimary ? 1 : 0, now],
      );
    } catch (err) {
      if (err instanceof Error && /UNIQUE constraint failed: researchers\.project_id, researchers\.name/i.test(err.message)) {
        throw new Error('Ya existe un investigador con ese nombre en este proyecto');
      }
      throw err;
    }

    const created = this.get(id);
    if (!created) throw new Error(`No se pudo releer el investigador recién creado: ${id}`);
    return created;
  }

  /**
   * Obtiene un investigador por su id.
   *
   * @param id UUID del investigador.
   * @returns Investigador o undefined si no existe.
   */
  get(id: string): Researcher | undefined {
    const rows = this.driver.query<ResearcherRow>(
      `SELECT id, project_id, name, initials, color, is_primary, created_at
       FROM researchers WHERE id = ?`,
      [id],
    );
    return rows[0] ? toResearcher(rows[0]) : undefined;
  }

  /**
   * Lista todos los investigadores de un proyecto ordenados por nombre.
   *
   * @param projectId UUID del proyecto.
   * @returns Array de investigadores.
   */
  list(projectId: string): Researcher[] {
    const rows = this.driver.query<ResearcherRow>(
      `SELECT id, project_id, name, initials, color, is_primary, created_at
       FROM researchers WHERE project_id = ? ORDER BY name`,
      [projectId],
    );
    return rows.map(toResearcher);
  }

  /**
   * Actualiza campos de un investigador.
   *
   * @param id UUID del investigador.
   * @param patch Campos a actualizar (name, initials, color, isPrimary).
   * @returns Investigador actualizado o undefined si no existe.
   * @throws Error si el nuevo nombre ya existe en el mismo proyecto.
   */
  update(id: string, patch: { name?: string; initials?: string | null; color?: string | null; isPrimary?: boolean }): Researcher | undefined {
    const researcher = this.get(id);
    if (!researcher) return undefined;

    const updates: string[] = [];
    const params: unknown[] = [];

    if (patch.name !== undefined) {
      updates.push('name = ?');
      params.push(patch.name);
    }
    if (patch.initials !== undefined) {
      updates.push('initials = ?');
      params.push(patch.initials);
    }
    if (patch.color !== undefined) {
      updates.push('color = ?');
      params.push(patch.color);
    }
    if (patch.isPrimary !== undefined) {
      updates.push('is_primary = ?');
      params.push(patch.isPrimary ? 1 : 0);
    }

    if (updates.length === 0) return researcher;

    params.push(id);

    try {
      this.driver.run(
        `UPDATE researchers SET ${updates.join(', ')} WHERE id = ?`,
        params,
      );
    } catch (err) {
      if (err instanceof Error && /UNIQUE constraint failed: researchers\.project_id, researchers\.name/i.test(err.message)) {
        throw new Error('Ya existe un investigador con ese nombre en este proyecto');
      }
      throw err;
    }

    return this.get(id);
  }

  /**
   * Elimina un investigador.
   *
   * @param id UUID del investigador.
   * @returns true si se eliminó, false si no existía.
   */
  remove(id: string): boolean {
    const result = this.driver.run(
      `DELETE FROM researchers WHERE id = ?`,
      [id],
    );
    return result.changes > 0;
  }
}