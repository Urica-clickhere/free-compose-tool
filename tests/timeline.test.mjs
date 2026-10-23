import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from './helpers/composer-app.mjs';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
function load(notes) {
  const a = app();
  a.el('jsonEditor').value = JSON.stringify({ notes, timbre: 'sine', volume: 0.5 });
  a.run('importJSON()');
  return a;
}
const longNotes = Array.from({ length: 240 }, (_, i) => ({ freq: 440, start: i, dur: 0.25, timbre: 'sine' }));

test('automatic zoom preserves note width on long songs, short notes and narrow/high-DPI screens', () => {
  const a = load(longNotes);
  let view = a.run('timelineView()');
  assert.ok(view.visible < view.duration / 10, 'a long score must show a local window rather than squeeze in the full score');
  close(0.25 / view.visible * view.plotWidth, 36);
  a.el('timeline').rectWidth = 300; a.context.devicePixelRatio = 2; a.run('drawTimeline()');
  view = a.run('timelineView()');
  close(0.25 / view.visible * view.plotWidth, 36);
  assert.equal(a.el('timeline').width, 600);
  assert.equal(a.el('timeline').height, 360);
  const tiny = load(longNotes.map(n => ({ ...n, dur: 0.01 })));
  tiny.el('timeline').rectWidth = 300;
  const detail = tiny.run('timelineView()');
  close(0.01 / detail.visible * detail.plotWidth, 36);
});

test('zoom anchors the selected time and panning reaches the end without changing playback position', async () => {
  const a = load(longNotes);
  a.run('timelinePosition=60;setTimelineZoom(20, 60, 0.25)');
  let view = a.run('timelineView()');
  close((60 - view.start) / view.visible, 0.25);
  a.el('timelinePan').value = '1000'; await a.event('timelinePan', 'input');
  view = a.run('timelineView()'); close(view.end, view.duration); close(a.run('timelinePosition'), 60);
  a.run('resetTimelineZoom()'); view = a.run('timelineView()');
  assert.equal(a.run('timelineAutoZoom'), true);
  assert.ok(view.start <= 60 && view.end >= 60);
  a.el('timelineZoom').value = '0'; await a.event('timelineZoom', 'input');
  close(a.run('timelineView().start'), 0);
  close(a.run('timelineView().visible'), a.run('scoreDuration()'));
});

test('seeking skips ended notes and resumes overlapping notes and release tails at the correct offset', async () => {
  const input = [
    { freq: 220, start: 0, dur: 1, timbre: 'sine' },
    { freq: 330, start: 0, dur: 10, timbre: 'sine' },
    { freq: 440, start: 2, dur: 1, timbre: 'piano' },
    { freq: 550, start: 5, dur: 1, timbre: 'guitar' }
  ];
  const a = load(input); await a.run('playMelody(3.2)');
  const profiles = a.run('TIMBRES');
  const expected = input.slice(1).flatMap(n => profiles[n.timbre].partials.map(([ratio]) => ({
    freq: n.freq * ratio,
    start: 0.025 + Math.max(0, n.start - 3.2),
    stop: 0.025 + n.start + n.dur + profiles[n.timbre].release - 3.2 + 0.03
  })));
  const actual = a.oscillators.filter(o => o.frequency.value > 0);
  assert.equal(actual.length, expected.length);
  actual.forEach((o, i) => { close(o.frequency.value, expected[i].freq); close(o.startAt, expected[i].start); close(o.stopAt, expected[i].stop); });
  // A held sine note resumes near its sustain, not with a fresh full attack.
  const envelope = a.gains.find(g => g.gain.events.some(([type, , time]) => type === 'linear' && Math.abs(time - 0.03) < 1e-9));
  assert.ok(envelope);
  close(envelope.gain.events.find(([type]) => type === 'linear')[1], 1);
  const pianoTail = a.gains.filter(g => g.gain.events.some(([type, , time]) => type === 'linear' && Math.abs(time - 0.03) < 1e-9))[1];
  assert.ok(pianoTail.gain.events.find(([type]) => type === 'linear')[1] < profiles.piano.sustain);
});

test('audio clock drives progress; pause, resume, seek and end clean up previous voices and frames', async () => {
  const a = load(longNotes); await a.run('playMelody(20)');
  const previous = a.oscillators.filter(o => o.frequency.value > 0);
  const oldMaster = a.run('workbenchPlayback.masterGain');
  a.frame(2.025); close(a.run('timelinePosition'), 22);
  a.run('toggleTimelinePlayback()'); close(a.run('timelinePosition'), 22);
  assert.equal(a.run('workbenchPlayback'), null); assert.equal(a.frames.size, 0);
  assert.ok(oldMaster.disconnected); assert.ok(previous.every(o => o.stopCalls.at(-1) === undefined));
  await a.run('playMelody()'); close(a.run('workbenchPlayback.offset'), 22);
  a.frame(3.05); close(a.run('timelinePosition'), 23);
  a.run('stopMelody()'); close(a.run('timelinePosition'), 0);
  const end = a.run('scoreDuration()'); await a.run(`playMelody(${end})`);
  assert.equal(a.run('workbenchPlayback'), null); close(a.run('timelinePosition'), end);
  await a.run('playMelody()'); close(a.run('workbenchPlayback.offset'), 0);
  a.frame(a.run('workbenchPlayback.startedAt + workbenchPlayback.end'));
  assert.equal(a.run('workbenchPlayback'), null); assert.equal(a.frames.size, 0);
  close(a.run('timelinePosition'), end);
});

