/**
 * Tests del servicio de búsqueda (SearchServiceImpl) con FTS5:
 * normalización de consultas, operador NEAR, shape de SearchHit,
 * orden por score y paginación.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  openDriver,
  migrate,
  ProjectRepository,
  DocumentRepository,
  newId,
} from '../src/index.js';

import { SearchServiceImpl } from '../src/services/search.service.js';

import type { DbDriver, Project, SourceDocument, SearchHit } from '../src/index.js';

describe('search: servicio de búsqueda FTS5', () => {
  let driver: DbDriver;
  let project: Project;
  let service: SearchServiceImpl;

  beforeEach(async () => {
    driver = (await openDriver({ backend: 'node', filename: ':memory:' })) as DbDriver;
    migrate(driver);

    project = new ProjectRepository(driver).create({ name: `Proyecto búsqueda ${newId()}` });

    service = new SearchServiceImpl({ driver });
  });

  afterEach(() => {
    driver.close();
  });

  function createDoc(title: string, rawText: string): SourceDocument {
    return new DocumentRepository(driver).create(project.id, {
      title,
      fileType: 'txt',
      rawText,
    });
  }

  it('devuelve coincidencias con la forma SearchHit y orden por score', async () => {
    createDoc('Doc simple', 'el gato duerme en el sofá');
    createDoc('Doc doble', 'el gato y el perro juegan en el parque');

    const hits: SearchHit[] = await service.search(project.id, 'gato');

    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      expect(hit.documentId).toEqual(expect.any(String));
      expect(hit.title).toEqual(expect.any(String));
      expect(typeof hit.score).toBe('number');
    }
    // Debe venir primero el documento con más coincidencias (mejor bm25 negativo)
    const sorted = [...hits].sort((a, b) => b.score - a.score);
    expect(hits.map((h) => h.documentId)).toEqual(sorted.map((h) => h.documentId));
  });

  it('respeta limit y offset', async () => {
    createDoc('A', 'alpha común beta');
    createDoc('B', 'alpha común gamma');
    createDoc('C', 'alpha común delta');

    const page = await service.search(project.id, 'común', { limit: 2, offset: 0 });
    expect(page).toHaveLength(2);

    const next = await service.search(project.id, 'común', { limit: 2, offset: 2 });
    expect(next).toHaveLength(1);
  });

  it('soporta frases entre comillas dobles', async () => {
    createDoc('Doc frase', 'un perro grande y negro');
    createDoc('Doc suelto', 'perro y grande');

    const hits: SearchHit[] = await service.search(project.id, '"perro grande"');

    // La frase exacta solo existe en el primer documento
    expect(hits.some((h) => h.title === 'Doc frase')).toBe(true);
  });

  it('devuelve lista vacía para consultas vacías o de solo espacios', async () => {
    createDoc('Doc', 'contenido cualquiera');

    expect(await service.search(project.id, '')).toEqual([]);
    expect(await service.search(project.id, '   ')).toEqual([]);
  });

  describe('operador NEAR', () => {
    it('encuentra términos cercanos con NEAR/n', async () => {
      // La ventana `near` es la distancia máxima entre la primera y la última
      // palabra del grupo. Aquí "alpha" está en la posición 0 y "epsilon" en la
      // 4: la separación es de 4 tokens.
      createDoc('Doc lejanía', 'alpha beta gamma delta epsilon zeta');

      const close: SearchHit[] = await service.search(project.id, 'alpha epsilon', { near: 4 });
      expect(close.some((h) => h.title === 'Doc lejanía')).toBe(true);

      const tooFar: SearchHit[] = await service.search(project.id, 'alpha epsilon', { near: 3 });
      expect(tooFar.some((h) => h.title === 'Doc lejanía')).toBe(false);
    });

    it('encuentra términos adyacentes con NEAR/1', async () => {
      createDoc('Doc adyacente', 'gato perro pez');
      createDoc('Doc separado', 'gato algo mucho perro');

      // "perro" está en la posición 1 del primer documento y en la 3 del
      // segundo: con `near: 1` solo el primero entra en la ventana.
      const adjacent: SearchHit[] = await service.search(project.id, 'gato perro', { near: 1 });
      expect(adjacent.some((h) => h.title === 'Doc adyacente')).toBe(true);
      expect(adjacent.some((h) => h.title === 'Doc separado')).toBe(false);
    });

    it('exige que el grupo completo quepa en la ventana', async () => {
      createDoc('Doc', 'alpha epsilon');

      // "alpha epsilon" son 2 tokens: la ventana mínima para el grupo es 1.
      const exact: SearchHit[] = await service.search(project.id, 'alpha epsilon', { near: 1 });
      expect(exact.some((h) => h.title === 'Doc')).toBe(true);
    });

    it('no falla con caracteres especiales de la sintaxis FTS5', async () => {
      createDoc('Doc símbolos', 'el costo total (neto) fue de 50%');

      // Antiguo comportamiento: estas consultas lanzaban "fts5: syntax error".
      await expect(service.search(project.id, 'costo*')).resolves.toEqual(
        expect.any(Array),
      );
      await expect(service.search(project.id, '(neto)')).resolves.toEqual(expect.any(Array));
      await expect(service.search(project.id, 'a AND OR NEAR*')).resolves.toEqual(
        expect.any(Array),
      );
    });

    it('encuentra textos acentuados consulta sin acento y viceversa', async () => {
      createDoc('Doc acento', 'un análisis profundo del caso');

      const sinAcento: SearchHit[] = await service.search(project.id, 'analisis');
      expect(sinAcento.some((h) => h.title === 'Doc acento')).toBe(true);

      const conAcento: SearchHit[] = await service.search(project.id, 'análisis');
      expect(conAcento.some((h) => h.title === 'Doc acento')).toBe(true);
    });

    it('ignora near inválido (0 o no entero) y usa AND', async () => {
      createDoc('Doc', 'alpha beta');

      const hitsZero: SearchHit[] = await service.search(project.id, 'alpha beta', { near: 0 });
      expect(hitsZero.some((h) => h.title === 'Doc')).toBe(true);

      const hitsDecimal: SearchHit[] = await service.search(project.id, 'alpha beta', { near: 2.5 });
      expect(hitsDecimal.some((h) => h.title === 'Doc')).toBe(true);
    });
  });
});
