# @qualicanvas/core

**QualiCanvas** — Núcleo TypeScript ESM para Análisis Cualitativo Asistido por Computadora (CAQDAS) *local-first*.

> Una librería ligera, sin runtime pesado, que corre tanto en Node.js (better-sqlite3) como en el navegador (sql.js/WASM). Diseñada para investigadores que necesitan soberanía de datos, privacidad y análisis reproducible.

---

## 🎯 Visión

QualiCanvas es un **CAQDAS local-first**: tus datos viven en un archivo SQLite (o IndexedDB/OPFS en navegador), sin servidores, sin telemetría, sin cuentas. El núcleo (`@qualicanvas/core`) provee:

- **Persistencia ACID** vía SQLite (WAL mode en Node, WASM en navegador).
- **Modelo de dominio rico**: proyectos, documentos, citas, códigos jerárquicos, memos, relaciones, atributos, investigadores.
- **Codificación colaborativa** con trazabilidad por investigador: cada asignación `(código, cita)` guarda *qué investigadora* la hizo, lo que permite medir fiabilidad inter-juez de verdad.
- **Análisis cualitativo**: frecuencias, co-ocurrencia, matriz documento×código, nubes de palabras, matriz de marco, similitud Jaccard, concordancias KWIC y tres coeficientes de fiabilidad inter-juez.
- **Búsqueda full-text** FTS5 sobre documentos **y citas** (Unicode, diacríticos, frases exactas, prefijo, paginación en SQL).
- **Auditoría encadenada** con SHA-256 verificable (`verifyChain()`).
- **Importación** de PDF, DOCX, TXT, MD, CSV, JSON, audio/video (segmentos temporales), imágenes.

---

## 🏗️ Arquitectura en capas

```
┌─────────────────────────────────────────────────────────────────┐
│                        UI (React, Vue, CLI, TUI)                │
├─────────────────────────────────────────────────────────────────┤
│                         Session (fachada)                       │
│  ┌─────────────┐ ┌─────────────┐ ┌──────────┐ ┌──────────────┐  │
│  │  Análisis   │ │  Búsqueda   │ │ Auditoría│ │ Codificación │  │
│  │  Service    │ │  Service    │ │  Service │ │   Service    │  │
│  └──────┬──────┘ └──────┬──────┘ └────┬─────┘ └──────┬───────┘  │
├─────────┼───────────────┼─────────────┼──────────────┼──────────┤
│         │ Repositorios (Document, Code, Quotation, Memo,        │
│         │ Relation, Attribute, Researcher, CodeQuotation,       │
│         │ Analytics)                                            │
├─────────┼────────────────────────────────────────────────────────┤
│         │                    DbDriver                            │
│         │  ┌─────────────────┐  ┌─────────────────┐             │
│         │  │ NodeSqliteDriver │  │   SqlJsDriver   │             │
│         │  │ (better-sqlite3) │  │   (sql.js/WASM) │             │
│         │  └─────────────────┘  └─────────────────┘             │
├─────────┼────────────────────────────────────────────────────────┤
│         │                    SQLite                              │
│         │  • projects, documents, quotations, codes              │
│         │  • code_quotation, memos, relations, attributes        │
│         │  • researchers, audit_log, code_cooccurrence            │
│         │  • documents_fts, quotations_fts (FTS5), stop_words    │
└─────────┴────────────────────────────────────────────────────────┘
```

**Principios:**
- **Session** es el único punto de entrada público.
- **Repositorios** son la única capa que toca `DbDriver` (SQL puro, sincrónico).
- **Servicios** operan *solo* sobre repositorios (lógica de negocio, sin SQL).
- **Drivers** intercambiables: mismo interface `DbDriver` para Node y navegador, con la misma semántica de integridad (`foreign_keys` y `recursive_triggers` activos en ambos).

---

## 🚀 Inicio rápido (Node.js)

```bash
npm i @qualicanvas/core better-sqlite3
```

