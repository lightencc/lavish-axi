// Controlled M0 host probe. No artifact server, production bridge, or automatic retry.
import { spawn } from 'node:child_process';
import { openSync, writeSync, fsyncSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { splitJsonl, classify } from './probe-support.js';

const root = resolve('verification/polish-m0');
const cwd = resolve(root, 'runtime/pi-workspace');
mkdirSync(cwd, { recursive: true });
mkdirSync(resolve(root, 'runtime/pi-sessions'), { recursive: true });
const log = openSync(resolve(root, 'evidence/pi-events.jsonl'), 'ax', 0o600);
const started = performance.now();
function record(kind, data) {
  const event = { at: new Date().toISOString(), elapsed_ms: performance.now() - started, kind, ...data };
  writeSync(log, JSON.stringify(event) + '\n');
  fsyncSync(log);
  if (kind !== 'message_update') process.stdout.write(JSON.stringify(event) + '\n');
}
const args = ['--mode', 'rpc', '--offline', '--no-tools', '--no-mcp', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-themes', '--no-context-files', '--no-approve', '--session-dir', resolve(root, 'runtime/pi-sessions'), '--name', 'POLISH-M0-ISOLATED-20261030'];
const pi = spawn('/Users/lightencc/.homebrew/bin/pi', args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
record('probe_start', { pid: pi.pid, parent_pid: process.pid, cwd, args, existing_session_attached: false });
let rest = '';
const decoder = new StringDecoder('utf8');
pi.stdout.on('data', (chunk) => {
  const parsed = splitJsonl(rest, decoder.write(chunk)); rest = parsed.rest;
  for (const event of parsed.records) {
    if (event.type === 'response' && event.command === 'get_state' && event.data?.model) {
      const model = event.data.model; event.data.model = { id: model.id, provider: model.provider, api: model.api };
    }
    // Preserve protocol evidence, excluding hidden reasoning text from the evidence bundle.
    if (event.type === 'message_update' && event.assistantMessageEvent?.type?.startsWith('thinking')) {
      record('thinking_event_omitted', { event_type: event.assistantMessageEvent.type }); continue;
    }
    if (event.message?.content && Array.isArray(event.message.content)) {
      event.message.content = event.message.content.filter((part) => part.type !== 'thinking');
    }
    if (event.type === 'agent_end' && event.messages) {
      event.messages = event.messages.map((m) => ({ ...m, content: Array.isArray(m.content) ? m.content.filter((p) => p.type !== 'thinking') : m.content }));
    }
    record(event.type, { classification: classify(event), event });
  }
});
pi.stderr.on('data', (chunk) => record('pi_stderr', { text: chunk.toString().replace(/(?:sk-|Bearer )[A-Za-z0-9_.-]+/g, '[REDACTED]') }));
pi.on('error', (error) => record('spawn_error', { message: error.message }));
pi.on('exit', (code, signal) => { record('probe_exit', { code, signal }); process.exitCode = code ?? 1; process.stdin.pause(); });
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  const parsed = splitJsonl(input, chunk); input = parsed.rest;
  for (const command of parsed.records) {
    if (command.type === 'probe_close') { record('probe_close', {}); pi.stdin.end(); continue; }
    if (!['get_state', 'get_messages', 'get_entries', 'prompt'].includes(command.type)) throw new Error('Probe command not allowed');
    if (command.type === 'prompt' && (!command.message.startsWith('[POLISH-M0 ') || command.streamingBehavior !== 'followUp')) throw new Error('Only marked, non-interrupting M0 prompts allowed');
    record('local_persisted', { command });
    pi.stdin.write(JSON.stringify(command) + '\n');
    record('stdin_written', { request_id: command.id });
  }
});
process.stdin.on('end', () => pi.stdin.end());
