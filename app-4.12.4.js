/* Ultimate Teams 4.12.0 — canonical refactor layer
   Historical compatibility lives in legacy-core.js.
   New active behavior belongs here. */

const REFACTOR_VERSION_4120 = "4.12.4";
const OFFLINE_ATTENDANCE_KEY_4120 = "ultimateTeamsOfflineAttendance4120";
function offlineAttendanceKey4120(){ return `${OFFLINE_ATTENDANCE_KEY_4120}:${currentUser?.id || "guest"}`; }
const SANDBOX_STORAGE_KEY_4120 = "ultimateTeamsSandbox4120";

let cloudLoadPromise4120 = null;
let gameNightStats4120 = { completed:0, lastWinner:null, lastPlayedAt:null };
let previousOfficialGameForReshuffle4120 = null;
let offlineFlushRunning4120 = false;
let sandboxState4120 = null;

function deepClone4120(value){
  return value == null ? value : JSON.parse(JSON.stringify(value));
}
function average4120(values){
  if(!values?.length) return 0;
  return values.reduce((a,b) => a + Number(b || 0), 0) / values.length;
}
function range4120(values){
  if(!values?.length) return 0;
  return Math.max(...values) - Math.min(...values);
}
function safePct4120(spreadValue, averageValue){
  const avg = Math.abs(Number(averageValue || 0));
  if(avg < 0.0001) return spreadValue ? 100 : 0;
  return Math.abs(Number(spreadValue || 0)) / avg * 100;
}
function teamSignature4120(teams){
  return (teams || []).map(team => team.map(p => String(p.id)).sort().join(",")).sort().join("||");
}
function teamPairSet4120(teams){
  const pairs = new Set();
  (teams || []).forEach(team => {
    for(let i=0;i<team.length;i++){
      for(let j=i+1;j<team.length;j++) pairs.add(pairKey(team[i].id, team[j].id));
    }
  });
  return pairs;
}
function activeReshuffleMode4120(settings = state.settings){
  const mode = String(settings?.reshuffleMode || "normal");
  return ["normal","maximum","balance"].includes(mode) ? mode : "normal";
}
function localTeammateHistory4120(){
  if(typeof readLocalTeammatePairHistory41119 !== "function" || !isTeammate()) return { pairCounts:{}, lastTeamSignature:"" };
  return readLocalTeammatePairHistory41119() || { pairCounts:{}, lastTeamSignature:"" };
}

/* ---------- Canonical scoring engine ---------- */
function scoreContext4120(overrides = {}){
  return {
    settings: overrides.settings || state.settings,
    pairRules: overrides.pairRules || state.pairRules,
    history: overrides.history || state.history,
    localPairCounts: Object.prototype.hasOwnProperty.call(overrides,"localPairCounts") ? overrides.localPairCounts : localTeammateHistory4120().pairCounts,
    lastLocalSignature: Object.prototype.hasOwnProperty.call(overrides,"lastLocalSignature") ? overrides.lastLocalSignature : localTeammateHistory4120().lastTeamSignature,
    previousGameTeams: Object.prototype.hasOwnProperty.call(overrides,"previousGameTeams") ? overrides.previousGameTeams : previousOfficialGameForReshuffle4120,
    reshuffleMode: overrides.reshuffleMode || activeReshuffleMode4120(overrides.settings || state.settings),
    repeatWeight: Number(overrides.repeatWeight ?? (overrides.settings || state.settings).repeatWeight ?? 4),
    sandbox: !!overrides.sandbox
  };
}

function scoreBreakdown4120(teams, overrides = {}){
  const ctx = scoreContext4120(overrides);
  const s = ctx.settings;
  const stats = teams.map(teamStats);
  const mode = ctx.reshuffleMode;
  const repeatWeight = Number(ctx.repeatWeight || 0);
  const breakdown = {
    size:0, overall:0, handling:0, cutting:0, defense:0, elite:0,
    pairRules:0, repeat:0, localRepeat:0, reshuffle:0, total:0,
    pairRuleViolations:0, repeatedPairs:0
  };

  breakdown.size = spread(stats.map(x => x.count)) * 120;
  breakdown.overall = spread(stats.map(x => x.overall)) * 14;
  breakdown.handling = spread(stats.map(x => x.handling)) * (s.prioritizeHandlerSeparation ? 5 * Number(s.handlerSeparationBoost || 2) : 5);
  breakdown.cutting = spread(stats.map(x => x.cutting)) * 5;
  breakdown.defense = spread(stats.map(x => x.defense)) * 5;

  if(s.prioritizeEliteBalance){
    const eliteBoost = Number(s.eliteBalanceBoost || 2);
    const topOveralls = teams.map(team => team.length ? Math.max(...team.map(p => overall(p))) : 0);
    breakdown.elite = spread(topOveralls) * (10 * eliteBoost);
  }

  const teamOf = {};
  teams.forEach((team, teamIndex) => team.forEach(p => teamOf[p.id] = teamIndex));
  (ctx.pairRules || []).forEach(r => {
    if(teamOf[r.player1Id] === undefined || teamOf[r.player2Id] === undefined) return;
    const same = teamOf[r.player1Id] === teamOf[r.player2Id];
    const violated = (r.type === "together" && !same) || (r.type === "apart" && same);
    if(violated){
      breakdown.pairRuleViolations++;
      breakdown.pairRules += 30 * Number(r.strength || 1);
    }
  });

  if(mode !== "balance"){
    teams.forEach(team => {
      for(let i=0;i<team.length;i++){
        for(let j=i+1;j<team.length;j++){
          const key = pairKey(team[i].id, team[j].id);
          const officialCount = Number((ctx.history || {})[key] || 0);
          const localCount = Number((ctx.localPairCounts || {})[key] || 0);
          if(officialCount || localCount) breakdown.repeatedPairs++;
          breakdown.repeat += officialCount * repeatWeight;
          breakdown.localRepeat += localCount * repeatWeight;
        }
      }
    });
  }

  if(mode === "maximum" && ctx.previousGameTeams?.length){
    const previousPairs = teamPairSet4120(ctx.previousGameTeams);
    teams.forEach(team => {
      for(let i=0;i<team.length;i++){
        for(let j=i+1;j<team.length;j++){
          if(previousPairs.has(pairKey(team[i].id, team[j].id))){
            breakdown.reshuffle += Math.max(12, repeatWeight * 4);
          }
        }
      }
    });
  }

  if(mode !== "balance" && ctx.lastLocalSignature && teamSignature4120(teams) === ctx.lastLocalSignature){
    breakdown.reshuffle += 100000;
  }

  breakdown.total = breakdown.size + breakdown.overall + breakdown.handling + breakdown.cutting + breakdown.defense + breakdown.elite + breakdown.pairRules + breakdown.repeat + breakdown.localRepeat + breakdown.reshuffle;
  return breakdown;
}

function scoreTeams4120(teams, repeatWeight = state.settings.repeatWeight, context = {}){
  return scoreBreakdown4120(teams, { ...context, repeatWeight }).total;
}
scoreTeams = scoreTeams4120;
window.scoreTeams = scoreTeams4120;

