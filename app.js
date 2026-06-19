

function injectDataPageToolButtons(){
  const target = document.getElementById("dataLoadEdit");
  if(!target) return;

  target.querySelectorAll(".injected-data-tools").forEach(el => el.remove());

  const labels = Array.from(target.querySelectorAll("label"));
  const backupLabel = labels.find(l => (l.textContent || "").trim().toLowerCase().includes("backup"));
  if(!backupLabel) return;

  const block = document.createElement("div");
  block.className = "toolbar captain-admin-only injected-data-tools";
  block.style.marginBottom = "10px";
  block.innerHTML = `
    <button class="btn-secondary" type="button" onclick="openEditPlayerModal()">Edit Player</button>
    <button class="btn-secondary" type="button" onclick="openRatingsModal()">View Player Ratings</button>
  `;
  backupLabel.parentNode.insertBefore(block, backupLabel);
}


document.addEventListener("DOMContentLoaded", () => hideSignInBox());
const CONFIG=window.ULTIMATE_TEAMS_CONFIG||{};const SUPABASE_URL=(CONFIG.SUPABASE_URL||'').replace(/\/rest\/v1\/?$/,'').replace(/\/$/,'');const SUPABASE_KEY=CONFIG.SUPABASE_PUBLISHABLE_KEY||CONFIG.SUPABASE_ANON_KEY||'';let db=null,currentUser=null,profile={role:'guest',email:'Guest'},showInactive=false;const state={players:[],pairRules:[],history:{},settings:{weightHandling:.35,weightCutting:.35,weightDefense:.30,kFactor:.08,repeatWeight:4,prioritizeHandlerSeparation:false,handlerSeparationBoost:2,prioritizeEliteBalance:false,eliteBalanceBoost:2},currentGame:null,selectedWinnerIndex:null,resultsSavedForCurrentGame:false};
function toggleSignInBox(event){
  if(event && event.preventDefault) event.preventDefault();
  const box = document.getElementById("authPage");
  if(!box) return false;
  const isHidden = box.classList.contains("hidden") || box.style.display === "none";
  if(isHidden){
    box.classList.remove("hidden");
    box.style.display = "block";
    const email = document.getElementById("authEmail");
    if(email) setTimeout(() => email.focus(), 50);
  } else {
    box.classList.add("hidden");
    box.style.display = "none";
  }
  return false;
}
function hideSignInBox(){
  const box = document.getElementById("authPage");
  if(box){
    box.classList.add("hidden");
    box.style.display = "none";
  }
}

function updateAuthButtons(){
  const signedIn = !!currentUser;
  const showSignInBtn = document.getElementById("showSignInBtn");
  const signOutBtn = document.getElementById("signOutBtn");

  if(showSignInBtn){
    showSignInBtn.classList.toggle("hidden", signedIn);
    showSignInBtn.style.display = signedIn ? "none" : "";
  }

  if(signOutBtn){
    signOutBtn.classList.toggle("hidden", !signedIn);
    signOutBtn.style.display = signedIn ? "" : "none";
  }

  if(signedIn){
    hideSignInBox();
  }
}


document.addEventListener('DOMContentLoaded',init);
async function init(){if(!SUPABASE_URL||!SUPABASE_KEY||SUPABASE_KEY.includes('PASTE_')){setAuthMessage('Config missing. Open config.js and paste your Supabase publishable/anon key.');return}db=supabase.createClient(SUPABASE_URL,SUPABASE_KEY);const{data}=await db.auth.getSession();currentUser=data?.session?.user||null;db.auth.onAuthStateChange(async(_e,s)=>{currentUser=s?.user||null;await afterAuthChange()});await afterAuthChange()}
function setAuthMessage(m){document.getElementById('authMessage').textContent=m}function isAdmin(){return profile?.role==='admin'}function canManageGames(){return profile?.role==='admin'||profile?.role==='captain'}function isGuestOrUser(){return !canManageGames()}
async function signUp(){const email=document.getElementById('authEmail').value.trim(),password=document.getElementById('authPassword').value;if(!email||!password){setAuthMessage('Enter email and password.');return}const{error}=await db.auth.signUp({email,password});if(error){setAuthMessage(error.message);return}setAuthMessage('Account created. Check email if confirmation is enabled, then sign in.')}
async function signIn(){const email=document.getElementById('authEmail').value.trim(),password=document.getElementById('authPassword').value;if(!email||!password){setAuthMessage('Enter email and password.');return}const{error}=await db.auth.signInWithPassword({email,password});if(error){setAuthMessage(error.message);return}}
async function signOut(){await db.auth.signOut()}async function afterAuthChange(){if(currentUser)await loadProfile();else profile={role:'guest',email:'Guest'};document.getElementById('authPage').classList.toggle('hidden',!!currentUser);document.getElementById('signOutBtn').classList.toggle('hidden',!currentUser);document.getElementById('dataTabBtn').classList.toggle('hidden',!isAdmin());updateAuthButtons();
  updateNavVisibility();
  updateRoleVisibility();
  await loadCloudData();renderAll();showPage('main')}
async function loadProfile(){let{data}=await db.from('profiles').select('*').eq('id',currentUser.id).maybeSingle();if(!data){await db.from('profiles').insert({id:currentUser.id,email:currentUser.email,role:'user'});const res=await db.from('profiles').select('*').eq('id',currentUser.id).single();data=res.data}profile=data||{role:'user',email:currentUser.email}}
function showPage(page){
  if(page === "data" && !canAccessDataPage()) page = "main";
  updateNavVisibility();
  setTimeout(() => { injectDataPageToolButtons(); updateRoleVisibility(); }, 0);if(page==='data'&&!isAdmin())page='main';document.getElementById('mainPage').classList.toggle('hidden',page!=='main');document.getElementById('dataPage').classList.toggle('hidden',page!=='data'||!isAdmin());document.getElementById('stickybar').classList.toggle('hidden',page!=='main');document.getElementById('mainTabBtn').classList.toggle('tab-active',page==='main');document.getElementById('dataTabBtn').classList.toggle('tab-active',page==='data')}
