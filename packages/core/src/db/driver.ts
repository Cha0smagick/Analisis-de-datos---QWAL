/**
 * Abstracción de acceso a SQLite.
 *
 * Dos implementaciones:
 *   · NodeSqliteDriver   — better-sqlite3 (Node.js, síncrono, WAL).
 *   · SqlJsDriver        — sql.js / WASM (navegador, async init).
 *
 * El resto del núcleo depende SOLO de la interfaz `DbDriver`, de modo que las
 * migraciones, repositorios y servicios funcionan igual en Node y en el navegador.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** Error único del driver: distingue "base cerrada" de un fallo de SQL real. */
export class DbDriverClosedError extends Error {
  constructor() {
    super('DbDriver cerrado');
    this.name = 'DbDriverClosedError';
  }
}

/** Mínimo común que necesitan migraciones, repositorios y servicios. */
export interface DbDriver {
  readonly isOpen: boolean;

  /** SELECT con parámetros posicionales `?`. Devuelve filas como objetos. */
  query<T>(sql: string, params?: readonly unknown[]): T[];

  /** INSERT/UPDATE/DELETE/PRAGMA que no devuelve filas. Devuelve número de filas afectadas. */
  run(sql: string, params?: readonly unknown[]): { changes: number };

  /** Ejecuta SQL multi-sentencia (migraciones, semillas). */
  exec(sql: string): void;

  /**
   * Ejecuta `fn` dentro de una transacción. Es reentrante: las llamadas anidadas
   * usan SAVEPOINT, igual que hace better-sqlite3 de forma nativa.
   */
  transaction<T>(fn: () => T): T;

  close(): void;
}

// ---------------------------------------------------------------------------
// better-sqlite3 (Node.js)
// ---------------------------------------------------------------------------

// better-sqlite3 exporta Database y Statement como clases, pero NO DatabaseConstructor.
// Definimos el tipo de constructor localmente a partir de sus exports reales.
type BetterDatabase = import('better-sqlite3').Database;
// Usamos una firma de constructor (new ...) para que `new Database(...)` sea válido.
type DatabaseConstructor = new (filename: string, options?: { readonly?: boolean; fileMustExist?: boolean; timeout?: number; verbose?: (sql: string) => void }) => BetterDatabase;

export interface NodeDriverOptions {
  /** Ruta del archivo DB. `:memory:` para base efímera. */
  filename?: string;
  /**
   * Habilitar WAL + foreign_keys al abrir. Útil para tests; las migraciones
   * asumen que el driver ya configuró estas PRAGMAs.
   */
  pragmas?: boolean;
}

export class NodeSqliteDriver implements DbDriver {
  private closed = false;

  private readonly db: BetterDatabase;

  constructor(options: NodeDriverOptions = {}) {
    const { filename = ':memory:', pragmas = true } = options;
    // better-sqlite3 es CommonJS: se carga con createRequire (un require()
    // plano no es válido en un paquete con "type": "module").
    const Database = require('better-sqlite3') as DatabaseConstructor;
    this.db = new Database(filename);
    if (pragmas) {
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('foreign_keys = ON');
      // Sin recursive_triggers los triggers DELETE/UPDATE no se disparan para las
      // filas que borra un ON DELETE CASCADE, lo que deja obsoleta la caché de
      // co-ocurrencia al eliminar citas o códigos.
      this.db.pragma('recursive_triggers = ON');
    }
  }

  get isOpen(): boolean {
    return !this.closed && this.db.open;
  }

  query<T>(sql: string, params?: readonly unknown[]): T[] {
    this.assertOpen();
    return (params && params.length > 0
      ? this.db.prepare(sql).all(...params)
      : this.db.prepare(sql).all()) as T[];
  }

  run(sql: string, params?: readonly unknown[]): { changes: number } {
    this.assertOpen();
    if (params && params.length > 0) return this.db.prepare(sql).run(...params);
    else return this.db.prepare(sql).run();
  }

  exec(sql: string): void {
    this.assertOpen();
    this.db.exec(sql);
  }

  transaction<T>(fn: () => T): T {
    this.assertOpen();
    // better-sqlite3 resuelve el anidamiento con SAVEPOINT automáticamente.
    return this.db.transaction(fn)();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }

  private assertOpen(): void {
    if (this.closed) throw new DbDriverClosedError();
  }
}

// ---------------------------------------------------------------------------
// sql.js (navegador / WASM)
// ---------------------------------------------------------------------------

export interface SqlJsDriverOptions {
  /** URL del wasm. Si no se da, sql.js usa su estrategia por defecto. */
  locateFile?: (file: string) => string;
  /** Base inicial en bytes (export previo). */
  initialData?: Uint8Array;
}

