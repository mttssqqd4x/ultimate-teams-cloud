
const CONFIG = window.ULTIMATE_TEAMS_CONFIG || {};
const SUPABASE_URL = (CONFIG.SUPABASE_URL || "").replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
const SUPABASE_KEY = CONFIG.SUPABASE_PUBLISHABLE_KEY || CONFIG.SUPABASE_ANON_KEY || "";

let db = null;
let currentUser = null;
let profile = { role: "guest", email: "Guest" };

const state = {
  players: [],
  pairRules: [],
  history: {},
  settings: {
    weightHandling: 0.35,
    weightCutting: 0.35,
    weightDefense: 0.30,
    kFactor: 0.08,
    repeatWeight: 4,
    prioritizeHandlerSeparation: false,
    handlerSeparationBoost: 2,
    prioritizeEliteBalance: false,
    eliteBalanceBoost: 2
  },
  currentGame: null,
  selectedWinnerIndex: null,
  resultsSavedForCurrentGame: false,
  showInactive: false
};

document.addEventListener("DOMContentLoaded", init);

async function init(){
  hideSignInBox();
  hideAllModals();

  if(!SUPABASE_URL || !SUPABASE_KEY || SUPABASE_KEY.includes("PASTE_")){
    setAuthMessage("Config missing. Open config.js and paste your Supabase publishable/anon key.");
    renderAll();
    return;
  }

  db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  const { data } = await db.auth.getSession();
  currentUser = data?.session?.user || null;

  db.auth.onAuthStateChange(async (_event, session) => {
    currentUser = session?.user || null;
    await afterAuthChange();
  });

  await afterAuthChange();
}

async function afterAuthChange(){
  if(currentUser) await loadProfile();
  else profile = { role: "guest", email: "Guest" };

  updateAuthButtons();
  await loadCloudData();
  renderAll();
  showPage("main");
}

async function loadProfile(){
  const { data, error } = await db.from("profiles").select("*").eq("id", currentUser.id).maybeSingle();
  if(error){
    profile = { role: "user", email: currentUser.email };
    return;
  }

  if(!data){
    await db.from("profiles").insert({ id: currentUser.id, email: currentUser.email, role: "user" });
    const res = await db.from("profiles").select("*").eq("id", currentUser.id).maybeSingle();
    profile = res.data || { role: "user", email: currentUser.email };
    return;
  }

  profile = data;
}

function normalizedRole(){
  const r = String(profile?.role || "").trim().toLowerCase();
  if(["admin", "captain", "user"].includes(r)) return r;
  return currentUser ? "user" : "guest";
}
function isAdmin(){ return normalizedRole() === "admin"; }
function isCaptain(){ return normalizedRole() === "captain"; }
function isCaptainOrAdmin(){ return isAdmin() || isCaptain(); }
function canManageGames(){ return isCaptainOrAdmin(); }
function canAccessDataPage(){ return isCaptainOrAdmin(); }
function canGenerateTeams(){ return isCaptainOrAdmin(); }
function isPlainUserOrGuest(){ return !isCaptainOrAdmin(); }

function setAuthMessage(msg){
  const el = document.getElementById("authMessage");
  if(el) el.textContent = msg || "";
}
function toggleSignInBox(event){
  if(event?.preventDefault) event.preventDefault();
  const box = document.getElementById("authPage");
  if(!box) return false;
  const show = box.classList.contains("hidden") || box.style.display === "none";
  box.classList.toggle("hidden", !show);
  box.style.display = show ? "block" : "none";
  if(show) setTimeout(() => document.getElementById("authEmail")?.focus(), 50);
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
  const signInBtn = document.getElementById("showSignInBtn");
  const signOutBtn = document.getElementById("signOutBtn");

  if(signInBtn){
    signInBtn.classList.toggle("hidden", signedIn);
    signInBtn.style.display = signedIn ? "none" : "";
  }
  if(signOutBtn){
    signOutBtn.classList.toggle("hidden", !signedIn);
    signOutBtn.style.display = signedIn ? "" : "none";
  }
  if(signedIn) hideSignInBox();
}
async function signUp(){
  const email = document.getElementById("authEmail")?.value.trim();
  const password = document.getElementById("authPassword")?.value;
  if(!email || !password){ setAuthMessage("Enter email and password."); return; }
  const { error } = await db.auth.signUp({ email, password });
  if(error){ setAuthMessage(error.message); return; }
  setAuthMessage("Account created. Check email if confirmation is enabled, then sign in.");
}
async function signIn(){
  const email = document.getElementById("authEmail")?.value.trim();
  const password = document.getElementById("authPassword")?.value;
  if(!email || !password){ setAuthMessage("Enter email and password."); return; }
  const { error } = await db.auth.signInWithPassword({ email, password });
  if(error){ setAuthMessage(error.message); return; }
  hideSignInBox();
}
async function signOut(){
  await db.auth.signOut();
  currentUser = null;
  profile = { role: "guest", email: "Guest" };
  await afterAuthChange();
}

