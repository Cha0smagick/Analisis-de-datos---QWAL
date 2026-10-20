/**
 * API REST del dashboard localhost (pivote web).
 * Expone la lógica de negocio de @qualicanvas/core por HTTP (127.0.0.1:3000).
 * Los shapes de respuesta son los mismos objetos que devuelve el núcleo
 * (`@qualicanvas/core`), sin aplanar: la capa IPC y esta capa HTTP responden
 * con exactamente el mismo tipo.
 */
import express, { type Request, type Response } from 'express';
import multer from 'multer';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ProjectRepository,
  Session,
  SqlJsDriver,
  SqliteDocumentImporter,
  openDriver,
  migrate,
  DomainError,
  type DbDriver,
  type FileSource,
  type FileType,
  type MemoTargetType,
  type QuotationAnchor,
  type RelationEntityType,
  type SearchOptions,
} from '@qualicanvas/core';
import type {
  DbBackend,
  DbOpenResult,
  DocumentWithText,
  IpcResult,
} from './types.js';

// ---------------------------------------------------------------------------
// Estado de módulo (espejo de desktop/electron/main.ts)
// ---------------------------------------------------------------------------
let driver: DbDriver | null = null;
let dbPath: string | null = null;
let backend: DbBackend | null = null;
let activeProjectId: string | null = null;
const sessions = new Map<string, Session>();

function requireDriver(): DbDriver {
  if (!driver) throw new Error('Base de datos no abierta.');
  return driver;
}

function requireProjectId(): string {
  if (!activeProjectId) throw new Error('No hay un proyecto activo.');
  return activeProjectId;
}

function getSession(): Session {
  const pid = requireProjectId();
  let session = sessions.get(pid);
  if (!session) {
    session = new Session(requireDriver(), pid);
    session.load();
    sessions.set(pid, session);
  }
  return session;
}

function openResult(): DbOpenResult {
  return {
    dbPath: dbPath ?? '',
    projects: new ProjectRepository(requireDriver()).list(),
    backend: backend ?? 'node',
  };
}

/**
 * Abre la base de datos. Si `better-sqlite3` no está disponible (mismo problema
 * de ABI que dentro de Electron) cae a sql.js, que deja la base **en
 * memoria**: por eso `backend` se devuelve en cada respuesta de `db/open` y
 * `db/create`, para que la interfaz pueda avisar en lugar de degradar en
 * silencio, y por eso `flushDatabase()` escribe los bytes al salir.
 */
export async function openDatabase(file: string): Promise<void> {
  if (driver) {
    driver.close();
    driver = null;
  }
  try {
    driver = await openDriver({ backend: 'node', filename: file });
    backend = 'node';
  } catch (reason) {
    console.warn(
      `[db] better-sqlite3 no disponible (${reason instanceof Error ? reason.message : String(reason)}); se usa sql.js en memoria.`,
    );
    driver = await openDriver({ backend: 'sqljs', filename: file });
    backend = 'sqljs';
  }
  await migrate(driver!);
  dbPath = file;
  activeProjectId = null;
  sessions.clear();
}

/** Vuelca a disco una base abierta con sql.js; con better-sqlite3 no hace nada. */
export async function flushDatabase(): Promise<boolean> {
  if (!dbPath || !(driver instanceof SqlJsDriver)) return false;
  await fs.promises.writeFile(dbPath, driver.exportDatabase());
  return true;
}

// ---------------------------------------------------------------------------
// Mapeo de extensiones -> FileType (mismo que desktop electron/main.ts)
// ---------------------------------------------------------------------------
const EXT_TO_FILE_TYPE: Record<string, FileType> = {
  pdf: 'pdf',
  docx: 'docx',
  txt: 'txt',
  md: 'md',
  rtf: 'rtf',
  odt: 'odt',
  html: 'html',
  htm: 'html',
  mp3: 'mp3',
  wav: 'wav',
  m4a: 'm4a',
  mp4: 'mp4',
  webm: 'webm',
  mkv: 'mkv',
  jpg: 'jpg',
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
  csv: 'csv',
  xlsx: 'xlsx',
  ods: 'ods',
  json: 'json',
};

