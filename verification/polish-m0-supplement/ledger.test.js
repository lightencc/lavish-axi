import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { Ledger } from './ledger.js';
function fixture(t) { const dir=mkdtempSync(join(tmpdir(),'polish-m0-extra-')); return join(dir,'ledger'); }
test('same external identity is admitted once; altered content conflicts',t=>{
 const l=new Ledger(fixture(t),'s'); t.after(()=>{l.close();rmSync(dirname(l.file),{recursive:true,force:true});});
 assert.equal(l.receive('a','one').fresh,true);
 assert.equal(l.receive('a','one').fresh,false);
 assert.throws(()=>l.receive('a','two'),/CONFLICT/);
});
test('dispatch with no host observation stays unknown after reopening; duplicate does not request resend',t=>{
 const file=fixture(t); let l=new Ledger(file,'s');l.receive('a','one');l.dispatch('a');l.close();
 l=new Ledger(file,'s');t.after(()=>{l.close();rmSync(dirname(l.file),{recursive:true,force:true});});
 assert.equal(l.query('a').status,'delivery_unknown');assert.equal(l.receive('a','one').fresh,false);
});
test('only a matching structured host event can mark input observed',t=>{
 const l=new Ledger(fixture(t),'s');t.after(()=>{l.close();rmSync(dirname(l.file),{recursive:true,force:true});});l.receive('a','one');l.dispatch('a');
 assert.throws(()=>l.observe({sessionId:'other',externalId:'a',digest:l.query('a').digest}),/IDENTITY/);
 assert.equal(l.query('a').status,'delivery_unknown');
 l.observe({sessionId:'s',externalId:'a',digest:l.query('a').digest});assert.equal(l.query('a').status,'input_observed');
});
test('exclusive writer claim refuses a second consumer; no stale lock stealing',t=>{
 const file=fixture(t);const l=new Ledger(file,'s');t.after(()=>{l.close();rmSync(dirname(l.file),{recursive:true,force:true});});assert.throws(()=>new Ledger(file,'s'),/EEXIST/);
});
test('ledger for a different host session is rejected',t=>{
 const file=fixture(t);const l=new Ledger(file,'s');l.receive('a','one');l.close();
 assert.throws(()=>new Ledger(file,'other'),/SESSION/);rmSync(dirname(file),{recursive:true,force:true});
});
