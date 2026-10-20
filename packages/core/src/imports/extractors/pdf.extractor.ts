/**
 * Extractor para archivos PDF usando pdf-parse.
 */

import { createRequire } from 'node:module';
import type { FileSource, TextExtractor, TextExtraction } from '../../types/services.js';
import type { FileType } from '../../types/domain.js';

// pdf-parse es un paquete CommonJS sin tipos: se carga con createRequire
// (un require() plano no es válido en un paquete con "type": "module").
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse') as (
  buffer: Buffer | Uint8Array,
  options?: { pagerender?: (pageData: unknown) => string; max?: number; version?: string }
) => Promise<{
  numpages: number;
  numrender: number;
  info: Record<string, unknown>;
  metadata: Record<string, unknown>;
  text: string;
  version: string;
}>;

/**
 * Convierte Uint8Array a ArrayBuffer garantizando ArrayBuffer (no SharedArrayBuffer).
 * new Uint8Array(Uint8Array) copia los datos a un nuevo ArrayBuffer nativo.
 */
function toArrayBuffer(buffer: Uint8Array): ArrayBuffer {
  return new Uint8Array(buffer).buffer;
}

/**
 * Extractor para archivos PDF.
 */
export class PdfExtractor implements TextExtractor {
  /** Tipos de archivo que maneja este extractor. */
  private readonly handledTypes: ReadonlySet<FileType> = new Set(['pdf']);

  canHandle(fileType: FileType, _mimeType?: string): boolean {
    return this.handledTypes.has(fileType);
  }

  async extract(file: FileSource): Promise<TextExtraction> {
    try {
      const buffer = await file.readBuffer();
      const data = await pdfParse(buffer);

      const text = data.text?.trim() ?? '';
      const warnings: string[] = [];

      if (data.numpages === 0) {
        warnings.push('El PDF no contiene páginas.');
      } else if (!text) {
        warnings.push('No se pudo extraer texto del PDF (posiblemente escaneado o protegido).');
      }

      return { text, warnings };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido';
      return {
        text: '',
        warnings: [`Error al procesar el PDF: ${message}`],
      };
    }
  }
}