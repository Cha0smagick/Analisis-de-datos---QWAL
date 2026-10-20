/**
 * Contrato IPC compartido entre el proceso principal de Electron
 * (`electron/main.ts`), el preload (`electron/preload.cjs`) y el renderer
 * (`src/`).
 *
 * Regla de oro: aquí NO se re-declaran formas de datos. Todo lo que cruza el
 * canal se importa de `@qualicanvas/core`, que es el único lugar donde se
 * definen los tipos del dominio y de los informes de análisis. Antes este
 * archivo declaraba sus propios `CodeFrequencyItem`, `CooccurrenceItem`,
 * `WordFrequencyItem` y `DocumentCodeMatrixItem` que no coincidían con nada de
 * lo que el núcleo devolvía, y `main.ts` necesitaba una capa de "normalizadores"
 * para poder traducir de un contrato al otro. Ese bandaid ya no existe.
 */

import type {
  Attribute,
  Code,
  CodeFamily,
  CodeFrequencyReport,
  CodeTreeNode,
  CooccurrenceMatrix,
  DocumentCodeMatrix,
  DomainErrorCode,
  FileType,
  FleissKappaReport,
  FrameworkMatrixReport,
  ImportResult,
  InterRaterReport,
  JaccardMatrix,
  KwicReport,
  KrippendorffAlphaReport,
  Memo,
  MemoTargetType,
  Project,
  Quotation,
  QuotationAnchor,
  Researcher,
  Relation,
  RelationEntityType,
  SearchHit,
  SearchOptions,
  SourceDocument,
  TextAnchor,
  WordFrequencyReport,
} from '@qualicanvas/core';

/**
 * Se re-exportan para que el renderizador tenga un único punto de entrada: si
 * algo falta aquí, el compilador lo dice, en vez de que cada vista importe de
 * un lado o del otro y las formas se separen sin avisar.
 */
export type {
  Attribute,
  Code,
  CodeFamily,
  CodeFrequencyReport,
  CodeTreeNode,
  CooccurrenceMatrix,
  DocumentCodeMatrix,
  FileType,
  FleissKappaReport,
  FrameworkMatrixReport,
  ImportResult,
  InterRaterReport,
  JaccardMatrix,
  KwicReport,
  KrippendorffAlphaReport,
  Memo,
  MemoTargetType,
  Project,
  Quotation,
  QuotationAnchor,
  Relation,
  RelationEntityType,
  Researcher,
  SearchHit,
  SearchOptions,
  SourceDocument,
  TextAnchor,
  WordFrequencyReport,
};

/** Resultado de cualquier invocación IPC: o datos, o un error tipado. */
export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: DomainErrorCode };

/** Backend con el que se abrió realmente la base de datos. */
export type DbBackend = 'node' | 'sqljs';

export interface DbOpenResult {
  dbPath: string;
  projects: Project[];
  /**
   * Backend efectivo. Si es `'sqljs'` la base completa se cargó en memoria
   * (WASM): se degradationa el rendimiento y el gasto de RAM, y ya no hay
   * escritura concurrente en disco, así que la interfaz debe avisarlo.
   */
  backend: DbBackend;
}

export interface DocumentWithText {
  document: SourceDocument;
  text: string;
}

export interface CreateQuotationInput {
  documentId: string;
  anchor: QuotationAnchor;
  segmentText: string;
  context?: Record<string, unknown>;
  createdBy?: string | null;
}

/** Fila de densidad de codificación que devuelve `coding.density`. */
export interface CodingDensityRow {
  researcherId: string;
  researcherName: string;
  quotations: number;
}

/** Atribución de un código a una cita por parte de una investigadora. */
export interface QuotationCodeAttribution {
  codeId: string;
  researcherId: string | null;
}

