/**
 * Utilidades de identificación y tiempo.
 *
 * Genera UUID v4 criptográficamente seguros y timestamps ISO-8601 UTC
 * con precisión de milisegundos. Usa Web Crypto API (Node 18+/browser).
 */

/**
 * Genera un nuevo UUID v4.
 *
 * @returns UUID v4 como string (36 caracteres, formato 8-4-4-4-12).
 */
export function newId(): string {
  return crypto.randomUUID();
}

/**
 * Obtiene la fecha/hora actual en formato ISO-8601 UTC con milisegundos.
 *
 * @returns Timestamp ISO-8601 (p. ej. "2024-01-15T14:30:45.123Z").
 */
export function nowIso(): string {
  return new Date().toISOString();
}