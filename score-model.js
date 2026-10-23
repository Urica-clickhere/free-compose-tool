(() => {
const MAX_COMMUNITY_DURATION_SECONDS = 240;
const TIMBRE_LABELS = Object.freeze({
  piano: '🎹 原声钢琴', electricPiano: '✨ 电钢琴', guitar: '🎸 拨弦吉他',
  musicBox: '🎶 八音盒', marimba: '🪵 马林巴', organ: '🎼 风琴',
  strings: '🎻 弦乐', pad: '🌌 氛围铺底', flute: '🪈 长笛',
  sine: '正弦波', triangle: '三角波', square: '方波', sawtooth: '锯齿波'
});
const TIMBRE_KEYS = Object.freeze(Object.keys(TIMBRE_LABELS));
function resolveNoteTimbre(note, defaultTimbre = 'piano') {
  const timbre = note.timbre ?? defaultTimbre;
  if (!TIMBRE_KEYS.includes(timbre)) throw new Error('音符的音色不正确');
  return timbre;
}
function scoreTimbres(score) {
  return [...new Set(score.notes.map(n => resolveNoteTimbre(n, score.timbre ?? 'piano')))];
}
// Arrays remain the format. Object imports also preserve a legacy global timbre/volume.
function readScoreDocument(data, defaultTimbre = 'piano', defaultVolume = 0.6) {
  const array = Array.isArray(data);
  const input = array ? data : data?.notes;
  if (!Array.isArray(input)) throw new Error('需要音符数组，或包含 notes 数组的乐谱');
  const timbre = array ? defaultTimbre : data.timbre ?? defaultTimbre;
  if (!TIMBRE_KEYS.includes(timbre)) throw new Error('默认音色不正确');
  const volume = array ? defaultVolume : data.volume ?? defaultVolume;
  if (typeof volume !== 'number' || !Number.isFinite(volume) || volume < 0 || volume > 1) throw new Error('音量需要在0–1之间');
  const numeric = (value, label) => {
    if (value === undefined || value === null || value === '') return '';
    if (!['number','string'].includes(typeof value) || !Number.isFinite(Number(value))) throw new Error(`${label}需要有效数字`);
    return Number(value);
  };
  const notes = input.map(n => {
    if (!n || typeof n !== 'object' || Array.isArray(n)) throw new Error('音符格式不正确');
    return { freq: numeric(n.freq, '频率'), start: numeric(n.start, '开始时间'), dur: numeric(n.dur ?? n.duration, '持续时间'), timbre: resolveNoteTimbre(n, timbre) };
  });
  return { notes, timbre, volume };
}
  globalThis.ComposerScoreModel = Object.freeze({ MAX_COMMUNITY_DURATION_SECONDS, TIMBRE_LABELS, TIMBRE_KEYS, resolveNoteTimbre, scoreTimbres, readScoreDocument });
})();
