import '../score-model.js';
const { TIMBRE_KEYS, resolveNoteTimbre } = globalThis.ComposerScoreModel;
export class ForumError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const TIMBRES = TIMBRE_KEYS;
export function text(value, max, label, required = true) {
  if (typeof value !== 'string') throw new ForumError(400, `${label}格式不正确`);
  const clean = value.trim();
  if ((required && !clean) || clean.length > max) throw new ForumError(400, `${label}需要${required ? '1' : '0'}–${max}个字符`);
  return clean;
}
export function uuid(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new ForumError(400, '作品编号不正确');
  return value;
}
export function score(value) {
  if (!value || !TIMBRES.includes(value.timbre) || typeof value.volume !== 'number' || !Number.isFinite(value.volume) || value.volume < 0 || value.volume > 1) throw new ForumError(400, '音色或音量不正确');
  if (!Array.isArray(value.notes) || !value.notes.length || value.notes.length > 512) throw new ForumError(400, '作品需要1–512个音符');
  const notes = value.notes.map(n => {
    if (!n || ![n.freq, n.start, n.dur].every(v => typeof v === 'number' && Number.isFinite(v)) || n.freq < 20 || n.freq > 20000 || n.start < 0 || n.dur <= 0 || n.start + n.dur > 120) throw new ForumError(400, '音符频率需在20–20000 Hz之间，作品长度不能超过120秒');
    let timbre;
    try { timbre = resolveNoteTimbre(n, value.timbre); }
    catch { throw new ForumError(400, '音符的音色不正确'); }
    return { freq: n.freq, start: n.start, dur: n.dur, timbre };
  });
  return { notes, timbre: value.timbre, volume: value.volume };
}
export function postInput(body) {
  return { id: uuid(body.id), title: text(body.title, 80, '标题'), author: text(body.author, 24, '昵称'), description: text(body.description ?? '', 2000, '介绍', false), score: score(body.score) };
}
export function offset(value) {
  if (value === null) return 0;
  if (!/^\d{1,6}$/.test(value)) throw new ForumError(400, '分页参数不正确');
  return Number(value);
}
export function checkOrigin(request) {
  if (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') throw new ForumError(403, '请从本站提交内容');
  if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) throw new ForumError(415, '请使用JSON格式提交');
}
export async function readBody(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new ForumError(400, '内容不能为空');
  const chunks = []; let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 131072) { await reader.cancel(); throw new ForumError(413, '作品内容过大'); }
    chunks.push(value);
  }
  try {
    const all = new Uint8Array(bytes); let at = 0;
    for (const chunk of chunks) { all.set(chunk, at); at += chunk.length; }
    const body = JSON.parse(new TextDecoder().decode(all));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch { throw new ForumError(400, '提交内容格式不正确'); }
}
