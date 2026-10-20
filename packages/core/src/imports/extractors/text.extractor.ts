/**
 * Extractores para formatos de texto plano y HTML.
 */

import type { FileSource, TextExtractor, TextExtraction } from '../../types/services.js';
import type { FileType } from '../../types/domain.js';

/**
 * Convierte Uint8Array a ArrayBuffer garantizando ArrayBuffer (no SharedArrayBuffer).
 * new Uint8Array(Uint8Array) copia los datos a un nuevo ArrayBuffer nativo.
 */
function toArrayBuffer(buffer: Uint8Array): ArrayBuffer {
  return new Uint8Array(buffer).buffer;
}

/**
 * Extractor base para formatos de texto plano (txt, md, html sin procesar).
 */
export class TextExtractorImpl implements TextExtractor {
  /** Tipos de archivo que maneja este extractor. */
  private readonly handledTypes: ReadonlySet<FileType> = new Set(['txt', 'md', 'html']);

  /**
   * Verifica si puede manejar el tipo de archivo dado.
   * @param fileType Tipo de archivo a verificar.
   * @param _mimeType MIME type opcional (no se usa, solo como pista).
   */
  canHandle(fileType: FileType, _mimeType?: string): boolean {
    return this.handledTypes.has(fileType);
  }

  /**
   * Extrae el texto del archivo.
   * Para html, delega en HtmlExtractor si se desea limpiar etiquetas.
   * Aquí devolvemos el contenido crudo UTF-8.
   */
  async extract(file: FileSource): Promise<TextExtraction> {
    try {
      const text = await file.readText();
      return { text, warnings: [] };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido';
      return {
        text: '',
        warnings: [`No se pudo leer el archivo como texto: ${message}`],
      };
    }
  }
}

/**
 * Extractor para HTML que elimina etiquetas y deja solo el texto visible.
 * Usa expresiones regulares sin dependencias externas.
 */
export class HtmlExtractor implements TextExtractor {
  /** Tipos de archivo que maneja este extractor. */
  private readonly handledTypes: ReadonlySet<FileType> = new Set(['html']);

  canHandle(fileType: FileType, _mimeType?: string): boolean {
    return this.handledTypes.has(fileType);
  }

  async extract(file: FileSource): Promise<TextExtraction> {
    try {
      const html = await file.readText();
      const text = this.stripHtmlTags(html);
      return { text, warnings: [] };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido';
      return {
        text: '',
        warnings: [`No se pudo procesar el HTML: ${message}`],
      };
    }
  }

  /**
   * Elimina etiquetas HTML y normaliza espacios.
   * No es un parser completo, pero cubre casos comunes.
   */
  private stripHtmlTags(html: string): string {
    // 1. Eliminar scripts y styles completamente (contenido incluido)
    let result = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ');
    result = result.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ');

    // 2. Reemplazar etiquetas de bloque por saltos de línea
    result = result.replace(/<\/?(div|p|br|h[1-6]|li|tr|td|th|table|ul|ol|section|article|header|footer|nav|main|aside)\b[^>]*>/gi, '\n');

    // 3. Eliminar resto de etiquetas
    result = result.replace(/<[^>]+>/g, ' ');

    // 4. Decodificar entidades HTML básicas
    result = result
      .replace(/&nbsp;/g, ' ')
      .replace(/&/g, '&')
      .replace(/</g, '<')
      .replace(/>/g, '>')
      .replace(/"/g, '"')
      .replace(/'/g, "'")
      .replace(/&([a-z]+);/gi, ' '); // otras entidades -> espacio

    // 5. Normalizar espacios en blanco
    result = result.replace(/\s+/g, ' ').trim();

    return result;
  }
}