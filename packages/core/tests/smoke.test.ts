/**
 * Smoke tests del núcleo QualiCanvas.
 *
 * Validan el ciclo de vida básico de la librería contra la API pública
 * (src/index.ts): abrir driver, migrar esquema, crear proyecto, cargar
 * sesión y comprobar que repositorios y servicios quedan operativos.
 *
 * Nota: `openDriver()` es async en el backend sqljs; con el backend node
 * por defecto devuelve el driver síncrono, pero siempre se usa `await`
 * para que el mismo test sirva para ambos backends.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  openDriver,
  migrate,
  getUserVersion,
  ProjectRepository,
  Session,
  newId,
  nowIso,
} from '../src/index.js';

import type { DbDriver } from '../src/index.js';

describe('smoke: ciclo de vida del núcleo', () => {
  let driver: DbDriver;

  beforeEach(async () => {
    // Base efímera en memoria, esquema migrado
    driver = (await openDriver({ backend: 'node', filename: ':memory:' })) as DbDriver;
    migrate(driver);
  });

  afterEach(() => {
    driver.close();
  });

  it('abre el driver y aplica la migración', () => {
    expect(driver.isOpen).toBe(true);
    expect(getUserVersion(driver)).toBeGreaterThanOrEqual(1);
  });

  it('crea un proyecto y lo recupera por id', () => {
    const projects = new ProjectRepository(driver);
    const created = projects.create({ name: `Proyecto smoke ${newId()}` });

    expect(created.id).toBeTruthy();
    expect(created.createdAt).toBeTruthy();

    const fetched = projects.get(created.id);
    expect(fetched).toBeDefined();
    expect(fetched?.id).toBe(created.id);
    expect(fetched?.name).toBe(created.name);
  });

  it('lanza error al crear un proyecto con nombre duplicado', () => {
    const projects = new ProjectRepository(driver);
    projects.create({ name: 'Duplicado' });

    expect(() => projects.create({ name: 'Duplicado' })).toThrow(
      /Ya existe un proyecto con ese nombre/,
    );
  });

  it('carga una sesión con repositorios y servicios operativos', () => {
    const projects = new ProjectRepository(driver);
    const project = projects.create({ name: 'Sesión smoke' });

    const session = new Session(driver, project.id);
    session.load();

    // Repositorios instanciados
    expect(session.documents).toBeDefined();
    expect(session.codes).toBeDefined();
    expect(session.quotations).toBeDefined();
    expect(session.researchers).toBeDefined();

    // Servicios instanciados
    expect(session.analysis).toBeDefined();
    expect(session.search).toBeDefined();
    expect(session.audit).toBeDefined();
    expect(session.coding).toBeDefined();

    // Proyecto cargado correctamente
    expect(session.project?.id).toBe(project.id);
    expect(session.project?.name).toBe('Sesión smoke');
  });

  it('lanza error al cargar una sesión de un proyecto inexistente', () => {
    const session = new Session(driver, 'no-existe');
    expect(() => session.load()).toThrow(/Proyecto no encontrado/);
  });

  it('genera identificadores y timestamps ISO válidos', () => {
    expect(newId()).toBeTruthy();
    const iso = nowIso();
    expect(new Date(iso).toISOString()).toBe(iso);
  });

  it('importText devuelve el documentId real, no un uuid huérfano', async () => {
    const projects = new ProjectRepository(driver);
    const project = projects.create({ name: 'Import smoke' });
    const session = new Session(driver, project.id);
    session.load();

    const importer = await session.importer;
    const result = await importer.importText(project.id, 'Entrevista', 'Texto de prueba');

    const stored = session.documents.get(result.documentId);
    expect(stored).toBeDefined();
    expect(stored?.title).toBe('Entrevista');
  });
});