async function loadCloudData(){
  if(!db) return;

  const [playersRes, attendanceRes, pairRes, historyRes, settingsRes, gameRes] = await Promise.all([
    db.from("players").select("*").order("first_name"),
    db.from("attendance").select("*"),
    db.from("pair_rules").select("*").order("created_at"),
    db.from("teammate_history").select("*"),
    db.from("settings").select("*").eq("id", "main").maybeSingle(),
    db.from("current_game").select("*").eq("id", "main").maybeSingle()
  ]);

  if(playersRes.error){
    alert("Players load error: " + playersRes.error.message);
    return;
  }

  const attendance = {};
  (attendanceRes.data || []).forEach(a => attendance[a.player_id] = !!a.present);

  state.players = (playersRes.data || []).map(r => ({
    id: r.id,
    firstName: r.first_name || "",
    lastName: r.last_name || "",
    fullName: r.full_name || `${r.first_name || ""} ${r.last_name || ""}`.trim(),
    handling: Number(r.handling || 0),
    cutting: Number(r.cutting || 0),
    defense: Number(r.defense || 0),
    winLossRating: Number(r.win_loss || 0),
    active: !!r.active,
    injuryPct: Number(r.injury_pct || 1),
    temporary: !!r.temporary,
    gamesPlayed: Number(r.games_played || 0),
    wins: Number(r.wins || 0),
    losses: Number(r.losses || 0),
    attending: !!attendance[r.id]
  }));

  state.pairRules = (pairRes.data || []).map(r => ({
    id: r.id,
    player1Id: r.player1_id,
    player2Id: r.player2_id,
    type: r.rule_type,
    strength: Number(r.strength || 1),
    createdBy: r.created_by || null
  }));

  state.history = {};
  (historyRes.data || []).forEach(h => {
    state.history[pairKey(h.player_a, h.player_b)] = Number(h.count || 0);
  });

  if(settingsRes.data){
    state.settings = {
      weightHandling: Number(settingsRes.data.weight_handling ?? 0.35),
      weightCutting: Number(settingsRes.data.weight_cutting ?? 0.35),
      weightDefense: Number(settingsRes.data.weight_defense ?? 0.30),
      kFactor: Number(settingsRes.data.k_factor ?? 0.08),
      repeatWeight: Number(settingsRes.data.repeat_weight ?? 4),
      prioritizeHandlerSeparation: !!settingsRes.data.prioritize_handler_separation,
      handlerSeparationBoost: Number(settingsRes.data.handler_separation_boost ?? 2),
      prioritizeEliteBalance: !!settingsRes.data.prioritize_elite_balance,
      eliteBalanceBoost: Number(settingsRes.data.elite_balance_boost ?? 2)
    };
  }

  if(gameRes.data?.teams){
    state.currentGame = hydrateGame(gameRes.data.teams);
    state.selectedWinnerIndex = gameRes.data.selected_winner_index;
    state.resultsSavedForCurrentGame = !!gameRes.data.results_saved;
  } else {
    state.currentGame = null;
    state.selectedWinnerIndex = null;
    state.resultsSavedForCurrentGame = false;
  }

  syncSettingsForm();
}

function hydrateGame(rawTeams){
  if(!rawTeams) return null;
  return {
    teams: rawTeams.map(team => team.map(x => {
      const id = x.id || x;
      return state.players.find(p => String(p.id) === String(id)) || x;
    }))
  };
}

function renderAll(){
  updateNavVisibility();
  updateRoleVisibility();
  updateStats();
  updateSelectOptions();
  renderPresentList();
  renderPairRules();
  renderPlayers();
  renderTeams();
  syncSettingsForm();
}

function updateStats(){
  const playerCount = state.players.length;
  const attendingCount = state.players.filter(p => p.attending).length;
  const role = normalizedRole();

  const setText = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = String(val); };

  setText("userEmail", currentUser?.email || "Guest");
  setText("userRole", role);
  setText("statPlayers", playerCount);
  setText("statAttending", attendingCount);
  setText("statPlayersData", playerCount);
  setText("statAttendingData", attendingCount);
  setText("statRoleData", role);
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