```ts
import { openDriver, migrate, ProjectRepository, Session } from '@qualicanvas/core';

// 1. Abre el driver (archivo persistente o ':memory:')
const driver = openDriver({ backend: 'node', filename: './mi-proyecto.db' });

// 2. Aplica el esquema + stopwords (idempotente, una sola versión)
migrate(driver);

// 3. Crea el proyecto
const projectId = new ProjectRepository(driver).create({ name: 'Mi estudio' }).id;

// 4. Instancia Session y carga
const session = new Session(driver, projectId);
session.load();

// 5. Usa repositorios y servicios
const docs = session.documents.listByProject(projectId);
const report = session.analysis.codeFrequencies(projectId);
const hits = await session.search.search(projectId, 'entrevista "angustia"');

// 6. Codifica (el researcherId queda registrado en cada asignación)
session.coding.codeQuotation(quotationId, codeId, researcherId);

// 7. Las mutaciones de codificación se auditan solas en audit_log
session.audit.verifyChain(); // null = cadena íntegra
```

> Session expone los repositorios y servicios como accesores planos:
> `documents`, `quotations`, `codes`, `memos`, `relations`, `attributes`,
> `researchers`, `codeQuotations`, `analytics`, `analysis`, `search`, `audit`,
> `coding`, `project`, `importer` (este último es una `Promise`).

---

## 🌐 Uso en navegador (SqlJsDriver)

```ts
import { openDriver, migrate, SqlJsDriver, Session } from '@qualicanvas/core';

const driver = await openDriver({
  backend: 'sqljs',
  locateFile: f => `https://cdn.example.com/${f}`,
  // Opcional: restaura una BD previa desde IndexedDB/OPFS
  // initialData: await loadFromIndexedDB(),
});

migrate(driver);
const session = new Session(driver, projectId);
session.load();

// Persiste los cambios periódicamente (sql.js vive en memoria):
const save = () => saveToIndexedDB(driver.exportDatabase());
setInterval(save, 30_000);
```

> **Nota:** `SqlJsDriver` es async en creación (`await openDriver(...)`), pero sus
> métodos `query/run/exec/transaction` son **síncronos** igual que `NodeSqliteDriver`.
> Las transacciones son reentrantes en ambos backends (savepoints), y abrir el
> driver dos veces sobre el mismo archivo no es una operación idempotente:
> llama a `close()` cuando termines.

---

## 📦 Estructura del paquete

```
packages/core/
├── src/
│   ├── index.ts                    # Barril público
│   ├── types/                      # Contratos (domain, analysis, services, json, errors)
│   ├── db/driver.ts                # DbDriver + NodeSqliteDriver + SqlJsDriver + openDriver
│   ├── schema/
│   │   ├── schema.sql              # DDL completo (tablas, índices, triggers, FTS5)
│   │   ├── migrations.ts           # migrate(), getUserVersion(), optimizeFullText(), SCHEMA_VERSION
│   │   └── seed_stopwords.sql      # Stopwords ES/EN/PT/FR
│   ├── util/
│   │   ├── id.ts                   # newId() UUID v4, nowIso() ISO-8601 UTC ms
│   │   └── text.ts                 # foldText(), tokenize(), tokenizeWithOffsets()
│   ├── repos/                      # Repositorios — única capa con SQL
│   ├── services/                   # analysis / search / audit
│   ├── coding/coding.service.ts    # Servicio de codificación
│   ├── session/session.ts          # Fachada Session
│   └── imports/                    # Importadores (PDF, DOCX, audio, etc.)
├── tests/                          # vitest
├── vitest.config.ts
└── package.json
```

---

## 🧪 Comandos del paquete

Desde la **raíz del monorepo**:

```bash
npm run typecheck -w @qualicanvas/core   # tsc --noEmit estricto
npm test        -w @qualicanvas/core     # vitest
npm run build   -w @qualicanvas/core     # dist/ + copia de src/schema
```

> `tsconfig.json` usa `moduleResolution: Bundler` y `target: ES2022`. El código es
> ESM puro con imports relativos terminados en `.js`.

---

## 🔑 API pública principal (barril)

```ts
// Tipos de dominio y análisis
import type {
  Project, SourceDocument, Quotation, Code, CodeTreeNode, CodeQuotation,
  CodeFamily, Memo, Relation, Attribute, Researcher, QuotationAnchor,
  CodeFrequencyReport, CooccurrenceMatrix, DocumentCodeMatrix,
  WordFrequencyReport, InterRaterReport, FrameworkMatrixReport,
  JaccardMatrix, KwicReport, FleissKappaReport, KrippendorffAlphaReport,
  SearchHit, AuditEntry, ImportResult, AnalysisService, SearchService,
  AuditService, DocumentImporter,
} from '@qualicanvas/core';

