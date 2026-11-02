import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {ws,send,attach,read,targets} from './cdp.mjs';
const server=JSON.parse(await readFile(new URL('./server.json',import.meta.url)));
for(const t of targets.filter(t=>t.type==='page'&&t.url.includes('/session/')))await send('Target.closeTarget',{targetId:t.targetId});
const context='isolated-agent-browser';
const target=targets.find(t=>t.type==='page'&&t.url==='about:blank').targetId;
const page=await attach({targetId:target});
await send('Page.enable',{},page);
await send('Page.navigate',{url:server.base+'/session/'+server.key},page);
await send('Page.bringToFront',{},page);
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let n=0;n<300;n++){try{const value=await fn();if(value)return value}catch{}await pause(100)}throw new Error('Timed out')}
await until(()=>read(page,'document.getElementById("polish-overall") && document.querySelector("#artifact").src.includes("artifact_load_token")'));
const frame=await until(async()=>{const t=(await send('Target.getTargets')).targetInfos.find(t=>t.type==='iframe'&&t.url.includes('/artifact/'+server.key));return t&&attach(t)});
await until(()=>read(page,'!document.body.classList.contains("layout-gate-active")'));
await pause(200);
const evidence={context,target,server:server.base};
const ev=async()=>read(page,'({hidden:document.getElementById("polish-dialog").hidden,title:document.getElementById("polish-title").textContent,quote:document.getElementById("polish-quote").textContent,quoteHidden:document.getElementById("polish-quote").hidden,status:document.getElementById("polish-message-status").textContent,threads:document.getElementById("polish-threads").textContent,active:document.activeElement.id})');
async function mouse(type,x,y,buttons=0){await send('Input.dispatchMouseEvent',{type,x,y,buttons,button:type==='mouseMoved'?'none':'left',clickCount:type==='mouseMoved'?0:1},page)}
async function click(selector,session=page){const p=await read(session,`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);if(session===frame)p.y+=56;await mouse('mouseMoved',p.x,p.y);await mouse('mousePressed',p.x,p.y,1);await mouse('mouseReleased',p.x,p.y);await pause(70)}
async function key(key,code,modifiers=0){await send('Input.dispatchKeyEvent',{type:'keyDown',key,code,modifiers},page);await send('Input.dispatchKeyEvent',{type:'keyUp',key,code,modifiers},page);await pause(70)}
async function drag(points){await mouse('mouseMoved',...points[0]);await mouse('mousePressed',...points[0],1);for(const p of points.slice(1))await mouse('mouseMoved',...p,1);await mouse('mouseReleased',...points.at(-1));await pause(150)}
async function shot(name){const image=await send('Page.captureScreenshot',{},page);await writeFile(new URL('./'+name+'.png',import.meta.url),Buffer.from(image.data,'base64'))}
await drag([[95,184],[200,212],[317,240]]);
evidence.crossParagraph=await ev();assert.equal(evidence.crossParagraph.quote,'precise selection begins here and ends later. Beta next paragraph completes');
await send('Input.insertText',{text:'Exact native cross-paragraph drag'},page);await click('#polish-send');await until(async()=>(await ev()).hidden);
await until(async()=>{const s=await fetch(server.base+'/api/'+server.key+'/review').then(r=>r.json());return s.messages.length&&s});
await drag([[160,240],[100,184],[80,100],[400,40]]);
evidence.outsideRelease=await ev();assert.equal(evidence.outsideRelease.hidden,false);assert.ok(evidence.outsideRelease.quote.includes('Alpha precise'));
await shot('outside-release-final');await key('Escape','Escape');
await key('m','KeyM',3);evidence.keyboardOverall=await ev();assert.equal(evidence.keyboardOverall.quoteHidden,true);assert.equal(evidence.keyboardOverall.active,'polish-input');await key('Escape','Escape');
await click('#native',frame);await send('Input.insertText',{text:'Native input retained'},page);await click('[data-lavish-action]',frame);
evidence.nativeControls=await read(frame,'({value:document.getElementById("native").value,action:document.querySelector("[data-lavish-action]").textContent})');assert.equal(evidence.nativeControls.value,'Native input retained');assert.equal(evidence.nativeControls.action,'Form action works');assert.equal((await ev()).hidden,true);
await click('#replace',frame);await send('Input.insertText',{text:'Block anchor to be replaced'},page);await click('#polish-send');await until(async()=>(await ev()).hidden);
evidence.pinsBefore=await read(frame,'Array.from(document.querySelector("[data-lavish-ui]").shadowRoot.querySelectorAll(".polish-pin")).map(p=>({text:p.textContent,cls:p.className}))');
const html=await readFile(server.artifact,'utf8');await writeFile(server.artifact,html.replace('Original block for missing anchor verification.','Original block replaced by similar but different content.'));
await pause(500);await click('#polish-refresh');await pause(700);
const reloaded=(await send('Target.getTargets')).targetInfos.find(t=>t.type==='iframe'&&t.url.includes('/artifact/'+server.key));const frame2=await attach(reloaded);
await click('#polish-overall');await click('#polish-threads');await key('ArrowDown','ArrowDown');await key('Enter','Enter');
evidence.missing=await ev();assert.match(evidence.missing.threads,/原内容位置已变化/);assert.match(evidence.missing.status,/原内容位置已变化/);
evidence.pinsAfter=await read(frame2,'Array.from(document.querySelector("[data-lavish-ui]").shadowRoot.querySelectorAll(".polish-pin")).map(p=>({text:p.textContent,cls:p.className}))');assert.equal(evidence.pinsAfter.length,evidence.pinsBefore.length-1);await shot('missing-anchor-history-final');
await send('Emulation.setDeviceMetricsOverride',{width:360,height:640,deviceScaleFactor:1,mobile:false},page);await pause(150);
evidence.narrow=await read(page,'({width:innerWidth,height:innerHeight,body:document.documentElement.scrollWidth,dialog:document.getElementById("polish-dialog").getBoundingClientRect().toJSON(),send:document.getElementById("polish-send").getBoundingClientRect().toJSON()})');assert.ok(evidence.narrow.dialog.left>=0&&evidence.narrow.dialog.right<=360&&evidence.narrow.dialog.bottom<=640);assert.ok(evidence.narrow.send.right<=360);await shot('narrow-final');
evidence.state=await fetch(server.base+'/api/'+server.key+'/review').then(r=>r.json());await writeFile(new URL('./native-final.json',import.meta.url),JSON.stringify(evidence,null,2));
console.log(JSON.stringify({success:true,cases:Object.keys(evidence),context,target},null,2));
ws.close();