function updateRoleVisibility(){
  const showCaptainAdmin = isCaptainOrAdmin();
  const showAdmin = isAdmin();

  if(!showCaptainAdmin) state.showInactive = true;

  document.querySelectorAll(".captain-admin-only").forEach(el => {
    el.classList.toggle("hidden", !showCaptainAdmin);
    el.style.display = showCaptainAdmin ? "" : "none";
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

  ["numTeamsSection", "tempPlayerBox", "pairRulesBox", "saveResultsWrap"].forEach(id => {
    const el = document.getElementById(id);
    if(!el) return;
    el.classList.toggle("hidden", !showCaptainAdmin);
    el.style.display = showCaptainAdmin ? "" : "none";
  });

  const numTeams = document.getElementById("numTeams");
  if(numTeams){
    numTeams.disabled = !showCaptainAdmin;
    const container = document.getElementById("numTeamsSection") || numTeams.closest(".grid") || numTeams.parentElement;
    if(container){
      container.classList.toggle("hidden", !showCaptainAdmin);
      container.style.display = showCaptainAdmin ? "" : "none";
    }
  }

  const toggleInactiveBtn = document.getElementById("toggleInactiveBtn");
  if(toggleInactiveBtn){
    toggleInactiveBtn.classList.toggle("hidden", !showCaptainAdmin);
    toggleInactiveBtn.style.display = showCaptainAdmin ? "" : "none";
  }

  const sticky = document.getElementById("stickybar");
  if(sticky){
    const mainVisible = document.getElementById("mainPage")?.style.display !== "none";
    const show = showCaptainAdmin && mainVisible;
    sticky.classList.toggle("hidden", !show);
    sticky.style.display = show ? "" : "none";
  }
}

function showPage(page){
  if(page === "data" && !canAccessDataPage()) page = "main";

  const mainPage = document.getElementById("mainPage");
  const dataPage = document.getElementById("dataPage");
  const mainBtn = document.getElementById("mainTabBtn");
  const dataBtn = document.getElementById("dataTabBtn");

  if(mainPage) mainPage.style.display = page === "main" ? "block" : "none";
  if(dataPage) dataPage.style.display = page === "data" ? "block" : "none";
  if(mainBtn) mainBtn.classList.toggle("tab-active", page === "main");
  if(dataBtn) dataBtn.classList.toggle("tab-active", page === "data");

  updateNavVisibility();
  updateRoleVisibility();
  syncSettingsForm();
  updateStats();
}

function playerById(id){
  return state.players.find(p => String(p.id) === String(id));
}

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
  const aHas = hasLastName(a), bHas = hasLastName(b);
  if(aHas && !bHas) return -1;
  if(!aHas && bHas) return 1;
  const last = getLastNameForSort(a).toLowerCase().localeCompare(getLastNameForSort(b).toLowerCase());
  if(last) return last;
  const first = getFirstNameForSort(a).toLowerCase().localeCompare(getFirstNameForSort(b).toLowerCase());
  if(first) return first;
  return String(a.fullName || "").localeCompare(String(b.fullName || ""));
}

function presentPlayers(){
  return [...state.players].filter(p => p.attending).sort(comparePlayersByLastName);
}

function renderPresentList(){
  const box = document.getElementById("presentPlayersList");
  const count = document.getElementById("presentCount");
  if(!box) return;

  const present = presentPlayers();
  if(count) count.textContent = String(present.length);

  if(!present.length){
    box.innerHTML = '<div class="small">No players marked present.</div>';
    return;
  }

  box.innerHTML = present.map(p => `
    <div class="present-row">
      <span class="present-name">${escapeHtml(p.fullName)}</span>
      <span class="present-meta">${p.active ? "Active" : "Inactive"}</span>
    </div>
  `).join("");
}

function renderPlayers(){
  const list = document.getElementById("playerList");
  if(!list) return;

  const search = (document.getElementById("playerSearch")?.value || "").trim().toLowerCase();
  const players = [...state.players]
    .filter(p => isPlainUserOrGuest() || state.showInactive || p.active)
    .filter(p => !search || p.fullName.toLowerCase().includes(search))
    .sort(comparePlayersByLastName);

  if(!players.length){
    list.innerHTML = '<div class="small">No players match that search.</div>';
    return;
  }

  list.innerHTML = "";

  players.forEach(p => {
    const row = document.createElement("div");
    row.className = "player clickable" + (p.attending ? " attend-on" : "") + (!p.active ? " inactive" : "") + (p.temporary ? " temp" : "");
    row.onclick = e => {
      if(e.target.closest("button")) return;
      toggleAttendance(p.id);
    };

    const controls = canManageGames()
      ? `<div class="toggle-wrap">
          <button onclick="event.stopPropagation(); toggleActive('${p.id}')">${p.active ? "Inactive" : "Active"}</button>
          <button onclick="event.stopPropagation(); setInjuryPrompt('${p.id}')">Injury %</button>
          ${p.temporary ? `<button class="btn-danger" onclick="event.stopPropagation(); removePlayer('${p.id}')">Remove</button>` : ""}
        </div>`
      : "";

    row.innerHTML = `
      <div>
        <div class="player-name">${escapeHtml(p.fullName)}</div>
        ${!p.active ? '<div class="small">Inactive</div>' : ""}
      </div>
      ${controls}
    `;
    list.appendChild(row);
  });
}

async function toggleAttendance(id){
  const p = playerById(id);
  if(!p) return;

  const next = !p.attending;
  p.attending = next;

  renderAll();

  const payload = {
    player_id: p.id,
    present: next,
    updated_at: new Date().toISOString(),
    updated_by: currentUser?.id || null
  };

  const { error } = await db.from("attendance").upsert(payload, { onConflict: "player_id" });
  if(error){
    alert("Attendance save error: " + error.message);
    p.attending = !next;
    renderAll();
    return;
  }

  await loadCloudData();
  renderAll();
}

async function clearAttendance(){
  if(!canManageGames()){ alert("Only captains/admins can clear attendance."); return; }
  if(!confirm("Clear attendance?")) return;
  const rows = state.players.map(p => ({
    player_id: p.id,
    present: false,
    updated_at: new Date().toISOString(),
    updated_by: currentUser?.id || null
  }));
  if(rows.length){
    const { error } = await db.from("attendance").upsert(rows, { onConflict: "player_id" });
    if(error){ alert(error.message); return; }
  }
  await loadCloudData();
  renderAll();
}

function clearPlayerSearch(){
  const el = document.getElementById("playerSearch");
  if(el) el.value = "";
  renderPlayers();
}

function toggleShowInactive(){
  if(!canManageGames()) return;
  state.showInactive = !state.showInactive;
  updateShowInactiveButton();
  renderPlayers();
}
function updateShowInactiveButton(){
  const btn = document.getElementById("toggleInactiveBtn");
  if(btn) btn.textContent = state.showInactive ? "Hide Inactive Players" : "Show Inactive Players";
}

async function toggleActive(id){
  if(!canManageGames()) return;
  const p = playerById(id);
  if(!p) return;
  const { error } = await db.from("players").update({ active: !p.active, updated_at: new Date().toISOString() }).eq("id", p.id);
  if(error){ alert(error.message); return; }
  await loadCloudData();
  renderAll();
}

async function setInjuryPrompt(id){
  if(!canManageGames()) return;
  const p = playerById(id);
  if(!p) return;
  const val = prompt("Enter available percent, e.g. 80 for 80%", Math.round((p.injuryPct || 1) * 100));
  if(val === null) return;
  const injury = Math.max(0, Math.min(100, Number(val))) / 100;
  const { error } = await db.from("players").update({ injury_pct: injury, updated_at: new Date().toISOString() }).eq("id", p.id);
  if(error){ alert(error.message); return; }
  await loadCloudData();
  renderAll();
}

async function removePlayer(id){
  if(!canManageGames()) return;
  const p = playerById(id);
  if(!p?.temporary){ alert("Only temporary players can be removed here."); return; }
  const { error } = await db.from("players").delete().eq("id", id);
  if(error){ alert(error.message); return; }
  await loadCloudData();
  renderAll();
}

function updateSelectOptions(){
  const all = [...state.players].sort(comparePlayersByLastName);
  const present = presentPlayers();

  setSelectOptions("tempLike", all);
  setSelectOptions("pairP1", present);
  setSelectOptions("pairP2", present);
}
function setSelectOptions(id, players){
  const sel = document.getElementById(id);
  if(!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">Select...</option>';
  players.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.fullName;
    sel.appendChild(opt);
  });
  sel.value = current;
}

function loadTempRatingsFromLike(){
  const id = document.getElementById("tempLike")?.value;
  const src = playerById(id);
  if(!src) return;
  setValue("tempHandling", src.handling);
  setValue("tempCutting", src.cutting);
  setValue("tempDefense", src.defense);
}

async function addTempPlayer(){
  if(!canManageGames()){ alert("Captain/admin only."); return; }
  const fullName = normalizeName(document.getElementById("tempName")?.value || "");
  if(!fullName){ alert("Enter a player name."); return; }
  const { first, last } = splitName(fullName);

  const payload = {
    first_name: first,
    last_name: last,
    handling: Number(document.getElementById("tempHandling")?.value || 3),
    cutting: Number(document.getElementById("tempCutting")?.value || 3),
    defense: Number(document.getElementById("tempDefense")?.value || 3),
    win_loss: 0,
    active: true,
    injury_pct: 1,
    temporary: true,
    updated_at: new Date().toISOString()
  };

  const { data, error } = await db.from("players").insert(payload).select().single();
  if(error){ alert(error.message); return; }

  await db.from("attendance").upsert({
    player_id: data.id,
    present: true,
    updated_at: new Date().toISOString(),
    updated_by: currentUser?.id || null
  }, { onConflict: "player_id" });

  document.getElementById("tempName").value = "";
  await loadCloudData();
  renderAll();
}