// Driver & esquema
import {
  openDriver, migrate, getUserVersion, optimizeFullText, SCHEMA_VERSION,
  DbDriver, NodeSqliteDriver, SqlJsDriver, DbDriverClosedError,
} from '@qualicanvas/core';

// Utilidades
import { newId, nowIso, foldText, tokenize, tokenizeWithOffsets } from '@qualicanvas/core';

// Errores de dominio (códigos: not_found, wrong_project, invalid_input, conflict, closed)
import {
  DomainError, NotFoundError, WrongProjectError, InvalidInputError, ConflictError,
} from '@qualicanvas/core';

// Repositorios
import {
  DocumentRepository, CodeRepository, QuotationRepository, MemoRepository,
  RelationRepository, AttributeRepository, ResearcherRepository,
  CodeQuotationRepository, AnalyticsRepository,
} from '@qualicanvas/core';

// Servicios
import { AnalysisServiceImpl, SearchServiceImpl, AuditServiceImpl, CodingService } from '@qualicanvas/core';

// Fachada e importadores
import { Session, SqliteDocumentImporter, NodeFileSource } from '@qualicanvas/core';
import type { SessionRepos, SessionServices } from '@qualicanvas/core';
```

---

## 📋 Esquema de BD (resumen)

| Tabla | Propósito |
|-------|-----------|
| `projects` | Proyectos (settings JSON) |
| `researchers` | Investigadores/codificadores por proyecto |
| `documents` | Fuentes primarias (raw_text, language, metadata) |
| `documents_fts` | Índice FTS5 sobre (title, raw_text) con triggers auto-sync |
| `transcript_segments` | Segmentos temporales para audio/video |
| `codes` | Códigos jerárquicos (parent_id, color, descripción); triggers anti-ciclo |
| `code_families` / `code_family_codes` | Agrupaciones transversales de códigos |
| `quotations` | Citas (texto/media/imagen) con anclajes; índices anti-evidencia duplicada |
| `quotations_fts` | Índice FTS5 sobre `segment_text` |
| `code_quotation` | Asignación (código, cita, **researcher_id**) — una fila por decisión |
| `memos` | Notas analíticas vinculables a cualquier entidad |
| `relations` | Relaciones tipadas; triggers limpian referencias al borrar |
| `attributes` / `document_attribute_values` | Variables de caso (framework matrix) |
| `code_cooccurrence` | Caché de co-ocurrencia mantenida por triggers |
| `stop_words` | Palabras vacías por idioma (ISO 639-1) |
| `audit_log` | Trail encadenado SHA-256, inmutable |

**Integridad garantizada por el esquema, no por el código de aplicación:**
- Unicidad del nombre de código entre hermanos (índices parciales `ux_codes_root_name` / `ux_codes_child_name`).
- Imposibilidad de ciclos en el árbol de códigos (`WITH RECURSIVE` en triggers).
- La caché `code_cooccurrence` cuenta **citas distintas**, no filas, así que dos
  investigadoras codificando el mismo par no la inflan.
- Borrar una entidad polimórfica (código, cita, memo, documento) elimina sus
  relaciones, de modo que no quedan referencias colgando.

---

## 🔐 Auditoría — Encadenamiento criptográfico

Cada `INSERT` en `audit_log` calcula:

```
envelope = canonical_json({ action, details_json, entity_id, entity_type,
                            prev_hash, project_id, researcher_id, ts })
