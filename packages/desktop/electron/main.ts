/**
 * Proceso principal de Electron.
 *
 * Responsabilidades: abrir la base SQLite (nodo nativo o, si el módulo nativo
 * no funciona dentro de Electron, sql.js en WASM), mantener una `Session` por
 * proyecto activo y traducir cada canal IPC a una llamada de los repositorios o
 * servicios del núcleo.
 *
 * Los tipos de retorno de cada canal salen de `shared/ipc.ts`, que a su vez los
 * importa de `@qualicanvas/core`. Este archivo no normaliza ni adapta nada: si
 * el contrato y el núcleo discrepan, el error debe saltar en el compilador, no
 * esconderse detrás de una capa de traducción.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { app, BrowserWindow, dialog, ipcMain } from 'electron';

import {
  NodeFileSource,
  openDriver,
  migrate,
  optimizeFullText,
  ProjectRepository,
  Session,
  SqlJsDriver,
  SqliteDocumentImporter,
  type DbDriver,
  type FileType,
  type MemoTargetType,
  type Project,
  type RelationEntityType,
} from '@qualicanvas/core';

import type {
  CreateQuotationInput,
  DbBackend,
  DbOpenResult,
  DocumentWithText,
} from '../shared/ipc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let driver: DbDriver | null = null;
/** Backend efectivo de la base abierta; `sqljs` implica base entera en memoria. */
let backend: DbBackend = 'node';
let dbPath: string | null = null;
let activeProjectId: string | null = null;
const sessions = new Map<string, Session>();

const EXT_TO_FILE_TYPE: Record<string, FileType> = {
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.txt': 'txt',
  '.md': 'md',
  '.rtf': 'rtf',
  '.odt': 'odt',
  '.html': 'html',
  '.htm': 'html',
  '.mp3': 'mp3',
  '.wav': 'wav',
  '.m4a': 'm4a',
  '.mp4': 'mp4',
  '.webm': 'webm',
  '.mkv': 'mkv',
  '.jpg': 'jpg',
  '.jpeg': 'jpg',
  '.png': 'png',
  '.webp': 'webp',
  '.csv': 'csv',
  '.xlsx': 'xlsx',
  '.ods': 'ods',
  '.json': 'json',
};

function extToFileType(file: string): FileType {
  return EXT_TO_FILE_TYPE[path.extname(file).toLowerCase()] ?? 'other';
}

/** Extensiones sin punto inicial, tal como las espera el diálogo de archivos. */
const SUPPORTED_EXTENSIONS = Object.keys(EXT_TO_FILE_TYPE).map((ext) => ext.slice(1));

function requireDriver(): DbDriver {
  if (!driver) throw new Error('No hay una base de datos abierta.');
  return driver;
}

function requireProjectId(): string {
  if (!activeProjectId) throw new Error('No hay un proyecto activo.');
  return activeProjectId;
}

/** Sesión del proyecto activo, creada y cargada la primera vez que se usa. */
function getSession(): Session {
  const projectId = requireProjectId();
  let session = sessions.get(projectId);
  if (!session) {
    session = new Session(requireDriver(), projectId);
    session.load();
    sessions.set(projectId, session);
  }
  return session;
}

function closeDatabase(): void {
  sessions.clear();
  if (driver) {
    driver.close();
    driver = null;
  }
  dbPath = null;
  activeProjectId = null;
}

/**
 * Abre (o crea) una base en `file`.
 *
 * El controlador nativo de SQLite suele fallar dentro de Electron por
 * desajustes de ABI. Cuando eso ocurre se recurre a sql.js, que ejecuta SQLite
 * en WASM: la base completa pasa a vivir en memoria, así que el backend
 * efectivo se devuelve al renderer para que la interfaz pueda avisar en lugar
 * de degradar el comportamiento en silencio.
 */
async function openDatabase(file: string): Promise<DbOpenResult> {
  closeDatabase();

  let opened: DbDriver;
  let effective: DbBackend;
  try {
    opened = openDriver({ backend: 'node', filename: file });
    effective = 'node';
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`[db] better-sqlite3 no disponible (${reason}); se usa sql.js en memoria.`);
    opened = await openDriver({ backend: 'sqljs', filename: file });
    effective = 'sqljs';
  }

  try {
    await migrate(opened);
    optimizeFullText(opened);
  } catch (err) {
    opened.close();
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`La base ${path.basename(file)} no se pudo preparar: ${reason}`);
  }

  driver = opened;
  backend = effective;
  dbPath = file;
  activeProjectId = null;
  return { dbPath: file, projects: new ProjectRepository(opened).list(), backend: effective };
}

/**
 * Con sql.js los cambios viven en memoria: sin volcar el archivo, todo el
 * trabajo de la sesión se pierde al salir. Se escribe el estado actual antes de
 * cerrar y desde el canal `db:flush`.
 */
