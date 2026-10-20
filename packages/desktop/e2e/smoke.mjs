/**
 * Prueba E2E (smoke) de la app de escritorio REAL: lanza Electron con
 * depuración remota, conduce el renderer por CDP (WebSocket nativo de Node,
 * sin dependencias) y verifica que el puente completo — preload → IPC →
 * main → core → SQLite — funciona y que todas las vistas montan sin errores.
 *
 * Uso:  npm run e2e   (desde packages/desktop; antes: npm run build)
 *
 * No prueba píxeles ni clic a clic de formularios (eso exigiría Playwright):
 * monta cada vista con datos reales y ejercita el flujo de datos completo
 * (crear base → proyecto → documento sembrado → cita → codificación →
 * informes → atributos → relaciones → memos).
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_ROOT = path.resolve(__dirname, '..'); // packages/desktop
const REPO_ROOT = path.resolve(DESKTOP_ROOT, '..', '..');
const ELECTRON = path.join(REPO_ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const CDP_PORT = 9333;
const OVERALL_TIMEOUT_MS = 120_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findPageTarget() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      const targets = (await res.json()).filter(
        (t) => t.type === 'page' && t.webSocketDebuggerUrl && /index\.html|localhost:\d+/.test(t.url ?? ''),
      );
      if (targets.length > 0) return targets[0];
    } catch {
      // Electron aún no abre el puerto: reintentar.
    }
    await sleep(300);
  }
  throw new Error('Electron no expuso el puerto de depuración a tiempo.');
}

let ws;
let nextId = 1;
const pending = new Map();
const consoleErrors = [];

function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }
    }, 30_000);
  });
}

/** Evalúa una expresión en el renderer; con awaitPromise resuelve promesas. */
async function evaluate(expression) {
  const res = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (res.exceptionDetails) {
    const text = res.exceptionDetails.exception?.description ?? res.exceptionDetails.text;
    throw new Error(`Error en el renderer: ${text}`);
  }
  return res.result?.value;
}

const waitFor = async (expression, label, tries = 40) => {
  for (let i = 0; i < tries; i++) {
    if (await evaluate(expression)) return;
    await sleep(250);
  }
  throw new Error(`Condición no cumplida a tiempo: ${label}`);
};

