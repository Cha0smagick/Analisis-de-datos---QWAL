import { useCallback, useEffect, useState } from 'react';
import type { Code, CodeTreeNode } from '@qualicanvas/core';
import { qwal } from '../api';
import { useApp } from '../App';

export default function CodesView() {
  const { activeProject, setView, notice } = useApp();

  const [tree, setTree] = useState<CodeTreeNode[] | null>(null);
  const [flat, setFlat] = useState<Code[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newParent, setNewParent] = useState('');
  const [newColor, setNewColor] = useState('#4f8cff');
  const [newDesc, setNewDesc] = useState('');

  const refresh = useCallback(async () => {
    if (!activeProject) return;
    setError(null);
    try {
      const [t, f] = await Promise.all([qwal.codes.tree(), qwal.codes.list()]);
      setTree(t);
      setFlat(f);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [activeProject]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) {
      notice('error', 'Escribe un nombre para el código');
      return;
    }
    setError(null);
    try {
      await qwal.codes.create({
        name,
        parentId: newParent || undefined,
        color: newColor || undefined,
        description: newDesc.trim() || undefined,
      });
      setNewName('');
      setNewParent('');
      setNewDesc('');
      setShowCreate(false);
      await refresh();
      notice('ok', `Código «${name}» creado`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleUpdate = async (id: string, patch: { name?: string; color?: string; description?: string }) => {
    setError(null);
    try {
      await qwal.codes.update(id, patch);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleMove = async (id: string, parentId: string) => {
    setError(null);
    try {
      await qwal.codes.move(id, parentId === '' ? null : parentId);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleRemove = async (id: string, name: string) => {
    const ok = window.confirm(`¿Eliminar el código «${name}» y todos sus subcódigos?`);
    if (!ok) return;
    setError(null);
    try {
      await qwal.codes.remove(id);
      await refresh();
      notice('ok', 'Código eliminado');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!activeProject) {
    return (
      <div className="view">
        <div className="empty">
          <span className="empty-icon" aria-hidden="true">
            🏷️
          </span>
          <h3>Sin proyecto activo</h3>
          <p>Selecciona o crea un proyecto para gestionar su árbol de códigos.</p>
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
          <h1>Códigos</h1>
          <p>Construye tu árbol de codificación jerárquico.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? 'Cancelar' : '＋ Nuevo código'}
        </button>
      </div>

      {error && (
        <div className="error-box">
          <span aria-hidden="true">⚠</span>
          <span>{error}</span>
        </div>
      )}

      {showCreate && (
        <div className="card">
          <h3>Nuevo código</h3>
          <div className="form-row">
            <div className="field">
              <label htmlFor="code-name">Nombre *</label>
              <input
                id="code-name"
                className="input"
                value={newName}
                placeholder="Ej. Emociones"
                onChange={(e) => setNewName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="field">
              <label htmlFor="code-parent">Código padre</label>
              <select
                id="code-parent"
                className="select"
                value={newParent}
                onChange={(e) => setNewParent(e.target.value)}
              >
                <option value="">(Raíz)</option>
                {(flat ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="code-color">Color</label>
              <input
                id="code-color"
                type="color"
                className="input"
                value={newColor}
                onChange={(e) => setNewColor(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="code-desc">Descripción</label>
              <input
                id="code-desc"
                className="input"
                value={newDesc}
                placeholder="Opcional"
                onChange={(e) => setNewDesc(e.target.value)}
              />
            </div>
            <button type="button" className="btn btn-primary" onClick={() => void handleCreate()}>
              Crear
            </button>
          </div>
        </div>
      )}

      {tree === null ? (
        <div className="empty">
          <span className="empty-icon" aria-hidden="true">
            ⏳
          </span>
          <h3>Cargando códigos…</h3>
        </div>
      ) : tree.length === 0 ? (
        <div className="empty">
          <span className="empty-icon" aria-hidden="true">
            🌱
          </span>
          <h3>Aún no hay códigos</h3>
          <p>Crea tu primer código para empezar a organizar tus categorías de análisis.</p>
        </div>
      ) : (
        <div className="card">
          <ul className="tree">
            {tree.map((node) => (
              <CodeNode
                key={node.id}
                node={node}
                flat={flat ?? []}
                onUpdate={handleUpdate}
                onMove={handleMove}
                onRemove={handleRemove}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

interface CodeNodeProps {
  node: CodeTreeNode;
  flat: Code[];
  onUpdate: (id: string, patch: { name?: string; color?: string; description?: string }) => Promise<void>;
  onMove: (id: string, parentId: string) => Promise<void>;
  onRemove: (id: string, name: string) => Promise<void>;
}

function CodeNode({ node, flat, onUpdate, onMove, onRemove }: CodeNodeProps) {
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(node.name);
  const [editColor, setEditColor] = useState(node.color ?? '#4f8cff');
  const [editDesc, setEditDesc] = useState(node.description ?? '');

  const moveOptions = flat.filter((c) => c.id !== node.id);

  const saveEdit = async () => {
    const name = editName.trim();
    if (!name) return;
    await onUpdate(node.id, { name, color: editColor || undefined, description: editDesc.trim() || undefined });
    setEditing(false);
  };

  return (
    <li>
      <div className="tree-node">
        <button
          type="button"
          className="tree-toggle"
          aria-label={expanded ? 'Contraer' : 'Expandir'}
          onClick={() => setExpanded((v) => !v)}
        >
          {node.children.length > 0 ? (expanded ? '▾' : '▸') : '·'}
        </button>

        {editing ? (
          <div className="tree-name" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <input
              className="input"
              style={{ flex: 1, minWidth: 140 }}
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              autoFocus
            />
            <input
              type="color"
              className="input"
              style={{ width: 40, height: 32, padding: 1 }}
              value={editColor}
              onChange={(e) => setEditColor(e.target.value)}
              title="Color"
            />
            <input
              className="input"
              style={{ flex: 1, minWidth: 160 }}
              value={editDesc}
              placeholder="Descripción"
              onChange={(e) => setEditDesc(e.target.value)}
            />
            <button type="button" className="btn btn-sm btn-primary" onClick={() => void saveEdit()}>
              Guardar
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing(false)}>
              Cancelar
            </button>
          </div>
        ) : (
          <>
            <span className="dot" style={{ background: node.color ?? '#66779a' }} title={node.path} />
            <span className="tree-name" title={node.path}>
              {node.name}
            </span>
            <span className="tree-actions">
              <select
                className="select"
                style={{ fontSize: 12, padding: '3px 6px', maxWidth: 150 }}
                value={node.parentId ?? ''}
                onChange={(e) => void onMove(node.id, e.target.value)}
                title="Mover a otro código padre"
              >
                <option value="">(Raíz)</option>
                {moveOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button type="button" className="icon-btn" title="Editar" onClick={() => setEditing(true)}>
                ✏️
              </button>
              <button
                type="button"
                className="icon-btn danger"
                title="Eliminar"
                onClick={() => void onRemove(node.id, node.name)}
              >
                🗑️
              </button>
            </span>
          </>
        )}
      </div>

      {expanded && node.children.length > 0 && (
        <ul>
          {node.children.map((child) => (
            <CodeNode
              key={child.id}
              node={child}
              flat={flat}
              onUpdate={onUpdate}
              onMove={onMove}
              onRemove={onRemove}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