async function flushIfInMemory(): Promise<boolean> {
  if (!driver || !dbPath || !(driver instanceof SqlJsDriver)) return false;
  await writeFile(dbPath, driver.exportDatabase());
  return true;
}

/**
 * Envoltura de un canal IPC. Los errores de dominio conservan su código para
 * que la interfaz pueda distinguirlos sin comparar texto.
 */
function handle<TArgs extends unknown[], T>(
  channel: string,
  fn: (...args: TArgs) => T | Promise<T>,
): void {
  ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
    try {
      return { ok: true as const, data: await fn(...(args as TArgs)) };
    } catch (err) {
      const code = (err as { code?: unknown } | null)?.code;
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
        ...(typeof code === 'string' ? { code } : {}),
      };
    }
  });
}

const MEMO_TARGETS: readonly MemoTargetType[] = ['project', 'document', 'quotation', 'code', 'memo', 'relation'];
const RELATION_ENTITIES: readonly RelationEntityType[] = ['code', 'quotation', 'memo', 'document'];

function memoTarget(value: string): MemoTargetType {
  const found = MEMO_TARGETS.find((candidate) => candidate === value);
  if (!found) throw new Error(`Tipo de nota no válido: ${value}`);
  return found;
}

function relationEntity(value: string): RelationEntityType {
  const found = RELATION_ENTITIES.find((candidate) => candidate === value);
  if (!found) throw new Error(`Tipo de relación no válido: ${value}`);
  return found;
}

