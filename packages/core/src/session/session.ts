/**
 * Fachada principal de la librería (Session).
 *
 * Unifica el acceso a repositorios, servicios y utilidades para un proyecto.
 * Carga perezosa del importador (dynamic import) para no cargar código pesado en navegador.
 */

import type { DbDriver } from '../db/driver.js';
import type {
  Project,
  SourceDocument,
  Quotation,
  Code,
  Memo,
  Relation,
  Attribute,
  DocumentAttributeValue,
  Researcher,
  CodeTreeNode,
} from '../types/domain.js';
import type { AnalysisService, SearchService, AuditService } from '../types/services.js';
import { NotFoundError } from '../types/errors.js';

import {
  DocumentRepository,
  CodeRepository,
  QuotationRepository,
  MemoRepository,
  RelationRepository,
  AttributeRepository,
  ResearcherRepository,
  CodeQuotationRepository,
  AnalyticsRepository,
} from '../repos/index.js';

import { AnalysisServiceImpl } from '../services/analysis.service.js';
import { SearchServiceImpl } from '../services/search.service.js';
import { AuditServiceImpl } from '../services/audit.service.js';
import { CodingService } from '../coding/coding.service.js';

type SqliteDocumentImporter = {
  importInto(projectId: string, file: FileSource, fileType: string, options?: ImportOptions): Promise<ImportResult>;
  importText(projectId: string, title: string, text: string, options?: ImportOptions): Promise<ImportResult>;
};

interface FileSource {
  name: string;
  path?: string;
  size?: number;
  mimeType?: string;
  readText(): Promise<string>;
  readBuffer(): Promise<Uint8Array>;
}

interface ImportOptions {
  language?: string;
  overwrite?: boolean;
}

interface ImportResult {
  documentId: string;
  title: string;
  fileType: string;
  textLength: number;
  warnings: string[];
}

/** Repositorios expuestos como propiedades readonly. */
export interface SessionRepos {
  documents: DocumentRepository;
  codes: CodeRepository;
  quotations: QuotationRepository;
  memos: MemoRepository;
  relations: RelationRepository;
  attributes: AttributeRepository;
  researchers: ResearcherRepository;
  codeQuotations: CodeQuotationRepository;
  analytics: AnalyticsRepository;
}

/** Servicios expuestos como propiedades readonly. */
export interface SessionServices {
  analysis: AnalysisService;
  search: SearchService;
  audit: AuditService;
  coding: CodingService;
}

/**
 * Sesión de trabajo para un proyecto.
 *
 * Uso:
 *   const driver = await openDriver({ filename: 'proyecto.db' });
 *   migrate(driver);
 *   const session = new Session(driver, projectId);
 *   session.load();
 *   // session.documents.listByProject(projectId), etc.
 */
export class Session {
  private readonly driver: DbDriver;
  private readonly projectId: string;

  // `load()` la asigna; todos los accesores pasan por ensureLoaded() antes de
  // leerla, de modo que el `!` es invariante y no una fuga de undefined.
  private _project!: Project;
  private _loaded = false;

  /** Repositorios (instanciados en load()). */
  public readonly repos: SessionRepos = {} as SessionRepos;
  /** Servicios (instanciados en load()). */
  public readonly services: SessionServices = {} as SessionServices;

  constructor(driver: DbDriver, projectId: string) {
    this.driver = driver;
    this.projectId = projectId;
  }

