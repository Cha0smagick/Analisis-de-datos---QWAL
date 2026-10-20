import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { Quotation, SourceDocument } from '@qualicanvas/core';
import { qwal } from '../api';
import { useApp } from '../App';
import { formatDateTime, joinWarnings } from '../utils';

export default function DocumentsView() {
  const { activeProject, setView, notice } = useApp();

  const [docs, setDocs] = useState<SourceDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [docText, setDocText] = useState<string | null>(null);
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [busyImport, setBusyImport] = useState(false);

  const refresh = useCallback(async () => {
    if (!activeProject) return;
    setError(null);
    setLoading(true);
    try {
      const list = await qwal.documents.list();
      setDocs(list);
      // Limpiar selección si el documento ya no existe
      setSelectedId((prev) => {
        if (prev && !list.some((d) => d.id === prev)) {
          setDocText(null);
          setQuotations([]);
          return null;
        }
        return prev;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [activeProject]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handlePick = () => {
    fileInputRef.current?.click();
  };

  const handleImport = async (files?: FileList) => {
    if (!activeProject) return;
    setBusyImport(true);
    setError(null);
    try {
      const results = await qwal.documents.pickAndImport(files);
      await refresh();
      if (results.length === 0) {
        notice('ok', 'No se importó ningún documento');
        return;
      }
      const warnings = results.flatMap((r) => r.warnings);
      const warnText = warnings.length > 0 ? ` · Advertencias: ${joinWarnings(warnings)}` : '';
      notice('ok', `Se importaron ${results.length} documento(s)${warnText}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyImport(false);
    }
  };

  const handleSelect = async (id: string) => {
    setError(null);
    setSelectedId(id);
    try {
      const doc = await qwal.documents.get(id);
      setDocText(doc?.text ?? null);
      const quotes = await qwal.quotations.listByDocument(id);
      setQuotations(quotes);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleRemove = async (id: string) => {
    const doc = docs?.find((d) => d.id === id);
    const ok = window.confirm(
      `¿Eliminar el documento «${doc?.title ?? id}»? Se eliminarán también sus citas.`,
    );
    if (!ok) return;
    setError(null);
    try {
      await qwal.documents.remove(id);
      if (selectedId === id) {
        setSelectedId(null);
        setDocText(null);
        setQuotations([]);
      }
      await refresh();
      notice('ok', 'Documento eliminado');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!activeProject) {
    return (
      <div className="view">
        <div className="empty">
          <span className="empty-icon" aria-hidden="true">
            📄
          </span>
          <h3>Sin proyecto activo</h3>
          <p>Selecciona o crea un proyecto para gestionar sus documentos.</p>
          <button type="button" className="btn btn-primary" onClick={() => setView('proyectos')}>
            Ir a Proyectos
          </button>
        </div>
      </div>
    );
  }

  const selectedDoc = docs?.find((d) => d.id === selectedId) ?? null;

  return (
    <div className="view">
      <div className="view-header">
        <div className="title-block">
          <h1>Documentos</h1>
          <p>Importa archivos y consulta su contenido y citas.</p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            void handleImport(e.target.files ?? undefined);
            e.target.value = '';
          }}
        />
        <button type="button" className="btn btn-primary" onClick={handlePick} disabled={busyImport}>
          {busyImport ? 'Importando…' : '📥 Importar documentos…'}
        </button>
      </div>

      {error && (
        <div className="error-box">
          <span aria-hidden="true">⚠</span>
          <span>{error}</span>
        </div>
      )}

      {docs === null || loading ? (
        <div className="empty">
          <span className="empty-icon" aria-hidden="true">
            ⏳
          </span>
          <h3>Cargando documentos…</h3>
        </div>
      ) : docs.length === 0 ? (
        <div className="empty">
          <span className="empty-icon" aria-hidden="true">
            🗂️
          </span>
          <h3>No hay documentos</h3>
          <p>Haz clic en «Importar documentos…» para añadir archivos a este proyecto.</p>
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Título</th>
                  <th>Tipo</th>
                  <th>Idioma</th>
                  <th>Modificado</th>
                  <th style={{ width: 170 }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr
                    key={d.id}
                    className={`clickable${selectedId === d.id ? ' selected' : ''}`}
                    onClick={() => void handleSelect(d.id)}
                  >
                    <td>{d.title}</td>
                    <td>
                      <span className="badge">{d.fileType}</span>
                    </td>
                    <td>{d.language ?? '—'}</td>
                    <td>{formatDateTime(d.updatedAt)}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => void handleSelect(d.id)}
                        >
                          Ver
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-danger"
                          onClick={() => void handleRemove(d.id)}
                        >
                          Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {selectedDoc && (
            <div className="card" style={{ marginTop: 18 }}>
              <div className="card-title">
                <h3>{selectedDoc.title}</h3>
                <span className="chip">
                  <b>{quotations.length}</b> cita(s)
                </span>
              </div>

              {docText === null ? (
                <div className="empty">
                  <span className="empty-icon" aria-hidden="true">
                    ⏳
                  </span>
                  <h3>Cargando contenido…</h3>
                </div>
              ) : (
                <div className="doc-text">{docText || '(sin contenido de texto)'}</div>
              )}

              <h3 style={{ marginTop: 20 }}>Citas</h3>
              {quotations.length === 0 ? (
                <p style={{ color: 'var(--text-dim)' }}>Este documento aún no tiene citas.</p>
              ) : (
                quotations.map((q) => (
                  <div key={q.id} className="quote-item">
                    <blockquote>«{q.segmentText}»</blockquote>
                    <div className="quote-meta">
                      {q.createdBy ? `por ${q.createdBy} · ` : ''}
                      {formatDateTime(q.createdAt)}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
