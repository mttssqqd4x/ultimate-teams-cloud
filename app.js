
const CONFIG = window.ULTIMATE_TEAMS_CONFIG || {};
const SUPABASE_URL = (CONFIG.SUPABASE_URL || "").replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
const SUPABASE_KEY = CONFIG.SUPABASE_PUBLISHABLE_KEY || CONFIG.SUPABASE_ANON_KEY || "";
const APP_AUTH_REDIRECT_URL = CONFIG.AUTH_REDIRECT_URL || "https://nmultimateteams.app";
const VAPID_PUBLIC_KEY = CONFIG.VAPID_PUBLIC_KEY || "";
const APP_VERSION = "4.10.8";

let db = null;
let currentUser = null;
let profile = { role: "guest", email: "Guest" };
let currentGameChannel = null;
let profileChannel = null;
let liveRefreshTimer = null;

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
  currentGameGeneratedAt: null,
  selectedWinnerIndex: null,
  resultsSavedForCurrentGame: false,
  showInactive: false
};

document.addEventListener("DOMContentLoaded", init);



function notifyOtherTabsAuthConfirmed(){
  try{
    localStorage.setItem("ultimateTeamsAuthConfirmedAt", String(Date.now()));
    window.dispatchEvent(new StorageEvent("storage", { key: "ultimateTeamsAuthConfirmedAt", newValue: String(Date.now()) }));
  }catch(e){}
  try{
    const channel = new BroadcastChannel("ultimate-teams-auth");
    channel.postMessage({ type: "auth-confirmed", at: Date.now() });
    channel.close();
  }catch(e){}
}

function listenForAuthConfirmedFromOtherTab(){
  const handle = async () => {
    try{
      const { data } = await db.auth.getSession();
      currentUser = data?.session?.user || currentUser;
      await afterAuthChange();
      showAuthConfirmedMessage();
    }catch(e){
      console.warn("Auth confirmed refresh failed", e);
    }
  };

  window.addEventListener("storage", e => {
    if(e.key === "ultimateTeamsAuthConfirmedAt") handle();
  });

  try{
    const channel = new BroadcastChannel("ultimate-teams-auth");
    channel.onmessage = e => {
      if(e.data?.type === "auth-confirmed") handle();
    };
  }catch(e){}
}

async function completeAuthRedirectIfNeeded(){
  const params = new URLSearchParams(window.location.search || "");
  const hash = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));
  const hasAuthCode = !!params.get("code");
  const hasHashToken = !!hash.get("access_token") || !!hash.get("refresh_token");
  const authType = params.get("type") || hash.get("type") || "";

  if(hasAuthCode && db?.auth?.exchangeCodeForSession){
    const { error } = await db.auth.exchangeCodeForSession(params.get("code"));
    if(error) console.warn("Auth confirmation exchange failed", error);
  }

  if(hasAuthCode || hasHashToken || authType === "signup"){
    try{
      window.history.replaceState({}, document.title, window.location.origin + window.location.pathname);
    }catch(e){}

    notifyOtherTabsAuthConfirmed();
    setTimeout(() => showAuthConfirmedMessage(), 300);
  }
}

function showAuthConfirmedMessage(){
  const modal = document.getElementById("authConfirmedModal");
  if(modal) showModal("authConfirmedModal");
}

async function init(){
  hideSignInBox();
  hideAllModals();

  if(!SUPABASE_URL || !SUPABASE_KEY || SUPABASE_KEY.includes("PASTE_")){
    setAuthMessage("Config missing. Open config.js and paste your Supabase publishable/anon key.");
    renderAll();
    return;
  }

  db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  subscribeToLiveDataUpdates();
  listenForAuthConfirmedFromOtherTab();
  await completeAuthRedirectIfNeeded();

  const { data } = await db.auth.getSession();
  currentUser = data?.session?.user || null;

  db.auth.onAuthStateChange(async (_event, session) => {
    currentUser = session?.user || null;
    await afterAuthChange();
  });

  await afterAuthChange();
}


function subscribeToLiveDataUpdates(){
  if(!db || currentGameChannel) return;

  currentGameChannel = db
    .channel("app-live-data")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "current_game", filter: "id=eq.main" },
      () => scheduleLiveRefresh()
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "attendance" },
      () => scheduleLiveRefresh()
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "players" },
      () => scheduleLiveRefresh()
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "pair_rules" },
      () => scheduleLiveRefresh()
    )
    .subscribe(status => {
      console.log("Live data updates:", status);
    });
}

function scheduleLiveRefresh(){
  if(liveRefreshTimer) clearTimeout(liveRefreshTimer);

  liveRefreshTimer = setTimeout(async () => {
    try{
      await loadCloudData();
      renderAll();
    }catch(e){
      console.warn("Live refresh failed", e);
    }
  }, 150);
}

async function afterAuthChange(){
  if(currentUser){
    await loadProfile();
    subscribeToProfileUpdates();
  }else{
    profile = { role: "guest", email: "Guest" };
    unsubscribeFromProfileUpdates();
  }

  updateAuthButtons();
  await loadCloudData();
  renderAll();
  await handleRoleMilestones();
  showPage("main");
}


async function sendAppInfoEmail(emailType){
  if(!currentUser) return false;
  try{
    const { data, error } = await db.functions.invoke("send-app-info-email", {
      body: { type: emailType }
    });

    if(error){
      console.warn("App info email failed", error);
      return false;
    }

    console.log("App info email result", data);
    return true;
  }catch(e){
    console.warn("App info email failed", e);
    return false;
  }
}

function showAccountCreatedMessage(){
  showModal("accountCreatedModal");
}

function showCaptainWelcomeMessage(){
  showModal("captainWelcomeModal");
}

async function handleRoleMilestones(){
  if(!currentUser) return;

  if(normalizedRole() === "captain"){
    const key = `ultimateTeamsCaptainWelcomeShown_${currentUser.id}`;
    if(!localStorage.getItem(key)){
      localStorage.setItem(key, "1");
      await sendAppInfoEmail("captain");
      showCaptainWelcomeMessage();
    }
  }
}

