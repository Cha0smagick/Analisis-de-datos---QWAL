import { useCallback, useEffect, useState } from 'react';
import type { Project } from '@qualicanvas/core';
import { qwal } from '../api';
import { useApp } from '../App';
import { formatDate } from '../utils';

export default function ProjectsView() {
  const { activeProject, setActiveProject, dbPath, setDbPath, setView, notice } = useApp();

  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const list = await qwal.projects.list();
      setProjects(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleOpenDb = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await qwal.db.open();
      if (!result) return;
      setDbPath(result.dbPath);
      setProjects(result.projects);
      setActiveProject(null);
      notice('ok', 'Base de datos abierta');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleCreateDb = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await qwal.db.create();
      if (!result) return;
      setDbPath(result.dbPath);
      setProjects(result.projects);
      setActiveProject(null);
      notice('ok', 'Nueva base de datos creada');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleSelectProject = async (id: string) => {
    setError(null);
    try {
      const p = await qwal.projects.open(id);
      setActiveProject(p);
      setView('documentos');
      notice('ok', `Proyecto «${p.name}» activado`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleCreateProject = async () => {
    const name = newName.trim();
    if (!name) {
      notice('error', 'Escribe un nombre para el proyecto');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const p = await qwal.projects.create({ name, description: newDesc.trim() || undefined });
      setNewName('');
      setNewDesc('');
      setShowCreate(false);
      await refresh();
      setActiveProject(p);
      setView('documentos');
      notice('ok', `Proyecto «${p.name}» creado`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveProject = async (p: Project) => {
    const ok = window.confirm(
      `¿Eliminar el proyecto «${p.name}»? Se borrarán sus documentos, códigos, citas y análisis. Esta acción no se puede deshacer.`,
    );
    if (!ok) return;
    setError(null);
    try {
      await qwal.projects.remove(p.id);
      if (activeProject?.id === p.id) {
        setActiveProject(null);
      }
      await refresh();
      notice('ok', 'Proyecto eliminado');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="view">
      <div className="view-header">
        <div className="title-block">
          <h1>Proyectos</h1>
          <p>Gestiona tu base de datos y los proyectos de análisis cualitativo.</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" className="btn" onClick={() => void handleOpenDb()} disabled={busy}>
            📂 Abrir base de datos…
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void handleCreateDb()} disabled={busy}>
            ＋ Nueva base de datos
          </button>
        </div>
      </div>

      {error && (
        <div className="error-box">
          <span aria-hidden="true">⚠</span>
          <span>{error}</span>
        </div>
      )}

      {dbPath && (
        <div className="card" style={{ padding: '12px 18px', marginBottom: 16 }}>
          <span className="chip">
            <span aria-hidden="true">🗄️</span>
            <span>
              Base de datos: <b>{dbPath}</b>
            </span>
          </span>
        </div>
      )}

      {projects === null ? (
        <div className="empty">
          <span className="empty-icon" aria-hidden="true">
            ⏳
          </span>
          <h3>Cargando proyectos…</h3>
        </div>
      ) : projects.length === 0 ? (
        <div className="empty">
          <span className="empty-icon" aria-hidden="true">
            🗂️
          </span>
          <h3>Aún no hay proyectos</h3>
          <p>
            Crea un proyecto para empezar a importar documentos, codificar citas y analizar tus
            datos cualitativos.
          </p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Descripción</th>
                <th>Creado</th>
                <th>Actualizado</th>
                <th style={{ width: 170 }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} className={activeProject?.id === p.id ? 'selected' : undefined}>
                  <td>
                    <strong>{p.name}</strong>
                    {activeProject?.id === p.id && (
                      <span className="badge badge-accent" style={{ marginLeft: 8 }}>
                        activo
                      </span>
                    )}
                  </td>
                  <td style={{ maxWidth: 320, whiteSpace: 'normal' }}>{p.description || '—'}</td>
                  <td>{formatDate(p.createdAt)}</td>
                  <td>{formatDate(p.updatedAt)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        onClick={() => void handleSelectProject(p.id)}
                      >
                        Abrir
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        onClick={() => void handleRemoveProject(p)}
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
      )}

      <div className="card" style={{ marginTop: 20 }}>
        <div className="card-title">
          <h3>{showCreate ? 'Nuevo proyecto' : 'Crear proyecto'}</h3>
          {showCreate && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setShowCreate(false)}>
              Cancelar
            </button>
          )}
        </div>

        {!showCreate ? (
          <button type="button" className="btn" onClick={() => setShowCreate(true)}>
            ＋ Nuevo proyecto
          </button>
        ) : (
          <div>
            <div className="form-row">
              <div className="field">
                <label htmlFor="new-name">Nombre *</label>
                <input
                  id="new-name"
                  className="input"
                  value={newName}
                  placeholder="Ej. Estudio de usuarios 2026"
                  onChange={(e) => setNewName(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="field">
                <label htmlFor="new-desc">Descripción</label>
                <input
                  id="new-desc"
                  className="input"
                  value={newDesc}
                  placeholder="Objetivo o contexto del proyecto"
                  onChange={(e) => setNewDesc(e.target.value)}
                />
              </div>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleCreateProject()}
                disabled={busy}
              >
                Crear
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
