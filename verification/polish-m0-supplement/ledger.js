// Experiment ledger: durable local facts, never a claim of host exactly-once.
import { openSync, readFileSync, writeSync, fsyncSync, closeSync, unlinkSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
export class Ledger {
  constructor(file, sessionId) {
    this.file=file; this.sessionId=sessionId; this.records=new Map();
    if (existsSync(file)) for (const line of readFileSync(file,'utf8').split('\n').filter(Boolean)) {
      const r=JSON.parse(line);
      if (r.sessionId!==sessionId) throw new Error('SESSION mismatch');
      this.records.set(r.externalId,r);
    }
    this.claim=openSync(file+'.lock','wx',0o600);
    writeSync(this.claim,JSON.stringify({pid:process.pid,sessionId}));fsyncSync(this.claim);
    this.fd=openSync(file,'a',0o600);
  }
  save(r) {
    writeSync(this.fd,JSON.stringify({...r,at:new Date().toISOString()})+'\n');fsyncSync(this.fd);
    this.records.set(r.externalId,r);
  }
  receive(externalId,text) {
    const digest=createHash('sha256').update(text).digest('hex');
    const existing=this.records.get(externalId);
    if(existing){if(existing.digest!==digest)throw new Error('CONFLICT');return {fresh:false,...this.query(externalId)};}
    this.save({sessionId:this.sessionId,externalId,digest,text,state:'received'});
    return {fresh:true,...this.query(externalId)};
  }
  dispatch(id) {
    const r=this.records.get(id);if(!r||r.state!=='received')throw new Error('Not dispatchable');
    this.save({...r,state:'dispatching'});
  }
  observe({sessionId,externalId,digest}) {
    const r=this.records.get(externalId);
    if(sessionId!==this.sessionId||!r||r.digest!==digest)throw new Error('IDENTITY mismatch');
    if(r.state==='input_observed')return;
    if(r.state!=='dispatching')throw new Error('Not dispatched');
    this.save({...r,state:'input_observed'});
  }
  query(id) {
    const r=this.records.get(id);
    return r?{externalId:id,digest:r.digest,sessionId:this.sessionId,status:r.state==='dispatching'?'delivery_unknown':r.state}:{externalId:id,status:'no_local_record',sessionId:this.sessionId};
  }
  close(){closeSync(this.fd);closeSync(this.claim);unlinkSync(this.file+'.lock');}
}