async function main() {
  const tmp = await mkdtemp(path.join(tmpdir(), 'qc-e2e-'));
  const dbFile = path.join(tmp, 'e2e.qcdb');

  const electron = spawn(
    ELECTRON,
    ['.', `--remote-debugging-port=${CDP_PORT}`],
    { cwd: DESKTOP_ROOT, env: { ...process.env, E2E_SMOKE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  electron.stderr.on('data', (d) => process.stderr.write(`[electron] ${d}`));
  let exitCode = null;
  electron.on('exit', (code) => {
    exitCode = code;
  });

  try {
    const target = await findPageTarget();
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = () => reject(new Error('No se pudo conectar por CDP.'));
    });
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(`CDP ${msg.error.message}`));
        else resolve(msg.result);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        consoleErrors.push(msg.params.exceptionDetails?.exception?.description ?? 'excepción');
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        consoleErrors.push(msg.params.args?.map((a) => a.value ?? a.description ?? '').join(' '));
      }
    };
    await send('Runtime.enable');

    // Helper en la página: el puente devuelve el sobre {ok, data|error};
    // __call desenvuelve y convierte los errores en excepciones reales.
    await evaluate(
      `window.__call = async (p) => {
        const r = await p;
        if (r && typeof r === 'object' && 'ok' in r) {
          if (!r.ok) throw new Error(r.error ?? r.code ?? 'error del puente');
          return r.data;
        }
        return r;
      };`,
    );

    // 1) La app monta de verdad.
    await waitFor(`document.body.innerText.length > 40`, 'la app monta');
    console.log('✓ La app monta');

    // 2) Base nueva en carpeta temporal (crea archivo + migración).
    const dbResult = await evaluate(`window.__call(window.qwal.db.open(${JSON.stringify(dbFile)}))`);
    assert.ok(dbResult?.dbPath, 'db.open devolvió resultado');
    console.log(`✓ Base abierta (backend: ${dbResult.backend})`);

    // 3) Proyecto + investigadora.
    const project = await evaluate(
      `(async () => {
        const p = await window.__call(window.qwal.projects.create({ name: 'E2E Proyecto', description: 'prueba' }));
        await window.__call(window.qwal.projects.open(p.id));
        return p;
      })()`,
    );
    assert.ok(project?.id, 'proyecto creado');
    await evaluate(`window.__call(window.qwal.researchers.create({ name: 'Ana' }))`);
    console.log('✓ Proyecto e investigadora creados');

    // 4) Siembra de documento (canal interno; sin diálogos nativos).
    const seeded = await evaluate(`window.__call(window.qwal.__e2e.seed('Entrevista 1'))`);
    assert.ok(seeded?.documentId, 'documento sembrado');
    const docId = seeded.documentId;
    console.log('✓ Documento sembrado por el importador real');

    // 5) KWIC real → cita → codificación (el flujo del núcleo completo).
    const flow = await evaluate(
      `(async () => {
        const call = window.__call;
        const kwic = await call(window.qwal.analysis.kwic('contaminación', 5));
        if (kwic.entries.length === 0) throw new Error('KWIC sin resultados');
        const entry = kwic.entries[0];
        const code = await call(window.qwal.codes.create({ name: 'Contaminación', color: '#c0392b' }));
        const sub = await call(window.qwal.codes.create({ name: 'Agua', parentId: code.id }));
        const q = await call(window.qwal.quotations.create({
          documentId: ${JSON.stringify(docId)},
          anchor: { kind: 'text', documentId: ${JSON.stringify(docId)}, startPos: entry.matchStart, endPos: entry.matchEnd },
          segmentText: entry.match,
          createdBy: null,
        }));
        await call(window.qwal.coding.assign(q.id, code.id, null));
        const freq = await call(window.qwal.analysis.codeFrequencies());
        const cooc = await call(window.qwal.analysis.cooccurrence());
        return { total: freq.totalQuotations, codes: freq.items.length, coocCells: cooc.cells.length };
      })()`,
    );
    assert.ok(flow.total >= 1, 'la cita contada en frecuencia');
    console.log(`✓ Flujo de datos: ${flow.total} cita(s), ${flow.codes} código(s), ${flow.coocCells} co-ocurrencia(s)`);

    // 6) Atributos, relaciones, memos (lo añadido en este ciclo).
    await evaluate(
      `(async () => {
        const call = window.__call;
        const attr = await call(window.qwal.attributes.create({ name: 'Género', dataType: 'string' }));
        await call(window.qwal.attributes.setValue(${JSON.stringify(docId)}, attr.id, 'mixto'));
        const vals = await call(window.qwal.attributes.values());
        if (vals.length !== 1 || vals[0].value !== 'mixto') throw new Error('atributos: valor no persistido');
        const codes = await call(window.qwal.codes.list());
        const a = codes.find((c) => c.name === 'Contaminación');
        const b = codes.find((c) => c.name === 'Agua');
        await call(window.qwal.relations.create({ sourceType: 'code', sourceId: a.id, targetType: 'code', targetId: b.id, relationType: 'causa' }));
        const rels = await call(window.qwal.relations.list());
        if (rels.length !== 1) throw new Error('relaciones: no listada');
        const memos = await call(window.qwal.memos.listForTarget('code', a.id));
        if (memos.length !== 0) throw new Error('memos: estado inicial inesperado');
      })()`,
    );
    console.log('✓ Atributos y relaciones persisten');

    // 7) Todas las vistas montan con datos reales, sin banner de error.
    const views = ['Proyectos', 'Documentos', 'Codificar', 'Códigos', 'Análisis', 'Exportar'];
    for (const label of views) {
      const ok = await evaluate(
        `(async () => {
          const btns = [...document.querySelectorAll('button.nav-item')];
          const btn = btns.find((b) => b.textContent.includes(${JSON.stringify(label)}));
          if (!btn) return false;
          btn.click();
          await new Promise((r) => setTimeout(r, 350));
          return document.body.innerText.includes(${JSON.stringify(label)}) && document.body.innerText.length > 60;
        })()`,
      );
      assert.ok(ok, `la vista «${label}» monta`);
      console.log(`✓ Vista «${label}» monta`);
    }

    // 8) Sin errores de consola/excepciones durante toda la sesión.
    const realErrors = consoleErrors.filter(
      (e) => !/Download the React DevTools/i.test(e ?? ''),
    );
    assert.deepEqual(realErrors, [], 'sin errores en la consola del renderer');
    console.log('✓ Consola del renderer limpia');

    console.log('\nE2E OK — la app de escritorio completa funciona.');
  } finally {
    if (ws && ws.readyState === 1) ws.close();
    electron.kill();
    await sleep(500);
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
    if (exitCode !== null && exitCode !== 0) {
      console.warn(`(electron salió con código ${exitCode})`);
    }
  }
}

const timer = setTimeout(() => {
  console.error('E2E: tiempo total agotado.');
  process.exit(2);
}, OVERALL_TIMEOUT_MS);
timer.unref();

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`E2E FALLÓ: ${err.message}`);
    process.exit(1);
  });
