import { randomBytes, createHash } from 'node:crypto';
const COOKIE = 'composer_visitor';
const hash = value => createHash('sha256').update(value).digest('hex');
export const accountActor = userId => hash(`account:${userId}`);
export function visitor(request, create = false) {
  const raw = (request.headers.get('cookie') || '').split(';').map(x => x.trim()).find(x => x.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
  const known = typeof raw === 'string' && /^[a-f0-9]{64}$/.test(raw);
  const token = known ? raw : create ? randomBytes(32).toString('hex') : null;
  return { actor: token ? hash(token) : '', cookie: !known && token ? `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}` : null };
}