/** Sentencias de control transaccional: no producen "changes" y no deben consultarse. */
const TX_CONTROL = /^\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|END)\b/i;

export class SqlJsDriver implements DbDriver {
  private db: import('sql.js').Database | null = null;

  private txDepth = 0;

  private constructor() {}

  static async create(options: SqlJsDriverOptions = {}): Promise<SqlJsDriver> {
    const driver = new SqlJsDriver();
    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs(
      options.locateFile ? { locateFile: options.locateFile } : undefined,
    );
    driver.db = options.initialData ? new SQL.Database(options.initialData) : new SQL.Database();
    // Sin este PRAGMA la base WASM ignora TODAS las foreign keys, lo que
    // desactiva ON DELETE CASCADE y los CHECK de integridad: la semántica de
    // datos sería distinta de la del driver nativo. Debe ser equivalente.
    driver.exec('PRAGMA foreign_keys = ON;');
    // Ver NodeSqliteDriver: sin esto los triggers de mantenimiento de la caché de
    // co-ocurrencia no se disparan en los borrados en cascada.
    driver.exec('PRAGMA recursive_triggers = ON;');
    return driver;
  }

  get isOpen(): boolean {
    return this.db !== null;
  }

  /** Serializa la base completa (para persistencia en navegador). */
  exportDatabase(): Uint8Array {
    return this.assertOpen().export();
  }

  query<T>(sql: string, params?: readonly unknown[]): T[] {
    const stmt = this.assertOpen().prepare(sql);
    try {
      if (params && params.length > 0) {
        stmt.bind(params as Array<number | string | Uint8Array | null>);
      }
      const rows: T[] = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as T);
      }
      return rows;
    } finally {
      stmt.free();
    }
  }

  run(sql: string, params?: readonly unknown[]): { changes: number } {
    const db = this.assertOpen();
    if (params && params.length > 0) {
      db.run(sql, params as Array<number | string | Uint8Array | null>);
    } else {
      db.run(sql);
    }
    if (TX_CONTROL.test(sql)) return { changes: 0 };
    // sql.js no expone changes en la API de sentencia; `changes()` es la única vía.
    const result = db.exec('SELECT changes() AS changes');
    return { changes: (result[0]?.values[0]?.[0] as number | undefined) ?? 0 };
  }

  exec(sql: string): void {
    this.assertOpen().exec(sql);
  }

  transaction<T>(fn: () => T): T {
    this.assertOpen();
    const depth = this.txDepth;
    const savepoint = `qc_sp_${depth}`;
    if (depth === 0) this.run('BEGIN');
    else this.run(`SAVEPOINT ${savepoint}`);
    this.txDepth = depth + 1;
    try {
      const result = fn();
      if (depth === 0) this.run('COMMIT');
      else this.run(`RELEASE ${savepoint}`);
      this.txDepth = depth;
      return result;
    } catch (err) {
      try {
        if (depth === 0) {
          this.run('ROLLBACK');
        } else {
          this.run(`ROLLBACK TO ${savepoint}`);
          this.run(`RELEASE ${savepoint}`);
        }
      } catch {
        // La base ya está inconsistente; se preserva el error original.
      }
      this.txDepth = depth;
      throw err;
    }
  }

  close(): void {
    this.db?.close();
    this.db = null;
    this.txDepth = 0;
  }

  private assertOpen(): import('sql.js').Database {
    if (!this.db) throw new DbDriverClosedError();
    return this.db;
  }
}

// ---------------------------------------------------------------------------
// Fábrica unificada
// ---------------------------------------------------------------------------

export interface CreateDriverOptions {
  /** 'node' (default) o 'sqljs' (para entorno browser). */
  backend?: 'node' | 'sqljs';
  filename?: string;
  initialData?: Uint8Array;
  locateFile?: (file: string) => string;
}

/** `sqljs` devuelve promesa porque la inicialización WASM es asíncrona. */
export function openDriver(options: CreateDriverOptions & { backend: 'node' }): DbDriver;
export function openDriver(options: CreateDriverOptions & { backend: 'sqljs' }): Promise<DbDriver>;
export function openDriver(options?: CreateDriverOptions): DbDriver | Promise<DbDriver>;
export function openDriver(options: CreateDriverOptions = {}): DbDriver | Promise<DbDriver> {
  const { backend = 'node' } = options;
  if (backend === 'sqljs') {
    return SqlJsDriver.create({
      locateFile: options.locateFile,
      initialData: options.initialData,
    });
  }
  return new NodeSqliteDriver({ filename: options.filename ?? ':memory:' });
}
