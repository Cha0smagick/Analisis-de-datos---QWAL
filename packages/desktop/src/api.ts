import type {
  Attribute,
  Code,
  CodeFamily,
  CodeFrequencyReport,
  CodeTreeNode,
  CooccurrenceMatrix,
  CodingDensityRow,
  CreateQuotationInput,
  DbOpenResult,
  DocumentCodeMatrix,
  DocumentWithText,
  FleissKappaReport,
  FrameworkMatrixReport,
  IpcResult,
  ImportResult,
  InterRaterReport,
  JaccardMatrix,
  KrippendorffAlphaReport,
  KwicReport,
  Memo,
  MemoTargetType,
  Project,
  Quotation,
  QuotationCodeAttribution,
  Relation,
  RelationEntityType,
  Researcher,
  SearchHit,
  SearchOptions,
  SourceDocument,
  TextAnchor,
  WordFrequencyReport,
} from '../shared/ipc';
import type { ApiContract } from '../shared/ipc';

export type {
  Attribute,
  Code,
  CodeFamily,
  CodeFrequencyReport,
  CodeTreeNode,
  CooccurrenceMatrix,
  CodingDensityRow,
  CreateQuotationInput,
  DbOpenResult,
  DocumentCodeMatrix,
  DocumentWithText,
  FleissKappaReport,
  FrameworkMatrixReport,
  ImportResult,
  InterRaterReport,
  JaccardMatrix,
  KrippendorffAlphaReport,
  KwicReport,
  Memo,
  MemoTargetType,
  Project,
  Quotation,
  QuotationCodeAttribution,
  Relation,
  RelationEntityType,
  Researcher,
  SearchHit,
  SearchOptions,
  SourceDocument,
  TextAnchor,
  WordFrequencyReport,
} from '../shared/ipc';

/** Error con el `code` del dominio, para que la vista no compare textos. */
export class ApiError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

// ---------------------------------------------------------------------------
// Transporte: puente Electron (IPC) si existe; HTTP contra el servidor local
// en caso contrario (dashboard web en el navegador).
//
// En Electron empaquetado el renderer carga por file:// y no hay servidor:
// TODO debe ir por el puente. En el navegador no hay puente y todo va por
// HTTP. Ambos transportes responden el mismo sobre IpcResult, así que las
// vistas no saben por dónde viaja cada llamada.
// ---------------------------------------------------------------------------

/** El puente real devuelve Promise<IpcResult<T>> por cada método del contrato. */
type Bridge = {
  [K in keyof ApiContract]: {
    [M in keyof ApiContract[K]]: ApiContract[K][M] extends (...args: infer A) => Promise<infer T>
      ? (...args: A) => Promise<IpcResult<T>>
      : never;
  };
};

const bridge = (window as unknown as { qwal?: Bridge }).qwal ?? null;

/**
 * Extrae `data` del sobre, aceptando el resultado directo o una Promise
 * (ipcRenderer.invoke devuelve Promise; los errores de dominio llegan con
 * `ok: false` y su `code` intacto).
 */
async function unwrap<T>(result: unknown): Promise<T> {
  const r = (await result) as IpcResult<T> | null | undefined;
  if (!r || typeof r !== 'object' || !('ok' in r)) {
    throw new ApiError('Respuesta del transporte con formato inesperado');
  }
  if (!r.ok) throw new ApiError(r.error, r.code);
  return r.data;
}

/**
 * Llamada RPC al servidor local (`packages/server`). El sobre es siempre
 * `{ ok, data | error }`: el código HTTP se consulta, pero no decide, porque un
 * 404 de "proyecto no encontrado" y un 500 comparten forma de sobre.
 */
async function rpc<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch('/api' + path, init);
  const payload = (await res.json()) as IpcResult<T>;
  if (!payload.ok) throw new ApiError(payload.error, payload.code);
  return payload.data;
}

const jsonHeaders = { 'Content-Type': 'application/json' };

function jsonBody(value: unknown): RequestInit {
  return { method: 'POST', headers: jsonHeaders, body: JSON.stringify(value) };
}