function maxTeamSpread4120(playerCount, numTeams){
  if(numTeams <= 1) return 0;
  // Keep the previously requested limited unequal-team behavior.
  // With two teams an even total requires a spread of two to be unequal.
  return 2;
}
function teamCountSpread4120(teams){
  const counts = teams.map(t => t.length);
  return counts.length ? Math.max(...counts) - Math.min(...counts) : 0;
}
function optimizeTeams4120(initial, repeatWeight = state.settings.repeatWeight, context = {}){
  let best = cloneTeams(initial);
  let bestScore = scoreTeams4120(best, repeatWeight, context);
  let improved = true;
  let passes = 0;
  const playerCount = best.reduce((n,t) => n + t.length, 0);
  const maxSpread = maxTeamSpread4120(playerCount, best.length);

  while(improved && passes < 240){
    improved = false;
    passes++;

    for(let a=0;a<best.length;a++){
      for(let b=a+1;b<best.length;b++){
        for(let i=0;i<best[a].length;i++){
          for(let j=0;j<best[b].length;j++){
            const candidate = cloneTeams(best);
            [candidate[a][i],candidate[b][j]] = [candidate[b][j],candidate[a][i]];
            const candidateScore = scoreTeams4120(candidate, repeatWeight, context);
            if(candidateScore < bestScore - 0.000001){
              best = candidate; bestScore = candidateScore; improved = true;
            }
          }
        }
      }
    }

    for(let from=0;from<best.length;from++){
      if(best[from].length <= 1) continue;
      for(let to=0;to<best.length;to++){
        if(from === to) continue;
        for(let i=0;i<best[from].length;i++){
          const candidate = cloneTeams(best);
          const [moved] = candidate[from].splice(i,1);
          candidate[to].push(moved);
          if(teamCountSpread4120(candidate) > maxSpread) continue;
          const candidateScore = scoreTeams4120(candidate, repeatWeight, context);
          if(candidateScore < bestScore - 0.000001){
            best = candidate; bestScore = candidateScore; improved = true;
          }
        }
      }
    }
  }
  return { teams:best, score:bestScore };
}
optimizeTeams = optimizeTeams4120;
window.optimizeTeams = optimizeTeams4120;

function balanceQuality4120(teams){
  if(!teams?.length) return { score:0, label:"No game", className:"balance-poor", overallGap:0, sizeSpread:0, details:"Generate teams to see balance quality." };
  const stats = teams.map(teamStats);
  const overallValues = stats.map(s => s.overall);
  const handlingValues = stats.map(s => s.handling);
  const cuttingValues = stats.map(s => s.cutting);
  const defenseValues = stats.map(s => s.defense);
  const overallRange = range4120(overallValues);
  const handlingRange = range4120(handlingValues);
  const cuttingRange = range4120(cuttingValues);
  const defenseRange = range4120(defenseValues);
  const overallPct = safePct4120(overallRange, average4120(overallValues));
  const handlingPct = safePct4120(handlingRange, average4120(handlingValues));
  const cuttingPct = safePct4120(cuttingRange, average4120(cuttingValues));
  const defensePct = safePct4120(defenseRange, average4120(defenseValues));
  const sizeSpread = range4120(stats.map(s => s.count));
  const ruleViolations = scoreBreakdown4120(teams, { reshuffleMode:"balance", history:{}, localPairCounts:{} }).pairRuleViolations;

  let score = 100;
  score -= Math.min(48, overallPct * 2.15);
  score -= Math.min(12, handlingPct * .16);
  score -= Math.min(9, cuttingPct * .11);
  score -= Math.min(9, defensePct * .11);
  score -= Math.max(0, sizeSpread - 1) * 5;
  score -= ruleViolations * 9;
  score = Math.max(0, Math.min(100, Math.round(score)));

  let label = "Needs work", className = "balance-poor";
  if(score >= 90){ label="Excellent"; className="balance-excellent"; }
  else if(score >= 80){ label="Good"; className="balance-good"; }
  else if(score >= 65){ label="Fair"; className="balance-fair"; }

  return {
    score,label,className,
    overallGap:overallRange,
    overallPct,
    sizeSpread,
    ruleViolations,
    details:`Strength gap ${overallRange.toFixed(2)} (${overallPct.toFixed(1)}%) · size spread ${sizeSpread}${ruleViolations ? ` · ${ruleViolations} Pair Rule conflict${ruleViolations===1?"":"s"}` : ""}`
  };
}
window.balanceQuality4120 = balanceQuality4120;

/* ---------- Settings / reshuffle mode ---------- */
function syncSettingsForm4120(){
  const s = state.settings;
  setValue("weightHandling", s.weightHandling);
  setValue("weightCutting", s.weightCutting);
  setValue("weightDefense", s.weightDefense);
  setValue("kFactor", s.kFactor);
  setValue("repeatWeight", s.repeatWeight);
  setValue("handlerSeparationBoost", s.handlerSeparationBoost);
  setValue("eliteBalanceBoost", s.eliteBalanceBoost);
  setValue("reshuffleModeSetting", activeReshuffleMode4120(s));
  updateBoolButtons();
}
syncSettingsForm = syncSettingsForm4120;
window.syncSettingsForm = syncSettingsForm4120;

function normalizeSettingsBeforeSave4120(){
  const s = state.settings;
  s.weightHandling = readNumberSetting("weightHandling", .35);
  s.weightCutting = readNumberSetting("weightCutting", .35);
  s.weightDefense = readNumberSetting("weightDefense", .30);
  s.kFactor = readNumberSetting("kFactor", .08);
  s.repeatWeight = readNumberSetting("repeatWeight", 4);
  s.handlerSeparationBoost = readNumberSetting("handlerSeparationBoost", 2);
  s.eliteBalanceBoost = readNumberSetting("eliteBalanceBoost", 2);
  s.reshuffleMode = document.getElementById("reshuffleModeSetting")?.value || "normal";
}
normalizeSettingsBeforeSave = normalizeSettingsBeforeSave4120;

function settingsPayload4120(){
  const s = state.settings;
  return {
    id:"main",
    weight_handling:s.weightHandling,
    weight_cutting:s.weightCutting,
    weight_defense:s.weightDefense,
    k_factor:s.kFactor,
    repeat_weight:s.repeatWeight,
    prioritize_handler_separation:s.prioritizeHandlerSeparation,
    handler_separation_boost:s.handlerSeparationBoost,
    prioritize_elite_balance:s.prioritizeEliteBalance,
    elite_balance_boost:s.eliteBalanceBoost,
    reshuffle_mode:activeReshuffleMode4120(s),
    updated_at:new Date().toISOString()
  };
}
settingsPayload = settingsPayload4120;

async function saveSettings4120(){
  if(!isAdmin()){ alert("Admin only."); return; }
  normalizeSettingsBeforeSave4120();
  const status = document.getElementById("settingsSaveStatus");
  if(status) status.textContent = "Saving settings...";
  const { error } = await db.from("settings").upsert(settingsPayload4120(), { onConflict:"id" });
  if(error){
    if(status) status.textContent = "Settings save failed.";
    const msg = String(error.message || error);
    if(msg.toLowerCase().includes("reshuffle_mode")) alert("Run update_4_12_0.sql once, then save settings again.");
    else alert("Settings save failed: " + msg);
    return;
  }
  if(status) status.textContent = "Settings saved.";
  saveSafeStartupSnapshot41121?.();
}
saveSettings = saveSettings4120;
window.saveSettings = saveSettings4120;

