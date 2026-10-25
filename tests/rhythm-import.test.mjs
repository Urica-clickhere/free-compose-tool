import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fromRecognition,check,toNotes,PPQ} from '../rhythm-model.js';
const n=(digit,x,extra={})=>({digit,div:0,dot:0,augment:0,octave:0,bbox:{x,y:90,w:20,h:30},...extra});
const score=nums=>({key:'C',beats:4,beatType:4,rows:[{nums,barlineXs:[400]}]});
function approve(m){m.headerConfirmed=true;m.measures.forEach(x=>x.confirmed=true);return m;}
test('beat sum does not waive manual rhythm confirmation',()=>{const m=fromRecognition(score([n(1,10),n(2,60),n(3,110),n(4,160)]));assert.ok(check(m).length);assert.throws(()=>toNotes(m));assert.equal(toNotes(approve(m)).length,4);});
test('dotted, diminished, augmented and rest durations preserve exact onset',()=>{const m=approve(fromRecognition(score([n(1,10,{div:1,dot:1}),n(0,60,{div:2}),n(3,110),n(4,160,{augment:1})])));m.bpm=60;const notes=toNotes(m);assert.deepEqual(notes.map(n=>[n.start,n.dur]),[[0,.75],[1,1],[2,2]]);});
test('wrong measure length blocks even with confirmation',()=>{const m=approve(fromRecognition(score([n(1,10)])));assert.throws(()=>toNotes(m),/拍数/);});
test('line wrap does not invent a measure boundary',()=>{const s=score([n(1,10),n(2,60)]);s.rows[0].barlineXs=[];s.rows.push({nums:[n(3,10),n(4,60)],barlineXs:[400]});assert.equal(fromRecognition(s).measures.length,1);});
test('repeat and tie marks block export',()=>{for(const mark of ['repeatBackward','tieStart']){const m=approve(fromRecognition(score([n(1,10,{augment:3,[mark]:true})])));assert.throws(()=>toNotes(m),/尚未支持/);}});
test('triplets use exact ticks',()=>{const m=approve(fromRecognition(score([n(1,10,{tuplet:{normal:2,actual:3}}),n(2,60,{tuplet:{normal:2,actual:3}}),n(3,110,{tuplet:{normal:2,actual:3}}),n(4,160,{augment:1})])));assert.equal(m.measures[0].events[0].durationTicks,PPQ*2/3);assert.equal(check(m).length,0);});
test('accidental carries only within its measure',()=>{const s=score([n(1,10,{accidental:'sharp',augment:1}),n(1,60,{augment:1})]);s.rows.push({nums:[n(1,10,{augment:3})],barlineXs:[400]});const a=toNotes(approve(fromRecognition(s)));assert.equal(a[0].freq,a[1].freq);assert.ok(a[2].freq<a[1].freq);});
test('invalid values and empty recognition block export',()=>{const m=approve(fromRecognition(score([])));assert.throws(()=>toNotes(m));});
