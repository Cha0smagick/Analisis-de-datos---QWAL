import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  CooccurrenceMatrix,
  Code,
  CodeFrequencyReport,
  CodingDensityRow,
  DocumentCodeMatrix,
  FleissKappaReport,
  FrameworkMatrixReport,
  InterRaterReport,
  JaccardMatrix,
  KwicReport,
  KrippendorffAlphaReport,
  Relation,
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
type Tab = 'frecuencia' | 'coocurrencia' | 'red' | 'palabras' | 'matriz' | 'marco' | 'kwic' | 'jaccard' | 'fiabilidad' | 'equipo';

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'frecuencia', label: 'Frecuencia de códigos', icon: '🏷️' },
  { key: 'coocurrencia', label: 'Co-ocurrencias', icon: '🔗' },
  { key: 'red', label: 'Red de códigos', icon: '🕸️' },
  { key: 'palabras', label: 'Palabras frecuentes', icon: '🔡' },
  { key: 'matriz', label: 'Matriz doc × código', icon: '📋' },
  { key: 'marco', label: 'Matriz de marco', icon: '🗂️' },
  { key: 'kwic', label: 'KWIC', icon: '🔠' },
  { key: 'jaccard', label: 'Similitud (Jaccard)', icon: '📐' },
  { key: 'fiabilidad', label: 'Fiabilidad', icon: '🤝' },
  { key: 'equipo', label: 'Equipo', icon: '👥' },
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
    red: false,
    palabras: false,
    matriz: false,
    kwic: false,
    jaccard: false,
    fiabilidad: false,
    marco: false,
    equipo: false,
  });
  const [error, setError] = useState<Record<Tab, string | null>>({
    frecuencia: null,
    coocurrencia: null,
    red: null,
    palabras: null,
    matriz: null,
    kwic: null,
    jaccard: null,
    fiabilidad: null,
    marco: null,
    equipo: null,
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
          case 'red': {
            const [cooc, relations] = await Promise.all([
              qwal.analysis.cooccurrence(),
              qwal.relations.list(),
            ]);
            data = { cooc, relations };
            break;
          }
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
          case 'equipo':
            data = await qwal.coding.density();
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
    case 'red': {
      const bundle = data as { cooc: CooccurrenceMatrix; relations: Relation[] } | undefined;
      return (
        <CodeNetwork
          cooc={bundle?.cooc}
          relations={bundle?.relations ?? []}
          codeNames={codeNames}
        />
      );
    }
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
    case 'equipo':
      return <DensityBars rows={data as CodingDensityRow[] | undefined} />;
    case 'marco':
      return <FrameworkRows report={data as FrameworkMatrixReport | undefined} />;
  }
}

/**
 * Red de códigos: co-ocurrencias (gris, grosor ∝ frecuencia) y relaciones
 * tipadas (naranja discontinuo, con etiqueta). Layout force-dir simplificado
 * calculado una vez, determinista y sin dependencias; clic en un nodo lo aísla.
 */
