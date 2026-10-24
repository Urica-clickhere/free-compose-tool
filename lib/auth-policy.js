import { createHmac, randomUUID } from 'node:crypto';
import ipaddr from 'ipaddr.js';
import { ForumError } from './validation.js';
import { accountActor } from './identity.js';

export function usernameInput(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_]{3,24}$/.test(value.trim())) throw new ForumError(400, '账号需为3–24位字母、数字或下划线');
  return value.trim().toLowerCase();
}
export function passwordInput(value) {
  if (typeof value !== 'string' || value.length < 10 || value.length > 128) throw new ForumError(400, '密码需为10–128个字符');
  return value;
}
export function ipNetwork(value) {
  try {
    const ip = ipaddr.process(value.trim());
    // IPv4-mapped IPv6 shares its IPv4 bucket. Group IPv6 privacy addresses by /64.
    return ip.kind() === 'ipv4' ? ip.toString() : ip.parts.slice(0, 4).map(x => x.toString(16)).join(':') + '::/64';
  } catch { throw new ForumError(503, '暂时无法验证访问来源，请稍后重试'); }
}
export function clientKey(request, secret, onVercel = Boolean(process.env.VERCEL)) {
  // Only trust the header Vercel overwrites, never a client-supplied X-Forwarded-For.
  const network = onVercel ? ipNetwork((request.headers.get('x-vercel-forwarded-for') || '').split(',')[0]) : 'local';
  return createHmac('sha256', secret).update(network).digest('hex');
}
export const policySchema = [
  `CREATE TABLE IF NOT EXISTS composer_auth_limits (key text PRIMARY KEY, count integer NOT NULL, expires_at timestamptz NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS composer_registrations (id uuid PRIMARY KEY, ip_key text NOT NULL, username text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE INDEX IF NOT EXISTS composer_registrations_ip ON composer_registrations(ip_key, created_at)`,
  `CREATE TABLE IF NOT EXISTS composer_legacy_claims (actor_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES composer_user(id), created_at timestamptz NOT NULL DEFAULT now())`
];
export function createPolicy(pool) {
  async function transaction(run) {
    const connection = await pool.connect();
    try {
      await connection.query('BEGIN');
      const value = await run(connection);
      await connection.query('COMMIT');
      return value;
    } catch (error) { await connection.query('ROLLBACK'); throw error; }
    finally { connection.release(); }
  }
  return {
    async limit(key, max, seconds) {
      const { rows } = await pool.query(`INSERT INTO composer_auth_limits(key, count, expires_at) VALUES ($1, 1, now() + $2 * interval '1 second')
        ON CONFLICT (key) DO UPDATE SET count = CASE WHEN composer_auth_limits.expires_at <= now() THEN 1 ELSE composer_auth_limits.count + 1 END,
        expires_at = CASE WHEN composer_auth_limits.expires_at <= now() THEN EXCLUDED.expires_at ELSE composer_auth_limits.expires_at END RETURNING count`, [key, seconds]);
      if (rows[0].count > max) throw new ForumError(429, '尝试次数过多，请稍后再试');
    },
    async reserve(ipKey, username) {
      return transaction(async connection => {
        await connection.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', ['registration:' + ipKey]);
        const existing = await connection.query('SELECT id FROM composer_user WHERE username=$1', [username]);
        if (existing.rows.length) throw new ForumError(409, '账号已被使用，请更换账号');
        const { rows } = await connection.query(`SELECT count(*)::int AS count FROM composer_registrations WHERE ip_key=$1 AND created_at > now() - interval '24 hours'`, [ipKey]);
        if (rows[0].count >= 3) throw new ForumError(429, '同一网络24小时内最多注册3个账号，请稍后再试');
        const id = randomUUID();
        await connection.query('INSERT INTO composer_registrations(id, ip_key, username) VALUES ($1,$2,$3)', [id, ipKey, username]);
        return id;
      });
    },
    async releaseFailed(id) {
      // A partially completed signup may already have created a user: retain its quota.
      await pool.query(`DELETE FROM composer_registrations r WHERE r.id=$1 AND NOT EXISTS
        (SELECT 1 FROM composer_user u WHERE u.username=r.username)`, [id]);
    },
    async cleanup() {
      await pool.query(`DELETE FROM composer_registrations WHERE created_at < now() - interval '48 hours'`);
      await pool.query('DELETE FROM composer_auth_limits WHERE expires_at < now()');
    },
    async claim(oldActor, userId) {
      if (!oldActor) return { posts: 0, comments: 0 };
      return transaction(async connection => {
        const actor = accountActor(userId);
        const claimed = await connection.query('INSERT INTO composer_legacy_claims(actor_hash,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING actor_hash', [oldActor,userId]);
        if (!claimed.rowCount) throw new ForumError(409, '此浏览器的旧内容已被账号认领');
        await connection.query('INSERT INTO composer_actors(token_hash) VALUES($1) ON CONFLICT DO NOTHING', [actor]);
        const posts = await connection.query('UPDATE composer_posts SET actor_hash=$1 WHERE actor_hash=$2', [actor,oldActor]);
        const comments = await connection.query('UPDATE composer_comments SET actor_hash=$1 WHERE actor_hash=$2', [actor,oldActor]);
        for (const table of ['composer_likes','composer_reports']) {
          const fields = table === 'composer_likes' ? 'post_id,actor_hash' : 'post_id,actor_hash,reason,created_at';
          const values = table === 'composer_likes' ? 'post_id,$1' : 'post_id,$1,reason,created_at';
          await connection.query(`INSERT INTO ${table}(${fields}) SELECT ${values} FROM ${table} WHERE actor_hash=$2 ON CONFLICT DO NOTHING`, [actor,oldActor]);
          await connection.query(`DELETE FROM ${table} WHERE actor_hash=$1`, [oldActor]);
        }
        return { posts: posts.rowCount, comments: comments.rowCount };
      });
    }
  };
}
