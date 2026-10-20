/**
 * Repositorio de códigos (árbol jerárquico) y familias de códigos.
 *
 * Capa de acceso a datos para las tablas `codes`, `code_families`, `code_family_codes`.
 * Traduce filas snake_case a objetos de dominio camelCase.
 * Incluye detección de ciclos al mover nodos y operaciones de árbol recursivas.
 */

import type { DbDriver } from '../db/driver.js';
import type { Code, CodeRow, CodeTreeNode, CodeFamily, CodeFamilyRow } from '../types/domain.js';

/** Mapea CodeRow → Code (snake_case → camelCase). */
function toCode(row: CodeRow): Code {
  return {
    id: row.id,
    projectId: row.project_id,
    parentId: row.parent_id,
    name: row.name,
    color: row.color,
    description: row.description,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Mapea CodeFamilyRow + codeIds → CodeFamily. */
function toCodeFamily(row: CodeFamilyRow, codeIds: string[]): CodeFamily {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    color: row.color,
    codeIds,
    createdAt: row.created_at,
  };
}

/**
 * La unicidad del nombre de código la garantizan dos índices parciales
 * (`ux_codes_root_name` para raíces y `ux_codes_child_name` para hijos) en vez
 * de un `UNIQUE (project_id, parent_id, name)`: en SQLite una columna NULL
 * hace que la restricción no se aplique, de modo que dos raíces con el mismo
 * nombre convivían. SQLite nombra el índice, no las columnas, en el mensaje de
 * error, así que el patrón debe buscar esos nombres.
 */
function isDuplicateCodeName(err: Error): boolean {
  return /UNIQUE constraint failed: index 'ux_codes_(root|child)_name'/i.test(err.message);
}

export class CodeRepository {
  constructor(private readonly driver: DbDriver) {}

  /**
   * Crea un nuevo código en un proyecto.
   *
   * @param projectId UUID del proyecto.
   * @param input Datos del código (id se genera automáticamente).
   * @returns El código creado.
   * @throws Error si ya existe un código con ese nombre bajo el mismo padre.
   */
  create(projectId: string, input: {
    name: string;
    parentId?: string | null;
    color?: string | null;
    description?: string;
    createdBy?: string | null;
  }): Code {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    // Verificar que parentId pertenece al mismo proyecto si se proporciona
    if (input.parentId) {
      const parent = this.get(input.parentId);
      if (!parent || parent.projectId !== projectId) {
        throw new Error('El código padre no pertenece al mismo proyecto');
      }
    }

    try {
      this.driver.run(
        `INSERT INTO codes (id, project_id, parent_id, name, color, description, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, projectId, input.parentId ?? null, input.name, input.color ?? null, input.description ?? '', input.createdBy ?? null, now, now],
      );
    } catch (err) {
      if (err instanceof Error && isDuplicateCodeName(err)) {
        throw new Error('Ya existe un código con ese nombre bajo el mismo padre');
      }
      throw err;
    }

    const created = this.get(id);
    if (!created) throw new Error(`No se pudo releer el código recién creado: ${id}`);
    return created;
  }

  /**
   * Obtiene un código por su id.
   *
   * @param id UUID del código.
   * @returns Código o undefined si no existe.
   */
  get(id: string): Code | undefined {
    const rows = this.driver.query<CodeRow>(
      `SELECT id, project_id, parent_id, name, color, description, created_by, created_at, updated_at
       FROM codes WHERE id = ?`,
      [id],
    );
    return rows[0] ? toCode(rows[0]) : undefined;
  }

  /**
   * Lista todos los códigos de un proyecto (plano, no árbol).
   *
   * @param projectId UUID del proyecto.
   * @returns Array de códigos ordenados por nombre.
   */
  listByProject(projectId: string): Code[] {
    const rows = this.driver.query<CodeRow>(
      `SELECT id, project_id, parent_id, name, color, description, created_by, created_at, updated_at
       FROM codes WHERE project_id = ? ORDER BY name`,
      [projectId],
    );
    return rows.map(toCode);
  }

  /**
   * Construye el árbol completo de códigos de un proyecto.
   *
   * @param projectId UUID del proyecto.
   * @returns Array de nodos raíz con children recursivos y path calculado.
   */
  tree(projectId: string): CodeTreeNode[] {
    const rows = this.driver.query<CodeRow>(
      `SELECT id, project_id, parent_id, name, color, description, created_by, created_at, updated_at
       FROM codes WHERE project_id = ? ORDER BY name`,
      [projectId],
    );

    const codeMap = new Map<string, CodeTreeNode>();
    const childrenMap = new Map<string, string[]>();

    // Crear nodos base
    for (const row of rows) {
      const code = toCode(row);
      const node: CodeTreeNode = {
        ...code,
        depth: 0,
        path: '',
        children: [],
      };
      codeMap.set(code.id, node);
      if (code.parentId) {
        const siblings = childrenMap.get(code.parentId) ?? [];
        siblings.push(code.id);
        childrenMap.set(code.parentId, siblings);
      }
    }

    // Construir árbol recursivamente
    function buildNode(codeId: string, depth: number, path: string): CodeTreeNode {
      const node = codeMap.get(codeId)!;
      const newPath = path ? `${path} / ${node.name}` : node.name;
      const childIds = childrenMap.get(codeId) ?? [];
      const children = childIds.map((childId) => buildNode(childId, depth + 1, newPath));
      return { ...node, depth, path: newPath, children };
    }

    // Raíces = códigos sin parentId
    const rootIds = rows.filter((r) => r.parent_id === null).map((r) => r.id);
    return rootIds.map((id) => buildNode(id, 0, ''));
  }

  /**
   * Actualiza campos de un código.
   *
   * @param id UUID del código.
   * @param patch Campos a actualizar (name, color, description).
   * @returns Código actualizado o undefined si no existe.
   * @throws Error si el nuevo nombre ya existe bajo el mismo padre.
   */
  update(id: string, patch: { name?: string; color?: string | null; description?: string }): Code | undefined {
    const code = this.get(id);
    if (!code) return undefined;

    const updates: string[] = [];
    const params: unknown[] = [];

    if (patch.name !== undefined) {
      updates.push('name = ?');
      params.push(patch.name);
    }
    if (patch.color !== undefined) {
      updates.push('color = ?');
      params.push(patch.color);
    }
    if (patch.description !== undefined) {
      updates.push('description = ?');
      params.push(patch.description);
    }

    if (updates.length === 0) return code;

    updates.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);

    try {
      this.driver.run(
        `UPDATE codes SET ${updates.join(', ')} WHERE id = ?`,
        params,
      );
    } catch (err) {
      if (err instanceof Error && isDuplicateCodeName(err)) {
        throw new Error('Ya existe un código con ese nombre bajo el mismo padre');
      }
      throw err;
    }

    return this.get(id);
  }

  /**
   * Mueve un código a un nuevo padre (detecta ciclos).
   *
   * @param id UUID del código a mover.
   * @param newParentId UUID del nuevo padre o null para raíz.
   * @returns Código actualizado.
   * @throws Error si newParentId es el mismo id, es descendiente de id, o no pertenece al mismo proyecto.
   */
  move(id: string, newParentId: string | null): Code {
    const code = this.get(id);
    if (!code) throw new Error('Código no encontrado');

    // Mismo id
    if (newParentId === id) {
      throw new Error('Un código no puede ser su propio padre');
    }

    // Si newParentId no es null, verificar que pertenece al mismo proyecto y no es descendiente
    if (newParentId !== null) {
      const newParent = this.get(newParentId);
      if (!newParent) throw new Error('Código padre no encontrado');
      if (newParent.projectId !== code.projectId) {
        throw new Error('El código padre no pertenece al mismo proyecto');
      }

      // Detectar ciclos: recorrer ancestros de newParentId buscando id
      let currentId: string | null = newParentId;
      while (currentId !== null) {
        if (currentId === id) {
          throw new Error('Mover aquí crearía un ciclo: el nuevo padre es descendiente del código');
        }
        const parent = this.get(currentId);
        currentId = parent?.parentId ?? null;
      }
    }

    this.driver.run(
      `UPDATE codes SET parent_id = ?, updated_at = ? WHERE id = ?`,
      [newParentId, new Date().toISOString(), id],
    );

    const moved = this.get(id);
    if (!moved) throw new Error(`No se pudo releer el código movido: ${id}`);
    return moved;
  }

  /**
   * Elimina un código en cascada (hijos, code_quotation, familias).
   *
   * @param id UUID del código.
   * @returns true si se eliminó, false si no existía.
   */
  remove(id: string): boolean {
    const result = this.driver.run(
      `DELETE FROM codes WHERE id = ?`,
      [id],
    );
    return result.changes > 0;
  }

  // ==================== FAMILIAS DE CÓDIGOS ====================

  /**
   * Crea una nueva familia de códigos en un proyecto.
   *
   * @param projectId UUID del proyecto.
   * @param input Datos de la familia (id se genera automáticamente).
   * @returns La familia creada.
   * @throws Error si ya existe una familia con ese nombre en el proyecto.
   */
  createFamily(projectId: string, input: { name: string; color?: string | null; description?: string }): CodeFamily {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    try {
      this.driver.run(
        `INSERT INTO code_families (id, project_id, name, color, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [id, projectId, input.name, input.color ?? null, now],
      );
    } catch (err) {
      if (err instanceof Error && /UNIQUE constraint failed: code_families\.project_id, code_families\.name/i.test(err.message)) {
        throw new Error('Ya existe una familia con ese nombre en este proyecto');
      }
      throw err;
    }

    const created = this.getFamily(id);
    if (!created) throw new Error(`No se pudo releer la familia recién creada: ${id}`);
    return created;
  }

  /**
   * Obtiene una familia por su id con codeIds poblado.
   *
   * @param id UUID de la familia.
   * @returns Familia con codeIds o undefined si no existe.
   */
  getFamily(id: string): CodeFamily | undefined {
    const familyRows = this.driver.query<CodeFamilyRow>(
      `SELECT id, project_id, name, color, created_at FROM code_families WHERE id = ?`,
      [id],
    );
    if (!familyRows[0]) return undefined;

    const codeRows = this.driver.query<{ code_id: string }>(
      `SELECT code_id FROM code_family_codes WHERE family_id = ?`,
      [id],
    );
    const codeIds = codeRows.map((r) => r.code_id);

    return toCodeFamily(familyRows[0], codeIds);
  }

  /**
   * Lista todas las familias de un proyecto con codeIds poblado.
   *
   * @param projectId UUID del proyecto.
   * @returns Array de familias.
   */
  listFamilies(projectId: string): CodeFamily[] {
    const familyRows = this.driver.query<CodeFamilyRow>(
      `SELECT id, project_id, name, color, created_at FROM code_families WHERE project_id = ? ORDER BY name`,
      [projectId],
    );

    const families: CodeFamily[] = [];
    for (const row of familyRows) {
      const codeRows = this.driver.query<{ code_id: string }>(
        `SELECT code_id FROM code_family_codes WHERE family_id = ?`,
        [row.id],
      );
      families.push(toCodeFamily(row, codeRows.map((r) => r.code_id)));
    }
    return families;
  }

  /**
   * Añade un código a una familia (ignora duplicados por PRIMARY KEY).
   *
   * @param familyId UUID de la familia.
   * @param codeId UUID del código.
   */
  addCodeToFamily(familyId: string, codeId: string): void {
    this.driver.run(
      `INSERT OR IGNORE INTO code_family_codes (family_id, code_id) VALUES (?, ?)`,
      [familyId, codeId],
    );
  }

  /**
   * Quita un código de una familia.
   *
   * @param familyId UUID de la familia.
   * @param codeId UUID del código.
   * @returns true si se eliminó, false si no existía la asociación.
   */
  removeCodeFromFamily(familyId: string, codeId: string): boolean {
    const result = this.driver.run(
      `DELETE FROM code_family_codes WHERE family_id = ? AND code_id = ?`,
      [familyId, codeId],
    );
    return result.changes > 0;
  }

  /**
   * Elimina una familia (cascada borra code_family_codes por FK).
   *
   * @param familyId UUID de la familia.
   * @returns true si se eliminó, false si no existía.
   */
  removeFamily(familyId: string): boolean {
    const result = this.driver.run(
      `DELETE FROM code_families WHERE id = ?`,
      [familyId],
    );
    return result.changes > 0;
  }
}