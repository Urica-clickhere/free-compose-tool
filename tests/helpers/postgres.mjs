import { PGlite } from '@electric-sql/pglite';
// Run the application's PostgreSQL SQL in a real embedded Postgres engine.
// PGlite has one connection, so serialize leases just as a pg Pool(max: 1) does.
export async function postgres() {
  const engine = new PGlite();
  await engine.waitReady;
  let tail = Promise.resolve();
  const pool = {
    async connect() {
      const before = tail;
      let release;
      tail = new Promise(resolve => { release = resolve; });
      await before;
      return { release, async query(sql, values = []) {
        const result = await engine.query(sql, [...values]);
        return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length, command: sql.trim().split(/\s/)[0].toUpperCase() };
      } };
    },
    async query(sql, values) {
      const connection = await pool.connect();
      try { return await connection.query(sql, values); } finally { connection.release(); }
    },
    async end() { await tail; await engine.close(); }
  };
  const sql = (strings, ...values) => {
    const query = strings.reduce((text, part, i) => text + (i ? `$${i}` : '') + part, '');
    return { query, values, then(resolve, reject) { return pool.query(query, values).then(r => r.rows).then(resolve, reject); } };
  };
  sql.transaction = async statements => {
    const connection = await pool.connect();
    try {
      await connection.query('BEGIN');
      const rows = [];
      for (const statement of statements) rows.push((await connection.query(statement.query, statement.values)).rows);
      await connection.query('COMMIT');
      return rows;
    } catch (error) { await connection.query('ROLLBACK'); throw error; }
    finally { connection.release(); }
  };
  return { pool, sql };
}
