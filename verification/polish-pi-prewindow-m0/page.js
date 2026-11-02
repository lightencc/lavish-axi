// Isolated fixture: session submissions only, no DOM anchoring or production chrome.
const $ = id => document.getElementById(id);
let state, busy = false, source;
const replies = new Map(), fetching = new Set();
const labels = { accepted: '已保存 · 等待接收', dispatching: '正在投递', host_queued: '已接纳 · 等待处理输入', unknown: '正在核实接收结果', delivered: 'agent 已收到 · 正在处理', replied: '已回复 · 待确认' };
const pendingKey = () => 'polish-r2-pending:' + state.binding.instance + ':' + state.epoch;
const samples = [];
window.polishM0Samples = samples;
async function request(path, data) {
  const response = await fetch(path, data ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : undefined);
  const body = await response.json(); if (!response.ok) throw new Error(body.error); return body;
}
function render() {
  $('status').textContent = state ? `当前会话 · ${state.lifecycle === 'open' ? '通信中' : state.lifecycle === 'ending' ? '正在交付最后反馈' : '通信已结束'}` : '正在连接';
  $('send').disabled = $('end').disabled = busy || !state || state.lifecycle !== 'open';
  $('messages').replaceChildren();
  for (const m of state?.messages ?? []) {
    const article = document.createElement('article'); article.dataset.state = m.state; article.dataset.messageId = m.id;
    article.textContent = `${m.kind === 'end' ? '结束标记' : m.text}\n${labels[m.state] ?? m.state}${replies.has(m.id) ? '\n\n' + replies.get(m.id) : ''}`;
    $('messages').append(article);
  }
}
function apply(next) {
  if (state && next.version < state.version) return;
  const prior = state;
  if (!state || next.version > state.version) state = next;
  // State deduplication does not settle failed reply reads. Reconcile the cache
  // against the current state even when refresh/reconnect repeats its version.
  next = state;
  const pending = JSON.parse(sessionStorage.getItem(pendingKey()) || 'null');
  if (pending && next.messages.some(m => m.id === pending.id)) { sessionStorage.removeItem(pendingKey()); $('notice').textContent = '提交已保存'; }
  for (const m of next.messages) {
    const sample = samples.find(s => s.id === m.id);
    if (sample && m.consumed) sample.inputVisibleAt ??= performance.now();
    if (m.state === 'replied') {
      if (sample) sample.replyStateVisibleAt ??= performance.now();
      if (prior?.messages.find(p => p.id === m.id)?.state !== 'replied') $('notice').textContent = '有新回复';
      if (!replies.has(m.id) && !fetching.has(m.id)) {
        fetching.add(m.id);
        request('/query', { binding: next.binding, epoch: next.epoch, id: m.id }).then(result => {
          if (result.reply) { replies.set(m.id, result.reply.text); if (sample) sample.replyTextVisibleAt ??= performance.now(); render(); }
        }).catch(error => { $('notice').textContent = error.message; }).finally(() => fetching.delete(m.id));
      }
    }
  }
  if (next.lifecycle === 'ended') $('notice').textContent = '最后反馈已被接收，通信已结束';
  render();
}
async function submit(end = false) {
  if (busy || !state || state.lifecycle !== 'open') return;
  const text = $('text').value.trim(); if (!end && !text) return;
  if (sessionStorage.getItem(pendingKey())) { $('notice').textContent = '上次提交结果仍待核实，请先刷新状态；不会自动重发。'; return; }
  busy = true; render();
  const id = 'r3-' + crypto.randomUUID();
  const data = end ? { binding: state.binding, epoch: state.epoch, id, final: text ? { id: 'r3-' + crypto.randomUUID(), epoch: state.epoch, text } : null } : { binding: state.binding, epoch: state.epoch, id, text, scope: 'session' };
  const sample = { id: end ? id + '-marker' : id, submitAt: performance.now(), wallAt: Date.now() }; samples.push(sample);
  sessionStorage.setItem(pendingKey(), JSON.stringify({ id: sample.id, data }));
  try {
    const result = await request(end ? '/end' : '/submit', data); sample.acceptedVisibleAt = performance.now();
    sessionStorage.removeItem(pendingKey()); $('text').value = ''; sessionStorage.removeItem('polish-r2-draft'); apply(result);
  } catch (error) { $('notice').textContent = `提交结果需核实：${error.message}；已保留输入。`; }
  finally { busy = false; render(); }
}
$('text').value = sessionStorage.getItem('polish-r2-draft') || '';
$('text').addEventListener('input', () => sessionStorage.setItem('polish-r2-draft', $('text').value));
$('composer').addEventListener('submit', event => { event.preventDefault(); void submit(); });
$('end').addEventListener('click', () => { void submit(true); });
$('refresh').addEventListener('click', () => { void request('/snapshot').then(apply).catch(error => { $('notice').textContent = error.message; }); });
source = new EventSource('/events');
source.onopen = () => render();
source.onmessage = event => apply(JSON.parse(event.data));
source.onerror = () => { $('status').textContent = '连接中断 · 正在重新同步'; };
window.addEventListener('pagehide', () => source.close());
await request('/snapshot').then(apply).catch(error => { $('notice').textContent = error.message; });
