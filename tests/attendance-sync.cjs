const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../app-4.14.5.js'),'utf8');
const sync=source.slice(source.indexOf('/* ===== 4.14.5 seamless optimistic attendance'),source.indexOf('/* Keep cloud/realtime renders'));
const loader=source.slice(source.indexOf('async function loadCloudData4120('),source.indexOf('\nloadCloudData = loadCloudData4120;'));
const offline=source.slice(source.indexOf('async function flushOfflineAttendanceQueue4120('),source.indexOf('\nasync function toggleAttendance4120('));
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function setup(){
  const state={players:[{id:'a',active:true,attending:false},{id:'b',active:true,attending:false}]};
  const writes=[],reads=[],timers=new Map(),alerts=[],active=new Map();let nextTimer=1,queue=[];
  const c=vm.createContext({state,window:{},console,CSS:{escape:x=>x},currentUser:{id:'user'},db:{},navigator:{onLine:true},
    document:{querySelector:()=>({classList:{toggle(){}}}),getElementById:()=>null},renderAttendancePlayerRow:()=>({dataset:{}}),
    canMarkAttendance:()=>true,canMarkAttendanceForPlayer:()=>true,canManageGames:()=>true,
    alert:x=>alerts.push(x),renderAll(){},renderPresentList(){},renderGameNightDashboard4120(){},saveSafeStartupSnapshot41121(){},
    queueMicrotask,loadProfile:async()=>{},
    setTimeout(fn,ms){const id=nextTimer++;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),
    readOfflineAttendanceQueue4120:()=>structuredClone(queue),writeOfflineAttendanceQueue4120:value=>queue=structuredClone(value),
    queueAttendance4120(id,present){queue=queue.filter(x=>x.playerId!==String(id));queue.push({playerId:String(id),present});},
    applyOfflineAttendanceQueueToState4120(){for(const item of queue){const p=state.players.find(p=>p.id===item.playerId);if(p)p.attending=item.present;}},
    isNetworkError4120:error=>String(error?.message||error).includes('network'),
    saveAttendanceFromApp(id,present){const d=deferred();active.set(id,(active.get(id)||0)+1);assert.equal(active.get(id),1,'only one write per player');writes.push({id,present,resolve:d.resolve});return d.promise.finally(()=>active.set(id,active.get(id)-1));},
    fetchBootstrap4120(){const d=deferred();reads.push(d);return d.promise;},
    applyBootstrapPayload4120(payload){state.players=structuredClone(payload.players);},
  });
  vm.runInContext('let cloudLoadPromise4120=null,cloudRequest4145=0,cloudApplied4145=0,offlineFlushRunning4120=false;\n'+loader+'\n'+offline+'\n'+sync,c);
  const payload=present=>({payload:{players:[{id:'a',active:true,attending:present},{id:'b',active:true,attending:false}],profile:{id:'user'}}});
  return {c,state,writes,reads,timers,alerts,payload,queue:()=>queue,pending:()=>vm.runInContext('attendancePending4142',c)};
}
let count=0;async function test(name,fn){await fn();count++;console.log('PASS '+name);}
(async()=>{
await test('rapid toggles update immediately and serialize the newest final intent',async()=>{
  const h=setup();h.c.toggleAttendance4142('a');h.c.toggleAttendance4142('a');h.c.toggleAttendance4142('a');
  assert.equal(h.state.players[0].attending,true);assert.equal(h.writes.length,1);
  h.writes[0].resolve({error:null});await settle();assert.equal(h.writes.length,2);assert.equal(h.writes[1].present,true);
  h.writes[1].resolve({error:null});await settle();assert.equal(h.pending().get('a').confirmed,true);
  assert.equal([...h.timers.values()].filter(t=>t.ms===450).length,1);
});
await test('next tap inverts pending intent even if a refresh has replaced the player object',async()=>{
  const h=setup();h.c.toggleAttendance4142('a');h.state.players[0].attending=false;h.c.toggleAttendance4142('a');
  assert.equal(h.pending().get('a').desired,false);assert.equal(h.state.players[0].attending,false);
  h.writes[0].resolve({error:null});await settle();assert.equal(h.writes[1].present,false);
  h.writes[1].resolve({error:null});await settle();
});
await test('older refresh finishing last cannot undo a confirmed attendance change',async()=>{
  const h=setup();const old=h.c.loadCloudData4120({force:true});h.c.toggleAttendance4142('a');
  h.writes[0].resolve({error:null});await settle();const fresh=h.c.loadCloudData4120({force:true});
  h.reads[1].resolve(h.payload(true));await fresh;assert.equal(h.pending().size,0);
  h.reads[0].resolve(h.payload(false));await old;assert.equal(h.state.players[0].attending,true);
});
await test('read started before save cannot acknowledge it even when values match',async()=>{
  const h=setup();const early=h.c.loadCloudData4120({force:true});h.c.toggleAttendance4142('a');
  h.writes[0].resolve({error:null});await settle();h.reads[0].resolve(h.payload(true));await early;
  assert.equal(h.pending().size,1);const fresh=h.c.loadCloudData4120({force:true});h.reads[1].resolve(h.payload(true));await fresh;
  assert.equal(h.pending().size,0);
});
await test('offline replay and a new live tap share one writer and end at the latest value',async()=>{
  const h=setup();h.c.navigator.onLine=false;h.c.toggleAttendance4142('a');assert.equal(h.queue()[0].present,true);
  h.c.navigator.onLine=true;const flush=h.c.flushOfflineAttendanceQueue4120();h.c.toggleAttendance4142('a');
  assert.equal(h.writes.length,1);h.writes[0].resolve({error:null});await settle();
  assert.equal(h.writes[1].present,false);h.writes[1].resolve({error:null});await flush;
  assert.equal(h.queue().length,0);assert.equal(h.state.players[0].attending,false);
});
await test('network failure backs off and preserves latest queued intent',async()=>{
  const h=setup();h.c.toggleAttendance4142('a');h.c.toggleAttendance4142('a');
  h.writes[0].resolve({error:{message:'network offline'}});await settle();
  assert.equal(h.writes.length,1);assert.equal(h.queue()[0].present,false);
  const retry=[...h.timers.values()].find(t=>t.ms===2000);assert.ok(retry);retry.fn();
  assert.equal(h.writes[1].present,false);h.writes[1].resolve({error:null});await settle();assert.equal(h.queue().length,0);
});
await test('failure of an older request does not discard a newer tap',async()=>{
  const h=setup();h.c.toggleAttendance4142('a');h.c.toggleAttendance4142('a');h.writes[0].resolve({error:{message:'request rejected'}});await settle();
  assert.equal(h.writes[1].present,false);assert.equal(h.pending().get('a').desired,false);
  h.writes[1].resolve({error:null});await settle();assert.equal(h.alerts.length,0);
});
console.log(`${count} attendance sync regressions passed.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