/* ---------- Bootstrap / fast startup ---------- */
async function fetchBootstrap4120(includeProfile = true){
  const { data, error } = await db.rpc("get_app_bootstrap_4120");
  if(!error && data) return { payload:data, usedRpc:true };
  const fallback = await fallbackBootstrap41121(includeProfile);
  fallback.settings = fallback.settings || {};
  fallback.settings.reshuffle_mode = state.settings.reshuffleMode || "normal";
  return { payload:fallback, usedRpc:false };
}
function applyBootstrapPayload4120(payload, includeProfile = true){
  applyBootstrapPayload41121(payload, includeProfile);
  state.settings.reshuffleMode = payload?.settings?.reshuffle_mode || state.settings.reshuffleMode || "normal";
  state.showInactive = false;
  applyOfflineAttendanceQueueToState4120();
  syncSettingsForm4120();
}
async function loadCloudData4120(options = {}){
  if(!db) return null;
  const includeProfile = options.includeProfile !== false;
  const applyLocal = options.applyLocal !== false;
  const force = options.force === true;
  if(cloudLoadPromise4120 && !force) return cloudLoadPromise4120;
  const task = (async()=>{
    const { payload } = await fetchBootstrap4120(includeProfile);
    applyBootstrapPayload4120(payload, includeProfile);
    if(currentUser && includeProfile && !payload.profile) await loadProfile();
    if(applyLocal && typeof applyLocalTeammateGame41117 === "function") applyLocalTeammateGame41117();
    applyOfflineAttendanceQueueToState4120();
    saveSafeStartupSnapshot41121?.();
    return payload;
  })();
  cloudLoadPromise4120 = task;
  try{ return await task; }
  finally{ if(cloudLoadPromise4120 === task) cloudLoadPromise4120 = null; }
}
loadCloudData = loadCloudData4120;
window.loadCloudData = loadCloudData4120;

function scheduleLiveRefresh4120(){
  if(liveRefreshTimer) clearTimeout(liveRefreshTimer);
  liveRefreshTimer = setTimeout(async()=>{
    try{ await loadCloudData4120({ includeProfile:true, applyLocal:true }); renderAll(); refreshGameNightStats4120(false); }
    catch(e){ console.warn("Live refresh failed", e); }
  },180);
}
scheduleLiveRefresh = scheduleLiveRefresh4120;
window.scheduleLiveRefresh = scheduleLiveRefresh4120;

/* ---------- Offline attendance queue ---------- */
function readOfflineAttendanceQueue4120(){
  try{
    const value = JSON.parse(localStorage.getItem(offlineAttendanceKey4120()) || "[]");
    return Array.isArray(value) ? value : [];
  }catch(e){ return []; }
}
function writeOfflineAttendanceQueue4120(queue){
  localStorage.setItem(offlineAttendanceKey4120(), JSON.stringify(queue || []));
  renderGameNightDashboard4120();
}
function queueAttendance4120(playerId, present){
  const queue = readOfflineAttendanceQueue4120().filter(item => String(item.playerId) !== String(playerId));
  queue.push({ playerId:String(playerId), present:!!present, queuedAt:new Date().toISOString() });
  writeOfflineAttendanceQueue4120(queue);
}
function applyOfflineAttendanceQueueToState4120(){
  readOfflineAttendanceQueue4120().forEach(item => {
    const p = playerById(item.playerId);
    if(p) p.attending = !!item.present;
  });
}
function isNetworkError4120(error){
  if(navigator.onLine === false) return true;
  const msg = String(error?.message || error || "").toLowerCase();
  return ["fetch","network","offline","failed to fetch","load failed","connection","timeout","timed out"].some(x => msg.includes(x));
}
async function flushOfflineAttendanceQueue4120(){
  if(offlineFlushRunning4120 || !currentUser || navigator.onLine === false) return;
  let queue = readOfflineAttendanceQueue4120();
  if(!queue.length) return;
  offlineFlushRunning4120 = true;
  try{
    const remaining = [];
    for(const item of queue){
      try{
        const { error } = await saveAttendanceFromApp(item.playerId, !!item.present);
        if(error){
          if(isNetworkError4120(error)){ remaining.push(item); continue; }
          console.warn("Dropping queued attendance change that is no longer permitted", error);
        }
      }catch(e){
        if(isNetworkError4120(e)) remaining.push(item);
        else console.warn("Queued attendance change failed", e);
      }
    }
    writeOfflineAttendanceQueue4120(remaining);
    if(!remaining.length) await loadCloudData4120({ includeProfile:true, applyLocal:true, force:true });
    renderAll();
  }finally{ offlineFlushRunning4120 = false; }
}

async function toggleAttendance4120(id){
  if(!canMarkAttendance()){
    alert("Create an account or sign in to mark attendance.");
    toggleSignInBox(); return;
  }
  const p = playerById(id);
  if(!p) return;
  if(!canMarkAttendanceForPlayer(p)){
    if(isPlayerRole()) return;
    alert(attendancePermissionMessage()); return;
  }
  const next = !p.attending;
  const wasActive = p.active;
  p.attending = next;
  if(next && !p.active && canManageGames()) p.active = true;
  renderAll();

  if(navigator.onLine === false){
    queueAttendance4120(p.id,next);
    return;
  }
  try{
    const { error } = await saveAttendanceFromApp(p.id,next);
    if(error){
      if(isNetworkError4120(error)){ queueAttendance4120(p.id,next); return; }
      throw error;
    }
    saveSafeStartupSnapshot41121?.();
  }catch(e){
    if(isNetworkError4120(e)){ queueAttendance4120(p.id,next); return; }
    p.attending = !next; p.active = wasActive; renderAll();
    alert("Attendance save error: " + (e?.message || e));
  }
}
toggleAttendance = toggleAttendance4120;
window.toggleAttendance = toggleAttendance4120;

/* ---------- Game-night dashboard ---------- */
function localDayStartIso4120(){
  const d = new Date(); d.setHours(0,0,0,0); return d.toISOString();
}
async function refreshGameNightStats4120(render = true){
  if(!db) return;
  try{
    const { data, error } = await db.from("games")
      .select("id,played_at,winner_team_index,teams")
      .gte("played_at", localDayStartIso4120())
      .not("winner_team_index","is",null)
      .order("played_at", { ascending:false })
      .limit(100);
    if(error) throw error;
    const rows = data || [];
    gameNightStats4120 = {
      completed:rows.length,
      lastWinner:rows[0]?.winner_team_index ?? null,
      lastPlayedAt:rows[0]?.played_at || null
    };
  }catch(e){ console.warn("Game-night stats unavailable", e); }
  if(render) renderGameNightDashboard4120();
}
function connectionLabel4120(){
  const queued = readOfflineAttendanceQueue4120().length;
  if(navigator.onLine === false) return { text:queued ? `Offline · ${queued} queued` : "Offline", cls:"offline" };
  if(queued) return { text:`Syncing · ${queued} queued`, cls:"offline" };
  return { text:"Online", cls:"online" };
}
function renderGameNightDashboard4120(){
  const out = document.getElementById("gameNightDashboard");
  if(!out) return;
  const present = state.players.filter(p => p.attending).length;
  const quality = state.currentGame ? balanceQuality4120(state.currentGame.teams) : null;
  const sizes = state.currentGame ? state.currentGame.teams.map(t => t.length).join(" / ") : "—";
  const nextGame = gameNightStats4120.completed + (state.currentGame && !state.resultsSavedForCurrentGame ? 1 : 0);
  const start = state.currentGameGeneratedAt ? formatGameStartTime(state.currentGameGeneratedAt) : "—";
  const last = gameNightStats4120.lastWinner === null ? "—" : `Team ${Number(gameNightStats4120.lastWinner)+1}`;
  out.innerHTML = `
    <div class="dashboard-tile"><div class="dashboard-label">Present</div><div class="dashboard-value">${present}</div></div>
    <div class="dashboard-tile"><div class="dashboard-label">Game</div><div class="dashboard-value">${nextGame || "—"}</div><div class="small">${gameNightStats4120.completed} completed</div></div>
    <div class="dashboard-tile"><div class="dashboard-label">Balance</div><div class="dashboard-value">${quality ? `${quality.score} · ${quality.label}` : "—"}</div></div>
    <div class="dashboard-tile"><div class="dashboard-label">Team sizes</div><div class="dashboard-value">${sizes}</div></div>
    <div class="dashboard-tile"><div class="dashboard-label">Started</div><div class="dashboard-value">${start}</div></div>
    <div class="dashboard-tile"><div class="dashboard-label">Last winner</div><div class="dashboard-value">${last}</div></div>`;
  const badge = document.getElementById("dashboardConnectionBadge");
  if(badge){
    const c = connectionLabel4120(); badge.textContent = c.text; badge.className = `status-pill ${c.cls}`;
  }
}

