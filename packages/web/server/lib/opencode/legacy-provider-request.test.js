import {describe,expect,test} from 'vitest';
import {createLegacyProviderRequest,LEGACY_PROVIDER_ROUTE as R} from './legacy-provider-request.js';
const I={generation:'oc1',profile:'legacy-1.2.27',version:'1.2.27',endpoint:'http://127.0.0.1:4096',epoch:7};
function fx(extra={}){const calls=[];const api={methods:async x=>(calls.push(['methods',x]),{methods:[]}),sources:async()=>({}),save:async()=>({}),disconnect:async()=>({}),beginOAuth:async()=>({attemptId:'a'}),authorizeOAuth:async()=>({}),callbackOAuth:async()=>true,cancelOAuth:async(...x)=>calls.push(['cancel',...x]),...extra};return{calls,dispatch:createLegacyProviderRequest({api,getRuntime:()=>I})};}
const req=(p,b={})=>({method:'POST',path:R.BASE+p,body:b,caller:'c'});
describe('legacy provider request dispatcher',()=>{
 test('strictly admits schemas and binds runtime identity',async()=>{const x=fx();expect(await x.dispatch(req('/methods',{identity:I}))).toEqual({status:200,body:{methods:[]}});expect((await x.dispatch(req('/methods',{identity:I,caller:'spoof'}))).status).toBe(400);expect((await x.dispatch(req('/methods',{identity:{...I,endpoint:'old'}}))).status).toBe(409);expect(x.calls).toHaveLength(1);});
 test('requires full paths and POST, with stable missing and wrong-method statuses',async()=>{const x=fx();expect((await x.dispatch(req('/missing'))).status).toBe(404);expect((await x.dispatch({...req('/missing'),method:'GET'})).status).toBe(404);expect((await x.dispatch({...req('/methods',{identity:I}),method:'GET'})).status).toBe(405);expect((await x.dispatch({...req('/methods',{identity:I}),path:'/methods'})).status).toBe(404);});
 test('sanitizes errors while preserving validated partial outcomes',async()=>{const x=fx({disconnect:async()=>{throw Object.assign(Error('private'),{statusCode:502,outcome:{persisted:false,partial:true,removed:['user'],remaining:['project'],credential:'unknown',requiresRestart:true}});}});expect(await x.dispatch(req('/disconnect',{identity:I,providerID:'p'}))).toEqual({status:502,body:{error:'Provider request failed',outcome:{persisted:false,partial:true,removed:['user'],remaining:['project'],credential:'unknown',requiresRestart:true}}});});
 test('cancels aborted followups but not begin attempts',async()=>{const x=fx();const c=new AbortController();await x.dispatch({...req('/oauth/begin',{identity:I,providerID:'p',method:0}),signal:c.signal});c.abort();let done;const pending=new Promise(r=>done=r);const y=fx({authorizeOAuth:async()=>pending});const a=new AbortController();const running=y.dispatch({...req('/oauth/authorize',{attemptId:'a'}),signal:a.signal});a.abort();done({});await running;await Promise.resolve();expect(y.calls).toEqual([['cancel','c','a']]);expect(x.calls).toEqual([['methods',expect.anything()]].slice(1));});
});



test('finite routes exclude inherited names and foreign URLs', async () => {
 const x=fx(); for(const path of [R.BASE+'/__proto__',R.BASE+'/constructor',R.BASE+'/toString','https://other.test'+R.BASE+'/methods']) {
  expect((await x.dispatch({method:'POST',path,body:{identity:I},caller:'c'})).status).toBe(404);
 } expect(x.calls).toHaveLength(0);
});

test('enterprise policy blocks credential connection routes before API effects but permits cancellation', async () => {
  const previous=process.env.OPENCHAMBER_ENTERPRISE_MODE;
  process.env.OPENCHAMBER_ENTERPRISE_MODE='1';
  try {
    const x=fx();
    const cases=[['/save',{identity:I,providerID:'p',key:'fixture'}],['/oauth/begin',{identity:I,providerID:'p',method:0}],['/oauth/authorize',{attemptId:'a'}],['/oauth/callback',{attemptId:'a',code:'fixture'}]];
    for(const [path,body] of cases) expect((await x.dispatch(req(path,body))).status).toBe(403);
    expect(x.calls).toHaveLength(0);
    expect((await x.dispatch(req('/oauth/cancel',{attemptId:'a'}))).status).toBe(200);
    expect(x.calls).toEqual([['cancel','c','a']]);
  } finally { if(previous===undefined) delete process.env.OPENCHAMBER_ENTERPRISE_MODE; else process.env.OPENCHAMBER_ENTERPRISE_MODE=previous; }
});
