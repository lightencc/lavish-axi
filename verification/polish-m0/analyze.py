"""Analyze recorded M0 observations only; never sends or retries a message."""
from pathlib import Path
import json, math, hashlib
root=Path(__file__).resolve().parent
rows=[json.loads(l) for l in (root/'evidence/pi-events.jsonl').read_text().splitlines()]

def text_of(message):
    content=message.get('content',[])
    return content if isinstance(content,str) else ''.join(p.get('text','') for p in content if p.get('type')=='text')

samples=[]
for index,row in enumerate(rows):
    c=row.get('command',{})
    if row['kind']!='local_persisted' or c.get('type')!='prompt': continue
    after=rows[index+1:]
    # Every probe has a unique marker except the intentional duplicate fixture.
    ack=next((r for r in after if r.get('event',{}).get('id')==c['id'] and r['kind']=='response'),None)
    consumed=next((r for r in after if r['kind']=='message_start' and r.get('event',{}).get('message',{}).get('role')=='user' and text_of(r['event']['message'])==c['message']),None)
    marker=c['message'].split(']')[0].removeprefix('[POLISH-M0 ')
    reply=next((r for r in after if r['kind']=='message_end' and r.get('event',{}).get('message',{}).get('role')=='assistant' and text_of(r['event']['message'])==f'M0_ACK_{marker}'),None)
    # First host assistant event after this input: isolated sequential probes only.
    start=next((r for r in after if consumed and r['elapsed_ms']>consumed['elapsed_ms'] and r['kind']=='message_start' and r.get('event',{}).get('message',{}).get('role')=='assistant'),None)
    delta=next((r for r in after if consumed and r['elapsed_ms']>consumed['elapsed_ms'] and r['kind']=='message_update' and r.get('event',{}).get('assistantMessageEvent',{}).get('type')=='text_delta'),None)
    written=next((r for r in after if r['kind']=='stdin_written' and r.get('request_id')==c['id']),None)
    sample={'request_id':c['id'],'marker':marker,'local_record_at':row['at'],'disposition':ack.get('event',{}).get('data',{}).get('disposition') if ack else None,'outcome':'replied' if reply else 'incomplete','evidence_lines':{'local':index+1}}
    for name,event in [('stdin_write',written),('host_accept',ack),('input_observed',consumed),('assistant_start_observed',start),('first_text_observed',delta),('reply_observed',reply)]:
        sample[name+'_ms']=round(event['elapsed_ms']-row['elapsed_ms'],3) if event else None
        sample['evidence_lines'][name]=rows.index(event)+1 if event else None
    samples.append(sample)
latency=[s for s in samples if s['marker'].startswith('pi-latency-')]
metrics={}
for key in ['stdin_write_ms','host_accept_ms','input_observed_ms','assistant_start_observed_ms','first_text_observed_ms','reply_observed_ms']:
    values=sorted(s[key] for s in latency if s[key] is not None)
    metrics[key]={'n':len(values),'p50':values[math.ceil(len(values)*.5)-1] if values else None,'p95':values[math.ceil(len(values)*.95)-1] if values else None,'max':max(values) if values else None}
summary={'scope':'Direct RPC, not browser or production bridge. Marker matching is probe-only, not a trusted production receipt protocol.','clock':'Single probe performance.now; durations include per-event fsync observer overhead. local_persisted timestamp is recorded before fsync, stdin_write_ms bounds durable-write completion; not a page click measurement.','sample_count':len(latency),'incomplete_count':sum(s['outcome']!='replied' for s in latency),'all_prompt_attempts':len(samples),'metrics':metrics,'samples':samples,'runtime_errors':[r for r in rows if r['kind'] in ['pi_stderr','spawn_error'] or r.get('event',{}).get('message',{}).get('stopReason')=='error']}
(root/'evidence/pi-latency.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in summary.items() if k not in ['samples']},ensure_ascii=False,indent=2))
# Refresh only this probe's persisted user entries; never inspect unrelated sessions.
p=next((root/'runtime/pi-sessions').glob('*.jsonl'))
entries=[json.loads(l) for l in p.read_text().splitlines()]
users=[{k:d[k] for k in ['id','parentId','timestamp','message'] if k in d} for d in entries if d.get('message',{}).get('role')=='user']
(root/'evidence/pi-persisted-user-entries.json').write_text(json.dumps({'session_file':str(p),'session_sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'users':users},ensure_ascii=False,indent=2)+'\n')
