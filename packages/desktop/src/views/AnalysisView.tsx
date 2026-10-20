import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  CooccurrenceMatrix,
  Code,
  CodeFrequencyReport,
  DocumentCodeMatrix,
  FleissKappaReport,
  FrameworkMatrixReport,
  InterRaterReport,
  JaccardMatrix,
  KwicReport,
  KrippendorffAlphaReport,
  WordFrequencyReport,
} from '../api';
import { qwal } from '../api';
import { useApp } from '../App';

/** Fiabilidad = los tres índices IRR del núcleo, calculados en paralelo. */
interface ReliabilityBundle {
  interRater: InterRaterReport;
  fleiss: FleissKappaReport;
  alpha: KrippendorffAlphaReport;
}

/**
 * Cada pestaña guarda el informe que devuelve el núcleo tal cual (`CodeFrequencyReport`,
 * `CooccurrenceMatrix`…). Antes esta vista recibía listas planas que `main.ts`/`app.ts`
 * fabricaban con normalizadores; esos ya no existen, así que aquí se consume la forma real.
 */
type Tab = 'frecuencia' | 'coocurrencia' | 'palabras' | 'matriz' | 'kwic' | 'jaccard' | 'fiabilidad' | 'marco';

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'frecuencia', label: 'Frecuencia de códigos', icon: '🏷️' },
  { key: 'coocurrencia', label: 'Co-ocurrencias', icon: '🔗' },
  { key: 'palabras', label: 'Palabras frecuentes', icon: '🔡' },
  { key: 'matriz', label: 'Matriz doc × código', icon: '📋' },
  { key: 'marco', label: 'Matriz de marco', icon: '🗂️' },
  { key: 'kwic', label: 'KWIC', icon: '🔠' },
  { key: 'jaccard', label: 'Similitud (Jaccard)', icon: '📐' },
  { key: 'fiabilidad', label: 'Fiabilidad', icon: '🤝' },
];

const MAX_MATRIX_COLUMNS = 24;

/** Nombre de cada código del proyecto, para etiquetar los ejes de las matrices. */
type CodeNames = Map<string, string>;

