/**
 * Servicio de codificación (code_quotation).
 *
 * Capa de escritura principal para la codificación: asignar y desasignar códigos a
 * citas, consultar citas por código (incluyendo descendientes) y medir densidad por
 * investigador.
 *
 * Un registro por (código, cita, investigador). Cuando se pasa `researcherId` las
 * operaciones afectan SOLO a las codificaciones de ese investigador; sin él, a las
 * codificaciones sin investigador. Así el trabajo de un evaluador nunca destruye el de
 * otro, que es el requisito para poder medir concordancia inter-evaluadora.
 */

import type { DbDriver } from '../db/driver.js';
import type { CodeQuotation, Quotation, Researcher } from '../types/domain.js';
import { InvalidInputError, NotFoundError, WrongProjectError } from '../types/errors.js';
import type { AuditService } from '../types/services.js';

/** Repositorios mínimos requeridos. */
interface CodingRepos {
  codeQuotations: {
    listByProject(projectId: string): CodeQuotation[];
    add(codeId: string, quotationId: string, researcherId: string | null): boolean;
    remove(codeId: string, quotationId: string, researcherId?: string | null): boolean;
    removeAllForQuotation(quotationId: string, researcherId?: string | null): void;
    countDistinctQuotationsByResearcher(projectId: string): Map<string, number>;
  };
  quotations: {
    get(quotationId: string): Quotation | undefined;
    /** El descendiente se resuelve en SQL con un CTE recursivo dentro del repo. */
    quotationsForCode(codeId: string, includeDescendants?: boolean): Quotation[];
  };
  codes: {
    get(codeId: string): { id: string; projectId: string; parentId: string | null } | undefined;
  };
  documents: {
    get(documentId: string): { id: string; projectId: string } | undefined;
  };
  researchers: {
    get(researcherId: string): Researcher | undefined;
    list(projectId: string): Researcher[];
  };
}

export class CodingService {
  private readonly driver: DbDriver;
  private readonly projectId: string;
  private readonly repos: CodingRepos;
  private readonly audit: AuditService | null;

  constructor(
    driver: DbDriver,
    projectId: string,
    repos: CodingRepos,
    audit: AuditService | null = null,
  ) {
    this.driver = driver;
    this.projectId = projectId;
    this.repos = repos;
    this.audit = audit;
  }

  /** Valida que la cita exista y que su documento pertenezca a este proyecto. */
  private requireQuotation(quotationId: string): Quotation {
    const quotation = this.repos.quotations.get(quotationId);
    if (!quotation) throw new NotFoundError('Cita', quotationId);

    const document = this.repos.documents.get(quotation.documentId);
    if (!document) throw new NotFoundError('Documento', quotation.documentId);
    if (document.projectId !== this.projectId) {
      throw new WrongProjectError('Cita', quotationId);
    }
    return quotation;
  }

  /** Valida que el código exista y pertenezca a este proyecto. */
  private requireCode(codeId: string): void {
    const code = this.repos.codes.get(codeId);
    if (!code) throw new NotFoundError('Código', codeId);
    if (code.projectId !== this.projectId) throw new WrongProjectError('Código', codeId);
  }

  /** Valida que el investigador exista y pertenezca a este proyecto. */
  private requireResearcher(researcherId: string | null): string | null {
    if (researcherId === null) return null;
    const researcher = this.repos.researchers.get(researcherId);
    if (!researcher) throw new NotFoundError('Investigador', researcherId);
    if (researcher.projectId !== this.projectId) {
      throw new WrongProjectError('Investigador', researcherId);
    }
    return researcherId;
  }

