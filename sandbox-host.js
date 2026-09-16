/* Load the real app shell into an opaque-origin frame, with in-memory data. */
(() => {
  if(window.__UT_SANDBOX_SEED && window.parent!==window) return;
  const clone = value => JSON.parse(JSON.stringify(value));
  let opening = 0, ready = false, seed = null, sizeObserver = null;
  const el = id => document.getElementById(id);

  function sendView(){
    if(!ready) return;
    el('sandboxFrame').contentWindow.postMessage({type:'ut-sandbox-view',role:el('sandboxRole').value,playerId:el('sandboxIdentity').value}, '*');
  }
  function measure(){
    el('sandboxPage').style.setProperty('--sandbox-controls-height',`${el('sandboxControls').getBoundingClientRect().height}px`);
  }
  function closeSandbox(event){
    event?.preventDefault();
    opening++; ready=false;
    el('sandboxFrame').srcdoc='<!doctype html><html style="height:100%;overflow:hidden;background:#000"><body></body></html>';
    el('sandboxPage').style.display='none';
    document.body.classList.remove('sandbox-open');
    document.querySelector('.app').inert=false;
    showPage('data');
    el('openSandboxBtn').focus({preventScroll:true});
  }
  async function capture(){
    const snapshot=clone({state,profile,stats:gameNightStats4120,settings:settingsPayload4120()});
    snapshot.tables={};
    // Read-only history snapshot. All subsequent operations use the frame's copy.
    await Promise.all(['games','game_player_results','teammate_pair_events','rating_history'].map(async name=>{
      try{
        const {data,error}=await db.from(name).select('*').limit(5000);
        snapshot.tables[name]=error?[]:(data||[]);
      }catch(e){snapshot.tables[name]=[];}
    }));
    return snapshot;
  }
  function buildDocument(source, snapshot){
    const doc=new DOMParser().parseFromString(source,'text/html');
    const base=new URL('./',location.href);
    // The parent owns installed-app/status-bar metadata, not the test frame.
    doc.querySelectorAll('meta[name^="apple-mobile-web-app"],meta[name="theme-color"],link[rel="manifest"]').forEach(node=>node.remove());
    doc.querySelectorAll('script[src],link[href]').forEach(node=>{
      const attr=node.tagName==='SCRIPT'?'src':'href';
      const url=new URL(node.getAttribute(attr),base);
      if(url.origin!==location.origin || url.pathname.endsWith('/config.js') || url.pathname.endsWith('/sandbox-host.js')){node.remove();return;}
      node.setAttribute(attr,url.href);
      node.removeAttribute('crossorigin');
    });
    // Defense in depth: the opaque frame cannot reach live storage or its parent;
    // CSP rejects all connections, workers, nested frames and form submissions.
    const policy=doc.createElement('meta');
    policy.httpEquiv='Content-Security-Policy';
    policy.content=`default-src 'none'; script-src 'unsafe-inline' ${location.origin}; style-src 'unsafe-inline' ${location.origin}; img-src data: ${location.origin}; font-src ${location.origin}; connect-src 'none'; worker-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'`;
    const guard=doc.createElement('script');
    guard.textContent=`window.__UT_SANDBOX_SEED=${JSON.stringify(snapshot).replace(/</g,'\\u003c')};
      window.ULTIMATE_TEAMS_CONFIG={SUPABASE_URL:'https://sandbox.invalid',SUPABASE_PUBLISHABLE_KEY:'sandbox'};
      class SandboxMemoryStorage {
        constructor(){this.values=new Map()}
        get length(){return this.values.size}
        key(i){return Array.from(this.values.keys())[i]??null}
        getItem(k){return this.values.get(String(k))??null}
        setItem(k,v){this.values.set(String(k),String(v))}
        removeItem(k){this.values.delete(String(k))}
        clear(){this.values.clear()}
      }
      Object.defineProperty(window,'localStorage',{value:new SandboxMemoryStorage()});
      Object.defineProperty(window,'sessionStorage',{value:new SandboxMemoryStorage()});
      window.BroadcastChannel=class {postMessage(){} close(){}};
      Object.defineProperty(navigator,'serviceWorker',{value:{register:async()=>null,ready:Promise.resolve(null),getRegistrations:async()=>[],addEventListener(){}}});
      window.fetch=async()=>{throw new Error('Sandbox network access is disabled')};
      window.WebSocket=class {constructor(){throw new Error('Sandbox network access is disabled')}};
      window.EventSource=window.WebSocket;
      navigator.sendBeacon=()=>false;
    `;
    doc.head.prepend(guard);
    doc.head.prepend(policy);
    const runtime=doc.createElement('script');
    runtime.src=new URL('sandbox-runtime.js?v=4.14.7',base).href;
    doc.body.appendChild(runtime);
    return '<!doctype html>\n'+doc.documentElement.outerHTML;
  }
  async function openSandbox(event){
    event?.preventDefault();event?.stopPropagation();
    if(!canManageGames()){alert('Captain/admin only.');return false;}
    const ticket=++opening;
    ready=false;
    el('sandboxPage').style.display='block';
    document.body.classList.add('sandbox-open');
    document.querySelector('.app').inert=true;
    el('sandboxLoadStatus').textContent='Loading sandbox…';
    el('sandboxFrame').style.visibility='hidden';
    measure();
    try{
      const [source,snapshot]=await Promise.all([
        fetch(new URL('index.html?v=4.14.7',location.href)).then(r=>{if(!r.ok)throw new Error('Could not load the app page');return r.text()}),
        capture()
      ]);
      if(ticket!==opening)return false;
      seed=snapshot;
      const previous=el('sandboxIdentity').value;
      el('sandboxIdentity').replaceChildren(...snapshot.state.players.map(p=>new Option(p.fullName,p.id)));
      el('sandboxIdentity').value=snapshot.state.players.some(p=>String(p.id)===previous)?previous:(snapshot.profile.player_id||snapshot.state.players[0]?.id||'');
      snapshot.role=el('sandboxRole').value;
      snapshot.playerId=el('sandboxIdentity').value;
      el('sandboxFrame').srcdoc=buildDocument(source,snapshot);
    }catch(e){
      if(ticket===opening)el('sandboxLoadStatus').textContent=`Could not open sandbox: ${e.message}`;
    }
    return false;
  }
  function install(){
    el('openSandboxBtn').onclick=openSandbox;
    el('sandboxExit').onclick=closeSandbox;
    el('sandboxReset').onclick=openSandbox;
    el('sandboxRole').onchange=sendView;
    el('sandboxIdentity').onchange=sendView;
    sizeObserver=new ResizeObserver(measure);sizeObserver.observe(el('sandboxControls'));
    window.addEventListener('message',event=>{
      if(event.source!==el('sandboxFrame').contentWindow)return;
      if(event.data?.type==='ut-sandbox-ready'){
        ready=true;el('sandboxFrame').style.visibility='visible';el('sandboxLoadStatus').textContent='';sendView();
      }
      if(event.data?.type==='ut-sandbox-error')el('sandboxLoadStatus').textContent=`Sandbox error: ${event.data.message}`;
      if(event.data?.type==='ut-sandbox-players'){
        const selected=el('sandboxIdentity').value;
        el('sandboxIdentity').replaceChildren(...event.data.players.map(p=>new Option(p.fullName,p.id)));
        el('sandboxIdentity').value=selected;
      }
    });
  }
  Object.assign(window,{openTestSandbox4122:openSandbox,openTestSandbox4120:openSandbox,closeTestSandbox4122:closeSandbox});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
})();