function dbPlayerToLocal(r,att){return{id:r.id,firstName:r.first_name||'',lastName:r.last_name||'',fullName:r.full_name||`${r.first_name||''} ${r.last_name||''}`.trim(),handling:Number(r.handling||0),cutting:Number(r.cutting||0),defense:Number(r.defense||0),winLossRating:Number(r.win_loss||0),active:!!r.active,injuryPct:Number(r.injury_pct||1),temporary:!!r.temporary,gamesPlayed:Number(r.games_played||0),wins:Number(r.wins||0),losses:Number(r.losses||0),attending:!!att[r.id]}}
async function loadCloudData(){const[pr,ar,rr,hr,sr,gr]=await Promise.all([db.from('players').select('*').order('first_name'),db.from('attendance').select('*'),db.from('pair_rules').select('*').order('created_at'),db.from('teammate_history').select('*'),db.from('settings').select('*').eq('id','main').maybeSingle(),db.from('current_game').select('*').eq('id','main').maybeSingle()]);if(pr.error){alert('Players load error: '+pr.error.message);return}const att={};(ar.data||[]).forEach(a=>att[a.player_id]=a.present);state.players=(pr.data||[]).map(r=>dbPlayerToLocal(r,att));state.pairRules=(rr.data||[]).map(r=>({id:r.id,player1Id:r.player1_id,player2Id:r.player2_id,type:r.rule_type,strength:Number(r.strength||1)}));state.history={};(hr.data||[]).forEach(h=>state.history[pairKey(h.player_a,h.player_b)]=Number(h.count||0));if(sr.data)state.settings={weightHandling:Number(sr.data.weight_handling),weightCutting:Number(sr.data.weight_cutting),weightDefense:Number(sr.data.weight_defense),kFactor:Number(sr.data.k_factor),repeatWeight:Number(sr.data.repeat_weight),prioritizeHandlerSeparation:!!sr.data.prioritize_handler_separation,handlerSeparationBoost:Number(sr.data.handler_separation_boost),prioritizeEliteBalance:!!sr.data.prioritize_elite_balance,eliteBalanceBoost:Number(sr.data.elite_balance_boost)};if(gr.data){state.currentGame=hydrateGame(gr.data.teams);state.selectedWinnerIndex=gr.data.selected_winner_index;state.resultsSavedForCurrentGame=!!gr.data.results_saved}syncSettingsForm()}
function hydrateGame(j){if(!j)return null;return{teams:j.map(t=>t.map(x=>state.players.find(p=>p.id===(x.id||x))||x))}}



function updateRoleVisibility(){
  const showCaptainAdmin = isCaptainOrAdmin();
  const showAdmin = !!(profile && profile.role === "admin");

  if(!showCaptainAdmin){
    state.showInactive = true;
  }

  updateNavVisibility();

  document.querySelectorAll(".captain-admin-only").forEach(el => {
    el.classList.toggle("hidden", !showCaptainAdmin);
    el.style.display = showCaptainAdmin ? "" : "none";
  });

  document.querySelectorAll("[data-captain-admin-only='true']").forEach(el => {
    const container = el.closest("#numTeamsSection") || el.closest(".grid") || el;
    container.classList.toggle("hidden", !showCaptainAdmin);
    container.style.display = showCaptainAdmin ? "" : "none";
  });

  document.querySelectorAll(".admin-only").forEach(el => {
    el.classList.toggle("hidden", !showAdmin);
    el.style.display = showAdmin ? "" : "none";
  });

  document.querySelectorAll(".admin-only-inline").forEach(el => {
    el.classList.toggle("hidden", !showAdmin);
    el.style.display = showAdmin ? "" : "none";
  });

  document.querySelectorAll(".admin-rating-fields").forEach(el => {
    el.classList.toggle("hidden", !showAdmin);
    el.style.display = showAdmin ? "" : "none";
  });

  ["numTeamsSection","attendanceTempPlayer","tempPlayerCard","attendancePairRules","pairRulesCard","section-pair-rules"].forEach(id => {
    const el = document.getElementById(id);
    if(!el) return;
    el.classList.toggle("hidden", !showCaptainAdmin);
    el.style.display = showCaptainAdmin ? "" : "none";
  });

  const numTeams = document.getElementById("numTeams");
  if(numTeams){
    const container = document.getElementById("numTeamsSection") || numTeams.closest(".grid") || numTeams.parentElement;
    if(container){
      container.classList.toggle("hidden", !showCaptainAdmin);
      container.style.display = showCaptainAdmin ? "" : "none";
    }
    numTeams.disabled = !showCaptainAdmin;
  }

  const toggleInactiveBtn = document.getElementById("toggleInactiveBtn");
  if(toggleInactiveBtn){
    toggleInactiveBtn.classList.toggle("hidden", !showCaptainAdmin);
    toggleInactiveBtn.style.display = showCaptainAdmin ? "" : "none";
  }

  const clearBtn = document.querySelector('button[onclick="clearAttendance()"]');
  if(clearBtn){
    clearBtn.classList.toggle("hidden", !showCaptainAdmin);
    clearBtn.style.display = showCaptainAdmin ? "" : "none";
  }

  const sticky = document.getElementById("stickybar");
  if(sticky){
    const mainVisible = !document.getElementById("mainPage")?.classList.contains("hidden");
    sticky.classList.toggle("hidden", !showCaptainAdmin || !mainVisible);
    sticky.style.display = (!showCaptainAdmin || !mainVisible) ? "none" : "";
  }
}



