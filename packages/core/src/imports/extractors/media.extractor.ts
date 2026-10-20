/**
 * Extractor para archivos de medios (audio/video) con extracción de metadatos.
 * Usa music-metadata para leer metadatos técnicos y tags.
 */

import type { FileSource, TextExtractor, TextExtraction } from '../../types/services.js';
import type { FileType } from '../../types/domain.js';
import { parseBuffer } from 'music-metadata';
import type { IAudioMetadata } from 'music-metadata';

/**
 * Interfaz extendida para extractores de medios que también obtienen metadatos.
 */
export interface MediaMetadataExtractor extends TextExtractor {
  /**
   * Extrae metadatos técnicos y tags del archivo multimedia.
   * @returns Objeto con propiedades: duration, container, codec, bitrate, sampleRate, channels, title?, artist?, album?
   */
  extractMetadata(file: FileSource): Promise<Record<string, unknown>>;
}

/**
 * Tipos de medios soportados.
 */
const MEDIA_TYPES: ReadonlySet<FileType> = new Set([
  'mp3',
  'wav',
  'm4a',
  'mp4',
  'webm',
  'mkv',
]);

/**
 * Convierte Uint8Array a ArrayBuffer garantizando ArrayBuffer (no SharedArrayBuffer).
 * new Uint8Array(Uint8Array) copia los datos a un nuevo ArrayBuffer nativo.
 */
function toArrayBuffer(buffer: Uint8Array): ArrayBuffer {
  return new Uint8Array(buffer).buffer;
}

/**
 * Extractor para archivos de audio y video.
 * El texto extraído está vacío (los medios no tienen texto indexable directo),
 * pero se extraen metadatos ricos vía extractMetadata().
 */
export class MediaExtractor implements MediaMetadataExtractor {
  canHandle(fileType: FileType, _mimeType?: string): boolean {
    return MEDIA_TYPES.has(fileType);
  }

  /**
   * Los archivos de medios no tienen texto extraíble directo.
   * Devuelve texto vacío sin warnings (es comportamiento esperado).
   */
  async extract(_file: FileSource): Promise<TextExtraction> {
    return { text: '', warnings: [] };
  }

  /**
   * Extrae metadatos técnicos y tags del archivo multimedia.
   */
  async extractMetadata(file: FileSource): Promise<Record<string, unknown>> {
    try {
      const buffer = await file.readBuffer();

      // music-metadata parseBuffer: (uint8Array, fileInfo?, options?)
      // fileInfo puede ser IFileInfo (con size, mimeType, path) o string (MIME type)
      const fileInfo = {
        size: file.size,
        mimeType: file.mimeType,
        path: file.path,
      };
      const metadata = await parseBuffer(buffer, fileInfo);

      const result: Record<string, unknown> = {};

      // Formato / contenedor
      if (metadata.format) {
        result.container = metadata.format.container;
        result.codec = metadata.format.codec;
        result.bitrate = metadata.format.bitrate;
        result.sampleRate = metadata.format.sampleRate;
        result.channels = metadata.format.numberOfChannels;
        if (typeof metadata.format.duration === 'number') {
          result.duration = metadata.format.duration;
        }
      }

      // Tags comunes (title, artist, album, etc.)
      if (metadata.common) {
        if (metadata.common.title) result.title = metadata.common.title;
        if (metadata.common.artist) result.artist = metadata.common.artist;
        if (metadata.common.album) result.album = metadata.common.album;
        if (metadata.common.year) result.year = metadata.common.year;
        if (metadata.common.track?.no) result.track = metadata.common.track.no;
        if (metadata.common.genre?.length) result.genre = metadata.common.genre.join(', ');
        if (metadata.common.picture?.length) {
          result.hasCoverArt = true;
          result.coverArtMimeType = metadata.common.picture[0]?.format;
        }
      }

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido';
      // No lanzamos: devolvemos objeto vacío con warning implícito en el campo
      return { error: `No se pudieron extraer metadatos: ${message}` };
    }
  }
}