export default function AnalysisView() {
  const { activeProject, setView } = useApp();

  const [tab, setTab] = useState<Tab>('frecuencia');
  const [cache, setCache] = useState<Partial<Record<Tab, unknown>>>({});
  const [codeNames, setCodeNames] = useState<CodeNames>(new Map());
  const [loading, setLoading] = useState<Record<Tab, boolean>>({
    frecuencia: false,
    coocurrencia: false,
    palabras: false,
    matriz: false,
    kwic: false,
    jaccard: false,
    fiabilidad: false,
    marco: false,
  });
  const [error, setError] = useState<Record<Tab, string | null>>({
    frecuencia: null,
    coocurrencia: null,
    palabras: null,
    matriz: null,
    kwic: null,
    jaccard: null,
    fiabilidad: null,
    marco: null,
  });
  // KWIC depende de una consulta del usuario: el término vive aquí para que el
  // botón pueda relanzar la búsqueda (force) con el término actual.
  const [kwicTerm, setKwicTerm] = useState('');
  const [kwicWindow, setKwicWindow] = useState(5);

  const loadTab = useCallback(
    async (key: Tab, options?: { force?: boolean; kwicTerm?: string }) => {
      if (!activeProject) return;
      if (cache[key] !== undefined && !options?.force) return;
      setLoading((l) => ({ ...l, [key]: true }));
      setError((e) => ({ ...e, [key]: null }));
      try {
        let data: unknown;
        switch (key) {
          case 'frecuencia':
            data = await qwal.analysis.codeFrequencies();
            break;
          case 'coocurrencia':
            data = await qwal.analysis.cooccurrence();
            break;
          case 'palabras':
            data = await qwal.analysis.wordFrequencies();
            break;
          case 'matriz':
            data = await qwal.analysis.documentCodeMatrix();
            break;
          case 'kwic':
            data = await qwal.analysis.kwic(options?.kwicTerm ?? kwicTerm, kwicWindow);
            break;
          case 'jaccard':
            data = await qwal.analysis.jaccard(true);
            break;
          case 'fiabilidad': {
            const [interRater, fleiss, alpha] = await Promise.all([
              qwal.analysis.interRater(),
              qwal.analysis.fleissKappa(),
              qwal.analysis.krippendorffAlpha(),
            ]);
            data = { interRater, fleiss, alpha } satisfies ReliabilityBundle;
            break;
          }
          case 'marco':
            data = await qwal.analysis.frameworkMatrix();
            break;
        }
        setCache((c) => ({ ...c, [key]: data }));
      } catch (err) {
        setError((e) => ({ ...e, [key]: err instanceof Error ? err.message : String(err) }));
      } finally {
        setLoading((l) => ({ ...l, [key]: false }));
      }
    },
    [activeProject, cache, kwicTerm, kwicWindow],
  );

  useEffect(() => {
    void loadTab(tab);
  }, [tab, loadTab]);

  // Las celdas de co-ocurrencia y de la matriz sólo llevan identificadores de
  // código; los nombres se resuelven una vez contra la lista de códigos.
  useEffect(() => {
    let cancelled = false;
    if (!activeProject) return;
    void qwal.codes
      .list()
      .then((codes: Code[]) => {
        if (cancelled) return;
        setCodeNames(new Map(codes.map((c) => [c.id, c.name])));
      })
      .catch(() => {
        // Sin nombres la tabla cae al identificador: no es motivo para romper la vista.
      });
    return () => {
      cancelled = true;
    };
  }, [activeProject]);

  if (!activeProject) {
    return (
      <div className="view">
        <div className="empty">
          <span className="empty-icon" aria-hidden="true">
            📊
          </span>
          <h3>Sin proyecto activo</h3>
          <p>Selecciona o crea un proyecto para ver los análisis.</p>
          <button type="button" className="btn btn-primary" onClick={() => setView('proyectos')}>
            Ir a Proyectos
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="view">
      <div className="view-header">
        <div className="title-block">
          <h1>Análisis</h1>
          <p>Explora la distribución de códigos, co-ocurrencias y palabras del proyecto.</p>
        </div>
      </div>

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`tab${tab === t.key ? ' active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            <span aria-hidden="true">{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      {tab === 'kwic' && (
        <div className="kwic-controls">
          <input
            type="search"
            placeholder="Término a buscar en contexto…"
            value={kwicTerm}
            onChange={(e) => setKwicTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && kwicTerm.trim()) void loadTab('kwic', { force: true });
            }}
          />
          <label>
            Ventana
            <input
              type="number"
              min={1}
              max={20}
              value={kwicWindow}
              onChange={(e) => setKwicWindow(Math.max(1, Math.min(20, Number(e.target.value) || 5)))}
            />
          </label>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!kwicTerm.trim()}
            onClick={() => void loadTab('kwic', { force: true })}
          >
            Buscar
          </button>
        </div>
      )}

      {error[tab] && (
        <div className="error-box">
          <span aria-hidden="true">⚠</span>
          <span>{error[tab]}</span>
        </div>
      )}

      <div className="card">
        {loading[tab] ? (
          <div className="empty">
            <span className="empty-icon" aria-hidden="true">
              ⏳
            </span>
            <h3>Cargando…</h3>
          </div>
        ) : (
          <TabContent tab={tab} data={cache[tab]} codeNames={codeNames} />
        )}
      </div>
    </div>
  );
}

function TabContent({
  tab,
  data,
  codeNames,
}: {
  tab: Tab;
  data: unknown;
  codeNames: CodeNames;
}) {
  switch (tab) {
    case 'frecuencia':
      return <FreqBars report={data as CodeFrequencyReport | undefined} />;
    case 'coocurrencia':
      return <CooccurrenceTable report={data as CooccurrenceMatrix | undefined} codeNames={codeNames} />;
    case 'palabras':
      return <WordBars report={data as WordFrequencyReport | undefined} />;
    case 'matriz':
      return <MatrixTable report={data as DocumentCodeMatrix | undefined} codeNames={codeNames} />;
    case 'kwic':
      return <KwicTable report={data as KwicReport | undefined} />;
    case 'jaccard':
      return <JaccardBars report={data as JaccardMatrix | undefined} />;
    case 'fiabilidad':
      return <ReliabilityPanel bundle={data as ReliabilityBundle | undefined} />;
    case 'marco':
      return <FrameworkRows report={data as FrameworkMatrixReport | undefined} />;
  }
}

function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon" aria-hidden="true">
        📭
      </span>
      <h3>{children}</h3>
    </div>
  );
}

/** El camino del código ("Padre / Hijo") se muestra indentado por nivel. */
function CodeLabel({ path, name }: { path: string; name: string }) {
  const segments = path.length > 0 ? path.split(' / ') : [name];
  return (
    <span className="bar-label" style={{ paddingLeft: (segments.length - 1) * 12 }}>
      {segments.join(' › ')}
    </span>
  );
}

function FreqBars({ report }: { report: CodeFrequencyReport | undefined }) {
  if (report === undefined) return null;
  const { items, totalQuotations, totalDocuments } = report;
  if (items.length === 0) return <EmptyNote>Aún no hay códigos con citas asignadas.</EmptyNote>;
  const max = Math.max(...items.map((i) => i.quotationsWithDescendants), 1);
  return (
    <div>
      <p style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 0 }}>
        {totalQuotations} cita(s) con al menos un código · {totalDocuments} documento(s) en el
        proyecto. La barra cuenta el código y sus descendientes.
      </p>
      {items.map((i) => (
        <div key={i.code.id} className="bar-row">
          <CodeLabel path={i.code.path} name={i.code.name} />
          <span className="bar-track">
            <span
              className="bar-fill"
              style={{ width: `${(i.quotationsWithDescendants / max) * 100}%` }}
            />
          </span>
          <span className="bar-count">
            {i.quotationsWithDescendants}
            {i.quotationsWithDescendants !== i.quotations && (
              <span style={{ color: 'var(--text-dim)' }}> ({i.quotations} propio)</span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

function WordBars({ report }: { report: WordFrequencyReport | undefined }) {
  if (report === undefined) return null;
  const { items, language, totalTerms } = report;
  if (items.length === 0) return <EmptyNote>Aún no hay texto suficiente para contar palabras.</EmptyNote>;
  const max = Math.max(...items.map((i) => i.count), 1);
  return (
    <div>
      <p style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 0 }}>
        {totalTerms} término(s) tras filtrar palabras vacías del idioma «{language}».
      </p>
      {items.map((i) => (
        <div key={i.term} className="bar-row">
          <span className="bar-label">{i.term}</span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${(i.count / max) * 100}%` }} />
          </span>
          <span className="bar-count">{i.count}</span>
        </div>
      ))}
    </div>
  );
}