test('canvas click/drag and range input preview a target and start only on commit; cancellation restores position', async () => {
  const a = load(longNotes);
  const view = a.run('timelineView()');
  await a.event('timeline', 'pointerdown', { button: 0, pointerId: 1, clientX: 55 + view.plotWidth * 0.25 });
  await a.event('timeline', 'pointermove', { pointerId: 1, clientX: 55 + view.plotWidth * 0.75 });
  close(a.run('timelinePosition'), view.visible * 0.75);
  assert.equal(a.run('workbenchPlayback'), null); assert.equal(a.oscillators.length, 0);
  await a.event('timeline', 'pointerup', { pointerId: 1, clientX: 55 + view.plotWidth * 0.75 });
  close(a.run('workbenchPlayback.offset'), view.visible * 0.75);
  a.run('stopMelody()');
  await a.event('timeline', 'pointerdown', { button: 0, pointerId: 2, clientX: 55 });
  await a.event('timeline', 'pointerup', { pointerId: 2, clientX: 55 });
  close(a.run('workbenchPlayback.offset'), 0);
  a.run('stopMelody();timelinePosition=10');
  await a.event('timelineSeek', 'pointerdown');
  a.el('timelineSeek').value = '120'; await a.event('timelineSeek', 'input');
  close(a.run('timelinePosition'), 120); assert.equal(a.run('workbenchPlayback'), null);
  await a.event('timelineSeek', 'pointercancel'); close(a.run('timelinePosition'), 10);
  assert.equal(a.run('workbenchPlayback'), null);
  a.el('timelineSeek').value = '100'; await a.event('timelineSeek', 'input');
  await a.event('timelineSeek', 'change'); close(a.run('workbenchPlayback.offset'), 100);
});

test('keyboard seeking and wheel zoom use displayed coordinates and playback follows the moving position', async () => {
  const a = load(longNotes);
  await a.event('timeline', 'keydown', { key: 'ArrowRight', shiftKey: true });
  close(a.run('workbenchPlayback.offset'), 10);
  a.frame(20.025);
  let view = a.run('timelineView()');
  assert.ok(view.start <= 30 && view.end >= 30);
  a.run('stopMelody()');
  view = a.run('timelineView()');
  const anchor = view.start + view.visible * 0.7;
  await a.event('timeline', 'wheel', { ctrlKey: true, deltaY: -50, clientX: 55 + view.plotWidth * 0.7 });
  const zoomed = a.run('timelineView()');
  close(zoomed.start + zoomed.visible * 0.7, anchor);
  assert.ok(zoomed.visible < view.visible);
});

test('rapid seeks and stop during audio unlock cannot revive stale playback', async () => {
  const a = load(longNotes);
  a.context.waitForAudio = new Promise(resolve => { a.context.releaseAudio = resolve; });
  a.run("audioCtx=getAudioCtx();audioCtx.state='suspended';audioCtx.resume=()=>waitForAudio.then(()=>{audioCtx.state='running';})");
  const first = a.run('playMelody(10)'), second = a.run('playMelody(20)');
  a.context.releaseAudio(); await Promise.all([first, second]);
  close(a.run('workbenchPlayback.offset'), 20);
  assert.equal(a.oscillators.filter(o => o.frequency.value > 0).length, longNotes.length - 20);
  a.run('stopMelody()');
  a.context.waitForAudio = new Promise(resolve => { a.context.releaseAudio = resolve; });
  a.run("audioCtx.state='suspended'");
  const pending = a.run('playMelody(50)'); a.run('stopMelody()');
  a.context.releaseAudio(); await pending;
  assert.equal(a.run('workbenchPlayback'), null); assert.equal(a.frames.size, 0);
});

test('empty scores, invalid values and score replacement leave finite, disabled controls and reset the view', async () => {
  const a = load(longNotes); await a.run('playMelody(200)');
  a.run("loadPreset('twinkle')");
  assert.equal(a.run('workbenchPlayback'), null); close(a.run('timelinePosition'), 0);
  a.run('clearAll()');
  assert.ok(a.el('timelineSeek').disabled); assert.ok(a.el('timelineZoom').disabled); assert.ok(a.el('timelinePlay').disabled);
  assert.equal(a.el('timeline').getAttribute('aria-disabled'), 'true');
  await a.run('playMelody()'); assert.equal(a.run('workbenchPlayback'), null);
  a.run("addRow('Infinity','0','1');addRow('440','Infinity','1');addRow('440','0','Infinity')");
  assert.equal(a.run('getValidNotes().length'), 0);
  assert.ok(!a.el('timelineTime').textContent.includes('NaN'));
});
