// Destructive only to the child processes created here. No retries of user prompts.
import { spawn } from 'node:child_process';
import { mkdirSync, appendFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { splitJsonl } from './probe-support.js';
const root = resolve('verification/polish-m0');
const cwd = resolve(root, 'runtime/pi-crash-workspace');
mkdirSync(cwd, { recursive: true });
const sessionDir = resolve(root, 'runtime/pi-crash-sessions');
mkdirSync(sessionDir, { recursive: true });
const evidence = resolve(root, 'evidence/pi-crash-events.jsonl');
if (existsSync(evidence)) throw new Error('Do not overwrite or repeat a completed fault experiment');
function log(kind, value) {
  const row = { at: new Date().toISOString(), kind, ...value };
  appendFileSync(evidence, JSON.stringify(row) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(row));
}
const baseArgs = ['--mode','rpc','--offline','--no-tools','--no-mcp','--no-extensions','--no-skills','--no-prompt-templates','--no-themes','--no-context-files','--no-approve','--session-dir',sessionDir];
let sessionFile, firstSessionId;
let phase = 'warmup';
let child;
let timeout;
function send(command) { log('request', { pid: child.pid, command }); child.stdin.write(JSON.stringify(command) + '\n'); }
function prompt(id) { return { id, type:'prompt', message:`[POLISH-M0 ${id}] Isolated crash-safety probe. Reply exactly M0_ACK_${id}. No tools, files or other sessions.`, streamingBehavior:'followUp' }; }
function launch(recover) {
  const pi = spawn('/Users/lightencc/.homebrew/bin/pi', [...baseArgs, ...(recover ? ['--session',sessionFile] : ['--name','POLISH-M0-CRASH-20261030'])], {cwd, stdio:['pipe','pipe','pipe']});
  child = pi;
  log('process_start', { pid:pi.pid, recover, sessionFile:recover?sessionFile:null });
  let rest = '';
  pi.stdout.setEncoding('utf8');
  pi.stdout.on('data', chunk => {
    const parsed = splitJsonl(rest, chunk); rest=parsed.rest;
    for (const event of parsed.records) {
      if (event.type === 'response') {
        const data = event.data;
        if (event.command === 'get_state' && data?.model) data.model={id:data.model.id,provider:data.model.provider};
        if (event.id === 'fault-queued' && event.success && event.data?.disposition === 'queued') {
          log('witness_only_host_receipt', {event, note:'Withheld from simulated bridge consumer; external result remains unknown to it.'});
          log('consumer_state', {message_id:'fault-queued',delivery:'delivery_unknown',retry_count:0});
          phase='killing';
          log('kill_owned_child_after_queue_receipt',{pid:pi.pid,signal:'SIGKILL'});
          pi.kill('SIGKILL');
        } else { log('response', {pid:pi.pid,event}); }
        if (event.id === 'initial-state' && event.success) {
          sessionFile=data.sessionFile; firstSessionId=data.sessionId;
          send(prompt('fault-warmup'));
        }
        if (event.id === 'recovered-state' && event.success) {
          const entries = existsSync(sessionFile) ? readFileSync(sessionFile,'utf8').trim().split('\n').map(JSON.parse) : [];
          const users = entries.filter(x=>x.message?.role==='user').map(x=>({id:x.id,timestamp:x.timestamp,content:x.message.content}));
          log('recovery_observation', {same_session_id:data.sessionId===firstSessionId,original_session_id:firstSessionId,session_id:data.sessionId,pendingMessageCount:data.pendingMessageCount,users,automatic_retries:0,note:'Read-only recovery, not proof of attachment to the prior live instance.'});
          phase='closing'; pi.stdin.end();
        }
      }
      if (event.type === 'message_start' && event.message?.role === 'user') log('user_input', {pid:pi.pid,message:event.message});
      if (event.type === 'message_end' && event.message?.role === 'assistant') log('assistant_end', {stopReason:event.message.stopReason,text:event.message.content.filter(x=>x.type==='text').map(x=>x.text),errorMessage:event.message.errorMessage});
      if (event.type === 'agent_settled') {
        log('agent_settled',{pid:pi.pid,event});
        if (phase === 'warmup') {
          if (event.aborted) throw new Error('Warmup aborted');
          phase='fault'; send(prompt('fault-active')); send(prompt('fault-queued'));
        }
      }
    }
  });
  pi.stderr.on('data',chunk=>log('stderr',{text:chunk.toString().replace(/(?:sk-|Bearer )[A-Za-z0-9_.-]+/g,'[REDACTED]')}));
  pi.on('exit',(code,signal)=>{
    log('process_exit',{pid:pi.pid,code,signal});
    if (phase==='killing') {phase='recovering';launch(true);}
    else {clearTimeout(timeout);if(code!==0)process.exitCode=1;}
  });
  send({id:recover?'recovered-state':'initial-state',type:'get_state'});
}
timeout=setTimeout(()=>{log('deadline',{phase,unresolved:true});child.stdin.end();setTimeout(()=>child.kill('SIGTERM'),1000);process.exitCode=1;},45000);
launch(false);