function subscribeToProfileUpdates(){
  if(!db) return;
  unsubscribeFromProfileUpdates();
  if(!currentUser) return;

  profileChannel = db
    .channel(`profile-live-${currentUser.id}`)
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${currentUser.id}` },
      async payload => {
        profile = payload.new || profile;
        updateAuthButtons();
        await loadCloudData();
        renderAll();
        await handleRoleMilestones();
        if(normalizedRole() === "captain") showCaptainWelcomeMessage();
      }
    )
    .subscribe(status => console.log("Profile live updates:", status));
}

function unsubscribeFromProfileUpdates(){
  if(profileChannel && db){
    db.removeChannel(profileChannel);
  }
  profileChannel = null;
}


async function loadProfile(){
  const { data, error } = await db.from("profiles").select("*").eq("id", currentUser.id).maybeSingle();
  if(error){
    profile = { role: "user", email: currentUser.email };
    return;
  }

  if(!data){
    const meta = currentUser.user_metadata || {};
    const basePayload = { id: currentUser.id, email: currentUser.email, role: "user" };
    const extendedPayload = {
      ...basePayload,
      first_name: meta.first_name || "",
      last_name: meta.last_name || "",
      full_name: meta.full_name || `${meta.first_name || ""} ${meta.last_name || ""}`.trim()
    };

    let insertRes = await db.from("profiles").insert(extendedPayload);
    if(insertRes.error){
      insertRes = await db.from("profiles").insert(basePayload);
    }

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
function canMarkAttendance(){ return !!currentUser; }
function isGuest(){ return !currentUser; }

function setAuthMessage(msg){
  const el = document.getElementById("authMessage");
  if(el) el.textContent = msg || "";
}

function showSignInSection(){
  const signIn = document.getElementById("authSignInSection");
  const create = document.getElementById("authCreateAccountSection");
  if(signIn){
    signIn.classList.remove("hidden");
    signIn.style.display = "block";
  }
  if(create){
    create.classList.add("hidden");
    create.style.display = "none";
  }
  setAuthMessage("");
}

function showCreateAccountSection(){
  const signIn = document.getElementById("authSignInSection");
  const create = document.getElementById("authCreateAccountSection");
  if(signIn){
    signIn.classList.add("hidden");
    signIn.style.display = "none";
  }
  if(create){
    create.classList.remove("hidden");
    create.style.display = "block";
  }

  const signInEmail = document.getElementById("authEmail")?.value || "";
  const signInPassword = document.getElementById("authPassword")?.value || "";
  const signupEmail = document.getElementById("authSignupEmail");
  const signupPassword = document.getElementById("authSignupPassword");
  if(signupEmail && !signupEmail.value) signupEmail.value = signInEmail;
  if(signupPassword && !signupPassword.value) signupPassword.value = signInPassword;

  setAuthMessage("");
  setTimeout(() => document.getElementById("authFirstName")?.focus(), 50);
}

function toggleSignInBox(event){
  if(event?.preventDefault) event.preventDefault();
  const box = document.getElementById("authPage");
  if(!box) return false;
  const show = box.classList.contains("hidden") || box.style.display === "none";
  box.classList.toggle("hidden", !show);
  box.style.display = show ? "block" : "none";
  if(show){
    showSignInSection();
    setTimeout(() => document.getElementById("authEmail")?.focus(), 50);
  }
  return false;
}
function hideSignInBox(){
  const box = document.getElementById("authPage");
  if(box){
    box.classList.add("hidden");
    box.style.display = "none";
  }
  const signIn = document.getElementById("authSignInSection");
  const create = document.getElementById("authCreateAccountSection");
  if(signIn){
    signIn.classList.remove("hidden");
    signIn.style.display = "block";
  }
  if(create){
    create.classList.add("hidden");
    create.style.display = "none";
  }
}
function updateAuthButtons(){
  const signedIn = !!currentUser;
  const signInBtn = document.getElementById("showSignInBtn");
  const accountBtn = document.getElementById("accountBtn");

  if(signInBtn){
    signInBtn.classList.toggle("hidden", signedIn);
    signInBtn.style.display = signedIn ? "none" : "";
  }
  if(accountBtn){
    accountBtn.classList.toggle("hidden", !signedIn);
    accountBtn.style.display = signedIn ? "" : "none";
  }
  if(signedIn) hideSignInBox();
}

async function signUp(){
  const firstName = (document.getElementById("authFirstName")?.value || "").trim();
  const lastName = (document.getElementById("authLastName")?.value || "").trim();
  const email = document.getElementById("authSignupEmail")?.value.trim();
  const password = document.getElementById("authSignupPassword")?.value;

  if(!firstName || !lastName){
    setAuthMessage("Enter first and last name to create an account.");
    return;
  }
  if(!email || !password){
    setAuthMessage("Enter email and password.");
    return;
  }

  const fullName = `${firstName} ${lastName}`.trim();

  const { data, error } = await db.auth.signUp({
    email,
    password,
    options: {
      data: {
        first_name: firstName,
        last_name: lastName,
        full_name: fullName
      }
    }
  });

  if(error){ setAuthMessage(error.message); return; }

  let session = data?.session || null;

  if(!session){
    const signInRes = await db.auth.signInWithPassword({ email, password });
    if(signInRes.error){
      showSignInSection();
      const signInEmail = document.getElementById("authEmail");
      if(signInEmail) signInEmail.value = email;
      setAuthMessage("Account created, but Supabase still requires email confirmation. Turn off Confirm Email in Supabase to auto sign in new players.");
      return;
    }
    session = signInRes.data?.session || null;
  }

  const sessionRes = await db.auth.getSession();
  currentUser = sessionRes.data?.session?.user || session?.user || data?.user || null;

  await afterAuthChange();
  await sendAppInfoEmail("player");
  showAccountCreatedMessage();
  setAuthMessage("");
}
async function signIn(){
  const email = document.getElementById("authEmail")?.value.trim();
  const password = document.getElementById("authPassword")?.value;
  if(!email || !password){ setAuthMessage("Enter email and password."); return; }
  const { error } = await db.auth.signInWithPassword({ email, password });
  if(error){ setAuthMessage(error.message); return; }
  hideSignInBox();
  await afterAuthChange();
}
async 
function openAccountModal(){
  if(!currentUser){
    toggleSignInBox();
    return;
  }
  const emailLine = document.getElementById("accountEmailLine");
  if(emailLine) emailLine.textContent = `Signed in as ${currentUser.email || profile?.email || "user"}`;
  showModal("accountModal");
  updateNotificationUi();
}

function signOut(){
  showModal("signOutConfirmModal");
}

async function confirmSignOut(){
  hideModal("signOutConfirmModal");
  hideModal("accountModal");
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
    createdBy: r.created_by || null,
    createdByRole: r.created_by_role || null
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

  if(gameRes.data?.teams && Array.isArray(gameRes.data.teams) && gameRes.data.teams.length){
    state.currentGame = hydrateGame(gameRes.data.teams);
    state.currentGameGeneratedAt = gameRes.data.generated_at || null;
    state.selectedWinnerIndex = gameRes.data.selected_winner_index;
    state.resultsSavedForCurrentGame = !!gameRes.data.results_saved;
  } else {
    state.currentGame = null;
    state.currentGameGeneratedAt = null;
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


function urlBase64ToUint8Array(base64String){
  const padding = "=".repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for(let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

function pushSupported(){
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function vapidConfigured(){
  return VAPID_PUBLIC_KEY && !VAPID_PUBLIC_KEY.includes("PASTE_");
}

async function getServiceWorkerRegistration(){
  if(!("serviceWorker" in navigator)) return null;
  try{
    return await navigator.serviceWorker.register("./service-worker.js");
  }catch(e){
    console.warn("Service worker registration failed", e);
    return await navigator.serviceWorker.ready.catch(() => null);
  }
}

async function enablePushNotifications(){
  if(!currentUser){
    alert("Sign in before enabling notifications.");
    toggleSignInBox();
    return false;
  }

  const toggle = document.getElementById("pushToggle");

  if(!pushSupported()){
    setPushStatus("Push notifications are not supported in this browser.");
    if(toggle) toggle.checked = false;
    return false;
  }

  if(!vapidConfigured()){
    setPushStatus("Push notifications are not configured yet. Add your VAPID public key to config.js.");
    if(toggle) toggle.checked = false;
    return false;
  }

  const permission = await Notification.requestPermission();
  if(permission !== "granted"){
    setPushStatus("Notifications are not enabled. Browser permission is currently: " + permission + ".");
    if(toggle) toggle.checked = false;
    await updateNotificationUi(false);
    return false;
  }

  setPushStatus("Turning notifications on...");

  const registration = await getServiceWorkerRegistration();
  if(!registration){
    setPushStatus("Could not register the service worker for notifications.");
    if(toggle) toggle.checked = false;
    return false;
  }

  try{
    if(navigator.serviceWorker?.ready) await navigator.serviceWorker.ready;
  }catch(e){}

  let subscription = await registration.pushManager.getSubscription();
  if(!subscription){
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    });
  }

  const json = subscription.toJSON();
  const { error } = await db.from("push_subscriptions").upsert({
    user_id: currentUser.id,
    endpoint: json.endpoint,
    p256dh: json.keys?.p256dh || "",
    auth: json.keys?.auth || "",
    user_agent: navigator.userAgent,
    updated_at: new Date().toISOString()
  }, { onConflict: "endpoint" });

  if(error){
    setPushStatus("Could not save notification subscription: " + error.message);
    if(toggle) toggle.checked = false;
    return false;
  }

  setPushStatus("Notifications enabled.");
  if(toggle){
    toggle.checked = true;
    toggle.disabled = false;
  }

  // Safari can report the subscription a moment late after the permission prompt.
  setTimeout(() => updateNotificationUi(true), 500);
  return true;
}

async function disablePushNotifications(){
  if(!currentUser){
    setPushStatus("Sign in first.");
    return false;
  }

  const toggle = document.getElementById("pushToggle");
  setPushStatus("Turning notifications off...");

  if(pushSupported()){
    const registration = await navigator.serviceWorker.ready.catch(() => null);
    const subscription = registration ? await subscriptionFromRegistration(registration) : null;
    if(subscription){
      await subscription.unsubscribe().catch(() => {});
      await db.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint);
    }
  }

  await db.from("push_subscriptions").delete().eq("user_id", currentUser.id);
  setPushStatus("Notifications disabled.");
  if(toggle){
    toggle.checked = false;
    toggle.disabled = false;
  }
  setTimeout(() => updateNotificationUi(false), 250);
  return true;
}

async function togglePushNotificationsFromSwitch(toggle){
  if(!toggle) return;
  toggle.disabled = true;

  const desired = !!toggle.checked;
  const ok = desired ? await enablePushNotifications() : await disablePushNotifications();

  if(!ok) toggle.checked = !desired;
  toggle.disabled = false;
}

function setPushStatus(message){
  const el = document.getElementById("pushStatus");
  if(el) el.textContent = message || "";
}

async function subscriptionFromRegistration(registration){
  if(!registration?.pushManager) return null;
  try{
    return await registration.pushManager.getSubscription();
  }catch(e){
    return null;
  }
}

async function updateNotificationUi(forceSubscribed = null){
  const box = document.getElementById("pushNotificationsBox");
  const toggle = document.getElementById("pushToggle");
  if(!box) return;

  if(!currentUser){
    box.style.display = "none";
    return;
  }

  box.style.display = "";

  if(!pushSupported()){
    setPushStatus("Push notifications are not supported in this browser.");
    if(toggle){
      toggle.checked = false;
      toggle.disabled = true;
    }
    return;
  }

  if(!vapidConfigured()){
    setPushStatus("Push notifications are not configured yet.");
    if(toggle){
      toggle.checked = false;
      toggle.disabled = true;
    }
    return;
  }

  const permission = Notification.permission;
  if(permission === "denied"){
    setPushStatus("Notifications are blocked in browser settings.");
    if(toggle){
      toggle.checked = false;
      toggle.disabled = true;
    }
    return;
  }

  let subscribed = forceSubscribed === true;
  if(forceSubscribed !== true){
    try{
      const registration = await getServiceWorkerRegistration();
      const subscription = registration ? await subscriptionFromRegistration(registration) : null;
      subscribed = !!subscription;
    }catch(e){
      subscribed = false;
    }
  }

  if(toggle){
    toggle.checked = subscribed;
    toggle.disabled = false;
  }

  if(subscribed){
    setPushStatus("Notifications enabled.");
  }else{
    setPushStatus(permission === "granted" ? "Notifications allowed, but this device is not subscribed yet." : "Notifications are off for this device.");
  }
}

async function askAdminWhetherToSendTeamNotification(){
  if(!canManageGames()) return false;
  return confirm("Send a push notification to signed-in users that new teams were generated?");
}

async function sendTeamGeneratedNotification(){
  if(!canManageGames()) return;
  try{
    const { data, error } = await db.functions.invoke("send-team-notification", {
      body: {
        title: "New teams are ready",
        body: "New ultimate teams have been generated.",
        url: window.location.origin + window.location.pathname
      }
    });

    if(error){
      alert("Teams were generated, but the push notification failed: " + (error.message || error));
      return;
    }

    console.log("Push notification result", data);
  }catch(e){
    alert("Teams were generated, but the push notification failed: " + (e?.message || e));
  }
}


function ensureV490FeatureUi(){
  // This protects against partial deploy/cache cases where app.js updates but index.html is old.
  const dataPage = document.getElementById("dataPage");
  if(dataPage){
    let toolsGrid = document.querySelector("#dataCaptainTools .player-tools-grid");
    if(!toolsGrid){
      let card = document.getElementById("dataCaptainTools");
      if(!card){
        card = document.createElement("div");
        card.id = "dataCaptainTools";
        card.className = "card captain-admin-only";
        card.innerHTML = '<details open><summary><span class="summary-title">Player Tools</span><span></span></summary><div class="player-tools-grid"></div></details>';
        const firstAdminCard = dataPage.querySelector(".admin-only");
        if(firstAdminCard) dataPage.insertBefore(card, firstAdminCard);
        else dataPage.appendChild(card);
      }
      toolsGrid = card.querySelector(".player-tools-grid");
    }

    const ensureToolButton = (id, label, cls, fnName) => {
      if(document.getElementById(id) || !toolsGrid) return;
      const btn = document.createElement("button");
      btn.id = id;
      btn.className = cls;
      btn.type = "button";
      btn.textContent = label;
      btn.addEventListener("click", () => {
        if(typeof window[fnName] === "function") window[fnName]();
      });
      toolsGrid.appendChild(btn);
    };

    ensureToolButton("viewGameHistoryBtn", "View Game History", "btn-secondary", "openGameHistoryModal");
    ensureToolButton("viewTeammateHistoryBtn", "View Teammate History", "btn-secondary", "openTeammateHistoryModal");
    ensureToolButton("viewAuditLogsBtn", "View Admin Audit Logs", "btn-secondary admin-only", "openAuditLogsModal");
    ensureToolButton("voidLastSavedGameBtn", "Undo/Void Last Saved Game", "btn-danger admin-only", "voidLastSavedGame");
  }

  const saveWrap = document.getElementById("saveResultsWrap");
  if(saveWrap && !document.getElementById("lateAddPlayerBtn")){
    const btn = document.createElement("button");
    btn.id = "lateAddPlayerBtn";
    btn.className = "btn-secondary";
    btn.type = "button";
    btn.textContent = "Late Add Player";
    btn.addEventListener("click", () => {
      if(typeof window.openLateAddModal === "function") window.openLateAddModal();
    });
    const clearBtn = document.getElementById("clearTeamsBtn");
    if(clearBtn) saveWrap.insertBefore(btn, clearBtn);
    else saveWrap.appendChild(btn);
  }

  const accountModal = document.getElementById("accountModal");
  if(accountModal && !document.getElementById("selfProfileBox")){
    const modalCard = accountModal.querySelector(".modal-card");
    const pushBox = document.getElementById("pushNotificationsBox");
    if(modalCard){
      const box = document.createElement("div");
      box.className = "subbox";
      box.id = "selfProfileBox";
      box.style.marginTop = "12px";
      box.innerHTML = `
        <div class="player-name">My player profile</div>
        <div class="small">View your own attendance/game history and Win/Loss record.</div>
        <div class="toolbar" style="margin-top:10px">
          <button id="myAttendanceHistoryBtn" class="btn-secondary" type="button" onclick="openMyAttendanceHistoryModal()">My Attendance History</button>
          <button id="myWinLossRecordBtn" class="btn-secondary" type="button" onclick="openMyWinLossRecordModal()">My Win/Loss Record</button>
        </div>`;
      if(pushBox && pushBox.parentElement === modalCard) modalCard.insertBefore(box, pushBox);
      else modalCard.appendChild(box);
    }
  }
}



function ensureStickyModalHeaders(){
  document.querySelectorAll(".modal-card").forEach(card => {
    const rows = Array.from(card.querySelectorAll(":scope > .row, :scope > div > .row, .row"));
    const header = rows.find(row => {
      const hasClose = row.querySelector('button[onclick*="close"], button[onclick*="modal"], button');
      const hasHeading = row.querySelector("h2, h3, .summary-title, strong");
      return hasClose && hasHeading;
    });
    if(header){
      header.classList.add("modal-header-sticky");
      const closeBtn = Array.from(header.querySelectorAll("button")).find(btn =>
        /close/i.test(btn.textContent || "") ||
        String(btn.getAttribute("onclick") || "").includes("close") ||
        String(btn.getAttribute("onclick") || "").includes("modal")
      );
      if(closeBtn) closeBtn.style.marginRight = "6px";
    }
  });
}



function preventHorizontalModalDrift(){
  document.querySelectorAll(".modal-card, .modal").forEach(el => {
    if(el.dataset.xScrollLocked === "true") return;
    el.dataset.xScrollLocked = "true";
    el.addEventListener("scroll", () => {
      if(el.scrollLeft) el.scrollLeft = 0;
    }, { passive: true });
    el.addEventListener("touchmove", () => {
      if(el.scrollLeft) el.scrollLeft = 0;
    }, { passive: true });
  });
}


function renderAll(){
  preventHorizontalModalDrift();
  ensureV490FeatureUi();
  ensureStickyModalHeaders();
  ensurePlayerSortControls();
  updateNavVisibility();
  updateRoleVisibility();
  updateStats();
  updateSelectOptions();
  renderPresentList();
  renderPairRules();
  renderPlayers();
  renderTeams();
  syncSettingsForm();
  updateTeamsDetailsOpenState();
  updateGameStartTime();
  updateAppVersionLine();
  updateNotificationUi();
}

function updateAppVersionLine(){
  const dataPage = document.getElementById("dataPage");
  if(!dataPage) return;

  // Remove old boxed version card if it exists from a cached/older build.
  document.querySelectorAll("#dataVersionCard").forEach(card => card.remove());

  let el = document.getElementById("dataAppVersionLine");
  if(!el){
    el = document.createElement("div");
    el.id = "dataAppVersionLine";
    el.className = "app-version-line";
    dataPage.appendChild(el);
  }else if(el.parentElement !== dataPage){
    dataPage.appendChild(el);
  }

  el.textContent = `Version: ${APP_VERSION}`;
}

function updateStats(){
  const playerCount = state.players.length;
  const attendingCount = state.players.filter(p => p.attending).length;
  const role = normalizedRole();

  const setText = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = String(val); };

  setText("userEmail", currentUser?.email || "Guest");
  setText("userEmailData", currentUser?.email || "Guest");
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
  document.querySelectorAll(".signed-in-only").forEach(el => {
    const showSignedIn = !!currentUser;
    el.classList.toggle("hidden", !showSignedIn);
    el.style.display = showSignedIn ? "" : "none";
  });

  document.body.classList.add("role-ready");
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


function normalizeNameForMatch(value){
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function currentUserFullNameForMatch(){
  const meta = currentUser?.user_metadata || {};
  const profileName = profile?.full_name || `${profile?.first_name || ""} ${profile?.last_name || ""}`.trim();
  const metaName = meta.full_name || `${meta.first_name || ""} ${meta.last_name || ""}`.trim();
  return normalizeNameForMatch(profileName || metaName);
}

function isCurrentSignedInPlayer(p){
  if(!currentUser || !p) return false;

  const userName = currentUserFullNameForMatch();
  const playerName = normalizeNameForMatch(p.fullName || `${p.firstName || ""} ${p.lastName || ""}`.trim());

  if(userName && playerName && userName === playerName) return true;

  const meta = currentUser.user_metadata || {};
  const userFirst = normalizeNameForMatch(profile?.first_name || meta.first_name);
  const userLast = normalizeNameForMatch(profile?.last_name || meta.last_name);
  const playerFirst = normalizeNameForMatch(p.firstName);
  const playerLast = normalizeNameForMatch(p.lastName);

  return !!(userFirst && userLast && userFirst === playerFirst && userLast === playerLast);
}

function compareAttendancePlayers(a, b){
  const aMe = isCurrentSignedInPlayer(a);
  const bMe = isCurrentSignedInPlayer(b);
  if(aMe && !bMe) return -1;
  if(!aMe && bMe) return 1;
  return comparePlayersByLastName(a, b);
}

function renderPlayers(){
  const list = document.getElementById("playerList");
  if(!list) return;
  if(isGuest()){ list.innerHTML = '<div class="small">Sign in to mark attendance.</div>'; return; }

  const search = (document.getElementById("playerSearch")?.value || "").trim().toLowerCase();
  const players = [...state.players]
    .filter(p => isPlainUserOrGuest() || state.showInactive || p.active)
    .filter(p => !search || p.fullName.toLowerCase().includes(search))
    .sort(compareAttendancePlayers);

  if(!players.length){
    list.innerHTML = '<div class="small">No players match that search.</div>';
    return;
  }

  list.innerHTML = "";

  players.forEach(p => {
    const row = document.createElement("div");
    row.className = "player clickable" + (p.attending ? " attend-on" : "") + (canManageGames() && !p.active ? " inactive" : "") + (p.temporary ? " temp" : "");
    row.onclick = e => {
      if(e.target.closest("button")) return;
      toggleAttendance(p.id);
    };

    const controls = canManageGames()
      ? `<div class="toggle-wrap">
          <button class="${injuryButtonClass(p)}" onclick="event.stopPropagation(); setInjuryPrompt('${p.id}')">${injuryButtonLabel(p)}</button>
          ${p.temporary ? `<button class="btn-danger" onclick="event.stopPropagation(); removePlayer('${p.id}')">Remove</button>` : ""}
        </div>`
      : "";

    row.innerHTML = `
      <div>
        <div class="player-name">${escapeHtml(p.fullName)}${isCurrentSignedInPlayer(p) ? ' <span class="chip">You</span>' : ""}</div>
        ${canManageGames() && !p.active ? '<div class="small">Inactive</div>' : ""}
      </div>
      ${controls}
    `;
    list.appendChild(row);
  });
}


async function saveAttendanceFromApp(playerId, present){
  if(db.rpc){
    const { error } = await db.rpc("mark_attendance_from_app", {
      p_player_id: playerId,
      p_present: present
    });
    if(!error) return { error: null };

    const msg = String(error.message || "");
    const missingFunction = msg.includes("mark_attendance_from_app") || msg.includes("Could not find the function");
    if(!missingFunction) return { error };
  }

  const payload = {
    player_id: playerId,
    present,
    updated_at: new Date().toISOString(),
    updated_by: currentUser?.id || null
  };

  const { error } = await db.from("attendance").upsert(payload, { onConflict: "player_id" });
  if(error) return { error };

  if(present){
    const p = playerById(playerId);
    if(p && !p.active && canManageGames()){
      const { error: activeError } = await db.from("players")
        .update({ active: true, updated_at: new Date().toISOString() })
        .eq("id", playerId);
      if(activeError) return { error: activeError };
    }
  }

  return { error: null };
}

async function toggleAttendance(id){
  if(!canMarkAttendance()){
    alert("Create an account or sign in to mark attendance.");
    toggleSignInBox();
    return;
  }

  const p = playerById(id);
  if(!p) return;

  const next = !p.attending;
  const wasActive = p.active;
  p.attending = next;
  if(next && !p.active) p.active = true;

  renderAll();

  const { error } = await saveAttendanceFromApp(p.id, next);
  if(error){
    alert("Attendance save error: " + error.message);
    p.attending = !next;
    p.active = wasActive;
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

function readAddPlayerForm(){
  const fullName = normalizeName(document.getElementById("tempName")?.value || "");
  if(!fullName) return { error: "Enter a player name." };
  const { first, last } = splitName(fullName);
  return {
    first,
    last,
    handling: Number(document.getElementById("tempHandling")?.value || 3),
    cutting: Number(document.getElementById("tempCutting")?.value || 3),
    defense: Number(document.getElementById("tempDefense")?.value || 3)
  };
}

function setAddPlayerStatus(message){
  const status = document.getElementById("addPlayerStatus");
  if(status) status.textContent = message || "";
}

async function insertPlayerFromAddForm({ temporary }){
  if(!canManageGames()){ alert("Captain/admin only."); return; }

  const form = readAddPlayerForm();
  if(form.error){ alert(form.error); return; }

  setAddPlayerStatus(temporary ? "Adding one-time player..." : "Adding permanent player...");

  const { error } = await db.rpc("add_player_from_app", {
    p_first_name: form.first,
    p_last_name: form.last,
    p_handling: form.handling,
    p_cutting: form.cutting,
    p_defense: form.defense,
    p_temporary: !!temporary,
    p_mark_present: true
  });

  if(error){
    setAddPlayerStatus("Add failed.");
    alert(error.message);
    return;
  }

  document.getElementById("tempName").value = "";
  await loadCloudData();
  renderAll();

  setAddPlayerStatus(temporary ? "One-time player added." : "Player added permanently and marked present.");
  setTimeout(() => {
    const status = document.getElementById("addPlayerStatus");
    if(status && (status.textContent === "One-time player added." || status.textContent === "Player added permanently and marked present.")) status.textContent = "";
  }, 3000);
}

async function addTempPlayer(){
  await insertPlayerFromAddForm({ temporary: true });
}

async function addPermanentPlayer(){
  await insertPlayerFromAddForm({ temporary: false });
}

function visiblePairRules(){
  if(!isCaptainOrAdmin()) return [];
  if(isAdmin()) return state.pairRules;

  // Admin-created rules are hidden from captains but still loaded into state.pairRules,
  // so they still apply during team generation. Captain-created rules are visible to
  // all captains/admins and apply to all generated games.
  return state.pairRules.filter(r => r.createdByRole !== "admin");
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
    const ownerLabel = r.createdByRole === "admin" ? '<span class="pill-admin">Admin rule</span>' : '<span class="chip">Captain rule</span>';
    const canEditRule = isAdmin() || (isCaptain() && r.createdBy === currentUser?.id && r.createdByRole !== "admin");
    const safe = editDomId("pairrule", r.id);
    div.className = "player " + (r.type === "together" ? "pair-card-together" : "pair-card-apart");

    const editControls = canEditRule ? `
      <div class="grid grid-3" style="margin-top:10px">
        <div><label>Rule</label><select id="${safe}-type"><option value="apart" ${r.type === "apart" ? "selected" : ""}>Apart</option><option value="together" ${r.type === "together" ? "selected" : ""}>Together</option></select></div>
        <div><label>Strength</label><input id="${safe}-strength" type="number" min="0.1" max="999" step="0.1" value="${Number(r.strength || 1)}"></div>
        <div><label>&nbsp;</label><button class="btn-secondary" type="button" onclick="updatePairRule('${escapeHtml(String(r.id))}')">Save Rule</button></div>
      </div>` : "";

    div.innerHTML = `
      <div style="width:100%">
        <div class="row" style="justify-content:space-between;align-items:flex-start;gap:10px">
          <div>
            <div class="player-name">${escapeHtml(p1?.fullName || "Unknown")} ↔ ${escapeHtml(p2?.fullName || "Unknown")} ${ownerLabel}</div>
            <div class="small">${locked ? "Locked " + typeLabel : typeLabel + " · Strength " + Number(r.strength || 1).toFixed(1)}</div>
          </div>
          <div class="toggle-wrap"><button class="btn-danger" onclick="removePairRule('${escapeHtml(String(r.id))}')">Remove</button></div>
        </div>
        ${editControls}
      </div>
    `;
    box.appendChild(div);
  });
}

async function updatePairRule(id){
  if(!canManageGames()) return;
  const rule = state.pairRules.find(r => String(r.id) === String(id));
  if(!rule) return;
  if(isCaptain() && rule.createdBy !== currentUser?.id){
    alert("You can only edit pair rules that you created.");
    return;
  }

  const safe = editDomId("pairrule", rule.id);
  const type = document.getElementById(`${safe}-type`)?.value || rule.type;
  const strength = Number(document.getElementById(`${safe}-strength`)?.value || rule.strength || 1);
  const { error } = await db.from("pair_rules").update({ rule_type: type, strength }).eq("id", rule.id);
  if(error){ alert(error.message); return; }
  await loadCloudData();
  renderAll();
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
    created_by: currentUser?.id || null,
    created_by_role: normalizedRole()
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
    created_by: currentUser?.id || null,
    created_by_role: normalizedRole()
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
    alert("You can only remove pair rules that you created.");
    return;
  }
  const { error } = await db.from("pair_rules").delete().eq("id", id);
  if(error){ alert(error.message); return; }
  await loadCloudData();
  renderAll();
}
async function clearPairRules(){
  if(!canManageGames()) return;
  const message = isAdmin()
    ? "Clear all pair rules, including admin rules and captain rules?"
    : "Clear your pair rules?";
  if(!confirm(message)) return;

  let error = null;
  if(isAdmin()){
    const ids = visiblePairRules().map(r => r.id).filter(Boolean);
    if(!ids.length){ alert("No pair rules to clear."); return; }
    const res = await db.from("pair_rules").delete().in("id", ids);
    error = res.error;
  }else{
    const res = await db.from("pair_rules").delete().eq("created_by", currentUser?.id);
    error = res.error;
  }

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
  const a = Number(teamStrength || 0);
  const b = Number(oppStrength || 0);
  return 1 / (1 + Math.pow(10, ((b - a) / 4)));
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


function confirmContinueWithoutResults(){
  return new Promise(resolve => {
    let modal = document.getElementById("continueWithoutResultsModal");

    if(!modal){
      modal = document.createElement("div");
      modal.id = "continueWithoutResultsModal";
      modal.className = "modal-backdrop";
      modal.innerHTML = `
        <div class="modal-card" onclick="event.stopPropagation()">
          <h2 style="margin-top:0">Results not saved</h2>
          <div class="notice" style="line-height:1.45">
            Reminder: results have not been saved for the current game.<br><br>
            Continue without recording the results?<br><br>
            Choosing <strong>Yes, continue</strong> saves teammate pairings only and generates next teams.<br>
            Wins/losses and Win/Loss ratings will not be updated.
          </div>
          <div class="toolbar" style="margin-top:14px">
            <button id="continueNoBtn" class="btn-secondary" type="button">No, go back</button>
            <button id="continueYesBtn" class="btn-warn" type="button">Yes, continue</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }

    const cleanup = result => {
      modal.classList.remove("modal-open");
      modal.style.display = "none";
      resolve(result);
    };

    modal.querySelector("#continueNoBtn").onclick = () => cleanup(false);
    modal.querySelector("#continueYesBtn").onclick = () => cleanup(true);
    modal.onclick = e => {
      if(e.target === modal) cleanup(false);
    };

    modal.classList.add("modal-open");
    modal.style.display = "flex";
  });
}

