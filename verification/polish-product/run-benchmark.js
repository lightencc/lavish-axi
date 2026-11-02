import { spawn } from 'node:child_process';
import { mkdir, writeFile, appendFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
const root=resolve('verification/polish-product');
const resume=process.argv.includes('--resume') ? JSON.parse(await readFile(join(root,'evidence','bench-settings.json'),'utf8'))[0].data.data : null;
const run=resume ? resolve(resume.sessionFile,'../..') : join(root,'runtime',randomUUID());
await mkdir(run,{recursive:true});
const artifact=join(run,'artifact.html');
if(!resume) await writeFile(artifact,`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Polish Pi 产品验收</title><style>body{margin:0;background:#f5f6f8;color:#1f2329;font:16px/1.8 system-ui}main{max-width:850px;margin:36px auto;background:white;padding:40px;border:1px solid #dee0e3;border-radius:10px}h1{font-size:28px}h2{font-size:21px}section{margin:24px 0;padding:20px;border:1px solid #dee0e3;border-radius:8px}button{background:#3370ff;color:white;border:0;padding:8px 16px;border-radius:6px}input{padding:8px;border:1px solid #dee0e3;border-radius:5px}label{margin-right:20px}</style></head><body><main><h1 id="title">Polish Pi 产品验收</h1><p id="intro">这是用于验证当前 Pi 会话的 HTML。</p><section id="summary"><h2 id="heading">第一轮需要修改的标题</h2><p id="description">这段说明需要简化。保留文字选区与内容块评论。</p><p id="details">第二段用于跨段选择。整体意见不关联任何网页元素。</p></section><section><h2>页面内表单</h2><form id="native-form" data-lavish-question="native-form"><label><input type="radio" name="verdict" value="yes">符合预期</label><label><input type="radio" name="verdict" value="no">需要调整</label><p><input name="note" placeholder="补充意见"></p><button type="submit">提交表单</button><span id="form-result"></span></form></section><a href="#summary">返回说明</a></main><script>document.getElementById('native-form').onsubmit=e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target));window.lavish.queuePrompt('表单反馈：'+JSON.stringify(d),{scope:'session',data:d});window.lavish.sendQueuedPrompts();document.getElementById('form-result').textContent='已提交'};</script></body></html>`);
const log=async (kind,data)=>appendFile(join(run,'events.jsonl'),JSON.stringify({at:Date.now(),kind,data})+'\n');
const child=spawn('pi',['--mode','rpc','--offline','--no-mcp','--no-extensions','--no-skills','--no-prompt-templates','--no-context-files','--no-themes','--extension',resolve('dist/pi-extension.mjs'),...(resume ? ['--session',resume.sessionFile] : ['--session-dir',join(run,'sessions')]),'--name','Polish product validation'],{cwd:run,env:{...process.env,POLISH_PI_STATE_ROOT:join(run,'polish-state')},stdio:['pipe','pipe','pipe']});
await writeFile(join(root,'evidence',resume ? 'resumed-run.json' : 'active-run.json'),JSON.stringify({run,artifact,piPid:child.pid,supervisorPid:process.pid},null,2));
console.log(JSON.stringify({kind:'spawned',run,artifact,piPid:child.pid}));
let rest='',opened=false,directSample=null,directRemaining=0;
function nextDirect(){if(!directRemaining)return;const index=31-directRemaining--;directSample={index,start:Date.now()};child.stdin.write(JSON.stringify({id:'direct-'+index,type:'prompt',message:'性能验证 '+index+'：不要修改文件、不要使用工具，只回复 OK。'})+'\n');}

child.stdout.on('data',chunk=>{const lines=(rest+chunk).split('\n');rest=lines.pop();for(const line of lines.filter(Boolean)){let e;try{e=JSON.parse(line)}catch{continue}if(e.type==='agent_settled'&&directSample){void log('direct-sample',{...directSample,end:Date.now()});directSample=null;setTimeout(nextDirect,100);}
if(e.type==='message_update'){if(e.assistantMessageEvent?.type==='text_delta')void log('text-delta',{text:e.assistantMessageEvent.delta});continue;}if(e.type==='message_end'&&e.message){e={type:e.type,role:e.message.role,text:(Array.isArray(e.message.content)?e.message.content.filter(c=>c.type==='text').map(c=>c.text).join(''):String(e.message.content||'')),stopReason:e.message.stopReason,model:e.message.model,provider:e.message.provider};}if(['extension_ui_request','response','agent_settled','message_end','tool_execution_end'].includes(e.type)){void log('pi',e);console.log(JSON.stringify(e));}if(!opened&&e.type==='extension_ui_request'&&e.message?.includes('Polish 已绑定')){opened=true;child.stdin.write(JSON.stringify({id:'open',type:'prompt',message:'/polish '+artifact+' --no-open'})+'\n');}}});
child.stderr.on('data',data=>{void log('stderr',String(data));console.error(String(data));});
const rl=createInterface({input:process.stdin});
let stopped=false;
function stop(){if(stopped)return;stopped=true;child.kill('SIGTERM');rl.close();process.stdin.pause();}
const timer=setTimeout(stop,30*60*1000);
rl.on('line',line=>{const c=JSON.parse(line);if(c.op==='stop')stop();else if(c.op==='direct-benchmark'){directRemaining=30;nextDirect();}else child.stdin.write(JSON.stringify({id:c.id||randomUUID(),type:c.type||'prompt',...(c.message?{message:c.message}:{})})+'\n');});
child.on('exit',(code,signal)=>{clearTimeout(timer);void log('exit',{code,signal,pid:child.pid});console.log(JSON.stringify({kind:'exit',code,signal}));rl.close();process.stdin.pause();});
