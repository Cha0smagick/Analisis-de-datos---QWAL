/**
 * Tests del servicio de análisis (AnalysisServiceImpl).
 *
 * El fixture es determinista: 1 proyecto, 2 investigadoras (Ana y Luis),
 * 1 documento con texto crudo conocido y 3 citas codificadas así:
 *
 *   q1 -> {Tema A (Ana), Tema C (Luis)}   (coocurrencia A-C en q1)
 *   q2 -> {Subtema B (Ana)}               (B es hijo de A)
 *   q3 -> {Tema C (Luis)}
 *
 * Resultados esperados:
 *   - codeFrequencies: directas A=1, B=1, C=2; con descendientes A=2, B=1, C=2;
 *     totalQuotations=3 (citas distintas con codificación), totalDocuments=1,
 *     maxQuotations=2
 *   - cooccurrence: una sola celda (A, C) con count=1; maxCount=1
 *   - documentCodeMatrix: 3 celdas (A=1, B=1, C=2)
 *   - wordFrequencies: 5 términos (stopwords "el" y "con" excluidas),
 *     totalTerms=5, relative=0.2, language "es"
 *   - interRater: la unidad es la decisión (código, cita); Ana={(A,q1),(B,q2)},
 *     Luis={(C,q1),(C,q3)} -> sin decisiones compartidas, codingAgreement=0,
 *     meanKappa=-1.5
 *   - frameworkMatrix: 1 fila (documento), columnas A=[q1], B=[q2], C=[q1,q3]
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
} from '../src/index.js';

import type {
  DbDriver,
  Project,
  SourceDocument,
  Code,
  Quotation,
  Researcher,
  CodeFrequencyReport,
  CooccurrenceMatrix,
  DocumentCodeMatrix,
  WordFrequencyReport,
  InterRaterReport,
  FrameworkMatrixReport,
} from '../src/index.js';

describe('analysis: servicio de análisis', () => {
  let driver: DbDriver;
  let project: Project;
  let document: SourceDocument;
  let codeA: Code;
  let codeB: Code;
  let codeC: Code;
  let q1: Quotation;
  let q2: Quotation;
  let q3: Quotation;
  let ana: Researcher;
  let luis: Researcher;
  let session: Session;

  beforeEach(async () => {
    driver = (await openDriver({ backend: 'node', filename: ':memory:' })) as DbDriver;
    migrate(driver);

    project = new ProjectRepository(driver).create({ name: `Proyecto análisis ${newId()}` });

    ana = new ResearcherRepository(driver).create(project.id, { name: 'Ana', initials: 'AN' });
    luis = new ResearcherRepository(driver).create(project.id, { name: 'Luis', initials: 'LU' });

    document = new DocumentRepository(driver).create(project.id, {
      title: 'Entrevista 1',
      fileType: 'txt',
      rawText: 'el investigador analiza datos cualitativos con rigor',
    });

    codeA = new CodeRepository(driver).create(project.id, { name: 'Tema A' });
    codeB = new CodeRepository(driver).create(project.id, {
      name: 'Subtema B',
      parentId: codeA.id,
    });
    codeC = new CodeRepository(driver).create(project.id, { name: 'Tema C' });

    q1 = new QuotationRepository(driver).create({
      documentId: document.id,
      anchor: { kind: 'text', documentId: document.id, startPos: 0, endPos: 15 },
      segmentText: 'el investigador',
    });
    q2 = new QuotationRepository(driver).create({
      documentId: document.id,
      anchor: { kind: 'text', documentId: document.id, startPos: 16, endPos: 24 },
      segmentText: 'analiza datos',
    });
    q3 = new QuotationRepository(driver).create({
      documentId: document.id,
      anchor: { kind: 'text', documentId: document.id, startPos: 25, endPos: 40 },
      segmentText: 'cualitativos con rigor',
    });

    session = new Session(driver, project.id);
    session.load();

    // Codificación del fixture
    session.services.coding.codeQuotation(q1.id, codeA.id, ana.id);
    session.services.coding.codeQuotation(q1.id, codeC.id, luis.id);
    session.services.coding.codeQuotation(q2.id, codeB.id, ana.id);
    session.services.coding.codeQuotation(q3.id, codeC.id, luis.id);
  });

  afterEach(() => {
    driver.close();
  });

  describe('codeFrequencies', () => {
    it('calcula frecuencias directas y con descendientes', () => {
      const report: CodeFrequencyReport = session.services.analysis.codeFrequencies(project.id);

      const itemA = report.items.find((i) => i.code.name === 'Tema A');
      const itemB = report.items.find((i) => i.code.name === 'Subtema B');
      const itemC = report.items.find((i) => i.code.name === 'Tema C');

      // Frecuencias directas
      expect(itemA?.quotations).toBe(1);
      expect(itemB?.quotations).toBe(1);
      expect(itemC?.quotations).toBe(2);

      // Con descendientes (A incluye a su hijo B)
      expect(itemA?.quotationsWithDescendants).toBe(2);
      expect(itemB?.quotationsWithDescendants).toBe(1);
      expect(itemC?.quotationsWithDescendants).toBe(2);

      // Totales: 3 citas distintas con al menos una codificación (q1, q2, q3).
      // Antes se contaban filas de code_quotation, que summaba 4 al repetir q1.
      expect(report.totalQuotations).toBe(3);
      expect(report.totalDocuments).toBe(1);
      expect(report.maxQuotations).toBe(2);

      // Ítems ordenados desc por quotationsWithDescendants
      expect(report.items.map((i) => i.quotationsWithDescendants)).toEqual([2, 2, 1]);
    });

    it('cuenta documentos distintos por código', () => {
      const report: CodeFrequencyReport = session.services.analysis.codeFrequencies(project.id);
      const itemA = report.items.find((i) => i.code.name === 'Tema A');

      expect(itemA?.documents).toBe(1);
    });

    it('expone el árbol de códigos en cada ítem', () => {
      const report: CodeFrequencyReport = session.services.analysis.codeFrequencies(project.id);
      const itemA = report.items.find((i) => i.code.name === 'Tema A');

      expect(itemA?.code.id).toBe(codeA.id);
      expect(itemA?.code.parentId).toBeNull();
      expect(typeof itemA?.code.depth).toBe('number');
      expect(typeof itemA?.code.path).toBe('string');
      expect(Array.isArray(itemA?.code.children)).toBe(true);
    });
  });

  describe('cooccurrence', () => {
    it('detecta la única coocurrencia en q1 (A y C)', () => {
      const matrix: CooccurrenceMatrix = session.services.analysis.cooccurrence(project.id);

      expect(matrix.projectId).toBe(project.id);
      expect(matrix.codeIds.sort()).toEqual([codeA.id, codeB.id, codeC.id].sort());
      expect(matrix.maxCount).toBe(1);
      expect(matrix.cells).toHaveLength(1);

      const cell = matrix.cells[0]!;
      expect([cell.codeA, cell.codeB].sort()).toEqual([codeA.id, codeC.id].sort());
      expect(cell.count).toBe(1);
    });

    it('incluye una segunda celda cuando otra cita comparte códigos', () => {
      // Nueva cita codificada con {SubTema B, Tema C} -> coocurrencia B-C
      const q4 = new QuotationRepository(driver).create({
        documentId: document.id,
        anchor: { kind: 'text', documentId: document.id, startPos: 41, endPos: 46 },
        segmentText: 'rigor',
      });
      session.services.coding.codeQuotation(q4.id, codeB.id);
      session.services.coding.codeQuotation(q4.id, codeC.id);

      const matrix: CooccurrenceMatrix = session.services.analysis.cooccurrence(project.id);

      expect(matrix.cells).toHaveLength(2);
      expect(matrix.maxCount).toBe(1);

      const cellAC = matrix.cells.find((c) => [c.codeA, c.codeB].sort().join('|') === [codeA.id, codeC.id].sort().join('|'));
      const cellBC = matrix.cells.find((c) => [c.codeA, c.codeB].sort().join('|') === [codeB.id, codeC.id].sort().join('|'));

      expect(cellAC?.count).toBe(1);
      expect(cellBC?.count).toBe(1);
    });
  });

  describe('documentCodeMatrix', () => {
    it('construye la matriz documento x código', () => {
      const matrix: DocumentCodeMatrix = session.services.analysis.documentCodeMatrix(project.id);

      expect(matrix.documentIds).toEqual([document.id]);
      expect(matrix.codeIds.sort()).toEqual([codeA.id, codeB.id, codeC.id].sort());
      expect(matrix.cells).toHaveLength(3);

      const byCode = (codeId: string) => matrix.cells.find((c) => c.codeId === codeId);
      expect(byCode(codeA.id)?.quotationCount).toBe(1);
      expect(byCode(codeB.id)?.quotationCount).toBe(1);
      expect(byCode(codeC.id)?.quotationCount).toBe(2);

      const cell = byCode(codeA.id);
      expect(cell?.documentId).toBe(document.id);
      expect(cell?.documentTitle).toBe('Entrevista 1');
      expect(cell?.codeName).toBe('Tema A');
    });
  });

  describe('wordFrequencies', () => {
    it('cuenta términos excluyendo stopwords y con idioma por defecto', () => {
      const report: WordFrequencyReport = session.services.analysis.wordFrequencies(project.id);

      expect(report.language).toBe('es');
      expect(report.totalTerms).toBe(5);

      // "el" y "con" son stopwords; quedan 5 términos. Todos aparecen una vez, así
      // que el desempate por frecuencia los deja ordenados alfabéticamente: un
      // informe con empates no puede depender del orden de inserción.
      const terms = report.items.map((i) => i.term);
      expect(terms).toEqual(['analiza', 'cualitativos', 'datos', 'investigador', 'rigor']);

      for (const item of report.items) {
        expect(item.count).toBe(1);
        expect(item.relative).toBeCloseTo(1 / 5);
      }
    });

    it('respeta un idioma y un límite explícitos', () => {
      const report: WordFrequencyReport = session.services.analysis.wordFrequencies(
        project.id,
        'es',
        2,
      );

      expect(report.language).toBe('es');
      expect(report.items).toHaveLength(2);
    });
  });

  describe('interRater', () => {
    it('calcula acuerdo y kappa entre pares de investigadoras', () => {
      const report: InterRaterReport = session.services.analysis.interRater(project.id);

      expect(report.projectId).toBe(project.id);
      expect(report.pairs).toHaveLength(1);

      const pair = report.pairs[0]!;
      expect([pair.researcherA, pair.researcherB].sort()).toEqual([ana.id, luis.id].sort());

      // La unidad de acuerdo es la decisión (código, cita), no la cita.
      // Ana={(A,q1),(B,q2)} y Luis={(C,q1),(C,q3)}: no comparten ninguna
      // decisión, así que el acuerdo bruto es 0 sobre una unión de 4.
      expect(pair.codingsA).toBe(2);
      expect(pair.codingsB).toBe(2);
      expect(pair.sharedCodings).toBe(0);
      expect(pair.codingAgreement).toBeCloseTo(0);

      // Detalle por código: nadie aplicó un código que el otro aplicó, así que
      // kappa es negativo en los tres códigos.
      expect(pair.codes.map((c) => c.codeName).sort()).toEqual([
        'Subtema B',
        'Tema A',
        'Tema C',
      ]);
      for (const code of pair.codes) {
        expect(code.kappa === null || code.kappa < 0).toBe(true);
      }
      expect(pair.meanKappa).toBeCloseTo(-1.5);
    });
  });

  describe('frameworkMatrix', () => {
    it('construye la matriz por documento con sus columnas de códigos', () => {
      const report: FrameworkMatrixReport = session.services.analysis.frameworkMatrix(project.id);

      expect(report.projectId).toBe(project.id);
      expect(report.rows).toHaveLength(1);

      const row = report.rows[0]!;
      expect(row.caseId).toBe(document.id);
      expect(row.caseTitle).toBe('Entrevista 1');
      expect(row.attributes).toEqual({});
      expect(row.columns).toHaveLength(3);

      const col = (name: string) => row.columns.find((c) => c.codeName === name);
      expect(col('Tema A')?.quotations.map((q) => q.quotationId).sort()).toEqual([q1.id].sort());
      expect(col('Subtema B')?.quotations.map((q) => q.quotationId).sort()).toEqual([q2.id].sort());
      expect(col('Tema C')?.quotations.map((q) => q.quotationId).sort()).toEqual(
        [q1.id, q3.id].sort(),
      );
    });
  });
});
