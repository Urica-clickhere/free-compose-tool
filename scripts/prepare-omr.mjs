// Build-time acquisition only. Browser inference never contacts GitHub.
import {mkdir,readFile,writeFile,mkdtemp,rm,cp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
const revision='57ae7403d2a193f90e096af46a50bab004042cdb';
const digest='e44104aaab39b81e58d7c84b2295b6f9d4fe52d30ad07d2255e04c8b52098527';
const cache='.omr-cache';await mkdir(cache,{recursive:true});const archive=join(cache,revision+'.tar.gz');
let bytes;try{bytes=await readFile(archive);}catch{}
if(!bytes || createHash('sha256').update(bytes).digest('hex')!==digest){
 const response=await fetch(`https://codeload.github.com/lodebar2026/dolce/tar.gz/${revision}`,{signal:AbortSignal.timeout(120000)});
 if(!response.ok)throw new Error(`Dolce download failed: ${response.status}`);bytes=Buffer.from(await response.arrayBuffer());
 if(createHash('sha256').update(bytes).digest('hex')!==digest)throw new Error('Dolce archive checksum mismatch');
 await writeFile(archive,bytes);
}
const temp=await mkdtemp(join(tmpdir(),'composer-omr-'));
try{
 execFileSync('tar',['xzf',archive,'-C',temp,'--no-same-owner']);
 const source=join(temp,'dolce-'+revision);
 await mkdir('vendor/dolce',{recursive:true});await mkdir('omr-assets/redist',{recursive:true});
 await cp(join(source,'src'),'vendor/dolce/src',{recursive:true});
 await cp(join(source,'public/redist/ocr'),'omr-assets/redist/ocr',{recursive:true});
 await cp(join(source,'LICENSE'),'vendor/dolce/LICENSE');
}finally{await rm(temp,{recursive:true,force:true});}