function renderPairRules(){const box=document.getElementById('pairRuleList');if(!box)return;const visibleRules = visiblePairRulesForCurrentUser ? visiblePairRulesForCurrentUser() : state.pairRules;
  if(!visibleRules.length){box.innerHTML='<div class="small">No pair rules yet.</div>';return}box.innerHTML='';state.pairRules.forEach(r=>{const p1=state.players.find(p=>p.id===r.player1Id),p2=state.players.find(p=>p.id===r.player2Id),div=document.createElement('div');const locked=Number(r.strength||0)>=999;const typeLabel=r.type==='together'?'Together':'Apart';div.className='player '+(r.type==='together'?'pair-card-together':'pair-card-apart');div.innerHTML=`<div><div class="player-name">${p1?.fullName||'Unknown'} ↔ ${p2?.fullName||'Unknown'}</div><div class="small">${locked?'Locked '+typeLabel:typeLabel+' · Strength '+Number(r.strength).toFixed(1)}</div></div><div class="toggle-wrap"><button class="btn-danger" onclick="removePairRule('${r.id}')">Remove</button></div>`;box.appendChild(div)})}
async function addPairRule(){if(!isAdmin()){alert('Admin only.');return}const p1=pairP1.value,p2=pairP2.value,type=pairType.value,strength=Number(pairStrength.value||1);if(!p1||!p2||p1===p2){alert('Choose two different players.');return}const{error}=await db.from('pair_rules').insert({player1_id:p1,player2_id:p2,rule_type:type,strength});if(error)alert(error.message);await loadCloudData();renderAll()}async function lockPair(){if(!isAdmin()){alert('Admin only.');return}const p1=pairP1.value,p2=pairP2.value,type=pairType.value||'together';if(!p1||!p2||p1===p2){alert('Choose two different players.');return}const{error}=await db.from('pair_rules').insert({player1_id:p1,player2_id:p2,rule_type:type,strength:999});if(error)alert(error.message);await loadCloudData();renderAll()}async function removePairRule(id){if(!isAdmin())return;const{error}=await db.from('pair_rules').delete().eq('id',id);if(error)alert(error.message);await loadCloudData();renderAll()}async function clearPairRules(){if(!isAdmin())return;if(!confirm('Clear all pair rules?'))return;const{error}=await db.from('pair_rules').delete().not('id','is',null);if(error)alert(error.message);await loadCloudData();renderAll()}
function loadTempRatingsFromLike(){const src=state.players.find(p=>p.id===tempLike.value);if(!src)return;tempHandling.value=src.handling;tempCutting.value=src.cutting;tempDefense.value=src.defense}async function addTempPlayer(){
  if(!canManageGames()){ alert("Captain/admin only."); return; }
  if(!canManageGames()){alert('Captain/admin only.');return}const full=normalizeName(tempName.value);if(!full){alert('Enter a player name.');return}const parts=splitName(full);const payload={first_name:parts.first,last_name:parts.last,handling:Number(tempHandling.value||3),cutting:Number(tempCutting.value||3),defense:Number(tempDefense.value||3),win_loss:0,active:true,injury_pct:1,temporary:true};const{data,error}=await db.from('players').insert(payload).select().single();if(error){alert(error.message);return}await db.from('attendance').upsert({player_id:data.id,present:true,updated_by:currentUser?.id||null});tempName.value='';await loadCloudData();renderAll()}async function setInjuryPrompt(id){if(!canManageGames())return;const p=state.players.find(x=>x.id===id),pct=prompt('Enter available percent, e.g. 80 for 80%',Math.round((p.injuryPct||1)*100));if(pct===null)return;const val=Math.max(0,Math.min(100,Number(pct)))/100;const{error}=await db.from('players').update({injury_pct:val,updated_at:new Date().toISOString()}).eq('id',id);if(error)alert(error.message);await loadCloudData();renderAll()}
function effectiveHandling(p){const inj=Number(p.injuryPct)||1;return(Number(p.handling)||0)*(.5+.5*inj)}function effectiveCutting(p){return(Number(p.cutting)||0)*(Number(p.injuryPct)||1)}function effectiveDefense(p){return(Number(p.defense)||0)*(Number(p.injuryPct)||1)}function baseOverall(p){const s=state.settings;return effectiveHandling(p)*s.weightHandling+effectiveCutting(p)*s.weightCutting+effectiveDefense(p)*s.weightDefense}function overall(p){return baseOverall(p)+Number(p.winLossRating||0)}function expectedWinProb(a,b){return 1/(1+Math.pow(10,(b-a)/4))}function pairKey(a,b){return a<b?`${a}|${b}`:`${b}|${a}`}
function hasLastName(player){
  return !!String(player?.lastName || player?.last_name || "").trim();
}
function getFirstNameForSort(player){
  const direct = String(player?.firstName || player?.first_name || "").trim();
  if(direct) return direct;
  const full = String(player?.fullName || player?.full_name || "").trim();
  return full.split(/\s+/)[0] || "";
}
function getLastNameForSort(player){
  const direct = String(player?.lastName || player?.last_name || "").trim();
  if(direct) return direct;
  const full = String(player?.fullName || player?.full_name || "").trim();
  const parts = full.split(/\s+/).filter(Boolean);
  return parts.length > 1 ? parts.slice(1).join(" ") : "";
}
function comparePlayersByLastName(a, b){
  const aHasLast = hasLastName(a);
  const bHasLast = hasLastName(b);

  // Players with a last name sort before players without a last name.
  if(aHasLast && !bHasLast) return -1;
  if(!aHasLast && bHasLast) return 1;

  const aLast = getLastNameForSort(a).toLowerCase();
  const bLast = getLastNameForSort(b).toLowerCase();
  const lastCompare = aLast.localeCompare(bLast);
  if(lastCompare !== 0) return lastCompare;

  const aFirst = getFirstNameForSort(a).toLowerCase();
  const bFirst = getFirstNameForSort(b).toLowerCase();
  const firstCompare = aFirst.localeCompare(bFirst);
  if(firstCompare !== 0) return firstCompare;

  return String(a.fullName || a.full_name || "").localeCompare(String(b.fullName || b.full_name || ""));
}