  /**
   * Carga y valida el proyecto. Debe llamarse antes de usar cualquier repo/servicio.
   * Lanza Error en español si el proyecto no existe.
   */
  load(): void {
    if (this._loaded) return;

    // Verifica que el proyecto existe
    const projectRows = this.driver.query<{ id: string; name: string; description: string; settings_json: string; created_at: string; updated_at: string }>(
      'SELECT id, name, description, settings_json, created_at, updated_at FROM projects WHERE id = ?',
      [this.projectId]
    );

    if (projectRows.length === 0) {
      throw new NotFoundError('Proyecto', this.projectId);
    }

    const row = projectRows[0]!;

    this._project = {
      id: row.id,
      name: row.name,
      description: row.description,
      settings: JSON.parse(row.settings_json ?? '{}'),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    // Instancia repositorios
    this.repos.documents = new DocumentRepository(this.driver);
    this.repos.codes = new CodeRepository(this.driver);
    this.repos.quotations = new QuotationRepository(this.driver);
    this.repos.memos = new MemoRepository(this.driver);
    this.repos.relations = new RelationRepository(this.driver);
    this.repos.attributes = new AttributeRepository(this.driver);
    this.repos.researchers = new ResearcherRepository(this.driver);
    this.repos.codeQuotations = new CodeQuotationRepository(this.driver);
    this.repos.analytics = new AnalyticsRepository(this.driver);

    // Los servicios reciben los repositorios reales directamente. Antes había cuatro
    // adaptadores escritos a mano que reimplementaban un mapeo de fila ya existente en
    // el repo correspondiente; `AnalysisRepos` y `CodingRepos` declaran ahora la
    // superficie mínima con `Pick<>` sobre las clases reales, así que el compilador
    // verifica que lo entregado cumple el contrato en vez de confiar en una copia.
    this.services.analysis = new AnalysisServiceImpl({
      documents: this.repos.documents,
      codes: this.repos.codes,
      quotations: this.repos.quotations,
      codeQuotations: this.repos.codeQuotations,
      researchers: this.repos.researchers,
      attributes: this.repos.attributes,
      analytics: this.repos.analytics,
    });
    this.services.search = new SearchServiceImpl({ driver: this.driver });
    this.services.audit = new AuditServiceImpl(this.driver);
    // El servicio de codificación escribe en audit_log: es el único productor de
    // evidencia del proyecto, así que sin él la cadena de hashes queda vacía.
    this.services.coding = new CodingService(
      this.driver,
      this.projectId,
      {
        codeQuotations: this.repos.codeQuotations,
        quotations: this.repos.quotations,
        codes: this.repos.codes,
        documents: this.repos.documents,
        researchers: this.repos.researchers,
      },
      this.services.audit,
    );

    this._loaded = true;
  }

  // ---------------------------------------------------------------------------
  // Accessors readonly
  // ---------------------------------------------------------------------------

  get project(): Project {
    this.ensureLoaded();
    return this._project;
  }

  get documents(): DocumentRepository {
    this.ensureLoaded();
    return this.repos.documents;
  }

  get quotations(): QuotationRepository {
    this.ensureLoaded();
    return this.repos.quotations;
  }

  get codes(): CodeRepository {
    this.ensureLoaded();
    return this.repos.codes;
  }

  get memos(): MemoRepository {
    this.ensureLoaded();
    return this.repos.memos;
  }

  get relations(): RelationRepository {
    this.ensureLoaded();
    return this.repos.relations;
  }

  get attributes(): AttributeRepository {
    this.ensureLoaded();
    return this.repos.attributes;
  }

  get researchers(): ResearcherRepository {
    this.ensureLoaded();
    return this.repos.researchers;
  }

  get codeQuotations(): CodeQuotationRepository {
    this.ensureLoaded();
    return this.repos.codeQuotations;
  }

  get analytics(): AnalyticsRepository {
    this.ensureLoaded();
    return this.repos.analytics;
  }

  get analysis(): AnalysisService {
    this.ensureLoaded();
    return this.services.analysis;
  }

  get search(): SearchService {
    this.ensureLoaded();
    return this.services.search;
  }

  get audit(): AuditService {
    this.ensureLoaded();
    return this.services.audit;
  }

  get coding(): CodingService {
    this.ensureLoaded();
    return this.services.coding;
  }

  /**
   * Importador de documentos (carga perezosa vía dynamic import).
   * Solo carga el código pesado (mammoth, pdf-parse, etc.) cuando se usa.
   * Devuelve una instancia de SqliteDocumentImporter con el DocumentRepository ya inyectado.
   */
  get importer(): Promise<SqliteDocumentImporter> {
    this.ensureLoaded();
    return import('../imports/index.js').then(
      (mod) => new mod.SqliteDocumentImporter(this.repos.documents),
    );
  }

  private ensureLoaded(): void {
    if (!this._loaded) {
      throw new Error('Session no cargada. Llama a session.load() primero.');
    }
  }
}