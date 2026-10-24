import { betterAuth } from 'better-auth';
import { username } from 'better-auth/plugins/username';
import { getMigrations } from 'better-auth/db/migration';
import { Pool } from 'pg';
import { initialize } from './db.js';
import { ForumError } from './validation.js';
import { createPolicy, policySchema } from './auth-policy.js';

export function authOptions(database, secret, baseURL, trustedOrigins = []) {
  return {
    database, secret, baseURL, trustedOrigins: [baseURL, ...trustedOrigins],
    user: { modelName: 'composer_user' },
    account: { modelName: 'composer_account', accountLinking: { enabled: false } },
    session: { modelName: 'composer_session', expiresIn: 7 * 86400, disableSessionRefresh: true, cookieCache: { enabled: false } },
    verification: { modelName: 'composer_verification' },
    emailAndPassword: { enabled: true, minPasswordLength: 10, maxPasswordLength: 128, autoSignIn: true },
    plugins: [username({ minUsernameLength: 3, maxUsernameLength: 24, immutableUsername: true, usernameValidator: value => /^[a-zA-Z0-9_]+$/.test(value) })],
    // All public operations pass through our allowlisted wrapper and PostgreSQL limits.
    // Better Auth's in-memory limiter does not apply to server-side auth.api calls.
    rateLimit: { enabled: false },
    advanced: { cookiePrefix: 'composer', ipAddress: { disableIpTracking: true }, database: { validateSchema: false } },
    logger: { disabled: true }
  };
}
let ready;
export async function getAuthService() {
  if (!process.env.DATABASE_URL || (process.env.BETTER_AUTH_SECRET || '').length < 32) throw new ForumError(503, '账号服务暂时不可用，请稍后重试');
  ready ||= (async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3, connectionTimeoutMillis: 10000, idleTimeoutMillis: 10000 });
    pool.on('error', () => console.error('auth_database_connection_failed'));
    try {
      const baseURL = process.env.BETTER_AUTH_URL || (process.env.VERCEL ? 'https://free-compose-tool.vercel.app' : 'http://localhost:3000');
      const origins = [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL].filter(Boolean).map(host => `https://${host}`);
      const options = authOptions(pool, process.env.BETTER_AUTH_SECRET, baseURL, origins);
      // Serialize first-use migrations across concurrent serverless instances.
      const connection = await pool.connect();
      try {
        await connection.query('BEGIN');
        await connection.query('SELECT pg_advisory_xact_lock(723420196)');
        const migrations = await getMigrations(options);
        await migrations.runMigrations();
        for (const query of policySchema) await connection.query(query);
        await connection.query('COMMIT');
      } catch (error) { await connection.query('ROLLBACK'); throw error; }
      finally { connection.release(); }
      await initialize();
      const auth = betterAuth(options);
      return { auth, policy: createPolicy(pool), secret: process.env.BETTER_AUTH_SECRET };
    } catch (error) { await pool.end(); throw error; }
  })().catch(error => { ready = undefined; throw error; });
  return ready;
}
export async function accountSession(request) {
  // Public browsing stays available when no account cookie is present.
  if (!(request.headers.get('cookie') || '').split(';').some(value => /^\s*(?:__Secure-)?composer\.session_token=/.test(value))) return null;
  const { auth } = await getAuthService();
  return auth.api.getSession({ headers: request.headers, query: { disableCookieCache: true, disableRefresh: true } });
}
