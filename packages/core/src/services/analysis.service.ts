/**
 * Servicio de análisis cualitativo.
 *
 * Es la única capa que interpreta los repositorios: los repositorios sólo
 * traducen filas SQL a objetos de dominio y este servicio calcula indicadores.
 * Nada aquí escribe SQL.
 *
 * Todas las medidas parten de la misma evidencia: `code_quotation` es una
 * decisión de codificación `(código, cita, investigador)`. Como dos
 * investigadores pueden asignar el mismo código a la misma cita, cualquier
 * recuento de "cuántas citas tiene este código" debe usar conjuntos de citas
 * *distintas* (`distinctCodesByQuotation`) y no el número de filas.
 */

import type { AnalysisService } from '../types/services.js';
import type { Code, CodeTreeNode } from '../types/domain.js';
import type {
  CodeFrequencyItem,
  CodeFrequencyReport,
  CooccurrenceCell,
  CooccurrenceMatrix,
  DocumentCodeCell,
  DocumentCodeMatrix,
  FleissKappaReport,
  FrameworkMatrix,
  FrameworkMatrixCell,
  FrameworkMatrixReport,
  InterRaterCodeAgreement,
  InterRaterPair,
  InterRaterReport,
  JaccardCell,
  JaccardMatrix,
  KrippendorffAlphaReport,
  KwicEntry,
  KwicReport,
  WordFrequencyItem,
  WordFrequencyReport,
} from '../types/analysis.js';
import { InvalidInputError } from '../types/errors.js';
import type { AnalyticsRepository } from '../repos/analytics.repo.js';
import type { AttributeRepository } from '../repos/attribute.repo.js';
import type { CodeQuotationRepository } from '../repos/code_quotation.repo.js';
import type { CodeRepository } from '../repos/code.repo.js';
import type { DocumentRepository } from '../repos/document.repo.js';
import type { QuotationRepository } from '../repos/quotation.repo.js';
import type { ResearcherRepository } from '../repos/researcher.repo.js';
import { nowIso } from '../util/id.js';
import { tokenize, tokenizeWithOffsets } from '../util/text.js';

// ---------------------------------------------------------------------------
// Contrato de repositorios
// ---------------------------------------------------------------------------

/**
 * Structural typing sobre las clases reales: `Session` pasa los repositorios
 * directamente y el compilador verifica que este servicio no toca nada más.
 */
export interface AnalysisRepos {
  documents: Pick<DocumentRepository, 'listByProject' | 'getRawText'>;
  codes: Pick<CodeRepository, 'listByProject'>;
  quotations: Pick<QuotationRepository, 'listByProject'>;
  codeQuotations: Pick<CodeQuotationRepository, 'distinctCodesByQuotation' | 'codingsByResearcher'>;
  researchers: Pick<ResearcherRepository, 'list'>;
  attributes: Pick<AttributeRepository, 'listAttributes' | 'valuesForProject'>;
  analytics: Pick<AnalyticsRepository, 'cooccurrence' | 'stopWords' | 'stopWordLanguages'>;
}

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** Separador de las claves de decisión `(codeId, quotationId)`. */
const DECISION_SEP = '\u0000';

/** Longitud mínima de un término para entrar en el análisis léxico. */
const MIN_TERM_LENGTH = 2;

/** Idioma de la lista de palabras vacías cuando el proyecto no declara otro. */
const FALLBACK_LANGUAGE = 'es';

const byName = (a: { name: string }, b: { name: string }): number =>
  a.name.localeCompare(b.name, 'es');

// ---------------------------------------------------------------------------
// Árbol de códigos
// ---------------------------------------------------------------------------

interface CodeForest {
  roots: CodeTreeNode[];
  nodes: Map<string, CodeTreeNode>;
}

/**
 * Construye el árbol de códigos a partir de la lista plana.
 *
 * La base de datos impide crear ciclos (`codes_no_cycle_insert` y
 * `codes_no_cycle_update`), pero una base abierta con una versión anterior del
 * esquema podría contenerlos; por eso el recorrido lleva un conjunto de
 * ancestros y nunca desciende dos veces al mismo nodo.
 *
 * Un código cuyo padre no existe (huérfano) se trata como raíz: esconderlo
 * hacía que desapareciera de las frecuencias sin dejar rastro.
 */