function CodeNetwork({
  cooc,
  relations,
  codeNames,
}: {
  cooc: CooccurrenceMatrix | undefined;
  relations: Relation[];
  codeNames: CodeNames;
}) {
  const [focus, setFocus] = useState<string | null>(null);
  if (cooc === undefined) return null;

  const name = (id: string) => codeNames.get(id) ?? id;
  const short = (s: string) => (s.length > 16 ? `${s.slice(0, 15)}…` : s);

  const degree = new Map<string, number>();
  for (const c of cooc.cells) {
    degree.set(c.codeA, (degree.get(c.codeA) ?? 0) + c.count);
    degree.set(c.codeB, (degree.get(c.codeB) ?? 0) + c.count);
  }
  const relationPairs = relations.filter((r) => r.source.type === 'code' && r.target.type === 'code');
  const ids = new Set<string>([
    ...degree.keys(),
    ...relationPairs.flatMap((r) => [r.source.id, r.target.id]),
  ]);
  if (ids.size === 0) {
    return (
      <EmptyNote>
        Sin red todavía: codifica citas (co-ocurrencias) o crea relaciones entre códigos en la vista Códigos.
      </EmptyNote>
    );
  }

  const edges = cooc.cells.filter((c) => ids.has(c.codeA) && ids.has(c.codeB));
  const maxCount = Math.max(1, cooc.maxCount);

  // --- Layout: Fruchterman-Reingold simplificado, 300 iteraciones ---
  const W = 820;
  const H = 560;
  const nodeList = Array.from(ids);
  const idx = new Map(nodeList.map((id, i) => [id, i] as const));
  const k = Math.sqrt((W * H) / nodeList.length);
  const pos = nodeList.map((_, i) => ({
    x: W / 2 + (W / 3) * Math.cos((2 * Math.PI * i) / nodeList.length),
    y: H / 2 + (H / 3) * Math.sin((2 * Math.PI * i) / nodeList.length),
  }));
  const edgeIdx = edges.map((e) => [idx.get(e.codeA)!, idx.get(e.codeB)!, e.count] as const);
  for (let it = 0; it < 300; it++) {
    const temp = (1 - it / 300) * 60;
    const dx = new Array<number>(nodeList.length).fill(0);
    const dy = new Array<number>(nodeList.length).fill(0);
    for (let i = 0; i < nodeList.length; i++) {
      for (let j = i + 1; j < nodeList.length; j++) {
        let ddx = pos[i]!.x - pos[j]!.x;
        let ddy = pos[i]!.y - pos[j]!.y;
        const dist = Math.sqrt(ddx * ddx + ddy * ddy) || 0.01;
        const f = (k * k) / dist;
        ddx /= dist;
        ddy /= dist;
        dx[i]! += ddx * f;
        dy[i]! += ddy * f;
        dx[j]! -= ddx * f;
        dy[j]! -= ddy * f;
      }
    }
    for (const [a, b, count] of edgeIdx) {
      let ddx = pos[a]!.x - pos[b]!.x;
      let ddy = pos[a]!.y - pos[b]!.y;
      const dist = Math.sqrt(ddx * ddx + ddy * ddy) || 0.01;
      // Las aristas con más co-ocurrencia atraen más fuerte (escala logarítmica).
      const f = (dist * dist) / (k * (1 + Math.log2(1 + count)));
      ddx /= dist;
      ddy /= dist;
      dx[a]! -= ddx * f;
      dy[a]! -= ddy * f;
      dx[b]! += ddx * f;
      dy[b]! += ddy * f;
    }
    for (let i = 0; i < nodeList.length; i++) {
      const disp = Math.sqrt(dx[i]! * dx[i]! + dy[i]! * dy[i]!) || 0.01;
      const lim = Math.min(disp, temp) / disp;
      pos[i]!.x = Math.max(50, Math.min(W - 50, pos[i]!.x + dx[i]! * lim));
      pos[i]!.y = Math.max(40, Math.min(H - 40, pos[i]!.y + dy[i]! * lim));
    }
  }

  const radius = (id: string) => 6 + Math.min(14, Math.sqrt(degree.get(id) ?? 0) * 3);
  const connected = (id: string): boolean =>
    relationPairs.some(
      (r) => (r.source.id === focus && r.target.id === id) || (r.target.id === focus && r.source.id === id),
    ) || edges.some((e) => (e.codeA === focus && e.codeB === id) || (e.codeB === focus && e.codeA === id));

  return (
    <div>
      <p className="ws-hint">
        Grosor = co-ocurrencias compartidas. Flechas naranjas = relaciones tipadas (etiqueta en la línea). Clic en un
        nodo para aislarlo con sus conexiones; clic de nuevo para volver.
      </p>
      <svg className="net-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Red de códigos">
        <defs>
          <marker id="net-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#d97a2b" />
          </marker>
        </defs>
        {edgeIdx.map(([a, b, count], i) => {
          const dim = focus !== null && focus !== nodeList[a] && focus !== nodeList[b];
          return (
            <line
              key={`cooc-${i}`}
              x1={pos[a]!.x}
              y1={pos[a]!.y}
              x2={pos[b]!.x}
              y2={pos[b]!.y}
              stroke={`rgba(120, 135, 160, ${dim ? 0.06 : (0.18 + (count / maxCount) * 0.5).toFixed(2)})`}
              strokeWidth={1 + (count / maxCount) * 5}
            >
              <title>{`${name(nodeList[a]!)} × ${name(nodeList[b]!)}: ${count} co-ocurrencia(s)`}</title>
            </line>
          );
        })}
        {relationPairs.map((r) => {
          const a = idx.get(r.source.id);
          const b = idx.get(r.target.id);
          if (a === undefined || b === undefined) return null;
          const dim = focus !== null && focus !== r.source.id && focus !== r.target.id;
          return (
            <g key={r.id} opacity={dim ? 0.12 : 1}>
              <line
                x1={pos[a]!.x}
                y1={pos[a]!.y}
                x2={pos[b]!.x}
                y2={pos[b]!.y}
                stroke="#d97a2b"
                strokeWidth={2}
                strokeDasharray="6 4"
                markerEnd="url(#net-arrow)"
              >
                <title>{`${name(r.source.id)} —${r.relationType}→ ${name(r.target.id)}`}</title>
              </line>
              <text className="net-rel-label" x={(pos[a]!.x + pos[b]!.x) / 2} y={(pos[a]!.y + pos[b]!.y) / 2 - 5} textAnchor="middle">
                {r.relationType}
              </text>
            </g>
          );
        })}
        {nodeList.map((id, i) => (
          <g
            key={id}
            className="net-node"
            transform={`translate(${pos[i]!.x}, ${pos[i]!.y})`}
            opacity={focus === null || focus === id || connected(id) ? 1 : 0.18}
            onClick={() => setFocus((f) => (f === id ? null : id))}
          >
            <circle className="net-circle" r={radius(id)} />
            <text className="net-label" y={radius(id) + 14} textAnchor="middle">
              {short(name(id))}
            </text>
            <title>{`${name(id)} — ${degree.get(id) ?? 0} co-ocurrencia(s). Clic para aislar.`}</title>
          </g>
        ))}
      </svg>
    </div>
  );
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
  // Nube: tamaño y tono proporcionales a la frecuencia; el detalle numérico
  // queda debajo en el listado de barras, con scroll.
  const tones = ['#6ea8ff', '#4f8cff', '#93a3c2'];
  return (
    <div>
      <div className="cloud" role="img" aria-label="Nube de palabras frecuentes">
        {items.map((i) => {
          const ratio = i.count / max;
          return (
            <span
              key={i.term}
              className="cloud-word"
              style={{ fontSize: Math.round(13 + ratio * 34), color: ratio > 0.6 ? tones[0] : ratio > 0.25 ? tones[1] : tones[2] }}
              title={`${i.count} aparición(es) · ${(i.relative * 100).toFixed(2)}% del corpus`}
            >
              {i.term}
            </span>
          );
        })}
      </div>
      <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>
        {totalTerms} término(s) tras filtrar palabras vacías del idioma «{language}».
      </p>
      <div className="cloud-detail">
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

  // Mapa de calor: sólo códigos con conexiones, ordenados por volumen total,
  // acotado a MAX_MATRIX_COLUMNS×MAX_MATRIX_COLUMNS para que siga siendo legible.
  const degree = new Map<string, number>();
  for (const c of report.cells) {
    degree.set(c.codeA, (degree.get(c.codeA) ?? 0) + c.count);
    degree.set(c.codeB, (degree.get(c.codeB) ?? 0) + c.count);
  }
  const ids = Array.from(degree.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_MATRIX_COLUMNS)
    .map(([id]) => id);
  const cellCount = new Map(report.cells.map((c) => [`${c.codeA}\u0000${c.codeB}`, c.count]));
  const pairCount = (a: string, b: string): number | null => {
    if (a === b) return null;
    return cellCount.get(`${a}\u0000${b}`) ?? cellCount.get(`${b}\u0000${a}`) ?? 0;
  };
  const maxCount = report.maxCount || 1;
  const hiddenCodes = degree.size - ids.length;

  return (
    <div>
      <p style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 0 }}>
        Mapa de calor de co-ocurrencia: pasa el cursor por una celda para ver el par exacto. La
        intensidad marca citas compartidas; la diagonal queda vacía por definición.
      </p>
      <div className="table-wrap heat-wrap">
        <table className="data heat">
          <thead>
            <tr>
              <th />
              {ids.map((id) => (
                <th key={id} className="heat-head" title={name(id)}>
                  <span>{name(id)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ids.map((rowId) => (
              <tr key={rowId}>
                <th className="heat-row-head">{name(rowId)}</th>
                {ids.map((colId) => {
                  const value = pairCount(rowId, colId);
                  const opacity =
                    value === null ? 0.05 : value === 0 ? 0.03 : 0.12 + (value / maxCount) * 0.78;
                  return (
                    <td
                      key={colId}
                      className="num heat-cell"
                      title={value === null ? undefined : `${name(rowId)} × ${name(colId)}: ${value}`}
                      style={{ background: `rgba(96, 149, 255, ${opacity.toFixed(3)})` }}
                    >
                      {value === null || value === 0 ? '' : value}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hiddenCodes > 0 && (
        <p style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 6 }}>
          +{hiddenCodes} código(s) con conexiones no mostrados en el mapa.
        </p>
      )}

      <h3 style={{ margin: '18px 0 8px', fontSize: 14 }}>Pares en detalle</h3>
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
  const maxCell = Math.max(1, ...report.cells.map((c) => c.quotationCount));

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
                  const opacity = value ? 0.1 + (value / maxCell) * 0.75 : 0;
                  return (
                    <td
                      key={codeId}
                      className="num"
                      style={value ? { background: `rgba(96, 149, 255, ${opacity.toFixed(3)})` } : undefined}
                    >
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

function DensityBars({ rows }: { rows: CodingDensityRow[] | undefined }) {
  if (rows === undefined) return null;
  if (rows.length === 0) {
    return <EmptyNote>Registra investigadoras en «Codificar» (barra superior) para ver su actividad.</EmptyNote>;
  }
  const max = Math.max(...rows.map((r) => r.quotations), 1);
  return (
    <div>
      <p style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 0 }}>
        Citas distintas codificadas por cada investigadora (los códigos múltiples sobre una misma
        cita cuentan una vez). Con dos o más codificadoras, revisa la pestaña «Fiabilidad».
      </p>
      {rows.map((r) => (
        <div key={r.researcherId} className="bar-row">
          <span className="bar-label">{r.researcherName}</span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${(r.quotations / max) * 100}%` }} />
          </span>
          <span className="bar-count">{r.quotations}</span>
        </div>
      ))}
    </div>
  );
}
