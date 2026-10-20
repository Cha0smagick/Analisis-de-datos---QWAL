/**
 * Tipos de dominio simples: `JsonObject` y utilidades de serialización.
 * Separado de domain.ts para evitar dependencias circulares.
 */

export type JsonPrimitive = string | number | boolean | null;

export interface JsonObject {
  [key: string]: JsonPrimitive | JsonObject | JsonArray | undefined;
}

export interface JsonArray extends Array<JsonPrimitive | JsonObject | JsonArray> {}

/** Parsea JSON con degradación segura a `{}` (para columnas *_json). */
export function parseJson<T extends JsonObject = JsonObject>(raw: string | null | undefined): T {
  if (!raw) return {} as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return {} as T;
  }
}

export function stringifyJson(value: unknown): string {
  return JSON.stringify(value ?? {});
}