import { useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createContext, useContext, useEffect } from 'react';
import type { Project } from '@qualicanvas/core';
import { qwal } from './api';
import ProjectsView from './views/ProjectsView';
import DocumentsView from './views/DocumentsView';
import CodesView from './views/CodesView';
import SearchView from './views/SearchView';
import AnalysisView from './views/AnalysisView';
import WorkspaceView from './views/WorkspaceView';
import ExportView from './views/ExportView';

export type ViewKey = 'proyectos' | 'workspace' | 'documentos' | 'codigos' | 'busqueda' | 'analisis' | 'exportar';

interface Toast {
  id: number;
  kind: 'ok' | 'error';
  text: string;
}

export interface AppContextValue {
  view: ViewKey;
  setView: (v: ViewKey) => void;
  activeProject: Project | null;
  setActiveProject: (p: Project | null) => void;
  dbPath: string | null;
  setDbPath: (p: string | null) => void;
  notice: (kind: 'ok' | 'error', text: string) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp debe usarse dentro de <App>');
  return ctx;
}

interface NavItem {
  key: ViewKey;
  label: string;
  icon: string;
  requiresProject: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { key: 'proyectos', label: 'Proyectos', icon: '🗂️', requiresProject: false },
  { key: 'workspace', label: 'Codificar', icon: '🖍️', requiresProject: true },
  { key: 'documentos', label: 'Documentos', icon: '📄', requiresProject: true },
  { key: 'codigos', label: 'Códigos', icon: '🏷️', requiresProject: true },
  { key: 'busqueda', label: 'Búsqueda', icon: '🔍', requiresProject: true },
  { key: 'analisis', label: 'Análisis', icon: '📊', requiresProject: true },
  { key: 'exportar', label: 'Exportar', icon: '📤', requiresProject: true },
];

export default function App() {
  const [view, setView] = useState<ViewKey>('proyectos');
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [dbPath, setDbPath] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const notice = useCallback((kind: 'ok' | 'error', text: string) => {
    const id = ++toastId.current;
    setToasts((prev) => [...prev, { id, kind, text }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  // Al recuperar una base de datos ya abierta, sincronizamos el proyecto activo con el nav.
  const handleSetActiveProject = useCallback((p: Project | null) => {
    setActiveProject(p);
    if (p) window.localStorage.setItem('qc-last-project', p.id);
    else window.localStorage.removeItem('qc-last-project');
  }, []);

  const handleSetDbPath = useCallback((p: string | null) => {
    setDbPath(p);
    if (p) window.localStorage.setItem('qc-last-db', p);
    else window.localStorage.removeItem('qc-last-db');
  }, []);

  // Restauración de la última sesión: reabre la base y el proyecto con el que
  // se trabajó la vez anterior. Si la base ya no existe, se ignora en silencio.
  useEffect(() => {
    void (async () => {
      const savedDb = window.localStorage.getItem('qc-last-db');
      if (!savedDb) return;
      try {
        const result = await qwal.db.open(savedDb);
        if (!result) return;
        setDbPath(result.dbPath);
        const savedPid = window.localStorage.getItem('qc-last-project');
        const project = savedPid ? result.projects.find((p) => p.id === savedPid) : undefined;
        if (project) {
          const opened = await qwal.projects.open(project.id);
          setActiveProject(opened);
          setView('workspace');
          notice('ok', `Sesión restaurada: «${opened.name}»`);
        }
      } catch {
        // La base se movió o se borró: la pantalla de Proyectos queda disponible.
      }
    })();
  }, []);

  // Autoguardado: con backend sql.js los cambios viven en memoria; volcar cada
  // minuto limita la pérdida ante un fallo. Con better-sqlite3 flush() no hace nada.
  useEffect(() => {
    if (!activeProject) return;
    const timer = window.setInterval(() => {
      void qwal.db.flush().catch(() => undefined);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [activeProject]);

  const value: AppContextValue = {
    view,
    setView,
    activeProject,
    setActiveProject: handleSetActiveProject,
    dbPath,
    setDbPath: handleSetDbPath,
    notice,
  };

  return (
    <AppContext.Provider value={value}>
      <div className="app">
        <aside className="sidebar">
          <div className="brand">
            <span className="brand-logo">Q</span>
            <div className="brand-text">
              <strong>QualiCanvas</strong>
              <small>Análisis cualitativo</small>
            </div>
          </div>

          <nav className="nav" aria-label="Navegación principal">
            {NAV_ITEMS.map((item) => {
              const disabled = item.requiresProject && activeProject === null;
              return (
                <button
                  key={item.key}
                  type="button"
                  className={`nav-item${view === item.key ? ' active' : ''}`}
                  disabled={disabled}
                  title={disabled ? 'Selecciona un proyecto primero' : item.label}
                  onClick={() => setView(item.key)}
                >
                  <span className="nav-icon" aria-hidden="true">
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="sidebar-footer">
            {activeProject ? (
              <>
                <span className="footer-label">Proyecto activo</span>
                <strong className="footer-project">{activeProject.name}</strong>
              </>
            ) : (
              <span className="footer-label">Sin proyecto activo</span>
            )}
            {dbPath ? (
              <span className="footer-path" title={dbPath}>
                {dbPath}
              </span>
            ) : null}
          </div>
        </aside>

        <main className="content">
          {view === 'proyectos' && <ProjectsView />}
          {view === 'workspace' && <WorkspaceView />}
          {view === 'documentos' && <DocumentsView />}
          {view === 'codigos' && <CodesView />}
          {view === 'busqueda' && <SearchView />}
          {view === 'analisis' && <AnalysisView />}
          {view === 'exportar' && <ExportView />}
        </main>

        <div className="toast-stack" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`toast toast-${t.kind}`}>
              <span aria-hidden="true">{t.kind === 'ok' ? '✓' : '⚠'}</span>
              <span>{t.text}</span>
            </div>
          ))}
        </div>
      </div>
    </AppContext.Provider>
  );
}
