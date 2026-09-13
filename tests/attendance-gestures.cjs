const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../app-4.14.5.js'),'utf8');
const gestures=source.slice(source.indexOf('// Attendance uses one release'),source.indexOf('\nconst renderAttendancePlayerRowBefore4132'));
const rendering=source.slice(source.indexOf('/* Keep cloud/realtime renders'),source.indexOf('\nfunction scrollAppTo4144'));
function setup(manager=true){
  let now=0,next=1,opens=0,renders=0,hit=null;const timers=new Map(),taps=[];
  class Target{
    constructor(id){this.dataset={attendancePlayerId:String(id)};this.isConnected=true;this.handlers={};
      const classes=new Set(['player','clickable']);this.classList={add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x)};}
    addEventListener(type,fn,options){(this.handlers[type] ||= []).push({fn,capture:options===true || !!options?.capture});}
    setAttribute(){}
    closest(selector){return selector.includes('#playerList')?this:null;}
    emit(type,event,capture){for(const h of this.handlers[type]||[]){if(capture!==undefined&&h.capture!==capture)continue;h.fn(event);if(event.stopped)break;}}
  }
  const win=new Target(),doc=new Target();doc.hidden=false;doc.elementFromPoint=()=>hit;
  const c=vm.createContext({window:win,document:doc,navigator:{},Date:{now:()=>now},
    PLAYER_HOLD_MS_4132:900,PLAYER_HOLD_MOVE_PX_4132:7,
    setTimeout(fn,ms){const id=next++;timers.set(id,{at:now+ms,fn});return id;},clearTimeout:id=>timers.delete(id),
    canManageGames:()=>manager,openPlayerActions4132:()=>opens++,renderPlayers:()=>renders++,toggleAttendance:id=>taps.push(id)});
  vm.runInContext(gestures+'\n'+rendering,c);
  function row(id){const r=new Target(id);c.bindPlayerHoldActions4132(r,{id});r.onclick=()=>taps.push(String(id));return r;}
  function send(type,r,extra={}){
    hit=Object.hasOwn(extra,'hit')?extra.hit:r;
    const e={target:r,button:0,isPrimary:true,pointerType:'touch',pointerId:1,detail:1,clientX:10,clientY:10,
      touches:[],changedTouches:[{clientX:10,clientY:10}],preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;},...extra};
    win.emit(type,e,true);
    if(!e.stopped&&r.isConnected){r.emit(type,e,true);if(!e.stopped)r.emit(type,e,false);}
    if(!e.stopped&&r.isConnected&&type==='click')r.onclick?.();
    if(!e.stopped)win.emit(type,e,false);return e;
  }
  function advance(ms){const end=now+ms;while(true){const item=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!item)break;now=item[1].at;timers.delete(item[0]);item[1].fn();}now=end;}
  return {c,win,doc,row,send,advance,taps,stats:()=>({opens,renders})};
}
let count=0;function test(name,fn){fn();count++;console.log('PASS '+name);}
test('100 releases register without any browser click, through rapid refreshes',()=>{
  const h=setup(),rows=Array.from({length:10},(_,i)=>h.row(i));
  for(let i=0;i<100;i++){
    const r=rows[i%10];h.send('pointerdown',r);h.advance(20);h.c.renderPlayers();assert.equal(h.stats().renders,0);
    h.send('pointerup',r);h.c.renderPlayers();assert.equal(h.taps.length,i+1);h.advance(30);
  }
  h.advance(1000);assert.deepEqual(h.stats(),{opens:0,renders:1});
});
test('delayed compatibility clicks cannot undo a newer selection',()=>{
  const h=setup(),a=h.row(1),b=h.row(2);
  h.send('pointerdown',a);h.send('pointerup',a);h.send('pointerdown',b);h.send('pointerup',b);
  h.send('click',a);h.send('click',b);assert.deepEqual(h.taps,['1','2']);
});
test('same player can toggle 101 times without click suppression windows',()=>{
  const h=setup(),r=h.row(1);for(let i=0;i<101;i++){h.send('pointerdown',r);h.advance(10);h.send('pointerup',r);h.send('click',r);}
  assert.equal(h.taps.length,101);
});
test('touchend fallback registers once when pointerup is missing or arrives late',()=>{
  const h=setup(),r=h.row(1);h.send('pointerdown',r);h.send('touchend',r);h.send('pointerup',r);h.send('click',r);
  assert.deepEqual(h.taps,['1']);
});
test('small finger jitter cancels hold but preserves the tap',()=>{
  const h=setup(),r=h.row(1);h.send('pointerdown',r);h.send('pointermove',r,{clientY:20});h.advance(1000);
  h.send('pointerup',r,{clientY:20});assert.deepEqual(h.taps,['1']);assert.equal(h.stats().opens,0);
});
test('scrolling and releasing over a different player never select',()=>{
  const h=setup(),a=h.row(1),b=h.row(2);h.send('pointerdown',a);h.send('pointermove',a,{clientY:30});h.send('pointerup',a);h.send('click',a);
  h.send('pointerdown',a);h.send('pointerup',b);h.send('click',b);assert.equal(h.taps.length,0);
});
test('replaced DOM row can receive its original tap by player ID',()=>{
  const h=setup(),r=h.row(1),replacement=h.row(1);h.send('pointerdown',r);r.isConnected=false;
  h.send('pointerup',r,{hit:replacement});assert.deepEqual(h.taps,['1']);h.advance(1000);assert.equal(h.stats().opens,0);
});
test('detached row with missing release cannot open actions',()=>{
  const h=setup(),r=h.row(1);h.send('pointerdown',r);r.isConnected=false;h.advance(1000);assert.equal(h.stats().opens,0);
});
test('new contact always invalidates the old hold interval',()=>{
  const h=setup(),a=h.row(1),b=h.row(2);h.send('pointerdown',a);h.advance(800);h.send('pointerdown',b,{pointerId:2});h.advance(150);
  assert.equal(h.stats().opens,0);h.send('pointerup',b,{pointerId:2});h.advance(1000);assert.deepEqual(h.taps,['2']);
});
test('intentional hold opens once without toggling; next quick tap works',()=>{
  const h=setup(),r=h.row(1);h.send('pointerdown',r);h.advance(899);assert.equal(h.stats().opens,0);
  h.advance(1001);assert.equal(h.stats().opens,1);h.send('pointerup',r);h.send('click',r);assert.equal(h.taps.length,0);
  h.send('pointerdown',r);h.send('pointerup',r);h.send('click',r);assert.deepEqual(h.taps,['1']);
});
for(const type of ['pointercancel','touchcancel','scroll','blur','pagehide'])test(type+' cancels selection and hold',()=>{
  const h=setup(),r=h.row(1);h.send('pointerdown',r);h.send(type,r);h.advance(1000);h.send('pointerup',r);h.send('click',r);
  assert.equal(h.stats().opens,0);assert.equal(h.taps.length,0);
});
test('keyboard activation and teammate attendance remain usable',()=>{
  const h=setup(false),r=h.row(1);h.send('click',r,{pointerType:'',detail:0});h.send('pointerdown',r);h.send('pointerup',r);h.send('click',r);
  assert.deepEqual(h.taps,['1','1']);assert.equal(h.stats().opens,0);
});
test('mouse and pen releases each count once',()=>{
  const h=setup(),r=h.row(1);for(const pointerType of ['mouse','pen']){h.send('pointerdown',r,{pointerType});h.send('pointerup',r,{pointerType});h.send('click',r,{pointerType});}
  assert.equal(h.taps.length,2);
});
test('read-only rows and multi-touch do not select',()=>{
  const h=setup(),r=h.row(1);r.classList.remove('clickable');h.send('pointerdown',r);h.send('pointerup',r);assert.equal(h.taps.length,0);
  r.classList.add('clickable');h.send('pointerdown',r);h.send('pointerdown',r,{isPrimary:false,pointerId:2});h.send('pointerup',r);h.advance(1000);assert.equal(h.taps.length,0);assert.equal(h.stats().opens,0);
});
console.log(`${count} gesture regressions passed.`);