function CooccurrenceTable({
  report,
  codeNames,
}: {
  report: CooccurrenceMatrix | undefined;
  codeNames: CodeNames;
}) {
  if (report === undefined) return null;
  if (report.cells.length === 0) {
    return <EmptyNote>Aún no hay co-ocurrencias: ningún par de códigos comparte una cita.</EmptyNote>;
  }
  const name = (id: string) => codeNames.get(id) ?? id;
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>Código A</th>
            <th>Código B</th>
            <th className="num">Citas compartidas</th>
          </tr>
        </thead>
        <tbody>
          {report.cells.map((c) => (
            <tr key={`${c.codeA}|${c.codeB}`}>
              <td>
                <strong>{name(c.codeA)}</strong>
              </td>
              <td>{name(c.codeB)}</td>
              <td className="num">{c.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MatrixTable({
  report,
  codeNames,
}: {
  report: DocumentCodeMatrix | undefined;
  codeNames: CodeNames;
}) {
  if (report === undefined) return null;

  const titleOf = new Map(report.cells.map((c) => [c.documentId, c.documentTitle]));
  const nameOf = new Map(report.cells.map((c) => [c.codeId, c.codeName]));
  const codeLabel = (id: string) => codeNames.get(id) ?? nameOf.get(id) ?? id;
  const documentLabel = (id: string) => titleOf.get(id) ?? id;

  const counts = new Map<string, number>();
  for (const cell of report.cells) {
    counts.set(`${cell.documentId}\u0000${cell.codeId}`, cell.quotationCount);
  }

  // Se muestran sólo los códigos con evidencia: una columna entera a ceros no
  // aporta información y con muchos códigos la tabla deja de ser legible.
  const withEvidence = Array.from(new Set(report.cells.map((c) => c.codeId)));
  const shownCodes = withEvidence.slice(0, MAX_MATRIX_COLUMNS);
  const overflow = withEvidence.length - shownCodes.length;
  const documents = report.documentIds;

  if (documents.length === 0) return <EmptyNote>El proyecto aún no tiene documentos.</EmptyNote>;

  return (
    <>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Documento</th>
              {shownCodes.map((id) => (
                <th key={id} className="num">
                  {codeLabel(id)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {documents.map((documentId) => (
              <tr key={documentId}>
                <td>
                  <strong>{documentLabel(documentId)}</strong>
                </td>
                {shownCodes.map((codeId) => {
                  const value = counts.get(`${documentId}\u0000${codeId}`);
                  return (
                    <td key={codeId} className="num">
                      {value ?? ''}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {overflow > 0 && (
        <p style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 8 }}>
          +{overflow} código(s) con evidencia no mostrados.
        </p>
      )}
    </>
  );
}

/** κ/α legibles: los índices degenerados llegan como null y se muestran con guion. */
function fmtIndex(x: number | null): string {
  return x === null ? '—' : x.toFixed(3);
}

function clip(text: string, max = 90): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function KwicTable({ report }: { report: KwicReport | undefined }) {
  if (report === undefined) return null;
  if (report.entries.length === 0) {
    return <EmptyNote>Sin coincidencias para «{report.term}».</EmptyNote>;
  }
  return (
    <div>
      <p style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 0 }}>
        {report.entries.length} coincidencia(s) de «{report.term}» con ventana de {report.window} palabra(s).
      </p>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th style={{ width: 180 }}>Documento</th>
              <th>Contexto</th>
            </tr>
          </thead>
          <tbody>
            {report.entries.map((e, i) => (
              <tr key={`${e.documentId}-${e.matchStart}-${i}`}>
                <td>
                  <strong>{e.documentTitle}</strong>
                </td>
                <td className="kwic-line">
                  …{e.before}
                  <mark>{e.match}</mark>
                  {e.after}…
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function JaccardBars({ report }: { report: JaccardMatrix | undefined }) {
  if (report === undefined) return null;
  if (report.cells.length === 0) {
    return <EmptyNote>Ningún par de códigos comparte citas todavía.</EmptyNote>;
  }
  return (
    <div>
      <p style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 0 }}>
        Similitud de Jaccard entre códigos (citas compartidas / citas de la unión), incluyendo
        códigos descendientes. 1 = mismo conjunto de citas; 0 = ninguno en común.
      </p>
      {report.cells.map((c) => (
        <div key={`${c.codeAId}|${c.codeBId}`} className="bar-row">
          <span className="bar-label">
            {c.codeAName} ↔ {c.codeBName}
          </span>
          <span className="bar-track">
            <span
              className="bar-fill"
              style={{ width: `${(c.index / Math.max(report.maxIndex, 0.0001)) * 100}%` }}
            />
          </span>
          <span className="bar-count">
            {c.index.toFixed(2)} <span style={{ color: 'var(--text-dim)' }}>({c.intersection}/{c.union})</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function ReliabilityPanel({ bundle }: { bundle: ReliabilityBundle | undefined }) {
  if (bundle === undefined) return null;
  const { interRater, fleiss, alpha } = bundle;
  const noData = interRater.pairs.length === 0 && fleiss.subjects === 0;
  if (noData) {
    return (
      <EmptyNote>
        La fiabilidad necesita al menos dos investigadoras codificando. Regístralas en «Codificar»
        (barra superior) y que ambas codifiquen citas; estos índices se calculan al instante.
      </EmptyNote>
    );
  }
  return (
    <div>
      <div className="reliability-summary">
        <div className="reliability-stat">
          <span className="reliability-value">{fmtIndex(fleiss.kappa)}</span>
          <span className="reliability-label">Fleiss κ</span>
          <span className="reliability-meta">
            {fleiss.subjects} citas · {fleiss.raters} juez · Po {fleiss.observedAgreement.toFixed(3)}
          </span>
        </div>
        <div className="reliability-stat">
          <span className="reliability-value">{fmtIndex(alpha.alpha)}</span>
          <span className="reliability-label">Krippendorff α</span>
          <span className="reliability-meta">
            {alpha.subjects} citas · {alpha.raters} juez
          </span>
        </div>
      </div>

      {interRater.pairs.length === 0 ? (
        <EmptyNote>Sin pares con solapamiento de decisiones todavía.</EmptyNote>
      ) : (
        interRater.pairs.map((pair) => (
          <div key={`${pair.researcherA}|${pair.researcherB}`} className="card" style={{ marginTop: 14 }}>
            <div className="card-title">
              <h3>
                {pair.researcherA} vs {pair.researcherB}
              </h3>
              <span className="chip">
                <b>{fmtIndex(pair.meanKappa)}</b> κ medio
              </span>
            </div>
            <p style={{ color: 'var(--text-dim)', fontSize: 13, margin: '0 0 10px' }}>
              {pair.codingsA} y {pair.codingsB} decisiones · {pair.sharedCodings} idénticas ·
              acuerdo bruto {(pair.codingAgreement * 100).toFixed(1)}%
            </p>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th className="num">A</th>
                    <th className="num">B</th>
                    <th className="num">Ambos</th>
                    <th className="num">Acuerdo</th>
                    <th className="num">κ</th>
                  </tr>
                </thead>
                <tbody>
                  {pair.codes.map((c) => (
                    <tr key={c.codeId}>
                      <td>
                        <strong>{c.codeName}</strong>
                      </td>
                      <td className="num">{c.aQuotations}</td>
                      <td className="num">{c.bQuotations}</td>
                      <td className="num">{c.shared}</td>
                      <td className="num">{(c.agreement * 100).toFixed(0)}%</td>
                      <td className="num">{fmtIndex(c.kappa)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function FrameworkRows({ report }: { report: FrameworkMatrixReport | undefined }) {
  if (report === undefined) return null;
  if (report.rows.length === 0) {
    return <EmptyNote>El proyecto aún no tiene documentos con citas codificadas.</EmptyNote>;
  }
  return (
    <div>
      <p style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 0 }}>
        Matriz de marco: cada caso (documento) en filas, códigos en columnas, citas en las celdas.
      </p>
      {report.rows.map((row) => {
        const attributeEntries = Object.entries(row.attributes);
        const shownColumns = row.columns.filter((col) => col.quotations.length > 0).slice(0, MAX_MATRIX_COLUMNS);
        const hidden = row.columns.filter((col) => col.quotations.length > 0).length - shownColumns.length;
        return (
          <div key={row.caseId} className="card" style={{ marginTop: 14 }}>
            <div className="card-title">
              <h3>{row.caseTitle}</h3>
              {attributeEntries.length > 0 && (
                <div className="fw-attributes">
                  {attributeEntries.map(([key, value]) => (
                    <span key={key} className="chip">
                      {key}: <b>{value ?? '—'}</b>
                    </span>
                  ))}
                </div>
              )}
            </div>
            {shownColumns.length === 0 ? (
              <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>Sin citas codificadas.</p>
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      {shownColumns.map((col) => (
                        <th key={col.codeId}>{col.codeName}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      {shownColumns.map((col) => (
                        <td key={col.codeId}>
                          {col.quotations.map((q) => (
                            <div key={q.quotationId} className="fw-quote">
                              «{clip(q.segmentText)}»
                            </div>
                          ))}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            {hidden > 0 && (
              <p style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 6 }}>
                +{hidden} código(s) con citas no mostrados.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
