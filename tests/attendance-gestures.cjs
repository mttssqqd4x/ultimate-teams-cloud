// Run with Node: node tests/attendance-gestures.cjs
// Regression harness for release timing, native click delivery and row replacement.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../app-4.14.4.js'), 'utf8');
const gestures = source.slice(source.indexOf('// One gesture per document.'), source.indexOf('\nconst renderAttendancePlayerRowBefore4132'));
const rendering = source.slice(source.indexOf('/* Keep cloud/realtime renders'), source.indexOf('\nfunction scrollAppTo4144'));
function setup(){
  let now=0, nextTimer=1, opens=0, renders=0, clicks=0;
  const timers=new Map();
  class Target{
    constructor(id){this.id=id;this.dataset={};this.isConnected=true;this.handlers={};this.classList={add(){},remove(){}};}
    addEventListener(type, fn, options){(this.handlers[type] ||= []).push({fn,capture:options===true || !!options?.capture});}
    setAttribute(){}
    closest(selector){return selector.includes('#playerList') ? this : null;}
    contains(target){return target===this;}
    emit(type,event,capture){for(const h of this.handlers[type] || []){if(capture!==undefined && h.capture!==capture)continue;h.fn(event);if(event.stopped)break;}}
  }
  const win = new Target(), doc = new Target();doc.hidden=false;
  const context=vm.createContext({window:win,document:doc,navigator:{},Date:{now:()=>now},
    PLAYER_HOLD_MS_4132:900,PLAYER_HOLD_MOVE_PX_4132:7,
    setTimeout(fn,ms){const id=nextTimer++;timers.set(id,{at:now+ms,fn});return id;},
    clearTimeout(id){timers.delete(id);},canManageGames:()=>true,
    openPlayerActions4132:()=>opens++,renderPlayers:()=>renders++});
  vm.runInContext(gestures+'\n'+rendering,context);
  function row(id){const r=new Target(id);context.bindPlayerHoldActions4132(r,{id});r.onclick=()=>clicks++;return r;}
  function send(type,r,extra={}){
    const event={target:r,button:0,isPrimary:true,pointerType:'touch',pointerId:1,clientX:10,clientY:10,
      preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;},...extra};
    win.emit(type,event,true);
    if(!event.stopped && r.isConnected){r.emit(type,event,true);if(!event.stopped)r.emit(type,event,false);}
    if(!event.stopped && r.isConnected && type==='click')r.onclick?.();
    if(!event.stopped)win.emit(type,event,false);
    return event;
  }
  function advance(ms){const end=now+ms;while(true){const item=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!item)break;now=item[1].at;timers.delete(item[0]);item[1].fn();}now=end;}
  return {row,send,advance,win,doc,context,stats:()=>({opens,renders,clicks})};
}
const checks=[];
function test(name,fn){fn();checks.push(name);console.log('PASS '+name);}
test('100 quick taps survive refreshes before release and before native click',()=>{
  const h=setup(), rows=Array.from({length:10},(_,i)=>h.row(i));
  for(let i=0;i<100;i++){
    const r=rows[i%10];h.send('pointerdown',r);h.advance(20);
    h.context.renderPlayers();assert.equal(h.stats().renders,0);
    h.send('pointerup',r);h.send('touchend',r);h.context.renderPlayers();
    assert.equal(h.stats().renders,0);h.send('click',r);h.advance(30);
  }
  h.advance(1100);assert.deepEqual(h.stats(),{opens:0,renders:1,clicks:100});
});
test('release outside a detached row cancels its hold timer',()=>{
  const h=setup(),r=h.row(1);h.send('pointerdown',r);r.isConnected=false;
  h.send('pointerup',r);h.advance(1000);assert.equal(h.stats().opens,0);
});
test('detached rows never open actions even if release is missing',()=>{
  const h=setup(),r=h.row(1);h.send('pointerdown',r);r.isConnected=false;
  h.advance(1000);assert.equal(h.stats().opens,0);
});
test('new contact invalidates an orphaned hold and starts a fresh interval',()=>{
  const h=setup(),a=h.row(1),b=h.row(2);
  h.send('pointerdown',a);h.advance(800);h.send('pointerdown',b,{pointerId:2});h.advance(150);
  assert.equal(h.stats().opens,0);h.send('pointerup',b,{pointerId:2});h.send('click',b);h.advance(1000);
  assert.deepEqual(h.stats(),{opens:0,renders:0,clicks:1});
});
test('duplicate pointerdown cannot reuse the previous timer',()=>{
  const h=setup(),r=h.row(1);h.send('pointerdown',r);h.advance(800);h.send('pointerdown',r);h.advance(200);
  assert.equal(h.stats().opens,0);h.send('pointerup',r);h.send('click',r);h.advance(1000);
  assert.equal(h.stats().opens,0);
});
test('intentional hold opens once, consumes release click, allows next rapid tap',()=>{
  const h=setup(),r=h.row(1);h.send('pointerdown',r);h.advance(899);assert.equal(h.stats().opens,0);
  h.advance(1);assert.equal(h.stats().opens,1);h.advance(1000);assert.equal(h.stats().opens,1);
  h.send('pointerup',r);h.send('click',r);assert.equal(h.stats().clicks,0);
  h.send('pointerdown',r);h.advance(20);h.send('pointerup',r);h.send('click',r);
  assert.equal(h.stats().clicks,1);
});
for(const type of ['pointercancel','touchcancel','touchend','scroll','blur','pagehide']){
  test(type+' cancels the hold',()=>{
    const h=setup(),r=h.row(1);h.send('pointerdown',r);h.advance(300);h.send(type,r);h.advance(1000);
    assert.equal(h.stats().opens,0);
  });
}
test('drag and multi-touch do not open actions',()=>{
  const h=setup(),r=h.row(1);h.send('pointerdown',r);h.send('pointermove',r,{clientY:40});h.advance(1000);
  h.send('pointerdown',r);h.send('pointerdown',r,{isPrimary:false,pointerId:2});h.advance(1000);
  assert.equal(h.stats().opens,0);
});
test('hidden page cancels the hold',()=>{
  const h=setup(),r=h.row(1);h.send('pointerdown',r);h.doc.hidden=true;h.doc.emit('visibilitychange',{});h.advance(1000);
  assert.equal(h.stats().opens,0);
});
test('right click does not open the hold menu or change attendance',()=>{
  const h=setup(),r=h.row(1);h.send('pointerdown',r,{button:2,pointerType:'mouse'});
  const e=h.send('contextmenu',r);h.advance(1000);assert.ok(e.prevented);assert.equal(h.stats().opens,0);
});
console.log(`${checks.length} gesture regressions passed.`);