function visiblePairRules(){
  if(isAdmin()) return state.pairRules;
  if(isCaptain()) return state.pairRules.filter(r => r.createdBy === currentUser?.id);
  return [];
}
function renderPairRules(){
  const box = document.getElementById("pairRuleList");
  if(!box) return;

  const rules = visiblePairRules();
  if(!rules.length){
    box.innerHTML = '<div class="small">No pair rules yet.</div>';
    return;
  }

  box.innerHTML = "";
  rules.forEach(r => {
    const p1 = playerById(r.player1Id);
    const p2 = playerById(r.player2Id);
    const div = document.createElement("div");
    const locked = Number(r.strength || 0) >= 999;
    const typeLabel = r.type === "together" ? "Together" : "Apart";
    div.className = "player " + (r.type === "together" ? "pair-card-together" : "pair-card-apart");
    div.innerHTML = `
      <div>
        <div class="player-name">${escapeHtml(p1?.fullName || "Unknown")} ↔ ${escapeHtml(p2?.fullName || "Unknown")}</div>
        <div class="small">${locked ? "Locked " + typeLabel : typeLabel + " · Strength " + Number(r.strength || 1).toFixed(1)}</div>
      </div>
      <div class="toggle-wrap"><button class="btn-danger" onclick="removePairRule('${r.id}')">Remove</button></div>
    `;
    box.appendChild(div);
  });
}

async function addPairRule(){
  if(!canManageGames()){ alert("Captain/admin only."); return; }
  const p1 = document.getElementById("pairP1")?.value;
  const p2 = document.getElementById("pairP2")?.value;
  const type = document.getElementById("pairType")?.value || "apart";
  const strength = Number(document.getElementById("pairStrength")?.value || 1);
  if(!p1 || !p2 || p1 === p2){ alert("Choose two different players."); return; }

  const { error } = await db.from("pair_rules").insert({
    player1_id: p1,
    player2_id: p2,
    rule_type: type,
    strength,
    created_by: currentUser?.id || null
  });
  if(error){ alert(error.message); return; }
  await loadCloudData();
  renderAll();
}
async function lockPair(){
  if(!canManageGames()){ alert("Captain/admin only."); return; }
  const p1 = document.getElementById("pairP1")?.value;
  const p2 = document.getElementById("pairP2")?.value;
  if(!p1 || !p2 || p1 === p2){ alert("Choose two different players."); return; }

  const { error } = await db.from("pair_rules").insert({
    player1_id: p1,
    player2_id: p2,
    rule_type: "together",
    strength: 999,
    created_by: currentUser?.id || null
  });
  if(error){ alert(error.message); return; }
  await loadCloudData();
  renderAll();
}
async function removePairRule(id){
  if(!canManageGames()) return;
  const rule = state.pairRules.find(r => String(r.id) === String(id));
  if(!rule) return;
  if(isCaptain() && rule.createdBy !== currentUser?.id){
    alert("You can only remove your own pair rules.");
    return;
  }
  const { error } = await db.from("pair_rules").delete().eq("id", id);
  if(error){ alert(error.message); return; }
  await loadCloudData();
  renderAll();
}
async function clearPairRules(){
  if(!canManageGames()) return;
  if(!confirm(isAdmin() ? "Clear all pair rules?" : "Clear your pair rules?")) return;

  let query = db.from("pair_rules").delete();
  if(isAdmin()) query = query.not("id", "is", null);
  else query = query.eq("created_by", currentUser?.id);

  const { error } = await query;
  if(error){ alert(error.message); return; }
  await loadCloudData();
  renderAll();
}

