import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const express={Router(){const router={stack:[]};for(const method of ['get','post','put','patch','delete'])router[method]=(path,handle)=>{router.stack.push({route:{path,stack:[{handle}]}});return router;};return router;}};
import * as history from '../functions/pzemHistory.js';
const source=fs.readFileSync(new URL('../controllers/device/pzemController.js',import.meta.url),'utf8').replace(/^import .*;\r?$/gm,'').replace('export default router;','globalThis.testRouter=router;');
function controller(rows){
 const calls=[];
 const context={express,process,console,...history,createLogger:()=>({error(){}}),prisma:{pzemDevice:{findMany:async()=>[{id:'a'},{id:'b'}]},pzemLog:{findMany:async q=>{
 calls.push(q);let output=rows.filter(r=>(!q.where.deviceId||r.deviceId===q.where.deviceId)&&(!q.where.createdAt?.gte||r.createdAt>=q.where.createdAt.gte)&&(!q.where.createdAt?.lte||r.createdAt<=q.where.createdAt.lte));
 output.sort((a,b)=>q.orderBy.createdAt==='desc'?b.createdAt-a.createdAt:a.createdAt-b.createdAt);return output.slice(0,q.take??output.length);
 }}}};
 vm.runInNewContext(source,context);
 return {calls,async get(path,id,query={}){let status=200,body;const res={status(n){status=n;return this},json(value){body=value;return this}};const handler=context.testRouter.stack.find(l=>l.route?.path===path).route.stack[0].handle;await handler({params:{id},query},res);return {status,body};}};
}
const row=(createdAt,current,deviceId='a')=>({createdAt:new Date(createdAt),current,deviceId,power:42,voltage:220,energy:72,frequency:50,pf:0.95});
const rows=[row('2026-11-08T16:59:59.999Z',99),row('2026-11-08T17:00:00Z',0),row('2026-11-08T17:00:03Z',0.004),row('2026-11-08T17:00:06Z',null),row('2026-11-08T17:00:09Z',-1),row('2026-11-09T16:59:59.999Z',0.2),row('2026-11-09T17:00:00Z',99),row('2026-11-08T17:00:00Z',0.1,'b')];
test('WIB boundaries are independent of host timezone and reject invalid calendar dates',()=>{
 const w=history.wibWindow('2026-11-09');assert.equal(w.start.toISOString(),'2026-11-08T17:00:00.000Z');assert.equal(w.end.toISOString(),'2026-11-09T16:59:59.999Z');assert.equal(history.wibParts('2026-11-08T17:00:00Z').hour,0);
 assert.throws(()=>history.wibWindow('2026-02-30'));assert.throws(()=>history.wibWindow('2026-11-09',24));assert.throws(()=>history.wibWindow('2026-11-09',0,60));
});
test('logs route applies historical date/hour/minute and never falls back to newest data',async()=>{
 const c=controller(rows);const result=await c.get('/pzem/:id/logs','a',{date:'2026-11-09',hour:'0',minute:'0'});
 assert.equal(result.status,200);assert.equal(result.body.length,4);assert.equal(result.body[0].createdAt.toISOString(),'2026-11-08T17:00:00.000Z');assert.equal(c.calls[0].where.deviceId,'a');assert.equal(c.calls[0].orderBy.createdAt,'asc');
 const empty=await c.get('/pzem/:id/logs','a',{date:'2020-01-01'});assert.equal(empty.body.length,0);
});
test('invalid logs filters produce 400 without issuing a database query',async()=>{
 const c=controller(rows);
 for(const query of [{date:'bad'},{date:'2026-02-30'},{date:'2026-11-09',hour:'24'},{date:'2026-11-09',minute:'1'},{startDate:'bad'},{limit:'NaN'},{limit:'0'},{limit:'10001'},{order:'invalid'},{startDate:'2026-11-09T01:00:00Z',endDate:'2026-11-08T01:00:00Z'}])assert.equal((await c.get('/pzem/:id/logs','a',query)).status,400);
 assert.equal(c.calls.length,0);
});
test('explicit ISO windows and latest log ordering remain compatible',async()=>{
 const c=controller(rows);const q={startDate:'2026-11-08T17:00:00+00:00',endDate:'2026-11-08T17:00:03Z',limit:'1',order:'desc'};
 const r=await c.get('/pzem/:id/logs','a',q);assert.equal(r.body.length,1);assert.equal(r.body[0].current,0.004);
 const recent=await c.get('/pzem/:id/logs','a',{limit:'1'});assert.equal(recent.body[0].createdAt.toISOString(),'2026-11-09T17:00:00.000Z');
});
test('hourly averages retain genuine zero, exclude invalid current, and include sample counts',async()=>{
 const c=controller(rows);const r=await c.get('/pzem/:id/hourly-usage','a',{date:'2026-11-09'});assert.equal(r.status,200);assert.equal(r.body.hours.length,24);assert.equal(r.body.hours[0].avgCurrent,0.002);assert.equal(r.body.hours[0].currentSampleCount,2);assert.equal(r.body.hours[0].count,4);assert.equal(r.body.hours[1].avgCurrent,null);assert.equal(r.body.hours[23].avgCurrent,0.2);
 assert.equal(c.calls[0].where.createdAt.gte.toISOString(),'2026-11-08T17:00:00.000Z');
});
test('minute averages keep milliamps and missing data distinct',async()=>{
 const c=controller(rows);const r=await c.get('/pzem/:id/minutely-usage','a',{date:'2026-11-09',hour:'0'});assert.equal(r.status,200);assert.equal(r.body.minutes[0].avgCurrent,0.002);assert.equal(r.body.minutes[0].currentSampleCount,2);assert.equal(r.body.minutes[1].avgCurrent,null);
 const zero=controller([row('2026-11-08T17:00:00Z',0)]);assert.equal((await zero.get('/pzem/:id/minutely-usage','a',{date:'2026-11-09',hour:'0'})).body.minutes[0].avgCurrent,0);
});
test('all-device hour and minute aggregates sum device means and count genuine samples',async()=>{
 const c=controller(rows);const h=await c.get('/pzem/:id/hourly-usage','all',{date:'2026-11-09'});assert.equal(h.status,200);assert.equal(h.body.hours[0].avgCurrent,0.102);assert.equal(h.body.hours[0].count,5);assert.equal(h.body.hours[0].currentSampleCount,3);
 const m=await c.get('/pzem/:id/minutely-usage','all',{date:'2026-11-09',hour:'0'});assert.equal(m.body.minutes[0].avgCurrent,0.102);assert.equal(m.body.minutes[0].count,5);assert.equal(m.body.minutes[1].avgCurrent,null);
});
test('invalid hourly and minute windows are rejected before querying',async()=>{
 const c=controller(rows);assert.equal((await c.get('/pzem/:id/hourly-usage','a',{date:'2026-02-30'})).status,400);assert.equal((await c.get('/pzem/:id/minutely-usage','a',{date:'2026-11-09',hour:'24'})).status,400);assert.equal(c.calls.length,0);
});
