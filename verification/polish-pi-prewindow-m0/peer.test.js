import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startPeer } from './peer.js';

test('failed Pi spawn settles both readiness and cleanup without an exit event', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'polish-no-pi-'));
  mkdirSync(join(dir, 'workspace'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = process.env.PATH;
  let peer;
  try { process.env.PATH = dir; peer = startPeer(dir, () => {}); }
  finally { process.env.PATH = path; }
  await assert.rejects(peer.ready, { code: 'ENOENT' });
  let timer;
  const result = await Promise.race([peer.exited, new Promise(resolve => { timer = setTimeout(() => resolve('unsettled'), 150); })]);
  clearTimeout(timer);
  assert.notEqual(result, 'unsettled');
  assert.equal(peer.child.pid, undefined);
});