function normalizeName(n){return n.trim().replace(/s+/g,' ')}function splitName(f){const p=normalizeName(f).split(' ');return{first:p[0]||'',last:p.slice(1).join(' ')}}function shuffle(arr){const a=[...arr];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}function activeAttendingPlayers(){return state.players.filter(p=>p.active&&p.attending)}function teamStats(t){return{overall:t.reduce((s,p)=>s+overall(p),0),handling:t.reduce((s,p)=>s+effectiveHandling(p),0),cutting:t.reduce((s,p)=>s+effectiveCutting(p),0),defense:t.reduce((s,p)=>s+effectiveDefense(p),0),count:t.length}}function teamStrength(t){return t.reduce((s,p)=>s+overall(p),0)}function spread(v){if(!v.length)return 0;const avg=v.reduce((a,b)=>a+b,0)/v.length;return v.reduce((s,x)=>s+Math.pow(x-avg,2),0)}function makeInitialTeams(players,n){const arr=shuffle(players).sort((a,b)=>overall(b)-overall(a)),teams=Array.from({length:n},()=>[]);let idx=0,forward=true;while(idx<arr.length){const order=forward?[...teams.keys()]:[...teams.keys()].reverse();order.forEach(ti=>{if(idx<arr.length)teams[ti].push(arr[idx++])});forward=!forward}return teams}function scoreTeams(teams,repeatWeight=state.settings.repeatWeight){const s=state.settings,stats=teams.map(teamStats);let score=0;const handlerPenalty=s.prioritizeHandlerSeparation?5*Number(s.handlerSeparationBoost||2):5;score+=spread(stats.map(x=>x.count))*120;score+=spread(stats.map(x=>x.overall))*14;score+=spread(stats.map(x=>x.handling))*handlerPenalty;score+=spread(stats.map(x=>x.cutting))*5;score+=spread(stats.map(x=>x.defense))*5;if(s.prioritizeEliteBalance){const eliteBoost=Number(s.eliteBalanceBoost||2),topOveralls=teams.map(team=>Math.max(...team.map(p=>overall(p)))),defenseTotals=stats.map(x=>x.defense),maxTop=Math.max(...topOveralls),avgDefense=defenseTotals.reduce((a,b)=>a+b,0)/Math.max(1,defenseTotals.length);score+=spread(topOveralls)*(10*eliteBoost);teams.forEach((team,idx)=>{const topGap=maxTop-topOveralls[idx],defenseSurplus=Math.max(0,defenseTotals[idx]-avgDefense),unmetGap=Math.max(0,topGap-defenseSurplus*.5);score+=unmetGap*(4*eliteBoost)})}const teamOf={};teams.forEach((team,ti)=>team.forEach(p=>teamOf[p.id]=ti));state.pairRules.forEach(r=>{const same=teamOf[r.player1Id]===teamOf[r.player2Id];if(r.type==='together'&&!same)score+=30*Number(r.strength||1);if(r.type==='apart'&&same)score+=30*Number(r.strength||1)});teams.forEach(t=>{for(let i=0;i<t.length;i++)for(let j=i+1;j<t.length;j++)score+=(state.history[pairKey(t[i].id,t[j].id)]||0)*repeatWeight});return score}function cloneTeams(t){return t.map(x=>[...x])}function optimizeTeams(initial,repeatWeight=state.settings.repeatWeight){let best=cloneTeams(initial),bestScore=scoreTeams(best,repeatWeight),improved=true,passes=0;while(improved&&passes<300){improved=false;passes++;for(let a=0;a<best.length;a++)for(let b=a+1;b<best.length;b++)for(let i=0;i<best[a].length;i++)for(let j=0;j<best[b].length;j++){const cand=cloneTeams(best),tmp=cand[a][i];cand[a][i]=cand[b][j];cand[b][j]=tmp;const sc=scoreTeams(cand,repeatWeight);if(sc<bestScore){best=cand;bestScore=sc;improved=true}}}return{teams:best,score:bestScore}}
async function generateTeamsButton(){
  if(!canGenerateTeams()){ alert("Only captains/admins can generate teams."); return; }
  if(canManageGames()&&state.currentGame&&!state.resultsSavedForCurrentGame){const saveFirst=confirm('Current game results have not been saved. Save results before generating new teams?');if(saveFirst){if(state.selectedWinnerIndex===null){alert('Tap the winning team first, then press Generate Teams again.');return}await saveResults()}}await generateGame()}
async function generateGame(){
  if(!canGenerateTeams()){ alert("Only captains/admins can generate teams."); return; }
  const players=activeAttendingPlayers(),n=Math.max(2,Number(numTeams.value||2)),repeatWeight=Number(state.settings.repeatWeight||4);if(players.length<n){alert('Not enough attending players for that many teams.');return}let best=null;for(let i=0;i<60;i++){const cand=optimizeTeams(makeInitialTeams(players,n),repeatWeight);if(!best||cand.score<best.score)best=cand}state.currentGame={teams:best.teams};state.selectedWinnerIndex=null;state.resultsSavedForCurrentGame=false;if(canManageGames())await saveCurrentGameToDb(false);renderTeams();window.scrollTo({top:0,behavior:'smooth'})}
