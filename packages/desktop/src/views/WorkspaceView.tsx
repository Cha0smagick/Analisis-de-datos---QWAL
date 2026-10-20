import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CodeTreeNode,
  Memo,
  Quotation,
  QuotationCodeAttribution,
  Researcher,
  SourceDocument,
  TextAnchor,
} from '../api';
import { ApiError, qwal } from '../api';
import { useApp } from '../App';
import { formatDateTime } from '../utils';

/**
 * Espacio de codificación: documento + texto seleccionable + códigos.
 *
 * Flujo maestro (como ATLAS.ti): seleccionas texto y pulsas un código → se
 * crea la cita (offsets de caracteres sobre rawText) y se le asigna el código
 * con el investigador activo. Sin investigador activo la codificación es
 * anónima (las estadísticas IRR la ignoran).
 */

interface Selection { start: number; end: number }

type MediaKind = 'audio' | 'video' | 'image' | null;

function mediaKindOf(fileType: string | undefined): MediaKind {
  if (!fileType) return null;
  if (['mp3', 'wav', 'm4a'].includes(fileType)) return 'audio';
  if (['mp4', 'webm'].includes(fileType)) return 'video';
  if (['jpg', 'png', 'webp'].includes(fileType)) return 'image';
  return null;
}

/** Ruta Windows → URL file:// para <audio>/<video>/<img> del renderer. */
function fileUrl(p: string): string {
  // shortcut: un '#' en la ruta rompería la URL; renombrar el archivo si aparece.
  return encodeURI(`file:///${p.replace(/\\/g, '/').replace(/^\//, '')}`);
}

