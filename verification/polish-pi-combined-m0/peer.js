import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export function startPeer(run, log) {
  const args = ['--mode', 'rpc', '--offline', '--no-tools', '--no-mcp', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-themes', '--no-context-files', '--no-approve', '--extension', resolve('verification/polish-pi-combined-m0/host-extension.js'), '--session-dir', resolve(run, 'sessions'), '--name', `POLISH-COMBINED-M0-${randomUUID()}`];
  const child = spawn('pi', args, { cwd: resolve(run, 'workspace'), env: { ...process.env, POLISH_COMBINED_RUN_DIR: run }, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map(); let rest = '', bound, resolveReady, rejectReady;
  const ready = new Promise((res, rej) => { resolveReady = res; rejectReady = rej; });
  const readyTimeout = setTimeout(() => rejectReady(new Error('READY_TIMEOUT')), 15000);
  const request = (key, payload) => new Promise((res, rej) => {
    const timeout = setTimeout(() => { pending.delete(key); rej(new Error('RESULT_UNKNOWN')); }, 15000);
    pending.set(key, { res, rej, timeout });
    child.stdin.write(JSON.stringify(payload) + '\n');
  });
  const complete = (key, value, error) => {
    const waiting = pending.get(key); if (!waiting) return;
    clearTimeout(waiting.timeout); pending.delete(key);
    if (error) waiting.rej(new Error(error)); else waiting.res(value);
  };
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    const lines = (rest + chunk).split('\n'); rest = lines.pop();
    for (const line of lines.filter(Boolean)) {
      const event = JSON.parse(line);
      if (event.type === 'response') {
        complete(`rpc:${event.id}`, event, event.success ? null : event.error);
      }
      if (event.type === 'extension_ui_request' && event.method === 'notify' && event.message?.startsWith('POLISH_COMBINED_M0 ')) {
        const data = JSON.parse(event.message.slice('POLISH_COMBINED_M0 '.length)); log('host', data);
        if (data.kind === 'ready') { bound = data.binding; clearTimeout(readyTimeout); resolveReady(data); }
        if (data.kind === 'result') complete(`business:${data.requestId}`, data.value, data.ok ? null : data.error);
      }
      if (['agent_settled', 'extension_error'].includes(event.type)) log('pi_event', event);
    }
  });
  // Do not retain arbitrary stderr or model reasoning in the evidence log.
  child.stderr.on('data', chunk => log('stderr_bytes', { bytes: chunk.length }));
  const exited = new Promise(resolveExit => child.on('exit', (code, signal) => {
    clearTimeout(readyTimeout); rejectReady(new Error('HOST_EXITED'));
    for (const [key] of pending) complete(key, null, 'RESULT_UNKNOWN_HOST_EXITED');
    log('exit', { pid: child.pid, code, signal }); resolveExit({ code, signal });
  }));
  child.on('error', error => { clearTimeout(readyTimeout); rejectReady(error); });
  log('started', { pid: child.pid, args });
  return {
    child, ready, exited,
    rpc(command) { const id = randomUUID(); return request(`rpc:${id}`, { ...command, id }); },
    command(op, data) {
      if (!bound) throw new Error('NOT_BOUND');
      const requestId = randomUUID();
      return request(`business:${requestId}`, { id: randomUUID(), type: 'prompt', message: '/polish-combined-m0 ' + JSON.stringify({ ...data, op, requestId, binding: bound }) });
    },
  };
}