/* ---------- Team rendering + quality ---------- */
function renderTeams4120(){
  updateGameStartTime();
  const out = document.getElementById("teamsOutput");
  const resultMessage = document.getElementById("resultMessage");
  if(resultMessage) resultMessage.textContent = "";
  if(!out) return;
  if(!state.currentGame){ out.innerHTML='<div class="small">No game generated yet.</div>'; renderGameNightDashboard4120(); return; }

  const quality = balanceQuality4120(state.currentGame.teams);
  const wrap = document.createElement("div");
  wrap.className = "grid grid-3";
  state.currentGame.teams.forEach((team,idx)=>{
    const stats = teamStats(team);
    const box = document.createElement("div");
    let cls="teambox";
    if(canManageGames()) cls += " team-clickable";
    if(state.selectedWinnerIndex !== null) cls += idx===state.selectedWinnerIndex ? " team-win" : " team-loss";
    box.className=cls;
    if(canManageGames()) box.onclick=()=>selectWinner(idx);
    const meta = canManageGames() ? `<span class="small">${team.length} players · ${stats.overall.toFixed(2)}</span>` : `<span class="small">${team.length} players</span>`;
    const ratings = canManageGames() ? `<div class="small">H ${stats.handling.toFixed(1)} · C ${stats.cutting.toFixed(1)} · D ${stats.defense.toFixed(1)}</div>` : "";
    const rows = team.map(p => canManageGames()
      ? `<div class="row" style="justify-content:space-between"><span>${escapeHtml(p.fullName)}</span><span class="small">${overall(p).toFixed(2)}</span></div>`
      : `<div class="row" style="justify-content:space-between"><span>${escapeHtml(p.fullName)}</span></div>`).join("");
    box.innerHTML=`<div class="teamhead"><strong>Team ${idx+1}</strong>${meta}</div>${ratings}<div class="hr"></div>${rows}`;
    wrap.appendChild(box);
  });
  out.innerHTML=`<div class="balance-panel"><div><span class="balance-pill ${quality.className}">${quality.label} · ${quality.score}</span></div><div class="balance-details">${escapeHtml(quality.details)}</div></div>`;
  out.appendChild(wrap);
  renderGameNightDashboard4120();
}
renderTeams = renderTeams4120;
window.renderTeams = renderTeams4120;

/* ---------- Generate / reshuffle ---------- */
async function generateGame4120(sendPushNotification = false){
  if(!canGenerateTeams()){ alert("Only Teammates, Captains, and Admins can generate teams."); return; }
  await loadCloudData4120({ includeProfile:true, applyLocal:false, force:true });
  const players = presentPlayers();
  const numTeams = Math.max(2, Number(document.getElementById("numTeams")?.value || 2));
  if(players.length < numTeams){ alert("Not enough attending players for that many teams."); return; }
  const context = scoreContext4120({ previousGameTeams:previousOfficialGameForReshuffle4120 });
  let best=null;
  for(let i=0;i<120;i++){
    const candidate = optimizeTeams4120(makeInitialTeams(players,numTeams), Number(state.settings.repeatWeight || 4), context);
    if(!best || candidate.score < best.score) best=candidate;
  }
  state.currentGameGeneratedAt = new Date().toISOString();
  state.currentGame = { teams:best.teams };
  state.selectedWinnerIndex=null;
  state.resultsSavedForCurrentGame=false;
  if(isTeammate()){
    state.currentGameIsLocalTeammate41117=true;
    saveLocalTeammateGame41117();
  }else{
    state.currentGameIsLocalTeammate41117=false;
    clearLocalTeammateGame41117();
    if(typeof clearLocalTeammatePairHistory41119 === "function") clearLocalTeammatePairHistory41119();
    await saveCurrentGameToDb(false);
    if(sendPushNotification) await sendTeamGeneratedNotification();
  }
  saveSafeStartupSnapshot41121?.();
  renderAll(); updateTeamsDetailsOpenState();
  window.scrollTo({top:0,behavior:"smooth"});
}
generateGame = generateGame4120;
window.generateGame = generateGame4120;

async function generateTeamsButton4120(){
  if(!canGenerateTeams()){ alert("Only Teammates, Captains, and Admins can generate teams."); return; }
  try{
    if(isTeammate()){
      await withLoading("Generating new local teams...", async()=>{
        if(state.currentGame?.teams?.length) previousOfficialGameForReshuffle4120 = cloneTeams(state.currentGame.teams);
        recordCurrentLocalGamePairings41119?.();
        await generateGame4120(false);
      });
      return;
    }
    await withLoading("Generating teams...", async()=>{
      if(state.currentGame?.teams?.length) previousOfficialGameForReshuffle4120 = cloneTeams(state.currentGame.teams);
      if(state.currentGame && !state.resultsSavedForCurrentGame){
        const go = await confirmContinueWithoutResults();
        if(!go) return;
        await savePairingsOnlyForCurrentGame();
      }
      const sendPush = await askAdminWhetherToSendTeamNotification();
      await generateGame4120(sendPush);
    });
  }catch(e){ clearLoading(); console.error(e); alert("Generate teams failed: " + (e?.message || e)); }
}
generateTeamsButton = generateTeamsButton4120;
window.generateTeamsButton = generateTeamsButton4120;

/* ---------- Saved-result-only profile teammates ---------- */
async function savedResultTeammates4120(playerId){
  try{
    const { data, error } = await db.rpc("get_saved_result_teammates_4120", { p_player_id:playerId });
    if(!error && Array.isArray(data)) return data.map(r => ({ other:r.full_name || "Unknown", count:Number(r.games_together || 0) }));
  }catch(e){}
  const { data, error } = await db.from("games").select("teams,winner_team_index").not("winner_team_index","is",null).order("played_at",{ascending:false}).limit(600);
  if(error) return [];
  const counts = {};
  (data || []).forEach(g => {
    (g.teams || []).forEach(team => {
      const ids = team.map(x => String(x.id));
      if(!ids.includes(String(playerId))) return;
      team.forEach(member => {
        if(String(member.id) === String(playerId)) return;
        const key=String(member.id); counts[key] = { other:member.fullName || member.full_name || playerById(member.id)?.fullName || "Unknown", count:(counts[key]?.count || 0)+1 };
      });
    });
  });
  return Object.values(counts).sort((a,b)=>b.count-a.count).slice(0,10);
}

