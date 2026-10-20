/**
 * Tests avanzados del servicio de análisis (AnalysisServiceImpl):
 * jaccard, kwic, fleissKappa y krippendorffAlpha.
 *
 * Las aserciones de known-answers se calcularon y verificaron
 * matemáticamente contra el código de producción.
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

import { AnalysisServiceImpl } from '../src/services/analysis.service.js';

import type { AnalysisRepos } from '../src/services/analysis.service.js';
import type {
  DbDriver,
  Project,
  SourceDocument,
  Code,
  Quotation,
  Researcher,
  CodeQuotation,
  JaccardMatrix,
  KwicReport,
  FleissKappaReport,
  KrippendorffAlphaReport,
} from '../src/index.js';

const NOW = '2025-01-01T00:00:00.000Z';

// ---------------------------------------------------------------------------
// Fakes in-memory para unit tests (AnalysisRepos)
// ---------------------------------------------------------------------------

interface FixtureState {
  documents: SourceDocument[];
  codes: Code[];
  quotations: Quotation[];
  codeQuotations: CodeQuotation[];
  researchers: Researcher[];
}

function makeCode(id: string, name: string, parentId: string | null = null): Code {
  return {
    id,
    projectId: 'p1',
    parentId,
    name,
    color: null,
    description: '',
    createdBy: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeDoc(id: string, rawText: string, title?: string): SourceDocument {
  return {
    id,
    projectId: 'p1',
    title: title ?? `Doc ${id}`,
    fileType: 'txt',
    filePath: null,
    rawText,
    language: null,
    metadata: {},
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeQuotation(id: string, documentId: string): Quotation {
  return {
    id,
    documentId,
    anchor: { kind: 'text', documentId, startPos: 0, endPos: 10 },
    segmentText: 'seg',
    context: {},
    createdBy: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeCq(codeId: string, quotationId: string, researcherId: string): CodeQuotation {
  return { id: `${codeId}|${quotationId}|${researcherId}`, codeId, quotationId, researcherId, createdAt: NOW };
}

function makeResearcher(id: string, name: string): Researcher {
  return {
    id,
    projectId: 'p1',
    name,
    initials: null,
    color: null,
    isPrimary: false,
    createdAt: NOW,
  };
}

function createRepos(state: FixtureState): AnalysisRepos {
  const distinctCodesByQuotation = (): Map<string, Set<string>> => {
    const map = new Map<string, Set<string>>();
    for (const cq of state.codeQuotations) {
      let set = map.get(cq.quotationId);
      if (!set) {
        set = new Set<string>();
        map.set(cq.quotationId, set);
      }
      set.add(cq.codeId);
    }
    return map;
  };

  const codingsByResearcher = (): Map<string, Set<string>> => {
    const map = new Map<string, Set<string>>();
    for (const cq of state.codeQuotations) {
      const researcher = cq.researcherId ?? '__anon__';
      let set = map.get(researcher);
      if (!set) {
        set = new Set<string>();
        map.set(researcher, set);
      }
      set.add(`${cq.codeId}\u0000${cq.quotationId}`);
    }
    return map;
  };

  return {
    documents: {
      listByProject: () => state.documents,
      getRawText: (id) => state.documents.find((d) => d.id === id)?.rawText ?? '',
    },
    codes: {
      listByProject: () => state.codes,
    },
    quotations: {
      listByProject: () => state.quotations,
    },
    codeQuotations: {
      distinctCodesByQuotation: () => distinctCodesByQuotation(),
      codingsByResearcher: () => codingsByResearcher(),
    },
    researchers: {
      list: () => state.researchers,
    },
    attributes: {
      listAttributes: () => [],
      valuesForProject: () => new Map(),
    },
    analytics: {
      cooccurrence: () => [],
      stopWords: () => new Set<string>(),
      stopWordLanguages: () => [],
    },
  };
}

// ---------------------------------------------------------------------------
// jaccard
// ---------------------------------------------------------------------------

describe('analysis: jaccard', () => {
  it('calcula el índice de Jaccard entre pares de códigos', () => {
    const state: FixtureState = {
      documents: [],
      codes: [makeCode('A', 'Tema A'), makeCode('B', 'Tema B')],
      quotations: [makeQuotation('q1', 'd1'), makeQuotation('q2', 'd1'), makeQuotation('q3', 'd1')],
      codeQuotations: [
        makeCq('A', 'q1', 'r1'),
        makeCq('A', 'q2', 'r1'),
        makeCq('B', 'q2', 'r1'),
        makeCq('B', 'q3', 'r1'),
      ],
      researchers: [],
    };
    const service = new AnalysisServiceImpl(createRepos(state));

    const matrix: JaccardMatrix = service.jaccard('p1');

    expect(matrix.projectId).toBe('p1');
    expect(matrix.cells).toHaveLength(1);
    expect(matrix.cells[0]).toMatchObject({
      codeAId: 'A',
      codeBId: 'B',
      intersection: 1,
      union: 3,
      index: 1 / 3,
    });
    expect(matrix.cells[0]!.codeAName).toBe('Tema A');
    expect(matrix.cells[0]!.codeBName).toBe('Tema B');
    expect(matrix.maxIndex).toBeCloseTo(1 / 3, 6);
  });

  it('con includeDescendants, un código padre hereda las citas de sus hijos', () => {
    const state: FixtureState = {
      documents: [],
      codes: [makeCode('P', 'Padre'), makeCode('A', 'Hijo', 'P')],
      quotations: [makeQuotation('q1', 'd1')],
      codeQuotations: [makeCq('A', 'q1', 'r1')],
      researchers: [],
    };
    const service = new AnalysisServiceImpl(createRepos(state));

    const matrix: JaccardMatrix = service.jaccard('p1', { includeDescendants: true });

    expect(matrix.cells).toHaveLength(1);
    // El eje de códigos va ordenado por nombre, de modo que "Hijo" precede a
    // "Padre": el orden de los dos códigos de la celda es ese, no el del árbol.
    expect(matrix.cells[0]).toMatchObject({
      codeAId: 'A',
      codeAName: 'Hijo',
      codeBId: 'P',
      codeBName: 'Padre',
      intersection: 1,
      union: 1,
      index: 1,
    });
    expect(matrix.maxIndex).toBe(1);
  });

  it('sin includeDescendants, un código sin citas directas no genera celdas', () => {
    const state: FixtureState = {
      documents: [],
      codes: [makeCode('P', 'Padre'), makeCode('A', 'Hijo', 'P')],
      quotations: [makeQuotation('q1', 'd1')],
      codeQuotations: [makeCq('A', 'q1', 'r1')],
      researchers: [],
    };
    const service = new AnalysisServiceImpl(createRepos(state));

    const matrix: JaccardMatrix = service.jaccard('p1');

    expect(matrix.cells).toHaveLength(0);
    expect(matrix.maxIndex).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// kwic
// ---------------------------------------------------------------------------

describe('analysis: kwic', () => {
  it('devuelve coincidencias con contexto antes/después, ordenadas', () => {
    const rawText = 'El gato negro corre. El gato blanco duerme.';
    const state: FixtureState = {
      documents: [makeDoc('d1', rawText, 'Entrevista 1')],
      codes: [],
      quotations: [],
      codeQuotations: [],
      researchers: [],
    };
    const service = new AnalysisServiceImpl(createRepos(state));

    const report: KwicReport = service.kwic('p1', 'gato', { window: 2 });

    expect(report.projectId).toBe('p1');
    expect(report.term).toBe('gato');
    expect(report.window).toBe(2);
    expect(report.entries).toHaveLength(2);

    const [first, second] = report.entries;
    expect(first).toMatchObject({
      documentId: 'd1',
      documentTitle: 'Entrevista 1',
      term: 'gato',
      matchStart: 3,
      matchEnd: 7,
      before: 'El ',
      match: 'gato',
      after: ' negro corre',
    });
    expect(second).toMatchObject({
      documentId: 'd1',
      documentTitle: 'Entrevista 1',
      term: 'gato',
      matchStart: 24,
      matchEnd: 28,
      before: 'corre. El ',
      match: 'gato',
      after: ' blanco duerme',
    });
  });

  it('usa window por defecto de 5 palabras', () => {
    const rawText = 'a b c d e gato f g h i j k';
    const state: FixtureState = {
      documents: [makeDoc('d1', rawText)],
      codes: [],
      quotations: [],
      codeQuotations: [],
      researchers: [],
    };
    const service = new AnalysisServiceImpl(createRepos(state));

    const report: KwicReport = service.kwic('p1', 'gato');

    expect(report.window).toBe(5);
    expect(report.entries).toHaveLength(1);
  });

  it('lanza error si el término está vacío', () => {
    const state: FixtureState = {
      documents: [makeDoc('d1', 'contenido')],
      codes: [],
      quotations: [],
      codeQuotations: [],
      researchers: [],
    };
    const service = new AnalysisServiceImpl(createRepos(state));

    expect(() => service.kwic('p1', '')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// fleissKappa (known-answer)
// ---------------------------------------------------------------------------

describe('analysis: fleissKappa', () => {
  // Fixture: 3 citas, 3 raters (r1,r2,r3), 3 categorías (A,B,C)
  //   q1 -> {A(r1), A(r2), C(r3)}
  //   q2 -> {B(r1), B(r2), B(r3)}
  //   q3 -> {C(r1), C(r2), C(r3)}
  // Po = 14/18 = 7/9; Pe = 29/81; kappa = 34/52 ≈ 0.653846
  function fleissState(): FixtureState {
    return {
      documents: [],
      codes: [makeCode('A', 'A'), makeCode('B', 'B'), makeCode('C', 'C')],
      quotations: [makeQuotation('q1', 'd1'), makeQuotation('q2', 'd1'), makeQuotation('q3', 'd1')],
      codeQuotations: [
        makeCq('A', 'q1', 'r1'),
        makeCq('A', 'q1', 'r2'),
        makeCq('C', 'q1', 'r3'),
        makeCq('B', 'q2', 'r1'),
        makeCq('B', 'q2', 'r2'),
        makeCq('B', 'q2', 'r3'),
        makeCq('C', 'q3', 'r1'),
        makeCq('C', 'q3', 'r2'),
        makeCq('C', 'q3', 'r3'),
      ],
      researchers: [makeResearcher('r1', 'R1'), makeResearcher('r2', 'R2'), makeResearcher('r3', 'R3')],
    };
  }

  it('calcula el kappa de Fleiss con valores conocidos', () => {
    const service = new AnalysisServiceImpl(createRepos(fleissState()));

    const report: FleissKappaReport = service.fleissKappa('p1');

    expect(report.subjects).toBe(3);
    expect(report.raters).toBe(3);
    expect(report.categories).toBe(3);
    expect(report.observedAgreement).toBeCloseTo(7 / 9, 4);
    expect(report.expectedAgreement).toBeCloseTo(29 / 81, 4);
    expect(report.kappa).not.toBeNull();
    expect(report.kappa!).toBeCloseTo(34 / 52, 4);
  });

  it('devuelve kappa null en un conjunto degenerado', () => {
    const state: FixtureState = {
      documents: [],
      codes: [makeCode('A', 'A')],
      quotations: [],
      codeQuotations: [],
      researchers: [],
    };
    const service = new AnalysisServiceImpl(createRepos(state));

    const report: FleissKappaReport = service.fleissKappa('p1');

    expect(report.subjects).toBe(0);
    expect(report.raters).toBe(0);
    expect(report.kappa).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// krippendorffAlpha (known-answer)
// ---------------------------------------------------------------------------

describe('analysis: krippendorffAlpha', () => {
  // Mismo fixture que fleissKappa.
  // doNumerator = 4, deNumerator = 52, alpha = 48/52 ≈ 0.923077
  function kripState(): FixtureState {
    return {
      documents: [],
      codes: [makeCode('A', 'A'), makeCode('B', 'B'), makeCode('C', 'C')],
      quotations: [makeQuotation('q1', 'd1'), makeQuotation('q2', 'd1'), makeQuotation('q3', 'd1')],
      codeQuotations: [
        makeCq('A', 'q1', 'r1'),
        makeCq('A', 'q1', 'r2'),
        makeCq('C', 'q1', 'r3'),
        makeCq('B', 'q2', 'r1'),
        makeCq('B', 'q2', 'r2'),
        makeCq('B', 'q2', 'r3'),
        makeCq('C', 'q3', 'r1'),
        makeCq('C', 'q3', 'r2'),
        makeCq('C', 'q3', 'r3'),
      ],
      researchers: [makeResearcher('r1', 'R1'), makeResearcher('r2', 'R2'), makeResearcher('r3', 'R3')],
    };
  }

  it('calcula el alpha de Krippendorff con valores conocidos', () => {
    const service = new AnalysisServiceImpl(createRepos(kripState()));

    const report: KrippendorffAlphaReport = service.krippendorffAlpha('p1');

    expect(report.subjects).toBe(3);
    expect(report.raters).toBe(3);
    expect(report.categories).toBe(3);
    expect(report.alpha).not.toBeNull();
    // q1={A,A,C}, q2={B,B,B}, q3={C,C,C}: sólo q1 aporta desacuerdo, con
    // 2 pares ordenados A↔C sobre m−1=2, o sea Do=2. Los marginales son
    // n_A=2, n_B=3, n_C=4 → De=(81−29)/8=6.5. α = 1 − 2/6.5 = 9/13.
    expect(report.alpha!).toBeCloseTo(9 / 13, 4);
  });

  it('devuelve alpha null en un conjunto degenerado', () => {
    const state: FixtureState = {
      documents: [],
      codes: [makeCode('A', 'A')],
      quotations: [],
      codeQuotations: [],
      researchers: [],
    };
    const service = new AnalysisServiceImpl(createRepos(state));

    const report: KrippendorffAlphaReport = service.krippendorffAlpha('p1');

    expect(report.subjects).toBe(0);
    expect(report.raters).toBe(0);
    expect(report.alpha).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Integración real (openDriver + Session)
// ---------------------------------------------------------------------------

describe('analysis: integración de métodos avanzados', () => {
  let driver: DbDriver;
  let project: Project;
  let session: Session;

  beforeEach(async () => {
    driver = (await openDriver({ backend: 'node', filename: ':memory:' })) as DbDriver;
    migrate(driver);

    project = new ProjectRepository(driver).create({ name: `Proyecto avanzado ${newId()}` });

    const ana = new ResearcherRepository(driver).create(project.id, { name: 'Ana', initials: 'AN' });
    const luis = new ResearcherRepository(driver).create(project.id, { name: 'Luis', initials: 'LU' });

    const doc = new DocumentRepository(driver).create(project.id, {
      title: 'Entrevista 1',
      fileType: 'txt',
      rawText: 'El gato negro corre.',
    });

    const codeA = new CodeRepository(driver).create(project.id, { name: 'Tema A' });
    const codeB = new CodeRepository(driver).create(project.id, { name: 'Tema B' });

    const q1 = new QuotationRepository(driver).create({
      documentId: doc.id,
      anchor: { kind: 'text', documentId: doc.id, startPos: 0, endPos: 18 },
      segmentText: 'El gato negro corre.',
    });

    session = new Session(driver, project.id);
    session.load();

    // Una misma cita codificada con ambos códigos (intersección perfecta)
    session.services.coding.codeQuotation(q1.id, codeA.id, ana.id);
    session.services.coding.codeQuotation(q1.id, codeB.id, luis.id);
  });

  afterEach(() => {
    driver.close();
  });

  it('jaccard con co-ocurrencia total da index 1', () => {
    const matrix: JaccardMatrix = session.services.analysis.jaccard(project.id);

    expect(matrix.cells).toHaveLength(1);
    expect(matrix.cells[0]).toMatchObject({ intersection: 1, union: 1, index: 1 });
    expect(matrix.maxIndex).toBe(1);
  });

  it('kwic con datos reales devuelve entrada con título del documento', () => {
    const report: KwicReport = session.services.analysis.kwic(project.id, 'gato', { window: 2 });

    expect(report.entries).toHaveLength(1);
    expect(report.entries[0]).toMatchObject({
      documentTitle: 'Entrevista 1',
      match: 'gato',
      before: 'El ',
      after: ' negro corre',
    });
  });
});