function buildCodeForest(codes: readonly Code[]): CodeForest {
  const nodes = new Map<string, CodeTreeNode>();
  for (const code of codes) {
    nodes.set(code.id, { ...code, depth: 0, path: '', children: [] });
  }

  const roots: CodeTreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId === null ? undefined : nodes.get(node.parentId);
    if (parent === undefined || parent === node) {
      roots.push(node);
      continue;
    }
    parent.children.push(node);
  }

  const resolved = new Set<string>();
  const walk = (node: CodeTreeNode, ancestors: ReadonlySet<string>): void => {
    if (ancestors.has(node.id)) return;
    resolved.add(node.id);
    const nextAncestors = new Set(ancestors).add(node.id);
    for (const child of node.children) walk(child, nextAncestors);
  };
  for (const root of roots) walk(root, new Set());

  // Ciclo en los datos: los nodos alcanzables sólo desde otro nodo del ciclo no
  // tienen raíz. Se promotes a raíz para que al menos aparezcan en el informe.
  for (const node of nodes.values()) {
    if (!resolved.has(node.id)) roots.push(node);
  }
  for (const root of roots) walk(root, new Set());

  return { roots, nodes };
}

/**
 * Conjunto de descendientes (incluido el propio) para cada nodo del bosque.
 *
 * Un recorrido post-orden iterativo: resolver los hijos antes que el padre evita
 * recalcular el subárbol de cada nodo, que es lo que hacía O(n²) la versión
 * anterior.
 */
function collectSubtrees(forest: CodeForest): Map<string, Set<string>> {
  const subtrees = new Map<string, Set<string>>();
  const visiting = new Set<string>();

  for (const root of forest.roots) {
    const stack: Array<{ node: CodeTreeNode; expanded: boolean }> = [
      { node: root, expanded: false },
    ];
    while (stack.length > 0) {
      const frame = stack.pop()!;
      const { node } = frame;

      if (frame.expanded) {
        visiting.delete(node.id);
        const set = new Set<string>([node.id]);
        for (const child of node.children) {
          const childSubtree = subtrees.get(child.id);
          if (childSubtree === undefined) set.add(child.id);
          else for (const id of childSubtree) set.add(id);
        }
        subtrees.set(node.id, set);
        continue;
      }

      // Un nodo ya resuelto o ya en la pila no se vuelve a expandir: en un
      // ciclo malformado esto evita el bucle infinito.
      if (subtrees.has(node.id) || visiting.has(node.id)) continue;
      visiting.add(node.id);
      stack.push({ node, expanded: true });
      for (const child of node.children) stack.push({ node: child, expanded: false });
    }
  }

  return subtrees;
}

function countDocuments(
  quotationIds: ReadonlySet<string>,
  documentOf: ReadonlyMap<string, string>,
): number {
  const documents = new Set<string>();
  for (const quotationId of quotationIds) {
    const documentId = documentOf.get(quotationId);
    if (documentId !== undefined) documents.add(documentId);
  }
  return documents.size;
}

// ---------------------------------------------------------------------------
// Servicio
// ---------------------------------------------------------------------------

export class AnalysisServiceImpl implements AnalysisService {
  constructor(private readonly repos: AnalysisRepos) {}

  // -------------------------------------------------------------------------
  // Frecuencias
  // -------------------------------------------------------------------------

  /**
   * Frecuencia de citas y de cobertura por código.
   *
   * `quotations`/`documents` son los valores directos del código;
   * `quotationsWithDescendants`/`documentsWithDescendants` agregan todo el
   * subárbol. Antes `documents` ignoraba los descendientes mientras
   * `quotationsWithDescendants` los incluía, lo que hacía que comparar un
   * código con su hijo mostrara cifras aparentemente contradictorias.
   */
  codeFrequencies(projectId: string): CodeFrequencyReport {
    const codes = this.repos.codes.listByProject(projectId);
    const forest = buildCodeForest(codes);
    const subtrees = collectSubtrees(forest);

    const quotations = this.repos.quotations.listByProject(projectId);
    const documentOf = new Map<string, string>();
    for (const quotation of quotations) documentOf.set(quotation.id, quotation.anchor.documentId);

    // Evidencia indexada por código, ya filtrada a citas reales del proyecto.
    const evidence = new Map<string, Set<string>>();
    let totalQuotations = 0;
    for (const [quotationId, codeIds] of this.repos.codeQuotations.distinctCodesByQuotation(
      projectId,
    )) {
      if (!documentOf.has(quotationId)) continue;
      totalQuotations += 1;
      for (const codeId of codeIds) {
        const bucket = evidence.get(codeId);
        if (bucket === undefined) evidence.set(codeId, new Set([quotationId]));
        else bucket.add(quotationId);
      }
    }

    const items: CodeFrequencyItem[] = [];
    for (const code of codes) {
      const node = forest.nodes.get(code.id) ?? {
        ...code,
        depth: 0,
        path: code.name,
        children: [],
      };
      const direct = evidence.get(code.id) ?? new Set<string>();
      const family = subtrees.get(code.id) ?? new Set([code.id]);
      const aggregated = new Set<string>();
      for (const descendantId of family) {
        for (const quotationId of evidence.get(descendantId) ?? []) aggregated.add(quotationId);
      }

      items.push({
        code: node,
        quotations: direct.size,
        documents: countDocuments(direct, documentOf),
        quotationsWithDescendants: aggregated.size,
        documentsWithDescendants: countDocuments(aggregated, documentOf),
      });
    }

    items.sort(
      (a, b) =>
        b.quotationsWithDescendants - a.quotationsWithDescendants ||
        b.quotations - a.quotations ||
        byName(a.code, b.code),
    );

    return {
      projectId,
      generatedAt: nowIso(),
      items,
      // Citas distintas con al menos una codificación; antes sumaba las filas de
      // code_quotation y una cita con tres códigos contaba tres veces.
      totalQuotations,
      totalDocuments: this.repos.documents.listByProject(projectId).length,
      maxQuotations: items.reduce((max, item) => Math.max(max, item.quotationsWithDescendants), 0),
    };
  }

