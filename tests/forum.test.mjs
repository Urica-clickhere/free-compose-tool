import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { score, postInput, uuid, offset, checkOrigin, readBody } from '../lib/validation.js';
import { visitor, handleForum } from '../lib/forum.js';
const valid = { notes: [{ freq: 440, start: 0, dur: 1 }], timbre: 'piano', volume: 0.6 };
test('published scores reject invalid, oversized, non-finite and excessively long input', () => {
  assert.deepEqual(score(valid), {...valid, notes: valid.notes.map(n => ({...n,timbre:'piano'}))});
  for (const note of [{freq:0,start:0,dur:1}, {freq:440,start:-1,dur:1}, {freq:440,start:240,dur:1}, {freq:NaN,start:0,dur:1}, {freq:'440',start:0,dur:1}, null]) assert.throws(() => score({...valid,notes:[note]}));
  for (const extra of [{notes:[]}, {notes:Array(513).fill(valid.notes[0])}, {timbre:'unknown'}, {volume:Infinity}]) assert.throws(() => score({...valid,...extra}));
  assert.throws(() => postInput({id:'bad',title:'A',author:'B',score:valid}));
  assert.throws(() => postInput({id:'74ac61ea-9f78-4b5c-8e57-85a03d9457a5',title:' ',author:'B',score:valid}));
  assert.throws(() => uuid('not-an-id')); assert.throws(() => offset('-1'));
});
test('community client and server accept up to four minutes and reject any later note ending', async () => {
  const source = await readFile(new URL('../forum.js', import.meta.url), 'utf8');
  const context = vm.createContext({ window: { ComposerScoreModel: globalThis.ComposerScoreModel, addEventListener() {} } });
  // Run the actual client validation and its initialization without loading the community feed.
  vm.runInContext(source.slice(source.indexOf('const $ ='), source.indexOf('async function fetchPost(')), context);
  for (const [start, dur, accepted] of [[0, 120, true], [120, 1, true], [0, 239.999, true], [0, 240, true], [239, 1, true], [239.999, 0.002, false], [0, 240.001, false], [240, 1, false]]) {
    const input = { ...valid, notes: [{ freq: 440, start, dur }, ...valid.notes] };
    assert.equal(context.validScore(input), accepted, `client: ${start} + ${dur}`);
    if (accepted) assert.doesNotThrow(() => score(input));
    else assert.throws(() => score(input), { status: 400, message: /4分钟（240秒）/ });
  }
});
test('write requests require same-origin JSON and reject malformed or large bodies', async () => {
  const make = (origin, contentType='application/json', data='{}') => new Request('https://free-compose-tool.vercel.app/api/forum', {method:'POST',headers:{origin,'content-type':contentType},body:data});
  checkOrigin(make('https://free-compose-tool.vercel.app'));
  for(const req of [make('https://evil.example'),make('https://free-compose-tool.vercel.app','text/plain')]) assert.throws(() => checkOrigin(req));
  await assert.rejects(readBody(make('https://free-compose-tool.vercel.app','application/json','{')));
  await assert.rejects(readBody(make('https://free-compose-tool.vercel.app','application/json','a'.repeat(131073))));
  await assert.rejects(readBody(make('https://free-compose-tool.vercel.app','application/json','[]')));
  const response = await handleForum(make('https://evil.example'));
  assert.equal(response.status,403);
});
test('ownership tokens are unguessable, HTTP-only, secure and never exposed in JSON', () => {
  const request = new Request('https://free-compose-tool.vercel.app/api/forum');
  const a = visitor(request,true), b = visitor(request,true);
  assert.notEqual(a.actor,b.actor); assert.match(a.cookie,/HttpOnly; SameSite=Lax/); assert.match(a.cookie,/; Secure$/);
  const cookie = a.cookie.split(';')[0];
  const restored = visitor(new Request(request.url,{headers:{cookie}}),false);
  assert.equal(restored.actor,a.actor); assert.equal(restored.cookie,null);
  assert.notEqual(a.actor,cookie.split('=')[1]);
  assert.equal(visitor(request).actor,'');
});