async function openMyProfileModal4120(){
  if(!currentUser){ alert("Sign in first."); return; }
  hideModal("accountModal");
  makeDynamicModal("myProfileModal","My Profile",'<div class="small">Loading your profile...</div>');
  try{
    await loadCloudData4120({ includeProfile:true, applyLocal:true, force:true });
    const me = currentUserPlayer();
    if(!me){
      makeDynamicModal("myProfileModal","My Profile",'<div class="notice">This account is not linked to a roster player. Ask an Admin to link it in Manage Accounts.</div>'); return;
    }
    const top = await savedResultTeammates4120(me.id);
    const topHtml = top.length ? top.map(r=>`<div class="history-card"><div class="row" style="justify-content:space-between"><div>${escapeHtml(r.other)}</div><strong>${r.count}</strong></div></div>`).join("") : '<div class="small">No saved-result teammate history yet.</div>';
    const pct = me.gamesPlayed ? ((me.wins/me.gamesPlayed)*100).toFixed(1)+"%" : "0.0%";
    const body=`<div class="notice">Linked roster player: ${escapeHtml(me.fullName)}</div>
      <div class="profile-stat-grid"><div class="profile-stat"><strong>${me.gamesPlayed}</strong><span class="small">Games</span></div><div class="profile-stat"><strong>${me.wins}-${me.losses}</strong><span class="small">Record</span></div><div class="profile-stat"><strong>${pct}</strong><span class="small">Win %</span></div></div>
      <div class="hr"></div><h3 style="margin:0 0 4px">Most common teammates</h3><div class="small">Saved-result games only.</div><div class="mini-table">${topHtml}</div>`;
    makeDynamicModal("myProfileModal","My Profile",body);
  }catch(e){ makeDynamicModal("myProfileModal","My Profile",`<div class="notice">My Profile could not load: ${escapeHtml(String(e?.message || e))}</div>`); }
}
openMyProfileModal = openMyProfileModal4120;
window.openMyProfileModal = openMyProfileModal4120;
window.openMyProfileModal41118 = openMyProfileModal4120;

/* ---------- Late-player smart rebalance ---------- */
const openLateAddModalLegacy4120 = openLateAddModal;
function openLateAddModal4120(){
  openLateAddModalLegacy4120();
  const modal = document.getElementById("lateAddModal");
  const toolbar = modal?.querySelector(".toolbar");
  if(toolbar && !document.getElementById("lateSmartRebalanceBtn")){
    const btn=document.createElement("button"); btn.id="lateSmartRebalanceBtn"; btn.className="btn-success"; btn.type="button"; btn.textContent="Smart Add & Rebalance"; btn.onclick=smartLateAddPlayer4120; toolbar.insertBefore(btn, toolbar.children[1] || null);
    const note=document.createElement("div"); note.className="smart-rebalance-note"; note.textContent="Smart Rebalance chooses the best team and, only when worthwhile, moves one existing player to improve balance."; toolbar.parentElement?.insertBefore(note, toolbar.nextSibling);
  }
}
openLateAddModal = openLateAddModal4120;
window.openLateAddModal = openLateAddModal4120;

function smartLateArrangement4120(teams, arrivingPlayer, context = {}){
  let best=null;
  const maxSpread=maxTeamSpread4120(teams.reduce((n,t)=>n+t.length,0)+1, teams.length);
  const assess=(candidate,moves,description)=>{
    if(teamCountSpread4120(candidate)>maxSpread) return;
    const raw=scoreTeams4120(candidate,state.settings.repeatWeight,context);
    const objective=raw + moves*38;
    if(!best || objective<best.objective) best={teams:candidate,raw,objective,moves,description};
  };
  for(let target=0;target<teams.length;target++){
    const base=cloneTeams(teams); base[target].push(arrivingPlayer); assess(base,0,`Added to Team ${target+1}`);
    for(let from=0;from<base.length;from++){
      for(let to=0;to<base.length;to++){
        if(from===to) continue;
        for(let i=0;i<base[from].length;i++){
          const mover=base[from][i];
          if(String(mover.id)===String(arrivingPlayer.id)) continue;
          const candidate=cloneTeams(base);
          const [moved]=candidate[from].splice(i,1); candidate[to].push(moved);
          assess(candidate,1,`Added to Team ${target+1}; moved ${moved.fullName} from Team ${from+1} to Team ${to+1}`);
        }
      }
    }
  }
  return best;
}
async function resolveLateAddPlayer4120(){
  const existingId=document.getElementById("lateAddExisting")?.value || "";
  if(existingId){
    const player=playerById(existingId); if(!player) throw new Error("Existing player not found.");
    const { error }=await saveAttendanceFromApp(player.id,true); if(error) throw error;
    player.attending=true; if(canManageGames()) player.active=true; return player;
  }
  const fullName=normalizeName(document.getElementById("lateAddName")?.value || "");
  if(!fullName) throw new Error("Enter a new player name or choose an existing player.");
  const {first,last}=splitName(fullName);
  const {data,error}=await db.rpc("add_player_from_app",{
    p_first_name:first,p_last_name:last,
    p_handling:Number(document.getElementById("lateAddHandling")?.value || 3),
    p_cutting:Number(document.getElementById("lateAddCutting")?.value || 3),
    p_defense:Number(document.getElementById("lateAddDefense")?.value || 3),
    p_temporary:!!document.getElementById("lateAddTemporary")?.checked,p_mark_present:true
  });
  if(error) throw error;
  await loadCloudData4120({includeProfile:true,applyLocal:false,force:true});
  const newId=data?.player_id || data?.playerId;
  return state.players.find(p=>String(p.id)===String(newId)) || state.players.find(p=>normalizeNameForMatch(p.fullName)===normalizeNameForMatch(fullName)) || (()=>{throw new Error("Player was added but could not be loaded.");})();
}
async function smartLateAddPlayer4120(){
  if(!canManageGames() || !state.currentGame) return;
  if(state.resultsSavedForCurrentGame){ alert("Results are already saved for this game."); return; }
  try{
    await withLoading("Smart rebalancing...",async()=>{
      const player=await resolveLateAddPlayer4120();
      if(currentGamePlayerIds().has(String(player.id))) throw new Error("That player is already in the current game.");
      const best=smartLateArrangement4120(state.currentGame.teams,player,scoreContext4120());
      if(!best) throw new Error("No valid rebalance was found.");
      state.currentGame={teams:best.teams}; state.resultsSavedForCurrentGame=false;
      await saveCurrentGameToDb(false); saveSafeStartupSnapshot41121?.(); renderAll(); hideModal("lateAddModal");
      const q=balanceQuality4120(best.teams); alert(`${best.description}. Balance: ${q.label} (${q.score}).`);
    });
  }catch(e){ clearLoading(); alert(e?.message || e); }
}
window.smartLateAddPlayer4120=smartLateAddPlayer4120;