function extToFileType(filename: string): FileType {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return EXT_TO_FILE_TYPE[ext] ?? 'other';
}

// ---------------------------------------------------------------------------
// Envoltorio de handlers -> { ok: true, data } | { ok: false, error, code }
// ---------------------------------------------------------------------------
function paramId(req: Request): string {
  const id = req.params.id;
  if (id === undefined) throw new Error('Parámetro id obligatorio.');
  return id;
}

/**
 * Traduce el `code` de un `DomainError` a un código HTTP real. Antes todos los
 * errores devolvían 200, así que el cliente no podía distinguir «no existe» de
 * «falló el servidor» sin comparar el texto del mensaje.
 */
function statusFor(err: unknown): number {
  if (!(err instanceof DomainError)) return 500;
  switch (err.code) {
    case 'not_found':
      return 404;
    case 'invalid_input':
      return 400;
    case 'conflict':
    case 'wrong_project':
      return 409;
    default:
      return 500;
  }
}

function wrap<T>(fn: (req: Request, res: Response) => T | Promise<T>): express.RequestHandler {
  return async (req, res) => {
    try {
      const data = await fn(req, res);
      const result: IpcResult<T> = { ok: true, data };
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (process.env.NODE_ENV !== 'test') console.error('[server] error:', message);
      const result: IpcResult<never> = {
        ok: false,
        error: message,
        ...(err instanceof DomainError ? { code: err.code } : {}),
      };
      res.status(statusFor(err)).json(result);
    }
  };
}

/** Blancos de los CHECK del esquema; un valor fuera de aquí no se estrecha solo. */
const MEMO_TARGETS: ReadonlySet<string> = new Set<MemoTargetType>([
  'project',
  'document',
  'quotation',
  'code',
  'memo',
  'relation',
]);
const RELATION_ENTITIES: ReadonlySet<string> = new Set<RelationEntityType>([
  'code',
  'quotation',
  'memo',
  'document',
]);

function sanitizeFilename(name: string): string {
  return name.replace(/[^\w.\-]/g, '_');
}