async function generateTeamsButton(){
  if(!canGenerateTeams()){ alert("Only captains/admins can generate teams."); return; }

  if(state.currentGame && !state.resultsSavedForCurrentGame){
    const continueWithoutResults = await confirmContinueWithoutResults();
    if(!continueWithoutResults) return;
    await savePairingsOnlyForCurrentGame();
  }

  const sendPush = await askAdminWhetherToSendTeamNotification();
  await generateGame(sendPush);
}
async function generateGame(sendPushNotification = false){
  if(!canGenerateTeams()){ alert("Only captains/admins can generate teams."); return; }

  // Pull fresh attendance/players/pair rules immediately before generating so captains
  // do not accidentally build teams from stale open-page data.
  await loadCloudData();

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

  state.currentGameGeneratedAt = new Date().toISOString();
  state.currentGame = { teams: best.teams };
  state.selectedWinnerIndex = null;
  state.resultsSavedForCurrentGame = false;
  await saveCurrentGameToDb(false);
  if(sendPushNotification) await sendTeamGeneratedNotification();
  renderAll();
  updateTeamsDetailsOpenState();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function serializableTeams(){
  return (state.currentGame?.teams || []).map(team => team.map(p => ({ id: p.id, fullName: p.fullName })));
}
async function saveCurrentGameToDb(saved){
  if(state.currentGame && !state.currentGameGeneratedAt){
    state.currentGameGeneratedAt = new Date().toISOString();
  }
  const { error } = await db.from("current_game").upsert({
    id: "main",
    teams: serializableTeams(),
    selected_winner_index: state.selectedWinnerIndex,
    results_saved: !!saved,
    generated_at: state.currentGameGeneratedAt || new Date().toISOString(),
    updated_by: currentUser?.id || null
  });
  if(error) alert(error.message);
}


async function clearCurrentTeams(){
  if(!isAdmin()){ alert("Admin only."); return; }
  if(!state.currentGame){
    alert("There are no generated teams to clear.");
    return;
  }
  if(!confirm("Clear the currently generated teams? This does not change player ratings or attendance.")) return;

  state.currentGame = null;
  state.currentGameGeneratedAt = null;
  state.selectedWinnerIndex = null;
  state.resultsSavedForCurrentGame = false;

  const { error } = await db.from("current_game").upsert({
    id: "main",
    teams: [],
    selected_winner_index: null,
    results_saved: true,
    generated_at: new Date().toISOString(),
    updated_by: currentUser?.id || null
  }, { onConflict: "id" });

  if(error){
    alert("Could not clear teams: " + error.message);
    return;
  }

  renderAll();
  updateTeamsDetailsOpenState();
}

function updateTeamsDetailsOpenState(){
  const details = document.getElementById("teamsDetails");
  if(!details) return;
  details.open = !!state.currentGame;
}

function formatGameStartTime(value){
  if(!value) return "";
  const d = new Date(value);
  if(Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function updateGameStartTime(){
  const el = document.getElementById("gameStartTime");
  if(!el) return;
  if(!state.currentGame){
    el.textContent = "";
    return;
  }
  const time = formatGameStartTime(state.currentGameGeneratedAt);
  el.textContent = time ? `Started ${time}` : "Started time unavailable";
}

function renderTeams(){
  updateGameStartTime();
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
  if(state.selectedWinnerIndex === null || state.selectedWinnerIndex === undefined){ alert("Tap the winning team first."); return; }
  if(!state.currentGame.teams?.[state.selectedWinnerIndex]){ alert("Winning team selection is invalid."); return; }
  if(state.resultsSavedForCurrentGame){
    alert("Results are already saved for this game. This prevents accidental duplicate stat/rating updates.");
    return;
  }

  const saveBtn = document.querySelector("#saveResultsWrap .btn-success");
  const msg = document.getElementById("resultMessage");
  if(saveBtn) saveBtn.disabled = true;
  if(msg) msg.textContent = "Saving results...";

  try{
    const { error } = await db.rpc("save_game_results", {
      p_winner_team_index: Number(state.selectedWinnerIndex),
      p_teams: serializableTeams(),
      p_generated_at: state.currentGameGeneratedAt || null
    });

    if(error) throw error;

    await loadCloudData();
    renderAll();

    const finalMsg = document.getElementById("resultMessage");
    if(finalMsg) finalMsg.textContent = "Results saved. Records, Win/Loss ratings, game history, and teammate history updated.";
  }catch(error){
    console.error("saveResults failed", error);
    if(msg) msg.textContent = "Results save failed.";
    alert("Results save failed: " + (error?.message || error));
  }finally{
    const currentSaveBtn = document.querySelector("#saveResultsWrap .btn-success");
    if(currentSaveBtn) currentSaveBtn.disabled = false;
  }
}

async function savePairingsOnlyForCurrentGame(){
  if(!state.currentGame) return;

  try{
    const { error } = await db.rpc("save_pairings_only", {
      p_teams: serializableTeams(),
      p_generated_at: state.currentGameGeneratedAt || null
    });
    if(error) throw error;

    state.resultsSavedForCurrentGame = true;
    await loadCloudData();
    renderAll();
  }catch(e){
    console.error("Could not save pairings-only game", e);
    alert("Could not save pairings-only game: " + (e?.message || e));
  }
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
  setValue("eliteBalanceBoost", s.eliteBalanceBoost);
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
function readNumberSetting(id, fallback){
  const el = document.getElementById(id);
  const n = Number(el?.value);
  return Number.isFinite(n) ? n : fallback;
}
function normalizeSettingsBeforeSave(){
  const s = state.settings;

  s.weightHandling = readNumberSetting("weightHandling", 0.35);
  s.weightCutting = readNumberSetting("weightCutting", 0.35);
  s.weightDefense = readNumberSetting("weightDefense", 0.30);
  s.kFactor = readNumberSetting("kFactor", 0.08);
  s.repeatWeight = readNumberSetting("repeatWeight", 4);
  s.handlerSeparationBoost = readNumberSetting("handlerSeparationBoost", 2);
  s.eliteBalanceBoost = readNumberSetting("eliteBalanceBoost", 2);
}
function settingsPayload(includeEliteBoost = true){
  const s = state.settings;
  const payload = {
    id: "main",
    weight_handling: s.weightHandling,
    weight_cutting: s.weightCutting,
    weight_defense: s.weightDefense,
    k_factor: s.kFactor,
    repeat_weight: s.repeatWeight,
    prioritize_handler_separation: s.prioritizeHandlerSeparation,
    handler_separation_boost: s.handlerSeparationBoost,
    prioritize_elite_balance: s.prioritizeEliteBalance,
    updated_at: new Date().toISOString()
  };
  if(includeEliteBoost) payload.elite_balance_boost = s.eliteBalanceBoost;
  return payload;
}
function looksLikeMissingEliteBoostColumn(error){
  const msg = String(error?.message || error?.details || error?.hint || "").toLowerCase();
  return msg.includes("elite_balance_boost") || msg.includes("schema cache") || msg.includes("column");
}
async function saveSettings(){
  if(!isAdmin()){ alert("Admin only."); return; }

  normalizeSettingsBeforeSave();

  const status = document.getElementById("settingsSaveStatus");
  if(status) status.textContent = "Saving settings...";

  let { error } = await db.from("settings").upsert(settingsPayload(true), { onConflict: "id" });

  if(error && looksLikeMissingEliteBoostColumn(error)){
    const retry = await db.from("settings").upsert(settingsPayload(false), { onConflict: "id" });
    if(retry.error){
      if(status) status.textContent = "Settings save failed.";
      alert("Settings save failed: " + retry.error.message);
      return;
    }
    if(status) status.textContent = "Settings saved, except Elite Balance Boost. Run the v4.41 SQL migration once.";
    alert("Settings saved, but Elite Balance Boost could not be saved because the settings table is missing the elite_balance_boost column. Run the v4.41 setup_supabase.sql once.");
    return;
  }

  if(error){
    if(status) status.textContent = "Settings save failed.";
    alert("Settings save failed: " + error.message);
    return;
  }

  if(status) status.textContent = "Settings saved.";
  setTimeout(() => {
    const currentStatus = document.getElementById("settingsSaveStatus");
    if(currentStatus && currentStatus.textContent === "Settings saved.") currentStatus.textContent = "";
  }, 2500);
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

async function importBackupJsonFile(event){
  if(!isAdmin()){ alert("Admin only."); return; }

  const input = event?.target;
  const file = input?.files?.[0];
  if(!file) return;

  try{
    const text = await file.text();
    const backup = JSON.parse(text);

    const summary = summarizeBackupJson(backup);
    if(!summary.valid){
      alert("This does not look like a valid Ultimate Teams backup JSON file.");
      return;
    }

    const ok = confirm(
      "Restore backup JSON?\n\n" +
      summary.message +
      "\n\nThis will replace current players, attendance, pair rules, teammate history, game history/audit tables, settings, and current game state. This cannot be undone unless you export the current data first."
    );
    if(!ok) return;

    await restoreBackupJson(backup);
    alert("Backup restored.");
    await loadCloudData();
    renderAll();
  }catch(e){
    console.error(e);
    alert("Could not import backup JSON: " + (e?.message || e));
  }finally{
    if(input) input.value = "";
  }
}

function summarizeBackupJson(backup){
  const playerCount = Array.isArray(backup?.players) ? backup.players.length : 0;
  const pairRuleCount = Array.isArray(backup?.pairRules) ? backup.pairRules.length : 0;
  const historyCount = backup?.history && typeof backup.history === "object" ? Object.keys(backup.history).length : 0;
  const hasSettings = !!backup?.settings;
  const hasCurrentGame = !!backup?.currentGame;

  return {
    valid: Array.isArray(backup?.players),
    message:
      `Players: ${playerCount}\n` +
      `Pair rules: ${pairRuleCount}\n` +
      `Teammate history entries: ${historyCount}\n` +
      `Settings: ${hasSettings ? "yes" : "no"}\n` +
      `Current game: ${hasCurrentGame ? "yes" : "no"}`
  };
}

function backupPlayerToRow(p){
  return {
    id: p.id,
    first_name: p.firstName || p.first_name || "",
    last_name: p.lastName || p.last_name || "",
    handling: Number(p.handling || 0),
    cutting: Number(p.cutting || 0),
    defense: Number(p.defense || 0),
    win_loss: Number(p.winLossRating ?? p.win_loss ?? 0),
    active: p.active !== false,
    injury_pct: Number(p.injuryPct ?? p.injury_pct ?? 1),
    temporary: !!p.temporary,
    games_played: Number(p.gamesPlayed ?? p.games_played ?? 0),
    wins: Number(p.wins || 0),
    losses: Number(p.losses || 0),
    updated_at: new Date().toISOString()
  };
}

function backupTeamsToSerializableTeams(backup){
  const teams = backup?.currentGame?.teams;
  if(!Array.isArray(teams)) return [];

  return teams.map(team => (Array.isArray(team) ? team : []).map(p => {
    if(typeof p === "string") return { id: p, fullName: backupPlayerNameById(backup, p) || p };
    const id = p.id || p.player_id || "";
    return { id, fullName: p.fullName || p.full_name || backupPlayerNameById(backup, id) || id };
  }).filter(x => x.id));
}

function backupPlayerNameById(backup, id){
  const p = (backup?.players || []).find(x => String(x.id) === String(id));
  if(!p) return "";
  return p.fullName || p.full_name || `${p.firstName || p.first_name || ""} ${p.lastName || p.last_name || ""}`.trim();
}

async function restoreBackupJson(backup){
  if(!Array.isArray(backup?.players)) throw new Error("Backup is missing players.");

  const players = backup.players.map(backupPlayerToRow).filter(p => p.id && (p.first_name || p.last_name));
  if(!players.length) throw new Error("Backup has no valid players.");

  // Clear dependent data first. Deleting players will cascade some rows, but explicit clears keep restore predictable.
  await db.from("current_game").upsert({ id: "main", teams: [], selected_winner_index: null, results_saved: true, generated_at: new Date().toISOString(), updated_by: currentUser?.id || null }, { onConflict: "id" });
  await db.from("game_player_results").delete().not("game_id", "is", null);
  await db.from("teammate_pair_events").delete().not("id", "is", null);
  await db.from("games").delete().not("id", "is", null);
  await db.from("admin_audit_logs").delete().not("id", "is", null);
  await db.from("attendance").delete().not("player_id", "is", null);
  await db.from("pair_rules").delete().not("id", "is", null);
  await db.from("teammate_history").delete().not("player_a", "is", null);
  await db.from("rating_history").delete().not("id", "is", null);
  await db.from("players").delete().not("id", "is", null);

  // Restore players in chunks.
  for(const chunk of chunkArray(players, 100)){
    const { error } = await db.from("players").insert(chunk);
    if(error) throw error;
  }

  // Restore attendance from player.attending flags.
  const attendanceRows = backup.players
    .filter(p => p.id)
    .map(p => ({
      player_id: p.id,
      present: !!p.attending,
      updated_at: new Date().toISOString(),
      updated_by: currentUser?.id || null
    }));

  for(const chunk of chunkArray(attendanceRows, 100)){
    const { error } = await db.from("attendance").upsert(chunk, { onConflict: "player_id" });
    if(error) throw error;
  }

  // Restore pair rules. Try with created_by if column exists; fallback without it.
  const pairRuleRows = (backup.pairRules || []).filter(r => r.player1Id && r.player2Id).map(r => ({
    id: r.id || undefined,
    player1_id: r.player1Id,
    player2_id: r.player2Id,
    rule_type: r.type || r.rule_type || "together",
    strength: Number(r.strength || 1),
    created_by: r.createdBy || r.created_by || null
  }));

  if(pairRuleRows.length){
    let { error } = await db.from("pair_rules").insert(pairRuleRows);
    if(error){
      const fallbackRows = pairRuleRows.map(({ created_by, ...rest }) => rest);
      const fallback = await db.from("pair_rules").insert(fallbackRows);
      if(fallback.error) throw fallback.error;
    }
  }

  // Restore teammate history.
  const historyRows = [];
  if(backup.history && typeof backup.history === "object"){
    Object.entries(backup.history).forEach(([key, count]) => {
      const [a, b] = String(key).split("|");
      if(a && b) historyRows.push({ player_a: a, player_b: b, count: Number(count || 0) });
    });
  }

  for(const chunk of chunkArray(historyRows, 100)){
    const { error } = await db.from("teammate_history").upsert(chunk, { onConflict: "player_a,player_b" });
    if(error) throw error;
  }

  // Restore settings.
  if(backup.settings){
    const s = backup.settings;
    const { error } = await db.from("settings").upsert({
      id: "main",
      weight_handling: Number(s.weightHandling ?? 0.35),
      weight_cutting: Number(s.weightCutting ?? 0.35),
      weight_defense: Number(s.weightDefense ?? 0.30),
      k_factor: Number(s.kFactor ?? 0.08),
      repeat_weight: Number(s.repeatWeight ?? 4),
      prioritize_handler_separation: !!s.prioritizeHandlerSeparation,
      handler_separation_boost: Number(s.handlerSeparationBoost ?? 2),
      prioritize_elite_balance: !!s.prioritizeEliteBalance,
      elite_balance_boost: Number(s.eliteBalanceBoost ?? 2),
      updated_at: new Date().toISOString()
    }, { onConflict: "id" });
    if(error) throw error;
  }

  // Restore full game/audit history if included in a full backup.
  const gameRows = (backup.gameHistory || []).map(g => ({
    id: g.id,
    played_at: g.played_at,
    teams: g.teams || [],
    winner_team_index: g.winner_team_index ?? null,
    created_by: g.created_by || null
  })).filter(g => g.id && Array.isArray(g.teams));
  for(const chunk of chunkArray(gameRows, 100)){
    let { error } = await db.from("games").insert(chunk);
    if(error){
      const fallback = chunk.map(({ created_by, ...rest }) => ({ ...rest, created_by: null }));
      const retry = await db.from("games").insert(fallback);
      if(retry.error) throw retry.error;
    }
  }

  const gamePlayerRows = (backup.gamePlayerResults || []).filter(r => r.game_id && r.player_id).map(r => ({
    game_id: r.game_id,
    player_id: r.player_id,
    team_idx: Number(r.team_idx ?? 0),
    old_win_loss: Number(r.old_win_loss ?? 0),
    new_win_loss: Number(r.new_win_loss ?? 0),
    delta: Number(r.delta ?? 0),
    old_games_played: Number(r.old_games_played ?? 0),
    new_games_played: Number(r.new_games_played ?? 0),
    old_wins: Number(r.old_wins ?? 0),
    new_wins: Number(r.new_wins ?? 0),
    old_losses: Number(r.old_losses ?? 0),
    new_losses: Number(r.new_losses ?? 0),
    created_at: r.created_at || new Date().toISOString()
  }));
  for(const chunk of chunkArray(gamePlayerRows, 100)){
    const { error } = await db.from("game_player_results").insert(chunk);
    if(error) throw error;
  }

  const pairEventRows = (backup.teammatePairEvents || []).filter(r => r.game_id && r.player_a && r.player_b).map(r => ({
    id: r.id || undefined,
    game_id: r.game_id,
    player_a: r.player_a,
    player_b: r.player_b,
    source: r.source || "results_saved",
    created_at: r.created_at || new Date().toISOString(),
    created_by: r.created_by || null
  }));
  for(const chunk of chunkArray(pairEventRows, 100)){
    let { error } = await db.from("teammate_pair_events").insert(chunk);
    if(error){
      const fallback = chunk.map(({ created_by, ...rest }) => ({ ...rest, created_by: null }));
      const retry = await db.from("teammate_pair_events").insert(fallback);
      if(retry.error) throw retry.error;
    }
  }

  const auditRows = (backup.adminAuditLogs || []).map(r => ({
    id: r.id || undefined,
    action: r.action || "restored_log",
    table_name: r.table_name || null,
    row_id: r.row_id || null,
    player_id: r.player_id || null,
    actor_id: r.actor_id || null,
    actor_role: r.actor_role || null,
    details: r.details || {},
    created_at: r.created_at || new Date().toISOString()
  })).filter(r => r.action);
  for(const chunk of chunkArray(auditRows, 100)){
    let { error } = await db.from("admin_audit_logs").insert(chunk);
    if(error){
      const fallback = chunk.map(({ actor_id, player_id, ...rest }) => ({ ...rest, actor_id: null, player_id: null }));
      const retry = await db.from("admin_audit_logs").insert(fallback);
      if(retry.error) throw retry.error;
    }
  }

  // Restore current game state.
  const currentTeams = backupTeamsToSerializableTeams(backup);
  const { error: gameError } = await db.from("current_game").upsert({
    id: "main",
    teams: currentTeams,
    selected_winner_index: backup.selectedWinnerIndex ?? null,
    results_saved: !!backup.resultsSavedForCurrentGame,
    generated_at: backup.currentGameGeneratedAt || new Date().toISOString(),
    updated_by: currentUser?.id || null
  }, { onConflict: "id" });
  if(gameError) throw gameError;
}

function chunkArray(items, size){
  const chunks = [];
  for(let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

async function downloadBackupJson(){
  if(!isAdmin()){ alert("Admin only."); return; }
  const [gamesRes, pairEventsRes, gamePlayerRes, auditRes] = await Promise.all([
    db.from("games").select("*").order("played_at", { ascending:false }),
    db.from("teammate_pair_events").select("*").order("created_at", { ascending:false }),
    db.from("game_player_results").select("*"),
    db.from("admin_audit_logs").select("*").order("created_at", { ascending:false })
  ]);

  const firstError = gamesRes.error || pairEventsRes.error || gamePlayerRes.error || auditRes.error;
  if(firstError){ alert("Could not build full backup: " + firstError.message); return; }

  const backup = {
    ...state,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    gameHistory: gamesRes.data || [],
    teammatePairEvents: pairEventsRes.data || [],
    gamePlayerResults: gamePlayerRes.data || [],
    adminAuditLogs: auditRes.data || []
  };
  downloadBlob(`${getDatePrefix()}_ultimate-teams-full-backup.json`, JSON.stringify(backup, null, 2), "application/json");
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


function makeDynamicModal(id, title, bodyHtml, footerHtml = ""){
  let modal = document.getElementById(id);
  if(modal) modal.remove();
  modal = document.createElement("div");
  modal.id = id;
  modal.className = "modal-backdrop";
  modal.onclick = e => { if(e.target === modal) modal.remove(); };
  modal.innerHTML = `
    <div class="modal-card" onclick="event.stopPropagation()">
      <div class="row modal-header-sticky" style="justify-content:space-between;align-items:center;gap:10px">
        <h2 style="margin:0">${escapeHtml(title)}</h2>
        <button class="btn-secondary" style="width:auto" type="button" onclick="document.getElementById('${id}')?.remove()">Close</button>
      </div>
      <div style="margin-top:12px">${bodyHtml}</div>
      ${footerHtml || ""}
    </div>`;
  document.body.appendChild(modal);
  modal.classList.add("modal-open");
  modal.style.display = "flex";
  return modal;
}

function playerDisplayNameFromTeamsPlayer(x){
  if(!x) return "Unknown";
  const id = typeof x === "string" ? x : (x.id || x.player_id || "");
  const p = playerById(id);
  return p?.fullName || x.fullName || x.full_name || id || "Unknown";
}

function formatDateTime(value){
  if(!value) return "";
  const d = new Date(value);
  if(Number.isNaN(d.getTime())) return "";
  return d.toLocaleString([], { month:"short", day:"numeric", year:"numeric", hour:"numeric", minute:"2-digit" });
}

function winnerLabelForGame(game){
  if(game.winner_team_index === null || game.winner_team_index === undefined) return "Pairings only";
  return `Winner: Team ${Number(game.winner_team_index) + 1}`;
}

async function openGameHistoryModal(){
  if(!canAccessDataPage()){ alert("Captain/admin only."); return; }
  makeDynamicModal("gameHistoryModal", "Game History", '<div class="small">Loading game history...</div>');
  const { data, error } = await db.from("games").select("*").order("played_at", { ascending:false }).limit(100);
  if(error){ makeDynamicModal("gameHistoryModal", "Game History", `<div class="notice">${escapeHtml(error.message)}</div>`); return; }
  const games = data || [];
  const body = games.length ? `<div class="mini-table">${games.map(g => {
    const teams = Array.isArray(g.teams) ? g.teams : [];
    const teamHtml = teams.map((team, idx) => `<div class="team-line"><strong>Team ${idx + 1}:</strong> ${(Array.isArray(team) ? team : []).map(playerDisplayNameFromTeamsPlayer).map(escapeHtml).join(", ")}</div>`).join("");
    const deleteBtn = isAdmin()
      ? `<button class="btn-danger" style="width:auto;margin-top:10px" type="button" onclick="deleteGameFromHistory('${escapeHtml(String(g.id))}')">Delete Game</button>`
      : "";
    return `<div class="history-card"><div class="row" style="justify-content:space-between;gap:10px"><strong>${escapeHtml(formatDateTime(g.played_at) || "Game")}</strong><span class="chip">${escapeHtml(winnerLabelForGame(g))}</span></div>${teamHtml}${deleteBtn}</div>`;
  }).join("")}</div>` : '<div class="small">No saved games yet.</div>';
  makeDynamicModal("gameHistoryModal", "Game History", body);
}


async function deleteGameFromHistory(gameId){
  if(!isAdmin()){ alert("Admin only."); return; }
  if(!gameId){ alert("Missing game id."); return; }

  const ok = confirm(
    "Delete this saved game from history?\n\n" +
    "This will remove the game record, teammate pair events, teammate-history counts, result audit rows, and rating-history entries for this game. " +
    "If it was a result game saved with audit data, player stats and Win/Loss rating will be reversed by subtracting this game's changes.\n\n" +
    "This cannot be undone."
  );
  if(!ok) return;

  try{
    const { data, error } = await db.rpc("delete_game_from_history", { p_game_id: gameId });
    if(error) throw error;

    await loadCloudData();
    renderAll();

    const restored = data?.restored_players ?? 0;
    const pairEventsRemoved = data?.pair_events_removed ?? 0;
    alert(`Game deleted. Restored ${restored} player result rows and removed ${pairEventsRemoved} teammate pair events.`);
    await openGameHistoryModal();
  }catch(e){
    alert("Could not delete game: " + (e?.message || e));
  }
}

async function openTeammateHistoryModal(){
  if(!canAccessDataPage()){ alert("Captain/admin only."); return; }
  makeDynamicModal("teammateHistoryModal", "Teammate History", '<div class="small">Loading teammate history...</div>');
  const [histRes, eventRes] = await Promise.all([
    db.from("teammate_history").select("*").order("count", { ascending:false }).limit(100),
    db.from("teammate_pair_events").select("*").order("created_at", { ascending:false }).limit(50)
  ]);
  if(histRes.error || eventRes.error){
    makeDynamicModal("teammateHistoryModal", "Teammate History", `<div class="notice">${escapeHtml(histRes.error?.message || eventRes.error?.message || "Could not load history.")}</div>`);
    return;
  }
  const counts = histRes.data || [];
  const recent = eventRes.data || [];
  const countHtml = counts.length ? counts.map(h => {
    const a = playerById(h.player_a)?.fullName || h.player_a;
    const b = playerById(h.player_b)?.fullName || h.player_b;
    return `<div class="history-card"><div class="row" style="justify-content:space-between;gap:10px"><div>${escapeHtml(a)} ↔ ${escapeHtml(b)}</div><strong>${Number(h.count || 0)}</strong></div></div>`;
  }).join("") : '<div class="small">No teammate history counts yet.</div>';
  const recentHtml = recent.length ? recent.map(e => {
    const a = playerById(e.player_a)?.fullName || e.player_a;
    const b = playerById(e.player_b)?.fullName || e.player_b;
    return `<div class="small">${escapeHtml(formatDateTime(e.created_at))}: ${escapeHtml(a)} ↔ ${escapeHtml(b)} · ${escapeHtml(e.source || "")}</div>`;
  }).join("") : '<div class="small">No recent pairing events yet.</div>';
  const body = `<h3 style="margin:0 0 8px">Top teammate pairs</h3><div class="mini-table">${countHtml}</div><div class="hr"></div><h3 style="margin:0 0 8px">Recent pairing events</h3>${recentHtml}`;
  makeDynamicModal("teammateHistoryModal", "Teammate History", body);
}

async function openAuditLogsModal(){
  if(!isAdmin()){ alert("Admin only."); return; }
  makeDynamicModal("auditLogsModal", "Admin Audit Logs", '<div class="small">Loading audit logs...</div>');
  const { data, error } = await db.from("admin_audit_logs").select("*").order("created_at", { ascending:false }).limit(150);
  if(error){ makeDynamicModal("auditLogsModal", "Admin Audit Logs", `<div class="notice">${escapeHtml(error.message)}</div>`); return; }
  const logs = data || [];
  const body = logs.length ? `<div class="mini-table">${logs.map(log => {
    const details = log.details ? JSON.stringify(log.details) : "";
    return `<div class="history-card"><div class="row" style="justify-content:space-between;gap:10px"><strong>${escapeHtml(log.action || "log")}</strong><span class="small">${escapeHtml(formatDateTime(log.created_at))}</span></div><div class="small">Table: ${escapeHtml(log.table_name || "")} · Actor role: ${escapeHtml(log.actor_role || "")}</div><pre style="white-space:pre-wrap;font-size:11px;overflow:auto">${escapeHtml(details)}</pre></div>`;
  }).join("")}</div>` : '<div class="small">No audit logs yet.</div>';
  makeDynamicModal("auditLogsModal", "Admin Audit Logs", body);
}

async function voidLastSavedGame(){
  if(!isAdmin()){ alert("Admin only."); return; }
  if(!confirm("Undo/void the most recent saved game? This will reverse stats/Win-Loss changes for games saved with the new audit system and remove its pairing events. This cannot be undone.")) return;
  try{
    const { data, error } = await db.rpc("void_last_saved_game");
    if(error) throw error;
    await loadCloudData();
    renderAll();
    alert(`Last saved game voided. Restored ${data?.restored_players ?? 0} players.`);
  }catch(e){
    alert("Could not void last saved game: " + (e?.message || e));
  }
}

function currentGamePlayerIds(){
  const ids = new Set();
  (state.currentGame?.teams || []).forEach(team => team.forEach(p => ids.add(String(p.id || p.player_id || p))));
  return ids;
}

function openLateAddModal(){
  if(!canManageGames()){ alert("Captain/admin only."); return; }
  if(!state.currentGame){ alert("Generate teams first."); return; }
  if(state.resultsSavedForCurrentGame){ alert("This game already has saved results. Late add is only available before results are saved."); return; }

  const teamOptions = (state.currentGame.teams || []).map((_, idx) => `<option value="${idx}">Team ${idx + 1}</option>`).join("");
  const likeOptions = '<option value="">Select...</option>' + state.players.slice().sort(comparePlayersByLastName).map(p => `<option value="${escapeHtml(String(p.id))}">${escapeHtml(p.fullName)}</option>`).join("");

  const body = `
    <div class="notice">Add a player after teams were generated. The player will be marked present, made active if needed, and added to the selected team. Results must not already be saved.</div>

    <div style="margin-top:10px"><label>Team</label><select id="lateAddTeam">${teamOptions}</select></div>

    <div class="hr"></div>
    <div class="player-name">Choose existing player</div>
    <input id="lateAddExisting" type="hidden" value="">
    <div id="lateAddSelectedExisting" class="small" style="margin-top:6px">No existing player selected. Choose one below, or add a new player.</div>

    <div class="modal-sort-row">
      <label for="lateAddExistingSort">Sort by</label>
      <select id="lateAddExistingSort" onchange="renderLateAddExistingList()">
        <option value="az" selected>Name A-Z</option>
        <option value="za">Name Z-A</option>
        <option value="ratingDesc">Overall rating high-low</option>
        <option value="ratingAsc">Overall rating low-high</option>
        <option value="winLossDesc">Win/Loss rating high-low</option>
        <option value="winLossAsc">Win/Loss rating low-high</option>
        <option value="activeFirst">Active first</option>
        <option value="inactiveFirst">Inactive first</option>
      </select>
    </div>
    <div class="modal-search-row">
      <div class="modal-search-input-wrap"><input id="lateAddExistingSearch" placeholder="Search existing players..." oninput="renderLateAddExistingList()"></div>
      <button class="btn-secondary modal-search-clear" type="button" onclick="clearLateAddExistingSearch()">Clear</button>
    </div>
    <div id="lateAddExistingList" class="late-add-player-list"></div>

    <div class="hr"></div>
    <div class="player-name">Or add new player</div>
    <div class="small">Leave existing player unselected to add a new one.</div>
    <div class="grid grid-2" style="margin-top:10px">
      <div><label>New Player Full Name</label><input id="lateAddName" placeholder="Mike Jones"></div>
      <div><label>Rate Like</label><select id="lateAddLike" onchange="loadLateAddRatingsFromLike()">${likeOptions}</select></div>
    </div>
    <div class="grid grid-3" style="margin-top:10px">
      <div><label>Handling</label><input id="lateAddHandling" type="number" step="0.1" value="3"></div>
      <div><label>Cutting</label><input id="lateAddCutting" type="number" step="0.1" value="3"></div>
      <div><label>Defense</label><input id="lateAddDefense" type="number" step="0.1" value="3"></div>
    </div>
    <label style="display:flex;align-items:center;gap:8px;margin-top:10px"><input id="lateAddTemporary" type="checkbox" checked style="width:auto"> One-time player</label>
    <div class="toolbar" style="margin-top:12px">
      <button class="btn" type="button" onclick="lateAddPlayerToCurrentGame()">Add To Team</button>
      <button class="btn-secondary" type="button" onclick="clearLateAddExistingPlayer()">Clear Selected Existing</button>
    </div>
    <div id="lateAddStatus" class="small" style="margin-top:8px"></div>`;

  makeDynamicModal("lateAddModal", "Late Add Player", body);
  renderLateAddExistingList();
}


function lateAddAvailableExistingPlayers(){
  const inGame = currentGamePlayerIds();
  return state.players.filter(p => !inGame.has(String(p.id)));
}

function renderLateAddExistingList(){
  const list = document.getElementById("lateAddExistingList");
  if(!list) return;

  const search = (document.getElementById("lateAddExistingSearch")?.value || "").trim().toLowerCase();
  const sortMode = document.getElementById("lateAddExistingSort")?.value || "az";
  const selectedId = document.getElementById("lateAddExisting")?.value || "";

  const players = sortPlayersForModal(
    lateAddAvailableExistingPlayers().filter(p => !search || p.fullName.toLowerCase().includes(search)),
    sortMode
  );

  if(!players.length){
    list.innerHTML = '<div class="small">No available players match that search.</div>';
    return;
  }

  list.innerHTML = players.map(p => {
    const selected = String(p.id) === String(selectedId);
    const status = p.active ? "Active" : "Inactive";
    return `<div class="late-add-player-row">
      <div style="min-width:0">
        <div class="player-name" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(p.fullName)}</div>
        <div class="small">${status} · Overall ${overall(p).toFixed(2)} · W/L ${Number(p.winLossRating || 0).toFixed(2)}</div>
      </div>
      <button class="${selected ? "btn" : "btn-secondary"}" type="button" onclick="selectLateAddExistingPlayer('${escapeHtml(String(p.id))}')">${selected ? "Selected" : "Select"}</button>
    </div>`;
  }).join("");
}

function selectLateAddExistingPlayer(playerId){
  const p = playerById(playerId);
  if(!p) return;
  setValue("lateAddExisting", p.id);
  const label = document.getElementById("lateAddSelectedExisting");
  if(label) label.textContent = `Selected existing player: ${p.fullName}${p.active ? "" : " (will be made active)"}`;
  renderLateAddExistingList();
}

function clearLateAddExistingPlayer(){
  setValue("lateAddExisting", "");
  const label = document.getElementById("lateAddSelectedExisting");
  if(label) label.textContent = "No existing player selected. Choose one below, or add a new player.";
  renderLateAddExistingList();
}

function clearLateAddExistingSearch(){
  setValue("lateAddExistingSearch", "");
  renderLateAddExistingList();
}

function loadLateAddRatingsFromLike(){
  const src = playerById(document.getElementById("lateAddLike")?.value);
  if(!src) return;
  setValue("lateAddHandling", src.handling);
  setValue("lateAddCutting", src.cutting);
  setValue("lateAddDefense", src.defense);
}

async function lateAddPlayerToCurrentGame(){
  if(!canManageGames() || !state.currentGame) return;
  const teamIdx = Number(document.getElementById("lateAddTeam")?.value || 0);
  const status = document.getElementById("lateAddStatus");
  if(!state.currentGame.teams?.[teamIdx]){ alert("Choose a valid team."); return; }
  if(state.resultsSavedForCurrentGame){ alert("Results are already saved for this game."); return; }

  let player = null;
  const existingId = document.getElementById("lateAddExisting")?.value || "";
  if(existingId){
    player = playerById(existingId);
    if(!player){ alert("Existing player not found. Refresh and try again."); return; }
    const { error } = await saveAttendanceFromApp(player.id, true);
    if(error){ alert(error.message); return; }
    player.active = true;
    player.attending = true;
  }else{
    const fullName = normalizeName(document.getElementById("lateAddName")?.value || "");
    if(!fullName){ alert("Enter a new player name or choose an existing player."); return; }
    const { first, last } = splitName(fullName);
    if(status) status.textContent = "Adding player...";
    const { data, error } = await db.rpc("add_player_from_app", {
      p_first_name: first,
      p_last_name: last,
      p_handling: Number(document.getElementById("lateAddHandling")?.value || 3),
      p_cutting: Number(document.getElementById("lateAddCutting")?.value || 3),
      p_defense: Number(document.getElementById("lateAddDefense")?.value || 3),
      p_temporary: !!document.getElementById("lateAddTemporary")?.checked,
      p_mark_present: true
    });
    if(error){ alert(error.message); if(status) status.textContent = "Add failed."; return; }
    await loadCloudData();
    const newId = data?.player_id || data?.playerId;
    player = state.players.find(p => String(p.id) === String(newId)) || state.players.find(p => normalizeNameForMatch(p.fullName) === normalizeNameForMatch(fullName));
    if(!player){ alert("Player was added, but could not be loaded into the game. Refresh and try again."); return; }
  }

  if(currentGamePlayerIds().has(String(player.id))){ alert("That player is already in the current game."); return; }
  state.currentGame.teams[teamIdx].push(player);
  state.resultsSavedForCurrentGame = false;
  await saveCurrentGameToDb(false);
  await loadCloudData();
  renderAll();
  hideModal("lateAddModal");
}

function currentSignedInPlayer(){
  return state.players.find(isCurrentSignedInPlayer) || null;
}

async function openMyAttendanceHistoryModal(){
  if(!currentUser){ alert("Sign in first."); return; }
  const me = currentSignedInPlayer();
  if(!me){ makeDynamicModal("myAttendanceHistoryModal", "My Attendance History", '<div class="notice">I could not match your account name to a player record. Ask an admin to make your account first/last name match the roster.</div>'); return; }
  makeDynamicModal("myAttendanceHistoryModal", "My Attendance History", '<div class="small">Loading...</div>');
  const { data, error } = await db.from("games").select("*").order("played_at", { ascending:false }).limit(200);
  if(error){ makeDynamicModal("myAttendanceHistoryModal", "My Attendance History", `<div class="notice">${escapeHtml(error.message)}</div>`); return; }
  const games = (data || []).filter(g => (Array.isArray(g.teams) ? g.teams : []).some(team => (Array.isArray(team) ? team : []).some(x => String(x.id || x.player_id || x) === String(me.id))));
  const rows = games.map(g => {
    const myTeamIndex = (g.teams || []).findIndex(team => (team || []).some(x => String(x.id || x.player_id || x) === String(me.id)));
    const result = g.winner_team_index === null || g.winner_team_index === undefined ? "Pairings only" : (Number(g.winner_team_index) === myTeamIndex ? "Win" : "Loss");
    return `<div class="history-card"><div class="row" style="justify-content:space-between;gap:10px"><strong>${escapeHtml(formatDateTime(g.played_at))}</strong><span class="chip">${escapeHtml(result)}</span></div><div class="small">Team ${myTeamIndex + 1}</div></div>`;
  }).join("");
  makeDynamicModal("myAttendanceHistoryModal", "My Attendance History", rows ? `<div class="notice">Matched player: ${escapeHtml(me.fullName)}</div><div class="mini-table">${rows}</div>` : `<div class="small">No saved games found for ${escapeHtml(me.fullName)}.</div>`);
}

async function openMyWinLossRecordModal(){
  if(!currentUser){ alert("Sign in first."); return; }
  const me = currentSignedInPlayer();
  if(!me){ makeDynamicModal("myWinLossModal", "My Win/Loss Record", '<div class="notice">I could not match your account name to a player record. Ask an admin to make your account first/last name match the roster.</div>'); return; }
  makeDynamicModal("myWinLossModal", "My Win/Loss Record", '<div class="small">Loading...</div>');
  const { data, error } = await db.from("rating_history").select("*").eq("player_id", me.id).order("created_at", { ascending:false }).limit(50);
  if(error){ makeDynamicModal("myWinLossModal", "My Win/Loss Record", `<div class="notice">${escapeHtml(error.message)}</div>`); return; }
  const pct = me.gamesPlayed ? ((me.wins / me.gamesPlayed) * 100).toFixed(1) + "%" : "0.0%";
  const hist = (data || []).map(r => `<div class="small">${escapeHtml(formatDateTime(r.created_at))}: ${Number(r.value || 0).toFixed(2)}</div>`).join("");
  const body = `<div class="history-card"><div class="player-name">${escapeHtml(me.fullName)}</div><div class="small">Games ${me.gamesPlayed} · Wins ${me.wins} · Losses ${me.losses} · Win % ${pct}</div><div class="small">Current Win/Loss rating: <strong>${Number(me.winLossRating || 0).toFixed(2)}</strong></div></div><div class="hr"></div><h3 style="margin:0 0 8px">Recent rating history</h3>${hist || '<div class="small">No rating history yet.</div>'}`;
  makeDynamicModal("myWinLossModal", "My Win/Loss Record", body);
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
  ["ratingsModal", "editPlayerModal", "winLossModal", "signOutConfirmModal", "accountModal", "accountCreatedModal", "captainWelcomeModal"].forEach(hideModal);
}


function playerWinPct(p){
  const games = Number(p?.gamesPlayed || 0);
  return games ? Number(p?.wins || 0) / games : -1;
}

function numericPlayerValue(p, mode){
  switch(mode){
    case "ratingAsc":
    case "ratingDesc": return overall(p);
    case "winLossAsc":
    case "winLossDesc": return Number(p?.winLossRating || 0);
    case "winPctAsc":
    case "winPctDesc": return playerWinPct(p);
    case "gamesAsc":
    case "gamesDesc": return Number(p?.gamesPlayed || 0);
    case "handlingDesc": return Number(p?.handling || 0);
    case "cuttingDesc": return Number(p?.cutting || 0);
    case "defenseDesc": return Number(p?.defense || 0);
    default: return 0;
  }
}

function sortPlayersForModal(players, mode = "az"){
  const list = [...players];
  const nameCompare = (a, b) => comparePlayersByLastName(a, b) || 0;

  list.sort((a, b) => {
    switch(mode){
      case "za":
        return -nameCompare(a, b);

      case "ratingAsc":
      case "winLossAsc":
      case "winPctAsc":
      case "gamesAsc": {
        const diff = numericPlayerValue(a, mode) - numericPlayerValue(b, mode);
        return diff || nameCompare(a, b);
      }

      case "ratingDesc":
      case "winLossDesc":
      case "winPctDesc":
      case "gamesDesc":
      case "handlingDesc":
      case "cuttingDesc":
      case "defenseDesc": {
        const diff = numericPlayerValue(b, mode) - numericPlayerValue(a, mode);
        return diff || nameCompare(a, b);
      }

      case "activeFirst": {
        const diff = Number(b.active === true) - Number(a.active === true);
        return diff || nameCompare(a, b);
      }

      case "inactiveFirst": {
        const diff = Number(a.active === true) - Number(b.active === true);
        return diff || nameCompare(a, b);
      }

      case "az":
      default:
        return nameCompare(a, b);
    }
  });

  return list;
}

function ensurePlayerSortControls(){
  const options = [
    ["az", "Name A-Z"],
    ["za", "Name Z-A"],
    ["ratingDesc", "Overall rating high-low"],
    ["ratingAsc", "Overall rating low-high"],
    ["winLossDesc", "Win/Loss rating high-low"],
    ["winLossAsc", "Win/Loss rating low-high"],
    ["winPctDesc", "Win % high-low"],
    ["winPctAsc", "Win % low-high"],
    ["gamesDesc", "Games played high-low"],
    ["gamesAsc", "Games played low-high"],
    ["handlingDesc", "Handling high-low"],
    ["cuttingDesc", "Cutting high-low"],
    ["defenseDesc", "Defense high-low"],
    ["activeFirst", "Active first"],
    ["inactiveFirst", "Inactive first"]
  ];

  const addSort = (modalId, searchInputId, sortId, handlerName, defaultValue = "az") => {
    if(document.getElementById(sortId)) return;
    const searchInput = document.getElementById(searchInputId);
    const searchRow = searchInput?.closest(".modal-search-row");
    const modal = document.getElementById(modalId);
    if(!modal || !searchRow) return;

    const row = document.createElement("div");
    row.className = "modal-sort-row";

    const label = document.createElement("label");
    label.setAttribute("for", sortId);
    label.textContent = "Sort by";

    const select = document.createElement("select");
    select.id = sortId;
    options.forEach(([value, text]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      if(value === defaultValue) option.selected = true;
      select.appendChild(option);
    });
    select.addEventListener("change", () => {
      if(typeof window[handlerName] === "function") window[handlerName](false);
    });

    row.appendChild(label);
    row.appendChild(select);
    searchRow.parentElement.insertBefore(row, searchRow);
  };

  addSort("editPlayerModal", "editPlayerSearch", "editPlayerSort", "openEditPlayerModal", "az");
  addSort("ratingsModal", "ratingsSearch", "ratingsSort", "openRatingsModal", "ratingDesc");
  addSort("winLossModal", "winLossSearch", "winLossSort", "openWinLossModal", "winLossDesc");
}


function openWinLossModal(show = true){
  if(!canAccessDataPage()){ alert("Captain/admin only."); return; }

  const content = document.getElementById("winLossModalContent");
  if(!content) return;

  const search = (document.getElementById("winLossSearch")?.value || "").trim().toLowerCase();
  const sortMode = document.getElementById("winLossSort")?.value || "winLossDesc";

  const players = sortPlayersForModal(
    state.players.filter(p => !search || p.fullName.toLowerCase().includes(search)),
    sortMode
  );

  content.innerHTML = players.length ? players.map((p, i) => {
    const games = Number(p.gamesPlayed || 0);
    const wins = Number(p.wins || 0);
    const losses = Number(p.losses || 0);
    const winPct = games ? ((wins / games) * 100).toFixed(1) + "%" : "No record";
    let badgeClass = "record-pill-no-border";
    if(games && wins > losses) badgeClass = "record-pill record-pill-winning";
    else if(games && losses > wins) badgeClass = "record-pill record-pill-losing";
    else if(games) badgeClass = "record-pill record-pill-even";

    return `
      <div class="player">
        <div class="record-row" style="width:100%">
          <div>
            <div class="player-name">${i + 1}. ${escapeHtml(p.fullName)}</div>
            <div class="small">Games ${games} · Wins ${wins} · Losses ${losses} · Win % ${winPct} · W/L Rating ${Number(p.winLossRating || 0).toFixed(2)}</div>
          </div>
          <div class="${badgeClass}">${wins}-${losses}</div>
        </div>
      </div>
    `;
  }).join("") : '<div class="small">No players match that search.</div>';

  if(show) showModal("winLossModal");
}

function openRatingsModal(show = true){
  if(!canAccessDataPage()){ alert("Captain/admin only."); return; }
  const content = document.getElementById("ratingsModalContent");
  if(!content) return;

  const search = (document.getElementById("ratingsSearch")?.value || "").trim().toLowerCase();
  const sortMode = document.getElementById("ratingsSort")?.value || "ratingDesc";
  const players = sortPlayersForModal(
    state.players.filter(p => !search || p.fullName.toLowerCase().includes(search)),
    sortMode
  );

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

function editDomId(prefix, id){
  return `${prefix}-${String(id).replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function reopenInlineEditDropdown(playerId){
  const targetId = String(playerId);
  const list = document.getElementById("editPlayerModalList");
  if(!list) return;

  list.querySelectorAll("[data-player-id]").forEach(details => {
    details.open = String(details.getAttribute("data-player-id")) === targetId;
  });
}

function openEditPlayerModal(show = true){
  if(!canAccessDataPage()){ alert("Captain/admin only."); return; }

  const list = document.getElementById("editPlayerModalList");
  if(!list) return;

  const search = (document.getElementById("editPlayerSearch")?.value || "").trim().toLowerCase();
  const sortMode = document.getElementById("editPlayerSort")?.value || "az";
  const players = sortPlayersForModal(
    state.players.filter(p => !search || p.fullName.toLowerCase().includes(search)),
    sortMode
  );

  list.innerHTML = players.length ? players.map(p => {
    const id = String(p.id);
    const safe = editDomId("edit", id);
    return `
      <details class="edit-player-details" data-player-id="${escapeHtml(id)}">
        <summary>
          <div class="row" style="justify-content:space-between;align-items:center;gap:8px;width:100%">
            <div class="player-name" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(p.fullName)}</div>
            <button class="btn-secondary edit-active-toggle" type="button" data-toggle-player-active-id="${escapeHtml(id)}">${p.active ? "Active" : "Inactive"}</button>
          </div>
        </summary>

        <div class="inline-edit-form" data-edit-form-for="${escapeHtml(id)}">
          <div class="grid grid-2">
            <div><label>First Name</label><input id="${safe}-first" value="${escapeHtml(p.firstName || "")}"></div>
            <div><label>Last Name</label><input id="${safe}-last" value="${escapeHtml(p.lastName || "")}"></div>
          </div>
          <div class="grid grid-2" style="margin-top:10px">
            <div>
              <label>Status</label>
              <select id="${safe}-active">
                <option value="true" ${p.active ? "selected" : ""}>Active</option>
                <option value="false" ${!p.active ? "selected" : ""}>Inactive</option>
              </select>
            </div>
            <div>
              <label>Injury / Availability %</label>
              <input id="${safe}-injury" type="number" min="0" max="100" step="1" value="${Math.round(Number(p.injuryPct || 1) * 100)}">
            </div>
          </div>
          <div class="grid grid-4 admin-rating-fields" style="margin-top:10px">
            <div><label>Handling</label><input id="${safe}-handling" type="number" step="0.5" value="${Number(p.handling).toFixed(1)}" ${isAdmin() ? "" : "disabled"}></div>
            <div><label>Cutting</label><input id="${safe}-cutting" type="number" step="0.5" value="${Number(p.cutting).toFixed(1)}" ${isAdmin() ? "" : "disabled"}></div>
            <div><label>Defense</label><input id="${safe}-defense" type="number" step="0.5" value="${Number(p.defense).toFixed(1)}" ${isAdmin() ? "" : "disabled"}></div>
            <div><label>Win/Loss</label><input id="${safe}-winloss" type="number" step="0.01" value="${Number(p.winLossRating).toFixed(2)}" ${isAdmin() ? "" : "disabled"}></div>
          </div>
          <div class="toolbar" style="margin-top:10px">
            <button class="btn" type="button" data-save-player-id="${escapeHtml(id)}">Save Changes</button>
            ${isAdmin() ? `<button class="btn-danger" type="button" data-delete-player-id="${escapeHtml(id)}">Delete Player</button>` : ""}
          </div>
          <div class="small inline-edit-save-status" id="${safe}-status"></div>
        </div>
      </details>
    `;
  }).join("") : '<div class="small">No players match that search.</div>';

  list.querySelectorAll("[data-toggle-player-active-id]").forEach(btn => {
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await toggleInlinePlayerActive(btn.getAttribute("data-toggle-player-active-id"));
    });
  });

  list.querySelectorAll("[data-save-player-id]").forEach(btn => {
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await saveInlineEditedPlayer(btn.getAttribute("data-save-player-id"));
    });
  });

  list.querySelectorAll("[data-delete-player-id]").forEach(btn => {
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await deleteInlineEditedPlayer(btn.getAttribute("data-delete-player-id"));
    });
  });

  const help = document.getElementById("editPlayerHelp");
  if(help) help.textContent = "Tap a player name to open the dropdown.";

  updateRoleVisibility();
  if(show) showModal("editPlayerModal");
}


async function toggleInlinePlayerActive(playerId){
  if(!canAccessDataPage()){ alert("Captain/admin only."); return; }
  const p = playerById(playerId) || state.players.find(x => String(x.id) === String(playerId));
  if(!p){ alert("Could not find that player. Refresh and try again."); return; }

  const next = !p.active;
  const safe = editDomId("edit", p.id);
  const btn = document.querySelector(`[data-toggle-player-active-id="${String(p.id).replace(/"/g, '\\"')}"]`);
  const oldText = btn?.textContent;

  if(btn){
    btn.disabled = true;
    btn.textContent = next ? "Active..." : "Inactive...";
  }

  const { error } = await db.from("players")
    .update({ active: next, updated_at: new Date().toISOString() })
    .eq("id", p.id);

  if(btn) btn.disabled = false;

  if(error){
    if(btn) btn.textContent = oldText || (p.active ? "Active" : "Inactive");
    alert(error.message);
    return;
  }

  p.active = next;

  const activeSelect = document.getElementById(`${safe}-active`);
  if(activeSelect) activeSelect.value = next ? "true" : "false";

  document.querySelectorAll(`[data-toggle-player-active-id="${String(p.id).replace(/"/g, '\\"')}"]`).forEach(el => {
    el.textContent = next ? "Active" : "Inactive";
    el.disabled = false;
  });
}

async function saveInlineEditedPlayer(playerId){
  if(!canAccessDataPage()){ alert("Captain/admin only."); return; }
  const p = playerById(playerId) || state.players.find(x => String(x.id) === String(playerId));
  if(!p){ alert("Could not find that player. Refresh and try again."); return; }

  const safe = editDomId("edit", p.id);
  const statusEl = document.getElementById(`${safe}-status`);
  const saveBtn = document.querySelector(`[data-save-player-id="${String(p.id).replace(/"/g, '\\"')}"]`);

  const first = (document.getElementById(`${safe}-first`)?.value || "").trim();
  const last = (document.getElementById(`${safe}-last`)?.value || "").trim();
  if(!first && !last){ alert("Enter a valid player name."); return; }

  const injuryPctRaw = Number(document.getElementById(`${safe}-injury`)?.value || 100);
  const injuryPct = Math.max(0, Math.min(100, injuryPctRaw)) / 100;
  const activeVal = document.getElementById(`${safe}-active`)?.value !== "false";

  const payload = {
    first_name: first,
    last_name: last,
    active: activeVal,
    injury_pct: injuryPct,
    updated_at: new Date().toISOString()
  };

  if(isAdmin()){
    payload.handling = Number(document.getElementById(`${safe}-handling`)?.value || 0);
    payload.cutting = Number(document.getElementById(`${safe}-cutting`)?.value || 0);
    payload.defense = Number(document.getElementById(`${safe}-defense`)?.value || 0);
    payload.win_loss = Number(document.getElementById(`${safe}-winloss`)?.value || 0);
  }

  if(statusEl) statusEl.textContent = "Saving...";
  if(saveBtn) saveBtn.disabled = true;

  const { error } = await db.from("players").update(payload).eq("id", p.id);

  if(saveBtn) saveBtn.disabled = false;

  if(error){
    if(statusEl) statusEl.textContent = `Save failed: ${error.message}`;
    alert(error.message);
    return;
  }

  // iOS Safari was crashing when this flow reloaded all data, re-rendered the whole app,
  // reopened the modal, scrolled the dropdown, and then showed alert().
  // Keep it stable by updating only the local object and the visible open dropdown.
  p.firstName = first;
  p.lastName = last;
  p.fullName = `${first} ${last}`.trim();
  p.active = activeVal;
  p.injuryPct = injuryPct;

  if(isAdmin()){
    p.handling = payload.handling;
    p.cutting = payload.cutting;
    p.defense = payload.defense;
    p.winLossRating = payload.win_loss;
  }

  const details = document.getElementById(`${safe}-first`)?.closest("details");
  if(details){
    const nameEl = details.querySelector(".player-name");
    const activeBtn = details.querySelector("[data-toggle-player-active-id]");
    if(nameEl) nameEl.textContent = p.fullName;
    if(activeBtn) activeBtn.textContent = p.active ? "Active" : "Inactive";
    details.open = true;
  }

  if(statusEl) statusEl.textContent = "Saved.";
  setTimeout(() => {
    const currentStatus = document.getElementById(`${safe}-status`);
    if(currentStatus && currentStatus.textContent === "Saved.") currentStatus.textContent = "";
  }, 2500);
}

async function deleteInlineEditedPlayer(playerId){
  if(!isAdmin()){ alert("Admin only."); return; }
  const p = playerById(playerId) || state.players.find(x => String(x.id) === String(playerId));
  if(!p){ alert("Could not find that player. Refresh and try again."); return; }
  if(!confirm(`Delete ${p.fullName}? This cannot be undone.`)) return;

  const { error } = await db.from("players").delete().eq("id", p.id);
  if(error){ alert(error.message); return; }

  state.players = state.players.filter(x => String(x.id) !== String(p.id));
  const safe = editDomId("edit", p.id);
  const details = document.getElementById(`${safe}-first`)?.closest("details");
  if(details) details.remove();

  alert("Player deleted.");
}

// Backward-compatible names kept in case old cached buttons are still present briefly.
function selectPlayerForEdit(id){
  reopenInlineEditDropdown(id);
}
async function saveEditedPlayer(){
  if(selectedEditPlayerId) return saveInlineEditedPlayer(selectedEditPlayerId);
  alert("Open a player dropdown and use Save Changes there.");
}
async function deleteEditedPlayer(){
  if(selectedEditPlayerId) return deleteInlineEditedPlayer(selectedEditPlayerId);
  alert("Open a player dropdown and use Delete Player there.");
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


Object.assign(window, {
  toggleInlinePlayerActive,
  renderLateAddExistingList,
  selectLateAddExistingPlayer,
  clearLateAddExistingPlayer,
  clearLateAddExistingSearch,
  deleteGameFromHistory,
  ensurePlayerSortControls,
  openGameHistoryModal,
  openTeammateHistoryModal,
  openAuditLogsModal,
  voidLastSavedGame,
  openLateAddModal,
  openMyAttendanceHistoryModal,
  openMyWinLossRecordModal
});



/* ===== 4.10.0 feature additions and workflow improvements ===== */

state.showOnlyAttending = state.showOnlyAttending || false;
let cachedGameHistoryRows410 = [];
let cachedAuditLogRows410 = [];
let selectedManualMovePlayerA = "";
let selectedManualMovePlayerB = "";

function setLoading(message = "Working..."){
  const overlay = document.getElementById("loadingOverlay");
  const msg = document.getElementById("loadingMessage");
  if(msg) msg.textContent = message;
  if(overlay) overlay.style.display = "flex";
}

function clearLoading(){
  const overlay = document.getElementById("loadingOverlay");
  if(overlay) overlay.style.display = "none";
}

async function withLoading(message, fn){
  setLoading(message);
  try{
    return await fn();
  }finally{
    clearLoading();
  }
}


function injuryPercent(p){
  return Math.round(Number(p?.injuryPct ?? 1) * 100);
}

function injuryButtonClass(p){
  const pct = injuryPercent(p);
  if(pct >= 100) return "injury-btn injury-btn-good";
  if(pct >= 70) return "injury-btn injury-btn-mid";
  return "injury-btn injury-btn-low";
}

function injuryButtonLabel(p){
  return `Injury ${injuryPercent(p)}%`;
}

function injuryBadgeHtml(p){
  const pct = Math.round(Number(p?.injuryPct ?? 1) * 100);
  if(pct >= 100) return '<span class="injury-badge injury-good">100%</span>';
  if(pct >= 70) return `<span class="injury-badge injury-mid">${pct}%</span>`;
  return `<span class="injury-badge injury-low">${pct}%</span>`;
}

function toggleShowOnlyAttending(){
  state.showOnlyAttending = !state.showOnlyAttending;
  renderPlayers();
}

function updateShowOnlyAttendingButton(){
  const btn = document.getElementById("showOnlyAttendingBtn");
  if(btn) btn.textContent = `Show Only Attending: ${state.showOnlyAttending ? "On" : "Off"}`;
}

function renderPlayers(){
  const list = document.getElementById("playerList");
  if(!list) return;
  if(isGuest()){ list.innerHTML = '<div class="small">Sign in to mark attendance.</div>'; return; }

  const search = (document.getElementById("playerSearch")?.value || "").trim().toLowerCase();
  const players = [...state.players]
    .filter(p => isPlainUserOrGuest() || state.showInactive || p.active || p.attending)
    .filter(p => !state.showOnlyAttending || p.attending)
    .filter(p => !search || p.fullName.toLowerCase().includes(search))
    .sort(compareAttendancePlayers);

  updateShowOnlyAttendingButton();

  if(!players.length){
    list.innerHTML = '<div class="small">No players match that search.</div>';
    return;
  }

  list.innerHTML = "";

  players.forEach(p => {
    const row = document.createElement("div");
    row.className = "player clickable" + (p.attending ? " attend-on" : "") + (canManageGames() && !p.active ? " inactive" : "") + (p.temporary ? " temp" : "");
    row.onclick = e => {
      if(e.target.closest("button")) return;
      toggleAttendance(p.id);
    };

    const controls = canManageGames()
      ? `<div class="toggle-wrap">
          <button class="${injuryButtonClass(p)}" onclick="event.stopPropagation(); setInjuryPrompt('${p.id}')">${injuryButtonLabel(p)}</button>
          ${p.temporary ? `<button class="btn-danger" onclick="event.stopPropagation(); removePlayer('${p.id}')">Remove</button>` : ""}
        </div>`
      : "";

    row.innerHTML = `
      <div style="min-width:0">
        <div class="player-name">${escapeHtml(p.fullName)}${isCurrentSignedInPlayer(p) ? ' <span class="chip">You</span>' : ""}</div>
        ${canManageGames() && !p.active ? '<div class="small">Inactive</div>' : ""}
      </div>
      ${controls}
    `;
    list.appendChild(row);
  });
}

function ensureV410FeatureUi(){
  const saveWrap = document.getElementById("saveResultsWrap");
  if(saveWrap && !document.getElementById("manualMoveBtn")){
    const btn = document.createElement("button");
    btn.id = "manualMoveBtn";
    btn.className = "btn-secondary";
    btn.type = "button";
    btn.textContent = "Manual Move";
    btn.onclick = openManualMoveModal;
    const clearBtn = document.getElementById("clearTeamsBtn");
    if(clearBtn) saveWrap.insertBefore(btn, clearBtn);
    else saveWrap.appendChild(btn);
  }

  const grid = document.querySelector("#dataCaptainTools .player-tools-grid");
  if(grid){
    const addTool = (id, text, cls, handler) => {
      if(document.getElementById(id)) return;
      const b = document.createElement("button");
      b.id = id;
      b.className = cls;
      b.type = "button";
      b.textContent = text;
      b.onclick = handler;
      grid.appendChild(b);
    };
    addTool("archiveSeasonBtn", "Archive Season", "btn-secondary admin-only", openArchiveSeasonModal);
    addTool("manageAccountsBtn", "Manage Accounts", "btn-secondary admin-only", openManageAccountsModal);
  }

  const selfBox = document.getElementById("selfProfileBox");
  if(selfBox && !document.getElementById("myProfileBtn")){
    const toolbar = selfBox.querySelector(".toolbar") || selfBox;
    const b = document.createElement("button");
    b.id = "myProfileBtn";
    b.className = "btn-secondary";
    b.type = "button";
    b.textContent = "My Profile";
    b.onclick = openMyProfileModal;
    toolbar.insertBefore(b, toolbar.firstChild);
  }

  const attendanceControls = document.querySelector("#attendanceCard .grid.grid-2");
  if(attendanceControls && !document.getElementById("showOnlyAttendingBtn")){
    const b = document.createElement("button");
    b.id = "showOnlyAttendingBtn";
    b.className = "btn-secondary";
    b.type = "button";
    b.onclick = toggleShowOnlyAttending;
    attendanceControls.insertBefore(b, attendanceControls.children[1] || null);
  }
}

const renderAllBefore410 = renderAll;
renderAll = function(){
  ensureV410FeatureUi();
  renderAllBefore410();
  ensureV410FeatureUi();
  updateShowOnlyAttendingButton();
};

function currentTeamSummary(){
  return (state.currentGame?.teams || []).map((team, idx) => {
    const stats = teamStats(team);
    return { idx, count: team.length, overall: stats.overall };
  });
}

function resolveLateAddTeamIndex(player){
  const raw = document.getElementById("lateAddTeam")?.value ?? "0";
  const teams = state.currentGame?.teams || [];
  if(raw === "autoSmallest"){
    return currentTeamSummary().sort((a,b) => (a.count - b.count) || (a.overall - b.overall))[0]?.idx ?? 0;
  }
  if(raw === "autoWeakest"){
    return currentTeamSummary().sort((a,b) => (a.overall - b.overall) || (a.count - b.count))[0]?.idx ?? 0;
  }
  return Number(raw || 0);
}

function openLateAddModal(){
  if(!canManageGames()){ alert("Captain/admin only."); return; }
  if(!state.currentGame){ alert("Generate teams first."); return; }
  if(state.resultsSavedForCurrentGame){ alert("This game already has saved results. Late add is only available before results are saved."); return; }

  const teamOptions = `<option value="autoSmallest">Auto: smallest team</option>
    <option value="autoWeakest">Auto: lowest-rated team</option>` +
    (state.currentGame.teams || []).map((_, idx) => `<option value="${idx}">Team ${idx + 1}</option>`).join("");
  const likeOptions = '<option value="">Select...</option>' + state.players.slice().sort(comparePlayersByLastName).map(p => `<option value="${escapeHtml(String(p.id))}">${escapeHtml(p.fullName)}</option>`).join("");

  const body = `
    <div class="notice">Add a player after teams were generated. The player will be marked present, made active if needed, and added to a team. Results must not already be saved.</div>

    <div style="margin-top:10px"><label>Team</label><select id="lateAddTeam">${teamOptions}</select></div>

    <div class="hr"></div>
    <div class="player-name">Choose existing player</div>
    <input id="lateAddExisting" type="hidden" value="">
    <div id="lateAddSelectedExisting" class="small" style="margin-top:6px">No existing player selected. Choose one below, or add a new player.</div>

    <div class="modal-sort-row">
      <label for="lateAddExistingSort">Sort by</label>
      <select id="lateAddExistingSort" onchange="renderLateAddExistingList()">
        <option value="az" selected>Name A-Z</option>
        <option value="za">Name Z-A</option>
        <option value="ratingDesc">Overall rating high-low</option>
        <option value="ratingAsc">Overall rating low-high</option>
        <option value="winLossDesc">Win/Loss rating high-low</option>
        <option value="winLossAsc">Win/Loss rating low-high</option>
        <option value="activeFirst">Active first</option>
        <option value="inactiveFirst">Inactive first</option>
      </select>
    </div>
    <div class="modal-search-row">
      <div class="modal-search-input-wrap"><input id="lateAddExistingSearch" placeholder="Search existing players..." oninput="renderLateAddExistingList()"></div>
      <button class="btn-secondary modal-search-clear" type="button" onclick="clearLateAddExistingSearch()">Clear</button>
    </div>
    <div id="lateAddExistingList" class="late-add-player-list"></div>

    <div class="hr"></div>
    <div class="player-name">Or add new player</div>
    <div class="small">Leave existing player unselected to add a new one.</div>
    <div class="grid grid-2" style="margin-top:10px">
      <div><label>New Player Full Name</label><input id="lateAddName" placeholder="Mike Jones"></div>
      <div><label>Rate Like</label><select id="lateAddLike" onchange="loadLateAddRatingsFromLike()">${likeOptions}</select></div>
    </div>
    <div class="grid grid-3" style="margin-top:10px">
      <div><label>Handling</label><input id="lateAddHandling" type="number" step="0.1" value="3"></div>
      <div><label>Cutting</label><input id="lateAddCutting" type="number" step="0.1" value="3"></div>
      <div><label>Defense</label><input id="lateAddDefense" type="number" step="0.1" value="3"></div>
    </div>
    <label style="display:flex;align-items:center;gap:8px;margin-top:10px"><input id="lateAddTemporary" type="checkbox" checked style="width:auto"> One-time player</label>
    <div class="toolbar" style="margin-top:12px">
      <button class="btn" type="button" onclick="lateAddPlayerToCurrentGame()">Add To Team</button>
      <button class="btn-secondary" type="button" onclick="clearLateAddExistingPlayer()">Clear Selected Existing</button>
    </div>
    <div id="lateAddStatus" class="small" style="margin-top:8px"></div>`;

  makeDynamicModal("lateAddModal", "Late Add Player", body);
  renderLateAddExistingList();
}

async function lateAddPlayerToCurrentGame(){
  if(!canManageGames() || !state.currentGame) return;
  const status = document.getElementById("lateAddStatus");
  if(state.resultsSavedForCurrentGame){ alert("Results are already saved for this game."); return; }

  await withLoading("Adding player...", async () => {
    let player = null;
    const existingId = document.getElementById("lateAddExisting")?.value || "";
    if(existingId){
      player = playerById(existingId);
      if(!player) throw new Error("Existing player not found. Refresh and try again.");
      const { error } = await saveAttendanceFromApp(player.id, true);
      if(error) throw error;
      player.active = true;
      player.attending = true;
    }else{
      const fullName = normalizeName(document.getElementById("lateAddName")?.value || "");
      if(!fullName) throw new Error("Enter a new player name or choose an existing player.");
      const { first, last } = splitName(fullName);
      if(status) status.textContent = "Adding player...";
      const { data, error } = await db.rpc("add_player_from_app", {
        p_first_name: first,
        p_last_name: last,
        p_handling: Number(document.getElementById("lateAddHandling")?.value || 3),
        p_cutting: Number(document.getElementById("lateAddCutting")?.value || 3),
        p_defense: Number(document.getElementById("lateAddDefense")?.value || 3),
        p_temporary: !!document.getElementById("lateAddTemporary")?.checked,
        p_mark_present: true
      });
      if(error) throw error;
      await loadCloudData();
      const newId = data?.player_id || data?.playerId;
      player = state.players.find(p => String(p.id) === String(newId)) || state.players.find(p => normalizeNameForMatch(p.fullName) === normalizeNameForMatch(fullName));
      if(!player) throw new Error("Player was added, but could not be loaded into the game. Refresh and try again.");
    }

    if(currentGamePlayerIds().has(String(player.id))) throw new Error("That player is already in the current game.");
    const teamIdx = resolveLateAddTeamIndex(player);
    if(!state.currentGame.teams?.[teamIdx]) throw new Error("Choose a valid team.");
    state.currentGame.teams[teamIdx].push(player);
    state.resultsSavedForCurrentGame = false;
    await saveCurrentGameToDb(false);
    await loadCloudData();
    renderAll();
    hideModal("lateAddModal");
  }).catch(e => {
    if(status) status.textContent = "Add failed.";
    alert(e?.message || e);
  });
}

function teamSelectOptionsForManual(){
  return (state.currentGame?.teams || []).map((team, idx) => `<option value="${idx}">Team ${idx + 1} (${team.length})</option>`).join("");
}

function currentGamePlayerOptions(){
  const rows = [];
  (state.currentGame?.teams || []).forEach((team, teamIdx) => {
    (team || []).forEach(p => rows.push(`<option value="${teamIdx}|${escapeHtml(String(p.id))}">Team ${teamIdx + 1} - ${escapeHtml(p.fullName || playerDisplayNameFromTeamsPlayer(p))}</option>`));
  });
  return rows.join("");
}

function openManualMoveModal(){
  if(!canManageGames()){ alert("Captain/admin only."); return; }
  if(!state.currentGame){ alert("Generate teams first."); return; }
  if(state.resultsSavedForCurrentGame){ alert("This game already has saved results. Manual move is only available before results are saved."); return; }

  const body = `
    <div class="notice">Move one player to another team, or swap two players between teams. This updates the current game but does not change ratings or history until results/pairings are saved.</div>
    <div class="hr"></div>
    <h3 style="margin:0 0 8px">Move player</h3>
    <div class="grid grid-2">
      <div><label>Player</label><select id="manualMovePlayer">${currentGamePlayerOptions()}</select></div>
      <div><label>Move to team</label><select id="manualMoveTarget">${teamSelectOptionsForManual()}</select></div>
    </div>
    <div class="toolbar" style="margin-top:10px"><button class="btn" type="button" onclick="manualMovePlayer()">Move Player</button></div>
    <div class="hr"></div>
    <h3 style="margin:0 0 8px">Swap players</h3>
    <div class="grid grid-2">
      <div><label>Player A</label><select id="manualSwapA">${currentGamePlayerOptions()}</select></div>
      <div><label>Player B</label><select id="manualSwapB">${currentGamePlayerOptions()}</select></div>
    </div>
    <div class="toolbar" style="margin-top:10px"><button class="btn-secondary" type="button" onclick="manualSwapPlayers()">Swap Players</button></div>
    <div id="manualMoveStatus" class="small" style="margin-top:8px"></div>`;
  makeDynamicModal("manualMoveModal", "Manual Move", body);
}

function parseTeamPlayerValue(value){
  const [teamIdx, playerId] = String(value || "").split("|");
  return { teamIdx: Number(teamIdx), playerId };
}

async function persistManualTeams(message){
  await saveCurrentGameToDb(false);
  renderAll();
  const el = document.getElementById("manualMoveStatus");
  if(el) el.textContent = message || "Updated.";
}

async function manualMovePlayer(){
  try{
    const { teamIdx, playerId } = parseTeamPlayerValue(document.getElementById("manualMovePlayer")?.value);
    const targetIdx = Number(document.getElementById("manualMoveTarget")?.value || 0);
    const teams = state.currentGame?.teams || [];
    if(teamIdx === targetIdx) throw new Error("That player is already on that team.");
    const playerIndex = teams[teamIdx]?.findIndex(p => String(p.id) === String(playerId));
    if(playerIndex < 0) throw new Error("Player not found.");
    const [player] = teams[teamIdx].splice(playerIndex, 1);
    teams[targetIdx].push(player);
    state.resultsSavedForCurrentGame = false;
    await persistManualTeams("Player moved.");
    openManualMoveModal();
  }catch(e){ alert(e?.message || e); }
}

async function manualSwapPlayers(){
  try{
    const a = parseTeamPlayerValue(document.getElementById("manualSwapA")?.value);
    const b = parseTeamPlayerValue(document.getElementById("manualSwapB")?.value);
    if(a.playerId === b.playerId) throw new Error("Choose two different players.");
    const teams = state.currentGame?.teams || [];
    const ai = teams[a.teamIdx]?.findIndex(p => String(p.id) === String(a.playerId));
    const bi = teams[b.teamIdx]?.findIndex(p => String(p.id) === String(b.playerId));
    if(ai < 0 || bi < 0) throw new Error("Could not find one of those players.");
    const temp = teams[a.teamIdx][ai];
    teams[a.teamIdx][ai] = teams[b.teamIdx][bi];
    teams[b.teamIdx][bi] = temp;
    state.resultsSavedForCurrentGame = false;
    await persistManualTeams("Players swapped.");
    openManualMoveModal();
  }catch(e){ alert(e?.message || e); }
}

async function sendTeamGeneratedNotification(){
  if(!canManageGames()) return;
  try{
    const teams = serializableTeams().map((team, idx) => ({
      teamNumber: idx + 1,
      players: team.map(p => ({ id: p.id, fullName: p.fullName }))
    }));
    const { data, error } = await db.functions.invoke("send-team-notification", {
      body: {
        title: "New teams are ready",
        body: "New ultimate teams have been generated.",
        url: window.location.origin + window.location.pathname,
        teams
      }
    });

    if(error){
      alert("Teams were generated, but the push notification failed: " + (error.message || error));
      return;
    }

    console.log("Push notification result", data);
  }catch(e){
    alert("Teams were generated, but the push notification failed: " + (e?.message || e));
  }
}

async function generateTeamsButton(){
  if(!canGenerateTeams()){ alert("Only captains/admins can generate teams."); return; }

  await withLoading("Generating teams...", async () => {
    if(state.currentGame && !state.resultsSavedForCurrentGame){
      const continueWithoutResults = await confirmContinueWithoutResults();
      if(!continueWithoutResults) return;
      await savePairingsOnlyForCurrentGame();
    }

    const sendPush = await askAdminWhetherToSendTeamNotification();
    await generateGame(sendPush);
  });
}

async function saveResults(){
  if(!canManageGames()){ alert("Captain/admin only."); return; }
  if(!state.currentGame){ alert("Generate teams first."); return; }
  if(state.selectedWinnerIndex === null || state.selectedWinnerIndex === undefined){ alert("Tap the winning team first."); return; }
  if(!state.currentGame.teams?.[state.selectedWinnerIndex]){ alert("Winning team selection is invalid."); return; }
  if(state.resultsSavedForCurrentGame){
    alert("Results are already saved for this game. This prevents accidental duplicate stat/rating updates.");
    return;
  }

  await withLoading("Saving results...", async () => {
    const msg = document.getElementById("resultMessage");
    if(msg) msg.textContent = "Saving results...";
    const { error } = await db.rpc("save_game_results", {
      p_winner_team_index: Number(state.selectedWinnerIndex),
      p_teams: serializableTeams(),
      p_generated_at: state.currentGameGeneratedAt || null
    });

    if(error) throw error;

    await loadCloudData();
    renderAll();
    const finalMsg = document.getElementById("resultMessage");
    if(finalMsg) finalMsg.textContent = "Results saved. Records, Win/Loss ratings, game history, and teammate history updated.";
  }).catch(error => {
    const msg = document.getElementById("resultMessage");
    if(msg) msg.textContent = "Results save failed.";
    alert("Results save failed: " + (error?.message || error));
  });
}

function gameIncludesPlayerName(game, query){
  const q = normalizeNameForMatch(query);
  if(!q) return true;
  return (game.teams || []).some(team => (team || []).some(p => normalizeNameForMatch(playerDisplayNameFromTeamsPlayer(p)).includes(q)));
}

function renderGameHistoryModalRows(){
  const list = document.getElementById("gameHistoryFilterList");
  if(!list) return;
  const playerSearch = document.getElementById("gameHistoryPlayerSearch")?.value || "";
  const type = document.getElementById("gameHistoryTypeFilter")?.value || "all";
  const from = document.getElementById("gameHistoryFrom")?.value || "";
  const to = document.getElementById("gameHistoryTo")?.value || "";

  let games = cachedGameHistoryRows410.slice();
  if(playerSearch) games = games.filter(g => gameIncludesPlayerName(g, playerSearch));
  if(type === "results") games = games.filter(g => g.winner_team_index !== null && g.winner_team_index !== undefined);
  if(type === "pairings") games = games.filter(g => g.winner_team_index === null || g.winner_team_index === undefined);
  if(from) games = games.filter(g => String(g.played_at || "") >= `${from}T00:00:00`);
  if(to) games = games.filter(g => String(g.played_at || "") <= `${to}T23:59:59`);

  if(!games.length){
    list.innerHTML = '<div class="small">No games match those filters.</div>';
    return;
  }

  list.innerHTML = `<div class="mini-table">${games.map(g => {
    const teams = Array.isArray(g.teams) ? g.teams : [];
    const teamHtml = teams.map((team, idx) => `<div class="team-line"><strong>Team ${idx + 1}:</strong> ${(Array.isArray(team) ? team : []).map(playerDisplayNameFromTeamsPlayer).map(escapeHtml).join(", ")}</div>`).join("");
    const deleteBtn = isAdmin()
      ? `<button class="btn-danger" style="width:auto;margin-top:10px" type="button" onclick="deleteGameFromHistory('${escapeHtml(String(g.id))}')">Delete Game</button>`
      : "";
    return `<div class="history-card"><div class="row" style="justify-content:space-between;gap:10px"><strong>${escapeHtml(formatDateTime(g.played_at) || "Game")}</strong><span class="chip">${escapeHtml(winnerLabelForGame(g))}</span></div>${teamHtml}${deleteBtn}</div>`;
  }).join("")}</div>`;
}

async function openGameHistoryModal(){
  if(!canAccessDataPage()){ alert("Captain/admin only."); return; }
  makeDynamicModal("gameHistoryModal", "Game History", '<div class="small">Loading game history...</div>');
  const { data, error } = await db.from("games").select("*").order("played_at", { ascending:false }).limit(500);
  if(error){ makeDynamicModal("gameHistoryModal", "Game History", `<div class="notice">${escapeHtml(error.message)}</div>`); return; }
  cachedGameHistoryRows410 = data || [];
  const body = `
    <div class="filter-grid">
      <div><label>Search player</label><input id="gameHistoryPlayerSearch" placeholder="Player name" oninput="renderGameHistoryModalRows()"></div>
      <div><label>Type</label><select id="gameHistoryTypeFilter" onchange="renderGameHistoryModalRows()"><option value="all">All games</option><option value="results">Results only</option><option value="pairings">Pairings only</option></select></div>
      <div><label>From</label><input id="gameHistoryFrom" type="date" onchange="renderGameHistoryModalRows()"></div>
      <div><label>To</label><input id="gameHistoryTo" type="date" onchange="renderGameHistoryModalRows()"></div>
      <div><label>&nbsp;</label><button class="btn-secondary" type="button" onclick="setValue('gameHistoryPlayerSearch','');setValue('gameHistoryFrom','');setValue('gameHistoryTo','');setValue('gameHistoryTypeFilter','all');renderGameHistoryModalRows()">Clear Filters</button></div>
    </div>
    <div id="gameHistoryFilterList"></div>`;
  makeDynamicModal("gameHistoryModal", "Game History", body);
  renderGameHistoryModalRows();
}

function teammateRowsForPlayer(playerId, counts){
  return counts
    .filter(h => String(h.player_a) === String(playerId) || String(h.player_b) === String(playerId))
    .map(h => {
      const otherId = String(h.player_a) === String(playerId) ? h.player_b : h.player_a;
      const other = playerById(otherId)?.fullName || otherId;
      return { other, count: Number(h.count || 0) };
    })
    .sort((a,b) => b.count - a.count || a.other.localeCompare(b.other));
}

function renderTeammateByPlayer(counts){
  const select = document.getElementById("teammatePlayerSelect");
  const out = document.getElementById("teammateByPlayerOutput");
  if(!select || !out) return;
  const rows = teammateRowsForPlayer(select.value, counts);
  out.innerHTML = rows.length
    ? rows.slice(0, 25).map(r => `<div class="history-card"><div class="row" style="justify-content:space-between;gap:10px"><div>${escapeHtml(r.other)}</div><strong>${r.count}</strong></div></div>`).join("")
    : '<div class="small">No teammate history for that player yet.</div>';
}

async function openTeammateHistoryModal(){
  if(!canAccessDataPage()){ alert("Captain/admin only."); return; }
  makeDynamicModal("teammateHistoryModal", "Teammate History", '<div class="small">Loading teammate history...</div>');
  const [histRes, eventRes] = await Promise.all([
    db.from("teammate_history").select("*").order("count", { ascending:false }).limit(500),
    db.from("teammate_pair_events").select("*").order("created_at", { ascending:false }).limit(100)
  ]);
  if(histRes.error || eventRes.error){
    makeDynamicModal("teammateHistoryModal", "Teammate History", `<div class="notice">${escapeHtml(histRes.error?.message || eventRes.error?.message || "Could not load history.")}</div>`);
    return;
  }
  const counts = histRes.data || [];
  const recent = eventRes.data || [];
  const playerOptions = state.players.slice().sort(comparePlayersByLastName).map(p => `<option value="${escapeHtml(String(p.id))}">${escapeHtml(p.fullName)}</option>`).join("");
  const countHtml = counts.length ? counts.slice(0, 100).map(h => {
    const a = playerById(h.player_a)?.fullName || h.player_a;
    const b = playerById(h.player_b)?.fullName || h.player_b;
    return `<div class="history-card"><div class="row" style="justify-content:space-between;gap:10px"><div>${escapeHtml(a)} ↔ ${escapeHtml(b)}</div><strong>${Number(h.count || 0)}</strong></div></div>`;
  }).join("") : '<div class="small">No teammate history counts yet.</div>';
  const recentHtml = recent.length ? recent.map(e => {
    const a = playerById(e.player_a)?.fullName || e.player_a;
    const b = playerById(e.player_b)?.fullName || e.player_b;
    return `<div class="small">${escapeHtml(formatDateTime(e.created_at))}: ${escapeHtml(a)} ↔ ${escapeHtml(b)} · ${escapeHtml(e.source || "")}</div>`;
  }).join("") : '<div class="small">No recent pairing events yet.</div>';
  const body = `
    <h3 style="margin:0 0 8px">By player</h3>
    <div class="grid grid-2">
      <div><label>Player</label><select id="teammatePlayerSelect" onchange="renderTeammateByPlayer(window.__lastTeammateCounts410 || [])">${playerOptions}</select></div>
    </div>
    <div id="teammateByPlayerOutput" class="mini-table" style="margin-top:10px"></div>
    <div class="hr"></div>
    <h3 style="margin:0 0 8px">Top teammate pairs</h3><div class="mini-table">${countHtml}</div>
    <div class="hr"></div><h3 style="margin:0 0 8px">Recent pairing events</h3>${recentHtml}`;
  window.__lastTeammateCounts410 = counts;
  makeDynamicModal("teammateHistoryModal", "Teammate History", body);
  renderTeammateByPlayer(counts);
}

async function openMyProfileModal(){
  if(!currentUser){ alert("Sign in first."); return; }
  const me = currentSignedInPlayer();
  if(!me){
    makeDynamicModal("myProfileModal", "My Profile", '<div class="notice">I could not match your account name to a player record. Ask an admin to make your account first/last name match the roster.</div>');
    return;
  }
  const { data, error } = await db.from("teammate_history").select("*").or(`player_a.eq.${me.id},player_b.eq.${me.id}`).order("count", { ascending:false }).limit(10);
  const top = error ? [] : teammateRowsForPlayer(me.id, data || []);
  const topHtml = top.length ? top.map(r => `<div class="history-card"><div class="row" style="justify-content:space-between"><div>${escapeHtml(r.other)}</div><strong>${r.count}</strong></div></div>`).join("") : '<div class="small">No teammate history yet.</div>';
  const pct = me.gamesPlayed ? ((me.wins / me.gamesPlayed) * 100).toFixed(1) + "%" : "0.0%";
  const body = `
    <div class="notice">Matched player: ${escapeHtml(me.fullName)}</div>
    <div class="profile-stat-grid">
      <div class="profile-stat"><strong>${me.gamesPlayed}</strong><span class="small">Games</span></div>
      <div class="profile-stat"><strong>${me.wins}-${me.losses}</strong><span class="small">Record</span></div>
      <div class="profile-stat"><strong>${pct}</strong><span class="small">Win %</span></div>
    </div>
    <div class="hr"></div>
    <h3 style="margin:0 0 8px">Most common teammates</h3>
    <div class="mini-table">${topHtml}</div>`;
  makeDynamicModal("myProfileModal", "My Profile", body);
}

function setupStatus(label, ok, detail = ""){
  return `<div class="history-card"><div class="row" style="justify-content:space-between;gap:10px"><strong>${escapeHtml(label)}</strong><span class="chip">${ok ? "OK" : "Check"}</span></div>${detail ? `<div class="small">${escapeHtml(detail)}</div>` : ""}</div>`;
}

async function openSetupChecklistModal(){
  if(!canAccessDataPage()){ alert("Captain/admin only."); return; }
  makeDynamicModal("setupChecklistModal", "Setup Checklist", '<div class="small">Checking setup...</div>');
  const checks = [];
  checks.push(setupStatus("Supabase URL configured", !!SUPABASE_URL, SUPABASE_URL || "Missing"));
  checks.push(setupStatus("Supabase key configured", !!SUPABASE_KEY && !SUPABASE_KEY.includes("PASTE_"), SUPABASE_KEY ? "Public key present" : "Missing"));
  checks.push(setupStatus("Push public key configured", !!VAPID_PUBLIC_KEY, VAPID_PUBLIC_KEY ? "VAPID public key present" : "Missing VAPID public key"));
  checks.push(setupStatus("Current version", true, APP_VERSION));
  try{
    const [cg, att, players, games] = await Promise.all([
      db.from("current_game").select("id").limit(1),
      db.from("attendance").select("player_id").limit(1),
      db.from("players").select("id").limit(1),
      db.from("games").select("id").limit(1)
    ]);
    checks.push(setupStatus("Players table reachable", !players.error, players.error?.message || ""));
    checks.push(setupStatus("Attendance table reachable", !att.error, att.error?.message || ""));
    checks.push(setupStatus("Current game table reachable", !cg.error, cg.error?.message || ""));
    checks.push(setupStatus("Game history table reachable", !games.error, games.error?.message || ""));
  }catch(e){
    checks.push(setupStatus("Database check", false, e?.message || String(e)));
  }
  checks.push(setupStatus("CNAME file", true, "Package includes CNAME: nmultimateteams.app"));
  makeDynamicModal("setupChecklistModal", "Setup Checklist", `<div class="mini-table">${checks.join("")}</div>`);
}

function updateAppVersionLine(){
  const dataPage = document.getElementById("dataPage");
  if(!dataPage) return;
  document.querySelectorAll("#dataVersionCard").forEach(card => card.remove());
  let el = document.getElementById("dataAppVersionLine");
  if(!el){
    el = document.createElement("button");
    el.id = "dataAppVersionLine";
    el.className = "app-version-line btn-secondary";
    el.style.width = "auto";
    el.style.margin = "18px auto 4px";
    dataPage.appendChild(el);
  }else if(el.parentElement !== dataPage){
    dataPage.appendChild(el);
  }
  el.textContent = `Version: ${APP_VERSION}`;
  el.onclick = openSetupChecklistModal;
  el.title = "Open setup checklist";
}

async function openAuditLogsModal(){
  if(!isAdmin()){ alert("Admin only."); return; }
  makeDynamicModal("auditLogsModal", "Admin Audit Logs", '<div class="small">Loading audit logs...</div>');
  const { data, error } = await db.from("admin_audit_logs").select("*").order("created_at", { ascending:false }).limit(500);
  if(error){ makeDynamicModal("auditLogsModal", "Admin Audit Logs", `<div class="notice">${escapeHtml(error.message)}</div>`); return; }
  cachedAuditLogRows410 = data || [];
  const body = `
    <div class="filter-grid">
      <div><label>Action</label><select id="auditActionFilter" onchange="renderAuditLogRows()"><option value="">All</option><option value="rating">Rating edits</option><option value="player_added">Player added</option><option value="player_deleted">Player deleted</option><option value="game_deleted">Game deleted</option><option value="void">Voids/deletes</option></select></div>
      <div><label>Search</label><input id="auditSearch" placeholder="Search details..." oninput="renderAuditLogRows()"></div>
      <div><label>&nbsp;</label><button class="btn-secondary" type="button" onclick="downloadAuditLogsCsv()">Export CSV</button></div>
    </div>
    <div id="auditLogsList"></div>`;
  makeDynamicModal("auditLogsModal", "Admin Audit Logs", body);
  renderAuditLogRows();
}

function renderAuditLogRows(){
  const list = document.getElementById("auditLogsList");
  if(!list) return;
  const action = document.getElementById("auditActionFilter")?.value || "";
  const search = (document.getElementById("auditSearch")?.value || "").toLowerCase();
  let logs = cachedAuditLogRows410.slice();
  if(action){
    logs = logs.filter(l => String(l.action || "").toLowerCase().includes(action) || String(l.table_name || "").toLowerCase().includes(action));
  }
  if(search){
    logs = logs.filter(l => JSON.stringify(l).toLowerCase().includes(search));
  }
  list.innerHTML = logs.length ? `<div class="mini-table">${logs.map(log => {
    const details = log.details ? JSON.stringify(log.details) : "";
    return `<div class="history-card"><div class="row" style="justify-content:space-between;gap:10px"><strong>${escapeHtml(log.action || "log")}</strong><span class="small">${escapeHtml(formatDateTime(log.created_at))}</span></div><div class="small">Table: ${escapeHtml(log.table_name || "")} · Actor role: ${escapeHtml(log.actor_role || "")}</div><pre style="white-space:pre-wrap;font-size:11px;overflow:auto">${escapeHtml(details)}</pre></div>`;
  }).join("")}</div>` : '<div class="small">No audit logs match those filters.</div>';
}

function downloadAuditLogsCsv(){
  const rows = [["Created At","Action","Table","Actor Role","Details"], ...cachedAuditLogRows410.map(l => [
    l.created_at || "", l.action || "", l.table_name || "", l.actor_role || "", JSON.stringify(l.details || {})
  ])];
  downloadBlob(`${getDatePrefix()}_admin_audit_logs.csv`, rows.map(r => r.map(escapeCsv).join(",")).join("\n"), "text/csv");
}

async function openManageAccountsModal(){
  if(!isAdmin()){ alert("Admin only."); return; }
  makeDynamicModal("manageAccountsModal", "Manage Accounts", '<div class="small">Loading accounts...</div>');
  const { data, error } = await db.from("profiles").select("*").order("email");
  if(error){ makeDynamicModal("manageAccountsModal", "Manage Accounts", `<div class="notice">${escapeHtml(error.message)}</div>`); return; }
  window.__profiles410 = data || [];
  const body = `
    <div class="notice">Admins can change account roles here. Match is based on profile name vs roster name.</div>
    <div class="modal-search-row">
      <div class="modal-search-input-wrap"><input id="accountSearch" placeholder="Search accounts..." oninput="renderManageAccountsRows()"></div>
      <button class="btn-secondary modal-search-clear" type="button" onclick="setValue('accountSearch','');renderManageAccountsRows()">Clear</button>
    </div>
    <div id="manageAccountsRows" class="mini-table" style="margin-top:10px"></div>`;
  makeDynamicModal("manageAccountsModal", "Manage Accounts", body);
  renderManageAccountsRows();
}

function renderManageAccountsRows(){
  const out = document.getElementById("manageAccountsRows");
  if(!out) return;
  const q = (document.getElementById("accountSearch")?.value || "").toLowerCase();
  const rows = (window.__profiles410 || []).filter(p => !q || JSON.stringify(p).toLowerCase().includes(q));
  out.innerHTML = rows.length ? rows.map(p => {
    const full = p.full_name || `${p.first_name || ""} ${p.last_name || ""}`.trim();
    const match = state.players.find(pl => normalizeNameForMatch(pl.fullName) === normalizeNameForMatch(full));
    return `<div class="history-card">
      <div class="player-name">${escapeHtml(full || p.email || p.id)}</div>
      <div class="small">${escapeHtml(p.email || "")}</div>
      <div class="small">Matched player: ${escapeHtml(match?.fullName || "No roster match")}</div>
      <div class="toolbar" style="margin-top:8px">
        <select id="role-${escapeHtml(String(p.id))}" style="max-width:170px">
          <option value="user" ${p.role === "user" ? "selected" : ""}>user</option>
          <option value="captain" ${p.role === "captain" ? "selected" : ""}>captain</option>
          <option value="admin" ${p.role === "admin" ? "selected" : ""}>admin</option>
        </select>
        <button class="btn-secondary" type="button" onclick="saveManagedAccountRole('${escapeHtml(String(p.id))}')">Save Role</button>
      </div>
    </div>`;
  }).join("") : '<div class="small">No accounts found.</div>';
}

async function saveManagedAccountRole(profileId){
  if(!isAdmin()) return;
  const role = document.getElementById(`role-${profileId}`)?.value || "user";
  const { error } = await db.from("profiles").update({ role }).eq("id", profileId);
  if(error){ alert(error.message); return; }
  const p = (window.__profiles410 || []).find(x => String(x.id) === String(profileId));
  if(p) p.role = role;
  alert("Role saved.");
  renderManageAccountsRows();
}

async function openArchiveSeasonModal(){
  if(!isAdmin()){ alert("Admin only."); return; }
  const body = `
    <div class="notice">Archive the current season before resetting stats. This stores player stats, games, teammate history, and settings in Supabase.</div>
    <div style="margin-top:10px"><label>Season name</label><input id="archiveSeasonName" value="Season ${new Date().getFullYear()}"></div>
    <label style="display:flex;gap:8px;align-items:center;margin-top:10px"><input id="archiveResetStats" type="checkbox" checked style="width:auto"> Reset games/wins/losses/Win-Loss after archive</label>
    <label style="display:flex;gap:8px;align-items:center;margin-top:10px"><input id="archiveResetHistory" type="checkbox" style="width:auto"> Also clear teammate history after archive</label>
    <div class="toolbar" style="margin-top:12px"><button class="btn-warn" type="button" onclick="archiveCurrentSeason()">Archive Season</button></div>
    <div id="archiveSeasonStatus" class="small" style="margin-top:8px"></div>`;
  makeDynamicModal("archiveSeasonModal", "Archive Season", body);
}

async function archiveCurrentSeason(){
  if(!isAdmin()) return;
  const name = (document.getElementById("archiveSeasonName")?.value || "").trim() || `Season ${new Date().getFullYear()}`;
  const resetStats = !!document.getElementById("archiveResetStats")?.checked;
  const resetHistory = !!document.getElementById("archiveResetHistory")?.checked;
  if(!confirm(`Archive "${name}"?${resetStats ? "\n\nStats will be reset after archive." : ""}${resetHistory ? "\nTeammate history will also be cleared." : ""}`)) return;
  await withLoading("Archiving season...", async () => {
    const { data, error } = await db.rpc("archive_current_season", {
      p_name: name,
      p_reset_stats: resetStats,
      p_reset_history: resetHistory
    });
    if(error) throw error;
    const status = document.getElementById("archiveSeasonStatus");
    if(status) status.textContent = `Archived ${data?.players ?? 0} players.`;
    await loadCloudData();
    renderAll();
  }).catch(e => alert(e?.message || e));
}

function backupSummaryHtml(backup){
  const s = summarizeBackupJson(backup);
  const gameCount = Array.isArray(backup?.gameHistory) ? backup.gameHistory.length : 0;
  const pairEventCount = Array.isArray(backup?.teammatePairEvents) ? backup.teammatePairEvents.length : 0;
  const auditCount = Array.isArray(backup?.adminAuditLogs) ? backup.adminAuditLogs.length : 0;
  return `<div class="notice"><strong>Backup summary</strong><br>${escapeHtml(s.message).replaceAll("\n","<br>")}<br>Game history: ${gameCount}<br>Pair events: ${pairEventCount}<br>Audit logs: ${auditCount}<br>Version: ${escapeHtml(backup?.appVersion || "unknown")}<br>Exported: ${escapeHtml(backup?.exportedAt || "unknown")}</div>`;
}

async function importBackupJsonFile(event){
  if(!isAdmin()){ alert("Admin only."); return; }
  const input = event?.target;
  const file = input?.files?.[0];
  if(!file) return;

  try{
    const text = await file.text();
    const backup = JSON.parse(text);
    const summary = summarizeBackupJson(backup);
    if(!summary.valid){
      alert("This does not look like a valid Ultimate Teams backup JSON file.");
      return;
    }

    window.__pendingBackup410 = backup;
    const body = `${backupSummaryHtml(backup)}
      <div class="hr"></div>
      <label style="display:flex;gap:8px;align-items:center"><input id="restorePlayersOnly" type="checkbox" style="width:auto"> Restore players only</label>
      <label style="display:flex;gap:8px;align-items:center;margin-top:8px"><input id="restoreSettingsOnly" type="checkbox" style="width:auto"> Restore settings only</label>
      <div class="small" style="margin-top:8px">Leave both unchecked to restore everything in the backup. Export your current backup first if you may need to undo this.</div>
      <div class="toolbar" style="margin-top:12px"><button class="btn-warn" type="button" onclick="confirmPendingBackupRestore()">Restore Backup</button></div>`;
    makeDynamicModal("backupRestoreModal", "Restore Backup", body);
  }catch(e){
    console.error(e);
    alert("Could not import backup JSON: " + (e?.message || e));
  }finally{
    if(input) input.value = "";
  }
}

async function confirmPendingBackupRestore(){
  const backup = window.__pendingBackup410;
  if(!backup){ alert("No backup loaded."); return; }
  const playersOnly = !!document.getElementById("restorePlayersOnly")?.checked;
  const settingsOnly = !!document.getElementById("restoreSettingsOnly")?.checked;

  if(playersOnly && settingsOnly){ alert("Choose only one restore mode, or leave both unchecked for full restore."); return; }
  if(!confirm("Restore selected backup data? This cannot be undone unless you exported the current data first.")) return;

  await withLoading("Restoring backup...", async () => {
    if(playersOnly){
      const players = backup.players.map(backupPlayerToRow).filter(p => p.id && (p.first_name || p.last_name));
      for(const chunk of chunkArray(players, 100)){
        const { error } = await db.from("players").upsert(chunk, { onConflict:"id" });
        if(error) throw error;
      }
    }else if(settingsOnly){
      const s = backup.settings || {};
      const { error } = await db.from("settings").upsert({
        id: "main",
        weight_handling: Number(s.weightHandling ?? 0.35),
        weight_cutting: Number(s.weightCutting ?? 0.35),
        weight_defense: Number(s.weightDefense ?? 0.30),
        k_factor: Number(s.kFactor ?? 0.08),
        repeat_weight: Number(s.repeatWeight ?? 4),
        prioritize_handler_separation: !!s.prioritizeHandlerSeparation,
        handler_separation_boost: Number(s.handlerSeparationBoost ?? 2),
        prioritize_elite_balance: !!s.prioritizeEliteBalance,
        elite_balance_boost: Number(s.eliteBalanceBoost ?? 2),
        updated_at: new Date().toISOString()
      }, { onConflict:"id" });
      if(error) throw error;
    }else{
      await restoreBackupJson(backup);
    }
    hideModal("backupRestoreModal");
    await loadCloudData();
    renderAll();
    alert("Backup restored.");
  }).catch(e => alert(e?.message || e));
}

Object.assign(window, {
  setLoading,
  clearLoading,
  toggleShowOnlyAttending,
  openManualMoveModal,
  manualMovePlayer,
  manualSwapPlayers,
  openMyProfileModal,
  openSetupChecklistModal,
  renderGameHistoryModalRows,
  renderTeammateByPlayer,
  renderAuditLogRows,
  downloadAuditLogsCsv,
  openManageAccountsModal,
  renderManageAccountsRows,
  saveManagedAccountRole,
  openArchiveSeasonModal,
  archiveCurrentSeason,
  confirmPendingBackupRestore
});



/* ===== 4.10.2 safer Game History loading ===== */

function withTimeoutPromise(promise, ms, label = "Request"){
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)} seconds.`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function normalizeGameTeamsForHistory(rawTeams){
  if(Array.isArray(rawTeams)) return rawTeams;
  if(typeof rawTeams === "string"){
    try{
      const parsed = JSON.parse(rawTeams);
      return Array.isArray(parsed) ? parsed : [];
    }catch(_){
      return [];
    }
  }
  if(rawTeams && typeof rawTeams === "object"){
    if(Array.isArray(rawTeams.teams)) return rawTeams.teams;
    return Object.values(rawTeams).filter(Array.isArray);
  }
  return [];
}

function gameIncludesPlayerName(game, query){
  const q = normalizeNameForMatch(query);
  if(!q) return true;
  return normalizeGameTeamsForHistory(game.teams).some(team =>
    (team || []).some(p => normalizeNameForMatch(playerDisplayNameFromTeamsPlayer(p)).includes(q))
  );
}

function renderGameHistoryModalRows(){
  const list = document.getElementById("gameHistoryFilterList");
  if(!list) return;

  try{
    const playerSearch = document.getElementById("gameHistoryPlayerSearch")?.value || "";
    const type = document.getElementById("gameHistoryTypeFilter")?.value || "all";
    const from = document.getElementById("gameHistoryFrom")?.value || "";
    const to = document.getElementById("gameHistoryTo")?.value || "";

    let games = Array.isArray(cachedGameHistoryRows410) ? cachedGameHistoryRows410.slice() : [];
    if(playerSearch) games = games.filter(g => gameIncludesPlayerName(g, playerSearch));
    if(type === "results") games = games.filter(g => g.winner_team_index !== null && g.winner_team_index !== undefined);
    if(type === "pairings") games = games.filter(g => g.winner_team_index === null || g.winner_team_index === undefined);
    if(from) games = games.filter(g => String(g.played_at || "") >= `${from}T00:00:00`);
    if(to) games = games.filter(g => String(g.played_at || "") <= `${to}T23:59:59`);

    if(!games.length){
      list.innerHTML = '<div class="small">No games match those filters.</div>';
      return;
    }

    const rows = games.map(g => {
      const teams = normalizeGameTeamsForHistory(g.teams);
      const teamHtml = teams.map((team, idx) => {
        const names = (Array.isArray(team) ? team : [])
          .map(playerDisplayNameFromTeamsPlayer)
          .map(escapeHtml)
          .join(", ");
        return `<div class="team-line"><strong>Team ${idx + 1}:</strong> ${names || '<span class="small">No players listed</span>'}</div>`;
      }).join("");

      const deleteBtn = isAdmin()
        ? `<button class="btn-danger" style="width:auto;margin-top:10px" type="button" onclick="deleteGameFromHistory('${escapeHtml(String(g.id))}')">Delete Game</button>`
        : "";

      return `<div class="history-card">
        <div class="row" style="justify-content:space-between;gap:10px">
          <strong>${escapeHtml(formatDateTime(g.played_at) || "Game")}</strong>
          <span class="chip">${escapeHtml(winnerLabelForGame(g))}</span>
        </div>
        ${teamHtml || '<div class="small">No team data saved for this game.</div>'}
        ${deleteBtn}
      </div>`;
    });

    list.innerHTML = `<div class="small" style="margin-bottom:8px">Showing ${games.length} game${games.length === 1 ? "" : "s"}.</div><div class="mini-table">${rows.join("")}</div>`;
  }catch(e){
    console.error("Game history render error", e);
    list.innerHTML = `<div class="notice">Game history opened, but one saved row could not be displayed. ${escapeHtml(e?.message || e)}</div>`;
  }
}

async function openGameHistoryModal(){
  if(!canAccessDataPage()){ alert("Captain/admin only."); return; }

  makeDynamicModal("gameHistoryModal", "Game History", `
    <div class="small">Loading game history...</div>
    <div class="small" style="margin-top:8px">If this takes more than a few seconds, the app will show the error instead of staying stuck.</div>
  `);

  try{
    const query = db
      .from("games")
      .select("id,played_at,teams,winner_team_index")
      .order("played_at", { ascending:false, nullsFirst:false })
      .limit(150);

    const { data, error } = await withTimeoutPromise(query, 12000, "Game history load");
    if(error) throw error;

    cachedGameHistoryRows410 = data || [];

    const body = `
      <div class="filter-grid">
        <div><label>Search player</label><input id="gameHistoryPlayerSearch" placeholder="Player name" oninput="renderGameHistoryModalRows()"></div>
        <div><label>Type</label><select id="gameHistoryTypeFilter" onchange="renderGameHistoryModalRows()"><option value="all">All games</option><option value="results">Results only</option><option value="pairings">Pairings only</option></select></div>
        <div><label>From</label><input id="gameHistoryFrom" type="date" onchange="renderGameHistoryModalRows()"></div>
        <div><label>To</label><input id="gameHistoryTo" type="date" onchange="renderGameHistoryModalRows()"></div>
        <div><label>&nbsp;</label><button class="btn-secondary" type="button" onclick="setValue('gameHistoryPlayerSearch','');setValue('gameHistoryFrom','');setValue('gameHistoryTo','');setValue('gameHistoryTypeFilter','all');renderGameHistoryModalRows()">Clear Filters</button></div>
        <div><label>&nbsp;</label><button class="btn-secondary" type="button" onclick="openGameHistoryModal()">Reload</button></div>
      </div>
      <div id="gameHistoryFilterList"></div>
    `;

    makeDynamicModal("gameHistoryModal", "Game History", body);
    renderGameHistoryModalRows();
  }catch(e){
    console.error("Game history load error", e);
    makeDynamicModal("gameHistoryModal", "Game History", `
      <div class="notice">
        Game history could not load.<br><br>
        <strong>Error:</strong> ${escapeHtml(e?.message || e)}
      </div>
      <div class="small" style="margin-top:10px">
        Common causes: the latest SQL did not finish, the games table policy blocked access, or the connection timed out.
      </div>
      <div class="toolbar" style="margin-top:12px">
        <button class="btn-secondary" type="button" onclick="openGameHistoryModal()">Try Again</button>
      </div>
    `);
  }
}

Object.assign(window, {
  withTimeoutPromise,
  normalizeGameTeamsForHistory,
  renderGameHistoryModalRows,
  openGameHistoryModal
});



/* ===== 4.10.3 Game History fix: games table has played_at, not created_at ===== */

function gameHistoryDateValue(game){
  return String(game?.played_at || "");
}

function renderGameHistoryModalRows(){
  const list = document.getElementById("gameHistoryFilterList");
  if(!list) return;

  try{
    const playerSearch = document.getElementById("gameHistoryPlayerSearch")?.value || "";
    const type = document.getElementById("gameHistoryTypeFilter")?.value || "all";
    const from = document.getElementById("gameHistoryFrom")?.value || "";
    const to = document.getElementById("gameHistoryTo")?.value || "";

    let games = Array.isArray(cachedGameHistoryRows410) ? cachedGameHistoryRows410.slice() : [];
    if(playerSearch) games = games.filter(g => gameIncludesPlayerName(g, playerSearch));
    if(type === "results") games = games.filter(g => g.winner_team_index !== null && g.winner_team_index !== undefined);
    if(type === "pairings") games = games.filter(g => g.winner_team_index === null || g.winner_team_index === undefined);
    if(from) games = games.filter(g => gameHistoryDateValue(g) >= `${from}T00:00:00`);
    if(to) games = games.filter(g => gameHistoryDateValue(g) <= `${to}T23:59:59`);

    if(!games.length){
      list.innerHTML = '<div class="small">No games match those filters.</div>';
      return;
    }

    const rows = games.map(g => {
      const teams = normalizeGameTeamsForHistory(g.teams);
      const teamHtml = teams.map((team, idx) => {
        const names = (Array.isArray(team) ? team : [])
          .map(playerDisplayNameFromTeamsPlayer)
          .map(escapeHtml)
          .join(", ");
        return `<div class="team-line"><strong>Team ${idx + 1}:</strong> ${names || '<span class="small">No players listed</span>'}</div>`;
      }).join("");

      const deleteBtn = isAdmin()
        ? `<button class="btn-danger" style="width:auto;margin-top:10px" type="button" onclick="deleteGameFromHistory('${escapeHtml(String(g.id))}')">Delete Game</button>`
        : "";

      return `<div class="history-card">
        <div class="row" style="justify-content:space-between;gap:10px">
          <strong>${escapeHtml(formatDateTime(g.played_at) || "Game")}</strong>
          <span class="chip">${escapeHtml(winnerLabelForGame(g))}</span>
        </div>
        ${teamHtml || '<div class="small">No team data saved for this game.</div>'}
        ${deleteBtn}
      </div>`;
    });

    list.innerHTML = `<div class="small" style="margin-bottom:8px">Showing ${games.length} game${games.length === 1 ? "" : "s"}.</div><div class="mini-table">${rows.join("")}</div>`;
  }catch(e){
    console.error("Game history render error", e);
    list.innerHTML = `<div class="notice">Game history opened, but one saved row could not be displayed. ${escapeHtml(e?.message || e)}</div>`;
  }
}

async function openGameHistoryModal(){
  if(!canAccessDataPage()){ alert("Captain/admin only."); return; }

  makeDynamicModal("gameHistoryModal", "Game History", `
    <div class="small">Loading game history...</div>
    <div class="small" style="margin-top:8px">If this takes more than a few seconds, the app will show the error instead of staying stuck.</div>
  `);

  try{
    const query = db
      .from("games")
      .select("id,played_at,teams,winner_team_index")
      .order("played_at", { ascending:false })
      .limit(150);

    const { data, error } = await withTimeoutPromise(query, 12000, "Game history load");
    if(error) throw error;

    cachedGameHistoryRows410 = data || [];

    const body = `
      <div class="filter-grid">
        <div><label>Search player</label><input id="gameHistoryPlayerSearch" placeholder="Player name" oninput="renderGameHistoryModalRows()"></div>
        <div><label>Type</label><select id="gameHistoryTypeFilter" onchange="renderGameHistoryModalRows()"><option value="all">All games</option><option value="results">Results only</option><option value="pairings">Pairings only</option></select></div>
        <div><label>From</label><input id="gameHistoryFrom" type="date" onchange="renderGameHistoryModalRows()"></div>
        <div><label>To</label><input id="gameHistoryTo" type="date" onchange="renderGameHistoryModalRows()"></div>
        <div><label>&nbsp;</label><button class="btn-secondary" type="button" onclick="setValue('gameHistoryPlayerSearch','');setValue('gameHistoryFrom','');setValue('gameHistoryTo','');setValue('gameHistoryTypeFilter','all');renderGameHistoryModalRows()">Clear Filters</button></div>
        <div><label>&nbsp;</label><button class="btn-secondary" type="button" onclick="openGameHistoryModal()">Reload</button></div>
      </div>
      <div id="gameHistoryFilterList"></div>
    `;

    makeDynamicModal("gameHistoryModal", "Game History", body);
    renderGameHistoryModalRows();
  }catch(e){
    console.error("Game history load error", e);
    makeDynamicModal("gameHistoryModal", "Game History", `
      <div class="notice">
        Game history could not load.<br><br>
        <strong>Error:</strong> ${escapeHtml(e?.message || e)}
      </div>
      <div class="small" style="margin-top:10px">
        Common causes: the latest SQL did not finish, the games table policy blocked access, or the connection timed out.
      </div>
      <div class="toolbar" style="margin-top:12px">
        <button class="btn-secondary" type="button" onclick="openGameHistoryModal()">Try Again</button>
      </div>
    `);
  }
}

Object.assign(window, {
  gameHistoryDateValue,
  renderGameHistoryModalRows,
  openGameHistoryModal
});



/* ===== 4.10.4 Game History cache initialization fix ===== */

window.__gameHistoryRows410 = window.__gameHistoryRows410 || [];

function getGameHistoryRows410(){
  return Array.isArray(window.__gameHistoryRows410) ? window.__gameHistoryRows410 : [];
}

function setGameHistoryRows410(rows){
  window.__gameHistoryRows410 = Array.isArray(rows) ? rows : [];
}

function gameHistoryDateValue410(game){
  return String(game?.played_at || "");
}

function renderGameHistoryModalRows(){
  const list = document.getElementById("gameHistoryFilterList");
  if(!list) return;

  try{
    const playerSearch = document.getElementById("gameHistoryPlayerSearch")?.value || "";
    const type = document.getElementById("gameHistoryTypeFilter")?.value || "all";
    const from = document.getElementById("gameHistoryFrom")?.value || "";
    const to = document.getElementById("gameHistoryTo")?.value || "";

    let games = getGameHistoryRows410().slice();
    if(playerSearch) games = games.filter(g => gameIncludesPlayerName(g, playerSearch));
    if(type === "results") games = games.filter(g => g.winner_team_index !== null && g.winner_team_index !== undefined);
    if(type === "pairings") games = games.filter(g => g.winner_team_index === null || g.winner_team_index === undefined);
    if(from) games = games.filter(g => gameHistoryDateValue410(g) >= `${from}T00:00:00`);
    if(to) games = games.filter(g => gameHistoryDateValue410(g) <= `${to}T23:59:59`);

    if(!games.length){
      list.innerHTML = '<div class="small">No games match those filters.</div>';
      return;
    }

    const rows = games.map(g => {
      const teams = normalizeGameTeamsForHistory(g.teams);
      const teamHtml = teams.map((team, idx) => {
        const names = (Array.isArray(team) ? team : [])
          .map(playerDisplayNameFromTeamsPlayer)
          .map(escapeHtml)
          .join(", ");
        return `<div class="team-line"><strong>Team ${idx + 1}:</strong> ${names || '<span class="small">No players listed</span>'}</div>`;
      }).join("");

      const deleteBtn = isAdmin()
        ? `<button class="btn-danger" style="width:auto;margin-top:10px" type="button" onclick="deleteGameFromHistory('${escapeHtml(String(g.id))}')">Delete Game</button>`
        : "";

      return `<div class="history-card">
        <div class="row" style="justify-content:space-between;gap:10px">
          <strong>${escapeHtml(formatDateTime(g.played_at) || "Game")}</strong>
          <span class="chip">${escapeHtml(winnerLabelForGame(g))}</span>
        </div>
        ${teamHtml || '<div class="small">No team data saved for this game.</div>'}
        ${deleteBtn}
      </div>`;
    });

    list.innerHTML = `<div class="small" style="margin-bottom:8px">Showing ${games.length} game${games.length === 1 ? "" : "s"}.</div><div class="mini-table">${rows.join("")}</div>`;
  }catch(e){
    console.error("Game history render error", e);
    list.innerHTML = `<div class="notice">Game history opened, but one saved row could not be displayed.<br><br><strong>Error:</strong> ${escapeHtml(e?.message || e)}</div>`;
  }
}

async function openGameHistoryModal(){
  if(!canAccessDataPage()){ alert("Captain/admin only."); return; }

  makeDynamicModal("gameHistoryModal", "Game History", `
    <div class="small">Loading game history...</div>
    <div class="small" style="margin-top:8px">If this takes more than a few seconds, the app will show the error instead of staying stuck.</div>
  `);

  try{
    const query = db
      .from("games")
      .select("id,played_at,teams,winner_team_index")
      .order("played_at", { ascending:false })
      .limit(150);

    const { data, error } = await withTimeoutPromise(query, 12000, "Game history load");
    if(error) throw error;

    setGameHistoryRows410(data || []);

    const body = `
      <div class="filter-grid">
        <div><label>Search player</label><input id="gameHistoryPlayerSearch" placeholder="Player name" oninput="renderGameHistoryModalRows()"></div>
        <div><label>Type</label><select id="gameHistoryTypeFilter" onchange="renderGameHistoryModalRows()"><option value="all">All games</option><option value="results">Results only</option><option value="pairings">Pairings only</option></select></div>
        <div><label>From</label><input id="gameHistoryFrom" type="date" onchange="renderGameHistoryModalRows()"></div>
        <div><label>To</label><input id="gameHistoryTo" type="date" onchange="renderGameHistoryModalRows()"></div>
        <div><label>&nbsp;</label><button class="btn-secondary" type="button" onclick="setValue('gameHistoryPlayerSearch','');setValue('gameHistoryFrom','');setValue('gameHistoryTo','');setValue('gameHistoryTypeFilter','all');renderGameHistoryModalRows()">Clear Filters</button></div>
        <div><label>&nbsp;</label><button class="btn-secondary" type="button" onclick="openGameHistoryModal()">Reload</button></div>
      </div>
      <div id="gameHistoryFilterList"></div>
    `;

    makeDynamicModal("gameHistoryModal", "Game History", body);
    renderGameHistoryModalRows();
  }catch(e){
    console.error("Game history load error", e);
    makeDynamicModal("gameHistoryModal", "Game History", `
      <div class="notice">
        Game history could not load.<br><br>
        <strong>Error:</strong> ${escapeHtml(e?.message || e)}
      </div>
      <div class="small" style="margin-top:10px">
        Common causes: the games table policy blocked access, the connection timed out, or the page is still using an old cached script.
      </div>
      <div class="toolbar" style="margin-top:12px">
        <button class="btn-secondary" type="button" onclick="openGameHistoryModal()">Try Again</button>
      </div>
    `);
  }
}

Object.assign(window, {
  getGameHistoryRows410,
  setGameHistoryRows410,
  gameHistoryDateValue410,
  renderGameHistoryModalRows,
  openGameHistoryModal
});



/* ===== 4.10.5 custom push notification prompt ===== */

function askPushNotificationPopup(){
  return new Promise(resolve => {
    const existing = document.getElementById("pushPromptModal");
    if(existing) existing.remove();

    const wrap = document.createElement("div");
    wrap.id = "pushPromptModal";
    wrap.className = "modal show";
    wrap.innerHTML = `
      <div class="modal-card">
        <div class="row modal-header-sticky" style="justify-content:space-between;align-items:center;gap:10px">
          <h2 style="margin:0">Send Push Notification?</h2>
          <button class="btn-secondary" type="button" id="pushPromptCloseBtn">Close</button>
        </div>
        <div class="notice">
          Teams have been generated. Do you want to send a push notification to players who enabled notifications?
        </div>
        <div class="small" style="margin-top:10px">
          If a player account matches a roster name, the notification can include their team number.
        </div>
        <div class="toolbar" style="margin-top:14px">
          <button class="btn" type="button" id="pushPromptYesBtn">Yes, Send Push</button>
          <button class="btn-secondary" type="button" id="pushPromptNoBtn">No, Don't Send</button>
        </div>
      </div>
    `;

    const finish = value => {
      wrap.remove();
      resolve(value);
    };

    wrap.querySelector("#pushPromptYesBtn").onclick = () => finish(true);
    wrap.querySelector("#pushPromptNoBtn").onclick = () => finish(false);
    wrap.querySelector("#pushPromptCloseBtn").onclick = () => finish(false);
    wrap.addEventListener("click", event => {
      if(event.target === wrap) finish(false);
    });

    document.body.appendChild(wrap);
    if(typeof ensureStickyModalHeaders === "function") ensureStickyModalHeaders();
    if(typeof preventHorizontalModalDrift === "function") preventHorizontalModalDrift();
  });
}

async function askAdminWhetherToSendTeamNotification(){
  if(!canManageGames()) return false;
  return await askPushNotificationPopup();
}

Object.assign(window, {
  askPushNotificationPopup,
  askAdminWhetherToSendTeamNotification
});



/* ===== 4.10.6 Generate Teams loading/prompt fix ===== */

async function sendTeamGeneratedNotification(){
  if(!canManageGames()) return;
  try{
    const teams = serializableTeams().map((team, idx) => ({
      teamNumber: idx + 1,
      players: team.map(p => ({ id: p.id, fullName: p.fullName }))
    }));

    const invokePromise = db.functions.invoke("send-team-notification", {
      body: {
        title: "New teams are ready",
        body: "New ultimate teams have been generated.",
        url: window.location.origin + window.location.pathname,
        teams
      }
    });

    const { data, error } = typeof withTimeoutPromise === "function"
      ? await withTimeoutPromise(invokePromise, 12000, "Push notification")
      : await invokePromise;

    if(error){
      alert("Teams were generated, but the push notification failed: " + (error.message || error));
      return;
    }

    console.log("Push notification result", data);
  }catch(e){
    alert("Teams were generated, but the push notification failed: " + (e?.message || e));
  }
}

async function generateTeamsButton(){
  if(!canGenerateTeams()){
    alert("Only captains/admins can generate teams.");
    return;
  }

  try{
    // Important: ask questions BEFORE showing the loading overlay.
    // Otherwise the loading overlay can hide the popup and make the app look stuck.
    if(state.currentGame && !state.resultsSavedForCurrentGame){
      const continueWithoutResults = await confirmContinueWithoutResults();
      if(!continueWithoutResults) return;

      await withLoading("Saving current pairings...", async () => {
        await savePairingsOnlyForCurrentGame();
      });
    }

    const sendPush = await askAdminWhetherToSendTeamNotification();

    await withLoading("Generating teams...", async () => {
      await generateGame(sendPush);
    });
  }catch(e){
    clearLoading();
    console.error("Generate teams failed", e);
    alert("Generate teams failed: " + (e?.message || e));
  }
}

Object.assign(window, {
  sendTeamGeneratedNotification,
  generateTeamsButton
});



/* ===== 4.10.7 centered push notification prompt ===== */

function askPushNotificationPopup(){
  return new Promise(resolve => {
    const existing = document.getElementById("pushPromptModal");
    if(existing) existing.remove();

    const wrap = document.createElement("div");
    wrap.id = "pushPromptModal";
    wrap.className = "push-prompt-modal";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "true");
    wrap.innerHTML = `
      <div class="push-prompt-card">
        <div class="row" style="justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px">
          <h2 style="margin:0">Send Push Notification?</h2>
          <button class="btn-secondary" type="button" id="pushPromptCloseBtn" style="width:auto;min-width:76px">Close</button>
        </div>
        <div class="notice">
          Teams have been generated. Do you want to send a push notification to players who enabled notifications?
        </div>
        <div class="small" style="margin-top:10px">
          If a player account matches a roster name, the notification can include their team number.
        </div>
        <div class="toolbar" style="margin-top:14px">
          <button class="btn" type="button" id="pushPromptYesBtn">Yes, Send Push</button>
          <button class="btn-secondary" type="button" id="pushPromptNoBtn">No, Don't Send</button>
        </div>
      </div>
    `;

    const finish = value => {
      wrap.remove();
      resolve(value);
    };

    wrap.querySelector("#pushPromptYesBtn").onclick = () => finish(true);
    wrap.querySelector("#pushPromptNoBtn").onclick = () => finish(false);
    wrap.querySelector("#pushPromptCloseBtn").onclick = () => finish(false);
    wrap.addEventListener("click", event => {
      if(event.target === wrap) finish(false);
    });

    document.body.appendChild(wrap);
    setTimeout(() => {
      const yes = document.getElementById("pushPromptYesBtn");
      if(yes) yes.focus({ preventScroll: true });
    }, 0);
  });
}

async function askAdminWhetherToSendTeamNotification(){
  if(!canManageGames()) return false;
  return await askPushNotificationPopup();
}

Object.assign(window, {
  askPushNotificationPopup,
  askAdminWhetherToSendTeamNotification
});



/* ===== 4.10.8 hard-centered push notification prompt ===== */

function applyStyles(el, styles){
  Object.assign(el.style, styles);
}

function askPushNotificationPopup(){
  return new Promise(resolve => {
    const existing = document.getElementById("pushPromptModal");
    if(existing) existing.remove();

    const oldBodyOverflow = document.body.style.overflow;
    const oldHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    const wrap = document.createElement("div");
    wrap.id = "pushPromptModal";
    wrap.className = "push-prompt-hard-center";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "true");

    // Inline styles are intentional: this prevents the prompt from breaking if CSS is cached
    // or if index.html was not uploaded with app.js.
    applyStyles(wrap, {
      position: "fixed",
      left: "0",
      right: "0",
      top: "0",
      bottom: "0",
      width: "100vw",
      height: "100vh",
      minHeight: "100vh",
      zIndex: "2147483647",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "16px",
      background: "rgba(0,0,0,0.72)",
      overflow: "hidden",
      boxSizing: "border-box",
      transform: "none",
      margin: "0"
    });

    const card = document.createElement("div");
    applyStyles(card, {
      width: "min(460px, calc(100vw - 32px))",
      maxWidth: "calc(100vw - 32px)",
      maxHeight: "calc(100vh - 32px)",
      overflowY: "auto",
      background: "var(--card, #080808)",
      color: "var(--text, #f5f5f5)",
      border: "1px solid var(--border, #1f1f1f)",
      borderRadius: "18px",
      padding: "16px",
      boxShadow: "0 18px 42px rgba(0,0,0,0.65)",
      boxSizing: "border-box",
      margin: "0",
      position: "relative",
      top: "auto",
      bottom: "auto",
      left: "auto",
      right: "auto",
      transform: "none"
    });

    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px">
        <h2 style="margin:0;font-size:22px;line-height:1.15">Send Push Notification?</h2>
        <button class="btn-secondary" type="button" id="pushPromptCloseBtn" style="width:auto;min-width:76px;padding:10px 12px">Close</button>
      </div>
      <div class="notice" style="line-height:1.35">
        Teams have been generated. Do you want to send a push notification to players who enabled notifications?
      </div>
      <div class="small" style="margin-top:10px;line-height:1.35">
        If a player account matches a roster name, the notification can include their team number.
      </div>
      <div style="display:grid;grid-template-columns:1fr;gap:10px;margin-top:14px">
        <button class="btn" type="button" id="pushPromptYesBtn">Yes, Send Push</button>
        <button class="btn-secondary" type="button" id="pushPromptNoBtn">No, Don't Send</button>
      </div>
    `;

    wrap.appendChild(card);

    const finish = value => {
      document.body.style.overflow = oldBodyOverflow;
      document.documentElement.style.overflow = oldHtmlOverflow;
      wrap.remove();
      resolve(value);
    };

    card.addEventListener("click", event => event.stopPropagation());
    wrap.addEventListener("click", event => {
      if(event.target === wrap) finish(false);
    });
    card.querySelector("#pushPromptYesBtn").onclick = () => finish(true);
    card.querySelector("#pushPromptNoBtn").onclick = () => finish(false);
    card.querySelector("#pushPromptCloseBtn").onclick = () => finish(false);

    const keyHandler = event => {
      if(event.key === "Escape"){
        document.removeEventListener("keydown", keyHandler);
        finish(false);
      }
    };
    document.addEventListener("keydown", keyHandler);

    document.body.appendChild(wrap);
  });
}

async function askAdminWhetherToSendTeamNotification(){
  if(!canManageGames()) return false;
  return await askPushNotificationPopup();
}

// Re-override Generate Teams so the hard-centered prompt is always asked before the loading overlay.
async function generateTeamsButton(){
  if(!canGenerateTeams()){
    alert("Only captains/admins can generate teams.");
    return;
  }

  try{
    if(state.currentGame && !state.resultsSavedForCurrentGame){
      const continueWithoutResults = await confirmContinueWithoutResults();
      if(!continueWithoutResults) return;

      await withLoading("Saving current pairings...", async () => {
        await savePairingsOnlyForCurrentGame();
      });
    }

    const sendPush = await askAdminWhetherToSendTeamNotification();

    await withLoading("Generating teams...", async () => {
      await generateGame(sendPush);
    });
  }catch(e){
    if(typeof clearLoading === "function") clearLoading();
    console.error("Generate teams failed", e);
    alert("Generate teams failed: " + (e?.message || e));
  }
}

Object.assign(window, {
  applyStyles,
  askPushNotificationPopup,
  askAdminWhetherToSendTeamNotification,
  generateTeamsButton
});



/* ===== 4.10.8 startup safety ===== */
setTimeout(() => {
  const overlay = document.getElementById("loadingOverlay");
  if(overlay && overlay.style.display === "flex"){
    overlay.style.display = "none";
  }
}, 15000);

