/**
 * Repositorio de proyectos.
 *
 * Capa de acceso a datos para la tabla `projects`.
 * Traduce filas snake_case a objetos de dominio camelCase.
 */

import type { DbDriver } from '../db/driver.js';
import type { Project, ProjectRow } from '../types/domain.js';
import { parseJson, stringifyJson } from '../types/json.js';

/** Mapea ProjectRow → Project (snake_case → camelCase + parse JSON). */
function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    settings: parseJson(row.settings_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ProjectRepository {
  constructor(private readonly driver: DbDriver) {}

  /**
   * Crea un nuevo proyecto.
   *
   * @param input Datos del proyecto (id se genera automáticamente).
   * @returns El proyecto creado con id y timestamps.
   * @throws Error si el nombre ya existe (UNIQUE constraint).
   */
  create(input: { name: string; description?: string; settings?: Record<string, unknown> }): Project {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const settingsJson = stringifyJson(input.settings ?? {});

    try {
      this.driver.run(
        `INSERT INTO projects (id, name, description, settings_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, input.name, input.description ?? '', settingsJson, now, now],
      );
    } catch (err) {
      if (err instanceof Error && /UNIQUE constraint failed: projects\.name/i.test(err.message)) {
        throw new Error('Ya existe un proyecto con ese nombre');
      }
      throw err;
    }

    const created = this.get(id);
    if (!created) throw new Error(`No se pudo releer el proyecto recién creado: ${id}`);
    return created;
  }

  /**
   * Obtiene un proyecto por su id.
   *
   * @param id UUID del proyecto.
   * @returns Proyecto o undefined si no existe.
   */
  get(id: string): Project | undefined {
    const rows = this.driver.query<ProjectRow>(
      `SELECT id, name, description, settings_json, created_at, updated_at
       FROM projects WHERE id = ?`,
      [id],
    );
    return rows[0] ? toProject(rows[0]) : undefined;
  }

  /**
   * Lista todos los proyectos ordenados por nombre.
   *
   * @returns Array de proyectos.
   */
  list(): Project[] {
    const rows = this.driver.query<ProjectRow>(
      `SELECT id, name, description, settings_json, created_at, updated_at
       FROM projects ORDER BY name`,
    );
    return rows.map(toProject);
  }

  /**
   * Actualiza campos de un proyecto.
   *
   * @param id UUID del proyecto.
   * @param patch Campos a actualizar (name, description, settings).
   * @returns Proyecto actualizado o undefined si no existe.
   * @throws Error si el nuevo nombre ya existe.
   */
  update(id: string, patch: { name?: string; description?: string; settings?: Record<string, unknown> }): Project | undefined {
    const project = this.get(id);
    if (!project) return undefined;

    const updates: string[] = [];
    const params: unknown[] = [];

    if (patch.name !== undefined) {
      updates.push('name = ?');
      params.push(patch.name);
    }
    if (patch.description !== undefined) {
      updates.push('description = ?');
      params.push(patch.description);
    }
    if (patch.settings !== undefined) {
      updates.push('settings_json = ?');
      params.push(stringifyJson(patch.settings));
    }

    if (updates.length === 0) return project;

    updates.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);

    try {
      this.driver.run(
        `UPDATE projects SET ${updates.join(', ')} WHERE id = ?`,
        params,
      );
    } catch (err) {
      if (err instanceof Error && /UNIQUE constraint failed: projects\.name/i.test(err.message)) {
        throw new Error('Ya existe un proyecto con ese nombre');
      }
      throw err;
    }

    return this.get(id);
  }

  /**
   * Elimina un proyecto (cascada natural vía FK ON DELETE CASCADE).
   *
   * @param id UUID del proyecto.
   * @returns true si se eliminó, false si no existía.
   */
  remove(id: string): boolean {
    const result = this.driver.run(
      `DELETE FROM projects WHERE id = ?`,
      [id],
    );
    return result.changes > 0;
  }
}