/* ---------- Test sandbox ---------- */
function clonePlayerForSandbox4120(p){ return {...p}; }
function makeSandboxFromLive4120(){
  return {
    players:state.players.map(clonePlayerForSandbox4120),
    pairRules:deepClone4120(state.pairRules),
    history:deepClone4120(state.history),
    settings:deepClone4120({...state.settings,reshuffleMode:activeReshuffleMode4120()}),
    currentGame:state.currentGame ? {teams:state.currentGame.teams.map(t=>t.map(clonePlayerForSandbox4120))} : null,
    generatedAt:state.currentGameGeneratedAt || null,
    selectedWinnerIndex:null,
    completed:0,
    previousGameTeams:null
  };
}
function sandboxPlayerById4120(id){ return sandboxState4120?.players.find(p=>String(p.id)===String(id)); }
function sandboxPresent4120(){ return (sandboxState4120?.players || []).filter(p=>p.attending); }
function sandboxContext4120(){
  const local={};
  return scoreContext4120({ settings:sandboxState4120.settings,pairRules:sandboxState4120.pairRules,history:sandboxState4120.history,localPairCounts:local,previousGameTeams:sandboxState4120.previousGameTeams,reshuffleMode:sandboxState4120.settings.reshuffleMode,sandbox:true });
}
function resetSandboxControls4120(){
  const num=document.getElementById("sandboxNumTeams"); if(num) delete num.dataset.bound;
  const mode=document.getElementById("sandboxReshuffleMode"); if(mode) delete mode.dataset.bound;
}
function openTestSandbox4120(){
  if(!canManageGames()){ alert("Captain/admin only."); return; }
  sandboxState4120=makeSandboxFromLive4120(); resetSandboxControls4120();
  document.getElementById("mainPage").style.display="none";
  document.getElementById("dataPage").style.display="none";
  document.getElementById("sandboxPage").style.display="block";
  document.getElementById("stickybar").style.display="none";
  renderSandbox4120(); window.scrollTo({top:0,behavior:"smooth"});
}
function closeTestSandbox4120(){ document.getElementById("sandboxPage").style.display="none"; showPage("data"); }
function resetSandboxFromLive4120(){ sandboxState4120=makeSandboxFromLive4120(); resetSandboxControls4120(); renderSandbox4120(); }
function sandboxSetSelectPlayers4120(id,players){
  const el=document.getElementById(id); if(!el) return; const cur=el.value;
  el.innerHTML='<option value="">Select...</option>'+players.map(p=>`<option value="${escapeHtml(String(p.id))}">${escapeHtml(p.fullName)}</option>`).join("");
  if(players.some(p=>String(p.id)===String(cur))) el.value=cur;
}
function renderSandbox4120(){
  if(!sandboxState4120) return;
  const search=(document.getElementById("sandboxPlayerSearch")?.value || "").trim().toLowerCase();
  const list=document.getElementById("sandboxPlayerList");
  const players=sandboxState4120.players.filter(p=>!search || p.fullName.toLowerCase().includes(search)).sort(comparePlayersByLastName);
  if(list) list.innerHTML=players.map(p=>`<div class="player clickable ${p.attending?'attend-on':''}" onclick="sandboxToggleAttendance4120('${p.id}')"><div><div class="player-name">${escapeHtml(p.fullName)}</div><div class="small">${p.attending?'Present':'Not present'} · Overall ${overall(p).toFixed(2)}</div></div></div>`).join("");
  const count=document.getElementById("sandboxPresentCount"); if(count) count.textContent=`${sandboxPresent4120().length} present`;
  const num=document.getElementById("sandboxNumTeams"); if(num && !num.dataset.bound){ num.value=Math.max(2,state.currentGame?.teams?.length || 3); num.dataset.bound="1"; }
  const mode=document.getElementById("sandboxReshuffleMode"); if(mode && !mode.dataset.bound){ mode.value=sandboxState4120.settings.reshuffleMode || "normal"; mode.dataset.bound="1"; mode.onchange=()=>{sandboxState4120.settings.reshuffleMode=mode.value;}; }
  const present=sandboxPresent4120(); sandboxSetSelectPlayers4120("sandboxPairP1",present); sandboxSetSelectPlayers4120("sandboxPairP2",present);
  const absent=sandboxState4120.players.filter(p=>!sandboxState4120.currentGame?.teams?.some(t=>t.some(x=>String(x.id)===String(p.id)))); sandboxSetSelectPlayers4120("sandboxLatePlayer",absent);
  renderSandboxPairRules4120(); renderSandboxTeams4120(); renderSandboxDashboard4120();
}
function sandboxToggleAttendance4120(id){ const p=sandboxPlayerById4120(id); if(!p)return; p.attending=!p.attending; renderSandbox4120(); }
function sandboxAddPairRule4120(){
  const p1=document.getElementById("sandboxPairP1")?.value,p2=document.getElementById("sandboxPairP2")?.value;
  if(!p1||!p2||p1===p2){alert("Choose two different players.");return;}
  sandboxState4120.pairRules.push({id:`sandbox-${Date.now()}`,player1Id:p1,player2Id:p2,type:document.getElementById("sandboxPairType")?.value || "apart",strength:Number(document.getElementById("sandboxPairStrength")?.value || 1)}); renderSandbox4120();
}
function sandboxClearPairRules4120(){ sandboxState4120.pairRules=[]; renderSandbox4120(); }
function sandboxRemovePairRule4120(id){ sandboxState4120.pairRules=sandboxState4120.pairRules.filter(r=>r.id!==id); renderSandbox4120(); }
function renderSandboxPairRules4120(){ const out=document.getElementById("sandboxPairRuleList"); if(!out)return; out.innerHTML=sandboxState4120.pairRules.length?sandboxState4120.pairRules.map(r=>`<div class="player"><div><div class="player-name">${escapeHtml(sandboxPlayerById4120(r.player1Id)?.fullName || 'Unknown')} ${r.type==='apart'?'apart from':'with'} ${escapeHtml(sandboxPlayerById4120(r.player2Id)?.fullName || 'Unknown')}</div><div class="small">Strength ${Number(r.strength||1).toFixed(1)}</div></div><button class="btn-danger" style="width:auto" onclick="event.stopPropagation();sandboxRemovePairRule4120('${r.id}')">Remove</button></div>`).join(""):'<div class="small">No test Pair Rules.</div>'; }
function sandboxGenerate4120(){
  if(!sandboxState4120) return; const players=sandboxPresent4120(); const n=Math.max(2,Number(document.getElementById("sandboxNumTeams")?.value || 2));
  if(players.length<n){alert("Not enough test players present.");return;}
  sandboxState4120.previousGameTeams=sandboxState4120.currentGame?.teams ? cloneTeams(sandboxState4120.currentGame.teams) : null;
  let best=null; const ctx=sandboxContext4120();
  for(let i=0;i<100;i++){ const cand=optimizeTeams4120(makeInitialTeams(players,n),sandboxState4120.settings.repeatWeight,ctx); if(!best||cand.score<best.score)best=cand; }
  sandboxState4120.currentGame={teams:best.teams}; sandboxState4120.generatedAt=new Date().toISOString(); sandboxState4120.selectedWinnerIndex=null; renderSandbox4120();
}
function sandboxSelectWinner4120(idx){ sandboxState4120.selectedWinnerIndex=idx; renderSandboxTeams4120(); }
function sandboxSimulateSaveResult4120(){
  if(!sandboxState4120?.currentGame){alert("Generate test teams first.");return;}
  if(sandboxState4120.selectedWinnerIndex===null){alert("Tap the winning test team first.");return;}
  const teams=sandboxState4120.currentGame.teams;
  const winner=Number(sandboxState4120.selectedWinnerIndex);
  const strengths=teams.map(team=>teamStats(team).overall);
  const loserCount=Math.max(1,teams.length-1);
  const k=Number(sandboxState4120.settings.kFactor || .08);
  const deltas=teams.map((_,idx)=>{
    if(idx===winner){
      return strengths.reduce((sum,oppStrength,oppIdx)=>oppIdx===winner?sum:sum+(k/loserCount)*(1-expectedWinProb(strengths[winner],oppStrength)),0);
    }
    return (k/loserCount)*(0-expectedWinProb(strengths[idx],strengths[winner]));
  });
  teams.forEach((team,teamIdx)=>team.forEach(p=>{
    const local=sandboxPlayerById4120(p.id);
    if(!local)return;
    local.winLossRating=Number(local.winLossRating||0)+Number(deltas[teamIdx]||0);
    local.gamesPlayed=Number(local.gamesPlayed||0)+1;
    if(teamIdx===winner)local.wins=Number(local.wins||0)+1;
    else local.losses=Number(local.losses||0)+1;
  }));
  teams.forEach(team=>{for(let i=0;i<team.length;i++)for(let j=i+1;j<team.length;j++){const pair=pairKey(team[i].id,team[j].id);sandboxState4120.history[pair]=(sandboxState4120.history[pair]||0)+1;}});
  sandboxState4120.completed++;
  sandboxState4120.previousGameTeams=cloneTeams(teams);
  sandboxState4120.currentGame=null; sandboxState4120.selectedWinnerIndex=null; sandboxState4120.generatedAt=null;
  renderSandbox4120();
}
function sandboxLateSmartRebalance4120(){
  const id=document.getElementById("sandboxLatePlayer")?.value; if(!id){alert("Choose a late player.");return;} if(!sandboxState4120.currentGame){alert("Generate a test game first.");return;}
  const player=sandboxPlayerById4120(id); player.attending=true; const best=smartLateArrangement4120(sandboxState4120.currentGame.teams,player,sandboxContext4120()); if(!best){alert("No valid rebalance.");return;} sandboxState4120.currentGame={teams:best.teams}; renderSandbox4120(); const q=balanceQuality4120(best.teams); alert(`${best.description}. Test balance: ${q.label} (${q.score}).`);
}
function renderSandboxTeams4120(){
  const out=document.getElementById("sandboxTeamsOutput"); if(!out)return;
  if(!sandboxState4120?.currentGame){out.innerHTML='<div class="small">No test game generated yet.</div>';return;}
  const q=balanceQuality4120(sandboxState4120.currentGame.teams);
  out.innerHTML=`<div class="balance-panel"><span class="balance-pill ${q.className}">${q.label} · ${q.score}</span><div class="balance-details">${escapeHtml(q.details)}</div></div><div class="grid grid-3">${sandboxState4120.currentGame.teams.map((team,idx)=>`<div class="teambox team-clickable ${sandboxState4120.selectedWinnerIndex===idx?'team-win':sandboxState4120.selectedWinnerIndex!==null?'team-loss':''}" onclick="sandboxSelectWinner4120(${idx})"><div class="teamhead"><strong>Team ${idx+1}</strong><span class="small">${team.length} · ${teamStats(team).overall.toFixed(2)}</span></div><div class="hr"></div>${team.map(p=>`<div>${escapeHtml(p.fullName)}</div>`).join("")}</div>`).join("")}</div>`;
}
function renderSandboxDashboard4120(){ const out=document.getElementById("sandboxDashboard");if(!out)return;const q=sandboxState4120.currentGame?balanceQuality4120(sandboxState4120.currentGame.teams):null;out.innerHTML=`<div class="dashboard-tile"><div class="dashboard-label">Present</div><div class="dashboard-value">${sandboxPresent4120().length}</div></div><div class="dashboard-tile"><div class="dashboard-label">Test games</div><div class="dashboard-value">${sandboxState4120.completed}</div></div><div class="dashboard-tile"><div class="dashboard-label">Balance</div><div class="dashboard-value">${q?`${q.score} · ${q.label}`:'—'}</div></div><div class="dashboard-tile"><div class="dashboard-label">Database writes</div><div class="dashboard-value">0</div></div>`; }
Object.assign(window,{openTestSandbox4120,closeTestSandbox4120,resetSandboxFromLive4120,renderSandbox4120,sandboxToggleAttendance4120,sandboxAddPairRule4120,sandboxClearPairRules4120,sandboxRemovePairRule4120,sandboxGenerate4120,sandboxSelectWinner4120,sandboxSimulateSaveResult4120,sandboxLateSmartRebalance4120});

