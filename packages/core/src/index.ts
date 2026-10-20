/**
 * QualiCanvas Core — Barril público del paquete.
 *
 * Exporta toda la API pública consumible por packages/desktop, packages/server,
 * tests y consumidores externos.
 * Solo re-exporta desde rutas internas relativas; no expone detalles de implementación privada.
 */

// ============================================================================
// Types — Tipos de dominio y contratos
// ============================================================================

// Domain types (entidades, DTOs, filas)
export type * from './types/domain.js';

// Analysis types (reportes, matrices)
export type * from './types/analysis.js';

// Services contracts (interfaces de servicios)
export type * from './types/services.js';

// Errores de dominio (códigos estables para que el IPC/HTTP no compare textos)
export {
  DomainError,
  NotFoundError,
  WrongProjectError,
  InvalidInputError,
  ConflictError,
} from './types/errors.js';
export type { DomainErrorCode } from './types/errors.js';

// JSON utilities
export type * from './types/json.js';

// ============================================================================
// Database driver
// ============================================================================

export {
  NodeSqliteDriver,
  SqlJsDriver,
  openDriver,
} from './db/driver.js';
export type {
  DbDriver,
  NodeDriverOptions,
  SqlJsDriverOptions,
  CreateDriverOptions,
} from './db/driver.js';

// ============================================================================
// Schema & Migrations
// ============================================================================

export { SCHEMA_VERSION, migrate, getUserVersion, optimizeFullText } from './schema/migrations.js';

// ============================================================================
// Utilities
// ============================================================================

export { newId, nowIso } from './util/id.js';

// Normalización de texto compartida (tokenización idéntica a la de FTS5)
export { foldText, tokenize, tokenizeWithOffsets } from './util/text.js';
export type { Token } from './util/text.js';

// ============================================================================
// Repositories (Unidad A)
// ============================================================================

// Re-exporta todos los repositorios desde su barril
export * from './repos/index.js';

// ============================================================================
// Importers
// ============================================================================

// Re-exporta explícitamente para evitar conflictos de nombres (ImportResult, FileType)
export { SqliteDocumentImporter, NodeFileSource } from './imports/index.js';
export type { FileSource } from './types/services.js';
export type { TextExtractor, TextExtraction } from './types/services.js';
export type { DocumentImporter, ImportOptions } from './types/services.js';
export type { ImportResult } from './types/domain.js';

// ============================================================================
// Services (Unidad B - Análisis, Búsqueda, Auditoría)
// ============================================================================

export { AnalysisServiceImpl } from './services/analysis.service.js';
export { SearchServiceImpl } from './services/search.service.js';
export { AuditServiceImpl } from './services/audit.service.js';

// ============================================================================
// Coding Service
// ============================================================================

export { CodingService } from './coding/coding.service.js';

// ============================================================================
// Session (Fachada principal)
// ============================================================================

export { Session } from './session/session.js';
export type { SessionRepos, SessionServices } from './session/session.js';