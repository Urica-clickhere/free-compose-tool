import { initialize } from '../lib/db.js';
try { await initialize(); console.log('Community database is ready.'); }
catch { console.error('Database initialization failed; check the connection configuration.'); process.exitCode = 1; }
