/**
 * Errores de dominio.
 *
 * Antes los servicios lanzaban `new Error('texto en español')`. Eso obligaba a los
 * llamadores (IPC de Electron, API HTTP) a comparar cadenas para decidir qué hacer, y
 * hacía imposible distinguir "no existe" de "es de otro proyecto". Cada error lleva un
 * `code` estable; el mensaje es para humanos.
 */

export type DomainErrorCode =
  /** La entidad no existe. */
  | 'not_found'
  /** La entidad existe pero pertenece a otro proyecto. */
  | 'wrong_project'
  /** La entrada del usuario es inválida. */
  | 'invalid_input'
  /** Choca con una restricción de unicidad o de integridad. */
  | 'conflict'
  /** Se usó la base de datos después de cerrarla. */
  | 'closed';

export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class NotFoundError extends DomainError {
  constructor(entity: string, id: string) {
    super('not_found', `${entity} no encontrado: ${id}`);
  }
}

export class WrongProjectError extends DomainError {
  constructor(entity: string, id?: string) {
    super('wrong_project', id ? `${entity} ${id} no pertenece al proyecto` : `${entity} no pertenece al proyecto`);
  }
}

export class InvalidInputError extends DomainError {
  constructor(message: string) {
    super('invalid_input', message);
  }
}

export class ConflictError extends DomainError {
  constructor(message: string) {
    super('conflict', message);
  }
}
