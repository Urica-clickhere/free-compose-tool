import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from './helpers/composer-app.mjs';
import {fromRecognition,toNotes} from '../rhythm-model.js';

const score = [{ freq: 440, start: 0, dur: 0.5, timbre: 'guitar' }];
test('recognized tied rhythm survives workbench and JSON file round trip',async()=>{
  const nums=[1,1,2,3].map((digit,i)=>({digit,octave:0,div:0,dot:0,augment:0,bbox:{x:20+i*50,y:90,w:20,h:30},tieStart:i===0,tieStop:i===1}));
  const model=fromRecognition({key:'C',tempo:60,beats:4,beatType:4,rows:[{nums,barlineXs:[400]}]});
  model.headerConfirmed=true;model.measures[0].confirmed=true;
  const notes=toNotes(model), a=app();
  a.run(`window.ComposerForum.import(${JSON.stringify(notes)})`);
  const json=a.el('jsonEditor').value;
  assert.deepEqual(JSON.parse(json).map(n=>[n.start,n.dur]),[[0,2],[2,1],[3,1]]);
  await choose(a,json,'tied-melody.json');
  assert.deepEqual(JSON.parse(a.el('jsonEditor').value),notes);
  assert.match(a.el('jsonImportStatus').textContent,/已导入.*3 个音符/);
});
function choose(a, text, name = 'melody.json') {
  const file = new Blob([text], { type: 'application/json' });
  file.name = name;
  a.el('jsonFileInput').files = [file];
  a.el('jsonFileInput').value = name;
  return a.event('jsonFileInput', 'change');
}

test('file imports arrays, BOM and legacy settings; resets picker for same-file reimport', async () => {
  const a = app();
  await choose(a, JSON.stringify(score));
  assert.deepEqual(JSON.parse(a.el('jsonEditor').value), score);
  assert.equal(a.el('jsonFileInput').value, '');
  assert.equal(a.el('jsonFileButton').disabled, false);
  assert.match(a.el('jsonImportStatus').textContent, /melody.json.*1 个音符/);
  await a.run('playMelody()');
  await choose(a, '\uFEFF' + JSON.stringify({ notes: [{ freq: 220, start: 1, duration: 2 }], timbre: 'flute', volume: 0.3 }));
  assert.deepEqual(a.getNotes(), [{ freq: '220', start: '1', dur: '2', timbre: 'flute' }]);
  assert.equal(a.run('volume'), 0.3);
  assert.equal(a.el('playingIndicator').classList.contains('active'), false);
  await choose(a, JSON.stringify(score));
  assert.deepEqual(JSON.parse(a.el('jsonEditor').value), score);
});

test('invalid, oversized and unreadable files preserve score; cancel is silent', async () => {
  const a = app();
  await choose(a, JSON.stringify(score));
  const before = a.getNotes();
  for (const text of ['', '{', '{}', '[{"freq":"bad"}]', '{"notes":[],"volume":5}']) {
    await choose(a, text);
    assert.deepEqual(a.getNotes(), before);
    assert.deepEqual(JSON.parse(a.el('jsonEditor').value), score);
    assert.match(a.el('jsonImportStatus').textContent, /导入失败，当前编曲未更改/);
  }
  for (const file of [
    { name: 'large.json', size: 1024 * 1024 + 1, text() { throw new Error('must not read oversized files'); } },
    { name: 'unreadable.json', size: 10, async text() { throw new Error('无法读取文件'); } }
  ]) {
    a.el('jsonFileInput').files = [file];
    await a.event('jsonFileInput', 'change');
    assert.deepEqual(a.getNotes(), before);
    assert.match(a.el('jsonImportStatus').textContent, /1 MB|无法读取文件/);
    assert.equal(a.el('jsonFileInput').disabled, false);
    assert.equal(a.el('jsonFileInput').value, '');
  }
  const message = a.el('jsonImportStatus').textContent;
  a.el('jsonFileInput').files = [];
  await a.event('jsonFileInput', 'change');
  assert.equal(a.el('jsonImportStatus').textContent, message);
  assert.deepEqual(a.getNotes(), before);
  a.el('jsonEditor').value = JSON.stringify(score);
  a.run('importJSON()');
  assert.match(a.el('jsonImportStatus').textContent, /已导入 1 个音符/);
});