function registerIpc(): void {
  const s = (): Session => getSession();
  const a = () => getSession().services.analysis;

  // --- Base de datos -------------------------------------------------------
  handle('db:open', async (): Promise<DbOpenResult | null> => {
    const picked = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'SQLite', extensions: ['db', 'sqlite', 'sqlite3'] }],
    });
    if (picked.canceled || picked.filePaths.length === 0) return null;
    return openDatabase(picked.filePaths[0]!);
  });

  handle('db:create', async (): Promise<DbOpenResult | null> => {
    const picked = await dialog.showSaveDialog({
      defaultPath: 'qualicanvas.db',
      filters: [{ name: 'SQLite', extensions: ['db'] }],
    });
    if (picked.canceled || !picked.filePath) return null;
    return openDatabase(picked.filePath);
  });

  handle('db:flush', (): Promise<boolean> => flushIfInMemory());

  // --- Proyectos -----------------------------------------------------------
  handle('projects:list', (): Project[] => new ProjectRepository(requireDriver()).list());

  handle('projects:create', (input: { name: string; description?: string }) =>
    new ProjectRepository(requireDriver()).create({ name: input.name, description: input.description }));

  handle('projects:open', (projectId: string) => {
    const project = new ProjectRepository(requireDriver()).get(projectId);
    if (!project) throw new Error('El proyecto no existe.');
    new Session(requireDriver(), projectId).load();
    activeProjectId = projectId;
    return project;
  });

  handle('projects:remove', (projectId: string) => {
    const removed = new ProjectRepository(requireDriver()).remove(projectId);
    if (removed) {
      sessions.delete(projectId);
      if (activeProjectId === projectId) activeProjectId = null;
    }
    return removed;
  });

  // --- Documentos ----------------------------------------------------------
  handle('documents:list', () => s().repos.documents.listByProject(requireProjectId()));

  handle('documents:pickAndImport', async () => {
    const picked = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Documentos', extensions: SUPPORTED_EXTENSIONS }],
    });
    if (picked.canceled) return [];
    const projectId = requireProjectId();
    const importer = new SqliteDocumentImporter(s().repos.documents);
    const results = [];
    for (const file of picked.filePaths) {
      results.push(await importer.importInto(projectId, new NodeFileSource(file), extToFileType(file)));
    }
    return results;
  });

  handle('documents:get', (documentId: string): DocumentWithText | null => {
    const document = s().repos.documents.get(documentId);
    if (!document) return null;
    return { document, text: s().repos.documents.getRawText(documentId) ?? '' };
  });

  handle('documents:updateRawText', (documentId: string, text: string, language?: string) =>
    s().repos.documents.updateRawText(documentId, text, language));

  handle('documents:remove', (documentId: string) => s().repos.documents.remove(documentId));

  // --- Códigos -------------------------------------------------------------
  handle('codes:list', () => s().repos.codes.listByProject(requireProjectId()));
  handle('codes:tree', () => s().repos.codes.tree(requireProjectId()));
  handle('codes:listFamilies', () => s().repos.codes.listFamilies(requireProjectId()));

  handle('codes:create', (input: { name: string; parentId?: string | null; color?: string | null; description?: string }) =>
    s().repos.codes.create(requireProjectId(), {
      name: input.name,
      parentId: input.parentId ?? null,
      color: input.color ?? null,
      description: input.description,
    }));

  handle('codes:update', (codeId: string, patch: { name?: string; color?: string | null; description?: string }) => {
    const updated = s().repos.codes.update(codeId, patch);
    if (!updated) throw new Error('El código no existe.');
    return updated;
  });

  handle('codes:move', (codeId: string, parentId: string | null) => s().repos.codes.move(codeId, parentId));
  handle('codes:remove', (codeId: string) => s().repos.codes.remove(codeId));

  // --- Investigadoras ------------------------------------------------------
  handle('researchers:list', () => s().repos.researchers.list(requireProjectId()));
  handle('researchers:create', (input: { name: string; initials?: string | null; color?: string | null; isPrimary?: boolean }) =>
    s().repos.researchers.create(requireProjectId(), {
      name: input.name,
      initials: input.initials ?? null,
      color: input.color ?? null,
      isPrimary: input.isPrimary ?? false,
    }));

  // --- Citas ---------------------------------------------------------------
  handle('quotations:listByDocument', (documentId: string) => s().repos.quotations.listByDocument(documentId));
  handle('quotations:listByCode', (codeId: string, includeDescendants?: boolean) =>
    s().repos.quotations.quotationsForCode(codeId, includeDescendants ?? false));
  handle('quotations:create', (input: CreateQuotationInput) => s().repos.quotations.create(input));
  handle('quotations:remove', (quotationId: string) => s().repos.quotations.remove(quotationId));
  handle('quotations:codes', (quotationId: string) => s().repos.codeQuotations.codesForQuotation(quotationId));

  // --- Codificación --------------------------------------------------------
  handle('coding:assign', (quotationId: string, codeId: string, researcherId?: string | null) =>
    s().services.coding.codeQuotation(quotationId, codeId, researcherId ?? null));
  handle('coding:unassign', (quotationId: string, codeId: string, researcherId?: string | null) =>
    s().services.coding.uncodeQuotation(quotationId, codeId, researcherId ?? null));
  handle('coding:setCodes', (quotationId: string, codeIds: string[], researcherId?: string | null): void => {
    s().services.coding.setQuotationCodes(quotationId, codeIds, researcherId ?? null);
  });
  handle('coding:density', () => s().services.coding.codingDensityPerResearcher());

  // --- Notas, relaciones y atributos ---------------------------------------
  handle('memos:listForTarget', (targetType: string, targetId: string) =>
    s().repos.memos.listByTarget(memoTarget(targetType), targetId));
  handle('memos:create', (input: { targetType: string; targetId: string; title: string; body: string; createdBy?: string | null }) =>
    s().repos.memos.create({
      projectId: requireProjectId(),
      targetType: memoTarget(input.targetType),
      targetId: input.targetId,
      title: input.title,
      body: input.body,
      createdBy: input.createdBy ?? null,
    }));
  handle('relations:listForEntity', (entityType: string, entityId: string) =>
    s().repos.relations.listForEntity(relationEntity(entityType), entityId));
  handle('attributes:list', () => s().repos.attributes.listAttributes(requireProjectId()));

  // --- Búsqueda ------------------------------------------------------------
  handle('search:query', (query: string, options?: { limit?: number; offset?: number; near?: number }) =>
    s().services.search.search(requireProjectId(), query, options));

  // --- Análisis: los diez informes del núcleo, sin adaptación --------------
  handle('analysis:codeFrequencies', () => a().codeFrequencies(requireProjectId()));
  handle('analysis:cooccurrence', () => a().cooccurrence(requireProjectId()));
  handle('analysis:documentCodeMatrix', () => a().documentCodeMatrix(requireProjectId()));
  handle('analysis:wordFrequencies', (language?: string, limit?: number) =>
    a().wordFrequencies(requireProjectId(), language, limit));
  handle('analysis:interRater', () => a().interRater(requireProjectId()));
  handle('analysis:frameworkMatrix', () => a().frameworkMatrix(requireProjectId()));
  handle('analysis:jaccard', (options?: { includeDescendants?: boolean }) => a().jaccard(requireProjectId(), options));
  handle('analysis:kwic', (term: string, options?: { window?: number }) => a().kwic(requireProjectId(), term, options));
  handle('analysis:fleissKappa', () => a().fleissKappa(requireProjectId()));
  handle('analysis:krippendorffAlpha', () => a().krippendorffAlpha(requireProjectId()));
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    webPreferences: {
      preload: path.join(app.getAppPath(), 'electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const devServer = process.env.VITE_DEV_SERVER_URL;
  if (devServer) {
    void mainWindow.loadURL(devServer);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  try {
    registerIpc();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  } catch (err) {
    dialog.showErrorBox('QualiCanvas no pudo iniciar', err instanceof Error ? err.message : String(err));
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (event) => {
  if (backend === 'sqljs' && driver instanceof SqlJsDriver) {
    // Sin volcado previo, sql.js perdería todo el trabajo de la sesión.
    event.preventDefault();
    void flushIfInMemory()
      .catch((err: unknown) => {
        dialog.showErrorBox('No se pudo guardar la base', err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        closeDatabase();
        app.quit();
      });
    return;
  }
  closeDatabase();
});