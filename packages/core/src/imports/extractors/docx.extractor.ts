/**
 * Extractor para archivos DOCX usando mammoth.
 */

import type { FileSource, TextExtractor, TextExtraction } from '../../types/services.js';
import type { FileType } from '../../types/domain.js';
import * as mammoth from 'mammoth';

/**
 * Convierte Uint8Array a ArrayBuffer garantizando ArrayBuffer (no SharedArrayBuffer).
 * new Uint8Array(Uint8Array) copia los datos a un nuevo ArrayBuffer nativo.
 */
function toArrayBuffer(buffer: Uint8Array): ArrayBuffer {
  return new Uint8Array(buffer).buffer;
}

/**
 * Extractor para archivos DOCX.
 */
export class DocxExtractor implements TextExtractor {
  /** Tipos de archivo que maneja este extractor. */
  private readonly handledTypes: ReadonlySet<FileType> = new Set(['docx']);

  canHandle(fileType: FileType, _mimeType?: string): boolean {
    return this.handledTypes.has(fileType);
  }

  async extract(file: FileSource): Promise<TextExtraction> {
    try {
      const buffer = await file.readBuffer();
      const arrayBuffer = toArrayBuffer(buffer);

      // mammoth acepta { arrayBuffer } | { buffer } | { path } según sus tipos
      const result = await mammoth.extractRawText({ arrayBuffer });

      const text = result.value?.trim() ?? '';
      const warnings: string[] = [];

      if (!text) {
        warnings.push('El documento DOCX no contiene texto extraíble.');
      }

      if (result.messages && result.messages.length > 0) {
        for (const msg of result.messages) {
          if (msg && typeof msg === 'object' && 'message' in msg) {
            warnings.push(String(msg.message));
          }
        }
      }

      return { text, warnings };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido';
      return {
        text: '',
        warnings: [`Error al procesar el DOCX: ${message}`],
      };
    }
  }
}