function serializableTeams(){return(state.currentGame?.teams||[]).map(t=>t.map(p=>({id:p.id,fullName:p.fullName})))}async function saveCurrentGameToDb(saved){const{error}=await db.from('current_game').upsert({id:'main',teams:serializableTeams(),selected_winner_index:state.selectedWinnerIndex,results_saved:!!saved,generated_at:new Date().toISOString(),updated_by:currentUser?.id||null});if(error)alert(error.message)}function selectWinner(i){if(!canManageGames())return;state.selectedWinnerIndex=state.selectedWinnerIndex===i?null:i;saveCurrentGameToDb(false);renderTeams()}
function renderTeams(){const out=teamsOutput;resultMessage.textContent='';if(!state.currentGame){out.innerHTML='<div class="small">No game generated yet.</div>';return}const wrap=document.createElement('div');wrap.className='grid grid-3';state.currentGame.teams.forEach((team,idx)=>{const stats=teamStats(team),box=document.createElement('div');let cls='teambox team-clickable';if(state.selectedWinnerIndex!==null)cls+=idx===state.selectedWinnerIndex?' team-win':' team-loss';box.className=cls;box.onclick=()=>selectWinner(idx);const teamMeta=canManageGames()?`<span class="small">${stats.overall.toFixed(2)}</span>`:`<span class="small">${team.length} players</span>`;const ratings=canManageGames()?`<div class="small">H ${stats.handling.toFixed(1)} · C ${stats.cutting.toFixed(1)} · D ${stats.defense.toFixed(1)}</div>`:'';const rows=team.map(p=>canManageGames()?`<div class="row" style="justify-content:space-between"><span>${p.fullName}</span><span class="small">${overall(p).toFixed(2)}</span></div>`:`<div class="row" style="justify-content:space-between"><span>${p.fullName}</span></div>`).join('');box.innerHTML=`<div class="teamhead"><strong>Team ${idx+1}</strong>${teamMeta}</div>${ratings}<div class="hr"></div>${rows}`;wrap.appendChild(box)});out.innerHTML='';out.appendChild(wrap)}
async function saveResults(){if(!canManageGames()){alert('Captain/admin only.');return}if(!state.currentGame){alert('Generate teams first.');return}if(state.selectedWinnerIndex===null){alert('Tap the winning team first.');return}if(state.resultsSavedForCurrentGame&&!confirm('Results already saved. Save again anyway?'))return;const winner=state.currentGame.teams[state.selectedWinnerIndex],losers=state.currentGame.teams.filter((_,i)=>i!==state.selectedWinnerIndex),winnerStrength=teamStats(winner).overall,updates=new Map();state.currentGame.teams.flat().forEach(p=>updates.set(p.id,{...p}));losers.forEach(lt=>{const ls=teamStats(lt).overall,we=expectedWinProb(winnerStrength,ls),le=expectedWinProb(ls,winnerStrength),scaledK=Number(state.settings.kFactor||.08)/Math.max(1,losers.length),wd=scaledK*(1-we),ld=scaledK*(0-le);winner.forEach(p=>updates.get(p.id).winLossRating+=wd);lt.forEach(p=>updates.get(p.id).winLossRating+=ld)});state.currentGame.teams.forEach((team,idx)=>team.forEach(p=>{const u=updates.get(p.id);u.gamesPlayed=Number(u.gamesPlayed||0)+1;if(idx===state.selectedWinnerIndex)u.wins=Number(u.wins||0)+1;else u.losses=Number(u.losses||0)+1}));for(const p of updates.values()){const{error}=await db.from('players').update({win_loss:p.winLossRating,games_played:p.gamesPlayed,wins:p.wins,losses:p.losses,updated_at:new Date().toISOString()}).eq('id',p.id);if(error){alert(error.message);return}await db.from('rating_history').insert({player_id:p.id,value:p.winLossRating})}await addCurrentTeamsToHistory();await db.from('games').insert({teams:serializableTeams(),winner_team_index:state.selectedWinnerIndex,created_by:currentUser?.id||null});state.resultsSavedForCurrentGame=true;await saveCurrentGameToDb(true);await loadCloudData();renderAll();resultMessage.textContent='Results saved.'}
async function addCurrentTeamsToHistory(){const up=[];(state.currentGame?.teams||[]).forEach(t=>{for(let i=0;i<t.length;i++)for(let j=i+1;j<t.length;j++){const key=pairKey(t[i].id,t[j].id),[a,b]=key.split('|');state.history[key]=(state.history[key]||0)+1;up.push({player_a:a,player_b:b,count:state.history[key]})}});if(up.length){const{error}=await db.from('teammate_history').upsert(up,{onConflict:'player_a,player_b'});if(error)alert(error.message)}}
function syncSettingsForm(){const s=state.settings;['weightHandling','weightCutting','weightDefense','kFactor','repeatWeight','handlerSeparationBoost'].forEach(id=>{const el=document.getElementById(id);if(el)el.value=s[id]});updateBoolButtons()}function toggleSettingBool(k){state.settings[k]=!state.settings[k];updateBoolButtons()}function updateBoolButtons(){const h=handlerSeparationBtn,e=eliteBalanceBtn;if(h){h.textContent='Handler Separation: '+(state.settings.prioritizeHandlerSeparation?'On':'Off');h.className=state.settings.prioritizeHandlerSeparation?'btn':'btn-secondary'}if(e){e.textContent='Elite Balance: '+(state.settings.prioritizeEliteBalance?'On':'Off');e.className=state.settings.prioritizeEliteBalance?'btn':'btn-secondary'}}async function saveSettings(){if(!isAdmin()){alert('Admin only.');return}const s=state.settings;s.weightHandling=Number(weightHandling.value||.35);s.weightCutting=Number(weightCutting.value||.35);s.weightDefense=Number(weightDefense.value||.30);s.kFactor=Number(kFactor.value||.08);s.repeatWeight=Number(repeatWeight.value||4);s.handlerSeparationBoost=Number(handlerSeparationBoost.value||2);const{error}=await db.from('settings').upsert({id:'main',weight_handling:s.weightHandling,weight_cutting:s.weightCutting,weight_defense:s.weightDefense,k_factor:s.kFactor,repeat_weight:s.repeatWeight,prioritize_handler_separation:s.prioritizeHandlerSeparation,handler_separation_boost:s.handlerSeparationBoost,prioritize_elite_balance:s.prioritizeEliteBalance,elite_balance_boost:s.eliteBalanceBoost,updated_at:new Date().toISOString()});if(error)alert(error.message);else alert('Settings saved.')}
function splitCsvLine(line){const out=[];let cur='',q=false;for(let i=0;i<line.length;i++){const ch=line[i],n=line[i+1];if(ch==='"'&&q&&n==='"'){cur+='"';i++}else if(ch==='"')q=!q;else if(ch===','&&!q){out.push(cur);cur=''}else cur+=ch}out.push(cur);return out}function parseCsv(text){const lines=text.trim().split(/\r?\n/).filter(Boolean);if(lines.length<2)return[];const headers=splitCsvLine(lines[0]).map(h=>h.trim());return lines.slice(1).map(line=>{const cols=splitCsvLine(line),o={};headers.forEach((h,i)=>o[h]=(cols[i]||'').trim());return o})}
function describeImportChanges(rows,inactive){const changes=[];let adds=0,updates=0;rows.forEach(r=>{const first=(r['First Name']||'').trim(),last=(r['Last Name']||'').trim(),full=normalizeName(`${first} ${last}`);if(!full)return;const ex=state.players.find(p=>p.fullName.toLowerCase()===full.toLowerCase()),next={handling:Number(r.Handling||0),cutting:Number(r.Cutting||0),defense:Number(r.Defense||0),winLossRating:Number(r['Win/Loss']||r['Win/Loss Rating']||0),active:!inactive};if(!ex){adds++;changes.push({type:'Add',name:full,details:`new player · H ${next.handling} · C ${next.cutting} · D ${next.defense} · W/L ${next.winLossRating.toFixed(2)} · ${next.active?'active':'inactive'}`})}else{updates++;const parts=[];if(ex.handling!==next.handling)parts.push(`H ${ex.handling} → ${next.handling}`);if(ex.cutting!==next.cutting)parts.push(`C ${ex.cutting} → ${next.cutting}`);if(ex.defense!==next.defense)parts.push(`D ${ex.defense} → ${next.defense}`);if(ex.winLossRating!==next.winLossRating)parts.push(`W/L ${ex.winLossRating.toFixed(2)} → ${next.winLossRating.toFixed(2)}`);if(ex.active!==next.active)parts.push(`${ex.active?'active':'inactive'} → ${next.active?'active':'inactive'}`);changes.push({type:'Update',name:full,details:parts.length?parts.join(' · '):'no rating/status changes'})}});return{changes,adds,updates}}
function previewCsv(inactive){const text=document.getElementById(inactive?'inactiveCsv':'activeCsv').value.trim();if(!text){alert('Paste CSV first.');return}const res=describeImportChanges(parseCsv(text),inactive);importPreviewBox.style.display='block';importPreviewSummary.textContent=`${res.changes.length} rows scanned · ${res.adds} new · ${res.updates} existing players matched`;importPreviewList.innerHTML='';res.changes.forEach(i=>{const d=document.createElement('div');d.className='player';d.innerHTML=`<div><div class="player-name">${i.type}: ${i.name}</div><div class="small">${i.details}</div></div>`;importPreviewList.appendChild(d)})}function closeImportPreview(){importPreviewBox.style.display='none'}
async function importCsv(inactive){if(!isAdmin()){alert('Admin only.');return}const text=document.getElementById(inactive?'inactiveCsv':'activeCsv').value.trim();if(!text){alert('Paste CSV first.');return}const rows=parseCsv(text);for(const r of rows){const first=(r['First Name']||'').trim(),last=(r['Last Name']||'').trim();if(!first&&!last)continue;const payload={first_name:first,last_name:last,handling:Number(r.Handling||0),cutting:Number(r.Cutting||0),defense:Number(r.Defense||0),win_loss:Number(r['Win/Loss']||r['Win/Loss Rating']||0),active:!inactive,games_played:Number(r['Games Played']||0),wins:Number(r.Wins||0),losses:Number(r.Losses||0),updated_at:new Date().toISOString()};const{data,error}=await db.from('players').upsert(payload,{onConflict:'first_name,last_name'}).select().single();if(error){alert(error.message);return}await db.from('rating_history').insert({player_id:data.id,value:payload.win_loss})}await loadCloudData();renderAll();alert(`Imported ${rows.length} rows.`)}