// ---------------------------------------------------------------------------
// Fábrica de la app Express
// ---------------------------------------------------------------------------
export function createApp(options: { dataDir: string; defaultDbPath: string }): { app: express.Express } {
  const app = express();
  app.use(express.json());

  const uploadsDir = path.join(os.tmpdir(), 'qualicanvas-uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });

  const upload = multer({
    storage: multer.diskStorage({
      destination: uploadsDir,
      filename: (_req, file, cb) => {
        cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${sanitizeFilename(file.originalname)}`);
      },
    }),
    limits: { fileSize: 200 * 1024 * 1024, files: 100 },
  });

  // --- Base de datos ------------------------------------------------------
  app.get(
    '/api/db/open',
    wrap(async (): Promise<DbOpenResult> => {
      const file = dbPath ?? options.defaultDbPath;
      if (!driver) await openDatabase(file);
      return openResult();
    }),
  );

  app.post(
    '/api/db/create',
    wrap(async (req): Promise<DbOpenResult> => {
      const body = (req.body ?? {}) as { name?: string };
      const name = body.name?.trim();
      if (!name) throw new Error('El nombre de la base de datos es obligatorio.');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const file = path.join(options.dataDir, `qualicanvas-${name}-${stamp}.db`);
      await openDatabase(file);
      return openResult();
    }),
  );

  // Vacía a disco una base abierta con sql.js (en memoria).
  app.post(
    '/api/db/flush',
    wrap(async () => flushDatabase()),
  );

  // --- Proyectos ----------------------------------------------------------
  app.get('/api/projects', wrap(() => new ProjectRepository(requireDriver()).list()));

  app.post(
    '/api/projects',
    wrap((req) => {
      const body = (req.body ?? {}) as { name?: string; description?: string };
      const name = body.name?.trim();
      if (!name) throw new Error('El nombre del proyecto es obligatorio.');
      return new ProjectRepository(requireDriver()).create({
        name,
        description: body.description?.trim() || undefined,
      });
    }),
  );

  app.post(
    '/api/projects/:id/open',
    wrap((req) => {
      const id = paramId(req);
      const project = new ProjectRepository(requireDriver()).get(id);
      if (!project) throw new Error('El proyecto no existe.');
      activeProjectId = id;
      return project;
    }),
  );

  app.delete(
    '/api/projects/:id',
    wrap((req) => {
      const id = paramId(req);
      const removed = new ProjectRepository(requireDriver()).remove(id);
      if (removed) {
        sessions.delete(id);
        if (activeProjectId === id) activeProjectId = null;
      }
      return removed;
    }),
  );

  // --- Documentos ---------------------------------------------------------
  app.get('/api/documents', wrap(() => getSession().repos.documents.listByProject(requireProjectId())));

  app.post(
    '/api/documents/text',
    wrap(async (req) => {
      const body = (req.body ?? {}) as { title?: string; text?: string; language?: string };
      const title = body.title?.trim();
      if (!title || !body.text) throw new Error('title y text son obligatorios.');
      const importer = await getSession().importer;
      return importer.importText(requireProjectId(), title, body.text, {
        language: body.language,
      });
    }),
  );

  app.post(
    '/api/documents/import',
    upload.array('files', 100),
    wrap(async (req) => {
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      if (files.length === 0) throw new Error('No se recibieron archivos.');
      const session = getSession();
      const importer = new SqliteDocumentImporter(session.repos.documents);
      const results = [];
      for (const file of files) {
        try {
          const data = new Uint8Array(await fs.promises.readFile(file.path));
          const source: FileSource = {
            name: file.originalname,
            mimeType: file.mimetype,
            readText: async () => new TextDecoder('utf-8').decode(data),
            readBuffer: async () => data,
          };
          results.push(await importer.importInto(requireProjectId(), source, extToFileType(file.originalname)));
        } finally {
          fs.promises.unlink(file.path).catch(() => undefined);
        }
      }
      return results;
    }),
  );

  app.get(
    '/api/documents/:id',
    wrap((req): DocumentWithText => {
      const repo = getSession().repos.documents;
      const document = repo.get(paramId(req));
      if (!document) throw new Error('El documento no existe.');
      return { document, text: repo.getRawText(paramId(req)) ?? null };
    }),
  );

  app.delete(
    '/api/documents/:id',
    wrap((req) => getSession().repos.documents.remove(paramId(req))),
  );

  app.get(
    '/api/documents/:id/quotations',
    wrap((req) => {
      const doc = getSession().repos.documents.get(paramId(req));
      if (!doc) throw new Error('El documento no existe.');
      return getSession().repos.quotations.listByDocument(paramId(req));
    }),
  );

  // --- Códigos ------------------------------------------------------------
  app.get('/api/codes', wrap(() => getSession().repos.codes.listByProject(requireProjectId())));

  app.get('/api/codes/tree', wrap(() => getSession().repos.codes.tree(requireProjectId())));

  app.post(
    '/api/codes',
    wrap((req) => {
      const body = (req.body ?? {}) as { name?: string; parentId?: string | null; color?: string | null; description?: string };
      const name = body.name?.trim();
      if (!name) throw new Error('El nombre del código es obligatorio.');
      return getSession().repos.codes.create(requireProjectId(), {
        name,
        parentId: body.parentId ?? null,
        color: body.color ?? null,
        description: body.description ?? undefined,
      });
    }),
  );

  app.patch(
    '/api/codes/:id',
    wrap((req) => {
      const body = (req.body ?? {}) as { name?: string; color?: string | null; description?: string };
      const code = getSession().repos.codes.update(paramId(req), {
        name: body.name?.trim(),
        color: body.color ?? null,
        description: body.description,
      });
      if (!code) throw new Error('El código no existe.');
      return code;
    }),
  );

  app.post(
    '/api/codes/:id/move',
    wrap((req) => {
      const body = (req.body ?? {}) as { parentId: string | null };
      const repo = getSession().repos.codes;
      const code = repo.get(paramId(req));
      if (!code) throw new Error('El código no existe.');
      return repo.move(paramId(req), body.parentId ?? null);
    }),
  );

  app.delete(
    '/api/codes/:id',
    wrap((req) => getSession().repos.codes.remove(paramId(req))),
  );

  // --- Búsqueda -----------------------------------------------------------
  app.post(
    '/api/search',
    wrap(async (req) => {
      const body = (req.body ?? {}) as { query?: string; options?: { limit?: unknown; offset?: unknown; near?: unknown } };
      const query = body.query?.trim();
      if (!query) throw new Error('La consulta de búsqueda es obligatoria.');
      const options: SearchOptions = {};
      if (body.options?.limit !== undefined) options.limit = Number(body.options.limit);
      if (body.options?.offset !== undefined) options.offset = Number(body.options.offset);
      if (body.options?.near !== undefined) options.near = Number(body.options.near);
      return getSession().services.search.search(requireProjectId(), query, options);
    }),
  );

  // --- Análisis -------------------------------------------------------------
  // Los diez métodos del núcleo, servidos sin aplanar: la respuesta es el
  // informe tal cual lo produce `AnalysisService`.
  const a = () => getSession().services.analysis;

  app.get('/api/analysis/code-frequencies', wrap(() => a().codeFrequencies(requireProjectId())));

  app.get('/api/analysis/co-occurrence', wrap(() => a().cooccurrence(requireProjectId())));

  app.get(
    '/api/analysis/word-frequencies',
    wrap((req) => {
      const q = req.query as { language?: string; limit?: string };
      const language = q.language?.trim();
      const limit = q.limit === undefined ? undefined : Number(q.limit);
      return a().wordFrequencies(requireProjectId(), language || undefined, limit);
    }),
  );

  app.get('/api/analysis/document-code-matrix', wrap(() => a().documentCodeMatrix(requireProjectId())));

  app.get('/api/analysis/inter-rater', wrap(() => a().interRater(requireProjectId())));

  app.get('/api/analysis/framework-matrix', wrap(() => a().frameworkMatrix(requireProjectId())));

  app.get(
    '/api/analysis/jaccard',
    wrap((req) => {
      const includeDescendants = req.query.includeDescendants === 'true';
      return a().jaccard(requireProjectId(), { includeDescendants });
    }),
  );

  app.get(
    '/api/analysis/kwic',
    wrap((req) => {
      const q = req.query as { term?: string; window?: string };
      const term = q.term?.trim();
      if (!term) throw new Error('El término de búsqueda es obligatorio.');
      const window = q.window === undefined ? undefined : Number(q.window);
      return a().kwic(requireProjectId(), term, { window });
    }),
  );

  app.get('/api/analysis/fleiss-kappa', wrap(() => a().fleissKappa(requireProjectId())));

  app.get('/api/analysis/krippendorff-alpha', wrap(() => a().krippendorffAlpha(requireProjectId())));

  // --- Investigadoras -----------------------------------------------------
  app.get('/api/researchers', wrap(() => getSession().repos.researchers.list(requireProjectId())));

  app.post(
    '/api/researchers',
    wrap((req) => {
      const body = (req.body ?? {}) as {
        name?: string;
        initials?: string;
        color?: string;
        isPrimary?: boolean;
      };
      const name = body.name?.trim();
      if (!name) throw new Error('El nombre de la investigadora es obligatorio.');
      return getSession().repos.researchers.create(requireProjectId(), {
        name,
        initials: body.initials?.trim() || undefined,
        color: body.color ?? undefined,
        isPrimary: body.isPrimary === true,
      });
    }),
  );

  // --- Citas --------------------------------------------------------------
  app.post(
    '/api/quotations',
    wrap((req) => {
      const body = (req.body ?? {}) as {
        documentId?: string;
        anchor?: QuotationAnchor;
        segmentText?: string;
        context?: Record<string, unknown> | undefined;
        createdBy?: string | undefined;
      };
      const documentId = body.documentId;
      const anchor = body.anchor;
      const segmentText = body.segmentText;
      if (!documentId) throw new Error('El documento es obligatorio.');
      if (!anchor) throw new Error('El ancla de la cita es obligatoria.');
      if (!segmentText) throw new Error('El texto de la cita es obligatorio.');
      return getSession().repos.quotations.create({
        documentId,
        anchor,
        segmentText,
        context: body.context,
        createdBy: body.createdBy,
      });
    }),
  );

  app.get(
    '/api/codes/:id/quotations',
    wrap((req) => {
      const includeDescendants = req.query.includeDescendants === 'true';
      return getSession().repos.quotations.quotationsForCode(paramId(req), includeDescendants);
    }),
  );

  app.delete(
    '/api/quotations/:id',
    wrap((req) => getSession().repos.quotations.remove(paramId(req))),
  );

  app.get(
    '/api/quotations/:id/codes',
    wrap((req) => getSession().repos.codeQuotations.codesForQuotation(paramId(req))),
  );

  // --- Codificación -------------------------------------------------------
  app.post(
    '/api/coding/assign',
    wrap((req) => {
      const body = (req.body ?? {}) as { quotationId?: string; codeId?: string; researcherId?: string | null };
      if (!body.quotationId) throw new Error('La cita es obligatoria.');
      if (!body.codeId) throw new Error('El código es obligatorio.');
      return getSession().services.coding.codeQuotation(body.quotationId, body.codeId, body.researcherId ?? null);
    }),
  );

  app.post(
    '/api/coding/unassign',
    wrap((req) => {
      const body = (req.body ?? {}) as { quotationId?: string; codeId?: string; researcherId?: string | null };
      if (!body.quotationId) throw new Error('La cita es obligatoria.');
      if (!body.codeId) throw new Error('El código es obligatorio.');
      return getSession().services.coding.uncodeQuotation(body.quotationId, body.codeId, body.researcherId ?? null);
    }),
  );

  app.post(
    '/api/coding/set-codes',
    wrap((req) => {
      const body = (req.body ?? {}) as { quotationId?: string; codeIds?: string[]; researcherId?: string | null };
      if (!body.quotationId) throw new Error('La cita es obligatoria.');
      if (!Array.isArray(body.codeIds)) throw new Error('La lista de códigos es obligatoria.');
      getSession().services.coding.setQuotationCodes(body.quotationId, body.codeIds, body.researcherId ?? null);
    }),
  );

  app.get(
    '/api/coding/density',
    wrap(() => getSession().services.coding.codingDensityPerResearcher()),
  );

  // --- Memos, relaciones y atributos -------------------------------------
  app.get(
    '/api/memos',
    wrap((req) => {
      const q = req.query as { targetType?: string; targetId?: string };
      const targetType = q.targetType;
      const targetId = q.targetId;
      if (!targetType || !targetId) throw new Error('targetType y targetId son obligatorios.');
      if (!MEMO_TARGETS.has(targetType)) throw new Error(`targetType no válido: ${targetType}`);
      return getSession().repos.memos.listByTarget(targetType as MemoTargetType, targetId);
    }),
  );

  app.post(
    '/api/memos',
    wrap((req) => {
      const body = (req.body ?? {}) as {
        targetType?: string;
        targetId?: string;
        title?: string;
        body?: string;
        createdBy?: string | null;
      };
      const title = body.title?.trim();
      if (!title) throw new Error('El título del memo es obligatorio.');
      if (!body.body) throw new Error('El contenido del memo es obligatorio.');
      if (!body.targetType || !body.targetId) throw new Error('targetType y targetId son obligatorios.');
      if (!MEMO_TARGETS.has(body.targetType)) throw new Error(`targetType no válido: ${body.targetType}`);
      return getSession().repos.memos.create({
        projectId: requireProjectId(),
        targetType: body.targetType as MemoTargetType,
        targetId: body.targetId,
        title,
        body: body.body,
        createdBy: body.createdBy ?? null,
      });
    }),
  );

  app.get(
    '/api/relations',
    wrap((req) => {
      const q = req.query as { entityType?: string; entityId?: string };
      // Con entityType+entityId lista las relaciones de esa entidad; sin ellos, todas.
      if (q.entityType && q.entityId) {
        if (!RELATION_ENTITIES.has(q.entityType)) throw new Error(`entityType no válido: ${q.entityType}`);
        return getSession().repos.relations.listForEntity(q.entityType as RelationEntityType, q.entityId);
      }
      return getSession().repos.relations.listByProject(requireProjectId());
    }),
  );

  app.post(
    '/api/relations',
    wrap((req) => {
      const body = (req.body ?? {}) as {
        sourceType?: string;
        sourceId?: string;
        targetType?: string;
        targetId?: string;
        relationType?: string;
        label?: string | null;
      };
      if (!body.sourceType || !body.sourceId || !body.targetType || !body.targetId) {
        throw new Error('sourceType/sourceId/targetType/targetId son obligatorios.');
      }
      if (!RELATION_ENTITIES.has(body.sourceType) || !RELATION_ENTITIES.has(body.targetType)) {
        throw new Error('Tipo de entidad no válido.');
      }
      return getSession().repos.relations.create({
        projectId: requireProjectId(),
        source: { type: body.sourceType as RelationEntityType, id: body.sourceId },
        target: { type: body.targetType as RelationEntityType, id: body.targetId },
        relationType: body.relationType,
        label: body.label ?? null,
      });
    }),
  );

  app.delete(
    '/api/relations/:id',
    wrap((req) => getSession().repos.relations.remove(paramId(req))),
  );

  app.get('/api/attributes', wrap(() => getSession().repos.attributes.listAttributes(requireProjectId())));

  app.post(
    '/api/attributes',
    wrap((req) => {
      const body = (req.body ?? {}) as { name?: string; dataType?: string };
      const name = body.name?.trim();
      if (!name) throw new Error('El nombre del atributo es obligatorio.');
      const types: ReadonlySet<string> = new Set(['string', 'number', 'boolean', 'date']);
      if (!body.dataType || !types.has(body.dataType)) throw new Error(`Tipo de atributo no válido: ${body.dataType}`);
      return getSession().repos.attributes.createAttribute(requireProjectId(), {
        name,
        dataType: body.dataType as 'string' | 'number' | 'boolean' | 'date',
      });
    }),
  );

  app.post(
    '/api/attributes/set-value',
    wrap((req) => {
      const body = (req.body ?? {}) as { documentId?: string; attributeId?: string; value?: string | null };
      if (!body.documentId || !body.attributeId) throw new Error('documentId y attributeId son obligatorios.');
      getSession().repos.attributes.setValue(body.documentId, body.attributeId, body.value ?? null);
    }),
  );

  app.delete(
    '/api/attributes/:id',
    wrap((req) => getSession().repos.attributes.removeAttribute(paramId(req))),
  );

  app.get(
    '/api/attributes/values',
    wrap(() => {
      const map = getSession().repos.attributes.valuesForProject(requireProjectId());
      return Array.from(map.values()).flat();
    }),
  );

  app.get('/api/codes/families', wrap(() => getSession().repos.codes.listFamilies(requireProjectId())));

  app.patch(
    '/api/documents/:id/text',
    wrap((req) => {
      const body = (req.body ?? {}) as { rawText?: string; language?: string };
      const updated = getSession().repos.documents.updateRawText(paramId(req), body.rawText ?? '', body.language);
      if (!updated) throw new Error('El documento no existe.');
      return updated;
    }),
  );

  // --- SPA fallback (desktop dist) ----------------------------------------
  const desktopDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../desktop/dist');
  const indexHtml = path.join(desktopDist, 'index.html');
  if (fs.existsSync(indexHtml)) {
    app.use(express.static(desktopDist));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(indexHtml);
    });
  }

  // --- Manejo de errores no capturados (multer, body parse, ...) ----------
  app.use((err: unknown, _req: Request, res: Response, _next: express.NextFunction) => {
    const message = err instanceof Error ? err.message : String(err);
    if (process.env.NODE_ENV !== 'test') console.error('[server] unexpected error:', message);
    const result: IpcResult<never> = { ok: false, error: message };
    res.status(500).json(result);
  });

  return { app };
}