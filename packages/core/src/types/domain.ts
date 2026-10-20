/**
 * Tipos de dominio de QualiCanvas.
 *
 * Cada entidad tiene DOS representaciones:
 *   · `…Row`  — fila cruda de SQLite (columnas snake_case, valores DB).
 *   · `…`     — objeto de dominio compacto (camelCase) para el resto del núcleo.
 *
 * Los id son UUID v4 (TEXT). Timestamps ISO-8601 UTC (ms).
 */

import type { JsonObject } from './json.js';

// ---------------------------------------------------------------------------
// Proyecto
// ---------------------------------------------------------------------------

export interface ProjectRow {
  id: string;
  name: string;
  description: string;
  settings_json: string;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  settings: JsonObject;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Investigadores (codificadores, para fiabilidad inter-juez)
// ---------------------------------------------------------------------------

export interface ResearcherRow {
  id: string;
  project_id: string;
  name: string;
  initials: string | null;
  color: string | null;
  is_primary: 0 | 1;
  created_at: string;
}

export interface Researcher {
  id: string;
  projectId: string;
  name: string;
  initials: string | null;
  color: string | null;
  isPrimary: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Documentos (fuentes primarias)
// ---------------------------------------------------------------------------

export type FileType =
  | 'pdf' | 'docx' | 'txt' | 'md' | 'rtf' | 'odt' | 'html'
  | 'mp3' | 'wav' | 'm4a' | 'mp4' | 'webm' | 'mkv'
  | 'jpg' | 'png' | 'webp'
  | 'csv' | 'xlsx' | 'ods' | 'json'
  | 'other';

export interface DocumentRow {
  id: string;
  project_id: string;
  title: string;
  file_type: FileType;
  file_path: string | null;
  raw_text: string;
  language: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

export interface SourceDocument {
  id: string;
  projectId: string;
  title: string;
  fileType: FileType;
  filePath: string | null;
  rawText: string;
  language: string | null;
  metadata: JsonObject;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Citas (quotations) — unidad mínima de evidencia codificable
// ---------------------------------------------------------------------------

export interface QuotationRow {
  id: string;
  document_id: string;
  start_pos: number | null;
  end_pos: number | null;
  start_ts: number | null;
  end_ts: number | null;
  bbox_json: string | null;
  segment_text: string;
  context_json: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TextAnchor {
  kind: 'text';
  documentId: string;
  startPos: number;
  endPos: number;
}

export interface MediaAnchor {
  kind: 'media';
  documentId: string;
  startTs: number;
  endTs: number;
}

export interface ImageAnchor {
  kind: 'image';
  documentId: string;
  bbox: { x: number; y: number; w: number; h: number };
}

export type QuotationAnchor = TextAnchor | MediaAnchor | ImageAnchor;

export interface Quotation {
  id: string;
  documentId: string;
  anchor: QuotationAnchor;
  segmentText: string;
  context: JsonObject;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Códigos (árbol jerárquico) y familias
// ---------------------------------------------------------------------------

export interface CodeRow {
  id: string;
  project_id: string;
  parent_id: string | null;
  name: string;
  color: string | null;
  description: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Code {
  id: string;
  projectId: string;
  parentId: string | null;
  name: string;
  color: string | null;
  description: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Árbol de códigos materializado (para árboles/selects jerárquicos). */
export interface CodeTreeNode extends Code {
  depth: number;
  /** Ruta completa, p. ej. "Emociones / Miedo / Fobia". */
  path: string;
  children: CodeTreeNode[];
}

export interface CodeFamilyRow {
  id: string;
  project_id: string;
  name: string;
  color: string | null;
  created_at: string;
}

export interface CodeFamily {
  id: string;
  projectId: string;
  name: string;
  color: string | null;
  codeIds: string[];
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Asignación código ↔ cita
// ---------------------------------------------------------------------------

/**
 * Fila de `code_quotation`.
 *
 * La tabla tiene `id` propio y `researcher_id` (no `created_by`): la clave primaria es
 * un id surrogate para que DOS investigadores puedan asignar el MISMO código a la MISMA
 * cita. Con la antigua PK (code_id, quotation_id) solo cabía una fila, lo que hacía
 * imposible medir concordancia inter-evaluadora por código.
 */
export interface CodeQuotationRow {
  id: string;
  code_id: string;
  quotation_id: string;
  researcher_id: string | null;
  created_at: string;
}

export interface CodeQuotation {
  id: string;
  codeId: string;
  quotationId: string;
  researcherId: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Memos
// ---------------------------------------------------------------------------

export type MemoTargetType = 'project' | 'document' | 'quotation' | 'code' | 'memo' | 'relation';

export interface MemoRow {
  id: string;
  project_id: string;
  title: string;
  content: string;
  target_type: MemoTargetType | null;
  target_id: string | null;
  author_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Memo {
  id: string;
  projectId: string;
  title: string;
  content: string;
  target?: { type: MemoTargetType; id: string };
  authorId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Relaciones entre entidades
// ---------------------------------------------------------------------------

export type RelationEntityType = 'code' | 'quotation' | 'memo' | 'document';

export interface RelationRow {
  id: string;
  project_id: string;
  source_type: RelationEntityType;
  source_id: string;
  target_type: RelationEntityType;
  target_id: string;
  relation_type: string;
  label: string | null;
  created_by: string | null;
  created_at: string;
}

export interface Relation {
  id: string;
  projectId: string;
  source: { type: RelationEntityType; id: string };
  target: { type: RelationEntityType; id: string };
  relationType: string;
  label: string | null;
  createdBy: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Atributos (variables de caso) y valores por documento
// ---------------------------------------------------------------------------

export type AttributeType = 'string' | 'number' | 'boolean' | 'date';

export interface AttributeRow {
  id: string;
  project_id: string;
  name: string;
  data_type: AttributeType;
}

export interface Attribute {
  id: string;
  projectId: string;
  name: string;
  dataType: AttributeType;
}

export interface DocumentAttributeValueRow {
  document_id: string;
  attribute_id: string;
  value: string | null;
}

export interface DocumentAttributeValue {
  documentId: string;
  attributeId: string;
  value: string | null;
}

// ---------------------------------------------------------------------------
// Auditoría
// ---------------------------------------------------------------------------

export interface AuditLogRow {
  id: number;
  project_id: string | null;
  researcher_id: string | null;
  ts: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details_json: string;
  prev_hash: string | null;
  row_hash: string;
}

export interface AuditEntry {
  id: number;
  projectId: string | null;
  researcherId: string | null;
  ts: string;
  action: string;
  entityType: string;
  entityId: string | null;
  details: JsonObject;
  prevHash: string | null;
  rowHash: string;
}

// ---------------------------------------------------------------------------
// Co-ocurrencia (caché mantenida por triggers)
// ---------------------------------------------------------------------------

export interface CodeCooccurrenceRow {
  code_a: string;
  code_b: string;
  n: number;
}

export interface CodeCooccurrence {
  codeA: string;
  codeB: string;
  n: number;
}

// ---------------------------------------------------------------------------
// Resultados de búsqueda FTS5
// ---------------------------------------------------------------------------

export interface SearchHitRow {
  rowid: number;
  title: string;
  content: string;
  snippet: string | null;
  /** bm25 negativo: menor (más negativo) = mejor coincidencia. */
  rank: number;
}

export interface SearchHit {
  documentId: string;
  title: string;
  snippet: string | null;
  score: number;
}

// ---------------------------------------------------------------------------
// Resultado de importación
// ---------------------------------------------------------------------------

export interface ImportResult {
  documentId: string;
  title: string;
  fileType: FileType;
  /** Número de citas/texto extraído (no aplica para media). */
  textLength: number;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Ordenamiento/Límites genéricos
// ---------------------------------------------------------------------------

export interface Page {
  offset: number;
  limit: number;
}

export type SortDirection = 'asc' | 'desc';

export interface SortBy<K extends string> {
  field: K;
  direction: SortDirection;
}