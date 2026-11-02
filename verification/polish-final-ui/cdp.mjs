import WebSocket from 'ws';
import { readFile } from 'node:fs/promises';
const [port, endpoint] = (await readFile(process.env.POLISH_UI_CDP_PORT_FILE || '/var/folders/xz/9qyrflss7fj87621xq7wpj_r0000gn/T/agent-browser-chrome-d0aae9fc-4427-46ca-b6f2-824d18e83c3f/DevToolsActivePort','utf8')).trim().split('\n');
export const ws=new WebSocket(`ws://127.0.0.1:${port}${endpoint}`);
await new Promise(resolve=>ws.once('open',resolve));
let id=0;
const pending=new Map();
ws.on('message',data=>{const m=JSON.parse(data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(p){clearTimeout(p.timer);m.error?p.reject(m.error):p.resolve(m.result)}}});
export const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const n=++id;const timer=setTimeout(()=>{pending.delete(n);reject(new Error('CDP timeout '+method))},15000);pending.set(n,{resolve,reject,timer});ws.send(JSON.stringify({id:n,method,params,sessionId}))});
export const targets=(await send('Target.getTargets')).targetInfos;
export async function attach(target){return (await send('Target.attachToTarget',{targetId:target.targetId,flatten:true})).sessionId}
export async function read(session,expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true},session);if(r.exceptionDetails)throw r.exceptionDetails;return r.result.value}
if(process.argv[1]?.endsWith('/cdp.mjs')){console.log(JSON.stringify(targets.map(({targetId,type,url})=>({targetId,type,url})),null,2));ws.close()}
