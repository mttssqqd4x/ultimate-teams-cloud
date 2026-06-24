
const CONFIG = window.ULTIMATE_TEAMS_CONFIG || {};
const SUPABASE_URL = (CONFIG.SUPABASE_URL || "").replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
const SUPABASE_KEY = CONFIG.SUPABASE_PUBLISHABLE_KEY || CONFIG.SUPABASE_ANON_KEY || "";
const APP_AUTH_REDIRECT_URL = CONFIG.AUTH_REDIRECT_URL || "https://nmultimateteams.app";
const VAPID_PUBLIC_KEY = CONFIG.VAPID_PUBLIC_KEY || "";
const APP_VERSION = "v4.48";

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

  subscribeToCurrentGameUpdates();
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


function subscribeToCurrentGameUpdates(){
  if(!db || currentGameChannel) return;

  currentGameChannel = db
    .channel("current-game-live")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "current_game", filter: "id=eq.main" },
      () => scheduleLiveRefresh()
    )
    .subscribe(status => {
      console.log("Current game live updates:", status);
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
  if(!isAdmin()) return false;
  return confirm("Send a push notification to signed-in users that new teams were generated?");
}

async function sendTeamGeneratedNotification(){
  if(!isAdmin()) return;
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
  updateTeamsDetailsOpenState();
  updateGameStartTime();
  updateAppVersionLine();
  updateNotificationUi();
}

function updateAppVersionLine(){
  const dataPage = document.getElementById("dataPage");
  if(!dataPage) return;

  // Remove any old misplaced duplicates first.
  document.querySelectorAll("#dataVersionCard").forEach(card => {
    if(card.parentElement !== dataPage) card.remove();
  });

  let card = document.getElementById("dataVersionCard");
  if(!card){
    card = document.createElement("div");
    card.id = "dataVersionCard";
    card.className = "card";
    card.innerHTML = '<div id="dataAppVersionLine" class="app-version-line"></div>';
    dataPage.appendChild(card);
  }else if(card.parentElement !== dataPage){
    dataPage.appendChild(card);
  }

  const el = document.getElementById("dataAppVersionLine");
  if(el) el.textContent = `Version: ${APP_VERSION}`;
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
          <button onclick="event.stopPropagation(); toggleActive('${p.id}')">${p.active ? "Inactive" : "Active"}</button>
          <button onclick="event.stopPropagation(); setInjuryPrompt('${p.id}')">Injury %</button>
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

async function toggleAttendance(id){
  if(!canMarkAttendance()){
    alert("Create an account or sign in to mark attendance.");
    toggleSignInBox();
    return;
  }

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

  const payload = {
    first_name: form.first,
    last_name: form.last,
    handling: form.handling,
    cutting: form.cutting,
    defense: form.defense,
    win_loss: 0,
    active: true,
    injury_pct: 1,
    temporary: !!temporary,
    updated_at: new Date().toISOString()
  };

  const { data, error } = await db.from("players").insert(payload).select().single();
  if(error){
    setAddPlayerStatus("Add failed.");
    alert(error.message);
    return;
  }

  // Since this section is inside Attendance, add the new player to today's present list.
  await db.from("attendance").upsert({
    player_id: data.id,
    present: true,
    updated_at: new Date().toISOString(),
    updated_by: currentUser?.id || null
  }, { onConflict: "player_id" });

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

  const startTime = formatGameStartTime(state.currentGameGeneratedAt);
  const startLine = document.createElement("div");
  startLine.className = "game-start-line";
  startLine.textContent = startTime ? `Started ${startTime}` : "Started time unavailable";

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
  if(state.resultsSavedForCurrentGame && !confirm("Results already saved. Save again anyway?")) return;

  const saveBtn = document.querySelector("#saveResultsWrap .btn-success");
  const msg = document.getElementById("resultMessage");
  if(saveBtn) saveBtn.disabled = true;
  if(msg) msg.textContent = "Saving results...";

  try{
    const winner = state.currentGame.teams[state.selectedWinnerIndex];
    const losers = state.currentGame.teams.filter((_, i) => i !== state.selectedWinnerIndex);
    if(!winner?.length || !losers.length){
      alert("Results require at least one winning team and one losing team.");
      if(msg) msg.textContent = "";
      return;
    }

    const winnerStrength = teamStats(winner).overall;
    const updates = new Map();

    state.currentGame.teams.flat().forEach(p => {
      if(p?.id) updates.set(p.id, { ...p });
    });

    losers.forEach(loserTeam => {
      const loserStrength = teamStats(loserTeam).overall;
      const winnerExpected = expectedWinProb(winnerStrength, loserStrength);
      const loserExpected = expectedWinProb(loserStrength, winnerStrength);
      const scaledK = Number(state.settings.kFactor || 0.08) / Math.max(1, losers.length);

      const winnerDelta = scaledK * (1 - winnerExpected);
      const loserDelta = scaledK * (0 - loserExpected);

      winner.forEach(p => {
        const u = updates.get(p.id);
        if(u) u.winLossRating = Number(u.winLossRating || 0) + winnerDelta;
      });
      loserTeam.forEach(p => {
        const u = updates.get(p.id);
        if(u) u.winLossRating = Number(u.winLossRating || 0) + loserDelta;
      });
    });

    state.currentGame.teams.forEach((team, idx) => {
      team.forEach(p => {
        const u = updates.get(p.id);
        if(!u) return;
        u.gamesPlayed = Number(u.gamesPlayed || 0) + 1;
        if(idx === state.selectedWinnerIndex) u.wins = Number(u.wins || 0) + 1;
        else u.losses = Number(u.losses || 0) + 1;
      });
    });

    for(const p of updates.values()){
      const { error } = await db.from("players").update({
        win_loss: Number(p.winLossRating || 0),
        games_played: Number(p.gamesPlayed || 0),
        wins: Number(p.wins || 0),
        losses: Number(p.losses || 0),
        updated_at: new Date().toISOString()
      }).eq("id", p.id);
      if(error) throw error;

      const hist = await db.from("rating_history").insert({ player_id: p.id, value: Number(p.winLossRating || 0) });
      if(hist.error) console.warn("Could not save rating history", hist.error);
    }

    await addCurrentTeamsToHistory();

    const gameInsert = await db.from("games").insert({
      teams: serializableTeams(),
      winner_team_index: state.selectedWinnerIndex,
      created_by: currentUser?.id || null
    });
    if(gameInsert.error) throw gameInsert.error;

    state.resultsSavedForCurrentGame = true;
    await saveCurrentGameToDb(true);

    state.players = state.players.map(p => updates.get(p.id) || p);

    await loadCloudData();
    renderAll();

    const finalMsg = document.getElementById("resultMessage");
    if(finalMsg) finalMsg.textContent = "Results saved. Records and Win/Loss ratings updated.";
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

  await addCurrentTeamsToHistory();

  // Record that a game happened without recording a winner/rating update.
  try{
    await db.from("games").insert({
      teams: serializableTeams(),
      winner_team_index: null,
      created_by: currentUser?.id || null
    });
  }catch(e){
    console.warn("Could not insert pairings-only game record", e);
  }

  state.resultsSavedForCurrentGame = true;
  await saveCurrentGameToDb(true);
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
      "\n\nThis will replace current players, attendance, pair rules, teammate history, settings, and current game state. This cannot be undone unless you export the current data first."
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
  ["ratingsModal", "editPlayerModal", "winLossModal", "signOutConfirmModal", "accountModal", "accountCreatedModal", "captainWelcomeModal"].forEach(hideModal);
}

function openWinLossModal(show = true){
  if(!canAccessDataPage()){ alert("Captain/admin only."); return; }

  const content = document.getElementById("winLossModalContent");
  if(!content) return;

  const search = (document.getElementById("winLossSearch")?.value || "").trim().toLowerCase();

  const players = [...state.players]
    .filter(p => !search || p.fullName.toLowerCase().includes(search))
    .sort((a, b) => {
      const games = Number(b.gamesPlayed || 0) - Number(a.gamesPlayed || 0);
      if(games) return games;
      const wins = Number(b.wins || 0) - Number(a.wins || 0);
      if(wins) return wins;
      return comparePlayersByLastName(a, b);
    });

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
  const players = [...state.players]
    .filter(p => !search || p.fullName.toLowerCase().includes(search))
    .sort(comparePlayersByLastName);

  list.innerHTML = players.length ? players.map(p => {
    const id = String(p.id);
    const safe = editDomId("edit", id);
    const ratingLine = isAdmin()
      ? `H ${Number(p.handling).toFixed(1)} · C ${Number(p.cutting).toFixed(1)} · D ${Number(p.defense).toFixed(1)} · W/L ${Number(p.winLossRating).toFixed(2)}`
      : "Name edit only";
    return `
      <details class="edit-player-details" data-player-id="${escapeHtml(id)}">
        <summary>
          <div class="row" style="justify-content:space-between;align-items:center;gap:12px">
            <div style="min-width:0">
              <div class="player-name">${escapeHtml(p.fullName)}</div>
              <div class="small">${escapeHtml(ratingLine)} · ${p.active ? "Active" : "Inactive"} · Games ${p.gamesPlayed} · Wins ${p.wins} · Losses ${p.losses}</div>
            </div>
            <div class="small">Tap to edit</div>
          </div>
        </summary>

        <div class="inline-edit-form" data-edit-form-for="${escapeHtml(id)}">
          <div class="grid grid-2">
            <div><label>First Name</label><input id="${safe}-first" value="${escapeHtml(p.firstName || "")}"></div>
            <div><label>Last Name</label><input id="${safe}-last" value="${escapeHtml(p.lastName || "")}"></div>
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
  if(help) help.textContent = isAdmin()
    ? "Tap a player name to open the dropdown. Admins can edit names and ratings."
    : "Tap a player name to open the dropdown. Captains can edit player names only. Ratings are locked.";

  updateRoleVisibility();
  if(show) showModal("editPlayerModal");
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

  const payload = {
    first_name: first,
    last_name: last,
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

  if(isAdmin()){
    p.handling = payload.handling;
    p.cutting = payload.cutting;
    p.defense = payload.defense;
    p.winLossRating = payload.win_loss;
  }

  const details = document.getElementById(`${safe}-first`)?.closest("details");
  if(details){
    const nameEl = details.querySelector(".player-name");
    const smallEl = details.querySelector("summary .small");
    if(nameEl) nameEl.textContent = p.fullName;
    if(smallEl){
      const ratingLine = isAdmin()
        ? `H ${Number(p.handling).toFixed(1)} · C ${Number(p.cutting).toFixed(1)} · D ${Number(p.defense).toFixed(1)} · W/L ${Number(p.winLossRating).toFixed(2)}`
        : "Name edit only";
      smallEl.textContent = `${ratingLine} · ${p.active ? "Active" : "Inactive"} · Games ${p.gamesPlayed} · Wins ${p.wins} · Losses ${p.losses}`;
    }
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
