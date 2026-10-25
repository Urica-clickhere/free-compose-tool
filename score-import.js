import {fromRecognition,check,toNotes,PPQ} from './rhythm-model.js';
const root=document.getElementById('scoreRecognition');
root.innerHTML=`<div class="section-title">简谱图片识别 · 本地试用</div>
<p>上传清晰的单旋律印刷简谱（PNG / JPEG / WebP）。图片仅在本机处理；首次使用需下载约 40 MB 识别资源。识别不能保证零错误，请逐小节核对节奏、漏音和小节线。</p>
<label>简谱图片 <input id="omrFile" type="file" accept="image/png,image/jpeg,image/webp"></label>
<button id="omrRun" class="btn btn-primary">开始识别</button>
<p id="omrStatus" role="status" aria-live="polite"></p><div id="omrReview"></div>`;
const $=id=>document.getElementById(id);let model,bin;
const say=s=>$('omrStatus').textContent=s;
function field(label,value,change,type='number') {
 const wrap=document.createElement('label'); wrap.textContent=label+' ';const input=document.createElement('input');input.type=type;input.value=value;input.style.width='6em'; input.setAttribute('aria-label',label);input.addEventListener('change',()=>change(type==='number'?Number(input.value):input.value));wrap.append(input);return wrap;
}
function checkbox(label,checked,change) {const wrap=document.createElement('label');const input=document.createElement('input');input.type='checkbox';input.checked=checked;input.addEventListener('change',()=>change(input.checked));wrap.append(input,document.createTextNode(label));return wrap;}
function button(label,click) { const b=document.createElement('button');b.type='button';b.className='btn btn-secondary';b.textContent=label;b.onclick=click;return b; }
function crop(m) {
 const canvas=document.createElement('canvas'); const boxes=m.events.filter(e=>e.bbox).map(e=>e.bbox);if(!boxes.length)return canvas;
 const x=Math.max(0,Math.floor(Math.min(...boxes.map(b=>b.x))-35)),y=Math.max(0,Math.floor(Math.min(...boxes.map(b=>b.y))-75));
 const right=Math.min(bin.w,Math.ceil(Math.max(...boxes.map(b=>b.x+b.w))+100)),bottom=Math.min(bin.h,Math.ceil(Math.max(...boxes.map(b=>b.y+b.h))+65));
 canvas.width=right-x;canvas.height=bottom-y;canvas.style.maxWidth='100%';canvas.style.background='white';
 const ctx=canvas.getContext('2d'),pixels=ctx.createImageData(canvas.width,canvas.height);
 for(let yy=0;yy<canvas.height;yy++)for(let xx=0;xx<canvas.width;xx++){const j=(yy*canvas.width+xx)*4,v=bin.data[(y+yy)*bin.w+x+xx]?0:255;pixels.data[j]=pixels.data[j+1]=pixels.data[j+2]=v;pixels.data[j+3]=255;}
 ctx.putImageData(pixels,0,0);canvas.setAttribute('aria-label','该小节原图，含周围节奏符号');return canvas;
}
function render() {
 const area=$('omrReview');area.replaceChildren();const header=document.createElement('div');header.className='btn-row';
 for(const [label,key,type] of [['调号（1=C）','key','text'],['速度（四分音符/分钟）','bpm','number'],['拍号分子','beats','number'],['拍号分母','beatType','number']])header.append(field(label,model[key],v=>{model[key]=v;model.headerConfirmed=false;model.measures.forEach(m=>m.confirmed=false);render();},type));
 area.append(header,checkbox('我已对照原谱确认调号、速度、拍号；这是单旋律谱，且无未处理的反复、延音线、变拍或变速。',model.headerConfirmed,v=>{model.headerConfirmed=v;refresh();}));
 const source=document.createElement('details');const summary=document.createElement('summary');summary.textContent='查看完整原图（核对页眉、小节线及漏识的音符）';source.append(summary,crop({events:[{bbox:{x:35,y:75,w:Math.max(1,bin.w-135),h:Math.max(1,bin.h-140)}}]}));area.append(source);
 model.measures.forEach((m,i)=>{
  const box=document.createElement('fieldset');box.style.margin='16px 0';const legend=document.createElement('legend');legend.textContent=`第 ${i+1} 小节 · ${m.events.reduce((s,e)=>s+e.durationTicks,0)/PPQ} / ${(m.expectedTicks ?? model.beats*4/model.beatType*PPQ)/PPQ} 拍`;box.append(legend,crop(m));
  const edit=()=>{m.confirmed=false;render();};
  m.events.forEach((e,j)=>{const row=document.createElement('div');row.className='btn-row';
   row.append(document.createTextNode(`${j+1}. `),field('音级（0休止）',e.degree,v=>{e.degree=v;edit();}),field('八度',e.octave,v=>{e.octave=v;edit();}),field('时值（四分音符拍）',e.durationTicks/PPQ,v=>{e.durationTicks=v*PPQ;e.invalidDuration=false;edit();}));
   const select=document.createElement('select');select.setAttribute('aria-label','升降号');for(const [v,t] of [['','无标记'],['sharp','升号'],['flat','降号'],['natural','还原号']]){const o=document.createElement('option');o.value=v;o.textContent=t;select.append(o);}select.value=e.accidental;select.onchange=()=>{e.accidental=select.value;edit();};row.append(select);
   row.append(button('前插音符',()=>{m.events.splice(j,0,{degree:1,octave:0,accidental:'',durationTicks:PPQ});edit();}),button('删除',()=>{m.events.splice(j,1);edit();}));
   const note=document.createElement('small');note.textContent=e.marks?`减时线 ${e.marks.div} · 附点 ${e.marks.dot} · 增时线 ${e.marks.augment}${e.marks.tuplet?' · 连音比例 '+e.marks.tuplet.normal+'/'+e.marks.tuplet.actual:''}${e.doubt?.length?' · 识别存疑，请核对':''}`:'手动补入';row.append(note);box.append(row);
  });
  box.append(button('末尾补音符',()=>{m.events.push({degree:1,octave:0,accidental:'',durationTicks:PPQ});edit();}));
  if(i===0||i===model.measures.length-1)box.append(field('弱起/末尾不完全小节目标拍数', (m.expectedTicks ?? model.beats*4/model.beatType*PPQ)/PPQ,v=>{m.expectedTicks=v*PPQ;edit();}));
  box.append(checkbox('我已核对本小节所有时值、休止、音符数量及边界',m.confirmed,v=>{m.confirmed=v;refresh();}));area.append(box);
 });
 const problems=document.createElement('p');problems.id='omrProblems';problems.setAttribute('role','status');area.append(problems);
 const apply=button('将已核对曲谱替换到编曲区',()=>{try{const notes=toNotes(model);window.ComposerForum.import(notes);say(`已导入 ${notes.length} 个音符，可在编曲区试听与导出 JSON。`);}catch(e){say(e.message);}});apply.id='omrApply';area.append(apply);refresh();
}
function refresh(){const errors=check(model);$('omrApply').disabled=!!errors.length;$('omrProblems').textContent=errors.length?errors.slice(0,8).join('；')+(errors.length>8?'……':''):'所有小节拍数一致，人工核对完成，可以导入。';}
$('omrFile').onchange=()=>{model=null;bin=null;$('omrReview').replaceChildren();say('已选择新图片，请开始识别。');};
$('omrRun').onclick=async()=>{
 const file=$('omrFile').files[0];if(!file)return say('请先选择图片');if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>15*1024*1024)return say('请选择不超过 15 MB 的 PNG、JPEG 或 WebP 图片');
 model=null;bin=null;$('omrReview').replaceChildren();$('omrRun').disabled=$('omrFile').disabled=true;
 say('正在加载本地识别引擎并识别，复杂图片可能需要几分钟……');
 try {const {recognize}=await import('./omr/engine.js');const result=await recognize(new Uint8Array(await file.arrayBuffer()),file.type);bin=result.bin;model=fromRecognition(result.score);render();say(`识别出 ${model.measures.length} 个小节。请先核对完整原图，再逐小节确认。`);}
 catch(e){say('识别失败：'+e.message+'。请裁剪为清晰的单旋律谱后重试。');}
 finally{$('omrRun').disabled=$('omrFile').disabled=false;}
};
