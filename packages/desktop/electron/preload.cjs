// Preload CJS (a mano, a propósito: Electron carga preloads CJS con sandbox).
// Expone la API tipada (ver shared/ipc.ts) vía contextBridge.
//
// Cada canal listado aquí DEBE existir en `registerIpc()` de electron/main.ts.
// Este archivo no está cubierto por tsc, así que es el único punto del puente
// donde un desajuste no lo detecta el compilador: añadir un canal obliga a
// tocar las tres piezas (shared/ipc.ts, main.ts, aquí).
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('qwal', {
  db: {
    open: invoke('db:open'),
    create: invoke('db:create'),
    flush: invoke('db:flush'),
  },
  projects: {
    list: invoke('projects:list'),
    create: invoke('projects:create'),
    open: invoke('projects:open'),
    remove: invoke('projects:remove'),
  },
  documents: {
    list: invoke('documents:list'),
    pickAndImport: invoke('documents:pickAndImport'),
    get: invoke('documents:get'),
    updateRawText: invoke('documents:updateRawText'),
    remove: invoke('documents:remove'),
    createText: invoke('documents:createText'),
  },
  codes: {
    list: invoke('codes:list'),
    tree: invoke('codes:tree'),
    listFamilies: invoke('codes:listFamilies'),
    create: invoke('codes:create'),
    update: invoke('codes:update'),
    move: invoke('codes:move'),
    remove: invoke('codes:remove'),
  },
  researchers: {
    list: invoke('researchers:list'),
    create: invoke('researchers:create'),
  },
  quotations: {
    listByDocument: invoke('quotations:listByDocument'),
    listByCode: invoke('quotations:listByCode'),
    create: invoke('quotations:create'),
    remove: invoke('quotations:remove'),
    codes: invoke('quotations:codes'),
  },
  coding: {
    assign: invoke('coding:assign'),
    unassign: invoke('coding:unassign'),
    setCodes: invoke('coding:setCodes'),
    density: invoke('coding:density'),
  },
  memos: {
    listForTarget: invoke('memos:listForTarget'),
    create: invoke('memos:create'),
  },
  relations: {
    listForEntity: invoke('relations:listForEntity'),
    list: invoke('relations:list'),
    create: invoke('relations:create'),
    remove: invoke('relations:remove'),
  },
  attributes: {
    list: invoke('attributes:list'),
    create: invoke('attributes:create'),
    setValue: invoke('attributes:setValue'),
    remove: invoke('attributes:remove'),
    values: invoke('attributes:values'),
  },
  search: {
    query: invoke('search:query'),
  },
  media: {
    transcribe: invoke('media:transcribe'),
  },
  // Prueba E2E: sólo responde cuando la app corre con E2E_SMOKE=1; en
  // producción el canal no tiene handler y falla con "No handler registered".
  __e2e: {
    seed: invoke('__e2e:seed'),
  },
  analysis: {
    codeFrequencies: invoke('analysis:codeFrequencies'),
    cooccurrence: invoke('analysis:cooccurrence'),
    documentCodeMatrix: invoke('analysis:documentCodeMatrix'),
    wordFrequencies: invoke('analysis:wordFrequencies'),
    interRater: invoke('analysis:interRater'),
    frameworkMatrix: invoke('analysis:frameworkMatrix'),
    jaccard: invoke('analysis:jaccard'),
    kwic: invoke('analysis:kwic'),
    fleissKappa: invoke('analysis:fleissKappa'),
    krippendorffAlpha: invoke('analysis:krippendorffAlpha'),
  },
});