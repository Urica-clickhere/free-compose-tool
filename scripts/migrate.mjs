import { initialize } from '../lib/db.js';
import { getAuthService } from '../lib/auth.js';
try { await initialize(); await getAuthService(); console.log('Community and account databases are ready.'); }
catch { console.error('Database initialization failed; check the connection configuration.'); process.exitCode = 1; }
