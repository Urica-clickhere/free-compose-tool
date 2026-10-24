import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from './helpers/composer-app.mjs';

test('numbered notation recognizes dots, keyboard octaves, accidentals and all twelve keys', () => {
  const a = app();
  a.run("setPitchDisplayMode('jianpu')");
  const parse = text => a.run('parsePitch(' + JSON.stringify(text) + ')');
  for (let key=0;key<12;key++) {
    a.run('setJianpuKey(' + key + ')');
    for (const [i,offset] of [0,2,4,5,7,9,11].entries()) {
      const frequency = 440 * 2 ** ((60+key+offset-69)/12);
      assert.equal(parse(String(i+1)), frequency);
      for (const octave of [-2,-1,0,1,2]) {
        const symbol = a.run('jianpuSymbol('+(i+1)+','+octave+')');
        assert.ok(Math.abs(parse(symbol)/frequency - 2**octave) < 1e-10);
        assert.equal(a.run('nearestJianpu('+parse(symbol)+')'), symbol);
      }
    }
  }
  a.run('setJianpuKey(0)');
  assert.equal(parse("1'"), parse('1̇'));
  assert.equal(parse('1,'), parse('1̣'));
  assert.equal(parse("1''"), parse('1̈'));
  assert.equal(parse('1,,'), parse('1̤'));
  assert.equal(parse('♯1'), parse('♭2'));
  assert.equal(parse('440 Hz'), 440);
  assert.equal(parse('A4'), 440);
  for(const text of ['12345','8','0','1̣̇',"1',",'#8','1,,,,,,,,,']) assert.equal(parse(text), null);
});

test('mode and key changes preserve frequencies without reinterpreting uncommitted drafts', () => {
  const a = app();
  a.run("addRow('',0,1);setPitchDisplayMode('jianpu');onPitchInput(0,'1');setJianpuKey(2)");
  assert.equal(Number(a.getNotes()[0].freq), a.run("parseJianpu('1')/2**(2/12)"));
  const before = a.getNotes()[0].freq;
  a.run("setPitchDisplayMode('frequency')");
  assert.equal(a.getNotes()[0].freq,before);
  a.run("onPitchInput(0,'1');setPitchDisplayMode('jianpu')");
  assert.equal(a.getNotes()[0].freq,'1'); // Existing 1 Hz must not become scale degree 1.
  a.run("onPitchInput(0,'123');setPitchDisplayMode('frequency');renderTable()");
  assert.match(a.el('noteBody').innerHTML,/value="123"/);
  assert.match(a.el('noteBody').innerHTML,/aria-invalid="true"/);
  a.run("onPitchInput(0,'440');commitPitchInput(0,document.getElementById('noteFreq0'))");
  assert.equal(a.getNotes()[0].freq,'440');
  assert.equal(a.el('noteFreq0').getAttribute('aria-invalid'),'false');
});

test('quick melody creates timed notes at score end and validates whole sequence before changing score', async () => {
  const a = app();
  a.run("addRow(220,1,1);setPitchDisplayMode('jianpu');setJianpuKey(2);waveType='flute'");
  a.el('jianpuTempo').value='120';
  a.el('jianpuSequence').value="123 | 1̇ 1, #4";
  a.run('appendJianpu()');
  const notes=a.getNotes();
  assert.equal(notes.length,7);
  assert.deepEqual(notes.slice(1).map(n=>Number(n.start)),[2,2.5,3,3.5,4,4.5]);
  assert.ok(notes.slice(1).every(n=>n.dur==='0.5' && n.timbre==='flute'));
  assert.equal(Number(notes[1].freq),a.run("parseJianpu('1')"));
  assert.equal(Number(notes[4].freq),a.run("parseJianpu('1̇')"));
  assert.equal(Number(notes[5].freq),a.run("parseJianpu('1,')"));
  assert.ok(JSON.parse(a.el('jsonEditor').value).every(n=>typeof n.freq==='number'));
  assert.equal(a.run('window.ComposerForum.snapshot().notes.length'),7);
  await a.run('playMelody()');
  assert.ok(a.oscillators.some(o=>o.frequency.value===Number(notes[1].freq)));
  const before=a.getNotes();
  for(const value of ['1238','123x', "1',",'1'.repeat(513),'','|||']) {
    a.el('jianpuSequence').value=value;
    a.run('appendJianpu()');
    assert.deepEqual(a.getNotes(),before);
  }
  a.el('jianpuSequence').value='123';
  a.el('jianpuTempo').value='0';
  a.run('appendJianpu()');
  assert.deepEqual(a.getNotes(),before);
  assert.match(a.el('jianpuStatus').textContent,/20–300/);
});

test('copy boxes use clipboard or select the text for manual copying', async () => {
  const a = app();
  a.el('jianpuCopy3').value='1̇ 2̇ 3̇ 4̇ 5̇ 6̇ 7̇';
  let copied;
  a.context.navigator.clipboard.writeText=async value=>{copied=value};
  await a.run("copyJianpuRow('jianpuCopy3')");
  assert.equal(copied,a.el('jianpuCopy3').value);
  assert.match(a.el('jianpuStatus').textContent,/已复制/);
  a.context.navigator.clipboard.writeText=async()=>{throw Error('Clipboard disabled')};
  let selected=false;
  a.el('jianpuCopy3').select=()=>{selected=true};
  await a.run("copyJianpuRow('jianpuCopy3')");
  assert.equal(selected,true);
  assert.equal(a.el('jianpuCopy3').focused,true);
  assert.match(a.el('jianpuStatus').textContent,/Ctrl\+C/);
});

