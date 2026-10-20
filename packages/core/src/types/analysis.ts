/**
 * Tipos de resultados de análisis cualitativo.
 * Todos son DTOs inmutables producidos por los servicios de análisis.
 */

import type { CodeTreeNode } from './domain.js';

// ---------------------------------------------------------------------------
// Frecuencia y cobertura
// ---------------------------------------------------------------------------

export interface CodeFrequencyItem {
  code: CodeTreeNode;
  /** Número de citas codificadas (directas; no incluye descendientes). */
  quotations: number;
  /** Número de documentos que contienen al menos una cita con este código. */
  documents: number;
  /** Citas agregadas incluyendo todos los descendientes del árbol. */
  quotationsWithDescendants: number;
  /**
   * Documentos con al menos una cita de este código o de cualquier
   * descendiente. Antes este dato no existía y `documents` se confundía con
   * él, de modo que comparar un código padre con su hijo daba cifras que
   * parecían contradictorias.
   */
  documentsWithDescendants: number;
}

export interface CodeFrequencyReport {
  projectId: string;
  generatedAt: string;
  /** Ordenado por quotationsWithDescendants desc. */
  items: CodeFrequencyItem[];
  totalQuotations: number;
  totalDocuments: number;
  maxQuotations: number;
}

// ---------------------------------------------------------------------------
// Matriz de co-ocurrencia
// ---------------------------------------------------------------------------

export interface CooccurrenceCell {
  codeA: string;
  codeB: string;
  /** Citas compartidas entre ambos códigos. */
  count: number;
}

export interface CooccurrenceMatrix {
  projectId: string;
  generatedAt: string;
  /** Todos los códigos del proyecto (ordenados por nombre). */
  codeIds: string[];
  /** Solo pares con count > 0. */
  cells: CooccurrenceCell[];
  maxCount: number;
}

// ---------------------------------------------------------------------------
// Codificación por documento (matriz casos × códigos)
// ---------------------------------------------------------------------------

export interface DocumentCodeCell {
  documentId: string;
  documentTitle: string;
  codeId: string;
  codeName: string;
  /** Citas del documento con este código. */
  quotationCount: number;
}

export interface DocumentCodeMatrix {
  projectId: string;
  generatedAt: string;
  documentIds: string[];
  codeIds: string[];
  cells: DocumentCodeCell[];
}

// ---------------------------------------------------------------------------
// Análisis léxico (nubes de palabras / frecuencia de términos)
// ---------------------------------------------------------------------------

export interface WordFrequencyItem {
  term: string;
  count: number;
  /** Proporción sobre el total de términos indexados (0..1). */
  relative: number;
}

export interface WordFrequencyReport {
  projectId: string;
  generatedAt: string;
  /**
   * Idioma de la lista de palabras vacías realmente aplicada. Se declara
   * `string` y no `string | null` porque el servicio siempre resuelve uno: si
   * el proyecto no declara idioma se usa el del primer documento y, si no hay
   * lista para ese idioma, se recurre a `es`.
   */
  language: string;
  items: WordFrequencyItem[];
  totalTerms: number;
}

// ---------------------------------------------------------------------------
// Fiabilidad inter-juez (IRR)
// ---------------------------------------------------------------------------

/** Acuerdo de un par de investigadores en un código concreto. */
export interface InterRaterCodeAgreement {
  codeId: string;
  codeName: string;
  /** Citas en las que A aplicó este código. */
  aQuotations: number;
  /** Citas en las que B aplicó este código. */
  bQuotations: number;
  /** Citas en las que ambos aplicaron este código (intersección). */
  shared: number;
  /** shared / tamaño del pool de citas; coincidencia bruta, no corregida por azar. */
  agreement: number;
  /** Cohen's kappa para la decisión binaria "A aplicó / B aplicó" este código. */
  kappa: number | null;
}

