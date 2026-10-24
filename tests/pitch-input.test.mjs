import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from './helpers/composer-app.mjs';

test('pitch parsing handles equal temperament, octaves, enharmonics, case, and numeric units', () => {
  const a = app();
  const parse = text => a.run('parsePitch(' + JSON.stringify(text) + ')');
  for (const text of ['A4', 'a4', 'A', '440', '440.', '440 Hz', '4.4e2']) assert.equal(parse(text), 440);
  assert.equal(parse('A5'), 880);
  assert.ok(Math.abs(parse('C4') - 261.6255653005986) < 1e-9);
  for (const text of ['Db4', 'db4', 'D♭4', 'C♯4', ' c # 4 ']) assert.equal(parse(text), parse('C#4'));
  assert.equal(parse('Cb4'), parse('B3'));
  assert.equal(parse('B#3'), parse('C4'));
  assert.ok(Math.abs(parse('C-1') - 8.175798915643707) < 1e-10);
  assert.equal(parse(' '), '');
  for (const text of ['H4', 'A4junk', '440x', '0', '-1', 'Infinity', '1e999', 'C9999', '" onfocus="alert(1)']) assert.equal(parse(text), null);
  assert.equal(a.run('nearestNoteName(440.5)'), 'A4');
  assert.equal(a.run('nearestNoteName(455)'), 'A#4');
  assert.equal(a.run('nearestNoteName(261.6)'), 'C4');
  assert.equal(a.run("nearestNoteName(parsePitch('C-1'))"), 'C-1');
});

test('both modes accept both inputs, commit without interrupting typing, and preserve exact Hz through switches', async () => {
  const a = app();
  a.run("addRow('',0,0.5);onPitchInput(0,'A4')");
  assert.equal(a.getNotes()[0].freq, '440');
  assert.equal(a.getNotes()[0]._pitchDraft, 'A4');
  a.run("commitPitchInput(0,document.getElementById('noteFreq0'))");
  assert.equal(a.el('noteFreq0').value, '440');
  assert.equal(a.getNotes()[0]._pitchDraft, undefined);
  a.run("setPitchDisplayMode('note');onPitchInput(0,'443.21');commitPitchInput(0,document.getElementById('noteFreq0'))");
  assert.equal(a.el('noteFreq0').value, 'A4');
  assert.equal(a.el('noteFreq0').title, '443.21 Hz · A4');
  assert.equal(a.getNotes()[0].freq, '443.21');
  for (let i=0; i<5; i++) a.run("setPitchDisplayMode('frequency');setPitchDisplayMode('note')");
  assert.equal(a.getNotes()[0].freq, '443.21');
  assert.match(a.el('noteBody').innerHTML, /value="A4"/);
  assert.equal(JSON.parse(a.el('jsonEditor').value)[0].freq, 443.21);
  assert.equal(a.run('window.ComposerForum.snapshot().notes[0].freq'), 443.21);
  await a.run('playMelody()');
  assert.equal(a.oscillators.find(o => o.frequency.value > 0).frequency.value, 443.21);
  a.run("onPitchInput(0,'Db4');commitPitchInput(0,document.getElementById('noteFreq0'))");
  assert.equal(a.el('noteFreq0').value, 'C#4');
  a.run("setPitchDisplayMode('frequency')");
  assert.equal(a.run('pitchDisplayValue(notes[0].freq)'), String(a.run("parsePitch('C#4')")));
});

test('invalid drafts stay editable and escaped through row operations and mode changes', () => {
  const a = app();
  a.run("addRow(440,0,0.5);onPitchInput(0,'H4');setPitchDisplayMode('note');dupRow(0);insertRow(0)");
  assert.equal(a.getNotes()[1]._pitchDraft, 'H4');
  assert.equal(a.getNotes()[2]._pitchDraft, 'H4');
  assert.equal(a.run('getValidNotes().length'), 0);
  assert.match(a.el('noteBody').innerHTML, /aria-invalid="true"/);
  assert.match(a.el('noteBody').innerHTML, /请输入正数频率或音名/);
  a.run("onPitchInput(1,'A4');commitPitchInput(1,document.getElementById('noteFreq1'))");
  assert.equal(a.el('noteFreq1').getAttribute('aria-invalid'), 'false');
  assert.equal(a.el('pitchError1').textContent, '');
  const unsafe = '"><img src=x onerror=alert(1)>';
  a.run('onPitchInput(2,' + JSON.stringify(unsafe) + ');renderTable()');
  assert.ok(!a.el('noteBody').innerHTML.includes('<img'));
  assert.match(a.el('noteBody').innerHTML, /&quot;&gt;&lt;img/);
  a.run("onPitchInput(2,'');commitPitchInput(2,document.getElementById('noteFreq2'))");
  assert.equal(a.el('noteFreq2').value, '');
  assert.equal(a.el('noteFreq2').getAttribute('aria-invalid'), 'false');
});

test('imports, preset rows and timeline labels respect selected mode while JSON remains numeric', () => {
  const a = app();
  a.run("setPitchDisplayMode('note')");
  a.el('jsonEditor').value = '[{"freq":523.2511306011972,"start":0,"dur":1}]';
  a.run('importJSON();selectedTimelineNote=notes[0];drawTimeline()');
  assert.match(a.el('noteBody').innerHTML, /value="C5"/);
  assert.match(a.el('timelineSelection').textContent, /C5/);
  assert.ok(a.canvasCalls.some(x => x[0]==='fillText' && x[1]==='C5'));
  assert.equal(JSON.parse(a.el('jsonEditor').value)[0].freq, 523.2511306011972);
  a.run("loadPreset('scale')");
  assert.match(a.el('noteBody').innerHTML, /value="C4"/);
  a.run("setPitchDisplayMode('frequency')");
  assert.match(a.el('noteBody').innerHTML, /value="262"/);
});