function query(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export const db = {
  open: (filePath?: string): Promise<DbOpenResult | null> =>
    bridge
      ? unwrap<DbOpenResult | null>(bridge.db.open(filePath))
      : rpc<DbOpenResult | null>('/db/open'),
  create: (): Promise<DbOpenResult | null> =>
    bridge
      ? unwrap<DbOpenResult | null>(bridge.db.create())
      : rpc<DbOpenResult | null>('/db/create', { method: 'POST' }),
  /** Vuelca a disco cuando el backend es sql.js (base en memoria). */
  flush: (): Promise<boolean> =>
    bridge ? unwrap<boolean>(bridge.db.flush()) : rpc<boolean>('/db/flush', { method: 'POST' }),
};

export const projects = {
  list: (): Promise<Project[]> =>
    bridge ? unwrap<Project[]>(bridge.projects.list()) : rpc<Project[]>('/projects'),
  create: (input: { name: string; description?: string }): Promise<Project> =>
    bridge
      ? unwrap<Project>(bridge.projects.create(input))
      : rpc<Project>('/projects', jsonBody(input)),
  open: (projectId: string): Promise<Project> =>
    bridge
      ? unwrap<Project>(bridge.projects.open(projectId))
      : rpc<Project>(`/projects/${encodeURIComponent(projectId)}/open`, { method: 'POST' }),
  remove: (projectId: string): Promise<boolean> =>
    bridge
      ? unwrap<boolean>(bridge.projects.remove(projectId))
      : rpc<boolean>(`/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' }),
};

export const documents = {
  list: (): Promise<SourceDocument[]> =>
    bridge
      ? unwrap<SourceDocument[]>(bridge.documents.list())
      : rpc<SourceDocument[]>('/documents'),
  pickAndImport: (files?: FileList | File[]): Promise<ImportResult[]> => {
    if (bridge) return unwrap<ImportResult[]>(bridge.documents.pickAndImport());
    const list = files === undefined ? [] : Array.from(files);
    if (list.length === 0) return Promise.resolve([]);
    const fd = new FormData();
    for (const f of list) fd.append('files', f, f.name);
    return rpc<ImportResult[]>('/documents/import', { method: 'POST', body: fd });
  },
  get: (documentId: string): Promise<DocumentWithText | null> =>
    bridge
      ? unwrap<DocumentWithText | null>(bridge.documents.get(documentId))
      : rpc<DocumentWithText | null>(`/documents/${encodeURIComponent(documentId)}`),
  updateRawText: (documentId: string, rawText: string, language?: string): Promise<SourceDocument> => {
    if (bridge) {
      return unwrap<SourceDocument>(bridge.documents.updateRawText(documentId, rawText, language));
    }
    return rpc<SourceDocument>(`/documents/${encodeURIComponent(documentId)}/text`, {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify({ rawText, language }),
    });
  },
  remove: (documentId: string): Promise<boolean> =>
    bridge
      ? unwrap<boolean>(bridge.documents.remove(documentId))
      : rpc<boolean>(`/documents/${encodeURIComponent(documentId)}`, { method: 'DELETE' }),
  createText: (input: { title: string; text: string; language?: string }): Promise<ImportResult> =>
    bridge
      ? unwrap<ImportResult>(bridge.documents.createText(input))
      : rpc<ImportResult>('/documents/text', jsonBody(input)),
};

/** Transcripción local con Whisper (CLI externo); falla con mensaje claro si no está. */
export const media = {
  transcribe: (filePath: string): Promise<{ text: string }> =>
    bridge
      ? unwrap<{ text: string }>(bridge.media.transcribe(filePath))
      : Promise.reject(new Error('La transcripción requiere la aplicación de escritorio.')),
};

export const codes = {
  list: (): Promise<Code[]> =>
    bridge ? unwrap<Code[]>(bridge.codes.list()) : rpc<Code[]>('/codes'),
  tree: (): Promise<CodeTreeNode[]> =>
    bridge ? unwrap<CodeTreeNode[]>(bridge.codes.tree()) : rpc<CodeTreeNode[]>('/codes/tree'),
  listFamilies: (): Promise<CodeFamily[]> =>
    bridge
      ? unwrap<CodeFamily[]>(bridge.codes.listFamilies())
      : rpc<CodeFamily[]>('/codes/families'),
  create: (input: {
    name: string;
    parentId?: string;
    color?: string;
    description?: string;
  }): Promise<Code> =>
    bridge
      ? unwrap<Code>(bridge.codes.create(input))
      : rpc<Code>('/codes', jsonBody(input)),
  update: (
    codeId: string,
    patch: { name?: string; color?: string; description?: string },
  ): Promise<Code> =>
    bridge
      ? unwrap<Code>(bridge.codes.update(codeId, patch))
      : rpc<Code>(`/codes/${encodeURIComponent(codeId)}`, {
          method: 'PATCH',
          headers: jsonHeaders,
          body: JSON.stringify(patch),
        }),
  move: (codeId: string, parentId: string | null): Promise<Code> =>
    bridge
      ? unwrap<Code>(bridge.codes.move(codeId, parentId))
      : rpc<Code>(`/codes/${encodeURIComponent(codeId)}/move`, jsonBody({ parentId })),
  remove: (codeId: string): Promise<boolean> =>
    bridge
      ? unwrap<boolean>(bridge.codes.remove(codeId))
      : rpc<boolean>(`/codes/${encodeURIComponent(codeId)}`, { method: 'DELETE' }),
};

export const researchers = {
  list: (): Promise<Researcher[]> =>
    bridge
      ? unwrap<Researcher[]>(bridge.researchers.list())
      : rpc<Researcher[]>('/researchers'),
  create: (input: {
    name: string;
    initials?: string;
    color?: string;
    isPrimary?: boolean;
  }): Promise<Researcher> =>
    bridge
      ? unwrap<Researcher>(bridge.researchers.create(input))
      : rpc<Researcher>('/researchers', jsonBody(input)),
};

export const quotations = {
  listByDocument: (documentId: string): Promise<Quotation[]> =>
    bridge
      ? unwrap<Quotation[]>(bridge.quotations.listByDocument(documentId))
      : rpc<Quotation[]>(`/documents/${encodeURIComponent(documentId)}/quotations`),
  listByCode: (codeId: string, includeDescendants = false): Promise<Quotation[]> =>
    bridge
      ? unwrap<Quotation[]>(bridge.quotations.listByCode(codeId, includeDescendants))
      : rpc<Quotation[]>(`/codes/${encodeURIComponent(codeId)}/quotations${query({ includeDescendants })}`),
  create: (input: CreateQuotationInput): Promise<Quotation> =>
    bridge
      ? unwrap<Quotation>(bridge.quotations.create(input))
      : rpc<Quotation>('/quotations', jsonBody(input)),
  remove: (quotationId: string): Promise<boolean> =>
    bridge
      ? unwrap<boolean>(bridge.quotations.remove(quotationId))
      : rpc<boolean>(`/quotations/${encodeURIComponent(quotationId)}`, { method: 'DELETE' }),
  codes: (quotationId: string): Promise<QuotationCodeAttribution[]> =>
    bridge
      ? unwrap<QuotationCodeAttribution[]>(bridge.quotations.codes(quotationId))
      : rpc<QuotationCodeAttribution[]>(`/quotations/${encodeURIComponent(quotationId)}/codes`),
};

export const coding = {
  /** `true` si la asignación se creó; `false` si ya existía. */
  assign: (quotationId: string, codeId: string, researcherId?: string | null): Promise<boolean> =>
    bridge
      ? unwrap<boolean>(bridge.coding.assign(quotationId, codeId, researcherId))
      : rpc<boolean>('/coding/assign', jsonBody({ quotationId, codeId, researcherId })),
  /** `true` si se quitó alguna asignación. */
  unassign: (quotationId: string, codeId: string, researcherId?: string | null): Promise<boolean> =>
    bridge
      ? unwrap<boolean>(bridge.coding.unassign(quotationId, codeId, researcherId))
      : rpc<boolean>('/coding/unassign', jsonBody({ quotationId, codeId, researcherId })),
  /** Deja a esta investigadora exactamente con esos códigos sobre la cita. */
  setCodes: (quotationId: string, codeIds: string[], researcherId?: string | null): Promise<void> =>
    bridge
      ? unwrap<void>(bridge.coding.setCodes(quotationId, codeIds, researcherId))
      : rpc<void>('/coding/set-codes', jsonBody({ quotationId, codeIds, researcherId })),
  density: (): Promise<CodingDensityRow[]> =>
    bridge
      ? unwrap<CodingDensityRow[]>(bridge.coding.density())
      : rpc<CodingDensityRow[]>('/coding/density'),
};

export const memos = {
  listForTarget: (targetType: MemoTargetType, targetId: string): Promise<Memo[]> =>
    bridge
      ? unwrap<Memo[]>(bridge.memos.listForTarget(targetType, targetId))
      : rpc<Memo[]>(`/memos${query({ targetType, targetId })}`),
  create: (input: {
    targetType: MemoTargetType;
    targetId: string;
    title: string;
    body: string;
    createdBy?: string | null;
  }): Promise<Memo> =>
    bridge
      ? unwrap<Memo>(bridge.memos.create(input))
      : rpc<Memo>('/memos', jsonBody(input)),
};

export const relations = {
  listForEntity: (entityType: RelationEntityType, entityId: string): Promise<Relation[]> =>
    bridge
      ? unwrap<Relation[]>(bridge.relations.listForEntity(entityType, entityId))
      : rpc<Relation[]>(`/relations${query({ entityType, entityId })}`),
  list: (): Promise<Relation[]> =>
    bridge
      ? unwrap<Relation[]>(bridge.relations.list())
      : rpc<Relation[]>('/relations'),
  create: (input: {
    sourceType: RelationEntityType;
    sourceId: string;
    targetType: RelationEntityType;
    targetId: string;
    relationType?: string;
    label?: string | null;
  }): Promise<Relation> =>
    bridge
      ? unwrap<Relation>(bridge.relations.create(input))
      : rpc<Relation>('/relations', jsonBody(input)),
  remove: (relationId: string): Promise<boolean> =>
    bridge
      ? unwrap<boolean>(bridge.relations.remove(relationId))
      : rpc<boolean>(`/relations/${encodeURIComponent(relationId)}`, { method: 'DELETE' }),
};

export const attributes = {
  list: (): Promise<Attribute[]> =>
    bridge
      ? unwrap<Attribute[]>(bridge.attributes.list())
      : rpc<Attribute[]>('/attributes'),
  create: (input: { name: string; dataType: 'string' | 'number' | 'boolean' | 'date' }): Promise<Attribute> =>
    bridge
      ? unwrap<Attribute>(bridge.attributes.create(input))
      : rpc<Attribute>('/attributes', jsonBody(input)),
  setValue: (documentId: string, attributeId: string, value: string | null): Promise<void> =>
    bridge
      ? unwrap<void>(bridge.attributes.setValue(documentId, attributeId, value))
      : rpc<void>('/attributes/set-value', jsonBody({ documentId, attributeId, value })),
  remove: (attributeId: string): Promise<boolean> =>
    bridge
      ? unwrap<boolean>(bridge.attributes.remove(attributeId))
      : rpc<boolean>(`/attributes/${encodeURIComponent(attributeId)}`, { method: 'DELETE' }),
  values: (): Promise<Array<{ documentId: string; attributeId: string; value: string | null }>> =>
    bridge
      ? unwrap<Array<{ documentId: string; attributeId: string; value: string | null }>>(bridge.attributes.values())
      : rpc<Array<{ documentId: string; attributeId: string; value: string | null }>>('/attributes/values'),
};

export const search = {
  query: (queryText: string, options?: SearchOptions): Promise<SearchHit[]> =>
    bridge
      ? unwrap<SearchHit[]>(bridge.search.query(queryText, options))
      : rpc<SearchHit[]>('/search', jsonBody({ query: queryText, options })),
};

export const analysis = {
  codeFrequencies: (): Promise<CodeFrequencyReport> =>
    bridge
      ? unwrap<CodeFrequencyReport>(bridge.analysis.codeFrequencies())
      : rpc<CodeFrequencyReport>('/analysis/code-frequencies'),
  cooccurrence: (): Promise<CooccurrenceMatrix> =>
    bridge
      ? unwrap<CooccurrenceMatrix>(bridge.analysis.cooccurrence())
      : rpc<CooccurrenceMatrix>('/analysis/co-occurrence'),
  wordFrequencies: (language?: string, limit?: number): Promise<WordFrequencyReport> =>
    bridge
      ? unwrap<WordFrequencyReport>(bridge.analysis.wordFrequencies(language, limit))
      : rpc<WordFrequencyReport>(`/analysis/word-frequencies${query({ language, limit })}`),
  documentCodeMatrix: (): Promise<DocumentCodeMatrix> =>
    bridge
      ? unwrap<DocumentCodeMatrix>(bridge.analysis.documentCodeMatrix())
      : rpc<DocumentCodeMatrix>('/analysis/document-code-matrix'),
  interRater: (): Promise<InterRaterReport> =>
    bridge
      ? unwrap<InterRaterReport>(bridge.analysis.interRater())
      : rpc<InterRaterReport>('/analysis/inter-rater'),
  frameworkMatrix: (): Promise<FrameworkMatrixReport> =>
    bridge
      ? unwrap<FrameworkMatrixReport>(bridge.analysis.frameworkMatrix())
      : rpc<FrameworkMatrixReport>('/analysis/framework-matrix'),
  jaccard: (includeDescendants = false): Promise<JaccardMatrix> =>
    bridge
      ? unwrap<JaccardMatrix>(bridge.analysis.jaccard({ includeDescendants }))
      : rpc<JaccardMatrix>(`/analysis/jaccard${query({ includeDescendants })}`),
  kwic: (term: string, window?: number): Promise<KwicReport> =>
    bridge
      ? unwrap<KwicReport>(bridge.analysis.kwic(term, { window }))
      : rpc<KwicReport>(`/analysis/kwic${query({ term, window })}`),
  fleissKappa: (): Promise<FleissKappaReport> =>
    bridge
      ? unwrap<FleissKappaReport>(bridge.analysis.fleissKappa())
      : rpc<FleissKappaReport>('/analysis/fleiss-kappa'),
  krippendorffAlpha: (): Promise<KrippendorffAlphaReport> =>
    bridge
      ? unwrap<KrippendorffAlphaReport>(bridge.analysis.krippendorffAlpha())
      : rpc<KrippendorffAlphaReport>('/analysis/krippendorff-alpha'),
};

export const qwal = {
  db,
  projects,
  documents,
  codes,
  researchers,
  quotations,
  coding,
  memos,
  relations,
  attributes,
  search,
  media,
  analysis,
};
