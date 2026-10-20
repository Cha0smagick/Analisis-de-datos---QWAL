import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Quotation, SearchHit } from '@qualicanvas/core';
import { qwal } from '../api';
import { useApp } from '../App';
import { formatDateTime } from '../utils';

export default function SearchView() {
  const { activeProject, setView, notice } = useApp();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedTitle, setSelectedTitle] = useState<string | null>(null);
  const [selectedText, setSelectedText] = useState<string | null>(null);
  const [selectedQuotes, setSelectedQuotes] = useState<Quotation[] | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q || !activeProject) return;
    setSearching(true);
    setError(null);
    setSelectedTitle(null);
    setSelectedText(null);
    setSelectedQuotes(null);
    try {
      const hits = await qwal.search.query(q);
      setResults(hits);
      if (hits.length === 0) notice('ok', 'Sin resultados');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSearching(false);
    }
  };

  const handleSelect = async (hit: SearchHit) => {
    setError(null);
    setSelectedTitle(hit.title);
    setSelectedText(null);
    setSelectedQuotes(null);
    try {
      const doc = await qwal.documents.get(hit.documentId);
      setSelectedText(doc?.text ?? null);
      setSelectedQuotes(await qwal.quotations.listByDocument(hit.documentId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (!activeProject) {
    return (
      <div className="view">
        <div className="empty">
          <span className="empty-icon" aria-hidden="true">
            🔍
          </span>
          <h3>Sin proyecto activo</h3>
          <p>Selecciona o crea un proyecto para buscar en sus documentos.</p>
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
          <h1>Búsqueda</h1>
          <p>Busca texto en los documentos del proyecto.</p>
        </div>
      </div>

      <form className="card" onSubmit={(e) => void handleSubmit(e)} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <input
          className="input"
          style={{ flex: 1 }}
          placeholder="Escribe el texto a buscar…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={searching}>
          {searching ? 'Buscando…' : 'Buscar'}
        </button>
      </form>

      {error && (
        <div className="error-box">
          <span aria-hidden="true">⚠</span>
          <span>{error}</span>
        </div>
      )}

      {results !== null && results.length === 0 && (
        <div className="empty">
          <span className="empty-icon" aria-hidden="true">
            🕳️
          </span>
          <h3>Sin resultados</h3>
          <p>No se encontraron coincidencias para «{query}».</p>
        </div>
      )}

      {results !== null && results.length > 0 && (
        <div className="card">
          <div className="card-title">
            <h3>Resultados ({results.length})</h3>
          </div>
          {results.map((hit) => (
            <div
              key={hit.documentId}
              className="quote-item"
              role="button"
              tabIndex={0}
              style={{ cursor: 'pointer' }}
              onClick={() => void handleSelect(hit)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSelect(hit);
              }}
            >
              <blockquote style={{ fontStyle: 'normal', fontWeight: 600 }}>
                {hit.title} <span className="badge badge-accent">score {hit.score.toFixed(2)}</span>
              </blockquote>
              {hit.snippet && <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>{hit.snippet}</div>}
            </div>
          ))}
        </div>
      )}

      {selectedTitle !== null && (
        <div className="card">
          <div className="card-title">
            <h3>{selectedTitle}</h3>
            <span className="chip">
              <b>{selectedQuotes?.length ?? 0}</b> cita(s)
            </span>
          </div>

          {selectedText === null ? (
            <div className="empty">
              <span className="empty-icon" aria-hidden="true">
                ⏳
              </span>
              <h3>Cargando contenido…</h3>
            </div>
          ) : (
            <div className="doc-text">{selectedText || '(sin contenido de texto)'}</div>
          )}

          {selectedQuotes !== null && selectedQuotes.length > 0 && (
            <>
              <h3 style={{ marginTop: 20 }}>Citas</h3>
              {selectedQuotes.map((q) => (
                <div key={q.id} className="quote-item">
                  <blockquote>«{q.segmentText}»</blockquote>
                  <div className="quote-meta">{formatDateTime(q.createdAt)}</div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
