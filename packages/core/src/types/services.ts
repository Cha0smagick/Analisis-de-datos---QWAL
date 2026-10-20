/**
 * Contratos del núcleo: extras, importadores, búsqueda y análisis.
 * Las implementaciones viven en `../services/`, `../analysis/` e `../importers/`.
 */

import type {
  DocumentCodeMatrix,
  CodeFrequencyReport,
  CooccurrenceMatrix,
  FleissKappaReport,
  FrameworkMatrixReport,
  InterRaterReport,
  JaccardMatrix,
  KrippendorffAlphaReport,
  KwicReport,
  WordFrequencyReport,
} from './analysis.js';
import type { FileType, ImportResult, SearchHit } from './domain.js';

// ---------------------------------------------------------------------------
// Fuente de archivo (abstracción sobre File del navegador / FS de Node)
// ---------------------------------------------------------------------------

export interface FileSource {
  name: string;
  /** Ruta relativa (Node) o nombre completo (web). */
  path?: string;
  size?: number;
  mimeType?: string;
  readText(): Promise<string>;
  readBuffer(): Promise<Uint8Array>;
}

// ---------------------------------------------------------------------------
// Extractor de texto (por tipo de archivo)
// ---------------------------------------------------------------------------

export interface TextExtraction {
  text: string;
  /** Advertencias no fatales (p.ej. página ilegible). */
  warnings: string[];
}

export interface TextExtractor {
  /** Si el extractor sabe procesar este tipo de archivo. */
  canHandle(fileType: FileType, mimeType?: string): boolean;
  extract(file: FileSource): Promise<TextExtraction>;
}

// ---------------------------------------------------------------------------
// Importador de documentos
// ---------------------------------------------------------------------------

export interface ImportOptions {
  language?: string;
  /** Sobrescribir documento existente con el mismo nombre. */
  overwrite?: boolean;
}

export interface DocumentImporter {
  /** Necesita la instancia del proyecto destino. */
  readonly supportedTypes: ReadonlySet<FileType>;
  importInto(projectId: string, file: FileSource, fileType: FileType, options?: ImportOptions): Promise<ImportResult>;
  importText(projectId: string, title: string, text: string, options?: ImportOptions): Promise<ImportResult>;
}

// ---------------------------------------------------------------------------
// Búsqueda full-text (FTS5)
// ---------------------------------------------------------------------------

export interface SearchOptions {
  limit?: number;
  offset?: number;
  /** Ventana NEAR (en tokens) para búsqueda de proximidad FTS5; entero positivo. */
  near?: number;
}

export interface SearchService {
  search(projectId: string, query: string, options?: SearchOptions): Promise<SearchHit[]>;
}

// ---------------------------------------------------------------------------
// Análisis
// ---------------------------------------------------------------------------

export interface AnalysisService {
  codeFrequencies(projectId: string): CodeFrequencyReport;
  cooccurrence(projectId: string): CooccurrenceMatrix;
  documentCodeMatrix(projectId: string): DocumentCodeMatrix;
  wordFrequencies(projectId: string, language?: string, limit?: number): WordFrequencyReport;
  interRater(projectId: string): InterRaterReport;
  frameworkMatrix(projectId: string): FrameworkMatrixReport;
  jaccard(projectId: string, options?: { includeDescendants?: boolean }): JaccardMatrix;
  kwic(projectId: string, term: string, options?: { window?: number }): KwicReport;
  fleissKappa(projectId: string): FleissKappaReport;
  krippendorffAlpha(projectId: string): KrippendorffAlphaReport;
}

// ---------------------------------------------------------------------------
// Auditoría
// ---------------------------------------------------------------------------

/** Una entrada a registrar en `audit_log`. */
export interface AuditEntryInput {
  projectId: string | null;
  researcherId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  details: Record<string, unknown>;
}

export interface AuditService {
  /**
   * Añade una entrada a la cadena de auditoría.
   *
   * Deliberadamente síncrono: el driver es síncrono y la lectura de `prev_hash` más el
   * INSERT deben ocurrir en una sola transacción para que la cadena no se pueda bifurcar.
   */
  record(entry: AuditEntryInput): void;

  /**
   * Recalcula la cadena completa. Devuelve `null` si es íntegra, o la fila donde se rompe
   * con el motivo. Es la contraparte verificable de `record()`.
   */
  verifyChain(): { id: number; reason: string } | null;
}