/* Ultimate Teams 4.12.0 — canonical refactor layer
   Historical compatibility lives in legacy-core.js.
   New active behavior belongs here. */

const REFACTOR_VERSION_4120 = APP_VERSION;
const OFFLINE_ATTENDANCE_KEY_4120 = "ultimateTeamsOfflineAttendance4120";
function offlineAttendanceKey4120(){ return `${OFFLINE_ATTENDANCE_KEY_4120}:${currentUser?.id || "guest"}`; }
const SANDBOX_STORAGE_KEY_4120 = "ultimateTeamsSandbox4120";

let cloudLoadPromise4120 = null;
let cloudRequest4145 = 0;
let cloudApplied4145 = 0;
let gameNightStats4120 = { completed:0, lastWinner:null, lastPlayedAt:null, lastWinnerPlayers:[] };
let previousOfficialGameForReshuffle4120 = null;
let offlineFlushRunning4120 = false;
let sandboxState4120 = null;
let authRun4156 = 0;
let authEventTimer4156 = null;
let cloudLoadedAt4156 = 0;
let bootstrapRpcAvailable4156 = true;
let generationRunning4156 = false;
let startupRestored4156 = false;
let attendanceDay4148 = localDayStartIso4120();

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
    playerMetrics:overrides.playerMetrics || null,
    previousPairs:overrides.previousPairs || null,
    sandbox: !!overrides.sandbox
  };
}

