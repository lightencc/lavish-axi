const form = document.querySelector('#form');
const send = document.querySelector('#send');
const text = document.querySelector('#text');
const notice = document.querySelector('#notice');
const entries = new Map();
let pendingDraft;
function render(id, state) {
  const entry = entries.get(id);
  entry.status.className = state.delivery === 'input_witnessed' && !state.replyVerified ? 'processing' : '';
  const label = state.replyVerified ? '已回复' : state.delivery === 'input_witnessed' ? '已进入 Pi 处理输入' : state.hostQueued || state.state === 'accepted' ? '宿主已持久接纳，等待处理' : '结果待核实';
  entry.status.textContent = label;
  entry.reply.textContent = state.replyVerified ? state.reply.text : '';
  entry.evidence.textContent = JSON.stringify(state, null, 2);
  if (pendingDraft === id && (state.hostQueued || state.state === 'accepted' || state.delivery === 'input_witnessed' || state.replyVerified)) {
    pendingDraft = undefined; text.value = ''; text.readOnly = false; send.disabled = false;
  }
}
async function query(id) {
  const response = await fetch('/query?id=' + encodeURIComponent(id));
  const state = await response.json();
  if (!response.ok) throw new Error(state.error);
  render(id, state);
}
form.addEventListener('submit', async event => {
  event.preventDefault(); send.disabled = true;
  const id = 'pi3-' + crypto.randomUUID();
  pendingDraft = id; text.readOnly = true;
  const article = document.createElement('article');
  const content = document.createElement('div'); content.textContent = text.value;
  const status = document.createElement('p'); status.textContent = '发送中…';
  const reply = document.createElement('div');
  const button = document.createElement('button'); button.textContent = '查询';
  button.addEventListener('click', () => query(id).catch(error => { notice.textContent = error.message; }));
  const details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = '验证证据';
  const evidence = document.createElement('pre'); details.append(summary, evidence);
  article.append(content, status, reply, button, details); document.querySelector('#messages').append(article);
  entries.set(id, { status, reply, evidence });
  try {
    const response = await fetch('/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, text: text.value }) });
    const state = await response.json();
    if (!response.ok) throw new Error(state.error);
    render(id, state);
  } catch (error) { status.textContent = '结果待核实，请先查询'; notice.textContent = error.message; }
  finally { send.disabled = !!pendingDraft; }
});
fetch('/binding').then(async response => {
  if (!response.ok) throw new Error('无法读取绑定');
  const binding = await response.json();
  document.querySelector('#binding').textContent = `测试 session：${binding.session} · 实例：${binding.instance}`;
  send.disabled = false;
}).catch(error => { notice.textContent = error.message; });
