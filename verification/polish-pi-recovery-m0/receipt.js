// Positive-only query of a trusted Pi history branch. Never infer absence of execution.
export function recoverReply(binding, record, entries) {
  const expected = { ...binding, id: record.id, epoch: record.epoch, digest: record.digest, attempt: record.claim.attempt };
  const matches = value => value && Object.entries(expected).every(([k, v]) => value[k] === v);
  const unknown = reason => ({ status: 'unknown', reason, safeToResend: false });
  const markers = entries.filter(e => e.type === 'custom' && e.customType === 'polish-recovery-receipt' && matches(e.data));
  if (markers.length !== 1) return unknown('missing_or_ambiguous_receipt');
  const marker = markers[0];
  const inputs = entries.filter(e => e.id === marker.data.inputEntryId && e.type === 'custom_message' && e.customType === 'polish-recovery-input' && matches(e.details));
  const replies = entries.filter(e => e.id === marker.data.replyEntryId && e.type === 'message' && e.message?.role === 'assistant');
  if (inputs.length !== 1 || replies.length !== 1 || marker.data.inputEvidence !== 'context_with_system') return unknown('unverified_reference');
  if (!(entries.indexOf(inputs[0]) < entries.indexOf(replies[0]) && entries.indexOf(replies[0]) < entries.indexOf(marker))) return unknown('invalid_order');
  if (replies[0].message.stopReason !== 'stop') return unknown('reply_not_successful');
  return { status: 'verified_reply', safeToResend: false, proof: { ...expected, kind: 'reply', evidenceId: marker.id, inputEvidence: marker.data.inputEvidence, replyEntryId: replies[0].id } };
}