prev_hash = row_hash del registro anterior (cadena GLOBAL, orden por id)
row_hash  = sha256(envelope)
```

- El hash cubre **todas** las columnas del registro, no solo `details_json`.
- `canonical_json`: claves ordenadas alfabéticamente, sin espacios.
- El SHA-256 se calcula **síncronamente** dentro de la misma transacción que lee
  `prev_hash` e inserta la fila, de modo que dos escrituras concurrentes no
  pueden bifurcar la cadena.
- Triggers `audit_no_update` / `audit_no_delete` impiden mutaciones (`RAISE(ABORT)`).
- `audit.project_id` es `ON DELETE SET NULL`: borrar un proyecto no destruye el
  trail ni intenta violar el trigger de inmutabilidad.
- `audit.verifyChain()` recorre el trail completo y devuelve `{ id, reason }` con
  el primer registro roto, o `null` si la cadena es íntegra.

---

## 🧭 Estado del análisis cualitativo

**Implementado** (`AnalysisServiceImpl`, 10 métodos):

| Método | Qué entrega |
|--------|-------------|
| `codeFrequencies` | Frecuencias directas **y con descendientes**, de citas y de documentos, con árbol (`depth`/`path`) |
| `cooccurrence` | Co-ocurrencia por cita, leída de la caché `code_cooccurrence` |
| `documentCodeMatrix` | Matriz documento × código (ejes ordenados de forma determinista) |
| `wordFrequencies` | Nube de palabras con stopwords desde la BD por idioma ISO 639-1 |
| `interRater` | Fiabilidad por pares: coincidencia de decisiones (código, cita), Jaccard de decisiones y **kappa de Cohen por código** |
| `frameworkMatrix` | Matriz de marco por documento, con **variables de caso reales** y todas las citas del proyecto como columnas |
| `jaccard` | Índice de Jaccard entre códigos (opcionalmente incluyendo descendientes) |
| `kwic` | Concordancias: término o frase con ventana de contexto en tokens, insensible a diacríticos |
| `fleissKappa` | Fleiss generalizado (solo sobre citas con dos o más juzgadores) |
| `krippendorffAlpha` | α de Krippendorff por matriz de coincidencia |

Las unidades de medida de los tres coeficientes de fiabilidad son explícitas:
el sujeto es la **cita**, el valor es el **código**, y una decisión es el par
`(código, cita)` creado por una investigadora concreta. Esto es posible porque
`code_quotation` permite varias filas para el mismo par código/cita siempre que
la investigadora sea distinta.

**Pendiente / no implementado aún** (gaps honestos):

- **REFI-QDA** — exportación/importación del estándar de intercambio de proyectos CAQDAS (`.qda` / QDPX).
- **Bundles / hyperlink networks** — no hay una entidad de agrupación arbitraria de citas, códigos y documentos que cargue sus propios atributos (el agrupamiento transversal se limita a `code_families`, y solo sobre códigos).
- **Salience coding** — no existe la escala de prominencia por investigadora (nada / algo / muy / extremadamente).
- **Tags con valores predefinidos** — no hay tabla de etiquetas aplicables a citas, códigos, documentos o grupos.
- **Anotaciones (marginalia)** — los memos no se anclan a rangos de texto de un documento; solo se vinculan por entidad.
- **Casos (documents composed of several files)** — un caso es un documento virtual con casos/variables; aquí cada documento es un archivo individual, así que los casos de varias partes no se pueden modelar.
- **Atributos fuera del documento** — `document_attribute_values` solo cubre documentos; no hay atributos a nivel de código o de cita (variables de matriz de marco sobre columnas).
- **Sin lematización/raíz en español** — el conteo de palabras no reduce "análisis"/"analizando" a una misma forma.
- **Sin frecuencias de palabras por documento** — solo hay un agregado por proyecto.

---

## 📄 Licencia

MIT — Úsalo libremente en investigación, enseñanza o productos comerciales.
