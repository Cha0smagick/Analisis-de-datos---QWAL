/**
 * Tests del servicio de codificación (CodingService).
 *
 * Cubren la asignación/desasignación de códigos a citas, el reemplazo
 * masivo de códigos, la consulta con descendientes y la densidad de
 * codificación por investigador, contra una base efímera en memoria.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  openDriver,
  migrate,
  ProjectRepository,
  DocumentRepository,
  CodeRepository,
  QuotationRepository,
  ResearcherRepository,
  Session,
  newId,
  NotFoundError,
  WrongProjectError,
} from '../src/index.js';

import type {
  DbDriver,
  Project,
  SourceDocument,
  Code,
  Quotation,
  Researcher,
} from '../src/index.js';

describe('coding: servicio de codificación', () => {
  let driver: DbDriver;
  let project: Project;
  let document: SourceDocument;
  let codeA: Code;
  let codeB: Code;
  let quotationQ1: Quotation;
  let quotationQ2: Quotation;
  let researcherAna: Researcher;
  let researcherLuis: Researcher;
  let session: Session;

  beforeEach(async () => {
    driver = (await openDriver({ backend: 'node', filename: ':memory:' })) as DbDriver;
    migrate(driver);

    project = new ProjectRepository(driver).create({ name: `Proyecto coding ${newId()}` });

    researcherAna = new ResearcherRepository(driver).create(project.id, {
      name: 'Ana',
      initials: 'AN',
    });
    researcherLuis = new ResearcherRepository(driver).create(project.id, {
      name: 'Luis',
      initials: 'LU',
    });

    document = new DocumentRepository(driver).create(project.id, {
      title: 'Entrevista 1',
      fileType: 'txt',
      rawText: 'El investigador analiza datos cualitativos con rigor',
    });

    codeA = new CodeRepository(driver).create(project.id, { name: 'Tema A' });
    codeB = new CodeRepository(driver).create(project.id, {
      name: 'Subtema B',
      parentId: codeA.id,
    });

    quotationQ1 = new QuotationRepository(driver).create({
      documentId: document.id,
      anchor: { kind: 'text', documentId: document.id, startPos: 0, endPos: 15 },
      segmentText: 'El investigador',
    });
    quotationQ2 = new QuotationRepository(driver).create({
      documentId: document.id,
      anchor: { kind: 'text', documentId: document.id, startPos: 30, endPos: 35 },
      segmentText: 'datos',
    });

    session = new Session(driver, project.id);
    session.load();
  });

  afterEach(() => {
    driver.close();
  });

  it('asigna un código a una cita y lo verifica', () => {
    session.services.coding.codeQuotation(quotationQ1.id, codeA.id, researcherAna.id);

    const coded = session.repos.quotations.listByCode(codeA.id);
    expect(coded.map((q) => q.id)).toEqual([quotationQ1.id]);
  });

  it('lanza NotFoundError si la cita no existe', () => {
    expect(() => session.services.coding.codeQuotation('q-inexistente', codeA.id)).toThrow(
      NotFoundError,
    );
  });

  it('lanza NotFoundError si el código no existe', () => {
    expect(() => session.services.coding.codeQuotation(quotationQ1.id, 'c-inexistente')).toThrow(
      NotFoundError,
    );
  });

  it('lanza WrongProjectError si el código pertenece a otro proyecto', () => {
    const otherProject = new ProjectRepository(driver).create({ name: 'Otro proyecto' });
    const otherCode = new CodeRepository(driver).create(otherProject.id, { name: 'Código ajeno' });

    expect(() => session.services.coding.codeQuotation(quotationQ1.id, otherCode.id)).toThrow(
      WrongProjectError,
    );
  });

  it('lanza WrongProjectError si la cita pertenece a otro proyecto', () => {
    const otherProject = new ProjectRepository(driver).create({ name: 'Proyecto citado' });
    const otherDocument = new DocumentRepository(driver).create(otherProject.id, {
      title: 'Documento ajeno',
      fileType: 'txt',
      rawText: 'texto ajeno',
    });
    const otherQuotation = new QuotationRepository(driver).create({
      documentId: otherDocument.id,
      anchor: { kind: 'text', documentId: otherDocument.id, startPos: 0, endPos: 5 },
      segmentText: 'ajeno',
    });

    expect(() => session.services.coding.codeQuotation(otherQuotation.id, codeA.id)).toThrow(
      WrongProjectError,
    );
  });

  it('es idempotente al codificar la misma cita dos veces', () => {
    session.services.coding.codeQuotation(quotationQ1.id, codeA.id, researcherAna.id);
    session.services.coding.codeQuotation(quotationQ1.id, codeA.id, researcherAna.id);

    expect(session.repos.quotations.listByCode(codeA.id)).toHaveLength(1);
  });

  it('desasigna un código de una cita', () => {
    session.services.coding.codeQuotation(quotationQ1.id, codeA.id, researcherAna.id);
    session.services.coding.uncodeQuotation(quotationQ1.id, codeA.id);

    expect(session.repos.quotations.listByCode(codeA.id)).toHaveLength(0);
  });

  it('desasignar una relación inexistente no lanza error', () => {
    expect(() => session.services.coding.uncodeQuotation(quotationQ1.id, codeA.id)).not.toThrow();
  });

  it('reemplaza los códigos de una investigadora sin tocar los de las demás', () => {
    session.services.coding.codeQuotation(quotationQ1.id, codeA.id, researcherAna.id);
    session.services.coding.setQuotationCodes(quotationQ1.id, [codeB.id], researcherLuis.id);

    // Ana mantiene su codificación: setQuotationCodes solo reescribe la fila de
    // quien llama, que antes borraba el trabajo de las demás investigadoras.
    expect(session.repos.quotations.listByCode(codeA.id)).toHaveLength(1);
    expect(session.repos.quotations.listByCode(codeB.id)).toHaveLength(1);

    const cqs = session.repos.codeQuotations.listByProject(project.id);
    expect(cqs).toHaveLength(2);
    expect(cqs.find((c) => c.codeId === codeA.id)?.researcherId).toBe(researcherAna.id);
    expect(cqs.find((c) => c.codeId === codeB.id)?.researcherId).toBe(researcherLuis.id);
  });

  it('incluye citas de códigos descendientes', () => {
    session.services.coding.codeQuotation(quotationQ1.id, codeA.id);
    session.services.coding.codeQuotation(quotationQ2.id, codeB.id);

    const withDesc = session.services.coding.quotationsForCodeIncludingDescendants(codeA.id);
    expect(withDesc.map((q) => q.id).sort()).toEqual([quotationQ1.id, quotationQ2.id].sort());

    // Sin descendientes solo aparece la cita directa
    expect(session.repos.quotations.listByCode(codeA.id).map((q) => q.id)).toEqual([quotationQ1.id]);
  });

  it('lanza error en quotationsForCodeIncludingDescendants si el código no existe', () => {
    expect(() =>
      session.services.coding.quotationsForCodeIncludingDescendants('c-inexistente'),
    ).toThrow(/Código no encontrado/);
  });

  it('calcula la densidad de codificación por investigador', () => {
    session.services.coding.codeQuotation(quotationQ1.id, codeA.id, researcherAna.id);
    session.services.coding.codeQuotation(quotationQ1.id, codeB.id, researcherLuis.id);
    session.services.coding.codeQuotation(quotationQ2.id, codeB.id, researcherAna.id);

    const density = session.services.coding.codingDensityPerResearcher();

    expect(density).toHaveLength(2);
    expect(density[0]).toEqual({
      researcherId: researcherAna.id,
      researcherName: 'Ana',
      quotations: 2,
    });
    expect(density[1]).toEqual({
      researcherId: researcherLuis.id,
      researcherName: 'Luis',
      quotations: 1,
    });
  });
});