function describeSeasonStatsChanges(rows){const changes=[];let matched=0,missing=0;rows.forEach(r=>{const first=(r['First Name']||'').trim(),last=(r['Last Name']||'').trim(),full=normalizeName(`${first} ${last}`);if(!full)return;const ex=state.players.find(p=>p.fullName.toLowerCase()===full.toLowerCase());const next={gamesPlayed:Number(r['Games Played']||0),wins:Number(r.Wins||0),losses:Number(r.Losses||0)};if(!ex){missing++;changes.push({type:'Missing',name:full,details:'player not found; import active/inactive players first'});return}matched++;const parts=[];if(Number(ex.gamesPlayed||0)!==next.gamesPlayed)parts.push(`Games ${Number(ex.gamesPlayed||0)} → ${next.gamesPlayed}`);if(Number(ex.wins||0)!==next.wins)parts.push(`Wins ${Number(ex.wins||0)} → ${next.wins}`);if(Number(ex.losses||0)!==next.losses)parts.push(`Losses ${Number(ex.losses||0)} → ${next.losses}`);changes.push({type:'Update',name:full,details:parts.length?parts.join(' · '):'no season stat changes'});});return{changes,matched,missing}}
function previewSeasonStatsCsv(){const text=document.getElementById('seasonStatsCsv')?.value.trim();if(!text){alert('Paste season_stats.csv first.');return}const res=describeSeasonStatsChanges(parseCsv(text));seasonPreviewBox.style.display='block';seasonPreviewSummary.textContent=`${res.changes.length} rows scanned · ${res.matched} matched · ${res.missing} missing`;seasonPreviewList.innerHTML='';res.changes.forEach(i=>{const d=document.createElement('div');d.className='player';d.innerHTML=`<div><div class="player-name">${i.type}: ${i.name}</div><div class="small">${i.details}</div></div>`;seasonPreviewList.appendChild(d)})}
function closeSeasonPreview(){seasonPreviewBox.style.display='none'}
async function importSeasonStatsCsv(){if(!isAdmin()){alert('Admin only.');return}const text=document.getElementById('seasonStatsCsv')?.value.trim();if(!text){alert('Paste season_stats.csv first.');return}const rows=parseCsv(text);let updated=0,missing=0;for(const r of rows){const first=(r['First Name']||'').trim(),last=(r['Last Name']||'').trim(),full=normalizeName(`${first} ${last}`);if(!full)continue;const ex=state.players.find(p=>p.fullName.toLowerCase()===full.toLowerCase());if(!ex){missing++;continue}const payload={games_played:Number(r['Games Played']||0),wins:Number(r.Wins||0),losses:Number(r.Losses||0),updated_at:new Date().toISOString()};const{error}=await db.from('players').update(payload).eq('id',ex.id);if(error){alert(error.message);return}updated++}await loadCloudData();renderAll();alert(`Imported season stats for ${updated} players.${missing?` ${missing} rows did not match existing players.`:''}`)}
function getDatePrefix(){const d=new Date();return`${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`}function escapeCsv(v){const s=String(v??'');return/[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s}function downloadBlob(fn,content,type){const blob=new Blob([content],{type}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=fn;a.click()}function downloadBackupJson(){downloadBlob(`${getDatePrefix()}_ultimate-teams-cloud-backup.json`,JSON.stringify(state,null,2),'application/json')}function downloadRatingsCsv(){
  if(!canAccessDataPage()){ alert("Captain/admin only."); return; }
  const sorted=[...state.players].sort(comparePlayersByLastName),header=['First Name','Last Name','Handling','Cutting','Defense','Win/Loss'];const build=ps=>[header,...ps.map(p=>[p.firstName,p.lastName,p.handling,p.cutting,p.defense,p.winLossRating.toFixed(2)])].map(r=>r.map(escapeCsv).join(',')).join('\n');const stats=[['First Name','Last Name','Games Played','Wins','Losses','Win %','Win/Loss'],...sorted.map(p=>[p.firstName,p.lastName,p.gamesPlayed,p.wins,p.losses,p.gamesPlayed?((p.wins/p.gamesPlayed)*100).toFixed(1)+'%':'0.0%',p.winLossRating.toFixed(2)])].map(r=>r.map(escapeCsv).join(',')).join('\n');const pre=getDatePrefix();downloadBlob(`${pre}_active_players.csv`,build(sorted.filter(p=>p.active)),'text/csv');setTimeout(()=>downloadBlob(`${pre}_inactive_players.csv`,build(sorted.filter(p=>!p.active)),'text/csv'),250);setTimeout(()=>downloadBlob(`${pre}_season_stats.csv`,stats,'text/csv'),500)}async function resetSeasonStats(){if(!isAdmin()){alert('Admin only.');return}if(!confirm('Reset Games Played, Wins, and Losses for all players?'))return;const{error}=await db.from('players').update({games_played:0,wins:0,losses:0,updated_at:new Date().toISOString()}).not('id','is',null);if(error)alert(error.message);await loadCloudData();renderAll()}async function resetHistory(){if(!isAdmin()){alert('Admin only.');return}if(!confirm('Reset teammate history?'))return;const{error}=await db.from('teammate_history').delete().not('player_a','is',null);if(error)alert(error.message);await loadCloudData();renderAll()}

function lockPairFromMain(){ return lockPair(); }

function addPairRuleFromMain(){ return addPairRule(); }










function openRatingsModal(show=true){
  if(!canAccessDataPage()){ alert("Captain/admin only."); return; }
  const content = document.getElementById("ratingsModalContent");
  if(!content){ alert("Ratings modal missing."); return; }

  const search = (document.getElementById("ratingsSearch")?.value || "").trim().toLowerCase();
  const players = [...state.players]
    .filter(p => !search || String(p.fullName || "").toLowerCase().includes(search))
    .sort(comparePlayersByLastName);

  content.innerHTML = players.length ? players.map((p, i) => `
    <div class="player">
      <div>
        <div class="player-name">${i+1}. ${p.fullName}</div>
        <div class="small">
          Overall ${overall(p).toFixed(2)} ·
          H ${Number(p.handling||0).toFixed(1)} ·
          C ${Number(p.cutting||0).toFixed(1)} ·
          D ${Number(p.defense||0).toFixed(1)} ·
          W/L ${Number(p.winLossRating||0).toFixed(2)} ·
          Games ${Number(p.gamesPlayed||0)} ·
          Wins ${Number(p.wins||0)} ·
          Losses ${Number(p.losses||0)} ·
          ${p.active ? "Active" : "Inactive"}
        </div>
      </div>
    </div>`).join("") : '<div class="small">No players match that filter.</div>';

  if(show) showModal("ratingsModal");
}





let selectedEditPlayerId = null;

function openEditPlayerModal(show=true){
  if(!canEditPlayerNames()){ alert("Captain/admin only."); return; }
  updateRoleVisibility();

  const list = document.getElementById("editPlayerModalList");
  if(!list){ alert("Edit Player modal missing."); return; }

  const search = (document.getElementById("editPlayerSearch")?.value || "").trim().toLowerCase();
  const players = [...state.players]
    .filter(p => !search || String(p.fullName || "").toLowerCase().includes(search))
    .sort(comparePlayersByLastName);

  list.innerHTML = players.length
    ? players.map(p => `
      <div class="player clickable" onclick="selectPlayerForEdit('${p.id}')">
        <div>
          <div class="player-name">${p.fullName}</div>
          <div class="small">${p.active ? "Active" : "Inactive"}${isAdmin() ? ` · H ${Number(p.handling||0).toFixed(1)} · C ${Number(p.cutting||0).toFixed(1)} · D ${Number(p.defense||0).toFixed(1)} · W/L ${Number(p.winLossRating||0).toFixed(2)}` : " · name edit only"}</div>
        </div>
      </div>`).join("")
    : '<div class="small">No players match that search.</div>';

  const help = document.getElementById("editPlayerHelp");
  if(help) help.textContent = isAdmin()
    ? "Admins can edit names and ratings."
    : "Captains can edit player names only. Ratings are locked.";

  if(show) showModal("editPlayerModal");
  updateRoleVisibility();
}

function selectPlayerForEdit(id){
  const player = state.players.find(p => String(p.id) === String(id));
  if(!player) return;

  selectedEditPlayerId = player.id;

  const empty = document.getElementById("editPlayerFormEmpty");
  const form = document.getElementById("editPlayerForm");
  if(empty) empty.style.display = "none";
  if(form) form.style.display = "block";

  const first = document.getElementById("editFirstName");
  const last = document.getElementById("editLastName");
  const h = document.getElementById("editHandling");
  const c = document.getElementById("editCutting");
  const d = document.getElementById("editDefense");
  const wl = document.getElementById("editWinLoss");

  if(first) first.value = player.firstName || "";
  if(last) last.value = player.lastName || "";
  if(h) h.value = Number(player.handling || 0).toFixed(1);
  if(c) c.value = Number(player.cutting || 0).toFixed(1);
  if(d) d.value = Number(player.defense || 0).toFixed(1);
  if(wl) wl.value = Number(player.winLossRating || 0).toFixed(2);

  [h,c,d,wl].forEach(el => { if(el) el.disabled = !isAdmin(); });

  const status = document.getElementById("editPlayerStatus");
  if(status) status.textContent = `${player.active ? "Active" : "Inactive"} · Games ${Number(player.gamesPlayed||0)} · Wins ${Number(player.wins||0)} · Losses ${Number(player.losses||0)}`;

  updateRoleVisibility();
}

async function saveEditedPlayer(){
  if(!canEditPlayerNames()){ alert("Captain/admin only."); return; }

  const player = state.players.find(p => String(p.id) === String(selectedEditPlayerId));
  if(!player){ alert("Select a player first."); return; }

  const firstName = (document.getElementById("editFirstName")?.value || "").trim();
  const lastName = (document.getElementById("editLastName")?.value || "").trim();
  const fullName = `${firstName} ${lastName}`.trim();

  if(!fullName){ alert("Enter a valid player name."); return; }

  const payload = {
    first_name: firstName,
    last_name: lastName,
    full_name: fullName,
    updated_at: new Date().toISOString()
  };

  if(isAdmin()){
    payload.handling = Number(document.getElementById("editHandling")?.value || 0);
    payload.cutting = Number(document.getElementById("editCutting")?.value || 0);
    payload.defense = Number(document.getElementById("editDefense")?.value || 0);
    payload.win_loss = Number(document.getElementById("editWinLoss")?.value || 0);
  }

  const { error } = await db.from("players").update(payload).eq("id", player.id);
  if(error){ alert(error.message); return; }

  await loadCloudData();
  renderAll();
  openEditPlayerModal(false);
  selectPlayerForEdit(player.id);
  alert("Player updated.");
}

async function deleteEditedPlayer(){
  if(!isAdmin()){ alert("Admin only."); return; }

  const player = state.players.find(p => String(p.id) === String(selectedEditPlayerId));
  if(!player){ alert("Select a player first."); return; }

  if(!confirm(`Delete ${player.fullName}? This cannot be undone.`)) return;

  const { error } = await db.from("players").delete().eq("id", player.id);
  if(error){ alert(error.message); return; }

  selectedEditPlayerId = null;
  await loadCloudData();
  renderAll();

  const empty = document.getElementById("editPlayerFormEmpty");
  const form = document.getElementById("editPlayerForm");
  if(empty) empty.style.display = "block";
  if(form) form.style.display = "none";
  openEditPlayerModal(false);
}




function showModal(id){
  const modal = document.getElementById(id);
  if(modal){
    modal.classList.add("modal-open");
    modal.style.display = "flex";
  }
}
function hideModal(id){
  const modal = document.getElementById(id);
  if(modal){
    modal.classList.remove("modal-open");
    modal.style.display = "none";
  }
}
function closeModal(event, id){
  if(event && event.target && event.target.id === id) hideModal(id);
}
function clearModalSearch(id){
  const el = document.getElementById(id);
  if(el) el.value = "";
}



function hideAllModals(){
  ["ratingsModal","editPlayerModal","trendModal","simulateModal","balanceModal"].forEach(id => hideModal(id));
}



// v4.8 robust modal helpers override
function showModal(id){
  const modal = document.getElementById(id);
  if(modal){
    modal.classList.add("modal-open");
    modal.style.display = "flex";
  }
}
function hideModal(id){
  const modal = document.getElementById(id);
  if(modal){
    modal.classList.remove("modal-open");
    modal.style.display = "none";
  }
}
function closeModal(event, id){
  if(event && event.target && event.target.id === id) hideModal(id);
}
function clearModalSearch(id){
  const el = document.getElementById(id);
  if(el) el.value = "";
}





function isCaptainOrAdmin(){
  return !!(profile && (profile.role === "admin" || profile.role === "captain"));
}
function canAccessDataPage(){
  return isCaptainOrAdmin();
}
function canGenerateTeams(){
  return isCaptainOrAdmin();
}
function canToggleInactiveVisibility(){
  return isCaptainOrAdmin();
}
function isPlainUserOrGuest(){
  return !isCaptainOrAdmin();
}



function updateNavVisibility(){
  const dataBtn = document.getElementById("dataTabBtn");
  if(dataBtn){
    const show = canAccessDataPage();
    dataBtn.classList.toggle("hidden", !show);
    dataBtn.style.display = show ? "" : "none";
  }
  const mainBtn = document.getElementById("mainTabBtn");
  if(mainBtn){
    mainBtn.classList.remove("hidden");
    mainBtn.style.display = "";
  }
}

