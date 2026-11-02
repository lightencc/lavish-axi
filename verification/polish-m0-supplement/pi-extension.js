// Explicitly loaded only in our isolated M0 instance. No sockets, model tools, or retries.
import { join, resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { Ledger } from './ledger.js';
const type='polish-m0-supplement';
export default function(pi) {
  let ledger, file;
  const tell=(ctx,data)=>ctx.ui.notify('POLISH_M0_EVIDENCE '+JSON.stringify(data),'info');
  pi.on('session_start',(_event,ctx)=>{
    const base=process.env.POLISH_M0_SUPPLEMENT_DIR;
    if(!base||!resolve(base).endsWith('/verification/polish-m0-supplement/runtime'))throw new Error('Isolated directory required');
    file=join(base,ctx.sessionManager.getSessionId()+'.jsonl');
    if(process.env.POLISH_M0_READ_ONLY!=='1')ledger=new Ledger(file,ctx.sessionManager.getSessionId());
    tell(ctx,{kind:'bound',sessionId:ctx.sessionManager.getSessionId(),pid:process.pid,readOnly:!ledger,file});
  });
  pi.on('session_shutdown',()=>{ledger?.close();ledger=undefined;});
  pi.on('message_start',(event,ctx)=>{
    if(event.message.role!=='custom'||event.message.customType!==type)return;
    ledger.observe(event.message.details);
    tell(ctx,{kind:'input_observed',...ledger.query(event.message.details.externalId)});
  });
  pi.registerCommand('polish-m0-probe',{
    description:'Isolated supplemental M0 command; not a production integration',
    handler:async(args,ctx)=>{
      const c=JSON.parse(args);
      if(c.op==='setup-entry'){
        pi.appendEntry(type,{externalId:c.id,state:'setup-only'});
        tell(ctx,{kind:'setup_entry',inMemory:ctx.sessionManager.getBranch().some(e=>e.customType===type),fileExists:existsSync(ctx.sessionManager.getSessionFile())});return;
      }
      if(c.op==='query'){
        const records=existsSync(file)?readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
        const record=records.filter(r=>r.externalId===c.id).at(-1);
        const entries=ctx.sessionManager.getBranch().filter(e=>e.type==='custom_message'&&e.customType===type&&e.details?.externalId===c.id).map(e=>({id:e.id,details:e.details}));
        tell(ctx,{kind:'query',id:c.id,record:record?{...record,text:undefined}:null,hostEntries:entries,status:record?.state==='dispatching'?'delivery_unknown':record?.state??'no_local_record',readOnly:!ledger});return;
      }
      if(c.op!=='receive'||!ledger)throw new Error('Read-only or unsupported command');
      if(!/^supp-[a-z0-9-]+$/.test(c.id)||typeof c.text!=='string'||!c.text.startsWith('[POLISH-M0-SUPPLEMENT '))throw new Error('Only new marked probes');
      const receipt=ledger.receive(c.id,c.text);
      tell(ctx,{kind:'received',...receipt});
      if(!receipt.fresh)return;
      pi.appendEntry(type,{externalId:c.id,digest:receipt.digest,state:'received'});
      ledger.dispatch(c.id);
      if(c.holdBeforeDispatch){tell(ctx,{kind:'fault_hold',id:c.id,status:'delivery_unknown'});await new Promise(()=>{});return;}
      pi.sendMessage({customType:type,content:c.text,display:true,details:{sessionId:ctx.sessionManager.getSessionId(),externalId:c.id,digest:receipt.digest}},{triggerTurn:true,deliverAs:'followUp'});
    }
  });
}