function scoreBreakdown4120(teams, overrides = {}){
  const ctx = scoreContext4120(overrides);
  const s = ctx.settings;
  const stats = ctx.playerMetrics ? teams.map(team=>team.reduce((sum,p)=>{
    const value = ctx.playerMetrics.get(String(p.id)) || teamStats([p]);
    sum.count++;sum.overall+=value.overall;sum.handling+=value.handling;
    sum.cutting+=value.cutting;sum.defense+=value.defense;
    return sum;
  },{count:0,overall:0,handling:0,cutting:0,defense:0})) : teams.map(teamStats);
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
    const topOveralls = teams.map(team => team.length ? Math.max(...team.map(p => ctx.playerMetrics?.get(String(p.id))?.overall ?? overall(p))) : 0);
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
    const previousPairs = ctx.previousPairs || teamPairSet4120(ctx.previousGameTeams);
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
function* optimizationSteps4156(initial, repeatWeight = state.settings.repeatWeight, context = {}){
  let evaluations = 0;
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
            if(++evaluations % 64 === 0) yield;
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
            if(++evaluations % 64 === 0) yield;
          if(candidateScore < bestScore - 0.000001){
            best = candidate; bestScore = candidateScore; improved = true;
          }
        }
      }
    }
  }
  return { teams:best, score:bestScore };
}
function optimizeTeams4120(initial, repeatWeight = state.settings.repeatWeight, context = {}){
  const steps = optimizationSteps4156(initial, repeatWeight, context);
  let result;
  do{ result = steps.next(); }while(!result.done);
  return result.value;
}
async function optimizeTeamsResponsive4156(initial, repeatWeight, context){
  const steps = optimizationSteps4156(initial, repeatWeight, context);
  let frameStarted = performance.now();
  while(true){
    const result = steps.next();
    if(result.done) return result.value;
    if(performance.now() - frameStarted >= 8){
      await new Promise(resolve => setTimeout(resolve, 0));
      frameStarted = performance.now();
    }
  }
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

/* ---------- Pre-results dashboard balance ---------- */
const BALANCE_STORAGE_KEY_4147 = 'ultimateTeamsPreResultsBalance';
let balanceDataReady4147 = false;
function balanceGameKey4147(){
  if(!state.currentGame?.teams?.length) return null;
  // Team order matters; member display order does not. A new game with the
  // same teammates has a new timestamp and must receive a new snapshot.
  const parsedTime = Date.parse(state.currentGameGeneratedAt);
  const generatedAt = Number.isFinite(parsedTime) ? parsedTime : (state.currentGameGeneratedAt || '');
  return JSON.stringify([generatedAt,
    state.currentGame.teams.map(team => team.map(p => String(p.id)).sort())]);
}
function validBalanceSnapshot4147(snapshot, key){
  if(snapshot?.key !== key || snapshot?.version !== 1) return null;
  const q = snapshot.quality;
  if(!q || !['score','overallGap','overallPct','sizeSpread','ruleViolations'].every(k => Number.isFinite(q[k]) && q[k] >= 0) || q.score > 100) return null;
  const score = q.score;
  const label = score >= 90 ? 'Excellent' : score >= 80 ? 'Good' : score >= 65 ? 'Fair' : 'Needs work';
  const className = score >= 90 ? 'balance-excellent' : score >= 80 ? 'balance-good' : score >= 65 ? 'balance-fair' : 'balance-poor';
  // Stored data supplies numbers only; display labels/classes are app-owned.
  return {version:1,key,quality:{score,label,className,overallGap:q.overallGap,
    overallPct:q.overallPct,sizeSpread:q.sizeSpread,ruleViolations:q.ruleViolations}};
}
function dashboardBalanceSnapshot4147(){
  const key = balanceGameKey4147();
  if(!key) return null;
  const game = state.currentGame;
  let snapshot = null;
  if(balanceDataReady4147 && !state.resultsSavedForCurrentGame){
    // Keep the preview current while the game is open; freeze it at results.
    snapshot = validBalanceSnapshot4147({version:1,key,quality:balanceQuality4120(game.teams)}, key);
  }else{
    // The local record may be newer than the JSON captured when teams were
    // generated (for example, an injury edit just before saving).
    try{snapshot = validBalanceSnapshot4147(JSON.parse(localStorage.getItem(BALANCE_STORAGE_KEY_4147) || 'null'), key);}catch(e){}
    if(!snapshot) snapshot = validBalanceSnapshot4147(game.balanceBeforeResults, key);
  }
  if(snapshot){
    game.balanceBeforeResults = snapshot;
    try{
      const value = JSON.stringify(snapshot);
      if(localStorage.getItem(BALANCE_STORAGE_KEY_4147) !== value) localStorage.setItem(BALANCE_STORAGE_KEY_4147,value);
    }catch(e){}
  }
  return snapshot;
}
const hydrateGameBefore4147 = hydrateGame;
hydrateGame = function(rawTeams){
  const game = hydrateGameBefore4147(rawTeams);
  const snapshot = rawTeams?.flat().find(p => p && typeof p === 'object' && p._balanceBeforeResults)?._balanceBeforeResults;
  if(game && snapshot) game.balanceBeforeResults = snapshot;
  return game;
};
window.hydrateGame = hydrateGame;
const serializableTeamsBefore4147 = serializableTeams;
serializableTeams = function(){
  const teams = serializableTeamsBefore4147();
  const first = teams.flat()[0];
  const snapshot = dashboardBalanceSnapshot4147();
  // Existing JSON teams storage retains this without a database migration.
  if(first && snapshot) first._balanceBeforeResults = snapshot;
  return teams;
};
window.serializableTeams = serializableTeams;

/* ---------- Settings / reshuffle mode ---------- */
function syncSettingsForm4120(){
  if(document.activeElement?.closest("#dataAdminLoadEdit")) return;
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
  const controller = new AbortController();
  const bounded = query => typeof query.abortSignal === 'function' ? query.abortSignal(controller.signal) : query;
  let timer;
  const request = (async()=>{
    const [bootstrap, attendance] = await Promise.all([
      bootstrapRpcAvailable4156 ? bounded(db.rpc("get_app_bootstrap_4120")) : {data:null},
      bounded(db.from("attendance").select("player_id,present,updated_at"))
    ]);
    if(attendance.error) throw attendance.error;
    if(bootstrap.error?.code === 'PGRST202') bootstrapRpcAvailable4156 = false;
    const usedRpc = !bootstrap.error && !!bootstrap.data;
    const payload = usedRpc ? bootstrap.data : await fallbackBootstrap41121(includeProfile,attendance);
    payload.attendance = attendance.data || [];
    payload.settings = payload.settings || {};
    return {payload,usedRpc};
  })();
  const timeout = new Promise((_,reject)=>{
    timer=setTimeout(()=>{controller.abort();reject(new Error('Connection timed out. Try again.'));},10000);
  });
  try{return await Promise.race([request,timeout]);}
  finally{clearTimeout(timer);}
}

function applyBootstrapPayload4120(payload, includeProfile = true){
  rolloverAttendanceDay4148();
  const attendance = (payload?.attendance || []).map(row => ({
    ...row, present:!!row.present && attendanceIsToday4148(row.updated_at)
  }));
  const showInactive = state.showInactive;
  const currentGame = payload?.current_game;
  applyBootstrapPayload41121({...payload, attendance,
    current_game:attendanceIsToday4148(currentGame?.generated_at) ? currentGame : null
  }, includeProfile);
  state.showInactive = showInactive;
  const timestamps = new Map(attendance.map(row => [String(row.player_id), row.updated_at]));
  state.players.forEach(p => { p.attendanceUpdatedAt = timestamps.get(String(p.id)) || null; });
  balanceDataReady4147 = true;
  state.settings.reshuffleMode = payload?.settings?.reshuffle_mode || state.settings.reshuffleMode || "normal";
  applyOfflineAttendanceQueueToState4120();
  syncSettingsForm4120();
}
async function loadCloudData4120(options = {}){
  if(!db) return null;
  const includeProfile = options.includeProfile !== false;
  const applyLocal = options.applyLocal !== false;
  const force = options.force === true;
  if(cloudLoadPromise4120 && !force) return cloudLoadPromise4120;
  const requestId = ++cloudRequest4145;
  const requestUser = currentUser?.id || null;
  const task = (async()=>{
    const { payload } = await fetchBootstrap4120(includeProfile);
    if(requestId < cloudApplied4145 || requestUser !== (currentUser?.id || null)) return null;
    cloudApplied4145 = requestId;
    applyBootstrapPayload4120(payload, includeProfile);
    applyPendingAttendance4142(requestId);
    if(currentUser && includeProfile && !payload.profile) await loadProfile();
    if(applyLocal && typeof applyLocalTeammateGame41117 === "function") applyLocalTeammateGame41117();
    applyOfflineAttendanceQueueToState4120();
    applyPendingAttendance4142();
    expireCurrentTeams4156();
    cloudLoadedAt4156 = Date.now();
    saveSafeStartupSnapshot41121?.();
    return payload;
  })();
  cloudLoadPromise4120 = task;
  try{ return await task; }
  finally{ if(cloudLoadPromise4120 === task) cloudLoadPromise4120 = null; }
}
loadCloudData = loadCloudData4120;
window.loadCloudData = loadCloudData4120;
// Route historical callers through the same daily filtering and pending-tap logic.
loadCloudData41121 = loadCloudData4120;
window.loadCloudData41121 = loadCloudData4120;

function scheduleLiveRefresh4120(){
  if(liveRefreshTimer) clearTimeout(liveRefreshTimer);
  liveRefreshTimer = setTimeout(async()=>{
    try{ await loadCloudData4120({ includeProfile:true, applyLocal:true }); renderAll(); refreshGameNightStats4120(); }
    catch(e){ console.warn("Live refresh failed", e); }
  },180);
}
scheduleLiveRefresh = scheduleLiveRefresh4120;
window.scheduleLiveRefresh = scheduleLiveRefresh4120;

/* ---------- Offline attendance queue ---------- */
function readOfflineAttendanceQueue4120(){
  try{
    const value = JSON.parse(localStorage.getItem(offlineAttendanceKey4120()) || "[]");
    return Array.isArray(value) ? value.filter(item => attendanceIsToday4148(item.queuedAt)) : [];
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
    if(p){ p.attending = !!item.present; p.attendanceUpdatedAt = item.queuedAt; }
  });
}
function isNetworkError4120(error){
  if(navigator.onLine === false) return true;
  const msg = String(error?.message || error || "").toLowerCase();
  return ["fetch","network","offline","failed to fetch","load failed","connection","timeout","timed out"].some(x => msg.includes(x));
}
async function flushOfflineAttendanceQueue4120(){
  if(offlineFlushRunning4120 || !currentUser || navigator.onLine === false) return;
  const queue = readOfflineAttendanceQueue4120();
  if(!queue.length) return;
  offlineFlushRunning4120 = true;
  try{
    for(const item of queue){
      const key = String(item.playerId);
      if(!attendancePending4142.has(key)){
        attendancePending4142.set(key, {desired:!!item.present,seq:++attendanceSeq4142,confirmed:false,day:attendanceDay4148});
      }
      // Reconnect and live taps use the same per-player writer. Never replay
      // an old offline value through a second request after a newer tap.
      await syncAttendancePlayer4142(item.playerId);
    }
    applyPendingAttendance4142();
    renderAll();
  }finally{offlineFlushRunning4120 = false;}
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
  p.attendanceUpdatedAt = new Date().toISOString();
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
  const day = localDayStartIso4120();
  try{
    const { data, error } = await db.from("games")
      .select("id,played_at,winner_team_index,teams")
      .gte("played_at", day)
      .not("winner_team_index","is",null)
      .order("played_at", { ascending:false })
      .limit(100);
    if(error) throw error;
    if(day !== localDayStartIso4120()) return;
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
  rolloverAttendanceDay4148();
  const out = document.getElementById("gameNightDashboard");
  if(!out) return;
  const present = state.players.filter(p => p.attending).length;
  const quality = dashboardBalanceSnapshot4147()?.quality || null;
  const sizes = state.currentGame ? state.currentGame.teams.map(t => t.length).join(" / ") : "—";
  const nextGame = gameNightStats4120.completed + (state.currentGame && !state.resultsSavedForCurrentGame ? 1 : 0);
  const start = state.currentGameGeneratedAt ? formatGameStartTime(state.currentGameGeneratedAt) : "—";
  const last = gameNightStats4120.lastWinner === null ? "—" : `Team ${Number(gameNightStats4120.lastWinner)+1}`;
  const dashboardHtml = `
    <div class="dashboard-tile"><div class="dashboard-label">Present</div><div class="dashboard-value">${present}</div></div>
    <div class="dashboard-tile"><div class="dashboard-label">Game</div><div class="dashboard-value">${nextGame || "—"}<span class="dashboard-context4147">${gameNightStats4120.completed} done</span></div></div>
    <button class="dashboard-tile dashboard-action dashboard-balance ${quality?.className || "balance-empty"}" type="button" onclick="openBalanceDetails4128()" aria-label="Open balance rating details"><div class="dashboard-label">Balance</div><div class="dashboard-value">${quality ? `<span>${quality.score}</span><span class="dashboard-balance-name4147">${quality.label}</span>` : "—"}</div></button>
    <div class="dashboard-tile"><div class="dashboard-label">Team sizes</div><div class="dashboard-value">${sizes}</div></div>
    <div class="dashboard-tile"><div class="dashboard-label">Started</div><div class="dashboard-value">${start}</div></div>
    <button class="dashboard-tile dashboard-action dashboard-last-winner" type="button" onclick="openLastWinnerDetails4128()" aria-label="Show players on the last winning team"><div class="dashboard-label">Last winner</div><div class="dashboard-value">${last}</div></button>`;
  if(out.__dashboardHtml4156 !== dashboardHtml){out.innerHTML = dashboardHtml;out.__dashboardHtml4156 = dashboardHtml;}
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
  const quality = dashboardBalanceSnapshot4147()?.quality;
  if(!quality){
    makeDynamicModal("balanceDetailsModal", "Balance Rating", '<div class="small">Pre-results balance is unavailable for this older game. New games retain it automatically.</div>');
    return;
  }
  const teamSizes = teams.map((team,idx) => `<div class="history-card"><div class="row" style="justify-content:space-between;align-items:center"><strong>Team ${idx+1}</strong><span class="small">${team.length} player${team.length===1?"":"s"}</span></div></div>`).join("");
  const conflicts = Number(quality.ruleViolations || 0);
  const body = `
    <div class="balance-detail-hero ${quality.className}">
      <div class="dashboard-label">Pre-results balance</div>
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
  if(!state.currentGame){ out.innerHTML=canGenerateTeams() ? '<div class="small">Select attendees, then tap Generate Teams.</div>' : '<div class="small">No current teams.</div>'; renderGameNightDashboard4120(); return; }

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
  const generationUser = currentUser?.id;
  const generationDay = localDayStartIso4120();
  const players = presentPlayers();
  const numTeams = Math.max(2, Number(document.getElementById("numTeams")?.value || 2));
  if(players.length < numTeams){ alert("Not enough attending players for that many teams."); return; }
  const context = scoreContext4120({ previousGameTeams:previousOfficialGameForReshuffle4120 });
  context.playerMetrics = new Map(players.map(p=>[String(p.id),teamStats([p])]));
  context.previousPairs = teamPairSet4120(context.previousGameTeams);
  let best=null;
  await new Promise(resolve => setTimeout(resolve, 0));
  for(let i=0;i<120;i++){
    const candidate = await optimizeTeamsResponsive4156(makeInitialTeams(players,numTeams), Number(context.settings.repeatWeight || 4), context);
    if(!best || candidate.score < best.score) best=candidate;
  }
  if(generationUser !== currentUser?.id || generationDay !== localDayStartIso4120()){
    throw new Error('The session or day changed. Select today’s attendees and generate again.');
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
  scrollAppTo4144({top:0,behavior:window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"});
}
generateGame = generateGame4120;
window.generateGame = generateGame4120;

async function generateTeamsButton4120(){
  if(generationRunning4156) return;
  expireCurrentTeams4156();
  if(!canGenerateTeams()){ alert("Only Teammates, Captains, and Admins can generate teams."); return; }
  generationRunning4156 = true;
  const button = document.querySelector("#stickybar button");
  if(button){button.disabled = true;button.setAttribute("aria-busy","true");}
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
  finally{
    generationRunning4156 = false;
    if(button){button.disabled = false;button.removeAttribute("aria-busy");}
  }
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
  if(expireCurrentTeams4156()){renderAll();return;}
  dashboardBalanceSnapshot4147();
  const result = await saveResultsLegacy4120();
  await refreshGameNightStats4120();
  renderGameNightDashboard4120();
  return result;
};
window.saveResults = saveResults;

/* ---------- Canonical render / page integration ---------- */
const renderAllLegacy4120 = renderAll;
function renderAll4120(){ renderAllLegacy4120(); }
renderAll = renderAll4120;
window.renderAll = renderAll4120;

const showPageLegacy4120 = showPage;
function scrollActivePageToTop4154(){
  const app=document.querySelector(".app");
  // iOS Home Screen mode scrolls .app; normal Safari/desktop scrolls the page.
  // Keep this as a real animated scroll so scroll-linked UI (including the
  // Generate Teams dock) follows the movement instead of snapping.
  try{
    if(document.documentElement.classList.contains("ios-home-screen") && app){
      app.scrollTo({top:0,left:0,behavior:window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"});
    }else{
      window.scrollTo({top:0,left:0,behavior:window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"});
    }
  }catch(e){
    if(app) app.scrollTop=0;
    window.scrollTo(0,0);
  }
}
function showPage4120(page){
  if(document.body.classList.contains("sandbox-open")) return;
  const sandbox=document.getElementById("sandboxPage"); if(sandbox) sandbox.style.display="none";
  showPageLegacy4120(page);
  scrollActivePageToTop4154();
  if(page !== "main") document.getElementById("stickybar")?.style.removeProperty("display");
}
showPage = showPage4120;
window.showPage = showPage4120;

/* ---------- Auth/init ---------- */
function setStartupStatus4156(message = "", retry = false){
  const box = document.getElementById("startupStatus4156");
  if(!box) return;
  box.hidden = !message;
  const label = box.querySelector("span");
  if(label) label.textContent = message;
  const button = box.querySelector("button");
  if(button) button.hidden = !retry;
}
async function afterAuthChange4120(){
  const run = ++authRun4156;
  state.showInactive = false;
  const restored = restoreSafeStartupSnapshot41121?.() || startupRestored4156;
  expireCurrentTeams4156();
  updateAuthButtons();
  if(restored){applyOfflineAttendanceQueueToState4120();renderAll4120();}
  setStartupStatus4156(restored ? "Updating…" : "Loading players…");
  state.showInactive = false;
  try{
    await loadCloudData4120({includeProfile:true,applyLocal:true,force:true});
    if(run !== authRun4156) return;
    setStartupStatus4156();
  }catch(e){
    if(run !== authRun4156) return;
    console.warn("Initial load failed",e);
    setStartupStatus4156(restored ? "Showing saved data. Reconnect to update." : "Could not load players. Check your connection.",true);
  }
  updateAuthButtons();applyOfflineAttendanceQueueToState4120();renderAll4120();
  if(!canAccessDataPage() && document.getElementById('dataPage')?.style.display !== 'none') showPage4120('main');
  idle41121?.(()=>{
    if(run !== authRun4156) return;
    subscribeToLiveDataUpdates();
    if(currentUser)subscribeToProfileUpdates41121();else unsubscribeFromProfileUpdates();
    installLightweightProfileRefresh41121?.();handleRoleMilestones();
    refreshGameNightStats4120();flushOfflineAttendanceQueue4120();
  },900);
}
afterAuthChange = afterAuthChange4120;
window.afterAuthChange = afterAuthChange4120;

function handleAuthEvent4156(event, session){
  if(event === "INITIAL_SESSION") return;
  const user = session?.user || null;
  const sameUser = (currentUser?.id || null) === (user?.id || null);
  currentUser = user;
  if(sameUser && (event === "TOKEN_REFRESHED" || event === "SIGNED_IN")) return;
  if(!sameUser){
    ++authRun4156;
    cloudLoadPromise4120 = null;
    cloudApplied4145 = ++cloudRequest4145;
    attendancePending4142.clear();
    profile = {role:user ? "user" : "guest",email:user?.email || "Guest"};
  }
  clearTimeout(authEventTimer4156);
  // Auth callbacks must return before starting queries on the same client.
  authEventTimer4156 = setTimeout(()=>afterAuthChange4120(),0);
}
async function init4120(){
  hideSignInBox();hideAllModals();state.showInactive = false;
  startupRestored4156 = restoreSafeStartupSnapshot41121?.() || false;
  expireCurrentTeams4156();
  updateAuthButtons();renderAll4120();
  document.documentElement.classList.add("app-ready4156");
  setStartupStatus4156("Connecting…");
  if(!SUPABASE_URL || !SUPABASE_KEY || SUPABASE_KEY.includes("PASTE_")){
    setStartupStatus4156("Connection settings are missing.");return;
  }
  if(!window.supabase?.createClient){
    setStartupStatus4156("App connection could not load. Reopen while online.");return;
  }
  // Register once independently of notifications, including browsers without Push.
  idle41121(()=>getServiceWorkerRegistration(),1500);
  try{
    db=supabase.createClient(SUPABASE_URL,SUPABASE_KEY);listenForAuthConfirmedFromOtherTab();
    const hasAuthRedirect=new URLSearchParams(location.search).has("code") || /(?:^|[&#])(access_token|refresh_token|type)=/.test(location.hash || "");
    if(hasAuthRedirect)await completeAuthRedirectIfNeeded();
    const {data,error}=await db.auth.getSession();
    if(error) throw error;
    currentUser=data?.session?.user || null;
    db.auth.onAuthStateChange(handleAuthEvent4156);
    await afterAuthChange4120();
  }catch(e){
    console.warn("Startup connection failed",e);
    setStartupStatus4156("Could not connect. Reopen while online.");
  }
}

try{ document.removeEventListener("DOMContentLoaded", init41121); }catch(e){}
try{ document.removeEventListener("DOMContentLoaded", init); }catch(e){}
init = init4120;
document.addEventListener("DOMContentLoaded", init4120);

window.addEventListener("online",()=>{
  flushOfflineAttendanceQueue4120();
  loadCloudData4120({force:true}).then(()=>{setStartupStatus4156();renderAll();refreshGameNightStats4120();}).catch(()=>{});
});
window.addEventListener("offline",()=>renderGameNightDashboard4120());

Object.assign(window,{
  REFACTOR_VERSION_4120,scoreBreakdown4120,balanceQuality4120,optimizeTeams4120,
  loadCloudData4120,saveSettings4120,toggleAttendance4120,flushOfflineAttendanceQueue4120,
  refreshGameNightStats4120,renderGameNightDashboard4120,generateGame4120,generateTeamsButton4120,
  openMyProfileModal4120,smartLateAddPlayer4120,afterAuthChange4120,init4120
});



/* ---------- 4.14.0 attendance press-and-hold player actions ---------- */
const PLAYER_HOLD_MS_4132 = 500;
const PLAYER_HOLD_MOVE_PX_4132 = 7;

function oneTimeBadgeHtml4132(){
  return '<span class="one-time-badge4132" title="One-time player">ONE-TIME</span>';
}

function closePlayerActions4132(){
  document.getElementById("playerActionsModal4132")?.remove();
}

function openPlayerEditor4147(playerId){
  if(!canManageGames()) return;
  const p = state.players.find(player => String(player.id) === String(playerId));
  if(!p) return;
  const search = document.getElementById('editPlayerSearch');
  if(search) search.value = p.fullName;
  const filters = modalFilterState('edit');
  filters.showInactive = true;
  filters.presentOnly = false;
  selectedEditPlayerId = String(p.id);
  openEditPlayerModal();
  reopenInlineEditDropdown(p.id);
  const details = [...document.querySelectorAll('#editPlayerModalList details[data-player-id]')]
    .find(row => row.getAttribute('data-player-id') === String(p.id));
  details?.scrollIntoView({block:'nearest'});
}

function openPlayerActions4132(playerId){
  if(!canManageGames()){
    alert("Captain or Admin only.");
    return;
  }

  const p = playerById(playerId) || state.players.find(x => String(x.id) === String(playerId));
  if(!p){
    alert("Player not found.");
    return;
  }

  closePlayerActions4132();
  const injury = Math.round(Number(p.injuryPct ?? 1) * 100);
  const wrap = document.createElement("div");
  wrap.id = "playerActionsModal4132";
  wrap.className = "modal-backdrop modal-open player-actions-backdrop4132";
  wrap.innerHTML = `
    <div class="modal-card player-actions-card4132" role="dialog" aria-modal="true" aria-label="Player actions for ${escapeHtml(p.fullName)}">
      <div class="player-actions-header4132">
        <div class="player-actions-title4132">
          <strong>${escapeHtml(p.fullName)}</strong>
          ${p.temporary ? oneTimeBadgeHtml4132() : ""}
        </div>
        <button class="btn-secondary player-actions-close4132" type="button" aria-label="Close player actions">Close</button>
      </div>
      <div class="player-actions-grid4132">
        <div>
          <label class="compact-number4157" for="playerInjury4157">
            <span>Injury / Availability</span>
            <span class="compact-number-value4157"><input id="playerInjury4157" type="number" inputmode="numeric" enterkeyhint="done" min="0" max="100" step="1" value="${injury}" aria-describedby="playerInjuryStatus4157"><span aria-hidden="true">%</span></span>
          </label>
          <div id="playerInjuryStatus4157" class="small injury-save-status4157" role="status" aria-live="polite"></div>
          <button class="btn-secondary" type="button" id="retryInjury4157" hidden>Retry</button>
        </div>
        <button class="btn-secondary" type="button" data-player-action4132="active">
          ${p.active ? "Make Inactive" : "Make Active"}
        </button>
        ${p.temporary ? `
          <button class="btn" type="button" data-player-action4132="permanent">Make Permanent</button>
          <button class="btn-danger" type="button" data-player-action4132="remove">Remove One-Time Player</button>
        ` : ""}
        <button class="btn-secondary" type="button" data-player-action4132="edit">Edit Player</button>
      </div>
    </div>
  `;

  wrap.querySelector(".player-actions-close4132")?.addEventListener("click", closePlayerActions4132);
  wrap.querySelector('[data-player-action4132="edit"]')?.addEventListener("click", () => {
    closePlayerActions4132();
    openPlayerEditor4147(p.id);
  });
  const injuryInput = wrap.querySelector('#playerInjury4157');
  const injuryStatus = wrap.querySelector('#playerInjuryStatus4157');
  const injuryRetry = wrap.querySelector('#retryInjury4157');
  const saveInjury = () => saveInjuryControl4157(p.id,injuryInput,injuryStatus,injuryRetry);
  injuryInput.addEventListener('change',saveInjury);
  injuryInput.addEventListener('keydown',event=>{
    if(event.key === 'Enter'){event.preventDefault();saveInjury();}
  });
  injuryRetry.addEventListener('click',saveInjury);
  wrap.querySelector('[data-player-action4132="active"]')?.addEventListener("click", () => {
    closePlayerActions4132();
    toggleActive(p.id);
  });
  wrap.querySelector('[data-player-action4132="permanent"]')?.addEventListener("click", () => {
    closePlayerActions4132();
    makeTemporaryPlayerPermanent(p.id);
  });
  wrap.querySelector('[data-player-action4132="remove"]')?.addEventListener("click", () => {
    closePlayerActions4132();
    removePlayer(p.id);
  });
  wrap.addEventListener("click", event => {
    if(event.target === wrap) closePlayerActions4132();
  });

  document.body.appendChild(wrap);
}

// Attendance uses one release handler for touch, pen and mouse. Native click
// is retained only for keyboard/assistive activation, so delayed touch clicks
// cannot lose or double-toggle a selection.
let attendanceGesture4144 = null;
let attendanceRenderPending4144 = false;
let attendanceRenderTimer4144 = null;
let attendanceRenderAfter4144 = 0;
const ATTENDANCE_ROW_4145 = '#playerList .player[data-attendance-player-id]';
const ATTENDANCE_TAP_MOVE_4145 = 14;

function scheduleAttendanceRender4144(){
  clearTimeout(attendanceRenderTimer4144);
  attendanceRenderTimer4144 = setTimeout(() => {
    if(attendanceGesture4144 || !attendanceRenderPending4144) return;
    attendanceRenderPending4144 = false;
    renderPlayers();
  }, 160);
}
function cancelAttendanceGesture4144(){
  const g = attendanceGesture4144;
  attendanceGesture4144 = null;
  if(g){
    attendanceRenderAfter4144 = Date.now() + 160;
    clearTimeout(g.timer);
    g.row.classList.remove("player-hold-arming4132");
  }
  scheduleAttendanceRender4144();
}
function finishAttendanceGesture4145(event){
  const g = attendanceGesture4144;
  if(!g || event.pointerId !== g.pointerId) return;
  const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest(ATTENDANCE_ROW_4145);
  const tap = !g.held && !document.hidden
    && Math.hypot(event.clientX - g.x, event.clientY - g.y) <= ATTENDANCE_TAP_MOVE_4145
    && hit?.dataset.attendancePlayerId === g.playerId;
  cancelAttendanceGesture4144();
  if(tap) toggleAttendance(g.playerId);
}
window.addEventListener("pointerdown", event => {
  cancelAttendanceGesture4144();
  if(event.isPrimary === false || event.button !== 0) return;
  if(event.target.closest?.("button,input,select,textarea,a,label")) return;
  const row = event.target.closest?.(ATTENDANCE_ROW_4145);
  if(!row?.classList.contains("clickable")) return;
  const g = {row, playerId:row.dataset.attendancePlayerId, pointerId:event.pointerId,
    pointerType:event.pointerType, x:event.clientX, y:event.clientY, held:false, timer:null};
  attendanceGesture4144 = g;
  if(!canManageGames()) return;
  g.timer = setTimeout(() => {
    if(attendanceGesture4144 !== g) return;
    if(!row.isConnected || document.hidden || !canManageGames()){
      cancelAttendanceGesture4144();return;
    }
    g.held = true;
    try{navigator.vibrate?.(12);}catch(e){}
    openPlayerActions4132(g.playerId);
  }, PLAYER_HOLD_MS_4132);
}, {capture:true, passive:true});
window.addEventListener("pointerup", finishAttendanceGesture4145, {capture:true, passive:true});
window.addEventListener("pointermove", event => {
  const g = attendanceGesture4144;
  if(!g || event.pointerId !== g.pointerId) return;
  const distance = Math.hypot(event.clientX - g.x, event.clientY - g.y);
  if(distance > PLAYER_HOLD_MOVE_PX_4132) clearTimeout(g.timer);
  if(distance > ATTENDANCE_TAP_MOVE_4145) cancelAttendanceGesture4144();
}, {capture:true, passive:true});
// Some interrupted WebKit streams deliver touchend without pointerup.
window.addEventListener("touchend", event => {
  const g = attendanceGesture4144;
  if(!g || g.pointerType !== 'touch') return;
  if(event.touches.length || event.changedTouches.length !== 1){cancelAttendanceGesture4144();return;}
  const touch = event.changedTouches[0];
  finishAttendanceGesture4145({pointerId:g.pointerId,clientX:touch.clientX,clientY:touch.clientY});
}, {capture:true, passive:true});
for(const type of ['pointercancel','touchcancel','scroll','blur','pagehide']){
  window.addEventListener(type, cancelAttendanceGesture4144, {capture:true, passive:true});
}
document.addEventListener('visibilitychange', () => {
  if(document.hidden) cancelAttendanceGesture4144();
});
window.addEventListener('click', event => {
  const row = event.target.closest?.(ATTENDANCE_ROW_4145);
  if(!row || event.target.closest?.('button,input,select,textarea,a,label')) return;
  // Physical contacts are handled on release. Keyboard/AT clicks have no
  // pointer type and detail 0 and continue to the existing permission checks.
  if(event.detail > 0 || event.pointerType || event.sourceCapabilities?.firesTouchEvents){
    event.preventDefault();event.stopImmediatePropagation();
  }
}, true);
function bindPlayerHoldActions4132(row, p){
  if(!row || !p || !canManageGames()) return;
  row.classList.add('player-hold-enabled4132');
  row.setAttribute('title', 'Tap for attendance. Press and hold for player actions.');
  row.addEventListener('contextmenu', event => {
    if(!event.target.closest('button,input,select,textarea,a,label')) event.preventDefault();
  });
}

const renderAttendancePlayerRowBefore4132 = renderAttendancePlayerRow;
function renderAttendancePlayerRow4132(p){
  const row = renderAttendancePlayerRowBefore4132(p);
  const nameEl = row?.querySelector(".player-name");
  if(nameEl && p.temporary && !nameEl.querySelector(".one-time-badge4132")){
    nameEl.insertAdjacentHTML("beforeend", ` ${oneTimeBadgeHtml4132()}`);
  }

  // 4.14.5: keep Attendance cards clean. One-time actions are hold-only.
  const oneTimeButton = row?.querySelector('[aria-label="One-time player actions"]');
  oneTimeButton?.remove();

  // Injury editing is also hold-only. At 100% there is no injury control at all.
  // Below 100%, keep only a compact non-interactive indicator so reduced
  // availability remains visible during game night.
  const injuryButton = row?.querySelector('.injury-btn');
  const injuryPct = Math.round(Number(p?.injuryPct ?? 1) * 100);
  if(injuryButton){
    if(injuryPct >= 100){
      injuryButton.remove();
    }else{
      const indicator = document.createElement('span');
      indicator.className = `${injuryButton.className} injury-indicator4141`;
      indicator.textContent = injuryButton.textContent || `Injury ${injuryPct}%`;
      indicator.setAttribute('aria-label', `Injury availability ${injuryPct} percent. Press and hold the player row to edit.`);
      injuryButton.replaceWith(indicator);
    }
  }

  const controls = row?.querySelector('.toggle-wrap');
  if(controls && !controls.children.length) controls.remove();

  bindPlayerHoldActions4132(row, p);
  return row;
}
renderAttendancePlayerRow = renderAttendancePlayerRow4132;
window.renderAttendancePlayerRow = renderAttendancePlayerRow4132;

async function makePermanentFromEdit4132(playerId){
  await makeTemporaryPlayerPermanent(playerId);
  if(document.getElementById("editPlayerModal")) openEditPlayerModal(false);
}

async function removeOneTimeFromEdit4132(playerId){
  await removePlayer(playerId);
  if(document.getElementById("editPlayerModal")) openEditPlayerModal(false);
}

function decorateEditPlayerRows4132(){
  const list = document.getElementById("editPlayerModalList");
  if(!list) return;

  list.querySelectorAll("details[data-player-id]").forEach(details => {
    const id = details.getAttribute("data-player-id");
    const p = playerById(id) || state.players.find(x => String(x.id) === String(id));
    if(!p) return;

    const nameEl = details.querySelector("summary .player-name");
    if(nameEl && p.temporary && !nameEl.querySelector(".one-time-badge4132")){
      nameEl.insertAdjacentHTML("beforeend", ` ${oneTimeBadgeHtml4132()}`);
    }

    const form = details.querySelector(".inline-edit-form");
    if(!form || form.querySelector(".edit-player-actions4132")) return;

    const actionRow = document.createElement("div");
    actionRow.className = "toolbar edit-player-actions4132";
    actionRow.innerHTML = p.temporary ? `
      <button class="btn" type="button" data-edit-make-permanent4132="${escapeHtml(String(p.id))}">Make Permanent</button>
      <button class="btn-danger" type="button" data-edit-remove-one-time4132="${escapeHtml(String(p.id))}">Remove One-Time</button>
    ` : "";

    if(p.temporary){
      const mainToolbar = form.querySelector(".toolbar");
      if(mainToolbar) form.insertBefore(actionRow, mainToolbar);
      else form.appendChild(actionRow);
    }
  });

  list.querySelectorAll("[data-edit-make-permanent4132]").forEach(btn => {
    if(btn.dataset.bound4132 === "true") return;
    btn.dataset.bound4132 = "true";
    btn.addEventListener("click", async event => {
      event.preventDefault();
      event.stopPropagation();
      await makePermanentFromEdit4132(btn.getAttribute("data-edit-make-permanent4132"));
    });
  });

  list.querySelectorAll("[data-edit-remove-one-time4132]").forEach(btn => {
    if(btn.dataset.bound4132 === "true") return;
    btn.dataset.bound4132 = "true";
    btn.addEventListener("click", async event => {
      event.preventDefault();
      event.stopPropagation();
      await removeOneTimeFromEdit4132(btn.getAttribute("data-edit-remove-one-time4132"));
    });
  });
}

const openEditPlayerModalBefore4132 = openEditPlayerModal;
openEditPlayerModal = function(show = true){
  const result = openEditPlayerModalBefore4132(show);
  decorateEditPlayerRows4132();
  return result;
};
window.openEditPlayerModal = openEditPlayerModal;

const saveInlineEditedPlayerBefore4132 = saveInlineEditedPlayer;
saveInlineEditedPlayer = async function(playerId){
  const result = await saveInlineEditedPlayerBefore4132(playerId);
  decorateEditPlayerRows4132();
  return result;
};
window.saveInlineEditedPlayer = saveInlineEditedPlayer;

Object.assign(window, {
  openPlayerActions4132,
  closePlayerActions4132,
  bindPlayerHoldActions4132,
  decorateEditPlayerRows4132,
  makePermanentFromEdit4132,
  removeOneTimeFromEdit4132
});

/* ===== 4.14.5 seamless optimistic attendance ===== */
const attendancePending4142 = new Map();
const attendanceSyncing4142 = new Set();
let attendanceSeq4142 = 0;

function attendancePlayer4142(id){
  return state.players.find(p => String(p.id) === String(id));
}

function applyPendingAttendance4142(requestId = 0){
  rolloverAttendanceDay4148();
  for(const [id, pending] of attendancePending4142){
    const p = attendancePlayer4142(id);
    if(!p) continue;
    // Only a read STARTED after the successful save can acknowledge that tap.
    if(pending.confirmed && requestId > pending.confirmedAfterRequest && !!p.attending === pending.desired){
      attendancePending4142.delete(id);
    }else{
      p.attending = pending.desired;
      p.attendanceUpdatedAt = pending.day || attendanceDay4148;
    }
  }
}
let attendanceConfirmTimer4145 = null;
function scheduleAttendanceConfirmation4145(){
  clearTimeout(attendanceConfirmTimer4145);
  attendanceConfirmTimer4145 = setTimeout(async () => {
    try{
      await loadCloudData4120({includeProfile:true, applyLocal:true});
      renderAll();
    }catch(e){console.warn('Attendance confirmation refresh failed', e);}
  }, 450);
}

function paintAttendanceImmediately4142(playerId, present){
  const row = document.querySelector(`.player[data-attendance-player-id="${CSS.escape(String(playerId))}"]`);
  if(row){row.classList.toggle("attend-on", !!present);row.setAttribute("aria-pressed",String(!!present));}

  const count = state.players.filter(p => p.attending).length;
  const headerCount = document.getElementById("attendanceHeaderCount");
  if(headerCount) headerCount.textContent = `${count} present`;
  const presentCount = document.getElementById("presentCount");
  if(presentCount) presentCount.textContent = String(count);

  // Keep the rest of the lightweight game-night UI current without rebuilding
  // the entire attendance list before the browser can paint this tap.
  try{ renderPresentList?.(); }catch(e){}
  try{ renderGameNightDashboard4120?.(); }catch(e){}
}

async function syncAttendancePlayer4142(playerId){
  const owner = currentUser?.id;
  const key = String(playerId);
  if(attendanceSyncing4142.has(key)) return;
  attendanceSyncing4142.add(key);
  let retryLater = false;
  try{
    while(true){
      rolloverAttendanceDay4148();
      const pending = attendancePending4142.get(key);
      if(!pending || pending.confirmed) break;
      const seq = pending.seq;
      const desired = !!pending.desired;
      try{
        const { error } = await saveAttendanceFromApp(playerId, desired);
        if(owner !== currentUser?.id) break;
        rolloverAttendanceDay4148();
        if(error){
          if(isNetworkError4120?.(error)){
            queueAttendance4120(playerId, attendancePending4142.get(key)?.desired ?? desired);
            retryLater = true;
            break;
          }
          throw error;
        }
        saveSafeStartupSnapshot41121?.();
        const latest = attendancePending4142.get(key);
        if(latest && latest.seq === seq){
          writeOfflineAttendanceQueue4120(readOfflineAttendanceQueue4120().filter(item => String(item.playerId) !== key));
          latest.confirmed = true;
          latest.confirmedAfterRequest = cloudRequest4145;
          attendancePending4142.set(key, latest);
          scheduleAttendanceConfirmation4145();
          break;
        }
        // The user tapped again while this request was in flight. Loop and send
        // only the newest desired state next.
      }catch(e){
        if(owner !== currentUser?.id) break;
        rolloverAttendanceDay4148();
        const latest = attendancePending4142.get(key);
        if(isNetworkError4120?.(e)){
          if(latest) queueAttendance4120(playerId, !!latest.desired);
          retryLater = true;
          break;
        }
        if(latest && latest.seq !== seq) continue;
        if(latest){
          attendancePending4142.delete(key);
          writeOfflineAttendanceQueue4120(readOfflineAttendanceQueue4120().filter(item => String(item.playerId) !== key));
          try{ await loadCloudData4120({ includeProfile:true, applyLocal:true, force:true }); }catch(_){}
          renderAll();
        }
        alert("Attendance save error: " + (e?.message || e));
        break;
      }
    }
  }finally{
    attendanceSyncing4142.delete(key);
    const latest = attendancePending4142.get(key);
    if(latest && !latest.confirmed && navigator.onLine !== false){
      // A newer tap may have arrived in the tiny window as the worker exited.
      if(retryLater) setTimeout(()=>syncAttendancePlayer4142(playerId), 2000);
      else queueMicrotask(()=>syncAttendancePlayer4142(playerId));
    }
  }
}

async function toggleAttendance4142(id){
  rolloverAttendanceDay4148();
  if(!canMarkAttendance()){
    alert("Create an account or sign in to mark attendance.");
    toggleSignInBox();
    return;
  }
  const p = attendancePlayer4142(id);
  if(!p) return;
  if(!canMarkAttendanceForPlayer(p)){
    if(isPlayerRole()) return;
    alert(attendancePermissionMessage());
    return;
  }

  const next = !(attendancePending4142.get(String(p.id))?.desired ?? p.attending);
  p.attending = next;
  if(next && !p.active && canManageGames()) p.active = true;

  attendancePending4142.set(String(p.id), {
    desired: next,
    day:attendanceDay4148,
    seq: ++attendanceSeq4142,
    confirmed: false
  });

  paintAttendanceImmediately4142(p.id, next);

  if(navigator.onLine === false){
    queueAttendance4120(p.id, next);
    return;
  }
  syncAttendancePlayer4142(p.id);
}

toggleAttendance4120 = toggleAttendance4142;
toggleAttendance = toggleAttendance4142;
window.toggleAttendance = toggleAttendance4142;
window.toggleAttendance4120 = toggleAttendance4142;

const renderAttendancePlayerRowBefore4142 = renderAttendancePlayerRow;
renderAttendancePlayerRow = function(p){
  const row = renderAttendancePlayerRowBefore4142(p);
  if(row){
    row.dataset.attendancePlayerId = String(p.id);
    if(canMarkAttendanceForPlayer(p)){
      row.tabIndex = 0;row.setAttribute('role','button');
      row.setAttribute('aria-pressed',String(!!p.attending));
      row.addEventListener('keydown',event=>{
        if(event.target === row && (event.key === 'Enter' || event.key === ' ')){
          event.preventDefault();toggleAttendance(p.id);
        }
      });
    }
  }
  return row;
};
window.renderAttendancePlayerRow = renderAttendancePlayerRow;

Object.assign(window, {
  applyPendingAttendance4142,
  paintAttendanceImmediately4142,
  syncAttendancePlayer4142,
  toggleAttendance4142
});

/* Keep cloud/realtime renders from replacing a row under a finger. */
let attendanceRenderSignature4156 = "";
const renderPlayersBefore4144 = renderPlayers;
renderPlayers = function(){
  if(attendanceGesture4144 || Date.now() < attendanceRenderAfter4144){
    attendanceRenderPending4144 = true;
    scheduleAttendanceRender4144();
    return;
  }
  attendanceRenderPending4144 = false;
  const signature = JSON.stringify([
    currentUser?.id,profile,state.showInactive,state.showOnlyAttending,
    document.getElementById('playerSearch')?.value || '',
    state.players.map(p=>[p.id,p.fullName,p.firstName,p.lastName,p.attending,p.active,p.injuryPct,p.temporary])
  ]);
  if(signature === attendanceRenderSignature4156 && document.getElementById('playerList')?.childNodes.length) return;
  const result = renderPlayersBefore4144();
  attendanceRenderSignature4156 = signature;
  return result;
};
window.renderPlayers = renderPlayers;

function scrollAppTo4144(options){
  const app = document.querySelector(".app");
  if(document.documentElement.classList.contains("ios-home-screen") && app){
    app.scrollTo(options);
  }else{
    window.scrollTo(options);
  }
}

function expireCurrentTeams4156(){
  if(!state.currentGame || attendanceIsToday4148(state.currentGameGeneratedAt)) return false;
  state.currentGame = null;
  state.currentGameGeneratedAt = null;
  state.selectedWinnerIndex = null;
  state.resultsSavedForCurrentGame = false;
  state.currentGameIsLocalTeammate41117 = false;
  previousOfficialGameForReshuffle4120 = null;
  try{localStorage.removeItem(BALANCE_STORAGE_KEY_4147);}catch(e){}
  clearLocalTeammateGame41117?.();
  return true;
}

/* Attendance is a daily check-in, using the dashboard's local-midnight cutoff.
   Expiration is applied on reads, so a closed app needs no scheduled DB job. */
function attendanceIsToday4148(timestamp){
  const value = Date.parse(timestamp);
  return Number.isFinite(value) && value >= Date.parse(localDayStartIso4120());
}
function rolloverAttendanceDay4148(){
  const day = localDayStartIso4120();
  if(day === attendanceDay4148) return false;
  attendanceDay4148 = day;
  state.players.forEach(p => {p.attending = false; p.attendanceUpdatedAt = null;});
  attendancePending4142.clear();
  // Complete an old in-flight write with a clear, unless a new tap supersedes it.
  for(const id of attendanceSyncing4142){
    attendancePending4142.set(id, {desired:false,seq:++attendanceSeq4142,confirmed:false,day});
  }
  gameNightStats4120 = {completed:0,lastWinner:null,lastPlayedAt:null,lastWinnerPlayers:[]};
  expireCurrentTeams4156();
  previousOfficialGameForReshuffle4120 = null;
  saveSafeStartupSnapshot41121?.();
  return true;
}
let attendanceMidnightTimer4148;
function checkAttendanceDay4148(){
  const changed = rolloverAttendanceDay4148();
  if(changed){
    renderAll();
    if(db && navigator.onLine !== false){
      loadCloudData4120({force:true}).then(()=>renderAll()).catch(e=>console.warn('Daily attendance refresh failed',e));
      refreshGameNightStats4120();
    }
  }
  clearTimeout(attendanceMidnightTimer4148);
  const next = new Date(); next.setHours(24,0,0,0);
  attendanceMidnightTimer4148 = setTimeout(checkAttendanceDay4148, Math.max(50, next.getTime()-Date.now()));
}
window.addEventListener('focus', checkAttendanceDay4148);
window.addEventListener('pageshow', checkAttendanceDay4148);
document.addEventListener('visibilitychange', ()=>{if(!document.hidden) checkAttendanceDay4148();});
checkAttendanceDay4148();


/* ===== 4.15.5 Generate Teams dock — 200px scroll-linked Search Players transition ===== */
let generateDockReturnTimer4152 = 0;
let generateDockOffset4152 = 0;
let generateDockFrame4152 = 0;
const generateDockLastPos4152 = new WeakMap();
const GENERATE_DOCK_SEARCH_TRANSITION_PX_4154 = 200;

function generateDockScrollPos4152(source){
  if(source === window){
    return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
  }
  return Number(source?.scrollTop || 0);
}

function generateDockMaxOffset4152(dock){
  return Math.max(120, Number(dock?.offsetHeight || 0) + 70);
}

function generateDockAttendanceAnchor4152(){
  // Captains/Admins have Search Players. Fall back to the player list for
  // roles where the search row is intentionally hidden.
  return document.getElementById('attendanceSearchRow') || document.getElementById('playerList');
}

function generateDockAttendanceConstraint4152(dock){
  const maxOffset = generateDockMaxOffset4152(dock);
  const attendance = document.getElementById('attendanceCard');
  const anchor = generateDockAttendanceAnchor4152();
  const header = document.querySelector('.topbar');

  if(!attendance || attendance.hidden || !anchor || !header){
    return {offset:0, forceVisible:true, lockedHidden:false, maxOffset, progress:0};
  }

  const attendanceRect = attendance.getBoundingClientRect();
  const anchorRect = anchor.getBoundingClientRect();
  const headerRect = header.getBoundingClientRect();
  if(anchorRect.height <= 0){
    return {offset:0, forceVisible:true, lockedHidden:false, maxOffset, progress:0};
  }

  // If Attendance itself has moved completely above the sticky header, keep
  // the dock fully hidden so it never floats over unrelated sections.
  if(attendanceRect.bottom <= headerRect.bottom){
    return {offset:maxOffset, forceVisible:false, lockedHidden:true, maxOffset, progress:1};
  }

  // 4.15.5: Search Players starts a 200px position-linked transition.
  // Until Search Players reaches the bottom of the sticky header, the dock is
  // fully visible. As Search Players moves behind the header, the dock moves
  // down by the same normalized scroll progress. Reversing the scroll reverses
  // the motion exactly. It takes ~200 px past Search Players to fully hide.
  const threshold = headerRect.bottom + 2;
  const pixelsPastSearch = Math.max(0, threshold - anchorRect.top);
  const progress = Math.max(0, Math.min(1, pixelsPastSearch / GENERATE_DOCK_SEARCH_TRANSITION_PX_4154));
  const offset = maxOffset * progress;

  return {
    offset,
    forceVisible:progress <= 0,
    lockedHidden:progress >= 1,
    maxOffset,
    progress
  };
}

function renderGenerateDockOffset4152(){
  generateDockFrame4152 = 0;
  const dock = document.getElementById('stickybar');
  if(!dock || dock.hidden || document.getElementById('mainPage')?.style.display === 'none') return;
  const constraint = generateDockAttendanceConstraint4152(dock);
  dock.classList.add('generate-scroll-tracking');
  if(Math.abs(generateDockOffset4152-constraint.offset) <= .05) return;
  generateDockOffset4152 = constraint.offset;
  dock.style.setProperty('--generate-scroll-offset', `${generateDockOffset4152.toFixed(2)}px`);
}

function queueGenerateDockRender4152(){
  if(generateDockFrame4152) return;
  generateDockFrame4152 = requestAnimationFrame(renderGenerateDockOffset4152);
}

function settleGenerateDock4152(animate=true){
  const dock = document.getElementById('stickybar');
  if(!dock || dock.hidden) return;
  const constraint = generateDockAttendanceConstraint4152(dock);
  if(!animate) dock.classList.add('generate-scroll-tracking');
  generateDockOffset4152 = constraint.offset;
  dock.style.setProperty('--generate-scroll-offset', `${generateDockOffset4152.toFixed(2)}px`);
  if(!animate){
    requestAnimationFrame(()=>dock.classList.remove('generate-scroll-tracking'));
  }
}

function handleGenerateDockScroll4152(source){
  queueGenerateDockRender4152();
  clearTimeout(generateDockReturnTimer4152);
  generateDockReturnTimer4152 = setTimeout(()=>{
    document.getElementById('stickybar')?.classList.remove('generate-scroll-tracking');
  },140);
}

function resetGenerateDockScroll4152(){
  clearTimeout(generateDockReturnTimer4152);
  if(generateDockFrame4152){
    cancelAnimationFrame(generateDockFrame4152);
    generateDockFrame4152 = 0;
  }
  generateDockOffset4152 = 0;
  const dock = document.getElementById('stickybar');
  if(dock){
    dock.classList.remove('generate-scroll-tracking');
    dock.style.setProperty('--generate-scroll-offset', '0px');
  }
}

function setupGenerateDockScroll4152(){
  const app = document.querySelector('.app');
  generateDockLastPos4152.set(window, generateDockScrollPos4152(window));
  window.addEventListener('scroll', ()=>handleGenerateDockScroll4152(window), {passive:true});
  if(app){
    generateDockLastPos4152.set(app, generateDockScrollPos4152(app));
    app.addEventListener('scroll', ()=>handleGenerateDockScroll4152(app), {passive:true});
  }
  window.addEventListener('resize', ()=>settleGenerateDock4152(true), {passive:true});
  window.addEventListener('pageshow', ()=>setTimeout(()=>settleGenerateDock4152(false), 60));
  window.addEventListener('pagehide', resetGenerateDockScroll4152);
  requestAnimationFrame(()=>settleGenerateDock4152(false));
  setTimeout(()=>settleGenerateDock4152(false), 250);
}
setupGenerateDockScroll4152();


/* Compact injury input: commit on change/Enter, with feedback in the same menu. */
async function saveInjuryControl4157(playerId,input,status,retry){
  if(input.disabled) return;
  retry.hidden = true;
  if(!canManageGames()){status.textContent = 'Captain or Admin only.';return;}
  const player = playerById(playerId);
  if(!player){status.textContent = 'Player no longer exists.';return;}
  const value = input.value.trim();
  const percent = Number(value);
  if(!value || !Number.isFinite(percent) || !Number.isInteger(percent) || percent < 0 || percent > 100){
    input.setAttribute('aria-invalid','true');
    status.textContent = 'Enter a whole number from 0 to 100.';
    return;
  }
  input.removeAttribute('aria-invalid');
  if(percent === Math.round(Number(player.injuryPct ?? 1)*100)){status.textContent = '';return;}
  const owner = currentUser?.id;
  input.disabled = true;status.textContent = 'Saving…';
  try{
    const {error} = await db.from('players').update({injury_pct:percent/100,updated_at:new Date().toISOString()}).eq('id',player.id);
    if(error) throw error;
    if(owner !== currentUser?.id) return;
    const current = playerById(playerId);
    if(current) current.injuryPct = percent/100;
    for(const team of state.currentGame?.teams || []){
      for(const member of team) if(String(member.id) === String(playerId)) member.injuryPct = percent/100;
    }
    // A successful write remains successful even if the follow-up read is offline.
    try{await loadCloudData4120({force:true});}catch(e){console.warn('Injury refresh delayed',e);}
    if(owner !== currentUser?.id) return;
    renderAll();status.textContent = 'Saved';
  }catch(e){
    status.textContent = 'Could not save. Try again.';
    retry.hidden = false;
  }finally{input.disabled = false;}
}
// Compatibility callers now open the inline control instead of a browser prompt.
setInjuryPrompt = function(id){
  openPlayerActions4132(id);
  document.getElementById('playerInjury4157')?.focus({preventScroll:true});
};
window.setInjuryPrompt = setInjuryPrompt;

/* Phone-only portrait preference; the parent covers Sandbox as well. */
function isPhone4157(){
  const mobile = navigator.userAgentData?.mobile || /iPhone|iPod|Android.*Mobile/i.test(navigator.userAgent || '');
  return !!mobile || (window.matchMedia?.('(pointer: coarse)').matches && Math.min(screen.width,screen.height) < 600);
}
function phoneLandscape4157(){
  if(!isPhone4157()) return false;
  // Use physical orientation, not the visual viewport: a keyboard must never
  // be mistaken for rotating a portrait phone into landscape.
  if(screen.orientation?.type) return screen.orientation.type.startsWith('landscape');
  if(typeof window.orientation === 'number') return Math.abs(window.orientation) === 90;
  return screen.width > screen.height;
}
let portraitLockPending4157 = false;
let portraitFocus4157 = null;
async function requestPortrait4157(){
  if(window.parent !== window || !isPhone4157() || !screen.orientation?.lock || portraitLockPending4157) return;
  portraitLockPending4157 = true;
  try{await screen.orientation.lock('portrait-primary');}catch(e){/* Use the visible portrait fallback. */}
  finally{portraitLockPending4157 = false;}
}
function updatePortrait4157(){
  if(window.parent !== window) return;
  const guard = document.getElementById('portraitGuard4157');
  if(!guard) return;
  const landscape = phoneLandscape4157();
  const wasOpen = !guard.hidden;
  document.documentElement.classList.toggle('phone-landscape4157',landscape);
  guard.hidden = !landscape;
  if(landscape && !wasOpen){
    cancelAttendanceGesture4144();
    portraitFocus4157 = document.activeElement;
    document.activeElement?.blur?.();
    guard.focus({preventScroll:true});
  }else if(!landscape && wasOpen){
    if(portraitFocus4157?.isConnected) portraitFocus4157.focus?.({preventScroll:true});
    portraitFocus4157 = null;
  }
}
function setupPortrait4157(){
  if(window.parent !== window) return;
  const changed = ()=>{updatePortrait4157();requestPortrait4157();};
  screen.orientation?.addEventListener?.('change',changed);
  window.addEventListener('orientationchange',changed);
  window.addEventListener('pageshow',changed);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden) changed();});
  // Some supporting browsers permit lock only after a user gesture.
  window.addEventListener('pointerup',requestPortrait4157,{once:true,passive:true});
  changed();
}
setupPortrait4157();
