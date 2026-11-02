// Real native browser inputs. GET /review is verification-only; no fetch submits feedback.
import assert from 'node:assert/strict';
import{execFileSync}from'node:child_process';
import {randomUUID} from 'node:crypto';
import {writeFile,appendFile,mkdir} from 'node:fs/promises';
import {ws,send,attach,read,targets} from './cdp.mjs';
const url=process.env.POLISH_BENCH_URL;
if(!url)throw new Error('POLISH_BENCH_URL must name the final isolated Pi session');
if(!process.env.POLISH_BROWSER_SESSION)throw new Error('POLISH_BROWSER_SESSION must identify the dedicated owned browser');
const cli=(...args)=>execFileSync('agent-browser',['--session',process.env.POLISH_BROWSER_SESSION,...args],{encoding:'utf8'});assert.equal(cli('get','url').trim(),url);
const out=process.env.POLISH_BENCH_OUT||'verification/polish-final-ui/performance';
await mkdir(out,{recursive:true});
const target=targets.find(t=>t.type==='page'&&t.url===url);assert.ok(target,'only attach to the prepared dedicated benchmark page');
const page=await attach(target), parsed=new URL(url), key=parsed.pathname.split('/').at(-1);
const frameTarget=targets.find(t=>t.type==='iframe'&&t.url.startsWith(parsed.origin+'/artifact/'+key+'/'));assert.ok(frameTarget);
let frame=await attach(frameTarget);
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const mono=()=>Number(process.hrtime.bigint())/1e6;
async function until(fn,ms=90000){const deadline=mono()+ms;while(mono()<deadline){const result=await fn();if(result)return result;await pause(25)}throw new Error('Timed out waiting for real UI/reply')}
await send('Page.bringToFront',{},page);
assert.equal(await read(page,'document.hasFocus()'),true);
await until(()=>read(page,'document.getElementById("polish-overall") && !document.body.classList.contains("layout-gate-active")'));
const runnerClock=`ui-runner:${process.pid}:${randomUUID()}`,browserClock=`browser:${target.targetId}:${await read(page,'performance.timeOrigin')}`;
const calibration=[];
for(let n=0;n<10;n++){const a=mono(),b=await read(page,'performance.now()'),c=mono();calibration.push({runnerClock,browserClock,browserMinusRunnerMs:b-(a+c)/2,uncertaintyMs:(c-a)/2,runnerStartMs:a,runnerEndMs:c,browserMs:b})}
await writeFile(out+'/clock-calibration.json',JSON.stringify(calibration,null,2));
async function click(selector,session=page){
 cli('frame','main');
 if(session===frame){const tree=JSON.parse(cli('snapshot','-i','--json'));const ref=Object.entries(tree.data.refs).find(([,v])=>v.role==='Iframe')?.[0];assert.ok(ref);cli('frame','@'+ref)}
 cli('click',selector);cli('frame','main');
}
const observer=`(()=>{window.__polishBenchObserver?.disconnect();const take=()=>({at:performance.now(),status:document.getElementById('polish-status').textContent,messageStatus:document.getElementById('polish-message-status').textContent,hidden:document.getElementById('polish-dialog').hidden,disabled:document.getElementById('polish-send').disabled,error:document.getElementById('polish-error').textContent});window.__polishBenchEvents=[take()];window.__polishBenchClickAt=null;window.__polishBenchClickHandler=e=>{if(e.target.closest?.('#polish-send'))window.__polishBenchClickAt=performance.now()};document.addEventListener('click',window.__polishBenchClickHandler,{capture:true,once:true});window.__polishBenchObserver=new MutationObserver(()=>{const next=take(),last=window.__polishBenchEvents.at(-1);if(['status','messageStatus','hidden','disabled','error'].some(k=>next[k]!==last[k]))window.__polishBenchEvents.push(next)});window.__polishBenchObserver.observe(document.body,{subtree:true,attributes:true,childList:true,characterData:true});return window.__polishBenchEvents[0]})()`;
const pinObserver=`(()=>{window.__polishPinObserver?.disconnect();const root=document.querySelector('[data-lavish-ui]')?.shadowRoot;if(!root)return false;const take=()=>({at:performance.now(),pins:Array.from(root.querySelectorAll('.polish-pin')).map(p=>({text:p.textContent,cls:p.className,color:getComputedStyle(p).borderColor}))});window.__polishPinEvents=[take()];window.__polishPinObserver=new MutationObserver(()=>{const next=take(),last=window.__polishPinEvents.at(-1);if(JSON.stringify(next.pins)!==JSON.stringify(last.pins))window.__polishPinEvents.push(next)});window.__polishPinObserver.observe(root,{subtree:true,attributes:true,childList:true});return true})()`;
async function snapshot(){for(let n=0;;n++){try{const r=await fetch(parsed.origin+'/api/'+key+'/review');assert.equal(r.status,200);return await r.json()}catch(error){if(n>=3)throw error;await pause(100*(n+1))}}}
const rows=[],startIndex=Number(process.env.POLISH_BENCH_START||0);
try {
for(let n=startIndex;n<33;n++){
 const anchored=n>=30,label=`POLISH_UI_${n+1}_${randomUUID().slice(0,6)}`;
 const row={index:n+1,kind:anchored?'anchored':'session',label,runnerClock,browserClock,inputEngine:'agent-browser native CDP controls',browserTimeOriginMs:Number(browserClock.split(':').at(-1)),status:'started',startedRunnerMs:mono()};
 rows.push(row);
 try {
 // Read prior replies with the same real Refresh control users click; no private-state mutation.
 const oldFrameSrc=await read(page,'document.getElementById("artifact").src');
 await click('#polish-refresh');
 const newFrameSrc=await until(()=>read(page,`document.getElementById("artifact").src !== ${JSON.stringify(oldFrameSrc)} && document.getElementById("artifact").src`));
 await until(()=>read(page,'!document.body.classList.contains("layout-gate-active") && !/有新回复|正在处理/.test(document.getElementById("polish-status").textContent)'));
 const nextFrameTarget=await until(async()=> (await send('Target.getTargets')).targetInfos.find(t=>t.type==='iframe'&&t.url===newFrameSrc));
 await send('Target.detachFromTarget',{sessionId:frame});frame=await attach(nextFrameTarget);
 const previous=await snapshot(),previousIds=new Set(previous.messages.map(m=>m.id));
 if(anchored)await click(['#heading','#alpha','#beta'][n-30],frame);else await click('#polish-overall');
 await until(()=>read(page,'!document.getElementById("polish-dialog").hidden && document.activeElement.id === "polish-input"'));
 cli('keyboard','inserttext',`请只回复 ${label}，不要修改文件或调用工具。`);
 await until(()=>read(page,'!document.getElementById("polish-send").disabled'));
 row.baseline=await read(page,observer);
 if(anchored){
  row.frameClock=`browser:${nextFrameTarget.targetId}:${await read(frame,'performance.timeOrigin')}`;row.frameCalibration=[];
  for(let k=0;k<3;k++){const a=mono(),b=await read(frame,'performance.now()'),c=mono();row.frameCalibration.push({frameMinusRunnerMs:b-(a+c)/2,uncertaintyMs:(c-a)/2,runnerStartMs:a,runnerEndMs:c,frameMs:b})}
  assert.ok(await read(frame,pinObserver));
 }
 row.nativeClickDispatchRunnerMs=mono();
 await click('#polish-send');
 row.submitBrowserMs=await read(page,'window.__polishBenchClickAt');row.submitBrowserAbsoluteMs=row.browserTimeOriginMs+row.submitBrowserMs;assert.ok(Number.isFinite(row.submitBrowserMs),'actual native click timestamp captured');
 const accepted=await until(async()=>{const state=await snapshot();return state.messages.find(m=>!previousIds.has(m.id)&&m.prompt.prompt.includes(label))});row.id=accepted.id;
 row.executionObservations=[];row.replyDeadlineMs=180000;
 const reply=await until(async()=>{const state=await snapshot(),m=state.messages.find(m=>m.id===accepted.id);row.lastReviewMessage=m;const observed={state:m?.state,executionUnknown:m?.executionUnknown||false,error:m?.execution_error||null,replyEvidence:m?.replyEvidence||null};if(JSON.stringify(observed)!==JSON.stringify(row.executionObservations.at(-1)?.observed))row.executionObservations.push({atRunnerMs:mono(),observed});return m?.state==='replied'&&m},row.replyDeadlineMs);
 await until(()=>read(page,'document.getElementById("polish-status").textContent.includes("有新回复")'));
 const events=await read(page,'window.__polishBenchEvents'),pins=anchored?await read(frame,'window.__polishPinEvents'):[];
 const t=row.submitBrowserMs,feedback=events.find(e=>e.at>=t&&e.disabled),ack=events.find(e=>e.at>=t&&e.hidden),consumed=events.find(e=>e.at>=t&&e.status==='agent 正在处理'),visibleReply=events.find(e=>e.at>=t&&e.hidden&&e.status.includes('有新回复'));
 Object.assign(row,{prompt:reply.prompt,events,pins,absoluteEvents:events.map(e=>({...e,absoluteMs:row.browserTimeOriginMs+e.at})),uiFeedbackMs:feedback?feedback.at-t:null,uiAckMs:ack?ack.at-t:null,consumedVisibleMs:consumed?consumed.at-t:null,replyVisibleMs:visibleReply?visibleReply.at-t:null,reply});
 assert.ok(row.uiAckMs!==null&&row.replyVisibleMs!==null,'actual visible acknowledgement and current reply recorded');
 if(!anchored)assert.equal(reply.prompt.scope,'session');else{assert.equal(reply.prompt.scope,'anchored');assert.ok(pins.some(e=>e.pins.some(p=>p.cls.includes('processing'))),'orange observed after real consumption');assert.ok(pins.at(-1).pins.every(p=>!p.text),'no pin numbers')}
 row.status='completed';
 } catch(error) { row.status='failed';row.failureKind=String(error.message).includes('Timed out')?'timeout':'assertion_or_transport';row.error=error.stack||String(error);throw error; }
 finally { if(row.baseline&&!row.events)row.events=await read(page,'window.__polishBenchEvents').catch(error=>({readError:String(error)}));row.finishedRunnerMs=mono();await appendFile(out+'/ui-samples.jsonl',JSON.stringify(row)+'\n');console.log(JSON.stringify({sample:n+1,id:row.id,status:row.status,uiAckMs:row.uiAckMs,replyVisibleMs:row.replyVisibleMs,kind:row.kind,error:row.error})); }
}
} finally {
 await writeFile(out+'/ui-results.json',JSON.stringify({url,target:target.targetId,runnerClock,browserClock,allCompleted:rows.length===33-startIndex&&rows.every(r=>r.status==='completed'),rows},null,2));
 ws.close();
}
