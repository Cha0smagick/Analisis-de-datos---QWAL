/**
 * Migraciones de esquema.
 * Aplica schema.sql + semillas secuencialmente y registra la versión en
 * `PRAGMA user_version`. Cada migración se ejecuta dentro de una transacción.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { DbDriver } from '../db/driver.js';

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));

interface Migration {
  version: number;
  files: string[];
}

/**
 * El esquema es único y completo: `schema.sql` describe el estado final, sin
 * parches acumulados. Un trigger roto se corrige en `schema.sql`, no en una
 * migración posterior que obligue a una instalación nueva a ejecutar primero la
 * versión defectuosa.
 */
const MIGRATIONS: Migration[] = [
  { version: 1, files: ['schema.sql', 'seed_stopwords.sql'] },
];

/** Versión del esquema que este build espera encontrar en la base de datos. */
export const SCHEMA_VERSION: number = MIGRATIONS[MIGRATIONS.length - 1]!.version;

function readSql(file: string): string {
  return readFileSync(path.join(CURRENT_DIR, file), 'utf-8');
}

export function getUserVersion(driver: DbDriver): number {
  const rows = driver.query<{ user_version: number }>('PRAGMA user_version');
  return rows[0]?.user_version ?? 0;
}

export function migrate(driver: DbDriver): void {
  const current = getUserVersion(driver);
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    driver.transaction(() => {
      for (const file of migration.files) {
        // PRAGMA journal_mode/foreign_keys se configuran a nivel de driver.
        driver.exec(readSql(file));
      }
      driver.run(`PRAGMA user_version = ${migration.version}`);
    });
  }
}

/** Reconstruye y optimiza los índices FTS5 (útil tras importaciones masivas). */
export function optimizeFullText(driver: DbDriver): void {
  driver.exec("INSERT INTO documents_fts(documents_fts) VALUES ('optimize');");
  driver.exec("INSERT INTO quotations_fts(quotations_fts) VALUES ('optimize');");
}
