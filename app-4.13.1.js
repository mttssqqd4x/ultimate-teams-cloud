/* Ultimate Teams 4.12.0 — canonical refactor layer
   Historical compatibility lives in legacy-core.js.
   New active behavior belongs here. */

const REFACTOR_VERSION_4120 = APP_VERSION;
const OFFLINE_ATTENDANCE_KEY_4120 = "ultimateTeamsOfflineAttendance4120";
function offlineAttendanceKey4120(){ return `${OFFLINE_ATTENDANCE_KEY_4120}:${currentUser?.id || "guest"}`; }
const SANDBOX_STORAGE_KEY_4120 = "ultimateTeamsSandbox4120";

let cloudLoadPromise4120 = null;
let gameNightStats4120 = { completed:0, lastWinner:null, lastPlayedAt:null, lastWinnerPlayers:[] };
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
    const latest = rows[0] || null;
    const winnerIndex = latest?.winner_team_index ?? null;
    const winnerTeam = winnerIndex === null || winnerIndex === undefined
      ? []
      : (Array.isArray(latest?.teams?.[Number(winnerIndex)]) ? latest.teams[Number(winnerIndex)] : []);
    const winnerNames = winnerTeam.map(item => {
      if(typeof playerDisplayNameFromTeamsPlayer === "function") return playerDisplayNameFromTeamsPlayer(item);
      if(item && typeof item === "object") return item.fullName || item.full_name || String(item.id || item.player_id || "Unknown");
      const matched = state.players.find(p => String(p.id) === String(item));
      return matched?.fullName || String(item || "Unknown");
    }).filter(Boolean);
    gameNightStats4120 = {
      completed:rows.length,
      lastWinner:winnerIndex,
      lastPlayedAt:latest?.played_at || null,
      lastWinnerPlayers:winnerNames
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
    <button class="dashboard-tile dashboard-action dashboard-balance ${quality?.className || "balance-empty"}" type="button" onclick="openBalanceDetails4128()" aria-label="Open balance rating details"><div class="dashboard-label">Balance</div><div class="dashboard-value">${quality ? `${quality.score} · ${quality.label}` : "—"}</div></button>
    <div class="dashboard-tile"><div class="dashboard-label">Team sizes</div><div class="dashboard-value">${sizes}</div></div>
    <div class="dashboard-tile"><div class="dashboard-label">Started</div><div class="dashboard-value">${start}</div></div>
    <button class="dashboard-tile dashboard-action dashboard-last-winner" type="button" onclick="openLastWinnerDetails4128()" aria-label="Show players on the last winning team"><div class="dashboard-label">Last winner</div><div class="dashboard-value">${last}</div></button>`;
  const badge = document.getElementById("dashboardConnectionBadge");
  if(badge){
    const c = connectionLabel4120(); badge.textContent = c.text; badge.className = `status-pill ${c.cls}`;
  }
}


function openBalanceDetails4128(){
  const teams = state.currentGame?.teams || [];
  if(!teams.length){
    makeDynamicModal("balanceDetailsModal", "Balance Rating", '<div class="small">Generate teams to see the balance rating and its details.</div>');
    return;
  }
  const quality = balanceQuality4120(teams);
  const teamSizes = teams.map((team,idx) => `<div class="history-card"><div class="row" style="justify-content:space-between;align-items:center"><strong>Team ${idx+1}</strong><span class="small">${team.length} player${team.length===1?"":"s"}</span></div></div>`).join("");
  const conflicts = Number(quality.ruleViolations || 0);
  const body = `
    <div class="balance-detail-hero ${quality.className}">
      <div class="dashboard-label">Current balance</div>
      <div class="balance-detail-score">${quality.score}</div>
      <strong>${escapeHtml(quality.label)}</strong>
    </div>
    <div class="balance-detail-grid">
      <div class="history-card"><div class="small">Strength gap</div><strong>${Number(quality.overallGap || 0).toFixed(2)} · ${Number(quality.overallPct || 0).toFixed(1)}%</strong></div>
      <div class="history-card"><div class="small">Team-size spread</div><strong>${Number(quality.sizeSpread || 0)}</strong></div>
      <div class="history-card"><div class="small">Pair-rule conflicts</div><strong>${conflicts}</strong></div>
    </div>
    <div class="small balance-explainer">Score bands: Excellent 90–100 · Good 80–89 · Fair 65–79 · Needs work below 65.</div>
    <div class="hr"></div>
    <div class="dashboard-label" style="margin-bottom:8px">Team sizes</div>
    <div class="mini-table">${teamSizes}</div>`;
  makeDynamicModal("balanceDetailsModal", "Balance Rating", body);
}

function openLastWinnerDetails4128(){
  const winner = gameNightStats4120.lastWinner;
  if(winner === null || winner === undefined){
    makeDynamicModal("lastWinnerDetailsModal", "Last Winner", '<div class="small">No saved winner yet tonight.</div>');
    return;
  }
  const names = Array.isArray(gameNightStats4120.lastWinnerPlayers) ? gameNightStats4120.lastWinnerPlayers : [];
  const players = names.length
    ? names.map(name => `<div class="history-card"><div class="player-name">${escapeHtml(name)}</div></div>`).join("")
    : '<div class="small">The winning team was saved, but its player list is unavailable.</div>';
  const played = gameNightStats4120.lastPlayedAt && typeof formatDateTime === "function" ? formatDateTime(gameNightStats4120.lastPlayedAt) : "";
  const body = `
    <div class="winner-detail-heading"><div><div class="dashboard-label">Winning team</div><div class="dashboard-value">Team ${Number(winner)+1}</div></div>${played ? `<div class="small">${escapeHtml(played)}</div>` : ""}</div>
    <div class="hr"></div>
    <div class="mini-table">${players}</div>`;
  makeDynamicModal("lastWinnerDetailsModal", "Last Winner", body);
}
window.openBalanceDetails4128 = openBalanceDetails4128;
window.openLastWinnerDetails4128 = openLastWinnerDetails4128;

/* ---------- Team rendering + quality ---------- */
function renderTeams4120(){
  updateGameStartTime();
  const out = document.getElementById("teamsOutput");
  const resultMessage = document.getElementById("resultMessage");
  if(resultMessage) resultMessage.textContent = "";
  if(!out) return;
  if(!state.currentGame){ out.innerHTML='<div class="small">No game generated yet.</div>'; renderGameNightDashboard4120(); return; }

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
  out.innerHTML="";
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
function renderAll4120(){ renderAllLegacy4120(); renderGameNightDashboard4120(); }
renderAll = renderAll4120;
window.renderAll = renderAll4120;

const showPageLegacy4120 = showPage;
function showPage4120(page){
  if(document.body.classList.contains("sandbox-open")) return;
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


