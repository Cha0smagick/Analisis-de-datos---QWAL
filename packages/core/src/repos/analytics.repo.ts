/**
 * Lectura de las tablas de soporte del análisis: `code_cooccurrence` y `stop_words`.
 *
 * No son entidades del dominio: las mantiene la propia base mediante triggers, así
 * que este repositorio es de solo lectura (salvo la reconstrucción explícita de la
 * caché). Existe para que los servicios no tengan que escribir SQL y para que la
 * propiedad de esas tablas quede en un único lugar.
 */

import type { DbDriver } from '../db/driver.js';

export interface CooccurrenceRow {
  codeA: string;
  codeB: string;
  /** Citas distintas en las que aparecen ambos códigos. */
  n: number;
}

export class AnalyticsRepository {
  constructor(private readonly driver: DbDriver) {}

  /**
   * Pares de códigos que comparten al menos una cita, tomados de la caché que
   * mantienen los triggers `cooc_inc`/`cooc_dec`. La caché cuenta citas distintas,
   * no asignaciones, de modo que dos investigaciones que codifican el mismo par no
   * lo inflan.
   */
  cooccurrence(projectId: string): CooccurrenceRow[] {
    return this.driver.query<CooccurrenceRow>(
      `SELECT cc.code_a AS codeA, cc.code_b AS codeB, cc.n AS n
         FROM code_cooccurrence cc
         JOIN codes ca ON ca.id = cc.code_a
         JOIN codes cb ON cb.id = cc.code_b
        WHERE ca.project_id = ? AND cb.project_id = ?
        ORDER BY cc.n DESC, cc.code_a, cc.code_b`,
      [projectId, projectId],
    );
  }

  /**
   * Recalcula `code_cooccurrence` desde cero.
   *
   * Los triggers solo se disparan para filas borradas explícitamente; los borrados
   * provocados por `ON DELETE CASCADE` dependen del PRAGMA `recursive_triggers`, que
   * los drivers activan, pero una base creada antes de esa configuración (o una
   * importación directa de SQL) puede dejar la caché desfasada. Esto la repara.
   */
  rebuildCooccurrence(): void {
    this.driver.transaction(() => {
      this.driver.run('DELETE FROM code_cooccurrence');
      this.driver.run(
        `INSERT INTO code_cooccurrence (code_a, code_b, n)
         SELECT MIN(a.code_id, b.code_id) AS code_a,
                MAX(a.code_id, b.code_id) AS code_b,
                COUNT(*) AS n
           FROM (SELECT DISTINCT quotation_id, code_id FROM code_quotation) a
           JOIN (SELECT DISTINCT quotation_id, code_id FROM code_quotation) b
             ON a.quotation_id = b.quotation_id
            AND a.code_id < b.code_id
          GROUP BY MIN(a.code_id, b.code_id), MAX(a.code_id, b.code_id)`,
      );
    });
  }

  /** Stopwords del idioma dado, en minúsculas. `language` es un código ISO 639-1. */
  stopWords(language: string): Set<string> {
    const rows = this.driver.query<{ word: string }>(
      'SELECT word FROM stop_words WHERE language = ?',
      [language.toLowerCase()],
    );
    return new Set(rows.map((row) => row.word));
  }

  /** Idiomas para los que hay lista de stopwords sembrada. */
  stopWordLanguages(): string[] {
    return this.driver
      .query<{ language: string }>('SELECT DISTINCT language FROM stop_words ORDER BY language')
      .map((row) => row.language);
  }
}
