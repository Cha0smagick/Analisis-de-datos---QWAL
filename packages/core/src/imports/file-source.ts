/**
 * Implementaciones de FileSource para Node.js (fs/promises) y buffers en memoria.
 */

import { promises as fs, statSync } from 'node:fs';
import { basename } from 'node:path';
import type { FileSource } from '../types/services.js';

/**
 * Fuente de archivo respaldada por el sistema de archivos de Node.
 */
export class NodeFileSource implements FileSource {
  private readonly absolutePath: string;
  private readonly mimeTypeHint?: string;
  private cachedSize: number | null = null;
  private cachedMimeType: string | null = null;

  /**
   * @param absolutePath Ruta absoluta al archivo en disco.
   * @param options Opciones opcionales: mimeType como pista (no se valida).
   */
  constructor(absolutePath: string, options?: { mimeType?: string }) {
    this.absolutePath = absolutePath;
    this.mimeTypeHint = options?.mimeType;
  }

  /** Nombre del archivo (basename de la ruta). */
  get name(): string {
    return basename(this.absolutePath);
  }

  /** Ruta absoluta del archivo. */
  get path(): string {
    return this.absolutePath;
  }

  /** Tamaño en bytes (lectura perezosa, cacheada). */
  get size(): number {
    if (this.cachedSize === null) {
      // Nota: esto es síncrono; para uso asíncrono real se usaría fs.stat en métodos async.
      // Manteniendo getter síncrono por compatibilidad con la interfaz.
      try {
        const stats = statSync(this.absolutePath);
        this.cachedSize = stats.size;
      } catch {
        this.cachedSize = 0;
      }
    }
    return this.cachedSize ?? 0;
  }

  /** MIME type (pista opcional, no se detecta automáticamente). */
  get mimeType(): string | undefined {
    if (this.cachedMimeType === null && this.mimeTypeHint) {
      this.cachedMimeType = this.mimeTypeHint;
    }
    return this.cachedMimeType ?? undefined;
  }

  /** Lee el archivo completo como texto UTF-8. */
  async readText(): Promise<string> {
    return fs.readFile(this.absolutePath, 'utf-8');
  }

  /** Lee el archivo completo como Uint8Array. */
  async readBuffer(): Promise<Uint8Array> {
    const buffer = await fs.readFile(this.absolutePath);
    return new Uint8Array(buffer);
  }
}

/**
 * Fuente de archivo respaldada por un Uint8Array en memoria.
 */
export class BufferFileSource implements FileSource {
  readonly name: string;
  readonly path: string | undefined;
  readonly size: number;
  readonly mimeType: string | undefined;
  private readonly data: Uint8Array;

  /**
   * @param options.name Nombre del archivo (p. ej. "documento.pdf").
   * @param options.data Contenido binario del archivo.
   * @param options.mimeType MIME type opcional.
   */
  constructor(options: { name: string; data: Uint8Array; mimeType?: string }) {
    this.name = options.name;
    this.path = undefined;
    this.data = options.data;
    this.size = options.data.byteLength;
    this.mimeType = options.mimeType;
  }

  /** Devuelve el texto decodificado como UTF-8. */
  async readText(): Promise<string> {
    return new TextDecoder('utf-8').decode(this.data);
  }

  /** Devuelve una copia del buffer interno. */
  async readBuffer(): Promise<Uint8Array> {
    return new Uint8Array(this.data);
  }
}