-- ============================================================================
-- QualiCanvas · Esquema de base de datos (SQLite 3)
-- UTF-8 · todos los ids son TEXT (UUID v4)
-- Convenciones:
--   * timestamps ISO-8601 UTC con precisión de milisegundos
--   * FKs con ON DELETE CASCADE salvo que se indique lo contrario
--   * audit_log es INMUTABLE (triggers RAISE(ABORT) impiden UPDATE/DELETE) y su
--     cadena de hashes es GLOBAL (no se reinicia ni se pierde por proyecto)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. PROYECTOS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (name)
);

-- ---------------------------------------------------------------------------
-- 2. INVESTIGADORAS/ES (codificadores; se usa en fiabilidad inter-juez)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS researchers (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  initials   TEXT,
  color      TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (project_id, name)
);
CREATE INDEX IF NOT EXISTS idx_researchers_project ON researchers(project_id);

-- ---------------------------------------------------------------------------
-- 3. DOCUMENTOS (fuentes primarias)
--    · raw_text: texto completo plano (página/segmentos unidos)
--    · FTS5 external-content indexa (title, raw_text) para búsqueda full-text
--    · language: código BCP-47 (es, en, pt, fr, …) para análisis léxico
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS documents (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  file_type   TEXT NOT NULL CHECK (file_type IN
              ('pdf','docx','doc','odt','rtf','txt','md','html','xml',
               'mp3','wav','m4a','aac','flac','ogg','m4v','mov','avi','mp4','webm','mkv',
               'jpg','jpeg','png','webp','tif','tiff','heic',
               'csv','tsv','xlsx','xls','ods','json','jsonl','other')),
  file_path   TEXT,                       -- ruta relativa dentro de data/<proyecto>/
  raw_text    TEXT NOT NULL DEFAULT '',   -- contenido de texto indexable
  language    TEXT,                       -- BCP-47 detectado o declarado
  metadata_json TEXT NOT NULL DEFAULT '{}',  -- duración, páginas, autor, importado_at, etc.
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project_id, title);

-- FTS5 external-content sobre documents (columna 0=title, 1=content)
CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
  title,
  content,
  content='documents',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2',
  columnsize=1
);

CREATE TRIGGER IF NOT EXISTS documents_ai AFTER INSERT ON documents BEGIN
  INSERT INTO documents_fts(rowid, title, content) VALUES (new.rowid, new.title, new.raw_text);
END;
CREATE TRIGGER IF NOT EXISTS documents_ad AFTER DELETE ON documents BEGIN
  INSERT INTO documents_fts(documents_fts, rowid, title, content) VALUES ('delete', old.rowid, old.title, old.raw_text);
END;
CREATE TRIGGER IF NOT EXISTS documents_au AFTER UPDATE OF title, raw_text ON documents BEGIN
  INSERT INTO documents_fts(documents_fts, rowid, title, content) VALUES ('delete', old.rowid, old.title, old.raw_text);
  INSERT INTO documents_fts(rowid, title, content) VALUES (new.rowid, new.title, new.raw_text);
END;

-- ---------------------------------------------------------------------------
-- 4. SEGMENTOS DE TRANSCRIPCIÓN (media: alineación texto↔línea de tiempo)
--    Un documento de tipo media tiene N segmentos; cada segmento puede tener
--    su propia cita por rango temporal.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transcript_segments (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  seq         INTEGER NOT NULL,
  start_ts    REAL NOT NULL,
  end_ts      REAL NOT NULL,
  text        TEXT NOT NULL DEFAULT '',
  UNIQUE (document_id, seq),
  CHECK (end_ts > start_ts)
);
CREATE INDEX IF NOT EXISTS idx_segments_document ON transcript_segments(document_id, seq);

