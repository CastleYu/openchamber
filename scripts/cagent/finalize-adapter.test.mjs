import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AGENT_OPERATION } from '../../packages/web/server/lib/agent/constants.js';
import { agentArtifactDigest } from '../../packages/web/server/lib/agent/artifacts.js';
import { loadAgentAdapter } from '../../packages/web/server/lib/agent/loader.js';
import { runFinalizeCommand } from './finalize-adapter.mjs';

const inputs = Object.freeze({ getSession:{workspaceID:'w',sessionID:'s'}, createSession:{workspaceID:'w',requestID:'r'}, listSessions:{workspaceID:'w'},
  listMessages:{workspaceID:'w',sessionID:'s'}, listChildren:{workspaceID:'w',sessionID:'s'}, listActiveStatuses:{workspaceID:'w'}, getSessionStatus:{workspaceID:'w',sessionID:'s'},
  listPendingPermissions:{workspaceID:'w'}, replyPermission:{workspaceID:'w',sessionID:'s',permissionID:'p',choice:'c',requestID:'r'}, getMessage:{workspaceID:'w',sessionID:'s',messageID:'m'},
  addSynthetic:{workspaceID:'w',sessionID:'s',text:'x',requestID:'r'}, switchSessionSelection:{workspaceID:'w',sessionID:'s',requestID:'r'}, listCommands:{workspaceID:'w'}, getSelectionCatalog:{workspaceID:'w'},
  getDefaultModel:{workspaceID:'w'}, importSession:{workspaceID:'w',session:{id:'s',workspaceID:'w'},messages:[],requestID:'r'}, forkSession:{workspaceID:'w',sessionID:'s',requestID:'r'},
  removeSession:{workspaceID:'w',sessionID:'s',requestID:'r'}, updateSession:{workspaceID:'w',sessionID:'s',requestID:'r'}, sendPrompt:{workspaceID:'w',sessionID:'s',requestID:'r',text:'x'},
  sendCommand:{workspaceID:'w',sessionID:'s',requestID:'r',commandID:'c',arguments:'',requestID:'r'}, interruptSession:{workspaceID:'w',sessionID:'s',requestID:'r'} });
const fixture = (operation) => ({ version:1, operation, cases:[{ id:'refusal', input:inputs[operation], identity:{family:'cagent',connectionID:'fixture',epoch:1,adapterRevision:'a',capabilityRevision:'c'}, exchanges:[], expected:{kind:'failure',error:'backend-failed'} }] });
const source = `export function createOperation(context) { return async function handler() { void context; throw new Error('backend-failed'); }; }`;

async function workspace(root) {
  const kit = path.join(root,'workspace'); const files=[];
  await fs.mkdir(path.join(kit,'protected'),{recursive:true});
  await fs.mkdir(path.join(kit,'candidate'),{recursive:true});
  const registration={operations:Object.values(AGENT_OPERATION).map((operation)=>({operation,directory:`candidate/${operation}`,entry:'handler.mjs',factory:'createOperation'})),
    capabilities:Object.fromEntries(Object.values(AGENT_OPERATION).map((operation)=>[operation,{state:'unverified',evidence:[]}]))};
  const add=async(relative,value)=>{const bytes=Buffer.from(JSON.stringify(value));const target=path.join(kit,'protected',...relative.split('/'));await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes);files.push({path:relative,bytes:bytes.length,digest:(await import('node:crypto')).createHash('sha256').update(bytes).digest('hex')});};
  await add('registration.json',registration);
  for(const operation of Object.values(AGENT_OPERATION)) { await add(`${operation}/fixtures.json`,fixture(operation));const dir=path.join(kit,'candidate',operation);await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'handler.mjs'),source); }
  files.sort((a,b)=>a.path<b.path?-1:1); const artifactDigest=agentArtifactDigest(files); const manifest={version:1,files,artifactDigest};
  await fs.mkdir(path.join(kit,'control'));await fs.writeFile(path.join(kit,'control','manifest.json'),JSON.stringify(manifest));
  return {kit,artifactDigest};
}
const nodePath=process.env.CAGENT_TEST_NODE;
const run=async (kit,digest,out)=>{const lines=[];const code=await runFinalizeCommand(['--workspace',kit,'--kit-digest',digest,'--node',nodePath,'--out',out,'--json'],(line)=>lines.push(line));return {code,result:JSON.parse(lines[0])};};

