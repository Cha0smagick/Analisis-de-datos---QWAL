# Guía de uso de QualiCanvas

QualiCanvas es un CAQDAS (software de análisis cualitativo asistido por ordenador) de escritorio:
codificas fragmentos de tus documentos, los organizas en un árbol de códigos, los interpretas con
memos y relaciones, y exportas el resultado a formatos abiertos para tu tesis o informe.

Todo el trabajo vive en **un solo archivo de base SQLite en tu equipo**. No hay nube, no hay
registro, no hay telemetría.

---

## 1. Requisitos

- **Node.js 20+** y npm (para ejecutar desde el código fuente).
- **Windows** (probado). El módulo nativo `better-sqlite3` debe compilarse para Electron la
  primera vez:

  ```bash
  npm install
  npm run rebuild:native -w @qualicanvas/desktop
  ```

  Si este paso falla, la aplicación no podrá abrir bases: es obligatorio, no opcional.
- **Whisper (opcional)** — sólo si quieres transcribir audio/vídeo dentro de la app:

  ```bash
  pip install -U openai-whisper
  ```

  Es un programa externo; la transcripción corre en tu equipo, nada se sube a internet.
  Si no está instalado, el botón de transcribir lo dirá claramente.

---

## 2. Cómo entrar

### Modo desarrollo (recomendado para empezar)

```bash
npm run dev -w @qualicanvas/desktop
```

Abre la aplicación con recarga en caliente.

### Modo empaquetado (sin recarga)

```bash
npm run build -w @qualicanvas/desktop
npm start -w @qualicanvas/desktop
```

Al abrir, la aplicación restaura automáticamente la última base y el último proyecto con los que
trabajaste (si todavía existen en tu equipo).

---

## 3. Primeros pasos (orden recomendado)

1. **Crear base**: en la pantalla inicial, «Crear base de datos». Elige dónde guardar el archivo
   (extensión `.db`). Ese archivo ES tu proyecto completo: hazle copias de seguridad.
2. **Crear proyecto**: dentro de la vista *Proyectos*, dale un nombre y descripción.
3. **Investigadoras**: crea al menos una (tú). Aparecen en la barra del área de codificación y se
   usan para atribuir quién codificó cada cita (índices de fiabilidad inter-juez).
4. **Importar documentos** en la vista *Documentos*: texto plano, Markdown, o pegar/transcribir
   texto directamente.

---

## 4. Qué encontrarás en cada vista

### 🗂️ Proyectos
Crear, abrir y gestionar proyectos. Sólo un proyecto está «activo» a la vez; todas las demás
vistas operan sobre él.

### 📄 Documentos
- Importa documentos y edítalos. Los documentos de texto guardan su contenido dentro de la base;
  los multimedia (audio/vídeo/imagen) sólo guardan la **ruta** al archivo original: no muevas ni
  borres esos archivos o las citas dejarán de reproducirse.
- **Atributos**: define columnas (texto, número, booleano, fecha) y asigna valores por documento.
  Se guardan automáticamente mientras escribes (~medio segundo), no hace falta salir del campo.
- Exporta la **matriz documento × código** cuando quieras ver la cobertura.

### 🖍️ Codificar (workspace)
El corazón de la aplicación. A la izquierda, el documento; a la derecha, tus citas codificadas.

- **Texto**: selecciona un fragmento con el ratón, pulsa un código y queda codificado.
- **Audio / vídeo**: se abre un reproductor. Marca Ⓐ en el inicio del fragmento y Ⓑ en el fin,
  escribe una etiqueta opcional y crea la cita; luego púlsale un código. El botón ⏵ en una cita
  reproduce el video desde ese momento. Los tiempos se guardan en segundos.
- **Imágenes**: se muestran completas. La codificación por regiones (recortar áreas) todavía no
  está implementada.
- **Transcribir (Whisper)**: con un audio/vídeo abierto, el botón 🗓 lanza Whisper y crea un
  documento de texto nuevo con la transcripción, listo para codificar. Puede tardar minutos.
- **Memos**: cada cita admite memos anclados (notas de análisis).
- Cada cita muestra quién la creó y cuándo; los códigos aplicados se ven con su color.

### 🏷️ Códigos
- Árbol jerárquico: crea códigos con color, descripción y padre; muévelos o renómbralos.
- **Relaciones entre códigos**: al pie, crea relaciones tipadas (`asociado`, `es-un`,
  `parte-de`, `contradice`, `causa`, `similar`) con etiqueta opcional. Son tu interpretación
  teórica (no estadística) y aparecen como flechas naranjas en la red de códigos.

