import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import{mkdir,writeFile}from'node:fs/promises';
import{ws,send,attach,read,targets}from'./cdp.mjs';
const url=process.env.POLISH_FLOW_URL,out=process.env.POLISH_FLOW_OUT||'verification/polish-final-ui/selection-final';await mkdir(out,{recursive:true});
const target=targets.find(t=>t.type==='page'&&t.url===url);assert.ok(target);const page=await attach(target),src=await read(page,'document.getElementById("artifact").src'),ft=targets.find(t=>t.type==='iframe'&&t.url===src);assert.ok(ft);const frame=await attach(ft),mono=()=>Number(process.hrtime.bigint())/1e6;
async function calibrate(){const result={top:[],frame:[]};for(const[name,session]of[['top',page],['frame',frame]])for(let n=0;n<10;n++){const a=mono(),clock=await read(session,'({origin:performance.timeOrigin,now:performance.now()})'),b=mono();result[name].push({runnerStartMs:a,runnerEndMs:b,origin:clock.origin,now:clock.now,absoluteMinusRunnerMs:clock.origin+clock.now-(a+b)/2,uncertaintyMs:(b-a)/2})}return result}
async function mouse(type,x,y,buttons=0){void buttons;const cli=(...args)=>execFileSync('agent-browser',['--session',process.env.POLISH_BROWSER_SESSION||'polish-function-final',...args],{encoding:'utf8'});cli('mouse','move',String(Math.round(x)),String(Math.round(y)));if(type!=='mouseMoved')cli('mouse',type==='mousePressed'?'down':'up','left')}
async function close(){if(await read(page,'document.getElementById("polish-dialog").hidden'))return;const p=await read(page,'(()=>{const r=document.getElementById("polish-close").getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()');await mouse('mousePressed',p.x,p.y,1);await mouse('mouseReleased',p.x,p.y)}
const result={url,target:target.targetId,frameTarget:ft.targetId,before:await calibrate(),samples:[]};
try{for(let n=0;n<5;n++){
 await close();const offset=await read(page,'document.getElementById("artifact").getBoundingClientRect().toJSON()');
 // Read-only Range geometry sets mouse coordinates; it never changes browser Selection.
 const points=await read(frame,`(()=>{const node=document.querySelector('#alpha').firstChild;const pos=i=>{const r=document.createRange();r.setStart(node,i);r.setEnd(node,i+1);const b=r.getBoundingClientRect();return{x:b.left+1,y:b.top+b.height/2}};return{start:pos(${n%2}),end:pos(${5+n%2})}})()`);
 await read(frame,`(()=>{window.__selectionTiming=null;document.addEventListener('mouseup',e=>{window.__selectionTiming={eventAt:e.timeStamp,handledAt:performance.now(),origin:performance.timeOrigin}},{once:true,capture:true})})()`);
 await read(page,`(()=>{window.__popupTiming=null;window.__popupTimingObserver=new MutationObserver(()=>{if(!document.getElementById('polish-dialog').hidden){window.__popupTiming={at:performance.now(),origin:performance.timeOrigin,quote:document.getElementById('polish-quote').textContent};window.__popupTimingObserver.disconnect()}});window.__popupTimingObserver.observe(document.getElementById('polish-dialog'),{attributes:true,attributeFilter:['hidden']})})()`);
 const a={x:points.start.x+offset.left,y:points.start.y+offset.top},b={x:points.end.x+offset.left,y:points.end.y+offset.top};
 await mouse('mouseMoved',a.x,a.y);await mouse('mousePressed',a.x,a.y,1);await mouse('mouseMoved',(a.x+b.x)/2,a.y,1);await mouse('mouseMoved',b.x,b.y,1);await mouse('mouseReleased',b.x,b.y);
 const end=mono()+10000;let popup;do{popup=await read(page,'window.__popupTiming');if(popup)break;await new Promise(r=>setTimeout(r,20))}while(mono()<end);
 const selection=await read(frame,'window.__selectionTiming');assert.ok(selection&&popup&&popup.quote,'native mouseup produced a visible selection comment');result.samples.push({index:n+1,selection,popup,rawCrossRealmMs:popup.origin+popup.at-selection.origin-selection.eventAt});
}
result.after=await calibrate();result.success=true;
}catch(error){result.success=false;result.error=error.stack||String(error);throw error}
finally{await close().catch(()=>{});await writeFile(out+'/selection-timing.json',JSON.stringify(result,null,2));ws.close()}
