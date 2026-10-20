/**
 * Implementación del servicio de auditoría (audit_log).
 *
 * Único punto de escritura en audit_log. Cada fila encadena con la anterior:
 *
 *   prev_hash = row_hash del último registro de la cadena GLOBAL
 *   row_hash  = sha256(canonical_json({proyecto, investigador, ts, acción,
 *                                        entidad, id, detalles}) + (prev_hash ?? ''))
 *
 * Dos decisiones deliberadas:
 *
 * 1. La cadena es GLOBAL (ordenada por `id`), no por proyecto. Como `audit_log.project_id`
 *    es `ON DELETE SET NULL`, borrar un proyecto no destruye su historial: las filas quedan
 *    huerfanas pero la cadena sigue siendo verificable de principio a fin.
 *
 * 2. `record()` es SINCRÓNICO. El driver es síncrono, así que un `record()` asíncrono
 *    obligaba a leer `prev_hash`, esperar un `await` y después insertar: dos llamadas
 *    solapadas leían el mismo `prev_hash` y bifurcaban la cadena. Con hash síncrono la
 *    lectura y el INSERT caben en una única transacción y la cadena no se puede bifurcar.
 */

import type { DbDriver } from '../db/driver.js';
import { nowIso } from '../util/id.js';
import type { AuditEntryInput, AuditService } from '../types/services.js';

/* -------------------------------------------------------------------------- */
/* SHA-256                                                                     */
/* -------------------------------------------------------------------------- */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/**
 * SHA-256 síncrono, sin dependencias.
 *
 * Se implementa aquí (y no con `node:crypto` ni `crypto.subtle`) porque
 * `node:crypto` no existe en el navegador y `crypto.subtle.digest` es asíncrono.
 * Una implementación propia resuelve ambas limitaciones a la vez: la misma función
 * síncrona funciona en Node y en WASM, y permite cerrar la transacción de la cadena
 * sin un `await` en medio. Se valida contra los vectores de prueba de NIST en
 * `tests/audit.service.test.ts`.
 */
export function sha256Hex(message: string): string {
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);

  const bytes = new TextEncoder().encode(message);
  const bitLength = bytes.length * 8;

  // Longitud con relleno: mensaje + 0x80 + ceros + 8 bytes de longitud en bits (big-endian).
  const paddedLength = ((bytes.length + 9 + 63) >> 6) << 6;
  const block = new Uint8Array(paddedLength);
  block.set(bytes);
  block[bytes.length] = 0x80;

  const view = new DataView(block.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15]!;
      const y = w[i - 2]!;
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }

    let a = h[0]!;
    let b = h[1]!;
    let c = h[2]!;
    let d = h[3]!;
    let e = h[4]!;
    let f = h[5]!;
    let g = h[6]!;
    let hh = h[7]!;

    for (let i = 0; i < 64; i++) {
      const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + s1 + ch + K[i]! + w[i]!) >>> 0;
      const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) >>> 0;

      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }

    h[0] = (h[0]! + a) >>> 0;
    h[1] = (h[1]! + b) >>> 0;
    h[2] = (h[2]! + c) >>> 0;
    h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0;
    h[5] = (h[5]! + f) >>> 0;
    h[6] = (h[6]! + g) >>> 0;
    h[7] = (h[7]! + hh) >>> 0;
  }

  let out = '';
  for (let i = 0; i < 8; i++) out += h[i]!.toString(16).padStart(8, '0');
  return out;
}

/* -------------------------------------------------------------------------- */
/* Servicio                                                                    */
/* -------------------------------------------------------------------------- */

/** Serializa a JSON canónico (claves ordenadas) para que el hash sea determinista. */
function canonicalJson(obj: Record<string, unknown>): string {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = obj[key];
  }
  return JSON.stringify(sorted);
}

export class AuditServiceImpl implements AuditService {
  private readonly db: DbDriver;

  constructor(db: DbDriver) {
    this.db = db;
  }

  /** `row_hash` de la última fila de la cadena global, o `null` si la cadena está vacía. */
  private lastRowHash(): string | null {
    const rows = this.db.query<{ row_hash: string }>(
      `SELECT row_hash FROM audit_log ORDER BY id DESC LIMIT 1`,
    );
    return rows[0]?.row_hash ?? null;
  }

  /**
   * Registra una entrada en la cadena de auditoría.
   *
   * El hash cubre TODAS las columnas del registro, no solo `details_json`: si el hash
   * ignorara acción, entidad o proyecto, esos campos se podrían reescribir sin romper
   * la cadena y la auditoría no probaría nada.
   */
  record(entry: AuditEntryInput): void {
    const ts = nowIso();
    const detailsJson = canonicalJson(entry.details);

    this.db.transaction(() => {
      const prevHash = this.lastRowHash();
      const envelope = canonicalJson({
        action: entry.action,
        details_json: detailsJson,
        entity_id: entry.entityId,
        entity_type: entry.entityType,
        prev_hash: prevHash,
        project_id: entry.projectId,
        researcher_id: entry.researcherId,
        ts,
      });
      const rowHash = sha256Hex(envelope);

      this.db.run(
        `INSERT INTO audit_log (
           project_id, researcher_id, ts, action, entity_type, entity_id,
           details_json, prev_hash, row_hash
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entry.projectId,
          entry.researcherId,
          ts,
          entry.action,
          entry.entityType,
          entry.entityId,
          detailsJson,
          prevHash,
          rowHash,
        ],
      );
    });
  }

  /**
   * Verifica la cadena completa recalculando cada hash desde `prev_hash`.
   * Devuelve la fila donde la cadena se rompe, o `null` si es íntegra.
   */
  verifyChain(): { id: number; reason: string } | null {
    const rows = this.db.query<{
      id: number;
      project_id: string | null;
      researcher_id: string | null;
      ts: string;
      action: string;
      entity_type: string;
      entity_id: string | null;
      details_json: string;
      prev_hash: string | null;
      row_hash: string;
    }>(`SELECT * FROM audit_log ORDER BY id ASC`);

    let expectedPrev: string | null = null;
    for (const row of rows) {
      if (row.prev_hash !== expectedPrev) {
        return { id: row.id, reason: 'prev_hash no enlaza con la fila anterior' };
      }
      const envelope = canonicalJson({
        action: row.action,
        details_json: row.details_json,
        entity_id: row.entity_id,
        entity_type: row.entity_type,
        prev_hash: row.prev_hash,
        project_id: row.project_id,
        researcher_id: row.researcher_id,
        ts: row.ts,
      });
      if (sha256Hex(envelope) !== row.row_hash) {
        return { id: row.id, reason: 'row_hash no coincide con el contenido de la fila' };
      }
      expectedPrev = row.row_hash;
    }
    return null;
  }
}