  /**
   * Asigna un código a una cita. Idempotente: si ese investigador ya tenía el código en
   * esa cita no se inserta nada.
   */
  codeQuotation(quotationId: string, codeId: string, researcherId?: string | null): boolean {
    this.requireQuotation(quotationId);
    this.requireCode(codeId);
    const researcher = this.requireResearcher(researcherId ?? null);

    const inserted = this.driver.transaction(() =>
      this.repos.codeQuotations.add(codeId, quotationId, researcher),
    );

    if (inserted && this.audit) {
      this.audit.record({
        projectId: this.projectId,
        researcherId: researcher,
        action: 'code.assign',
        entityType: 'quotation',
        entityId: quotationId,
        details: { codeId },
      });
    }
    return inserted;
  }

  /**
   * Quita un código de una cita.
   *
   * Con `researcherId` solo se retira la codificación de ese investigador; sin él se
   * retiran todas las de ese par código/cita.
   *
   * @returns `true` si se eliminó al menos una asignación.
   */
  uncodeQuotation(quotationId: string, codeId: string, researcherId?: string | null): boolean {
    this.requireQuotation(quotationId);
    this.requireCode(codeId);
    const researcher = this.requireResearcher(researcherId ?? null);

    const removed = this.driver.transaction(() =>
      this.repos.codeQuotations.remove(codeId, quotationId, researcher),
    );

    if (removed && this.audit) {
      this.audit.record({
        projectId: this.projectId,
        researcherId: researcher,
        action: 'code.unassign',
        entityType: 'quotation',
        entityId: quotationId,
        details: { codeId },
      });
    }
    return removed;
  }

  /**
   * Deja la cita con exactamente `codeIds`, para un solo investigador.
   *
   * Solo toca las codificaciones de `researcherId`: las de los demás investigadores se
   * conservan. Antes esta operación borraba TODAS las filas de la cita y reinsertaba
   * todo a nombre de un único investigador, lo que destruía silenciosamente el trabajo
   * de codificación de los demás.
   */
  setQuotationCodes(quotationId: string, codeIds: string[], researcherId?: string | null): void {
    this.requireQuotation(quotationId);
    if (new Set(codeIds).size !== codeIds.length) {
      throw new InvalidInputError('La lista de códigos contiene duplicados');
    }
    for (const codeId of codeIds) this.requireCode(codeId);
    const researcher = this.requireResearcher(researcherId ?? null);

    this.driver.transaction(() => {
      this.repos.codeQuotations.removeAllForQuotation(quotationId, researcher);
      for (const codeId of codeIds) {
        this.repos.codeQuotations.add(codeId, quotationId, researcher);
      }
    });

    if (this.audit) {
      this.audit.record({
        projectId: this.projectId,
        researcherId: researcher,
        action: 'code.set',
        entityType: 'quotation',
        entityId: quotationId,
        details: { codeIds },
      });
    }
  }

  /**
   * Citas codificadas con un código, incluidas las de sus descendientes.
   * Delega en el CTE recursivo del repositorio de citas: una sola consulta.
   */
  quotationsForCodeIncludingDescendants(codeId: string): Quotation[] {
    this.requireCode(codeId);
    return this.repos.quotations.quotationsForCode(codeId, true);
  }

  /**
   * Densidad de codificación por investigador: cuántas citas DISTINTAS codificó cada uno.
   *
   * Se cuentan citas, no asignaciones: aplicar tres códigos a la misma cita sigue siendo
   * una cita, y contar asignaciones inflaba la densidad de quien fragmentó su codificación.
   * Los investigadores registrados sin ninguna cita se incluyen con 0.
   */
  codingDensityPerResearcher(): Array<{
    researcherId: string;
    researcherName: string;
    quotations: number;
  }> {
    const counts = this.repos.codeQuotations.countDistinctQuotationsByResearcher(this.projectId);
    return this.repos.researchers
      .list(this.projectId)
      .map(researcher => ({
        researcherId: researcher.id,
        researcherName: researcher.name,
        quotations: counts.get(researcher.id) ?? 0,
      }))
      .sort((a, b) => b.quotations - a.quotations || a.researcherName.localeCompare(b.researcherName));
  }
}