  // -------------------------------------------------------------------------
  // Co-ocurrencia
  // -------------------------------------------------------------------------

  /**
   * Matriz de co-ocurrencia entre códigos.
   *
   * Lee la caché `code_cooccurrence`, que mantienen los triggers
   * `cooc_inc`/`cooc_dec` del esquema. Calcularla en memoria era trabajo
   * duplicado y además se iba del valor `n` que el usuario puede auditar con
   * un `SELECT`. Si la caché se desincroniza, `AnalyticsRepository
   * .rebuildCooccurrence()` la reconstruye.
   */
  cooccurrence(projectId: string): CooccurrenceMatrix {
    const codes = this.repos.codes.listByProject(projectId);
    const ordered = [...codes].sort(byName).map((code) => code.id);
    const axis = new Map(ordered.map((id, index) => [id, index]));

    const cells: CooccurrenceCell[] = [];
    for (const row of this.repos.analytics.cooccurrence(projectId)) {
      if (row.n <= 0) continue;
      if (!axis.has(row.codeA) || !axis.has(row.codeB)) continue;
      cells.push({ codeA: row.codeA, codeB: row.codeB, count: row.n });
    }
    cells.sort(
      (a, b) =>
        b.count - a.count ||
        (axis.get(a.codeA) ?? 0) - (axis.get(b.codeA) ?? 0) ||
        (axis.get(a.codeB) ?? 0) - (axis.get(b.codeB) ?? 0),
    );

    return {
      projectId,
      generatedAt: nowIso(),
      codeIds: ordered,
      cells,
      maxCount: cells.reduce((max, cell) => Math.max(max, cell.count), 0),
    };
  }

  // -------------------------------------------------------------------------
  // Matriz documento × código
  // -------------------------------------------------------------------------

  documentCodeMatrix(projectId: string): DocumentCodeMatrix {
    const codes = [...this.repos.codes.listByProject(projectId)].sort(byName);
    const documents = [...this.repos.documents.listByProject(projectId)].sort((a, b) =>
      a.title.localeCompare(b.title, 'es'),
    );

    const titleOf = new Map(documents.map((document) => [document.id, document.title]));
    const nameOf = new Map(codes.map((code) => [code.id, code.name]));
    const documentOf = new Map<string, string>();
    for (const quotation of this.repos.quotations.listByProject(projectId)) {
      documentOf.set(quotation.id, quotation.anchor.documentId);
    }

    const cells = new Map<string, DocumentCodeCell>();
    for (const [quotationId, codeIds] of this.repos.codeQuotations.distinctCodesByQuotation(
      projectId,
    )) {
      const documentId = documentOf.get(quotationId);
      const documentTitle = documentId === undefined ? undefined : titleOf.get(documentId);
      if (documentId === undefined || documentTitle === undefined) continue;

      for (const codeId of codeIds) {
        const codeName = nameOf.get(codeId);
        if (codeName === undefined) continue;
        const key = `${documentId}${DECISION_SEP}${codeId}`;
        const existing = cells.get(key);
        if (existing === undefined) {
          cells.set(key, {
            documentId,
            documentTitle,
            codeId,
            codeName,
            quotationCount: 1,
          });
        } else {
          existing.quotationCount += 1;
        }
      }
    }

    return {
      projectId,
      generatedAt: nowIso(),
      documentIds: documents.map((document) => document.id),
      codeIds: codes.map((code) => code.id),
      cells: [...cells.values()].sort(
        (a, b) =>
          a.documentTitle.localeCompare(b.documentTitle, 'es') ||
          a.codeName.localeCompare(b.codeName, 'es'),
      ),
    };
  }

