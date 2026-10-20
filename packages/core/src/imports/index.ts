/**
 * Barril de exportación del módulo de importación.
 * Expone fuentes de archivo, extractores, registro e importador.
 */

// Fuentes de archivo
export { NodeFileSource, BufferFileSource } from './file-source.js';
export type { FileSource } from '../types/services.js';

// Extractores
export { TextExtractorImpl, HtmlExtractor } from './extractors/text.extractor.js';
export { PdfExtractor } from './extractors/pdf.extractor.js';
export { DocxExtractor } from './extractors/docx.extractor.js';
export { StructuredExtractor } from './extractors/structured.extractor.js';
export { MediaExtractor, type MediaMetadataExtractor } from './extractors/media.extractor.js';
export type { TextExtractor, TextExtraction } from '../types/services.js';

// Registro
export { SUPPORTED_TYPES, resolveExtractor } from './registry.js';

// Importador
export { SqliteDocumentImporter } from './document-importer.js';
export type { DocumentImporter, ImportOptions } from '../types/services.js';
export type { ImportResult, FileType } from '../types/domain.js';