/** Segundos → m:ss para etiquetas de fragmentos de media. */
function fmtTs(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Aplana el árbol de códigos conservando la ruta legible de cada nodo. */
function flattenCodes(nodes: CodeTreeNode[]): CodeTreeNode[] {
  const out: CodeTreeNode[] = [];
  const walk = (list: CodeTreeNode[]): void => {
    for (const n of list) {
      out.push(n);
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

export default function WorkspaceView() {
  const { activeProject, setView, notice } = useApp();

  const [docs, setDocs] = useState<SourceDocument[]>([]);
  const [docId, setDocId] = useState<string | null>(null);
  const [docText, setDocText] = useState<string>('');
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [quoteCodes, setQuoteCodes] = useState<Record<string, QuotationCodeAttribution[]>>({});

  const [codes, setCodes] = useState<CodeTreeNode[]>([]);
  const [codeFilter, setCodeFilter] = useState('');
  /** Si tiene texto, el click en un código autocodifica ese término en todo el proyecto. */
  const [autoTerm, setAutoTerm] = useState('');

  const [researchers, setResearchers] = useState<Researcher[]>([]);
  const [researcherId, setResearcherId] = useState<string>('');

  const [selection, setSelection] = useState<Selection | null>(null);
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);

  const [memoFor, setMemoFor] = useState<string | null>(null);
  const [memos, setMemos] = useState<Memo[]>([]);
  const [memoTitle, setMemoTitle] = useState('');
  const [memoBody, setMemoBody] = useState('');

  // Alta de investigadoras en línea (window.prompt no existe en Electron).
  const [researcherFormOpen, setResearcherFormOpen] = useState(false);
  const [newResearcherName, setNewResearcherName] = useState('');

  // Documentos multimedia: reproductor + captura de rangos.
  const [docMeta, setDocMeta] = useState<SourceDocument | null>(null);
  const mediaRef = useRef<HTMLVideoElement | null>(null);
  const [mediaRange, setMediaRange] = useState<{ startTs: number; endTs: number } | null>(null);
  const [mediaLabel, setMediaLabel] = useState('');
  const [transcribing, setTranscribing] = useState(false);

  const [busy, setBusy] = useState(false);

  const activeResearcher = researchers.find((r) => r.id === researcherId) ?? null;

  // Carga inicial: documentos, códigos e investigadores del proyecto.
  useEffect(() => {
    if (!activeProject) return;
    let cancelled = false;
    void (async () => {
      try {
        const [docList, tree, people] = await Promise.all([
          qwal.documents.list(),
          qwal.codes.tree(),
          qwal.researchers.list(),
        ]);
        if (cancelled) return;
        setDocs(docList);
        setCodes(flattenCodes(tree));
        setResearchers(people);
        const saved = window.localStorage.getItem(`qc-researcher-${activeProject.id}`);
        setResearcherId(saved && people.some((r) => r.id === saved) ? saved : people.find((r) => r.isPrimary)?.id ?? '');
      } catch (e) {
        notice('error', e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [activeProject, notice]);

  const pickResearcher = useCallback((id: string) => {
    setResearcherId(id);
    if (activeProject) window.localStorage.setItem(`qc-researcher-${activeProject.id}`, id);
  }, [activeProject]);

  /** Citas del documento + atribuciones de códigos por cita. */
  const refreshQuotes = useCallback(async (documentId: string) => {
    const quotes = await qwal.quotations.listByDocument(documentId);
    const entries = await Promise.all(
      quotes.map(async (q) => [q.id, await qwal.quotations.codes(q.id)] as const),
    );
    setQuotations(quotes);
    setQuoteCodes(Object.fromEntries(entries));
  }, []);

  const openDocument = useCallback(async (id: string) => {
    setDocId(id);
    setSelectedQuoteId(null);
    setSelection(null);
    setMemoFor(null);
    setDocText('');
    setDocMeta(null);
    setMediaRange(null);
    setMediaLabel('');
    try {
      const doc = await qwal.documents.get(id);
      setDocText(doc?.text ?? '');
      setDocMeta(doc?.document ?? null);
      await refreshQuotes(id);
    } catch (e) {
      notice('error', e instanceof Error ? e.message : String(e));
    }
  }, [notice, refreshQuotes]);

  /** Offsets globales de la selección: cada segmento lleva data-start absoluto. */
  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      setSelection(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const startEl = (range.startContainer.parentElement ?? range.startContainer) as HTMLElement | null;
    const endEl = (range.endContainer.parentElement ?? range.endContainer) as HTMLElement | null;
    const startBase = startEl?.dataset?.start;
    const endBase = endEl?.dataset?.start;
    if (startBase === undefined || endBase === undefined) {
      setSelection(null);
      return;
    }
    const start = Number(startBase) + range.startOffset;
    const end = Number(endBase) + range.endOffset;
    setSelection(end > start ? { start, end } : null);
  }, []);

  const clearSelection = useCallback(() => {
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  }, []);

  const createQuotation = useCallback(async (sel: Selection): Promise<Quotation | null> => {
    if (!docId) return null;
    try {
      const q = await qwal.quotations.create({
        documentId: docId,
        anchor: { kind: 'text', documentId: docId, startPos: sel.start, endPos: sel.end },
        segmentText: docText.slice(sel.start, sel.end),
        createdBy: activeResearcher?.name ?? null,
      });
      await refreshQuotes(docId);
      return q;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'conflict') {
        // La cita ya existía (UNIQUE document/start/end): reutilízala.
        const existing = quotations.find(
          (q) => q.anchor.kind === 'text' && q.anchor.startPos === sel.start && q.anchor.endPos === sel.end,
        );
        if (existing) return existing;
        notice('error', 'Esa cita ya existe.');
        return null;
      }
      throw e;
    }
  }, [activeResearcher, docId, docText, notice, quotations, refreshQuotes]);

  /**
   * Autocodificación semántica: cada coincidencia KWIC del término en todo el
   * proyecto se convierte en cita y recibe el código. Las coincidencias que ya
   * tenían cita (conflict por UNIQUE) reutilizan la existente y solo añaden el
   * código.
   */
  const handleAutoCode = useCallback(async (code: CodeTreeNode, term: string) => {
    if (!docId) return;
    setBusy(true);
    try {
      const report = await qwal.analysis.kwic(term, 0);
      const hits = report.entries;
      if (hits.length === 0) {
        notice('ok', `Sin coincidencias para «${term}» en el proyecto.`);
        return;
      }
      const docs = new Set(hits.map((h) => h.documentId)).size;
      const ok = window.confirm(
        `«${term}» aparece ${hits.length} vez/veces en ${docs} documento(s).\n` +
          `¿Crear una cita por coincidencia y codificarlas todas como «${code.path}»?`,
      );
      if (!ok) return;
      const quoteCache = new Map<string, Quotation[]>();
      const findExisting = async (dId: string, s: number, e: number): Promise<Quotation | undefined> => {
        if (!quoteCache.has(dId)) quoteCache.set(dId, await qwal.quotations.listByDocument(dId));
        return quoteCache
          .get(dId)!
          .find((q) => q.anchor.kind === 'text' && q.anchor.startPos === s && q.anchor.endPos === e);
      };
      let created = 0;
      let reused = 0;
      let failed = 0;
      for (const h of hits) {
        try {
          const q = await qwal.quotations.create({
            documentId: h.documentId,
            anchor: { kind: 'text', documentId: h.documentId, startPos: h.matchStart, endPos: h.matchEnd },
            segmentText: h.match,
            createdBy: activeResearcher?.name ?? null,
          });
          await qwal.coding.assign(q.id, code.id, activeResearcher?.id ?? null);
          created++;
        } catch (err) {
          if (err instanceof ApiError && err.code === 'conflict') {
            const existing = await findExisting(h.documentId, h.matchStart, h.matchEnd);
            if (existing) {
              await qwal.coding.assign(existing.id, code.id, activeResearcher?.id ?? null);
              reused++;
            } else {
              failed++;
            }
          } else {
            failed++;
          }
        }
      }
      await refreshQuotes(docId);
      notice('ok', `Autocodificado «${code.name}»: ${created} cita(s) nueva(s), ${reused} existente(s)${failed ? `, ${failed} fallida(s)` : ''}.`);
    } catch (e) {
      notice('error', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [activeResearcher, docId, notice, refreshQuotes]);

  /** Click en un código: con selección crea la cita y asigna; con cita activa solo asigna. */
  const handleCodeClick = useCallback(async (code: CodeTreeNode) => {
    if (!docId) return;
    const term = autoTerm.trim();
    if (term) {
      await handleAutoCode(code, term);
      return;
    }
    setBusy(true);
    try {
      let quoteId = selectedQuoteId;
      if (selection) {
        const q = await createQuotation(selection);
        if (!q) return;
        quoteId = q.id;
        setSelectedQuoteId(q.id);
        clearSelection();
      }
      if (!quoteId) {
        notice('error', 'Selecciona texto en el documento, o una cita, antes de codificar.');
        return;
      }
      await qwal.coding.assign(quoteId, code.id, activeResearcher?.id ?? null);
      const attribution = await qwal.quotations.codes(quoteId);
      setQuoteCodes((prev) => ({ ...prev, [quoteId]: attribution }));
    } catch (e) {
      notice('error', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [activeResearcher, autoTerm, clearSelection, createQuotation, docId, handleAutoCode, notice, selectedQuoteId, selection]);

  const handleUnassign = useCallback(async (quoteId: string, codeId: string) => {
    try {
      await qwal.coding.unassign(quoteId, codeId, activeResearcher?.id ?? null);
      const attribution = await qwal.quotations.codes(quoteId);
      setQuoteCodes((prev) => ({ ...prev, [quoteId]: attribution }));
    } catch (e) {
      notice('error', e instanceof Error ? e.message : String(e));
    }
  }, [activeResearcher, notice]);

  const handleRemoveQuote = useCallback(async (quoteId: string) => {
    if (!window.confirm('¿Eliminar esta cita y sus codificaciones?')) return;
    try {
      await qwal.quotations.remove(quoteId);
      if (docId) await refreshQuotes(docId);
      setSelectedQuoteId((prev) => (prev === quoteId ? null : prev));
      setMemoFor((prev) => (prev === quoteId ? null : prev));
    } catch (e) {
      notice('error', e instanceof Error ? e.message : String(e));
    }
  }, [docId, notice, refreshQuotes]);

  const openMemoForm = useCallback(async (quoteId: string) => {
    setMemoFor((prev) => (prev === quoteId ? null : quoteId));
    setMemoTitle('');
    setMemoBody('');
    setMemos([]);
    try {
      setMemos(await qwal.memos.listForTarget('quotation', quoteId));
    } catch (e) {
      notice('error', e instanceof Error ? e.message : String(e));
    }
  }, [notice]);

  const handleMemoSave = useCallback(async () => {
    if (!memoFor || !memoTitle.trim() || !memoBody.trim()) return;
    try {
      await qwal.memos.create({
        targetType: 'quotation',
        targetId: memoFor,
        title: memoTitle.trim(),
        body: memoBody.trim(),
        createdBy: activeResearcher?.id ?? null,
      });
      setMemos(await qwal.memos.listForTarget('quotation', memoFor));
      setMemoTitle('');
      setMemoBody('');
      notice('ok', 'Memo guardado');
    } catch (e) {
      notice('error', e instanceof Error ? e.message : String(e));
    }
  }, [activeResearcher, memoBody, memoFor, memoTitle, notice]);

  const handleCreateResearcher = useCallback(async () => {
    const name = newResearcherName.trim();
    if (!name) return;
    try {
      const r = await qwal.researchers.create({ name });
      setResearchers((prev) => [...prev, r]);
      pickResearcher(r.id);
      setNewResearcherName('');
      setResearcherFormOpen(false);
      notice('ok', `Investigadora «${name}» registrada`);
    } catch (e) {
      notice('error', e instanceof Error ? e.message : String(e));
    }
  }, [newResearcherName, notice, pickResearcher]);

  /** Cita de audio/vídeo: el ancla es el rango de tiempo marcado, en segundos. */
  const handleCreateMediaQuote = useCallback(async () => {
    if (!docId || !mediaRange || mediaRange.endTs <= mediaRange.startTs) return;
    setBusy(true);
    try {
      const label = mediaLabel.trim() || `${fmtTs(mediaRange.startTs)} – ${fmtTs(mediaRange.endTs)}`;
      const q = await qwal.quotations.create({
        documentId: docId,
        anchor: { kind: 'media', documentId: docId, startTs: mediaRange.startTs, endTs: mediaRange.endTs },
        segmentText: label,
        createdBy: activeResearcher?.name ?? null,
      });
      setSelectedQuoteId(q.id);
      setMediaRange(null);
      setMediaLabel('');
      await refreshQuotes(docId);
      notice('ok', 'Cita creada: púlsa un código para codificarla');
    } catch (e) {
      notice('error', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [activeResearcher, docId, mediaLabel, mediaRange, notice, refreshQuotes]);

  /** Transcribe el archivo con Whisper (CLI local) y crea un documento de texto. */
  const handleTranscribe = useCallback(async () => {
    if (!docMeta?.filePath) return;
    setTranscribing(true);
    try {
      const { text } = await qwal.media.transcribe(docMeta.filePath);
      const title = `${docMeta.title.replace(/\.[^.]+$/, '')} — transcripción`;
      const result = await qwal.documents.createText({ title, text });
      setDocs(await qwal.documents.list());
      notice('ok', `Transcripción lista: «${result.title}» (${result.textLength} caracteres)`);
    } catch (e) {
      notice('error', e instanceof Error ? e.message : String(e));
    } finally {
      setTranscribing(false);
    }
  }, [docMeta, notice]);

  /** Segmentos texto/marca con data-start absoluto para el cálculo de offsets. */
  const segments = useMemo(() => {
    if (!docText) return [];
    const segs: Array<{ text: string; start: number; quote?: Quotation }> = [];
    let pos = 0;
    const sorted = quotations
      .filter((q): q is Quotation & { anchor: TextAnchor } => q.anchor.kind === 'text')
      .sort((a, b) => a.anchor.startPos - b.anchor.startPos);
    for (const q of sorted) {
      const { startPos: s, endPos: e } = q.anchor;
      // shortcut: citas solapadas o fuera de rango no se marcan (siguen en el panel);
      // soportar solapamiento real exige árbol de rangos — hacerlo si aparece.
      if (s < pos || s > e || e > docText.length) continue;
      if (s > pos) segs.push({ text: docText.slice(pos, s), start: pos });
      segs.push({ text: docText.slice(s, e), start: s, quote: q });
      pos = e;
    }
    if (pos < docText.length) segs.push({ text: docText.slice(pos), start: pos });
    return segs;
  }, [docText, quotations]);

  const visibleCodes = useMemo(() => {
    const needle = codeFilter.trim().toLowerCase();
    return needle ? codes.filter((c) => c.path.toLowerCase().includes(needle)) : codes;
  }, [codeFilter, codes]);

  const docQuotations = useMemo(
    () =>
      quotations.map((q) => ({ q, codes: quoteCodes[q.id] ?? [] })),
    [quotations, quoteCodes],
  );

  if (!activeProject) {
    return (
      <div className="view">
        <div className="empty">
          <span className="empty-icon" aria-hidden="true">🖍️</span>
          <h3>Sin proyecto activo</h3>
          <p>Selecciona o crea un proyecto para empezar a codificar.</p>
          <button type="button" className="btn btn-primary" onClick={() => setView('proyectos')}>
            Ir a Proyectos
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="view view-workspace">
      <div className="view-header">
        <div className="title-block">
          <h1>Codificar</h1>
          <p>Selecciona texto y pulsa un código para crear la cita con ese código.</p>
        </div>
        <div className="researcher-bar">
          <label htmlFor="ws-researcher">Investigadora</label>
          <select
            id="ws-researcher"
            value={researcherId}
            onChange={(e) => pickResearcher(e.target.value)}
          >
            <option value="">— anónima —</option>
            {researchers.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          {!researcherFormOpen ? (
            <button type="button" className="btn btn-sm" onClick={() => setResearcherFormOpen(true)}>
              + Añadir
            </button>
          ) : (
            <>
              <input
                type="text"
                placeholder="Nombre de la investigadora…"
                value={newResearcherName}
                autoFocus
                onChange={(e) => setNewResearcherName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleCreateResearcher();
                  if (e.key === 'Escape') setResearcherFormOpen(false);
                }}
              />
              <button
                type="button"
                className="btn btn-sm btn-primary"
                disabled={!newResearcherName.trim()}
                onClick={() => void handleCreateResearcher()}
              >
                Guardar
              </button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setResearcherFormOpen(false)}>
                ✕
              </button>
            </>
          )}
        </div>
      </div>

      <div className="workspace">
        {/* --- Documentos --- */}
        <div className="ws-pane ws-docs" aria-label="Documentos">
          <div className="ws-pane-title">Documentos</div>
          <div className="ws-scroll">
            {docs.length === 0 && <p className="ws-hint">No hay documentos todavía.</p>}
            {docs.map((d) => (
              <button
                key={d.id}
                type="button"
                className={`ws-doc-item${docId === d.id ? ' active' : ''}`}
                onClick={() => void openDocument(d.id)}
              >
                {d.title}
              </button>
            ))}
          </div>
        </div>

        {/* --- Texto del documento (o reproductor multimedia) --- */}
        <div className="ws-pane ws-text-pane">
          {!docId ? (
            <div className="ws-hint-block">
              <p>Elige un documento de la izquierda para empezar a codificar.</p>
            </div>
          ) : mediaKindOf(docMeta?.fileType) && docMeta?.filePath ? (
            <div className="ws-media">
              {mediaKindOf(docMeta.fileType) === 'image' ? (
                <>
                  <img className="ws-media-img" src={fileUrl(docMeta.filePath)} alt={docMeta.title} />
                  {/* shortcut: la imagen se muestra completa; la codificación por regiones (bbox) exige selección de área — hacerla si se pide. */}
                  <p className="ws-hint">
                    Imágenes: se muestran completas por ahora; la codificación por regiones llegará después.
                  </p>
                </>
              ) : (
                <>
                  <div className="ws-text-toolbar">
                    <span className="ws-hint">
                      Marca inicio y fin del fragmento, crea la cita y púlsa un código. O pide la transcripción con Whisper.
                    </span>
                  </div>
                  <div className="ws-media-view">
                    {mediaKindOf(docMeta.fileType) === 'audio' ? (
                      <audio ref={mediaRef} controls src={fileUrl(docMeta.filePath)} style={{ width: '100%' }} />
                    ) : (
                      <video ref={mediaRef} controls src={fileUrl(docMeta.filePath)} style={{ width: '100%', maxHeight: 340 }} />
                    )}
                    <div className="ws-media-controls">
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() =>
                          setMediaRange((r) => ({
                            startTs: mediaRef.current?.currentTime ?? 0,
                            endTs: r?.endTs ?? (mediaRef.current?.currentTime ?? 0) + 1,
                          }))
                        }
                      >
                        Ⓐ Inicio aquí
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() =>
                          setMediaRange((r) => ({
                            startTs: r?.startTs ?? Math.max(0, (mediaRef.current?.currentTime ?? 1) - 5),
                            endTs: mediaRef.current?.currentTime ?? 1,
                          }))
                        }
                      >
                        Ⓑ Fin aquí
                      </button>
                      <span className="ws-selection-info">
                        {mediaRange ? `${fmtTs(mediaRange.startTs)} – ${fmtTs(mediaRange.endTs)}` : 'sin rango marcado'}
                      </span>
                      <input
                        type="text"
                        className="attr-input"
                        style={{ maxWidth: 220 }}
                        placeholder="Etiqueta del fragmento (opcional)"
                        value={mediaLabel}
                        onChange={(e) => setMediaLabel(e.target.value)}
                      />
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        disabled={busy || !mediaRange || mediaRange.endTs <= mediaRange.startTs}
                        onClick={() => void handleCreateMediaQuote()}
                      >
                        Crear cita
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={transcribing}
                        title="Requiere Whisper instalado: pip install -U openai-whisper"
                        onClick={() => void handleTranscribe()}
                      >
                        {transcribing ? 'Transcribiendo… (puede tardar minutos)' : '🗣 Transcribir (Whisper)'}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : (
            <>
              <div className="ws-text-toolbar">
                {selection ? (
                  <>
                    <span className="ws-selection-info">
                      Selección: {selection.end - selection.start} car. ({docText.slice(selection.start, selection.end).slice(0, 60)}{selection.end - selection.start > 60 ? '…' : ''})
                    </span>
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      disabled={busy}
                      onClick={async () => {
                        const q = await createQuotation(selection);
                        if (q) {
                          setSelectedQuoteId(q.id);
                          clearSelection();
                        }
                      }}
                    >
                      Crear cita
                    </button>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={clearSelection}>
                      Cancelar
                    </button>
                  </>
                ) : (
                  <span className="ws-hint">Arrastra sobre el texto para seleccionar una cita.</span>
                )}
              </div>
              <div
                className="ws-text"
                onMouseUp={handleMouseUp}
              >
                {segments.map((seg, i) =>
                  seg.quote ? (
                    <mark
                      key={i}
                      data-start={seg.start}
                      className={`quote-mark${selectedQuoteId === seg.quote.id ? ' selected' : ''}`}
                      onClick={() => setSelectedQuoteId(seg.quote!.id)}
                      title="Cita codificada"
                    >
                      {seg.text}
                    </mark>
                  ) : (
                    <span key={i} data-start={seg.start}>
                      {seg.text}
                    </span>
                  ),
                )}
                {docText.length === 0 && <span className="ws-hint">(documento sin texto)</span>}
              </div>
            </>
          )}
        </div>

        {/* --- Códigos + citas --- */}
        <div className="ws-pane ws-codes-pane">
          <div className="ws-pane-title">Códigos</div>
          <input
            type="search"
            className="ws-code-filter"
            placeholder="Filtrar códigos…"
            value={codeFilter}
            onChange={(e) => setCodeFilter(e.target.value)}
          />
          <input
            type="search"
            className="ws-code-filter"
            placeholder="Autocodificar término (opcional)…"
            value={autoTerm}
            onChange={(e) => setAutoTerm(e.target.value)}
            title="Si escribes un término aquí, pulsar un código crea una cita por cada coincidencia del término en TODO el proyecto y las codifica con ese código."
          />
          {autoTerm.trim() && (
            <p className="ws-hint">
              Modo autocodificar: «{autoTerm.trim()}» — pulsar un código aplicará sus coincidencias en todo el proyecto.
            </p>
          )}
          <div className="ws-scroll ws-code-list">
            {visibleCodes.length === 0 && <p className="ws-hint">Sin códigos. Créalos en la vista Códigos.</p>}
            {visibleCodes.map((c) => (
              <button
                key={c.id}
                type="button"
                className="ws-code-item"
                disabled={busy || (!selection && !selectedQuoteId)}
                title={selection || selectedQuoteId ? `Codificar como «${c.path}»` : 'Selecciona texto o una cita primero'}
                style={c.color ? { borderLeftColor: c.color } : undefined}
                onClick={() => void handleCodeClick(c)}
              >
                <span className="ws-code-path">{c.depth > 0 ? c.path : c.name}</span>
              </button>
            ))}
          </div>

          <div className="ws-pane-title">Citas del documento <span className="ws-count">{docQuotations.length}</span></div>
          <div className="ws-scroll ws-quotes">
            {docQuotations.length === 0 && docId && (
              <p className="ws-hint">Aún no hay citas en este documento.</p>
            )}
            {docQuotations.map(({ q, codes: assigned }) => (
              <div
                key={q.id}
                className={`ws-quote${selectedQuoteId === q.id ? ' active' : ''}`}
                onClick={() => setSelectedQuoteId(q.id)}
              >
                <blockquote>«{q.segmentText}»</blockquote>
                <div className="ws-quote-codes">
                  {assigned.length === 0 && <span className="ws-hint">sin códigos</span>}
                  {assigned.map((a) => {
                    const code = codes.find((c) => c.id === a.codeId);
                    return (
                      <button
                        key={`${a.codeId}-${a.researcherId ?? 'anon'}`}
                        type="button"
                        className="ws-code-chip"
                        title={`Codificado por ${researchers.find((r) => r.id === a.researcherId)?.name ?? 'anónima'} — clic para quitar`}
                        style={code?.color ? { borderColor: code.color } : undefined}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleUnassign(q.id, a.codeId);
                        }}
                      >
                        {code?.name ?? a.codeId}
                        {a.researcherId ? '' : ' ·anon'}
                      </button>
                    );
                  })}
                </div>
                <div className="ws-quote-actions" onClick={(e) => e.stopPropagation()}>
                  <span className="ws-quote-meta">
                    {q.anchor.kind === 'media'
                      ? `⏱ ${fmtTs(q.anchor.startTs)} – ${fmtTs(q.anchor.endTs)}`
                      : `${q.createdBy ? `${q.createdBy} · ` : ''}${formatDateTime(q.createdAt)}`}
                  </span>
                  {q.anchor.kind === 'media' && (mediaKindOf(docMeta?.fileType) === 'audio' || mediaKindOf(docMeta?.fileType) === 'video') && (
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      title="Reproducir desde el inicio del fragmento"
                      onClick={() => {
                        if (mediaRef.current) {
                          mediaRef.current.currentTime = Math.max(0, q.anchor.kind === 'media' ? q.anchor.startTs : 0);
                          void mediaRef.current.play();
                        }
                      }}
                    >
                      ⏵
                    </button>
                  )}
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => void openMemoForm(q.id)}>
                    📝 Memos
                  </button>
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => void handleRemoveQuote(q.id)}>
                    ✕
                  </button>
                </div>

                {memoFor === q.id && (
                  <div className="ws-memo-form" onClick={(e) => e.stopPropagation()}>
                    {memos.length > 0 && (
                      <ul className="ws-memo-list">
                        {memos.map((m) => (
                          <li key={m.id}>
                            <strong>{m.title}</strong>
                            <p>{m.content}</p>
                          </li>
                        ))}
                      </ul>
                    )}
                    <input
                      type="text"
                      placeholder="Título del memo"
                      value={memoTitle}
                      onChange={(e) => setMemoTitle(e.target.value)}
                    />
                    <textarea
                      placeholder="Contenido…"
                      rows={3}
                      value={memoBody}
                      onChange={(e) => setMemoBody(e.target.value)}
                    />
                    <div className="ws-memo-actions">
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        disabled={!memoTitle.trim() || !memoBody.trim()}
                        onClick={() => void handleMemoSave()}
                      >
                        Guardar memo
                      </button>
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setMemoFor(null)}>
                        Cerrar
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