export interface InterRaterPair {
  researcherA: string;
  researcherB: string;
  /** Decisiones (código, cita) tomadas por cada uno. */
  codingsA: number;
  codingsB: number;
  /** Decisiones idénticas: mismo código sobre la misma cita. */
  sharedCodings: number;
  /** sharedCodings sobre la unión de decisiones (índice de Jaccard de decisiones). */
  codingAgreement: number;
  /** Media de los kappa por código que no son degenerados; null si ninguno lo es. */
  meanKappa: number | null;
  /** Detalle por código, ordenado de mayor a menor solapamiento. */
  codes: InterRaterCodeAgreement[];
}

export interface InterRaterReport {
  projectId: string;
  generatedAt: string;
  /** Citas que contienen al menos una decisión de codificación; es el N de la tabla. */
  totalQuotations: number;
  /** Pares de investigadores evaluados. */
  pairs: InterRaterPair[];
}

// ---------------------------------------------------------------------------
// Matriz de marco (framework matrix)
// ---------------------------------------------------------------------------

export interface FrameworkMatrixCell {
  quotationId: string;
  segmentText: string;
  codeId: string;
  codeName: string;
}

export interface FrameworkMatrix {
  projectId: string;
  /** Casos = documentos (con atributos). */
  caseId: string;
  caseTitle: string;
  /** Atributos del caso (variables). */
  attributes: Record<string, string | null>;
  /** columnas = códigos; filas = citas. */
  columns: Array<{ codeId: string; codeName: string; quotations: FrameworkMatrixCell[] }>;
}

export interface FrameworkMatrixReport {
  projectId: string;
  generatedAt: string;
  rows: FrameworkMatrix[];
}

// ---------------------------------------------------------------------------
// Coeficiente de Jaccard entre códigos
// ---------------------------------------------------------------------------

export interface JaccardCell {
  codeAId: string;
  codeAName: string;
  codeBId: string;
  codeBName: string;
  /** Citas compartidas entre ambos códigos (intersección). */
  intersection: number;
  /** Tamaño de la unión de citas de ambos códigos. */
  union: number;
  /** intersección / unión; 0..1. */
  index: number;
}

export interface JaccardMatrix {
  projectId: string;
  generatedAt: string;
  /** Máximo índice de similitud entre cualquier par (0 si no hay pares). */
  maxIndex: number;
  /** Solo pares con intersección > 0, ordenados por index desc. */
  cells: JaccardCell[];
}

// ---------------------------------------------------------------------------
// Keyword in Context (KWIC)
// ---------------------------------------------------------------------------

export interface KwicEntry {
  documentId: string;
  documentTitle: string;
  term: string;
  /** Offset de inicio del match (caracteres, en rawText). */
  matchStart: number;
  /** Offset de fin del match (exclusivo). */
  matchEnd: number;
  /** Texto anterior al match dentro de la ventana. */
  before: string;
  /** El término tal como aparece en el texto original. */
  match: string;
  /** Texto posterior al match dentro de la ventana. */
  after: string;
}

export interface KwicReport {
  projectId: string;
  term: string;
  /** Palabras de contexto antes/después del término. */
  window: number;
  generatedAt: string;
  entries: KwicEntry[];
}

// ---------------------------------------------------------------------------
// Fiabilidad inter-juez multi-codificador
// ---------------------------------------------------------------------------

export interface FleissKappaReport {
  projectId: string;
  generatedAt: string;
  /** Número de citas evaluadas (sujetos). */
  subjects: number;
  /** Número de investigadores (raters). */
  raters: number;
  /** Número de categorías (códigos) distintas. */
  categories: number;
  /** Acuerdo observado (Po). */
  observedAgreement: number;
  /** Acuerdo esperado por azar (Pe). */
  expectedAgreement: number;
  /** Fleiss' kappa; null si los datos son degenerados. */
  kappa: number | null;
}

export interface KrippendorffAlphaReport {
  projectId: string;
  generatedAt: string;
  subjects: number;
  raters: number;
  categories: number;
  /** Krippendorff's alpha; null si no hay suficientes datos. */
  alpha: number | null;
}