/* Keep dashboard totals current immediately after an official result save. */
const saveResultsLegacy4120 = saveResults;
saveResults = async function(){
  const result = await saveResultsLegacy4120();
  await refreshGameNightStats4120();
  renderGameNightDashboard4120();
  return result;
};
window.saveResults = saveResults;

/* ---------- Canonical render / page integration ---------- */
const renderAllLegacy4120 = renderAll;
function renderAll4120(){ renderAllLegacy4120(); renderGameNightDashboard4120(); if(document.getElementById("sandboxPage")?.style.display !== "none" && sandboxState4120) renderSandbox4120(); }
renderAll = renderAll4120;
window.renderAll = renderAll4120;

const showPageLegacy4120 = showPage;
function showPage4120(page){
  const sandbox=document.getElementById("sandboxPage"); if(sandbox) sandbox.style.display="none";
  showPageLegacy4120(page);
  if(page !== "main") document.getElementById("stickybar")?.style.removeProperty("display");
}
showPage = showPage4120;
window.showPage = showPage4120;

/* ---------- Auth/init ---------- */
async function afterAuthChange4120(){
  state.showInactive=false;
  const restored=restoreSafeStartupSnapshot41121?.() || false;
  updateAuthButtons(); if(restored){applyOfflineAttendanceQueueToState4120();renderAll4120();showPage4120("main");}
  try{await loadCloudData4120({includeProfile:true,applyLocal:true,force:true});}
  catch(e){console.error("Initial load failed",e);if(!restored)setAuthMessage("Could not load app data. Check your connection and try again.");}
  updateAuthButtons(); applyOfflineAttendanceQueueToState4120(); renderAll4120(); showPage4120("main");
  idle41121?.(()=>{subscribeToLiveDataUpdates();if(currentUser)subscribeToProfileUpdates41121();else unsubscribeFromProfileUpdates();installLightweightProfileRefresh41121?.();handleRoleMilestones();refreshGameNightStats4120();flushOfflineAttendanceQueue4120();},900);
}
afterAuthChange = afterAuthChange4120;
window.afterAuthChange = afterAuthChange4120;

