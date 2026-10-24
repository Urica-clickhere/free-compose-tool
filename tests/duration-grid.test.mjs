import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from './helpers/composer-app.mjs';

test('shared BPM controls the quarter-beat duration min and step in every pitch mode', () => {
  const a=app();
  a.run('addRow(440,0,1)');
  for(const bpm of [60,120,240,137]) {
    a.run('setComposerBpm('+bpm+')');
    const step=a.run('durationStep()');
    assert.ok(Math.abs(step-15/bpm)<1e-12);
    for(const mode of ['frequency','note','jianpu']) {
      a.run('setPitchDisplayMode('+JSON.stringify(mode)+')');
      assert.ok(a.el('noteBody').innerHTML.includes('step="'+step+'" min="'+step+'"'));
      assert.equal(a.el('durationGridValue').textContent,String(step));
      assert.equal(a.el('jianpuTempo').value,String(bpm));
    }
  }
});

test('manual duration commits clamp to minimum but preserve blanks and off-grid timings', () => {
  const a=app();
  a.run('setComposerBpm(120);addRow(440,0,0.5)');
  const commit=value=>{
    a.el('noteDur0').value=value;
    a.run("commitDuration(0,document.getElementById('noteDur0'))");
  };
  for(const value of ['0.01','0','-3']) {
    commit(value);
    assert.equal(a.getNotes()[0].dur,'0.125');
    assert.equal(a.el('noteDur0').value,'0.125');
  }
  commit('0.4');
  assert.equal(a.getNotes()[0].dur,'0.4');
  assert.equal(JSON.parse(a.el('jsonEditor').value)[0].dur,0.4);
  commit('');
  assert.equal(a.getNotes()[0].dur,'');
  a.run('stepDuration(0,1)');
  assert.equal(a.getNotes()[0].dur,'0.125');
});

test('buttons and arrow keys add exactly one quarter beat without snapping off-grid values', async () => {
  const a=app();
  a.run('setComposerBpm(120);addRow(440,0,0.4)');
  await a.run('playMelody()');
  a.run('stepDuration(0,1)');
  assert.equal(a.getNotes()[0].dur,'0.525');
  assert.equal(a.el('playingIndicator').classList.contains('active'),false);
  a.run('stepDuration(0,-1)');
  assert.equal(a.getNotes()[0].dur,'0.4');
  let prevented=0;
  a.context.keyEvent={key:'ArrowUp',preventDefault(){prevented++}};
  a.run('durationKey(0,keyEvent)');
  assert.equal(a.getNotes()[0].dur,'0.525');
  a.context.keyEvent.key='ArrowDown';
  a.run('durationKey(0,keyEvent)');
  assert.equal(a.getNotes()[0].dur,'0.4');
  assert.equal(prevented,2);
  a.el('noteDur0').value='0.01';
  a.context.keyEvent={key:'Enter',target:a.el('noteDur0'),preventDefault(){prevented++}};
  a.run('durationKey(0,keyEvent);stepDuration(0,-1)');
  assert.equal(a.getNotes()[0].dur,'0.125');
  a.run('setComposerBpm(137)');
  const before=Number(a.getNotes()[0].dur);
  for(let i=0;i<20;i++) a.run('stepDuration(0,1);stepDuration(0,-1)');
  assert.ok(Math.abs(Number(a.getNotes()[0].dur)-before)<1e-10);
});

test('tempo changes clamp short notes without scaling other times; quick notation uses the same BPM', () => {
  const a=app();
  a.run("addRow(440,2,0.1);addRow(550,3,0.4);addRow();setComposerBpm(60)");
  assert.deepEqual(a.getNotes().map(n=>n.dur),['0.25',0.4,'']);
  assert.deepEqual(a.getNotes().map(n=>n.start),[2,3,'']);
  assert.match(a.el('tempoStatus').textContent,/1 个过短音符/);
  const before=a.getNotes();
  for(const value of [0,-1,301,'NaN','Infinity']) {
    a.run('setComposerBpm('+JSON.stringify(value)+')');
    assert.equal(a.run('composerBpm'),60);
    assert.equal(a.el('jianpuTempo').value,'60');
    assert.deepEqual(a.getNotes(),before);
  }
  a.run("setPitchDisplayMode('jianpu')");
  a.el('jianpuSequence').value='123';
  a.run('appendJianpu()');
  assert.deepEqual(a.getNotes().slice(-3).map(n=>Number(n.dur)),[1,1,1]);
  assert.equal(a.run('durationStep()'),0.25);
});


test('BPM is unset by default; clearing it preserves notes and restores second-based editing', () => {
  const a=app();
  assert.equal(a.run('composerBpm'),null);
  assert.equal(a.run('durationStep()'),0.01);
  a.run('addRow(440,0,0.03);stepDuration(0,1)');
  assert.equal(a.getNotes()[0].dur,'0.04');
  a.run('setComposerBpm(120)');
  assert.equal(a.getNotes()[0].dur,'0.125');
  const before=a.getNotes();
  a.run("setComposerBpm('')");
  assert.deepEqual(a.getNotes(),before);
  assert.equal(a.run('composerBpm'),null);
  assert.equal(a.el('jianpuTempo').value,'');
  assert.equal(a.el('durationGridValue').textContent,'0.01');
  assert.match(a.el('durationGridRule').textContent,/未设置 BPM/);
  assert.match(a.el('noteBody').innerHTML,/step="0.01" min="0.01"/);
  assert.match(a.el('noteBody').innerHTML,/title="增加 0.01 秒"/);
  a.el('noteDur0').value='0.035';
  a.run("commitDuration(0,document.getElementById('noteDur0'));stepDuration(0,1)");
  assert.equal(a.getNotes()[0].dur,'0.045');
  a.run('setComposerBpm(0)');
  assert.equal(a.run('composerBpm'),null);
  assert.equal(a.el('jianpuTempo').value,'');
  a.run('setComposerBpm(240)');
  assert.equal(a.run('durationStep()'),0.0625);
});

test('quick numbered notation works without BPM and does not secretly enable a tempo', () => {
  const a=app();
  a.run("setPitchDisplayMode('jianpu')");
  a.el('jianpuSequence').value='123';
  a.run('appendJianpu()');
  assert.deepEqual(a.getNotes().map(n=>Number(n.dur)),[0.5,0.5,0.5]);
  assert.deepEqual(a.getNotes().map(n=>Number(n.start)),[0,0.5,1]);
  assert.equal(a.run('composerBpm'),null);
  assert.equal(a.el('jianpuTempo').value,'');
  assert.match(a.el('jianpuStatus').textContent,/0.5 秒/);
  a.run('setComposerBpm(60)');
  a.el('jianpuSequence').value='4';
  a.run('appendJianpu()');
  assert.equal(a.getNotes().at(-1).dur,'1');
  assert.match(a.el('jianpuSequenceLabel').textContent,/一拍/);
  a.run("setComposerBpm('   ')");
  assert.match(a.el('jianpuSequenceLabel').textContent,/0.5 秒/);
});

