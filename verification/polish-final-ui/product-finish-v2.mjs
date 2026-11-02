import assert from 'node:assert/strict';
import{execFileSync}from'node:child_process';
import {readFile,writeFile,appendFile,mkdir} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {ws,send,attach,read,targets} from './cdp.mjs';
const url=process.env.POLISH_FLOW_URL,out=process.env.POLISH_FLOW_OUT||'verification/polish-final-ui/product-final-1';
if(!url)throw new Error('POLISH_FLOW_URL required');await mkdir(out,{recursive:true});
const cli=(...args)=>execFileSync('agent-browser',['--session',process.env.POLISH_BROWSER_SESSION||'polish-function-final',...args],{encoding:'utf8'});assert.equal(cli('get','url').trim(),url);
const parsed=new URL(url),sessionKey=parsed.pathname.split('/').at(-1),run=process.env.POLISH_FLOW_RUN||randomUUID().slice(0,8);
let target=targets.find(t=>t.type==='page'&&t.url===url);assert.ok(target);let page=await attach(target),frame;
const pause=ms=>new Promise(r=>setTimeout(r,ms)),mono=()=>Number(process.hrtime.bigint())/1e6;
async function until(fn,ms=90000){const end=mono()+ms;while(mono()<end){const v=await fn();if(v)return v;await pause(50)}throw new Error('Timed out')}
async function snapshot(){for(let n=0;;n++){try{const r=await fetch(parsed.origin+'/api/'+sessionKey+'/review');assert.ok(r.ok,'review GET '+r.status);return await r.json()}catch(error){if(n>=3)throw error;await pause(100*(n+1))}}}
async function attachFrame(){const src=await read(page,'document.getElementById("artifact").src');const t=await until(async()=>(await send('Target.getTargets')).targetInfos.find(t=>t.type==='iframe'&&t.url===src));if(frame)await send('Target.detachFromTarget',{sessionId:frame}).catch(()=>{});frame=await attach(t)}
await attachFrame();await send('Page.bringToFront',{},page);
async function click(selector,inFrame=false){
 cli('frame','main');
 if(inFrame){const tree=JSON.parse(cli('snapshot','-i','--json'));const ref=Object.entries(tree.data.refs).find(([,v])=>v.role==='Iframe')?.[0];assert.ok(ref,'artifact iframe exposed');cli('frame','@'+ref)}
 cli('click',selector);cli('frame','main');
}
async function key(key,code,modifiers=0){void code;cli('press',(modifiers&4?'Meta+':modifiers&2?'Control+':'')+key)}
async function type(text){cli('keyboard','inserttext',text)}
async function refresh(){const old=await read(page,'document.getElementById("artifact").src');await click('#polish-refresh');await until(()=>read(page,`document.getElementById('artifact').src !== ${JSON.stringify(old)} && !document.body.classList.contains('layout-gate-active')`));await attachFrame();await until(()=>read(page,'!document.getElementById("polish-status").textContent.includes("有新回复")'))}
async function selectThread(id){await click('#polish-overall');cli('select','#polish-threads',id);assert.equal(await read(page,'document.getElementById("polish-threads").value'),id)}
const pins=()=>read(frame,'Array.from(document.querySelector("[data-lavish-ui]").shadowRoot.querySelectorAll(".polish-pin")).map(p=>({text:p.textContent,cls:p.className,color:getComputedStyle(p).borderColor}))');
async function shot(name){const r=await send('Page.captureScreenshot',{},page);await writeFile(out+'/'+name+'.png',Buffer.from(r.data,'base64'))}
async function record(name,data){await appendFile(out+'/events.jsonl',JSON.stringify({name,at:mono(),data})+'\n');return data}
async function complete(message){await selectThread(message.prompt.comment_id||message.id);await until(()=>read(page,'!document.getElementById("polish-complete").disabled'));await shot('before-complete-'+message.id);await click('#polish-complete');await until(async()=>(await snapshot()).messages.find(m=>m.id===message.id)?.resolved);return record('complete',{id:message.id,pins:await pins()})}
async function submit(text,anchor){const before=await snapshot(),ids=new Set(before.messages.map(m=>m.id));if(anchor)await click(anchor,true);else await click('#polish-overall');await until(()=>read(page,'document.activeElement.id==="polish-input"'));await type(text);await click('#polish-send');const accepted=await until(async()=>(await snapshot()).messages.find(m=>!ids.has(m.id)&&m.prompt.prompt===text));await record('submitted',{id:accepted.id,prompt:accepted.prompt});const replied=await until(async()=>{const m=(await snapshot()).messages.find(m=>m.id===accepted.id);return m?.state==='replied'&&m},180000);return record('replied',replied)}
const result={run,url,startedAt:mono()};
try{
 // A09: observe actual WebSocket instances, then offline + close the established connection.
 await send('Page.enable',{},page);
 const init=await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__polishOriginalWebSocket=window.WebSocket;window.__polishTestSockets=[];window.WebSocket=class extends window.__polishOriginalWebSocket{constructor(...args){super(...args);window.__polishTestSockets.push(this)}};`},page);
 await send('Page.reload',{},page);await until(()=>read(page,'document.getElementById("polish-overall") && !document.body.classList.contains("layout-gate-active")'));await attachFrame();await until(()=>read(page,'window.__polishTestSockets?.some(s=>s.readyState===1)'));
 for(const selector of ['input[name="verdict"]','input[name="selection"]'])if(!await read(frame,`document.querySelector(${JSON.stringify(selector)}).checked`))await click(selector,true);
 await click('input[name="note"]',true);await key('a','KeyA',4);await type('离线保留答案 '+run);
 const formBefore=await read(frame,'({radio:document.querySelector("[name=verdict]").checked,checkbox:document.querySelector("[name=selection]").checked,note:document.querySelector("[name=note]").value})');
 await click('#polish-overall');const draft='A09 未发送保留草稿 '+run;await key('a','KeyA',4);await type(draft);const beforeOffline=await snapshot();
 const networkEvents=[];ws.on('message',data=>{const e=JSON.parse(data);if(e.sessionId===page&&['Network.webSocketClosed','Network.loadingFailed','Network.webSocketCreated'].includes(e.method))networkEvents.push(e)});
 await send('Network.enable',{},page);await send('Network.enable',{},frame);
 const socketCount=await read(page,'(()=>{const sockets=window.__polishTestSockets.filter(s=>s.readyState===1);sockets.forEach(s=>s.close());return sockets.length})()');assert.ok(socketCount>0);
 for(const s of [page,frame])await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0},s);

 await until(()=>read(page,'document.getElementById("polish-status").textContent.includes("连接中断")'));await pause(1200);await shot('offline-real-connection');
 const offline=await read(page,'({status:document.getElementById("polish-status").textContent,draft:document.getElementById("polish-input").value,sockets:window.__polishTestSockets.map(s=>s.readyState)})');assert.equal(offline.draft,draft);
 for(const s of [page,frame])await send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1},s);
 await until(()=>read(page,'window.__polishTestSockets.some(s=>s.readyState===1) && !document.getElementById("polish-status").textContent.includes("连接中断")'));
 const afterOffline=await snapshot(),formAfter=await read(frame,'({radio:document.querySelector("[name=verdict]").checked,checkbox:document.querySelector("[name=selection]").checked,note:document.querySelector("[name=note]").value})');assert.deepEqual(formAfter,formBefore);assert.equal(afterOffline.messages.length,beforeOffline.messages.length);assert.equal(await read(page,'document.getElementById("polish-input").value'),draft);
 await shot('offline-recovered');await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:init.identifier},page);await read(page,'window.WebSocket=window.__polishOriginalWebSocket');
 result.offline=await record('offline',{mode:'real browser offline + explicitly close previously observed established WebSocket',socketCount,offline,formBefore,formAfter,beforeCount:beforeOffline.messages.length,afterCount:afterOffline.messages.length,networkEvents});
 // Keep the active reviewer tab; close the older tab and verify this does not end the session.
 await click('#polish-close');const older=target.targetId;cli('tab','new','--label','polish-remaining-'+run,url);const next=(await send('Target.getTargets')).targetInfos.find(t=>t.type==='page'&&t.url===url&&t.targetId!==older).targetId;page=await attach({targetId:next});target={targetId:next};frame=null;await send('Page.bringToFront',{},page);await until(()=>read(page,'document.getElementById("polish-overall") && !document.body.classList.contains("layout-gate-active")'));await attachFrame();await send('Target.closeTarget',{targetId:older});assert.equal((await snapshot()).lifecycle,'open');result.twoTabs=await record('twoTabs',{closed:older,remaining:next,lifecycle:(await snapshot()).lifecycle});
 await refresh();await click('#polish-finish');const hasDraftChoice=await read(page,'document.getElementById("polish-end-keep").getBoundingClientRect().width>0');if(hasDraftChoice)await click('#polish-end-keep');
 result.ended=await until(async()=>{const s=await snapshot();return s.lifecycle==='ended'&&s});
 await pause(200);result.tabClosed=!(await send('Target.getTargets')).targetInfos.some(t=>t.targetId===next);await record('ended',{lifecycle:result.ended.lifecycle,tabClosed:result.tabClosed,end:result.ended.end});result.success=true;
}catch(error){result.success=false;result.error=error.stack||String(error);throw error}
finally{await Promise.allSettled([page,frame].filter(Boolean).map(s=>send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1},s)));result.finishedAt=mono();await writeFile(out+'/results.json',JSON.stringify(result,null,2));ws.close()}
