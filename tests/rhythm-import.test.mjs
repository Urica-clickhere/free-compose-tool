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
test('repeat marks still block export',()=>{const m=approve(fromRecognition(score([n(1,10,{augment:3,repeatBackward:true})])));assert.throws(()=>toNotes(m),/尚未支持/);});
test('triplets use exact ticks',()=>{const m=approve(fromRecognition(score([n(1,10,{tuplet:{normal:2,actual:3}}),n(2,60,{tuplet:{normal:2,actual:3}}),n(3,110,{tuplet:{normal:2,actual:3}}),n(4,160,{augment:1})])));assert.equal(m.measures[0].events[0].durationTicks,PPQ*2/3);assert.equal(check(m).length,0);});
test('accidental carries only within its measure',()=>{const s=score([n(1,10,{accidental:'sharp',augment:1}),n(1,60,{augment:1})]);s.rows.push({nums:[n(1,10,{augment:3})],barlineXs:[400]});const a=toNotes(approve(fromRecognition(s)));assert.equal(a[0].freq,a[1].freq);assert.ok(a[2].freq<a[1].freq);});
test('invalid values and empty recognition block export',()=>{const m=approve(fromRecognition(score([])));assert.throws(()=>toNotes(m));});

test('same-pitch ties merge durations without moving subsequent notes',()=>{
 const m=approve(fromRecognition(score([n(1,10,{tieStart:true,div:1,dot:1}),n(1,60,{tieStop:true,div:2}),n(2,110),n(3,160,{augment:1})])));m.bpm=60;
 assert.equal(m.measures[0].events[0].tieStart,true);
 assert.deepEqual(toNotes(m).map(n=>[n.start,n.dur]),[[0,1],[1,1],[2,2]]);
 assert.deepEqual(m.measures[0].events.map(e=>e.durationTicks),[PPQ*.75,PPQ*.25,PPQ,PPQ*2]);
});
test('tie chains cross measures and rows, inherit accidentals only for tied notes',()=>{
 const s=score([n(1,10,{accidental:'sharp',augment:3,tieStart:true})]);
 s.rows.push({nums:[n(1,10,{tieStop:true,tieStart:true}),n(1,60,{tieStop:true}),n(1,110),n(2,160)],barlineXs:[400]});
 const m=approve(fromRecognition(s));m.bpm=60;const notes=toNotes(m);
 assert.equal(check(m).length,0);assert.deepEqual(notes.map(n=>[n.start,n.dur]),[[0,6],[6,1],[7,1]]);
 assert.ok(notes[0].freq>notes[1].freq);
});
test('same-pitch adjacent notes without a tie remain separate; slurs do not merge pitches',()=>{
 const m=approve(fromRecognition(score([n(1,10,{slurStart:1}),n(1,60),n(2,110,{slurStop:1}),n(0,160)])));
 assert.equal(toNotes(m).length,3);
});
test('unpaired, nonadjacent, rest and different-pitch ties report actionable errors',()=>{
 for(const [nums,message] of [
  [[n(1,10,{augment:3,tieStop:true})],/第 1 小节第 1 个音符.*缺少起点/],
  [[n(1,10,{augment:3,tieStart:true})],/缺少终点/],
  [[n(1,10,{tieStart:true}),n(2,60),n(1,110,{tieStop:true}),n(0,160)],/缺少紧接的终点/],
  [[n(1,10,{augment:1,tieStart:true}),n(2,60,{augment:1,tieStop:true})],/音高不同/],
  [[n(1,10,{augment:1,tieStart:true}),n(1,60,{augment:1,octave:1,tieStop:true})],/音高不同/],
  [[n(1,10,{augment:1,accidental:'sharp',tieStart:true}),n(1,60,{augment:1,accidental:'natural',tieStop:true})],/音高不同/],
  [[n(1,10,{augment:1,tieStart:true}),n(0,60,{augment:1,tieStop:true})],/休止符/],
  [[n(0,10,{augment:1,tieStart:true}),n(1,60,{augment:1,tieStop:true})],/休止符/]
 ]) assert.throws(()=>toNotes(approve(fromRecognition(score(nums)))),message);
});
test('repairing detected tie endpoints clears the blocker',()=>{
 const m=approve(fromRecognition(score([n(1,10,{augment:1,tieStart:true}),n(1,60,{augment:1})])));
 assert.throws(()=>toNotes(m),/延音线/);m.measures[0].events[1].tieStop=true;
 assert.equal(toNotes(m).length,1);m.measures[0].events[0].tieStart=false;m.measures[0].events[1].tieStop=false;
 assert.equal(toNotes(m).length,2);
});
test('tied triplet ticks remain exact and preserve rests on the timeline',()=>{
 const s=score([n(1,10,{tuplet:{normal:2,actual:3},tieStart:true}),n(1,60,{tuplet:{normal:2,actual:3},tieStop:true,tieStart:true}),n(1,110,{tuplet:{normal:2,actual:3},tieStop:true}),n(0,160),n(2,200)]);
 const m=approve(fromRecognition(s));m.bpm=60;
 assert.deepEqual(toNotes(m).map(n=>[n.start,n.dur]),[[0,2],[3,1]]);
});
