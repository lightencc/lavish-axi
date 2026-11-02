// M0 evidence helpers only; these classifications are not product receipts.
export function splitJsonl(rest, chunk) {
  const lines = (rest + chunk).split('\n');
  const tail = lines.pop();
  return { records: lines.filter((line) => line.trim()).map((line) => JSON.parse(line)), rest: tail };
}
export function classify(record) {
  if (record.type === 'probe_transport_timeout') return 'delivery_unknown';
  if (record.type === 'response' && ['prompt', 'follow_up'].includes(record.command)) {
    return record.success ? 'host_acceptance' : 'not_accepted';
  }
  if (record.type === 'message_start') {
    if (record.message?.role === 'user') return 'input_observed';
    if (record.message?.role === 'assistant') return 'assistant_started';
  }
  return 'observation';
}
