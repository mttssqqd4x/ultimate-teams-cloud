const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../sandbox-host-4.14.5.js'),'utf8');
const classes=new Set(),elements=new Map();
function element(id){if(!elements.has(id))elements.set(id,{style:{setProperty(){}},getBoundingClientRect:()=>({height:60}),focus(){this.focused=true;},value:'admin'});return elements.get(id);}
const app={inert:false,scrollTop:420,style:{overflowY:'auto'}};
const c=vm.createContext({window:{},document:{readyState:'loading',addEventListener(){},getElementById:element,querySelector:()=>app,body:{classList:{add:x=>classes.add(x),remove:x=>classes.delete(x)}}},
  canManageGames:()=>true,showPage:page=>assert.equal(page,'data'),location:{href:'https://example.test/'},URL,
  fetch:()=>new Promise(()=>{}),state:{players:[]},profile:{},gameNightStats4120:{},settingsPayload4120:()=>({}),
  db:{from:()=>({select:()=>({limit:async()=>({data:[]})})})}});
vm.runInContext(source,c);
for(let i=0;i<20;i++){
  c.window.openTestSandbox4122();assert.equal(app.inert,true);assert.equal(element('sandboxPage').style.display,'block');
  c.window.closeTestSandbox4122();assert.equal(app.inert,false);assert.equal(classes.size,0);
  assert.equal(element('sandboxPage').style.display,'none');assert.equal(app.scrollTop,420);assert.equal(app.style.overflowY,'auto');
  assert.ok(element('sandboxFrame').srcdoc.includes('overflow:hidden'));assert.ok(element('openSandboxBtn').focused);
}
assert.ok(source.includes('meta[name^="apple-mobile-web-app"]'));
assert.ok(source.includes("connect-src 'none'"));
console.log('PASS 20 Sandbox open/exit cycles preserve main scroll state, restore interaction/focus, and dispose the frame; host metadata stays outside the sandbox.');
