// Quarter-note ticks: exact for supported subdivisions and common tuplets.
export const PPQ = 6720;
const keys = {C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11};
const unsupported = ['repeatForward','repeatBackward','endingStart','endingStop','jumpMarks','segno','timeChange','grace','fermata','ornament','fall'];
export function fromRecognition(score) {
  const measures = []; let events = [];
  const flush = () => { if (events.length) { measures.push({ events, confirmed:false }); events=[]; } };
  const blockers=[];
  if (score.minor || score.meters?.length > 1) blockers.push('暂不支持小调标记或混合拍号，请先在乐谱编辑器中展开处理');
  for (const [rowIndex,row] of score.rows.entries()) {
    if ((row.voice ?? 0) !== 0) blockers.push('暂不支持多声部谱');
    const bars=[...row.barlineXs].sort((a,b)=>a-b); let bar=0;
    for (const n of row.nums) {
      while (bar < bars.length && bars[bar] < n.bbox.x) { flush(); bar++; }
      const marks=unsupported.filter(k => Array.isArray(n[k]) ? n[k].length : n[k]);
      if (marks.length) blockers.push(`第 ${rowIndex+1} 行含尚未支持的演奏记号：${marks.join(', ')}`);
      const duration=(2 ** -n.div * (2 - 2 ** -n.dot) + n.augment) * (n.tuplet ? n.tuplet.normal/n.tuplet.actual : 1);
      events.push({degree:n.digit,octave:n.octave,accidental:n.accidental || '',durationTicks:Math.round(duration*PPQ),tieStart:!!n.tieStart,tieStop:!!n.tieStop,
        invalidDuration:!Number.isInteger(Math.round(duration*PPQ*1e6)/1e6),bbox:n.bbox,row:rowIndex,doubt:n.doubt || [],marks:{div:n.div,dot:n.dot,augment:n.augment,tuplet:n.tuplet}});
    }
    // A line break is not a barline. Carry an unfinished measure into the next row.
    if (bar < bars.length) flush();
  }
  flush();
  return {key:score.key,bpm:score.tempo ? score.tempo*(score.tempoBeat ? 4*score.tempoBeat.num/score.tempoBeat.den : 1) : 68,beats:score.beats,beatType:score.beatType,measures,blockers:[...new Set(blockers)],headerConfirmed:false};
}
export function check(model) {
  const errors=[...model.blockers];
  if (!(model.key in keys)) errors.push('请确认调号');
  if (!Number.isFinite(model.bpm) || model.bpm<20 || model.bpm>300) errors.push('速度应为每分钟 20–300 个四分音符');
  if (!Number.isInteger(model.beats) || model.beats<1 || model.beats>16 || ![2,4,8,16].includes(model.beatType)) errors.push('拍号无效');
  if (!model.headerConfirmed) errors.push('请核对调号、拍号、速度及谱面是否为单旋律');
  if (!model.measures.length) errors.push('没有识别到音符');
  for (const [i,m] of model.measures.entries()) {
    const expected=m.expectedTicks ?? model.beats*4/model.beatType*PPQ;
    if (!Number.isSafeInteger(expected) || expected<=0 || expected>model.beats*4/model.beatType*PPQ) errors.push(`第 ${i+1} 小节目标拍数无效`);
    if (m.events.reduce((s,e)=>s+e.durationTicks,0)!==expected) errors.push(`第 ${i+1} 小节拍数不符`);
    if (!m.confirmed) errors.push(`第 ${i+1} 小节尚未对照原图确认`);
    if (m.events.some(e=>!Number.isInteger(e.degree)||e.degree<0||e.degree>7||!Number.isInteger(e.octave)||Math.abs(e.octave)>3||!['','sharp','flat','natural'].includes(e.accidental)||!Number.isSafeInteger(e.durationTicks)||e.durationTicks<=0||e.invalidDuration)) errors.push(`第 ${i+1} 小节音符或时值无效`);
  }
  errors.push(...sequence(model).errors);
  return errors;
}
// Resolve pitch and ties on the same timeline used by both validation and export.
// Measure totals retain every written duration; only playback events are merged.
function sequence(model) {
  let tick=0, pending=null; const notes=[], errors=[];
  for (const [i,m] of model.measures.entries()) {
    const carry=new Map();
    for(const [j,e] of m.events.entries()) {
      const where=`第 ${i+1} 小节第 ${j+1} 个音符`;
      const pitchKey=`${e.degree}:${e.octave}`;
      if(e.accidental) carry.set(pitchKey,{sharp:1,flat:-1,natural:0}[e.accidental]);
      let midi=60+keys[model.key]+[0,2,4,5,7,9,11][e.degree-1]+12*e.octave+(carry.get(pitchKey)||0);
      // A tied continuation inherits its starting pitch across a barline, but
      // does not establish an accidental for other notes in the new measure.
      if(pending && e.tieStop && !e.accidental && pitchKey===pending.pitchKey) midi=pending.note.midi;
      if(pending && !e.tieStop) errors.push(`${pending.where}的延音线缺少紧接的终点，请核对连接标记`);
      if(e.tieStop && !pending) errors.push(`${where}的延音线缺少起点，请核对连接标记`);
      if(!e.degree && (e.tieStart || e.tieStop)) errors.push(`${where}是休止符，不能连接延音线`);
      if(pending && e.tieStop && e.degree && midi!==pending.note.midi) errors.push(`${where}与延音线起点音高不同，请核对音级、八度及升降号`);
      let note;
      if(e.degree) {
        if(pending && e.tieStop && midi===pending.note.midi) {
          note=pending.note; note.durationTicks+=e.durationTicks;
        } else { note={midi,startTick:tick,durationTicks:e.durationTicks}; notes.push(note); }
      }
      pending=e.tieStart && note ? {note,pitchKey,where} : null;
      tick+=e.durationTicks;
    }
  }
  if(pending) errors.push(`${pending.where}的延音线缺少终点，请核对连接标记`);
  return {notes,errors};
}
export function toNotes(model) {
  const errors=check(model); if(errors.length) throw new Error(errors.join('；'));
  const {notes}=sequence(model);
  if(!notes.length) throw new Error('曲谱只有休止符');
  return notes.map(n=>({freq:440*2**((n.midi-69)/12),start:n.startTick/PPQ*60/model.bpm,dur:n.durationTicks/PPQ*60/model.bpm,timbre:'piano'}));
}