async function init4120(){
  hideSignInBox(); hideAllModals(); state.showInactive=false;
  if(!SUPABASE_URL || !SUPABASE_KEY || SUPABASE_KEY.includes("PASTE_")){setAuthMessage("Config missing. Open config.js and paste your Supabase publishable/anon key.");renderAll4120();showPage4120("main");return;}
  db=supabase.createClient(SUPABASE_URL,SUPABASE_KEY); listenForAuthConfirmedFromOtherTab();
  const hasAuthRedirect=new URLSearchParams(location.search).has("code") || /(?:^|[&#])(access_token|refresh_token|type)=/.test(location.hash || ""); if(hasAuthRedirect)await completeAuthRedirectIfNeeded();
  const {data}=await db.auth.getSession(); currentUser=data?.session?.user || null;
  db.auth.onAuthStateChange(async(event,session)=>{if(event==="INITIAL_SESSION")return;currentUser=session?.user || null;await afterAuthChange4120();});
  await afterAuthChange4120();
}

try{ document.removeEventListener("DOMContentLoaded", init41121); }catch(e){}
try{ document.removeEventListener("DOMContentLoaded", init); }catch(e){}
init = init4120;
document.addEventListener("DOMContentLoaded", init4120);

window.addEventListener("online",()=>{flushOfflineAttendanceQueue4120();renderGameNightDashboard4120();});
window.addEventListener("offline",()=>renderGameNightDashboard4120());

Object.assign(window,{
  REFACTOR_VERSION_4120,scoreBreakdown4120,balanceQuality4120,optimizeTeams4120,
  loadCloudData4120,saveSettings4120,toggleAttendance4120,flushOfflineAttendanceQueue4120,
  refreshGameNightStats4120,renderGameNightDashboard4120,generateGame4120,generateTeamsButton4120,
  openMyProfileModal4120,smartLateAddPlayer4120,afterAuthChange4120,init4120
});


/* ============================================================
   4.12.1 — reliable Sandbox launcher
   ============================================================ */

function openTestSandbox4121(){
  try{
    const main = document.getElementById("mainPage");
    const data = document.getElementById("dataPage");
    const sandbox = document.getElementById("sandboxPage");
    const sticky = document.getElementById("stickybar");

    if(!sandbox) throw new Error("Sandbox page is missing from the document.");

    // Sandbox is local-only; do not block opening because of a stale role helper.
    // Visibility of the launcher remains controlled by the Captain/Admin UI classes.
    sandboxState4120 = makeSandboxFromLive4120();
    resetSandboxControls4120();

    if(main) main.style.display = "none";
    if(data) data.style.display = "none";
    sandbox.style.display = "block";
    if(sticky) sticky.style.display = "none";

    renderSandbox4120();
    window.scrollTo({top:0,behavior:"smooth"});
  }catch(e){
    console.error("Could not open Test Sandbox", e);
    alert("Could not open Test Sandbox: " + (e?.message || e));
  }
}

function installSandboxLauncher4121(){
  const button = document.getElementById("openSandboxBtn");
  if(!button || button.dataset.bound4121 === "1") return;

  button.dataset.bound4121 = "1";
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    openTestSandbox4121();
  });
}

// Keep old callers working too.
openTestSandbox4120 = openTestSandbox4121;
window.openTestSandbox4120 = openTestSandbox4121;
window.openTestSandbox4121 = openTestSandbox4121;

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", installSandboxLauncher4121);
}else{
  installSandboxLauncher4121();
}


/* ============================================================
   4.12.2 — definitive Sandbox navigation
   ============================================================ */

function cloneForSandbox4122(value){
  if(value == null) return value;
  if(typeof structuredClone === "function"){
    try{ return structuredClone(value); }catch(e){}
  }
  return JSON.parse(JSON.stringify(value));
}

function buildSandboxState4122(){
  const players = Array.isArray(state?.players)
    ? state.players.map(p => ({...p}))
    : [];

  const liveTeams = state?.currentGame?.teams;
  const currentGame = Array.isArray(liveTeams)
    ? { teams: liveTeams.map(team => team.map(p => ({...p}))) }
    : null;

  let reshuffleMode = "normal";
  try{
    reshuffleMode = activeReshuffleMode4120?.() || "normal";
  }catch(e){
    reshuffleMode = state?.settings?.reshuffleMode || "normal";
  }

  return {
    players,
    pairRules: cloneForSandbox4122(state?.pairRules || []),
    history: cloneForSandbox4122(state?.history || {}),
    settings: cloneForSandbox4122({
      ...(state?.settings || {}),
      reshuffleMode
    }),
    currentGame,
    generatedAt: state?.currentGameGeneratedAt || null,
    selectedWinnerIndex: null,
    completed: 0,
    previousGameTeams: null
  };
}

function setSandboxVisible4122(visible){
  const main = document.getElementById("mainPage");
  const data = document.getElementById("dataPage");
  const sandbox = document.getElementById("sandboxPage");
  const sticky = document.getElementById("stickybar");
  const mainTab = document.getElementById("mainTabBtn");
  const dataTab = document.getElementById("dataTabBtn");

  if(!sandbox) throw new Error("Sandbox page element was not found.");

  if(visible){
    if(main) main.style.setProperty("display","none","important");
    if(data) data.style.setProperty("display","none","important");
    sandbox.style.setProperty("display","block","important");
    sandbox.removeAttribute("hidden");
    if(sticky) sticky.style.setProperty("display","none","important");
    mainTab?.classList.remove("tab-active");
    dataTab?.classList.add("tab-active");
    document.body.classList.add("sandbox-open");
  }else{
    sandbox.style.setProperty("display","none","important");
    document.body.classList.remove("sandbox-open");
    if(data) data.style.setProperty("display","block","important");
    if(main) main.style.setProperty("display","none","important");
    if(sticky) sticky.style.removeProperty("display");
    mainTab?.classList.remove("tab-active");
    dataTab?.classList.add("tab-active");
  }
}

function showSandboxError4122(error){
  const dashboard = document.getElementById("sandboxDashboard");
  const teams = document.getElementById("sandboxTeamsOutput");
  const message = escapeHtml?.(error?.message || String(error)) || String(error);

  if(dashboard){
    dashboard.innerHTML =
      '<div class="dashboard-tile dashboard-tile-wide">' +
      '<div class="dashboard-label">Sandbox status</div>' +
      '<div class="dashboard-value">Opened</div>' +
      '<div class="small" style="margin-top:6px">A test-data render error occurred. The live database was not changed.</div>' +
      '</div>';
  }
  if(teams){
    teams.innerHTML = `<div class="notice">Sandbox opened, but test data could not render: ${message}</div>`;
  }
}

function openTestSandbox4122(event){
  event?.preventDefault?.();
  event?.stopPropagation?.();

  try{
    // Make the navigation happen FIRST. This prevents any later rendering
    // problem from making the button appear dead.
    setSandboxVisible4122(true);
    window.scrollTo({top:0,behavior:"auto"});

    try{
      sandboxState4120 = buildSandboxState4122();
      resetSandboxControls4120?.();
      renderSandbox4120?.();
    }catch(renderError){
      console.error("Sandbox render failed after opening", renderError);
      showSandboxError4122(renderError);
    }
  }catch(e){
    console.error("Could not open Test Sandbox", e);
    alert("Could not open Test Sandbox: " + (e?.message || e));
  }

  return false;
}

function closeTestSandbox4122(event){
  event?.preventDefault?.();
  try{
    setSandboxVisible4122(false);
    renderAll?.();
    window.scrollTo({top:0,behavior:"auto"});
  }catch(e){
    console.error("Could not close Test Sandbox",e);
    showPage?.("data");
  }
  return false;
}

function installSandboxLauncher4122(){
  const button = document.getElementById("openSandboxBtn");
  if(button){
    button.type = "button";
    button.onclick = openTestSandbox4122;
    button.dataset.sandboxBound = "4122";
  }

  if(window.__sandboxDelegated4122) return;
  window.__sandboxDelegated4122 = true;

  document.addEventListener("click", event => {
    const target = event.target instanceof Element
      ? event.target.closest("#openSandboxBtn,[data-open-sandbox]")
      : null;
    if(!target) return;
    event.preventDefault();
    event.stopPropagation();
    openTestSandbox4122(event);
  }, true);
}

openTestSandbox4120 = openTestSandbox4122;
closeTestSandbox4120 = closeTestSandbox4122;

Object.assign(window,{
  openTestSandbox4120:openTestSandbox4122,
  openTestSandbox4121:openTestSandbox4122,
  openTestSandbox4122,
  closeTestSandbox4120:closeTestSandbox4122,
  closeTestSandbox4122,
  installSandboxLauncher4122
});

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded",installSandboxLauncher4122);
}else{
  installSandboxLauncher4122();
}
