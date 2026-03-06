import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  const migrationPath = path.join(__dirname, '001_init.sql');
  const sql = await fs.readFile(migrationPath, 'utf8');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);

    const exists = await client.query(`SELECT COUNT(*)::int AS c FROM personnel WHERE deleted_at IS NULL`);
    if (exists.rows[0].c === 0) {
      await client.query(`INSERT INTO personnel (name) VALUES ('Default')`);
    }

    await client.query('COMMIT');
    // eslint-disable-next-line no-console
    console.log('Migration completed.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
