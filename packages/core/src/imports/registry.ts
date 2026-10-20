/**
 * Registro central de tipos de archivo soportados y resolución de extractores.
 */

import type { TextExtractor } from '../types/services.js';
import type { FileType } from '../types/domain.js';
import { TextExtractorImpl } from './extractors/text.extractor.js';
import { HtmlExtractor } from './extractors/text.extractor.js';
import { PdfExtractor } from './extractors/pdf.extractor.js';
import { DocxExtractor } from './extractors/docx.extractor.js';
import { StructuredExtractor } from './extractors/structured.extractor.js';
import { MediaExtractor } from './extractors/media.extractor.js';

/**
 * Conjunto de todos los tipos de archivo soportados por el sistema de importación.
 * Debe coincidir con la unión FileType en types/domain.ts (excepto 'other' que es fallback).
 */
export const SUPPORTED_TYPES: ReadonlySet<FileType> = new Set([
  'pdf',
  'docx',
  'txt',
  'md',
  'rtf',
  'odt',
  'html',
  'mp3',
  'wav',
  'm4a',
  'mp4',
  'webm',
  'mkv',
  'jpg',
  'png',
  'webp',
  'csv',
  'xlsx',
  'ods',
  'json',
]);

// Instancias singleton de extractores (sin estado)
const TEXT_EXTRACTOR = new TextExtractorImpl();
const HTML_EXTRACTOR = new HtmlExtractor();
const PDF_EXTRACTOR = new PdfExtractor();
const DOCX_EXTRACTOR = new DocxExtractor();
const STRUCTURED_EXTRACTOR = new StructuredExtractor();
const MEDIA_EXTRACTOR = new MediaExtractor();

/**
 * Resuelve el extractor apropiado para un tipo de archivo.
 * Orden de prioridad:
 * 1. Texto/HTML (txt, md, html)
 * 2. PDF
 * 3. DOCX
 * 4. Estructurados (csv, xlsx)
 * 5. Medios (audio/video)
 *
 * El mimeType se usa solo como pista secundaria; la decisión principal es fileType.
 *
 * @param fileType Tipo de archivo principal.
 * @param mimeType MIME type opcional como pista.
 * @returns Instancia de TextExtractor o null si no hay extractor para el tipo.
 */
export function resolveExtractor(
  fileType: FileType,
  mimeType?: string
): TextExtractor | null {
  // 1. Texto plano y HTML
  if (TEXT_EXTRACTOR.canHandle(fileType, mimeType)) {
    // Para HTML, preferimos HtmlExtractor que limpia etiquetas
    if (fileType === 'html') {
      return HTML_EXTRACTOR;
    }
    return TEXT_EXTRACTOR;
  }

  // 2. PDF
  if (PDF_EXTRACTOR.canHandle(fileType, mimeType)) {
    return PDF_EXTRACTOR;
  }

  // 3. DOCX
  if (DOCX_EXTRACTOR.canHandle(fileType, mimeType)) {
    return DOCX_EXTRACTOR;
  }

  // 4. Estructurados (CSV, XLSX)
  if (STRUCTURED_EXTRACTOR.canHandle(fileType, mimeType)) {
    return STRUCTURED_EXTRACTOR;
  }

  // 5. Medios (audio/video) - tienen extractor que implementa MediaMetadataExtractor
  if (MEDIA_EXTRACTOR.canHandle(fileType, mimeType)) {
    return MEDIA_EXTRACTOR;
  }

  // Tipos no soportados (rtf, odt, jpg, png, webp, ods, json, other)
  return null;
}