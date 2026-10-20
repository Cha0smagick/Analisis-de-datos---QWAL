import { useCallback, useRef, useState } from 'react';
import type { Quotation, SourceDocument } from '../api';
import { qwal } from '../api';
import { useApp } from '../App';
import { formatDateTime } from '../utils';

/**
 * Exportación del análisis — lo que convierte el trabajo en un entregable.
 * Todo se genera en el cliente a partir de los repositorios del núcleo:
 * sin formatos propietarios, sin salida a la nube, sin servidor extra.
 */

function download(fileName: string, mime: string, content: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function csvCell(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function safeFileName(base: string): string {
  return base.replace(/[^\w.\-]+/g, '-').slice(0, 80) || 'qualicanvas';
}

/** Estructura del JSON completo: la base de análisis entera, sin dependencias. */
async function collectProject(projectId: string) {
  const [documents, codes, researchers, projectMemos, attributes, attributeValues] = await Promise.all([
    qwal.documents.list(),
    qwal.codes.list(),
    qwal.researchers.list(),
    qwal.memos.listForTarget('project', projectId),
    qwal.attributes.list(),
    qwal.attributes.values(),
  ]);
  const documentQuotations = await Promise.all(
    documents.map(async (d: SourceDocument) => {
      const quotes = await qwal.quotations.listByDocument(d.id);
      const enriched = await Promise.all(
        quotes.map(async (q: Quotation) => ({
          ...q,
          codes: await qwal.quotations.codes(q.id),
          memos: await qwal.memos.listForTarget('quotation', q.id),
        })),
      );
      const docMemos = await qwal.memos.listForTarget('document', d.id);
      return { document: d, quotations: enriched, memos: docMemos };
    }),
  );
  const codeMemos = await Promise.all(
    codes.map(async (c) => ({ codeId: c.id, memos: await qwal.memos.listForTarget('code', c.id) })),
  );
  const relations = await qwal.relations.list();
  return {
    exportedAt: new Date().toISOString(),
    format: 'qualicanvas-project/1',
    projectId,
    researchers,
    attributes,
    attributeValues,
    codes,
    codeMemos,
    relations,
    documents: documentQuotations,
    projectMemos,
  };
}

/** Forma del JSON exportado, para la importación (traslado entre máquinas). */
interface ProjectExport {
  format: string;
  exportedAt: string;
  researchers: { id: string; name: string }[];
  attributes: { id: string; name: string; dataType: 'string' | 'number' | 'boolean' | 'date' }[];
  attributeValues: { documentId: string; attributeId: string; value: string | null }[];
  codes: { id: string; name: string; parentId?: string | null; color?: string | null; description?: string }[];
  codeMemos: { codeId: string; memos: MemosExport }[];
  relations: {
    source: { type: string; id: string };
    target: { type: string; id: string };
    relationType: string;
    label: string | null;
  }[];
  documents: {
    document: SourceDocument;
    quotations: (Quotation & { codes: { codeId: string; researcherId: string | null }[]; memos: MemosExport })[];
    memos: MemosExport;
  }[];
  projectMemos: MemosExport;
}

type MemosExport = { title: string; content: string; authorId: string | null }[];

/** Profundidad de un código en el árbol: para crear padres antes que hijos. */
function codeDepth(c: { parentId?: string | null }, byId: Map<string, { parentId?: string | null }>): number {
  let depth = 0;
  let parent = c.parentId ?? null;
  while (parent) {
    depth++;
    parent = byId.get(parent)?.parentId ?? null;
    if (depth > 100) break; // ciclo imposible por UNIQUE, pero no cuelgues la UI
  }
  return depth;
}

/** Memos del respaldo → qwal.memos.create, re-mapeando el autor al nuevo id. */
async function importMemos(
  memos: MemosExport,
  targetType: 'project' | 'document' | 'code' | 'quotation',
  targetId: string,
  researcherMap: Map<string, string>,
): Promise<void> {
  for (const m of memos ?? []) {
    await qwal.memos.create({
      targetType,
      targetId,
      title: m.title,
      body: m.content,
      createdBy: m.authorId ? researcherMap.get(m.authorId) ?? null : null,
    });
  }
}

export default function ExportView() {
  const { activeProject, setView, notice, setActiveProject } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const base = activeProject ? safeFileName(activeProject.name) : 'qualicanvas';

  const exportCsv = useCallback(async () => {
    if (!activeProject) return;
    setBusy('csv');
    try {
      const [docs, codes] = await Promise.all([qwal.documents.list(), qwal.codes.list()]);
      const codeName = new Map(codes.map((c) => [c.id, c.name]));
      const rows: string[] = [
        ['documento', 'inicio', 'fin', 'cita', 'codigos', 'investigadora', 'creada'].map(csvCell).join(','),
      ];
      for (const d of docs) {
        const quotes = await qwal.quotations.listByDocument(d.id);
        for (const q of quotes) {
          const attributions = await qwal.quotations.codes(q.id);
          const names = attributions
            .map((a) => codeName.get(a.codeId) ?? a.codeId)
            .sort()
            .join('; ');
          const start = q.anchor.kind === 'text' ? q.anchor.startPos : '';
          const end = q.anchor.kind === 'text' ? q.anchor.endPos : '';
          rows.push(
            [d.title, start, end, q.segmentText, names, q.createdBy ?? '', formatDateTime(q.createdAt)]
              .map(csvCell)
              .join(','),
          );
        }
      }
      // BOM: sin él, Excel abre el CSV como ANSI y destroza los acentos.
      download(`${base}-citas.csv`, 'text/csv;charset=utf-8', `\uFEFF${rows.join('\r\n')}`);
      notice('ok', 'CSV de citas exportado');
    } catch (e) {
      notice('error', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [activeProject, base, notice]);

  const exportJson = useCallback(async () => {
    if (!activeProject) return;
    setBusy('json');
    try {
      const data = await collectProject(activeProject.id);
      download(`${base}-proyecto.json`, 'application/json', JSON.stringify(data, null, 2));
      notice('ok', 'JSON completo exportado');
    } catch (e) {
      notice('error', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [activeProject, base, notice]);

  const exportMarkdown = useCallback(async () => {
    if (!activeProject) return;
    setBusy('md');
    try {
      const [freq, cooc, fleiss, alpha, interRater] = await Promise.all([
        qwal.analysis.codeFrequencies(),
        qwal.analysis.cooccurrence(),
        qwal.analysis.fleissKappa(),
        qwal.analysis.krippendorffAlpha(),
        qwal.analysis.interRater(),
      ]);
      const lines: string[] = [
        `# Informe de análisis — ${activeProject.name}`,
        '',
        `Generado: ${new Date().toLocaleString()}`,
        activeProject.description ? `\n> ${activeProject.description}` : '',
        '',
        '## Frecuencia de códigos',
        '',
        `Total: ${freq.totalQuotations} cita(s) en ${freq.totalDocuments} documento(s).`,
        '',
        '| Código | Citas (con descendientes) | Documentos |',
        '|---|---|---|',
        ...freq.items.map(
          (i) => `| ${i.code.path || i.code.name} | ${i.quotationsWithDescendants} | ${i.documentsWithDescendants} |`,
        ),
        '',
        '## Co-ocurrencias principales',
        '',
      ];
      const topCooc = cooc.cells.slice(0, 15);
      if (topCooc.length === 0) lines.push('_Sin co-ocurrencias._');
      else {
        lines.push('| Código A | Código B | Citas |', '|---|---|---|');
        for (const c of topCooc) lines.push(`| ${c.codeA} | ${c.codeB} | ${c.count} |`);
      }
      lines.push(
        '',
        '## Fiabilidad inter-codificador',
        '',
        `- Fleiss κ: ${fleiss.kappa === null ? '—' : fleiss.kappa.toFixed(3)} (${fleiss.subjects} citas, ${fleiss.raters} codificadores)`,
        `- Krippendorff α: ${alpha.alpha === null ? '—' : alpha.alpha.toFixed(3)}`,
      );
      for (const pair of interRater.pairs) {
        lines.push(
          '',
          `### ${pair.researcherA} vs ${pair.researcherB}`,
          '',
          `Acuerdo de decisiones: ${(pair.codingAgreement * 100).toFixed(1)}% · κ medio: ${pair.meanKappa === null ? '—' : pair.meanKappa.toFixed(3)}`,
          '',
          '| Código | Compartidas | κ |',
          '|---|---|---|',
          ...pair.codes.map(
            (c) => `| ${c.codeName} | ${c.shared} | ${c.kappa === null ? '—' : c.kappa.toFixed(3)} |`,
          ),
        );
      }
      download(`${base}-informe.md`, 'text/markdown;charset=utf-8', lines.join('\n'));
      notice('ok', 'Informe Markdown exportado');
    } catch (e) {
      notice('error', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [activeProject, base, notice]);

  /**
   * Importar un respaldo JSON a un proyecto NUEVO: es el traslado seguro
   * entre máquinas (nunca copies el .db por una carpeta de red: SQLite sobre
   * SMB se corrompe). Sólo viajan documentos de texto; los multimedia se
   * omiten porque sus archivos no viven dentro del JSON.
   */
  const importJson = useCallback(
    async (file: File) => {
      setImporting(true);
      try {
        const data = JSON.parse(await file.text()) as ProjectExport;
        if (data?.format !== 'qualicanvas-project/1') {
          throw new Error('El archivo no es un respaldo de QualiCanvas (falta «qualicanvas-project/1»).');
        }
        // 1) Proyecto nuevo y activo: todo lo que sigue cae en él.
        const project = await qwal.projects.create({
          name: `${file.name.replace(/\.json$/i, '')} (importado)`,
          description: data.exportedAt
            ? `Importado de un respaldo JSON del ${new Date(data.exportedAt).toLocaleString()}.`
            : 'Importado de un respaldo JSON.',
        });
        await qwal.projects.open(project.id);
        setActiveProject(project);
        // 2) Investigadoras: las citas guardan nombre, la codificación id.
        const researcherMap = new Map<string, string>();
        for (const r of data.researchers ?? []) {
          const created = await qwal.researchers.create({ name: r.name });
          researcherMap.set(r.id, created.id);
        }
        // 3) Códigos, padres primero.
        const byId = new Map((data.codes ?? []).map((c) => [c.id, c] as const));
        const codeMap = new Map<string, string>();
        for (const c of [...(data.codes ?? [])].sort((a, b) => codeDepth(a, byId) - codeDepth(b, byId))) {
          const created = await qwal.codes.create({
            name: c.name,
            parentId: c.parentId ? codeMap.get(c.parentId) : undefined,
            color: c.color ?? undefined,
            description: c.description ?? undefined,
          });
          codeMap.set(c.id, created.id);
        }
        // 4) Atributos.
        const attrMap = new Map<string, string>();
        for (const a of data.attributes ?? []) {
          const created = await qwal.attributes.create({ name: a.name, dataType: a.dataType });
          attrMap.set(a.id, created.id);
        }
        // 5) Documentos de texto + valores + citas + codificación + memos.
        const docMap = new Map<string, string>();
        let mediaSkipped = 0;
        let quoteCount = 0;
        for (const entry of data.documents ?? []) {
          const doc = entry.document;
          if (!doc.rawText || doc.rawText.trim() === '') {
            mediaSkipped++;
            continue;
          }
          const result = await qwal.documents.createText({
            title: doc.title,
            text: doc.rawText,
            language: doc.language ?? undefined,
          });
          docMap.set(doc.id, result.documentId);
          for (const v of data.attributeValues ?? []) {
            if (v.documentId === doc.id && v.value !== null) {
              const attrId = attrMap.get(v.attributeId);
              if (attrId) await qwal.attributes.setValue(result.documentId, attrId, v.value);
            }
          }
          for (const q of entry.quotations ?? []) {
            if (q.anchor.kind !== 'text') continue;
            try {
              const created = await qwal.quotations.create({
                documentId: result.documentId,
                anchor: {
                  kind: 'text',
                  documentId: result.documentId,
                  startPos: q.anchor.startPos,
                  endPos: q.anchor.endPos,
                },
                segmentText: q.segmentText,
                createdBy: q.createdBy ?? null,
              });
              quoteCount++;
              for (const att of q.codes ?? []) {
                const codeId = codeMap.get(att.codeId);
                if (codeId) {
                  await qwal.coding.assign(
                    created.id,
                    codeId,
                    att.researcherId ? researcherMap.get(att.researcherId) ?? null : null,
                  );
                }
              }
              await importMemos(q.memos ?? [], 'quotation', created.id, researcherMap);
            } catch {
              // Cita duplicada o incompatible: se salta, no detiene la importación.
            }
          }
          await importMemos(entry.memos ?? [], 'document', result.documentId, researcherMap);
        }
        // 6) Memos de códigos y proyecto, y relaciones entre códigos.
        for (const cm of data.codeMemos ?? []) {
          const codeId = codeMap.get(cm.codeId);
          if (codeId) await importMemos(cm.memos ?? [], 'code', codeId, researcherMap);
        }
        await importMemos(data.projectMemos ?? [], 'project', project.id, researcherMap);
        let relCount = 0;
        for (const r of data.relations ?? []) {
          if (r.source.type !== 'code' || r.target.type !== 'code') continue;
          const sId = codeMap.get(r.source.id);
          const tId = codeMap.get(r.target.id);
          if (sId && tId) {
            await qwal.relations.create({
              sourceType: 'code',
              sourceId: sId,
              targetType: 'code',
              targetId: tId,
              relationType: r.relationType,
              label: r.label ?? null,
            });
            relCount++;
          }
        }
        notice(
          'ok',
          `Proyecto importado: ${docMap.size} documento(s), ${quoteCount} cita(s), ${relCount} relación(es)` +
            (mediaSkipped ? ` — ${mediaSkipped} documento(s) multimedia omitidos: vuelve a importar sus archivos` : ''),
        );
        setView('proyectos');
      } catch (e) {
        notice('error', e instanceof Error ? e.message : String(e));
      } finally {
        setImporting(false);
      }
    },
    [notice, setActiveProject, setView],
  );

  if (!activeProject) {
    return (
      <div className="view">
        <div className="empty">
          <span className="empty-icon" aria-hidden="true">📤</span>
          <h3>Sin proyecto activo</h3>
          <p>Selecciona o crea un proyecto para exportar su análisis.</p>
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
          <h1>Exportar</h1>
          <p>Lleva el análisis a tu tesis: formatos abiertos, sin registro ni nube.</p>
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          <h3>Citas codificadas (CSV)</h3>
          <button type="button" className="btn btn-primary" disabled={busy === 'csv'} onClick={() => void exportCsv()}>
            {busy === 'csv' ? 'Exportando…' : '⬇ Descargar CSV'}
          </button>
        </div>
        <p style={{ color: 'var(--text-dim)', fontSize: 13, margin: 0 }}>
          Una fila por cita: documento, posición, texto, códigos asignados, investigadora y fecha.
          Abre directamente en Excel, R o Python.
        </p>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-title">
          <h3>Proyecto completo (JSON)</h3>
          <button type="button" className="btn btn-primary" disabled={busy === 'json'} onClick={() => void exportJson()}>
            {busy === 'json' ? 'Exportando…' : '⬇ Descargar JSON'}
          </button>
        </div>
        <p style={{ color: 'var(--text-dim)', fontSize: 13, margin: 0 }}>
          Copia íntegra y legible por máquina: documentos, códigos, citas con sus códigos y memos,
          investigadoras. Para respaldo, auditoría o reproducibilidad.
        </p>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-title">
          <h3>Informe de análisis (Markdown)</h3>
          <button type="button" className="btn btn-primary" disabled={busy === 'md'} onClick={() => void exportMarkdown()}>
            {busy === 'md' ? 'Exportando…' : '⬇ Descargar informe'}
          </button>
        </div>
        <p style={{ color: 'var(--text-dim)', fontSize: 13, margin: 0 }}>
          Resumen listo para anexar: frecuencia de códigos, co-ocurrencias principales e índices de
          fiabilidad (Cohen κ por par, Fleiss κ, Krippendorff α).
        </p>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-title">
          <h3>Importar proyecto (JSON)</h3>
          <button
            type="button"
            className="btn btn-primary"
            disabled={importing}
            onClick={() => fileRef.current?.click()}
          >
            {importing ? 'Importando…' : '⬆ Importar respaldo'}
          </button>
        </div>
        <p style={{ color: 'var(--text-dim)', fontSize: 13, margin: 0 }}>
          Crea un proyecto nuevo a partir de un respaldo JSON: la forma segura de llevar el trabajo a otra
          máquina o compartirlo con el equipo (nunca copie el archivo .db por una carpeta de red: SQLite se
          corrompe). Los documentos multimedia no viajan en el JSON: vuelva a importar sus archivos y reancla
          las citas de tiempo.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void importJson(file);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