  // -------------------------------------------------------------------------
  // Análisis léxico
  // -------------------------------------------------------------------------

  /**
   * Frecuencia de términos sobre el texto de los documentos.
   *
   * Las palabras vacías salen de la tabla `stop_words`, sembrada por
   * `seed_stopwords.sql` para varios idiomas. Antes se usaba una lista fija en
   * español, de modo que pedir `'en'` devolvía resultados filtrados con la lista
   * equivocada sin avisar.
   *
   * `relative` es la proporción sobre los términos *retenidos* (los que
   * sobreviven al filtro), no sobre todos los tokens del corpus.
   */
  wordFrequencies(projectId: string, language?: string, limit = 50): WordFrequencyReport {
    const documents = this.repos.documents.listByProject(projectId);
    const requested = language ?? documents.find((d) => d.language !== null)?.language ?? FALLBACK_LANGUAGE;
    const resolved = this.resolveStopWordLanguage(requested);
    const stopWords = this.repos.analytics.stopWords(resolved);

    const counts = new Map<string, number>();
    let totalTerms = 0;
    for (const document of documents) {
      const text = this.repos.documents.getRawText(document.id);
      if (text === undefined || text.length === 0) continue;
      for (const term of tokenize(text)) {
        if (term.length < MIN_TERM_LENGTH) continue;
        if (stopWords.has(term)) continue;
        counts.set(term, (counts.get(term) ?? 0) + 1);
        totalTerms += 1;
      }
    }

    const items: WordFrequencyItem[] = [...counts]
      .map(([term, count]) => ({
        term,
        count,
        relative: totalTerms === 0 ? 0 : count / totalTerms,
      }))
      .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term, 'es'))
      .slice(0, Math.max(0, limit));

    return { projectId, generatedAt: nowIso(), language: resolved, items, totalTerms };
  }

  /**
   * Elige el idioma de la lista de palabras vacías. Si el idioma pedido no
   * está sembrado se recurre a `es` y, si tampoco existe, al primer idioma
   * disponible: el informe siempre dice con qué lista se filtró.
   */
  private resolveStopWordLanguage(requested: string): string {
    const available = this.repos.analytics.stopWordLanguages();
    const normalized = requested.trim().toLowerCase();
    if (available.includes(normalized)) return normalized;
    if (available.includes(FALLBACK_LANGUAGE)) return FALLBACK_LANGUAGE;
    return available[0] ?? FALLBACK_LANGUAGE;
  }

  // -------------------------------------------------------------------------
  // Fiabilidad inter-juez
  // -------------------------------------------------------------------------

  /**
   * Acuerdo entre cada par de investigadores.
   *
   * La unidad de acuerdo es la *decisión* `(código, cita)`, no "el investigador
   * tocó esta cita": contar citas en común confundía discretionar con
   * coincidencia de códigos. Para cada código se calcula además el kappa de
   * Cohen de la decisión binaria "A aplicó / B aplicó este código", que es la
   * magnitud que se cita en la literatura metodológica.
   *
   * Se omiten los pares en los que alguno de los dos no registró ninguna
   * decisión: no hay nada que comparar y su kappa siempre sería 0.
   */
  interRater(projectId: string): InterRaterReport {
    const codes = this.repos.codes.listByProject(projectId);
    const codeName = new Map(codes.map((code) => [code.id, code.name]));
    const researchers = this.repos.researchers.list(projectId).sort((a, b) => byName(a, b));

    const knownQuotations = new Set(
      this.repos.quotations.listByProject(projectId).map((quotation) => quotation.id),
    );

    // Descartamos decisiones cuya cita ya no existe o pertenece a otro proyecto.
    const decisionsByResearcher = new Map<string, Set<string>>();
    for (const [researcherId, decisionSet] of this.repos.codeQuotations.codingsByResearcher(
      projectId,
    )) {
      const kept = new Set<string>();
      for (const key of decisionSet) {
        if (knownQuotations.has(splitDecision(key).quotationId)) kept.add(key);
      }
      decisionsByResearcher.set(researcherId, kept);
    }

    const involved = new Set<string>();
    for (const decisionSet of decisionsByResearcher.values()) {
      for (const key of decisionSet) involved.add(splitDecision(key).quotationId);
    }
    const pool = involved.size;

    const pairs: InterRaterPair[] = [];
    for (let i = 0; i < researchers.length; i += 1) {
      for (let j = i + 1; j < researchers.length; j += 1) {
        const a = researchers[i]!;
        const b = researchers[j]!;
        const setA = decisionsByResearcher.get(a.id) ?? new Set<string>();
        const setB = decisionsByResearcher.get(b.id) ?? new Set<string>();
        if (setA.size === 0 || setB.size === 0) continue;

        let sharedCodings = 0;
        for (const key of setA) if (setB.has(key)) sharedCodings += 1;
        const union = setA.size + setB.size - sharedCodings;

        const quotationsOfA = quotationsPerCode(setA);
        const quotationsOfB = quotationsPerCode(setB);
        const codeIds = new Set([...quotationsOfA.keys(), ...quotationsOfB.keys()]);

        const detail: InterRaterCodeAgreement[] = [];
        const kappas: number[] = [];
        for (const codeId of codeIds) {
          const setForA = quotationsOfA.get(codeId) ?? new Set<string>();
          const setForB = quotationsOfB.get(codeId) ?? new Set<string>();
          let shared = 0;
          for (const quotationId of setForA) if (setForB.has(quotationId)) shared += 1;

          const aQuotations = setForA.size;
          const bQuotations = setForB.size;
          const kappa =
            pool === 0
              ? null
              : binaryKappa(shared / pool, aQuotations / pool, bQuotations / pool);
          if (kappa !== null) kappas.push(kappa);

          detail.push({
            codeId,
            codeName: codeName.get(codeId) ?? '(código eliminado)',
            aQuotations,
            bQuotations,
            shared,
            agreement: pool === 0 ? 0 : shared / pool,
            kappa,
          });
        }
        detail.sort(
          (x, y) => y.shared - x.shared || x.codeName.localeCompare(y.codeName, 'es'),
        );

        pairs.push({
          researcherA: a.id,
          researcherB: b.id,
          codingsA: setA.size,
          codingsB: setB.size,
          sharedCodings,
          codingAgreement: union === 0 ? 0 : sharedCodings / union,
          meanKappa:
            kappas.length === 0 ? null : kappas.reduce((sum, value) => sum + value, 0) / kappas.length,
          codes: detail,
        });
      }
    }

    return { projectId, generatedAt: nowIso(), totalQuotations: pool, pairs };
  }

  // -------------------------------------------------------------------------
  // Matriz de marco
  // -------------------------------------------------------------------------

  /**
   * Matriz de marco: una fila por documento (el caso) y una columna por código,
   * con las citas que sustentan cada intersección.
   *
   * Los atributos del caso salen de `document_attribute_values`. La matriz
   * incluye *todos* los códigos del proyecto como columna, aunque estén vacíos:
   * omitirlos impedía ver que un código no tiene ninguna cita en ese caso.
   */
  frameworkMatrix(projectId: string): FrameworkMatrixReport {
    const codes = [...this.repos.codes.listByProject(projectId)].sort(byName);
    const documents = [...this.repos.documents.listByProject(projectId)].sort((a, b) =>
      a.title.localeCompare(b.title, 'es'),
    );

    const codeName = new Map(codes.map((code) => [code.id, code.name]));
    const quotations = this.repos.quotations.listByProject(projectId);
    const documentOf = new Map<string, string>();
    const segmentOf = new Map<string, string>();
    for (const quotation of quotations) {
      documentOf.set(quotation.id, quotation.anchor.documentId);
      segmentOf.set(quotation.id, quotation.segmentText ?? '');
    }

    const attributeDefinitions = this.repos.attributes.listAttributes(projectId);
    const attributeValues = this.repos.attributes.valuesForProject(projectId);

    const columnsByDocument = new Map<string, Map<string, FrameworkMatrixCell[]>>();
    for (const [quotationId, codeIds] of this.repos.codeQuotations.distinctCodesByQuotation(
      projectId,
    )) {
      const documentId = documentOf.get(quotationId);
      if (documentId === undefined) continue;
      let columns = columnsByDocument.get(documentId);
      if (columns === undefined) {
        columns = new Map<string, FrameworkMatrixCell[]>();
        columnsByDocument.set(documentId, columns);
      }
      for (const codeId of codeIds) {
        const name = codeName.get(codeId);
        if (name === undefined) continue;
        const cell: FrameworkMatrixCell = {
          quotationId,
          segmentText: segmentOf.get(quotationId) ?? '',
          codeId,
          codeName: name,
        };
        const bucket = columns.get(codeId);
        if (bucket === undefined) columns.set(codeId, [cell]);
        else bucket.push(cell);
      }
    }

    const rows: FrameworkMatrix[] = documents.map((document) => {
      const columns = columnsByDocument.get(document.id);
      const values = new Map(
        (attributeValues.get(document.id) ?? []).map((value) => [value.attributeId, value.value]),
      );
      return {
        projectId,
        caseId: document.id,
        caseTitle: document.title,
        attributes: Object.fromEntries(
          attributeDefinitions.map((attribute) => [attribute.name, values.get(attribute.id) ?? null]),
        ),
        columns: codes.map((code) => ({
          codeId: code.id,
          codeName: code.name,
          quotations: columns?.get(code.id) ?? [],
        })),
      };
    });

    return { projectId, generatedAt: nowIso(), rows };
  }

  // -------------------------------------------------------------------------
  // Similitud entre códigos
  // -------------------------------------------------------------------------

  /**
   * Índice de Jaccard entre códigos sobre las citas que comparten.
   *
   * Sólo se emiten los pares con intersección: los pares disjuntos tienen
   * índice 0 y llenaban la matriz de ceros sin aportar información.
   */
  jaccard(projectId: string, options?: { includeDescendants?: boolean }): JaccardMatrix {
    const includeDescendants = options?.includeDescendants ?? false;
    const codes = [...this.repos.codes.listByProject(projectId)].sort(byName);
    const nameOf = new Map(codes.map((code) => [code.id, code.name]));

    const knownQuotations = new Set(
      this.repos.quotations.listByProject(projectId).map((quotation) => quotation.id),
    );

    // `evidence`: citas por código, ya sin evidencia huérfana.
    const evidence = new Map<string, Set<string>>();
    for (const [quotationId, codeIds] of this.repos.codeQuotations.distinctCodesByQuotation(
      projectId,
    )) {
      if (!knownQuotations.has(quotationId)) continue;
      for (const codeId of codeIds) {
        const bucket = evidence.get(codeId);
        if (bucket === undefined) evidence.set(codeId, new Set([quotationId]));
        else bucket.add(quotationId);
      }
    }

    // Se agrega de abajo hacia arriba sólo cuando el llamante lo pide.
    const sets = new Map<string, Set<string>>();
    if (includeDescendants) {
      const subtrees = collectSubtrees(buildCodeForest(codes));
      for (const code of codes) {
        const merged = new Set<string>();
        for (const descendantId of subtrees.get(code.id) ?? [code.id]) {
          for (const quotationId of evidence.get(descendantId) ?? []) merged.add(quotationId);
        }
        sets.set(code.id, merged);
      }
    } else {
      for (const code of codes) sets.set(code.id, evidence.get(code.id) ?? new Set<string>());
    }

    const cells: JaccardCell[] = [];
    for (let i = 0; i < codes.length; i += 1) {
      const a = codes[i]!;
      const setA = sets.get(a.id)!;
      if (setA.size === 0) continue;
      for (let j = i + 1; j < codes.length; j += 1) {
        const b = codes[j]!;
        const setB = sets.get(b.id)!;
        if (setB.size === 0) continue;
        let intersection = 0;
        for (const quotationId of setA) if (setB.has(quotationId)) intersection += 1;
        if (intersection === 0) continue;
        const union = setA.size + setB.size - intersection;
        cells.push({
          codeAId: a.id,
          codeAName: nameOf.get(a.id) ?? a.name,
          codeBId: b.id,
          codeBName: nameOf.get(b.id) ?? b.name,
          intersection,
          union,
          index: union === 0 ? 0 : intersection / union,
        });
      }
    }
    cells.sort((x, y) => y.index - x.index || x.codeAName.localeCompare(y.codeAName, 'es'));

    return {
      projectId,
      generatedAt: nowIso(),
      maxIndex: cells.reduce((max, cell) => Math.max(max, cell.index), 0),
      cells,
    };
  }

  // -------------------------------------------------------------------------
  // Keyword in context
  // -------------------------------------------------------------------------

  /**
   * Concordancias de un término o frase dentro del corpus.
   *
   * La comparación se hace sobre tokens plegados (sin diacríticos), así que
   * "investigación" encuentra "investigacion" y "datos" no aparece dentro de
   * "datosx". Una frase de varias palabras se reconoce cuando sus tokens son
   * consecutivos. Las posiciones se toman del texto original para que el
   * consumidor pueda seleccionar el fragmento exacto.
   */
  kwic(projectId: string, term: string, options?: { window?: number }): KwicReport {
    const query = tokenize(term);
    if (query.length === 0) {
      throw new InvalidInputError('kwic: el término no contiene términos buscables');
    }
    const windowSize = Math.max(0, options?.window ?? 5);

    const documents = [...this.repos.documents.listByProject(projectId)].sort((a, b) =>
      a.title.localeCompare(b.title, 'es'),
    );

    const entries: KwicEntry[] = [];
    for (const document of documents) {
      const text = this.repos.documents.getRawText(document.id);
      if (text === undefined || text.length === 0) continue;
      const tokens = tokenizeWithOffsets(text);

      for (let start = 0; start + query.length <= tokens.length; start += 1) {
        let matched = true;
        for (let offset = 0; offset < query.length; offset += 1) {
          if (tokens[start + offset]!.term !== query[offset]) {
            matched = false;
            break;
          }
        }
        if (!matched) continue;

        const matchStart = tokens[start]!.start;
        const matchEnd = tokens[start + query.length - 1]!.end;
        const firstContext = Math.max(0, start - windowSize);
        const lastContext = Math.min(tokens.length, start + query.length + windowSize);

        entries.push({
          documentId: document.id,
          documentTitle: document.title,
          term: query.join(' '),
          matchStart,
          matchEnd,
          match: text.slice(matchStart, matchEnd),
          before: start === 0 ? '' : text.slice(tokens[firstContext]!.start, matchStart),
          after:
            lastContext <= start + query.length
              ? ''
              : text.slice(matchEnd, tokens[lastContext - 1]!.end),
        });
      }
    }

    return { projectId, term, window: windowSize, generatedAt: nowIso(), entries };
  }

  // -------------------------------------------------------------------------
  // Fiabilidad inter-juez multi-codificador
  // -------------------------------------------------------------------------

  /**
   * Fleiss' kappa generalizado sobre las citas que recibió al menos dos
   * codificaciones.
   *
   * Unidades con un solo codificador se excluyen: kappa necesita al menos dos
   * evaluadores por unidad, y mezclar unidades con y sin evaluadores infla la
   * confianza del resultado. Se usa la versión variable (n evaluadores por
   * unidad), que es la única aplicable cuando cada investigador codifica un
   * subconjunto distinto de material.
   */
  fleissKappa(projectId: string): FleissKappaReport {
    const subjects = this.collectSubjects(projectId);

    let observed = 0;
    let evaluatedSubjects = 0;
    const marginals = new Map<string, number>();
    let marginalTotal = 0;

    for (const counts of subjects.values()) {
      let ratersForSubject = 0;
      let squares = 0;
      for (const value of counts.values()) {
        ratersForSubject += value;
        squares += value * value;
      }
      if (ratersForSubject < 2) continue;
      evaluatedSubjects += 1;
      observed += (squares - ratersForSubject) / (ratersForSubject * (ratersForSubject - 1));
      for (const [codeId, value] of counts) {
        marginals.set(codeId, (marginals.get(codeId) ?? 0) + value);
        marginalTotal += value;
      }
    }

    const ratersCount = this.countResearchers(projectId);
    if (evaluatedSubjects === 0 || marginalTotal === 0) {
      return {
        projectId,
        generatedAt: nowIso(),
        subjects: 0,
        raters: ratersCount,
        categories: 0,
        observedAgreement: 0,
        expectedAgreement: 0,
        kappa: null,
      };
    }

    const observedAgreement = observed / evaluatedSubjects;
    let expectedAgreement = 0;
    for (const value of marginals.values()) {
      const proportion = value / marginalTotal;
      expectedAgreement += proportion * proportion;
    }

    return {
      projectId,
      generatedAt: nowIso(),
      subjects: evaluatedSubjects,
      raters: ratersCount,
      categories: marginals.size,
      observedAgreement,
      expectedAgreement,
      // Pe = 1 significa que no hay varianza entre categorías que corregir.
      kappa:
        expectedAgreement >= 1
          ? null
          : (observedAgreement - expectedAgreement) / (1 - expectedAgreement),
    };
  }

  /**
   * Krippendorff' alpha (nivel nominal) sobre las mismas unidades.
   *
   * Unidad = cita; valor = código asignado. Sólo entran las unidades con dos o
   * más valores, porque una unidad con un único valor no puede contener
   * desacuerdo. Puede dar valores negativos: eso ocurre cuando cada unidad es
   * homogénea pero las unidades entre sí se contradicen, y es el
   * comportamiento definido de la métrica, no un error de cálculo.
   *
   * Devuelve `null` cuando hay menos de dos categorías distintas: con una sola
   * categoría no hay desacuerdo posible y el cociente es 0/0.
   */
  krippendorffAlpha(projectId: string): KrippendorffAlphaReport {
    const subjects = this.collectSubjects(projectId);

    let total = 0;
    let observedNumerator = 0;
    const marginals = new Map<string, number>();
    for (const counts of subjects.values()) {
      let size = 0;
      for (const value of counts.values()) size += value;
      if (size < 2) continue;
      total += size;
      for (const [codeId, value] of counts) {
        // Pares ordenados de esta categoría hacia una categoría DISTINTA. La
        // matriz de coincidencia de Krippendorff sólo suma c ≠ k: los pares
        // (c,c) son acuerdo, no desacuerdo, y contarlos como desacuerdo hundía
        // el alfa por debajo de cero aunque las investigadoras coincidieran
        // siempre. Con 3 ratings de los que dos coinciden: 2·(3−2) + 1·(3−1).
        observedNumerator += (value * (size - value)) / (size - 1);
        marginals.set(codeId, (marginals.get(codeId) ?? 0) + value);
      }
    }

    const ratersCount = this.countResearchers(projectId);
    const base = {
      projectId,
      generatedAt: nowIso(),
      subjects: subjects.size,
      raters: ratersCount,
      categories: marginals.size,
    };
    if (total < 2 || marginals.size < 2) return { ...base, alpha: null };

    const disagreementObserved = observedNumerator / total;
    let sumOfSquares = 0;
    for (const value of marginals.values()) sumOfSquares += value * value;
    const disagreementExpected = (total * total - sumOfSquares) / (total * (total - 1));

    return {
      ...base,
      alpha:
        disagreementExpected === 0 ? null : 1 - disagreementObserved / disagreementExpected,
    };
  }

  // -------------------------------------------------------------------------
  // Utilidades internas
  // -------------------------------------------------------------------------

  /**
   * Cita → código → número de investigadores que aplicaron ese código.
   * Es la matriz de unidades que consumen Fleiss y Krippendorff.
   */
  private collectSubjects(projectId: string): Map<string, Map<string, number>> {
    const knownQuotations = new Set(
      this.repos.quotations.listByProject(projectId).map((quotation) => quotation.id),
    );
    const subjects = new Map<string, Map<string, number>>();
    for (const decisionSet of this.repos.codeQuotations.codingsByResearcher(projectId).values()) {
      for (const key of decisionSet) {
        const { codeId, quotationId } = splitDecision(key);
        if (!knownQuotations.has(quotationId)) continue;
        let counts = subjects.get(quotationId);
        if (counts === undefined) {
          counts = new Map<string, number>();
          subjects.set(quotationId, counts);
        }
        counts.set(codeId, (counts.get(codeId) ?? 0) + 1);
      }
    }
    return subjects;
  }

  private countResearchers(projectId: string): number {
    return this.repos.codeQuotations.codingsByResearcher(projectId).size;
  }
}

