/**
 * Declaraciones de tipos para dependencias sin tipos publicados (o con tipos
 * incompletos). Se mantienen aquí, en lugar de @types/*, para no generar
 * dependencias de dev adicionales y para reflejar solo el API que usamos.
 */

declare module 'pdf-parse' {
  export interface PdfParseInfo {
    PDFFormatVersion: string;
    IsAcroFormPresent: boolean;
    IsXFAPresent: boolean;
    [key: string]: unknown;
  }

  export interface PdfParseResult {
    numpages: number;
    numrender: number;
    info: PdfParseInfo;
    metadata: Record<string, unknown>;
    text: string;
    version: string;
  }

  interface PdfParseOptions {
    pagerender?: (pageData: unknown) => string;
    max?: number;
    version?: string;
  }

  function pdfParse(
    buffer: Buffer | Uint8Array,
    options?: PdfParseOptions,
  ): Promise<PdfParseResult>;

  export = pdfParse;
}

declare module 'sql.js' {
  export type SqlValue = number | string | Uint8Array | null;

  export interface QueryExecResult {
    columns: string[];
    values: SqlValue[][];
  }

  export interface Statement {
    bind(values?: SqlValue[]): boolean;
    step(): boolean;
    get(): SqlValue[];
    getAsObject(): Record<string, SqlValue>;
    getColumnNames(): string[];
    free(): void;
  }

  export interface Database {
    run(sql: string, params?: SqlValue[]): void;
    exec(sql: string): QueryExecResult[];
    prepare(sql: string): Statement;
    export(): Uint8Array;
    close(): void;
  }

  export interface SqlJsModule {
    Database: new (data?: Uint8Array) => Database;
  }

  export interface SqlJsConfig {
    locateFile?: (file: string) => string;
  }

  export function initSqlJs(config?: SqlJsConfig): Promise<SqlJsModule>;
  export default initSqlJs;
}