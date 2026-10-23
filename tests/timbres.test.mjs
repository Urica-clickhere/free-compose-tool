import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import '../score-model.js';
import { score as validateScore } from '../lib/validation.js';
const model = globalThis.ComposerScoreModel;
const html = await readFile(new URL('../index.html',import.meta.url),'utf8');
const inline = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1].replace(/\/\/ ─── Init ───[\s\S]*?(?=\/\/ Community previews)/, '');
const shared = await readFile(new URL('../score-model.js',import.meta.url),'utf8');
function app() {
  const elements=new Map(), oscillators=[],events=[];
  const classList={add(){},remove(){},toggle(){}};
  const canvas=new Proxy({}, {get:(o,key)=>key in o?o[key]:()=>{},set:(o,k,v)=>(o[k]=v,true)});
  const el=id=>{if(!elements.has(id)) elements.set(id,{value:'',innerHTML:'',textContent:'',classList,style:{},focus(){this.focused=true;},addEventListener(){},getContext:()=>canvas,parentElement:{getBoundingClientRect:()=>({width:1100,height:200})},getBoundingClientRect:()=>({width:1100,height:200})});return elements.get(id);};
  const parameter=()=>({value:0,setValueAtTime(value){this.value=value;},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}});
  class AudioContext {
    state='running'; currentTime=0; destination={};
    resume(){this.state='running';return Promise.resolve();}
    createGain(){return {gain:parameter(),connect(){},disconnect(){}};}
    createDynamicsCompressor(){return {threshold:parameter(),knee:parameter(),ratio:parameter(),attack:parameter(),release:parameter(),connect(){},disconnect(){}};}
    createOscillator(){const o={type:'sine',frequency:parameter(),detune:parameter(),connect(){},disconnect(){},addEventListener(){},start(t){this.startAt=t;},stop(t){this.stopAt=t;}};oscillators.push(o);return o;}
  }
  const context={Blob,TextEncoder,Event,console,AudioContext,performance:{now:()=>0},navigator:{clipboard:{writeText(){}}},setTimeout(){return 1;},clearTimeout(){},requestAnimationFrame(){return 1;},cancelAnimationFrame(){},addEventListener(){},dispatchEvent(e){events.push(e.type);},URL:{createObjectURL(blob){context.wav=blob;return 'blob:test';},revokeObjectURL(){}},document:{getElementById:el,addEventListener(){},removeEventListener(){},querySelectorAll:()=>[],createElement:()=>({click(){}})}};
  context.window=context;vm.createContext(context);vm.runInContext(shared,context);vm.runInContext(inline,context);
  return {context,el,oscillators,run:code=>vm.runInContext(code,context),getNotes:()=>JSON.parse(vm.runInContext('JSON.stringify(notes)',context))};
}
const mixed={notes:[{freq:440,start:0,dur:0.08,timbre:'piano'},{freq:523.25,start:0,dur:0.12,timbre:'strings'},{freq:659.25,start:0.05,dur:0.08,timbre:'guitar'},{freq:783.99,start:0.1,dur:0.08,timbre:'flute'}],timbre:'organ',volume:0.4};
test('13 timbres; legacy arrays and global scores inherit a stable default; explicit choices survive',()=>{
  assert.equal(model.TIMBRE_KEYS.length,13);
  const old=model.readScoreDocument([{freq:440,start:0,duration:0.5}],'guitar');assert.equal(old.notes[0].timbre,'guitar');
  const global=model.readScoreDocument({notes:[{freq:440,start:0,dur:0.5},{freq:523,start:0,dur:0.5,timbre:'strings'}],timbre:'flute',volume:0.2});
  assert.deepEqual(global.notes.map(n=>n.timbre),['flute','strings']);assert.equal(global.volume,0.2);
  assert.throws(()=>model.readScoreDocument([{freq:'\" onfocus=alert(1)',timbre:'piano'}]));
  assert.throws(()=>validateScore({...mixed,notes:[{...mixed.notes[0],timbre:'unknown'}]}));
  assert.deepEqual(validateScore(mixed),mixed);
  const legacy=validateScore({...mixed,notes:[{freq:440,start:0,dur:0.5}]});assert.equal(legacy.notes[0].timbre,'organ');
});
test('default changes affect new rows only; duplication, bulk apply and JSON preserve every timbre',()=>{
  const a=app();a.run("waveType='piano';addRow(440,0,0.5);waveType='guitar';addRows(2);dupRow(0)");
  assert.deepEqual(a.getNotes().map(n=>n.timbre),['piano','piano','guitar','guitar']);
  a.run("onInput(1,'timbre','strings');waveType='flute'");assert.equal(a.getNotes()[1].timbre,'strings');
  a.run('applyDefaultTimbre()');assert.deepEqual(a.getNotes().map(n=>n.timbre),Array(4).fill('flute'));
  a.el('jsonEditor').value=JSON.stringify(mixed);a.run('importJSON()');
  assert.deepEqual(a.getNotes().map(n=>n.timbre),mixed.notes.map(n=>n.timbre));
  assert.deepEqual(JSON.parse(a.el('jsonEditor').value),mixed.notes);
  a.el('jsonEditor').value='[{"freq":440,"start":0,"dur":0.5}]';a.run("waveType='guitar';importJSON();waveType='pad';syncJSON()");
  assert.equal(JSON.parse(a.el('jsonEditor').value)[0].timbre,'guitar');
  assert.equal((a.el('noteBody').innerHTML.match(/<option/g)||[]).length,13);
});
test('insert at the beginning, middle and end preserves existing notes and focuses the new row',()=>{
  for(const index of [0,2,mixed.notes.length]) {
    const a=app();a.el('jsonEditor').value=JSON.stringify(mixed);a.run("importJSON();waveType='flute'");
    const original=a.getNotes();
    a.run(`insertRow(${index})`);
    const expected=[...original];expected.splice(index,0,{freq:'',start:'',dur:'',timbre:'flute'});
    assert.deepEqual(a.getNotes(),expected);
    assert.equal(a.el(`noteFreq${index}`).focused,true);
    assert.match(a.el('noteBody').innerHTML,new RegExp(`在音符${index+1}后插入`));
    a.run(`onInput(${index},'freq','587.33');onInput(${index},'start','0.03');onInput(${index},'dur','0.06')`);
    const exported=JSON.parse(a.el('jsonEditor').value);
    assert.equal(exported.length,mixed.notes.length+1);
    assert.deepEqual(exported[index],{freq:587.33,start:0.03,dur:0.06,timbre:'flute'});
    a.run(`dupRow(${index});removeRow(${index+1});removeRow(${index})`);
    assert.deepEqual(a.getNotes(),original);
  }
  const empty=app();empty.run('insertRow(0)');assert.equal(empty.getNotes().length,1);
});
test('inserted notes are played at their entered time without shifting existing notes',async()=>{
  const a=app();a.el('jsonEditor').value=JSON.stringify(mixed);
  a.run("importJSON();waveType='flute';insertRow(2);onInput(2,'freq','587.33');onInput(2,'start','0.03');onInput(2,'dur','0.06')");
  await a.run('playMelody()');
  const profiles=a.run('TIMBRES');
  const expected=a.getNotes().flatMap(n=>profiles[n.timbre].partials.map(([ratio])=>({frequency:Number(n.freq)*ratio,startAt:0.025+Number(n.start)})));
  assert.deepEqual(a.oscillators.filter(o=>o.frequency.value>0).map(o=>({frequency:o.frequency.value,startAt:o.startAt})),expected);
});
test('real-time and community scheduling select individual profiles and preserve simultaneous onsets',async()=>{
  const a=app();a.el('jsonEditor').value=JSON.stringify(mixed);a.run('importJSON()');await a.run('playMelody()');
  const profiles=a.run('TIMBRES');const actual=a.oscillators.filter(o=>o.frequency.value>0);
  const expected=mixed.notes.flatMap(n=>profiles[n.timbre].partials.map(([ratio,,detune=0])=>({frequency:n.freq*ratio,detune,type:profiles[n.timbre].wave,startAt:0.025+n.start})));
  assert.deepEqual(actual.map(o=>({frequency:o.frequency.value,detune:o.detune.value,type:o.type,startAt:o.startAt})),expected.map(x=>({...x})));
  const before=a.oscillators.length;const duration=await a.context.ComposerForum.preview(mixed);
  const second=a.oscillators.slice(before).filter(o=>o.frequency.value>0);
  assert.equal(second.length,expected.length);
  assert.deepEqual(second.map(o=>o.type),expected.map(o=>o.type));
  assert.ok(Math.abs(duration-(Math.max(...mixed.notes.map(n=>n.start+n.dur+profiles[n.timbre].release))+0.1))<1e-9);
  assert.deepEqual(JSON.parse(a.run('JSON.stringify(window.ComposerForum.snapshot().notes)')),mixed.notes);
});
async function wav(notes) {
  const a=app();a.el('jsonEditor').value=JSON.stringify({...mixed,notes});a.run('importJSON();exportWAV()');
  const data=new DataView(await a.context.wav.arrayBuffer());const frames=data.getUint32(40,true)/2;
  return {data,frames,profiles:a.run('TIMBRES'),sample:i=>data.getInt16(44+i*2,true)};
}
test('WAV output mixes simultaneous instruments and retains the longest release tail',async()=>{
  const n0={freq:440,start:0,dur:0.08,timbre:'piano'},n1={freq:523.25,start:0,dur:0.08,timbre:'guitar'};
  const [p,g,both]=await Promise.all([wav([n0]),wav([n1]),wav([n0,n1])]);
  assert.equal(both.data.getUint32(24,true),44100);assert.equal(both.data.getUint16(22,true),1);
  const tail=Math.max(n0.dur+both.profiles.piano.release,n1.dur+both.profiles.guitar.release);
  assert.equal(both.frames,Math.ceil(tail*44100)+Math.floor(44100*0.05));
  let different=0;
  for(const i of [100,200,400,800,1500,2500]) {
    const x=p.sample(i),y=g.sample(i);if(x!==y)different++;
    const pcm=Math.tanh(Math.atanh(x/32767)+Math.atanh(y/32767))*32767;
    assert.ok(Math.abs(both.sample(i)-pcm)<4,`mixed sample ${i} should combine both waveforms`);
  }
  assert.ok(different>=5,'different instruments must generate different audio samples');
});
