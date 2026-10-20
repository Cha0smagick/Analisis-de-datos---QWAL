/**
 * Extractor para formatos estructurados (CSV, XLSX).
 * Convierte cada fila a "v1 | v2 | ...".
 */

import type { FileSource, TextExtractor, TextExtraction } from '../../types/services.js';
import type { FileType } from '../../types/domain.js';
import { parse as parseCsv } from 'csv-parse/sync';
import * as XLSX from 'xlsx';

/**
 * Convierte Uint8Array a ArrayBuffer garantizando ArrayBuffer (no SharedArrayBuffer).
 * new Uint8Array(Uint8Array) copia los datos a un nuevo ArrayBuffer nativo.
 */
function toArrayBuffer(buffer: Uint8Array): ArrayBuffer {
  return new Uint8Array(buffer).buffer;
}

/**
 * Extractor para CSV y XLSX.
 */
export class StructuredExtractor implements TextExtractor {
  /** Tipos de archivo que maneja este extractor. */
  private readonly handledTypes: ReadonlySet<FileType> = new Set(['csv', 'xlsx']);

  canHandle(fileType: FileType, _mimeType?: string): boolean {
    return this.handledTypes.has(fileType);
  }

  async extract(file: FileSource): Promise<TextExtraction> {
    try {
      const buffer = await file.readBuffer();
      const fileType = this.getFileTypeFromName(file.name);

      if (fileType === 'csv') {
        return this.extractCsv(buffer);
      }
      if (fileType === 'xlsx') {
        return this.extractXlsx(buffer);
      }

      return { text: '', warnings: ['Tipo de archivo estructurado no reconocido.'] };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido';
      return {
        text: '',
        warnings: [`Error al procesar archivo estructurado: ${message}`],
      };
    }
  }

  private getFileTypeFromName(name: string): 'csv' | 'xlsx' | null {
    const lower = name.toLowerCase();
    if (lower.endsWith('.csv')) return 'csv';
    if (lower.endsWith('.xlsx')) return 'xlsx';
    return null;
  }

  private extractCsv(buffer: Uint8Array): TextExtraction {
    try {
      const text = new TextDecoder('utf-8').decode(buffer);

      if (!text.trim()) {
        return { text: '', warnings: ['El archivo CSV está vacío.'] };
      }

      const records = parseCsv(text, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });

      if (records.length === 0) {
        return { text: '', warnings: ['El archivo CSV no contiene filas de datos.'] };
      }

      const lines = records.map((row: Record<string, unknown>) =>
        Object.values(row)
          .map((v) => (v === null || v === undefined ? '' : String(v)))
          .join(' | ')
      );

      return { text: lines.join('\n'), warnings: [] };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido';
      return {
        text: '',
        warnings: [`Error al parsear CSV: ${message}`],
      };
    }
  }

  private extractXlsx(buffer: Uint8Array): TextExtraction {
    try {
      const arrayBuffer = toArrayBuffer(buffer);
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });

      if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
        return { text: '', warnings: ['El archivo XLSX no contiene hojas.'] };
      }

      // Usar la primera hoja - TypeScript no narrows el tipo tras check de length
      const sheetName = workbook.SheetNames[0] as string;
      const sheet = workbook.Sheets[sheetName];

      if (!sheet) {
        return { text: '', warnings: [`La hoja "${sheetName}" no existe o está vacía.`] };
      }

      // Convertir a JSON con header row
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', header: 1 });

      if (rows.length === 0) {
        return { text: '', warnings: ['La hoja de cálculo no contiene datos.'] };
      }

      // rows[0] son los headers si hay datos
      const dataRows = rows.slice(1) as unknown[][];

      if (dataRows.length === 0) {
        return { text: '', warnings: ['La hoja de cálculo solo contiene encabezados.'] };
      }

      const lines = dataRows.map((row) =>
        row.map((v) => (v === null || v === undefined ? '' : String(v))).join(' | ')
      );

      return { text: lines.join('\n'), warnings: [] };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido';
      return {
        text: '',
        warnings: [`Error al procesar XLSX: ${message}`],
      };
    }
  }
}