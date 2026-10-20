/**
 * Repositorio de memos (notas personales y analíticas).
 *
 * Capa de acceso a datos para la tabla `memos`.
 * Traduce filas snake_case a objetos de dominio camelCase.
 */

import type { DbDriver } from '../db/driver.js';
import type { Memo, MemoRow, MemoTargetType } from '../types/domain.js';

/** Mapea MemoRow → Memo (snake_case → camelCase). */
function toMemo(row: MemoRow): Memo {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    content: row.content,
    target: row.target_type && row.target_id
      ? { type: row.target_type, id: row.target_id }
      : undefined,
    authorId: row.author_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class MemoRepository {
  constructor(private readonly driver: DbDriver) {}

  /**
   * Crea un nuevo memo.
   *
   * @param input Datos del memo (id se genera automáticamente).
   * @returns El memo creado.
   */
  create(input: {
    projectId: string;
    targetType?: MemoTargetType | null;
    targetId?: string | null;
    title: string;
    body: string;
    createdBy?: string | null;
  }): Memo {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    this.driver.run(
      `INSERT INTO memos (id, project_id, title, content, target_type, target_id, author_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, input.projectId, input.title, input.body, input.targetType ?? null, input.targetId ?? null, input.createdBy ?? null, now, now],
    );

    const created = this.get(id);
    if (!created) throw new Error(`No se pudo releer el memo recién creado: ${id}`);
    return created;
  }

  /**
   * Obtiene un memo por su id.
   *
   * @param id UUID del memo.
   * @returns Memo o undefined si no existe.
   */
  get(id: string): Memo | undefined {
    const rows = this.driver.query<MemoRow>(
      `SELECT id, project_id, title, content, target_type, target_id, author_id, created_at, updated_at
       FROM memos WHERE id = ?`,
      [id],
    );
    return rows[0] ? toMemo(rows[0]) : undefined;
  }

  /**
   * Lista todos los memos de un proyecto ordenados por fecha de creación descendente.
   *
   * @param projectId UUID del proyecto.
   * @returns Array de memos.
   */
  listByProject(projectId: string): Memo[] {
    const rows = this.driver.query<MemoRow>(
      `SELECT id, project_id, title, content, target_type, target_id, author_id, created_at, updated_at
       FROM memos WHERE project_id = ? ORDER BY created_at DESC`,
      [projectId],
    );
    return rows.map(toMemo);
  }

  /**
   * Lista memos vinculados a una entidad específica.
   *
   * @param targetType Tipo de entidad objetivo.
   * @param targetId UUID de la entidad objetivo.
   * @returns Array de memos.
   */
  listByTarget(targetType: MemoTargetType, targetId: string): Memo[] {
    const rows = this.driver.query<MemoRow>(
      `SELECT id, project_id, title, content, target_type, target_id, author_id, created_at, updated_at
       FROM memos WHERE target_type = ? AND target_id = ? ORDER BY created_at DESC`,
      [targetType, targetId],
    );
    return rows.map(toMemo);
  }

  /**
   * Actualiza campos de un memo.
   *
   * @param id UUID del memo.
   * @param patch Campos a actualizar (title, body, targetType, targetId).
   * @returns Memo actualizado o undefined si no existe.
   */
  update(id: string, patch: {
    title?: string;
    body?: string;
    targetType?: MemoTargetType | null;
    targetId?: string | null;
  }): Memo | undefined {
    const memo = this.get(id);
    if (!memo) return undefined;

    const updates: string[] = [];
    const params: unknown[] = [];

    if (patch.title !== undefined) {
      updates.push('title = ?');
      params.push(patch.title);
    }
    if (patch.body !== undefined) {
      updates.push('content = ?');
      params.push(patch.body);
    }
    if (patch.targetType !== undefined) {
      updates.push('target_type = ?');
      params.push(patch.targetType);
    }
    if (patch.targetId !== undefined) {
      updates.push('target_id = ?');
      params.push(patch.targetId);
    }

    if (updates.length === 0) return memo;

    updates.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);

    this.driver.run(
      `UPDATE memos SET ${updates.join(', ')} WHERE id = ?`,
      params,
    );

    return this.get(id);
  }

  /**
   * Elimina un memo.
   *
   * @param id UUID del memo.
   * @returns true si se eliminó, false si no existía.
   */
  remove(id: string): boolean {
    const result = this.driver.run(
      `DELETE FROM memos WHERE id = ?`,
      [id],
    );
    return result.changes > 0;
  }
}