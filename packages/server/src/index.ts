import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, openDatabase } from './app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const dataDir = path.resolve(__dirname, '../data');
fs.mkdirSync(dataDir, { recursive: true });

const defaultDbPath = process.env.QWAL_DB_PATH ?? path.join(dataDir, 'qualicanvas.db');

await openDatabase(defaultDbPath);

const { app } = createApp({ dataDir, defaultDbPath });

const port = Number(process.env.PORT ?? 3000);

app.listen(port, '127.0.0.1', () => {
  console.log(`QualiCanvas server listening on http://127.0.0.1:${port}`);
});
