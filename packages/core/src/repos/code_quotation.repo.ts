/**
 * Repositorio dedicado a la tabla puente `code_quotation`.
 *
 * Encapsula las asignaciones código↔cita y las consultas de codificación por
 * proyecto e investigador. Todos los métodos son SÍNCRONOS (compatible con DbDriver).
 *
 * Un registro por (código, cita, investigador). `researcher_id = NULL` significa una
 * codificación sin investigador attributed (el investigator por defecto del proyecto).
 */

import type { DbDriver } from '../db/driver.js';
import type { CodeQuotation, CodeQuotationRow } from '../types/domain.js';
import { newId, nowIso } from '../util/id.js';

/** El alias es obligatorio: esta tabla se une con `codes`, que también tiene `id`. */
function columns(alias = ''): string {
  const prefix = alias ? `${alias}.` : '';
  return [
    `${prefix}id`,
    `${prefix}code_id`,
    `${prefix}quotation_id`,
    `${prefix}researcher_id`,
    `${prefix}created_at`,
  ].join(', ');
}

function toCodeQuotation(row: CodeQuotationRow): CodeQuotation {
  return {
    id: row.id,
    codeId: row.code_id,
    quotationId: row.quotation_id,
    researcherId: row.researcher_id,
    createdAt: row.created_at,
  };
}

export class CodeQuotationRepository {
  constructor(private readonly driver: DbDriver) {}

  /**
   * Todas las asignaciones de un proyecto, un registro por (código, cita, investigador).
   * Son las filas que alimentan frecuencias, co-ocurrencia, IRR y matriz documento×código.
   */
  listByProject(projectId: string): CodeQuotation[] {
    return this.driver
      .query<CodeQuotationRow>(
        `SELECT ${columns('cq')} FROM code_quotation cq
         JOIN codes c ON cq.code_id = c.id
         WHERE c.project_id = ?
         ORDER BY cq.created_at, cq.id`,
        [projectId],
      )
      .map(toCodeQuotation);
  }

  /**
   * Asigna un código a una cita. Idempotente: si ese investigador ya la tenía asignada
   * no se inserta un duplicado (índices parciales `ux_cq_anon` / `ux_cq_res`).
   *
   * @returns `true` si se insertó una asignación nueva, `false` si ya existía.
   */
  add(codeId: string, quotationId: string, researcherId: string | null): boolean {
    const result = this.driver.run(
      `INSERT OR IGNORE INTO code_quotation (id, code_id, quotation_id, researcher_id, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [newId(), codeId, quotationId, researcherId, nowIso()],
    );
    return result.changes > 0;
  }

  /**
   * Elimina la asignación de un código a una cita.
   *
   * @param researcherId si se indica, solo se borra la codificación de ese investigador;
   *   si es `null` se borran todas las de ese par código/cita.
   * @returns `true` si se eliminó al menos una fila.
   */
  remove(codeId: string, quotationId: string, researcherId: string | null = null): boolean {
    const sql =
      researcherId === null
        ? `DELETE FROM code_quotation WHERE code_id = ? AND quotation_id = ?`
        : `DELETE FROM code_quotation WHERE code_id = ? AND quotation_id = ? AND researcher_id = ?`;
    const params = researcherId === null ? [codeId, quotationId] : [codeId, quotationId, researcherId];
    return this.driver.run(sql, params).changes > 0;
  }

  /**
   * Elimina todas las asignaciones de una cita.
   *
   * @param researcherId si se indica, solo se borran las codificaciones de ese
   *   investigador — es lo que usa `setQuotationCodes` para no destruir el trabajo de
   *   los demás. Si es `null` se borran todas.
   */
  removeAllForQuotation(quotationId: string, researcherId: string | null = null): void {
    if (researcherId === null) {
      this.driver.run(`DELETE FROM code_quotation WHERE quotation_id = ?`, [quotationId]);
      return;
    }
    this.driver.run(`DELETE FROM code_quotation WHERE quotation_id = ? AND researcher_id = ?`, [
      quotationId,
      researcherId,
    ]);
  }

  /** Códigos asignados a una cita, indicando qué investigador hizo cada asignación. */
  codesForQuotation(quotationId: string): Array<{ codeId: string; researcherId: string | null }> {
    return this.driver
      .query<CodeQuotationRow>(
        `SELECT ${columns()} FROM code_quotation WHERE quotation_id = ? ORDER BY created_at, id`,
        [quotationId],
      )
      .map(row => ({ codeId: row.code_id, researcherId: row.researcher_id }));
  }

  /**
   * Códigos distintos de cada cita del proyecto.
   *
   * Deduplica por (cita, código) aunque varios investigadores hayan codificado: para
   * co-ocurrencia y Jaccard lo que cuenta es la evidencia, no cuántos la marcaron.
   */
  distinctCodesByQuotation(projectId: string): Map<string, Set<string>> {
    const rows = this.driver.query<{ quotation_id: string; code_id: string }>(
      `SELECT DISTINCT cq.quotation_id, cq.code_id
       FROM code_quotation cq
       JOIN codes c ON cq.code_id = c.id
       WHERE c.project_id = ?`,
      [projectId],
    );
    const byQuotation = new Map<string, Set<string>>();
    for (const row of rows) {
      const set = byQuotation.get(row.quotation_id);
      if (set) set.add(row.code_id);
      else byQuotation.set(row.quotation_id, new Set([row.code_id]));
    }
    return byQuotation;
  }

  /**
   * Codificaciones de cada investigador: `researcherId -> Set("codeId\u0000quotationId")`.
   *
   * Es la unidad de acuerdo correcta para Cohen/Fleiss/Krippendorff: una decisión de
   * codificación es un par (código, cita), no "el investigador tocó esta cita".
   */
  codingsByResearcher(projectId: string): Map<string, Set<string>> {
    const rows = this.driver.query<{ researcher_id: string; code_id: string; quotation_id: string }>(
      `SELECT cq.researcher_id, cq.code_id, cq.quotation_id
       FROM code_quotation cq
       JOIN codes c ON cq.code_id = c.id
       WHERE c.project_id = ? AND cq.researcher_id IS NOT NULL
       ORDER BY cq.created_at, cq.id`,
      [projectId],
    );
    const byResearcher = new Map<string, Set<string>>();
    for (const row of rows) {
      const key = `${row.code_id}\u0000${row.quotation_id}`;
      const set = byResearcher.get(row.researcher_id);
      if (set) set.add(key);
      else byResearcher.set(row.researcher_id, new Set([key]));
    }
    return byResearcher;
  }

  /**
   * Número de citas DISTINTAS codificadas por cada investigador en el proyecto.
   * Se usa para densidad de codificación, donde contar asignaciones sobrestimaría a quien
   * aplicó tres códigos a la misma cita.
   */
  countDistinctQuotationsByResearcher(projectId: string): Map<string, number> {
    const rows = this.driver.query<{ researcher_id: string; count: number }>(
      `SELECT cq.researcher_id AS researcher_id, COUNT(DISTINCT cq.quotation_id) AS count
       FROM code_quotation cq
       JOIN codes c ON cq.code_id = c.id
       WHERE c.project_id = ? AND cq.researcher_id IS NOT NULL
       GROUP BY cq.researcher_id`,
      [projectId],
    );
    return new Map(rows.map(row => [row.researcher_id, row.count]));
  }
}