test('finalizes all registered operations from their passed native packets and keeps support unverified',{timeout:120000},async()=>{
  assert.ok(nodePath,'CAGENT_TEST_NODE must select the tested Node executable');const root=await fs.mkdtemp(path.join(os.tmpdir(),'cagent-finalize-'));
  try {const {kit,artifactDigest}=await workspace(root);const out=path.join(root,'result');const result=await run(kit,artifactDigest,out);assert.equal(result.code,0);assert.equal(result.result.activation,'unavailable');
    const report=JSON.parse(await fs.readFile(path.join(out,'report.json'),'utf8'));assert.equal(Object.keys(report.candidateDigests).length,22);assert.equal(Object.values(report.support).every((item)=>item==='unverified'),true);
    const manifest = JSON.parse(await fs.readFile(path.join(out, 'control/manifest.json'), 'utf8'));
    const adapter = await loadAgentAdapter({ directory: path.join(out, 'artifact'), manifest,
      profile: { family: 'cagent', adapterID: 'synthetic-finalized', adapterRevision: 'a', capabilityRevision: 'c' },
      transport: { request: async () => { throw new Error('unexpected-request'); } } });
    assert.equal(Object.keys(adapter.handlers).length, 22);
    assert.equal(Object.values(adapter.capabilities).every((item) => item.state === 'unverified' && item.evidence.length === 0), true);
  } finally {await fs.rm(root,{recursive:true,force:true});}
});

test('existing output is refused before progress is created',async()=>{const root=await fs.mkdtemp(path.join(os.tmpdir(),'cagent-finalize-output-'));try{const {kit,artifactDigest}=await workspace(root);const out=path.join(root,'exists');await fs.mkdir(out);const result=await run(kit,artifactDigest,out);assert.equal(result.result.error,'finalize-unavailable');await assert.rejects(fs.access(path.join(kit,'progress')));}finally{await fs.rm(root,{recursive:true,force:true});}});

test('protected tree changes stop finalization without publishing an artifact',async()=>{const root=await fs.mkdtemp(path.join(os.tmpdir(),'cagent-finalize-tamper-'));try{const {kit,artifactDigest}=await workspace(root);await fs.appendFile(path.join(kit,'protected','registration.json'),' ');const out=path.join(root,'result');const result=await run(kit,artifactDigest,out);assert.equal(result.result.error,'protected-kit-changed');await assert.rejects(fs.access(path.join(out,'artifact','adapter.mjs')));}finally{await fs.rm(root,{recursive:true,force:true});}});

test('a failed candidate consumes its packet check and publishes no artifact',async()=>{const root=await fs.mkdtemp(path.join(os.tmpdir(),'cagent-finalize-failed-'));try{const {kit,artifactDigest}=await workspace(root);await fs.writeFile(path.join(kit,'candidate','getSession','handler.mjs'),`export function createOperation() { return async () => { throw new Error('wrong'); }; }`);const out=path.join(root,'result');const result=await run(kit,artifactDigest,out);assert.equal(result.result.error,'candidate-failed');assert.equal(result.result.failedOperation,'getSession');await assert.rejects(fs.access(path.join(out,'artifact','adapter.mjs')));}finally{await fs.rm(root,{recursive:true,force:true});}});

test('all individually passing factories are rechecked together before publication', {timeout:120000}, async()=>{const root=await fs.mkdtemp(path.join(os.tmpdir(),'cagent-finalize-cross-'));try{const {kit,artifactDigest}=await workspace(root);for(const operation of Object.values(AGENT_OPERATION)){const text=`export function createOperation() { globalThis.__cagentCurrent = '${operation}'; return async () => { if (globalThis.__cagentCurrent !== '${operation}') throw new Error('cross-operation-mismatch'); throw new Error('backend-failed'); }; }`;await fs.writeFile(path.join(kit,'candidate',operation,'handler.mjs'),text);}const out=path.join(root,'result');const result=await run(kit,artifactDigest,out);assert.equal(result.result.error,'candidate-failed');assert.equal(result.result.failedOperation,'getSession');await assert.rejects(fs.access(path.join(out,'artifact','adapter.mjs')));}finally{await fs.rm(root,{recursive:true,force:true});}});