### 📊 Análisis
Diez informes, todos calculados en vivo desde la base:

| Pestaña | Qué responde |
|---|---|
| Frecuencia de códigos | ¿Qué códigos uso más? |
| Co-ocurrencias | ¿Qué códigos comparten citas? (mapa de calor; pasa el ratón para ver los valores) |
| **Red de códigos** | Grafo: nodos = códigos (tamaño ∝ uso), gris = co-ocurrencias, flechas naranjas = relaciones tipadas. Clic en un nodo lo aísla con sus conexiones. |
| Palabras frecuentes | ¿Qué vocabulario domina el corpus? |
| Matriz doc × código | ¿Qué documento está codificado con qué? |
| Matriz de marco | Cruce de marco muestral por códigos |
| KWIC | Concordancias de un término en contexto |
| Jaccard | Similitud entre códigos (0–1) |
| Fiabilidad | Cohen κ por par, Fleiss κ y Krippendorff α entre investigadoras |
| Equipo | Densidad de codificación por investigadora |

### 📤 Exportar
- **CSV** de citas codificadas (abre en Excel/Sheets).
- **JSON** del proyecto completo (respaldo / traslado, ver abajo).
- **Markdown** listo para anexar: frecuencias, co-ocurrencias e índices de fiabilidad.
- **Importar proyecto (JSON)**: crea un proyecto nuevo a partir de un respaldo. Es la forma
  segura de pasar el trabajo a otra máquina o compartilo con el equipo.

---

## 5. Trasladar el trabajo entre máquinas

**Hazlo con JSON, nunca copiando el `.db` por una carpeta de red** (SQLite sobre SMB/OneDrive/Drive
se corrompe silenciosamente).

1. En la máquina A: *Exportar → JSON*.
2. Copia el archivo `.json` (pendrive, correo, lo que sea).
3. En la máquina B: *Exportar → Importar proyecto (JSON)*.

Se recrea el proyecto con códigos (respetando la jerarquía), investigadoras, atributos con sus
valores, documentos de texto con su contenido, citas con sus códigos y memos, y las relaciones
entre códigos.

⚠️ Los **documentos multimedia no viajan dentro del JSON** (sólo su ruta): en la máquina B
tendrás que copiar esos archivos aparte y las citas de audio/vídeo quedarán sin ancla hasta
reanclarlas. El aviso tras importar te dirá cuántos se omitieron.

---

## 6. Límites conocidos (honestos)

- `better-sqlite3` debe recompilarse tras instalar o actualizar Electron (`rebuild:native`).
- Sin el módulo nativo, el respaldo en memoria (sql.js) **falla al abrir bases** porque requiere
  FTS5: hoy no es un respaldo utilizable, es un error known.
- `.mkv` no se reproduce (Chromium no lo soporta); usa `.mp4`/`.webm`, o `.mp3`/`.wav`/`.m4a`.
- Imágenes: sin codificación por regiones todavía.
- Importar el mismo JSON dos veces crea títulos de documento duplicados que el importador puede
  rechazar; la importación no es transaccional: si algo falla a mitad, queda un proyecto parcial.
- Las citas de audio/vídeo guardan segundos, no texto: si el archivo de media cambia de duración
  (re-exportación), los anclajes pueden quedar corridos.
- La prueba E2E (`npm run e2e -w @qualicanvas/desktop`) verifica arranque, vistas y flujo de
  datos completo, pero no pruebas visuales clic a clic.

---

## 7. Problemas frecuentes

| Síntoma | Causa probable | Solución |
|---|---|---|
| «better-sqlite3 no disponible» al abrir | ABI de Electron distinta | `npm run rebuild:native -w @qualicanvas/desktop` |
| «no such module: fts5» | Estás en el respaldo sql.js (sin módulo nativo) | Ejecuta `rebuild:native`; el fallback sql.js aún no soporta FTS |
| Whisper «no se encontró el comando» | Whisper no instalado en tu Python | `pip install -U openai-whisper` |
| Un vídeo no abre | Formato no soportado por Chromium | Convierte a MP4 (H.264) o WebM |
| La ventana se cerró y no guardó | (raro) el vuelco ocurre al salir | La base vuelca automáticamente al cerrar; revisa que el `.db` no esté en una carpeta sincronizada por la nube |