// ---------------------------------------------------------------------------
// Funciones puras
// ---------------------------------------------------------------------------

function splitDecision(key: string): { codeId: string; quotationId: string } {
  const separator = key.indexOf(DECISION_SEP);
  return { codeId: key.slice(0, separator), quotationId: key.slice(separator + 1) };
}

/** Agrupa decisiones por código y devuelve el conjunto de citas de cada uno. */
function quotationsPerCode(decisions: ReadonlySet<string>): Map<string, Set<string>> {
  const byCode = new Map<string, Set<string>>();
  for (const key of decisions) {
    const { codeId, quotationId } = splitDecision(key);
    const bucket = byCode.get(codeId);
    if (bucket === undefined) byCode.set(codeId, new Set([quotationId]));
    else bucket.add(quotationId);
  }
  return byCode;
}

/**
 * Cohen's kappa para dos decisores binarios sobre las mismas N unidades.
 * Devuelve `null` cuando el acuerdo esperado es 0 o 1, porque entonces el
 * denominador se anula y el estadístico no está definido.
 */
function binaryKappa(observed: number, aRate: number, bRate: number): number | null {
  const expected = aRate * bRate + (1 - aRate) * (1 - bRate);
  if (expected <= 0 || expected >= 1) return null;
  return (observed - expected) / (1 - expected);
}