-- ---------------------------------------------------------------------------
-- 5. CÓDIGOS (árbol jerárquico; raíces tienen parent_id NULL)
--    · parent_id ON DELETE CASCADE: los subcódigos son propiedad de su padre
--    · los triggers codes_no_cycle_* impiden ciclos de N nodos (el CHECK de
--      tabla solo puede impedir el auto-bucle de un nodo)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS codes (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_id   TEXT REFERENCES codes(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  color       TEXT,
  description TEXT NOT NULL DEFAULT '',
  created_by  TEXT REFERENCES researchers(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (parent_id IS NULL OR parent_id != id)
);
CREATE INDEX IF NOT EXISTS idx_codes_project ON codes(project_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_codes_parent ON codes(parent_id);

-- UNIQUE (project_id, parent_id, name) NO sirve: en SQLite un NULL en un
-- UNIQUE hace que la restricción no se aplique, de modo que dos códigos raíz
-- con el mismo nombre convivirían. Se separa en dos índices parciales.
CREATE UNIQUE INDEX IF NOT EXISTS ux_codes_root_name ON codes(project_id, name) WHERE parent_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_codes_child_name ON codes(project_id, parent_id, name) WHERE parent_id IS NOT NULL;

-- Un ciclo aparece si NEW.id aparece en su propia cadena de ancestros (subiendo
-- desde NEW.parent_id). `UNION` deduplica el recorrido, de modo que una base ya
-- corrupta no Provoca recursión infinita. La base del CTE es el padre elegido;
-- NEW.id no está en esa lista salvo que el padre sea un descendiente de NEW.id.
CREATE TRIGGER IF NOT EXISTS codes_no_cycle_insert BEFORE INSERT ON codes
WHEN NEW.parent_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'codes: parent_id crearía un ciclo')
  WHERE NEW.id IN (
    WITH RECURSIVE anc(id) AS (
      SELECT id FROM codes WHERE id = NEW.parent_id
      UNION
      SELECT c.parent_id FROM codes c JOIN anc ON c.id = anc.id WHERE c.parent_id IS NOT NULL
    )
    SELECT id FROM anc
  );
END;

CREATE TRIGGER IF NOT EXISTS codes_no_cycle_update BEFORE UPDATE OF parent_id ON codes
WHEN NEW.parent_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'codes: parent_id crearía un ciclo')
  WHERE NEW.id IN (
    WITH RECURSIVE anc(id) AS (
      SELECT id FROM codes WHERE id = NEW.parent_id
      UNION
      SELECT c.parent_id FROM codes c JOIN anc ON c.id = anc.id WHERE c.parent_id IS NOT NULL
    )
    SELECT id FROM anc
  );
END;

-- Familias de códigos (agrupaciones transversales, NVivo-style)
CREATE TABLE IF NOT EXISTS code_families (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  color      TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (project_id, name)
);
CREATE TABLE IF NOT EXISTS code_family_codes (
  family_id TEXT NOT NULL REFERENCES code_families(id) ON DELETE CASCADE,
  code_id   TEXT NOT NULL REFERENCES codes(id) ON DELETE CASCADE,
  PRIMARY KEY (family_id, code_id)
);
CREATE INDEX IF NOT EXISTS idx_cfc_code ON code_family_codes(code_id);

-- ---------------------------------------------------------------------------
-- 6. CITAS (QUOTATIONS) Y CODIFICACIÓN
--    Una cita apunta a un fragmento de evidencia de TRES formas posibles:
--      a) texto:  (start_pos, end_pos)  -> offsets de caracteres en raw_text
--      b) media:  (start_ts,  end_ts)   -> segundos dentro de audio/video
--      c) imagen: bbox_json             -> {x,y,w,h} normalizado (0..1)
--    El CHECK garantiza: pares completos, rangos válidos y ≥1 forma presente.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quotations (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  start_pos   INTEGER,
  end_pos     INTEGER,
  start_ts    REAL,
  end_ts      REAL,
  bbox_json   TEXT,
  segment_text TEXT NOT NULL DEFAULT '',  -- snapshot del texto citado
  context_json TEXT NOT NULL DEFAULT '{}', -- contexto extendido (párrafo anterior/posterior)
  created_by  TEXT REFERENCES researchers(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (
    (start_pos IS NULL AND end_pos IS NULL)
    OR (start_pos IS NOT NULL AND end_pos IS NOT NULL AND start_pos < end_pos)
  ),
  CHECK (
    (start_ts IS NULL AND end_ts IS NULL)
    OR (start_ts IS NOT NULL AND end_ts IS NOT NULL AND start_ts < end_ts)
  ),
  CHECK (start_pos IS NOT NULL OR start_ts IS NOT NULL OR bbox_json IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_quotations_document_pos ON quotations(document_id, start_pos, end_pos);
CREATE INDEX IF NOT EXISTS idx_quotations_document_ts  ON quotations(document_id, start_ts, end_ts);
CREATE INDEX IF NOT EXISTS idx_quotations_created_by ON quotations(created_by);

-- Una misma evidencia no puede quedar duplicada dos veces en el mismo documento.
CREATE UNIQUE INDEX IF NOT EXISTS ux_quotations_text ON quotations(document_id, start_pos, end_pos) WHERE start_pos IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_quotations_ts ON quotations(document_id, start_ts, end_ts) WHERE start_ts IS NOT NULL;

-- FTS5 sobre el texto citado: es la superficie de búsqueda principal en todo
-- CAQDAS y antes solo existía el índice de documentos.
CREATE VIRTUAL TABLE IF NOT EXISTS quotations_fts USING fts5(
  segment_text,
  content='quotations',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2',
  columnsize=1
);

CREATE TRIGGER IF NOT EXISTS quotations_fts_ai AFTER INSERT ON quotations BEGIN
  INSERT INTO quotations_fts(rowid, segment_text) VALUES (new.rowid, new.segment_text);
END;
CREATE TRIGGER IF NOT EXISTS quotations_fts_ad AFTER DELETE ON quotations BEGIN
  INSERT INTO quotations_fts(quotations_fts, rowid, segment_text) VALUES ('delete', old.rowid, old.segment_text);
END;
CREATE TRIGGER IF NOT EXISTS quotations_fts_au AFTER UPDATE OF segment_text ON quotations BEGIN
  INSERT INTO quotations_fts(quotations_fts, rowid, segment_text) VALUES ('delete', old.rowid, old.segment_text);
  INSERT INTO quotations_fts(rowid, segment_text) VALUES (new.rowid, new.segment_text);
END;

-- Asignación code↔quote (muchos a muchos) con autoría por investigador.
-- researcher_id forma parte de la identidad de la asignación: dos personas
-- pueden codificar el MISMO código en la MISMA cita, y ambas filas se conservan
-- (es lo que hace posible medir fiabilidad inter-juez con Cohen/Fleiss/
-- Krippendorff). Con PK (code_id, quotation_id) esa segunda fila no cabía.
CREATE TABLE IF NOT EXISTS code_quotation (
  id           TEXT PRIMARY KEY,
  code_id      TEXT NOT NULL REFERENCES codes(id) ON DELETE CASCADE,
  quotation_id TEXT NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  researcher_id TEXT REFERENCES researchers(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_cq_anon ON code_quotation(code_id, quotation_id) WHERE researcher_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_cq_res  ON code_quotation(code_id, quotation_id, researcher_id) WHERE researcher_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cq_quotation  ON code_quotation(quotation_id, code_id);
CREATE INDEX IF NOT EXISTS idx_cq_code       ON code_quotation(code_id);
CREATE INDEX IF NOT EXISTS idx_cq_researcher ON code_quotation(researcher_id);

-- ---------------------------------------------------------------------------
-- 7. MEMOS (notas personales y analíticas; pueden vincularse a cualquier entidad)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS memos (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  content     TEXT NOT NULL DEFAULT '',
  target_type TEXT CHECK (target_type IN ('project','document','quotation','code','memo','relation')),
  target_id   TEXT,
  author_id   TEXT REFERENCES researchers(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_memos_target ON memos(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_memos_project ON memos(project_id);

-- ---------------------------------------------------------------------------
-- 8. RELACIONES ENTRE ENTIDADES (código↔código, código↔memo, concepto↔cita…)
--    relation_type: 'es-parte-de' | 'causa' | 'asociado' | 'contradice' | libre
--    source_id/target_id son polimórficos (no pueden ser FK), por eso los
--    triggers rels_cleanup_* guarantee que nunca queden apuntando a filas
--    que ya no existen.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS relations (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_type   TEXT NOT NULL CHECK (source_type IN ('code','quotation','memo','document')),
  source_id     TEXT NOT NULL,
  target_type   TEXT NOT NULL CHECK (target_type IN ('code','quotation','memo','document')),
  target_id     TEXT NOT NULL,
  relation_type TEXT NOT NULL DEFAULT 'asociado',
  label         TEXT,
  created_by    TEXT REFERENCES researchers(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (source_type != target_type OR source_id != target_id)
);
CREATE INDEX IF NOT EXISTS idx_relations_source ON relations(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_relations_target ON relations(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_relations_project ON relations(project_id);

CREATE TRIGGER IF NOT EXISTS rels_cleanup_code AFTER DELETE ON codes BEGIN
  DELETE FROM relations WHERE (source_type='code' AND source_id=OLD.id) OR (target_type='code' AND target_id=OLD.id);
END;
CREATE TRIGGER IF NOT EXISTS rels_cleanup_quotation AFTER DELETE ON quotations BEGIN
  DELETE FROM relations WHERE (source_type='quotation' AND source_id=OLD.id) OR (target_type='quotation' AND target_id=OLD.id);
END;
CREATE TRIGGER IF NOT EXISTS rels_cleanup_memo AFTER DELETE ON memos BEGIN
  DELETE FROM relations WHERE (source_type='memo' AND source_id=OLD.id) OR (target_type='memo' AND target_id=OLD.id);
END;
CREATE TRIGGER IF NOT EXISTS rels_cleanup_document AFTER DELETE ON documents BEGIN
  DELETE FROM relations WHERE (source_type='document' AND source_id=OLD.id) OR (target_type='document' AND target_id=OLD.id);
END;

-- ---------------------------------------------------------------------------
-- 9. ATRIBUTOS (variables de casos) Y VALORES POR DOCUMENTO
--    Habilitan la matriz de marco (framework matrix): casos × códigos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attributes (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  data_type  TEXT NOT NULL DEFAULT 'string' CHECK (data_type IN ('string','number','boolean','date')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (project_id, name)
);
CREATE TABLE IF NOT EXISTS document_attribute_values (
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  attribute_id TEXT NOT NULL REFERENCES attributes(id) ON DELETE CASCADE,
  value       TEXT,
  PRIMARY KEY (document_id, attribute_id)
);
CREATE INDEX IF NOT EXISTS idx_dav_attribute ON document_attribute_values(attribute_id, document_id);

-- ---------------------------------------------------------------------------
-- 10. CACHÉ DE CO-OCURRENCIA (pares de códigos que comparten citas)
--      n = número de CITAS DISTINTAS en las que ambos códigos aparecen.
--      Los triggers son incrementales: solo incrementan cuando la inserción
--      aporta el primer coder del código para esa cita, de modo que dos
--      investigadoras codificando el mismo par en la misma cita cuentan 1.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS code_cooccurrence (
  code_a TEXT NOT NULL REFERENCES codes(id) ON DELETE CASCADE,
  code_b TEXT NOT NULL REFERENCES codes(id) ON DELETE CASCADE,
  n      INTEGER NOT NULL DEFAULT 0 CHECK (n >= 0),
  PRIMARY KEY (code_a, code_b),
  CHECK (code_a < code_b)
);

CREATE TRIGGER IF NOT EXISTS cooc_inc BEFORE INSERT ON code_quotation
WHEN NOT EXISTS (SELECT 1 FROM code_quotation WHERE quotation_id = new.quotation_id AND code_id = new.code_id)
BEGIN
  INSERT OR IGNORE INTO code_cooccurrence(code_a, code_b, n)
    SELECT MIN(new.code_id, other.code_id), MAX(new.code_id, other.code_id), 0
    FROM code_quotation other
    WHERE other.quotation_id = new.quotation_id AND other.code_id != new.code_id;
  UPDATE code_cooccurrence SET n = n + 1
    WHERE (code_a = new.code_id AND code_b IN (
        SELECT other.code_id FROM code_quotation other
        WHERE other.quotation_id = new.quotation_id AND other.code_id != new.code_id
      ))
       OR (code_b = new.code_id AND code_a IN (
        SELECT other.code_id FROM code_quotation other
        WHERE other.quotation_id = new.quotation_id AND other.code_id != new.code_id
      ));
END;

CREATE TRIGGER IF NOT EXISTS cooc_dec AFTER DELETE ON code_quotation
WHEN NOT EXISTS (SELECT 1 FROM code_quotation WHERE quotation_id = old.quotation_id AND code_id = old.code_id)
BEGIN
  UPDATE code_cooccurrence SET n = n - 1
    WHERE (code_a = old.code_id AND code_b IN (
        SELECT other.code_id FROM code_quotation other
        WHERE other.quotation_id = old.quotation_id AND other.code_id != old.code_id
      ))
       OR (code_b = old.code_id AND code_a IN (
        SELECT other.code_id FROM code_quotation other
        WHERE other.quotation_id = old.quotation_id AND other.code_id != old.code_id
      ));
  DELETE FROM code_cooccurrence WHERE n <= 0;
END;

-- ---------------------------------------------------------------------------
-- 11. LISTAS DE PALABRAS VACÍAS POR IDIOMA (análisis léxico / nubes)
--     Se siembra en seed_stopwords.sql
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stop_words (
  language TEXT NOT NULL,
  word     TEXT NOT NULL,
  PRIMARY KEY (language, word)
);

-- ---------------------------------------------------------------------------
-- 12. AUDITORÍA (trail inmutable + encadenamiento criptográfico SHA-256)
--     row_hash = sha256(prev_hash || canonical_json(REGISTO COMPLETO))
--     La cadena es GLOBAL y ordenada por `id`: project_id usa ON DELETE SET
--     NULL para que borrar un proyecto NUNCA intente borrar audit_log (lo que
--     disparaba el trigger de inmutabilidad y hacía imposible borrar).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id   TEXT REFERENCES projects(id) ON DELETE SET NULL,
  researcher_id TEXT REFERENCES researchers(id) ON DELETE SET NULL,
  ts           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  action       TEXT NOT NULL,
  entity_type  TEXT NOT NULL,
  entity_id    TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  prev_hash    TEXT,
  row_hash     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_project ON audit_log(project_id, ts);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);

CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log BEGIN
  SELECT RAISE(ABORT, 'audit_log es inmutable');
END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log BEGIN
  SELECT RAISE(ABORT, 'audit_log es inmutable');
END;

-- ---------------------------------------------------------------------------
-- 13. TRIGGERS GLOBALES updated_at
-- ---------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS trg_projects_updated AFTER UPDATE ON projects BEGIN
  UPDATE projects SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_researchers_updated AFTER UPDATE ON researchers BEGIN
  UPDATE researchers SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_documents_updated AFTER UPDATE ON documents BEGIN
  UPDATE documents SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_codes_updated AFTER UPDATE ON codes BEGIN
  UPDATE codes SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_code_families_updated AFTER UPDATE ON code_families BEGIN
  UPDATE code_families SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_quotations_updated AFTER UPDATE ON quotations BEGIN
  UPDATE quotations SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_memos_updated AFTER UPDATE ON memos BEGIN
  UPDATE memos SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_relations_updated AFTER UPDATE ON relations BEGIN
  UPDATE relations SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_attributes_updated AFTER UPDATE ON attributes BEGIN
  UPDATE attributes SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