function effectiveHandling(p){
  const inj = Number(p.injuryPct) || 1;
  return (Number(p.handling) || 0) * (0.5 + 0.5 * inj);
}
function effectiveCutting(p){
  const inj = Number(p.injuryPct) || 1;
  return (Number(p.cutting) || 0) * inj;
}
function effectiveDefense(p){
  const inj = Number(p.injuryPct) || 1;
  return (Number(p.defense) || 0) * inj;
}
function baseOverall(p){
  const s = state.settings;
  return effectiveHandling(p) * Number(s.weightHandling || 0.35)
    + effectiveCutting(p) * Number(s.weightCutting || 0.35)
    + effectiveDefense(p) * Number(s.weightDefense || 0.30);
}
function overall(p){
  return baseOverall(p) + Number(p.winLossRating || 0);
}
function teamStats(team){
  return {
    count: team.length,
    overall: team.reduce((sum, p) => sum + overall(p), 0),
    handling: team.reduce((sum, p) => sum + effectiveHandling(p), 0),
    cutting: team.reduce((sum, p) => sum + effectiveCutting(p), 0),
    defense: team.reduce((sum, p) => sum + effectiveDefense(p), 0)
  };
}
function expectedWinProb(teamStrength, oppStrength){
  return 1 / (1 + Math.pow(10, ((oppStrength - teamStrength) / 4)));
}
function pairKey(a, b){
  return String(a) < String(b) ? `${a}|${b}` : `${b}|${a}`;
}
function spread(values){
  if(!values.length) return 0;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((sum, x) => sum + Math.pow(x - avg, 2), 0);
}
function shuffle(arr){
  const a = [...arr];
  for(let i = a.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function makeInitialTeams(players, numTeams){
  const arr = shuffle(players).sort((a, b) => overall(b) - overall(a));
  const teams = Array.from({ length: numTeams }, () => []);
  let idx = 0;
  let forward = true;

  while(idx < arr.length){
    const order = forward ? [...teams.keys()] : [...teams.keys()].reverse();
    order.forEach(teamIndex => {
      if(idx < arr.length) teams[teamIndex].push(arr[idx++]);
    });
    forward = !forward;
  }

  return teams;
}
function cloneTeams(teams){
  return teams.map(team => [...team]);
}
function scoreTeams(teams, repeatWeight = state.settings.repeatWeight){
  const s = state.settings;
  const stats = teams.map(teamStats);
  let score = 0;

  score += spread(stats.map(x => x.count)) * 120;
  score += spread(stats.map(x => x.overall)) * 14;
  score += spread(stats.map(x => x.handling)) * (s.prioritizeHandlerSeparation ? 5 * Number(s.handlerSeparationBoost || 2) : 5);
  score += spread(stats.map(x => x.cutting)) * 5;
  score += spread(stats.map(x => x.defense)) * 5;

  if(s.prioritizeEliteBalance){
    const eliteBoost = Number(s.eliteBalanceBoost || 2);
    const topOveralls = teams.map(team => Math.max(...team.map(p => overall(p))));
    score += spread(topOveralls) * (10 * eliteBoost);
  }

  const teamOf = {};
  teams.forEach((team, teamIndex) => team.forEach(p => teamOf[p.id] = teamIndex));

  state.pairRules.forEach(r => {
    const same = teamOf[r.player1Id] === teamOf[r.player2Id];
    if(r.type === "together" && !same) score += 30 * Number(r.strength || 1);
    if(r.type === "apart" && same) score += 30 * Number(r.strength || 1);
  });

  teams.forEach(team => {
    for(let i = 0; i < team.length; i++){
      for(let j = i + 1; j < team.length; j++){
        score += (state.history[pairKey(team[i].id, team[j].id)] || 0) * Number(repeatWeight || 0);
      }
    }
  });

  return score;
}
function optimizeTeams(initial, repeatWeight = state.settings.repeatWeight){
  let best = cloneTeams(initial);
  let bestScore = scoreTeams(best, repeatWeight);
  let improved = true;
  let passes = 0;

  while(improved && passes < 300){
    improved = false;
    passes++;

    for(let a = 0; a < best.length; a++){
      for(let b = a + 1; b < best.length; b++){
        for(let i = 0; i < best[a].length; i++){
          for(let j = 0; j < best[b].length; j++){
            const candidate = cloneTeams(best);
            [candidate[a][i], candidate[b][j]] = [candidate[b][j], candidate[a][i]];
            const score = scoreTeams(candidate, repeatWeight);
            if(score < bestScore){
              best = candidate;
              bestScore = score;
              improved = true;
            }
          }
        }
      }
    }
  }

  return { teams: best, score: bestScore };
}

async function generateTeamsButton(){
  if(!canGenerateTeams()){ alert("Only captains/admins can generate teams."); return; }

  if(state.currentGame && !state.resultsSavedForCurrentGame){
    alert("Reminder: current game results have not been saved. If you want this game to count toward season stats and Win/Loss ratings, save results before or after generating the next teams.");
  }

  await generateGame();
}
async function generateGame(){
  if(!canGenerateTeams()){ alert("Only captains/admins can generate teams."); return; }
  const players = presentPlayers();
  const numTeams = Math.max(2, Number(document.getElementById("numTeams")?.value || 2));

  if(players.length < numTeams){
    alert("Not enough attending players for that many teams.");
    return;
  }

  let best = null;
  for(let i = 0; i < 60; i++){
    const candidate = optimizeTeams(makeInitialTeams(players, numTeams), Number(state.settings.repeatWeight || 4));
    if(!best || candidate.score < best.score) best = candidate;
  }

  state.currentGame = { teams: best.teams };
  state.selectedWinnerIndex = null;
  state.resultsSavedForCurrentGame = false;
  await saveCurrentGameToDb(false);
  renderAll();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function serializableTeams(){
  return (state.currentGame?.teams || []).map(team => team.map(p => ({ id: p.id, fullName: p.fullName })));
}
async function saveCurrentGameToDb(saved){
  const { error } = await db.from("current_game").upsert({
    id: "main",
    teams: serializableTeams(),
    selected_winner_index: state.selectedWinnerIndex,
    results_saved: !!saved,
    generated_at: new Date().toISOString(),
    updated_by: currentUser?.id || null
  });
  if(error) alert(error.message);
}
function renderTeams(){
  const out = document.getElementById("teamsOutput");
  const resultMessage = document.getElementById("resultMessage");
  if(resultMessage) resultMessage.textContent = "";
  if(!out) return;

  if(!state.currentGame){
    out.innerHTML = '<div class="small">No game generated yet.</div>';
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = "grid grid-3";

  state.currentGame.teams.forEach((team, idx) => {
    const stats = teamStats(team);
    const box = document.createElement("div");
    let cls = "teambox team-clickable";
    if(state.selectedWinnerIndex !== null) cls += idx === state.selectedWinnerIndex ? " team-win" : " team-loss";
    box.className = cls;
    box.onclick = () => selectWinner(idx);

    const teamMeta = canManageGames()
      ? `<span class="small">${stats.overall.toFixed(2)}</span>`
      : `<span class="small">${team.length} players</span>`;

    const ratings = canManageGames()
      ? `<div class="small">H ${stats.handling.toFixed(1)} · C ${stats.cutting.toFixed(1)} · D ${stats.defense.toFixed(1)}</div>`
      : "";

    const rows = team.map(p => canManageGames()
      ? `<div class="row" style="justify-content:space-between"><span>${escapeHtml(p.fullName)}</span><span class="small">${overall(p).toFixed(2)}</span></div>`
      : `<div class="row" style="justify-content:space-between"><span>${escapeHtml(p.fullName)}</span></div>`
    ).join("");

    box.innerHTML = `<div class="teamhead"><strong>Team ${idx + 1}</strong>${teamMeta}</div>${ratings}<div class="hr"></div>${rows}`;
    wrap.appendChild(box);
  });

  out.innerHTML = "";
  out.appendChild(wrap);
}
function selectWinner(teamIndex){
  if(!canManageGames()) return;
  state.selectedWinnerIndex = state.selectedWinnerIndex === teamIndex ? null : teamIndex;
  saveCurrentGameToDb(false);
  renderTeams();
}
async function saveResults(){
  if(!canManageGames()){ alert("Captain/admin only."); return; }
  if(!state.currentGame){ alert("Generate teams first."); return; }
  if(state.selectedWinnerIndex === null){ alert("Tap the winning team first."); return; }
  if(state.resultsSavedForCurrentGame && !confirm("Results already saved. Save again anyway?")) return;

  const winner = state.currentGame.teams[state.selectedWinnerIndex];
  const losers = state.currentGame.teams.filter((_, i) => i !== state.selectedWinnerIndex);
  const winnerStrength = teamStats(winner).overall;
  const updates = new Map();

  state.currentGame.teams.flat().forEach(p => updates.set(p.id, { ...p }));

  losers.forEach(loserTeam => {
    const loserStrength = teamStats(loserTeam).overall;
    const winnerExpected = expectedWinProb(winnerStrength, loserStrength);
    const loserExpected = expectedWinProb(loserStrength, winnerStrength);
    const scaledK = Number(state.settings.kFactor || 0.08) / Math.max(1, losers.length);

    const winnerDelta = scaledK * (1 - winnerExpected);
    const loserDelta = scaledK * (0 - loserExpected);

    winner.forEach(p => updates.get(p.id).winLossRating += winnerDelta);
    loserTeam.forEach(p => updates.get(p.id).winLossRating += loserDelta);
  });

  state.currentGame.teams.forEach((team, idx) => {
    team.forEach(p => {
      const u = updates.get(p.id);
      u.gamesPlayed = Number(u.gamesPlayed || 0) + 1;
      if(idx === state.selectedWinnerIndex) u.wins = Number(u.wins || 0) + 1;
      else u.losses = Number(u.losses || 0) + 1;
    });
  });

  for(const p of updates.values()){
    const { error } = await db.from("players").update({
      win_loss: p.winLossRating,
      games_played: p.gamesPlayed,
      wins: p.wins,
      losses: p.losses,
      updated_at: new Date().toISOString()
    }).eq("id", p.id);
    if(error){ alert(error.message); return; }

    await db.from("rating_history").insert({ player_id: p.id, value: p.winLossRating });
  }

  await addCurrentTeamsToHistory();
  await db.from("games").insert({
    teams: serializableTeams(),
    winner_team_index: state.selectedWinnerIndex,
    created_by: currentUser?.id || null
  });

  state.resultsSavedForCurrentGame = true;
  await saveCurrentGameToDb(true);
  await loadCloudData();
  renderAll();
  const msg = document.getElementById("resultMessage");
  if(msg) msg.textContent = "Results saved.";
}
async function addCurrentTeamsToHistory(){
  const rows = [];
  (state.currentGame?.teams || []).forEach(team => {
    for(let i = 0; i < team.length; i++){
      for(let j = i + 1; j < team.length; j++){
        const key = pairKey(team[i].id, team[j].id);
        const [a, b] = key.split("|");
        state.history[key] = (state.history[key] || 0) + 1;
        rows.push({ player_a: a, player_b: b, count: state.history[key] });
      }
    }
  });
  if(rows.length){
    const { error } = await db.from("teammate_history").upsert(rows, { onConflict: "player_a,player_b" });
    if(error) alert(error.message);
  }
}

function syncSettingsForm(){
  const s = state.settings;
  setValue("weightHandling", s.weightHandling);
  setValue("weightCutting", s.weightCutting);
  setValue("weightDefense", s.weightDefense);
  setValue("kFactor", s.kFactor);
  setValue("repeatWeight", s.repeatWeight);
  setValue("handlerSeparationBoost", s.handlerSeparationBoost);
  updateBoolButtons();
}
function updateBoolButtons(){
  const handler = document.getElementById("handlerSeparationBtn");
  const elite = document.getElementById("eliteBalanceBtn");
  if(handler){
    handler.textContent = "Handler Separation: " + (state.settings.prioritizeHandlerSeparation ? "On" : "Off");
    handler.className = state.settings.prioritizeHandlerSeparation ? "btn" : "btn-secondary";
  }
  if(elite){
    elite.textContent = "Elite Balance: " + (state.settings.prioritizeEliteBalance ? "On" : "Off");
    elite.className = state.settings.prioritizeEliteBalance ? "btn" : "btn-secondary";
  }
}
function toggleSettingBool(key){
  if(!isAdmin()) return;
  state.settings[key] = !state.settings[key];
  updateBoolButtons();
}
async function saveSettings(){
  if(!isAdmin()){ alert("Admin only."); return; }

  const s = state.settings;
  s.weightHandling = Number(document.getElementById("weightHandling")?.value || 0.35);
  s.weightCutting = Number(document.getElementById("weightCutting")?.value || 0.35);
  s.weightDefense = Number(document.getElementById("weightDefense")?.value || 0.30);
  s.kFactor = Number(document.getElementById("kFactor")?.value || 0.08);
  s.repeatWeight = Number(document.getElementById("repeatWeight")?.value || 4);
  s.handlerSeparationBoost = Number(document.getElementById("handlerSeparationBoost")?.value || 2);

  const { error } = await db.from("settings").upsert({
    id: "main",
    weight_handling: s.weightHandling,
    weight_cutting: s.weightCutting,
    weight_defense: s.weightDefense,
    k_factor: s.kFactor,
    repeat_weight: s.repeatWeight,
    prioritize_handler_separation: s.prioritizeHandlerSeparation,
    handler_separation_boost: s.handlerSeparationBoost,
    prioritize_elite_balance: s.prioritizeEliteBalance,
    elite_balance_boost: s.eliteBalanceBoost,
    updated_at: new Date().toISOString()
  });

  if(error) alert(error.message);
  else alert("Settings saved.");
}

function parseCsv(text){
  const rows = [];
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if(lines.length < 2) return rows;
  const headers = splitCsvLine(lines[0]).map(h => h.trim());
  lines.slice(1).forEach(line => {
    const cols = splitCsvLine(line);
    const obj = {};
    headers.forEach((h, i) => obj[h] = (cols[i] || "").trim());
    rows.push(obj);
  });
  return rows;
}
function splitCsvLine(line){
  const out = [];
  let cur = "", q = false;
  for(let i = 0; i < line.length; i++){
    const ch = line[i];
    if(ch === '"' && line[i + 1] === '"'){ cur += '"'; i++; }
    else if(ch === '"'){ q = !q; }
    else if(ch === "," && !q){ out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
function describeImport(rows, inactive){
  const changes = [];
  rows.forEach(r => {
    const first = (r["First Name"] || "").trim();
    const last = (r["Last Name"] || "").trim();
    if(!first && !last) return;
    const full = normalizeName(`${first} ${last}`);
    const existing = state.players.find(p => p.fullName.toLowerCase() === full.toLowerCase());
    const next = {
      handling: Number(r["Handling"] || 0),
      cutting: Number(r["Cutting"] || 0),
      defense: Number(r["Defense"] || 0),
      winLossRating: Number(r["Win/Loss"] || r["Win/Loss Rating"] || r["WinLossRating"] || 0),
      active: !inactive
    };
    if(!existing){
      changes.push({ type: "Add", name: full, details: `H ${next.handling} · C ${next.cutting} · D ${next.defense} · W/L ${next.winLossRating.toFixed(2)} · ${next.active ? "active" : "inactive"}` });
    } else {
      const parts = [];
      if(Number(existing.handling) !== next.handling) parts.push(`H ${existing.handling} → ${next.handling}`);
      if(Number(existing.cutting) !== next.cutting) parts.push(`C ${existing.cutting} → ${next.cutting}`);
      if(Number(existing.defense) !== next.defense) parts.push(`D ${existing.defense} → ${next.defense}`);
      if(Number(existing.winLossRating) !== next.winLossRating) parts.push(`W/L ${existing.winLossRating.toFixed(2)} → ${next.winLossRating.toFixed(2)}`);
      if(existing.active !== next.active) parts.push(`${existing.active ? "active" : "inactive"} → ${next.active ? "active" : "inactive"}`);
      changes.push({ type: "Update", name: full, details: parts.length ? parts.join(" · ") : "no rating/status changes" });
    }
  });
  return changes;
}
function previewCsv(inactive){
  if(!isAdmin()){ alert("Admin only."); return; }
  const text = document.getElementById(inactive ? "inactiveCsv" : "activeCsv")?.value.trim();
  if(!text){ alert("Paste CSV first."); return; }
  const changes = describeImport(parseCsv(text), inactive);
  renderPreview("importPreviewBox", "importPreviewSummary", "importPreviewList", changes, `${changes.length} rows scanned`);
}
async function importCsv(inactive){
  if(!isAdmin()){ alert("Admin only."); return; }
  const text = document.getElementById(inactive ? "inactiveCsv" : "activeCsv")?.value.trim();
  if(!text){ alert("Paste CSV first."); return; }
  const rows = parseCsv(text);
  for(const r of rows){
    const first = (r["First Name"] || "").trim();
    const last = (r["Last Name"] || "").trim();
    if(!first && !last) continue;
    const payload = {
      first_name: first,
      last_name: last,
      handling: Number(r["Handling"] || 0),
      cutting: Number(r["Cutting"] || 0),
      defense: Number(r["Defense"] || 0),
      win_loss: Number(r["Win/Loss"] || r["Win/Loss Rating"] || r["WinLossRating"] || 0),
      active: !inactive,
      updated_at: new Date().toISOString()
    };
    const { data, error } = await db.from("players").upsert(payload, { onConflict: "first_name,last_name" }).select().single();
    if(error){ alert(error.message); return; }
    await db.from("rating_history").insert({ player_id: data.id, value: payload.win_loss });
  }
  await loadCloudData();
  renderAll();
  alert(`Imported ${rows.length} rows.`);
}
function closeImportPreview(){ const el = document.getElementById("importPreviewBox"); if(el) el.style.display = "none"; }

function previewSeasonStatsCsv(){
  if(!isAdmin()){ alert("Admin only."); return; }
  const text = document.getElementById("seasonStatsCsv")?.value.trim();
  if(!text){ alert("Paste season_stats.csv first."); return; }

  const changes = parseCsv(text).map(r => {
    const full = normalizeName(`${r["First Name"] || ""} ${r["Last Name"] || ""}`);
    const existing = state.players.find(p => p.fullName.toLowerCase() === full.toLowerCase());
    if(!existing) return { type: "Missing", name: full, details: "No matching player" };
    return {
      type: "Update",
      name: full,
      details: `Games ${existing.gamesPlayed} → ${Number(r["Games Played"] || 0)} · Wins ${existing.wins} → ${Number(r["Wins"] || 0)} · Losses ${existing.losses} → ${Number(r["Losses"] || 0)}`
    };
  });
  renderPreview("seasonPreviewBox", "seasonPreviewSummary", "seasonPreviewList", changes, `${changes.length} season rows scanned`);
}
async function importSeasonStatsCsv(){
  if(!isAdmin()){ alert("Admin only."); return; }
  const text = document.getElementById("seasonStatsCsv")?.value.trim();
  if(!text){ alert("Paste season_stats.csv first."); return; }

  let updated = 0, missing = 0;
  for(const r of parseCsv(text)){
    const full = normalizeName(`${r["First Name"] || ""} ${r["Last Name"] || ""}`);
    const existing = state.players.find(p => p.fullName.toLowerCase() === full.toLowerCase());
    if(!existing){ missing++; continue; }
    const { error } = await db.from("players").update({
      games_played: Number(r["Games Played"] || 0),
      wins: Number(r["Wins"] || 0),
      losses: Number(r["Losses"] || 0),
      updated_at: new Date().toISOString()
    }).eq("id", existing.id);
    if(error){ alert(error.message); return; }
    updated++;
  }
  await loadCloudData();
  renderAll();
  alert(`Imported season stats for ${updated} players.${missing ? ` ${missing} rows did not match existing players.` : ""}`);
}
function closeSeasonPreview(){ const el = document.getElementById("seasonPreviewBox"); if(el) el.style.display = "none"; }
function renderPreview(boxId, summaryId, listId, items, summary){
  const box = document.getElementById(boxId), sum = document.getElementById(summaryId), list = document.getElementById(listId);
  if(box) box.style.display = "block";
  if(sum) sum.textContent = summary;
  if(list){
    list.innerHTML = items.length ? items.map(i => `
      <div class="player"><div><div class="player-name">${escapeHtml(i.type)}: ${escapeHtml(i.name)}</div><div class="small">${escapeHtml(i.details)}</div></div></div>
    `).join("") : '<div class="small">No valid rows found.</div>';
  }
}

function getDatePrefix(){
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`;
}
function escapeCsv(v){
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function downloadBlob(filename, content, type){
  const blob = new Blob([content], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
function downloadBackupJson(){
  if(!isAdmin()){ alert("Admin only."); return; }
  downloadBlob(`${getDatePrefix()}_ultimate-teams-backup.json`, JSON.stringify(state, null, 2), "application/json");
}
function downloadRatingsCsv(){
  if(!canAccessDataPage()){ alert("Captain/admin only."); return; }
  const sorted = [...state.players].sort(comparePlayersByLastName);
  const headers = ["First Name", "Last Name", "Handling", "Cutting", "Defense", "Win/Loss"];
  const build = players => [headers, ...players.map(p => [
    p.firstName, p.lastName, p.handling, p.cutting, p.defense, Number(p.winLossRating || 0).toFixed(2)
  ])].map(row => row.map(escapeCsv).join(",")).join("\n");

  const stats = [["First Name", "Last Name", "Games Played", "Wins", "Losses", "Win %", "Win/Loss"],
    ...sorted.map(p => [
      p.firstName, p.lastName, p.gamesPlayed, p.wins, p.losses,
      p.gamesPlayed ? ((p.wins / p.gamesPlayed) * 100).toFixed(1) + "%" : "0.0%",
      Number(p.winLossRating || 0).toFixed(2)
    ])
  ].map(row => row.map(escapeCsv).join(",")).join("\n");

  const prefix = getDatePrefix();
  downloadBlob(`${prefix}_active_players.csv`, build(sorted.filter(p => p.active)), "text/csv");
  setTimeout(() => downloadBlob(`${prefix}_inactive_players.csv`, build(sorted.filter(p => !p.active)), "text/csv"), 250);
  setTimeout(() => downloadBlob(`${prefix}_season_stats.csv`, stats, "text/csv"), 500);
}
async function resetSeasonStats(){
  if(!isAdmin()){ alert("Admin only."); return; }
  if(!confirm("Reset Games Played, Wins, and Losses for all players?")) return;
  const { error } = await db.from("players").update({ games_played: 0, wins: 0, losses: 0, updated_at: new Date().toISOString() }).not("id", "is", null);
  if(error){ alert(error.message); return; }
  await loadCloudData();
  renderAll();
}
async function resetHistory(){
  if(!isAdmin()){ alert("Admin only."); return; }
  if(!confirm("Reset teammate history?")) return;
  const { error } = await db.from("teammate_history").delete().not("player_a", "is", null);
  if(error){ alert(error.message); return; }
  await loadCloudData();
  renderAll();
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
  if(event?.target?.id === id) hideModal(id);
}
function clearModalSearch(id){
  const el = document.getElementById(id);
  if(el) el.value = "";
}
function hideAllModals(){
  ["ratingsModal", "editPlayerModal"].forEach(hideModal);
}
function openRatingsModal(show = true){
  if(!canAccessDataPage()){ alert("Captain/admin only."); return; }
  const content = document.getElementById("ratingsModalContent");
  if(!content) return;

  const search = (document.getElementById("ratingsSearch")?.value || "").trim().toLowerCase();
  const players = [...state.players]
    .filter(p => !search || p.fullName.toLowerCase().includes(search))
    .sort(comparePlayersByLastName);

  content.innerHTML = players.length ? players.map((p, i) => `
    <div class="player">
      <div>
        <div class="player-name">${i + 1}. ${escapeHtml(p.fullName)}</div>
        <div class="small">Overall ${overall(p).toFixed(2)} · H ${Number(p.handling).toFixed(1)} · C ${Number(p.cutting).toFixed(1)} · D ${Number(p.defense).toFixed(1)} · W/L ${Number(p.winLossRating).toFixed(2)} · Games ${p.gamesPlayed} · Wins ${p.wins} · Losses ${p.losses} · ${p.active ? "Active" : "Inactive"}</div>
      </div>
    </div>
  `).join("") : '<div class="small">No players match that search.</div>';

  if(show) showModal("ratingsModal");
}

let selectedEditPlayerId = null;
function openEditPlayerModal(show = true){
  if(!canAccessDataPage()){ alert("Captain/admin only."); return; }

  const list = document.getElementById("editPlayerModalList");
  if(!list) return;

  const search = (document.getElementById("editPlayerSearch")?.value || "").trim().toLowerCase();
  const players = [...state.players]
    .filter(p => !search || p.fullName.toLowerCase().includes(search))
    .sort(comparePlayersByLastName);

  list.innerHTML = players.length ? players.map(p => `
    <div class="player clickable" onclick="selectPlayerForEdit('${p.id}')">
      <div>
        <div class="player-name">${escapeHtml(p.fullName)}</div>
        <div class="small">${isAdmin() ? `H ${Number(p.handling).toFixed(1)} · C ${Number(p.cutting).toFixed(1)} · D ${Number(p.defense).toFixed(1)} · W/L ${Number(p.winLossRating).toFixed(2)}` : "Name edit only"}</div>
      </div>
    </div>
  `).join("") : '<div class="small">No players match that search.</div>';

  const help = document.getElementById("editPlayerHelp");
  if(help) help.textContent = isAdmin()
    ? "Admins can edit names and ratings."
    : "Captains can edit player names only. Ratings are locked.";

  updateRoleVisibility();
  if(show) showModal("editPlayerModal");
}
function selectPlayerForEdit(id){
  const p = playerById(id);
  if(!p) return;
  selectedEditPlayerId = p.id;

  const empty = document.getElementById("editPlayerFormEmpty");
  const form = document.getElementById("editPlayerForm");
  if(empty) empty.style.display = "none";
  if(form) form.style.display = "block";

  setValue("editFirstName", p.firstName);
  setValue("editLastName", p.lastName);
  setValue("editHandling", Number(p.handling).toFixed(1));
  setValue("editCutting", Number(p.cutting).toFixed(1));
  setValue("editDefense", Number(p.defense).toFixed(1));
  setValue("editWinLoss", Number(p.winLossRating).toFixed(2));

  ["editHandling", "editCutting", "editDefense", "editWinLoss"].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.disabled = !isAdmin();
  });

  const status = document.getElementById("editPlayerStatus");
  if(status) status.textContent = `${p.active ? "Active" : "Inactive"} · Games ${p.gamesPlayed} · Wins ${p.wins} · Losses ${p.losses}`;
}
async function saveEditedPlayer(){
  if(!canAccessDataPage()){ alert("Captain/admin only."); return; }
  const p = playerById(selectedEditPlayerId);
  if(!p){ alert("Select a player first."); return; }

  const first = (document.getElementById("editFirstName")?.value || "").trim();
  const last = (document.getElementById("editLastName")?.value || "").trim();
  if(!first && !last){ alert("Enter a valid player name."); return; }

  const payload = {
    first_name: first,
    last_name: last,
    updated_at: new Date().toISOString()
  };

  if(isAdmin()){
    payload.handling = Number(document.getElementById("editHandling")?.value || 0);
    payload.cutting = Number(document.getElementById("editCutting")?.value || 0);
    payload.defense = Number(document.getElementById("editDefense")?.value || 0);
    payload.win_loss = Number(document.getElementById("editWinLoss")?.value || 0);
  }

  const { error } = await db.from("players").update(payload).eq("id", p.id);
  if(error){ alert(error.message); return; }

  await loadCloudData();
  renderAll();
  openEditPlayerModal(false);
  selectPlayerForEdit(p.id);
  alert("Player updated.");
}
async function deleteEditedPlayer(){
  if(!isAdmin()){ alert("Admin only."); return; }
  const p = playerById(selectedEditPlayerId);
  if(!p){ alert("Select a player first."); return; }
  if(!confirm(`Delete ${p.fullName}? This cannot be undone.`)) return;
  const { error } = await db.from("players").delete().eq("id", p.id);
  if(error){ alert(error.message); return; }
  selectedEditPlayerId = null;
  await loadCloudData();
  renderAll();
  openEditPlayerModal(false);
}

function normalizeName(str){
  return String(str || "").trim().replace(/\s+/g, " ");
}
function splitName(full){
  const parts = normalizeName(full).split(" ").filter(Boolean);
  return { first: parts[0] || "", last: parts.slice(1).join(" ") };
}
function setValue(id, value){
  const el = document.getElementById(id);
  if(el) el.value = value ?? "";
}
function escapeHtml(str){
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
