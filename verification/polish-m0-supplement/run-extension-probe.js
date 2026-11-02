// One bounded, isolated experiment. Does not open a listener or replay first-round messages.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, appendFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root=resolve('verification/polish-m0-supplement'),runtime=resolve(root,'runtime');
const cwd=resolve(runtime,'workspace'),sessions=resolve(runtime,'sessions');
mkdirSync(cwd,{recursive:true});mkdirSync(sessions,{recursive:true});
const output=resolve(root,'evidence/extension-events.jsonl');
if(existsSync(output))throw new Error('Evidence already exists; refuse automatic repeat');
const log=(kind,data)=>{const r={at:new Date().toISOString(),kind,...data};appendFileSync(output,JSON.stringify(r)+'\n',{mode:0o600});console.log(JSON.stringify(r));};
const args=['--mode','rpc','--offline','--no-tools','--no-mcp','--no-extensions','--no-skills','--no-prompt-templates','--no-themes','--no-context-files','--no-approve','--extension',resolve(root,'pi-extension.js'),'--session-dir',sessions];
let child,phase='setup',sessionFile,sessionId,ledgerFile,normalReply=false;
const normal={op:'receive',id:'supp-normal-001',text:'[POLISH-M0-SUPPLEMENT supp-normal-001] Isolated extension identity probe. Reply exactly SUPP_ACK_normal. No tools, files, or other sessions.'};
function send(c){log('request',{pid:child.pid,command:c});child.stdin.write(JSON.stringify(c)+'\n');}
function command(id,payload){send({id,type:'prompt',message:'/polish-m0-probe '+JSON.stringify(payload)});}
function start(recover){
 const pi=spawn('/Users/lightencc/.homebrew/bin/pi',[...args,...(recover?['--session',sessionFile]:['--name','POLISH-M0-SUPPLEMENT-20261030'])],{cwd,env:{...process.env,POLISH_M0_SUPPLEMENT_DIR:runtime,POLISH_M0_READ_ONLY:recover?'1':'0'},stdio:['pipe','pipe','pipe']});
 child=pi;log('process_start',{pid:pi.pid,recover,args:[...args,...(recover?['--session',sessionFile]:['--name','POLISH-M0-SUPPLEMENT-20261030'])]});
 let rest='';pi.stdout.setEncoding('utf8');
 pi.stdout.on('data',chunk=>{
  const lines=(rest+chunk).split('\n');rest=lines.pop();
  for(const line of lines.filter(x=>x.trim())){
   const e=JSON.parse(line);
   if(e.type==='extension_ui_request'&&e.method==='notify'&&e.message?.startsWith('POLISH_M0_EVIDENCE ')){
    const data=JSON.parse(e.message.slice('POLISH_M0_EVIDENCE '.length));log('extension_notice',{pid:pi.pid,data});
    if(data.kind==='bound')ledgerFile=data.file;
    if(data.kind==='fault_hold'){
     phase='killing';log('kill_owned_child',{pid:pi.pid,signal:'SIGKILL',reason:'After dispatch marker, before sendMessage; consumer must preserve unknown.'});pi.kill('SIGKILL');
    }
   }
   if(e.type==='response'){
    if(e.command==='get_state'&&e.data?.model)e.data.model={id:e.data.model.id,provider:e.data.model.provider};
    log('response',{pid:pi.pid,event:e});
    if(e.id==='initial-state'&&e.success){sessionFile=e.data.sessionFile;sessionId=e.data.sessionId;command('setup-entry',{op:'setup-entry',id:'supp-setup-001'});}
    if(e.id==='setup-entry'&&e.success){phase='warmup';send({id:'supp-warmup',type:'prompt',message:'[POLISH-M0-SUPPLEMENT supp-warmup] Isolated test. Reply exactly SUPP_ACK_warmup. No tools or file changes.',streamingBehavior:'followUp'});}
    if(e.id==='normal-query'){
     const code=`import {Ledger} from ${JSON.stringify(resolve(root,'ledger.js'))};try{const l=new Ledger(${JSON.stringify(ledgerFile)},${JSON.stringify(sessionId)});l.close();process.exit(2);}catch(e){if(e.code!=='EEXIST')throw e;console.log('SECOND_CONSUMER_REFUSED');}`;
     const probe=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8',timeout:10000});log('second_consumer_probe',{status:probe.status,stdout:probe.stdout,stderr:probe.stderr});
     command('conflicting-payload',{...normal,text:normal.text+' altered'});
    }
    if(e.id==='conflicting-payload')command('held-dispatch',{op:'receive',id:'supp-unknown-001',text:'[POLISH-M0-SUPPLEMENT supp-unknown-001] Must not be automatically retried. Isolated crash window.',holdBeforeDispatch:true});
    if(e.id==='recovered-state'){
     log('same_history_identity',{original:sessionId,recovered:e.data?.sessionId,live_instance_same:false});command('recovered-normal-query',{op:'query',id:'supp-normal-001'});
    }
    if(e.id==='recovered-normal-query')command('recovered-unknown-query',{op:'query',id:'supp-unknown-001'});
    if(e.id==='recovered-unknown-query'){
     log('retained_claim',{exists:existsSync(ledgerFile+'.lock'),automatic_resend_count:0});phase='closing';pi.stdin.end();
    }
   }
   if(e.type==='message_start'&&e.message?.role==='custom')log('host_custom_input',{pid:pi.pid,details:e.message.details,customType:e.message.customType});
   if(e.type==='message_end'&&e.message?.role==='assistant'){
    const text=e.message.content.filter(x=>x.type==='text').map(x=>x.text).join('');
    log('assistant_end',{stopReason:e.message.stopReason,text,error:e.message.errorMessage});
    if(phase==='normal')normalReply=text==='SUPP_ACK_normal';
    if(e.message.stopReason==='error'){phase='failed';pi.stdin.end();process.exitCode=1;}
   }
   if(e.type==='agent_settled'){
    log('settled',{event:e,phase});
    if(phase==='warmup'){phase='normal';command('normal-first',normal);command('normal-duplicate',normal);}
    else if(phase==='normal'){
     log('normal_reply_check',{matched:normalReply});phase='normal-query';command('normal-query',{op:'query',id:'supp-normal-001'});
    }
   }
  }
 });
 pi.stderr.on('data',c=>log('stderr',{text:c.toString().replace(/(?:sk-|Bearer )[A-Za-z0-9_.-]+/g,'[REDACTED]')}));
 pi.on('exit',(code,signal)=>{
  log('process_exit',{pid:pi.pid,code,signal,phase});
  if(phase==='killing'){phase='recovering';start(true);}else{clearTimeout(deadline);if(code!==0)process.exitCode=1;}
 });
 send({id:recover?'recovered-state':'initial-state',type:'get_state'});
}
const deadline=setTimeout(()=>{log('deadline',{phase,unknown:true});phase='failed';child.stdin.end();setTimeout(()=>child.kill('SIGTERM'),1000);process.exitCode=1;},60000);
start(false);
