/**
 * Importador de documentos que usa extractores y persiste en SQLite vía DocumentRepository.
 */

import type {
  DocumentImporter,
  ImportOptions,
  FileSource,
  TextExtractor,
  TextExtraction,
} from '../types/services.js';
import type { ImportResult, FileType } from '../types/domain.js';
import type { MediaMetadataExtractor } from './extractors/media.extractor.js';
import { SUPPORTED_TYPES, resolveExtractor } from './registry.js';
import type { DocumentRepository } from '../repos/index.js';

/**
 * Importador de documentos para SQLite.
 * Usa DocumentRepository para la inserción en base de datos.
 */
export class SqliteDocumentImporter implements DocumentImporter {
  private readonly documentRepo: DocumentRepository;

  /**
   * @param documentRepo Instancia de DocumentRepository para persistencia.
   */
  constructor(documentRepo: DocumentRepository) {
    this.documentRepo = documentRepo;
  }

  /** Tipos de archivo soportados por este importador. */
  get supportedTypes(): ReadonlySet<FileType> {
    return SUPPORTED_TYPES;
  }

  /**
   * Importa un archivo físico/lógico al proyecto.
   * 1. Resuelve extractor por fileType.
   * 2. Extrae texto (y metadatos si es MediaMetadataExtractor).
   * 3. Inserta documento vía DocumentRepository.
   * 4. Devuelve ImportResult con documentId, textLength y warnings.
   */
  async importInto(
    projectId: string,
    file: FileSource,
    fileType: FileType,
    options?: ImportOptions
  ): Promise<ImportResult> {
    // 1. Resolver extractor
    const extractor = resolveExtractor(fileType);
    if (!extractor) {
      throw new Error(`Tipo de archivo no soportado: ${fileType}`);
    }

    // 2. Extraer texto
    const extraction: TextExtraction = await extractor.extract(file);

    // 3. Extraer metadatos adicionales si es MediaMetadataExtractor
    let metadata: Record<string, unknown> = {};
    if (this.isMediaMetadataExtractor(extractor)) {
      metadata = await extractor.extractMetadata(file);
    }

    // Agregar advertencias de extracción a metadata para trazabilidad
    if (extraction.warnings.length > 0) {
      metadata.extractionWarnings = extraction.warnings;
    }

    const title = file.name;
    const language = options?.language ?? null;

    // 4. Insertar vía repositorio (el repo genera el id; NUNCA generar uno aquí:
    //    devolver un uuid propio dejaba un ImportResult.documentId huérfano que
    //    no correspondía a ninguna fila).
    const created = await this.documentRepo.create(projectId, {
      title,
      fileType,
      filePath: file.path ?? null,
      rawText: extraction.text,
      language,
      metadata,
    });
    const textLength = extraction.text.length;

    // 5. Devolver resultado
    return {
      documentId: created.id,
      title,
      fileType,
      textLength,
      warnings: extraction.warnings,
    };
  }

  /**
   * Importa texto plano directamente (sin archivo físico).
   * Crea un documento de tipo 'txt'.
   */
  async importText(
    projectId: string,
    title: string,
    text: string,
    options?: ImportOptions
  ): Promise<ImportResult> {
    const textLength = text.length;
    const metadata: Record<string, unknown> = {};

    const created = await this.documentRepo.create(projectId, {
      title,
      fileType: 'txt',
      filePath: null,
      rawText: text,
      language: options?.language ?? null,
      metadata,
    });

    return {
      documentId: created.id,
      title,
      fileType: created.fileType,
      textLength,
      warnings: [],
    };
  }

  /**
   * Type guard para verificar si el extractor soporta metadatos de medios.
   * Usa una propiedad de marca (brand) en la clase MediaExtractor.
   */
  private isMediaMetadataExtractor(
    extractor: TextExtractor
  ): extractor is MediaMetadataExtractor {
    return 'extractMetadata' in extractor && typeof extractor.extractMetadata === 'function';
  }
}