export interface ApiContract {
  db: {
    /** Con `filePath` abre esa base directamente; sin él, muestra el diálogo. */
    open(filePath?: string): Promise<DbOpenResult | null>;
    create(): Promise<DbOpenResult | null>;
    /**
     * Vuelca a disco la base cuando está en memoria (backend `sqljs`). Con
     * `better-sqlite3` no hace nada porque cada escritura ya fue a disco.
     */
    flush(): Promise<boolean>;
  };
  projects: {
    list(): Promise<Project[]>;
    create(input: { name: string; description?: string }): Promise<Project>;
    open(projectId: string): Promise<Project>;
    remove(projectId: string): Promise<boolean>;
  };
  documents: {
    list(): Promise<SourceDocument[]>;
    pickAndImport(): Promise<ImportResult[]>;
    get(documentId: string): Promise<DocumentWithText | null>;
    updateRawText(documentId: string, text: string, language?: string): Promise<SourceDocument | undefined>;
    remove(documentId: string): Promise<boolean>;
    /** Crea un documento de texto directamente (transcripciones, pegados). */
    createText(input: { title: string; text: string; language?: string }): Promise<ImportResult>;
  };
  codes: {
    list(): Promise<Code[]>;
    tree(): Promise<CodeTreeNode[]>;
    create(input: { name: string; parentId?: string | null; color?: string | null; description?: string }): Promise<Code>;
    update(codeId: string, patch: { name?: string; color?: string | null; description?: string }): Promise<Code>;
    move(codeId: string, parentId: string | null): Promise<Code>;
    remove(codeId: string): Promise<boolean>;
    listFamilies(): Promise<CodeFamily[]>;
  };
  researchers: {
    list(): Promise<Researcher[]>;
    create(input: { name: string; initials?: string | null; color?: string | null; isPrimary?: boolean }): Promise<Researcher>;
  };
  quotations: {
    listByDocument(documentId: string): Promise<Quotation[]>;
    listByCode(codeId: string, includeDescendants?: boolean): Promise<Quotation[]>;
    create(input: CreateQuotationInput): Promise<Quotation>;
    remove(quotationId: string): Promise<boolean>;
    /** Códigos asignados a la cita, con la investigadora que hizo cada asignación. */
    codes(quotationId: string): Promise<QuotationCodeAttribution[]>;
  };
  /** Canales de codificación. Sin esto el servicio de codificación es inalcanzable desde la interfaz. */
  coding: {
    assign(quotationId: string, codeId: string, researcherId?: string | null): Promise<boolean>;
    unassign(quotationId: string, codeId: string, researcherId?: string | null): Promise<boolean>;
    setCodes(quotationId: string, codeIds: string[], researcherId?: string | null): Promise<void>;
    density(): Promise<CodingDensityRow[]>;
  };
  memos: {
    listForTarget(targetType: MemoTargetType, targetId: string): Promise<Memo[]>;
    create(input: {
      targetType: MemoTargetType;
      targetId: string;
      title: string;
      body: string;
      createdBy?: string | null;
    }): Promise<Memo>;
  };
  relations: {
    listForEntity(entityType: RelationEntityType, entityId: string): Promise<Relation[]>;
    list(): Promise<Relation[]>;
    create(input: {
      sourceType: RelationEntityType;
      sourceId: string;
      targetType: RelationEntityType;
      targetId: string;
      relationType?: string;
      label?: string | null;
    }): Promise<Relation>;
    remove(relationId: string): Promise<boolean>;
  };
  attributes: {
    list(): Promise<Attribute[]>;
    create(input: { name: string; dataType: 'string' | 'number' | 'boolean' | 'date' }): Promise<Attribute>;
    /** Upsert del valor de un atributo para un documento; `null` lo borra. */
    setValue(documentId: string, attributeId: string, value: string | null): Promise<void>;
    remove(attributeId: string): Promise<boolean>;
    /** Valores planos de todos los documentos (cada uno con documentId/attributeId/value). */
    values(): Promise<Array<{ documentId: string; attributeId: string; value: string | null }>>;
  };
  search: {
    query(query: string, options?: SearchOptions): Promise<SearchHit[]>;
  };
  /** Puente al CLI de Whisper: transcripción local de audio/vídeo, nada sale del equipo. */
  media: {
    transcribe(filePath: string): Promise<{ text: string }>;
  };
  /** Los diez métodos de análisis que el núcleo implementa, con sus informes reales. */
  analysis: {
    codeFrequencies(): Promise<CodeFrequencyReport>;
    cooccurrence(): Promise<CooccurrenceMatrix>;
    documentCodeMatrix(): Promise<DocumentCodeMatrix>;
    wordFrequencies(language?: string, limit?: number): Promise<WordFrequencyReport>;
    interRater(): Promise<InterRaterReport>;
    frameworkMatrix(): Promise<FrameworkMatrixReport>;
    jaccard(options?: { includeDescendants?: boolean }): Promise<JaccardMatrix>;
    kwic(term: string, options?: { window?: number }): Promise<KwicReport>;
    fleissKappa(): Promise<FleissKappaReport>;
    krippendorffAlpha(): Promise<KrippendorffAlphaReport>;
  };
}