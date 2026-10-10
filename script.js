function showFatal(msg) {
  const box = document.getElementById("err");
  if (box) box.textContent = "Site error: " + msg;
  const t = document.getElementById("toast");
  if (t) { t.textContent = "Site error: " + msg; t.hidden = false; }
}
window.addEventListener("error", e => showFatal(e.message));
window.addEventListener("unhandledrejection", e => showFatal(e.reason?.message || String(e.reason)));
if (typeof db === "undefined") showFatal("connect.js didn't load. Upload it next to index.html.");

const ACCOUNT_DOMAIN = "players.ipgdgll.com";
const toLogin = name => name.trim().toLowerCase() + "@" + ACCOUNT_DOMAIN;

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const AV_COLORS = ["#0881c6", "#c8423b", "#2f9a5b", "#8a4fd1", "#d08a12", "#3a3d42"];

const state = { user: null, profile: null, guest: false, levels: [], selected: null, page: "main", mode: "in", filter: "all", profileId: null, adminTab: "overview" };

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), 2400);
}

function avColor(n) {
  let h = 0;
  for (const c of String(n)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AV_COLORS[h % AV_COLORS.length];
}

function timeAgo(iso) {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso)) / 1000));
  const units = [["y", 31536000], ["mo", 2592000], ["d", 86400], ["h", 3600], ["m", 60]];
  for (const [u, v] of units) if (s >= v) return Math.floor(s / v) + u + " ago";
  return "just now";
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function ytId(url) {
  const m = String(url || "").match(/(?:youtu\.be\/|[?&]v=|embed\/|shorts\/|live\/)([\w-]{11})/);
  return m ? m[1] : null;
}

function safeUrl(url) {
  return /^https?:\/\//i.test(url || "") ? url : null;
}

function friendly(msg) {
  const m = String(msg || "");
  if (/Invalid login credentials/i.test(m)) return "Wrong username or password.";
  if (/already registered|already exists/i.test(m)) return "That username is taken.";
  if (/signups not allowed/i.test(m)) return "New accounts are closed right now.";
  if (/rate limit/i.test(m)) return "Too many attempts. Wait a minute and try again.";
  if (/Failed to fetch|NetworkError/i.test(m)) return "Can't reach the server. Check your connectione.";
  return m || "Something went wrong. Try again.";
}

function avatarHtml(name, url, cls = "") {
  const n = String(name || "?");
  const img = safeUrl(url) ? `<img src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : "";
  return `<div class="av ${cls}" style="background:${avColor(n)}"><span>${esc(n[0].toUpperCase())}</span>${img}</div>`;
}

function userLink(id, name) {
  if (!id) return `<span>${esc(name || "deleted")}</span>`;
  return `<button class="ulink" data-uid="${id}">${esc(name || "deleted")}</button>`;
}

function bindUserLinks(root) {
  root.querySelectorAll("[data-uid]").forEach(b => (b.onclick = e => {
    e.stopPropagation();
    openProfile(b.dataset.uid);
  }));
}

function canPost() {
  return !!state.user && !state.guest && !state.profile?.banned;
}

function watchBtn(url) {
  const u = safeUrl(url);
  if (!u) return "";
  return `<a class="watch" href="${esc(u)}" target="_blank" rel="noopener" aria-label="Watch record video"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>Watch</a>`;
}

function thumb(level) {
  const id = ytId(level.video);
  if (id) return `<img class="thumb" src="https://i.ytimg.com/vi/${id}/mqdefault.jpg" alt="" loading="lazy">`;
  return "";
}

const statusIcon = l => `<img src="${l.possible === false ? "impossible" : "possible"}.webp" alt="" onerror="this.remove()">`;
const statusTag = l => l.possible === false ? `<span class="tag impossible">Impossible</span>` : `<span class="tag possible">Possible</span>`;

function isAdmin() {
  return !!state.profile?.is_admin;
}

function setMode(m) {
  state.mode = m;
  $("#tab-in").setAttribute("aria-selected", m === "in");
  $("#tab-up").setAttribute("aria-selected", m === "up");
  $("#confirmWrap").hidden = m !== "up";
  $("#authLabel").textContent = m === "in" ? "Log in" : "Create account";
  $("#p").autocomplete = m === "in" ? "current-password" : "new-password";
  $("#err").textContent = "";
}

$("#tab-in").onclick = () => setMode("in");
$("#tab-up").onclick = () => { setMode("up"); $("#msg").textContent = ""; };

$("#authForm").addEventListener("submit", async e => {
  e.preventDefault();
  const err = $("#err"), btn = $("#authBtn");
  const u = $("#u").value.trim(), pass = $("#p").value;
  err.textContent = "";
  $("#msg").textContent = "";
  if (!/^[A-Za-z0-9_]{3,20}$/.test(u)) return (err.textContent = "Username must be 3–20 letters, numbers or underscores.");
  if (pass.length < 6) return (err.textContent = "Password needs at least 6 characters.");
  btn.disabled = true;
  try {
    if (state.mode === "up") {
      if (pass !== $("#p2").value) return (err.textContent = "Passwords don't match.");
      const { data: taken } = await db.from("profiles").select("id").ilike("username", u.replace(/_/g, "\\_")).maybeSingle();
      if (taken) return (err.textContent = "That username is taken.");
      const { data, error } = await db.auth.signUp({
        email: toLogin(u), password: pass,
        options: { data: { username: u } }
      });
      if (error) throw error;
      if (!data.session) {
        setMode("in");
        $("#msg").textContent = "Account created. Log in to continue.";
      }
    } else {
      const { error } = await db.auth.signInWithPassword({ email: toLogin(u), password: pass });
      if (error) throw error;
    }
  } catch (x) {
    err.textContent = friendly(x.message);
  } finally {
    btn.disabled = false;
  }
});

$("#guest").onclick = () => {
  state.guest = true;
  state.user = null;
  state.profile = null;
  enterApp();
};

$("#logout").onclick = async () => {
  if (state.guest) {
    state.guest = false;
    showLogin();
    return;
  }
  await db.auth.signOut();
};

db.auth.onAuthStateChange((_event, session) => {
  setTimeout(() => handleSession(session), 0);
});

async function handleSession(session) {
  if (session) {
    if (state.user?.id === session.user.id && state.profile) return;
    state.user = session.user;
    state.guest = false;
    const { data } = await db.from("profiles").select("username,is_admin,banned,ban_reason,avatar_url").eq("id", session.user.id).maybeSingle();
    state.profile = data || { username: session.user.user_metadata?.username || "player", is_admin: false };
    enterApp();
  } else {
    state.user = null;
    state.profile = null;
    if (!state.guest) showLogin();
  }
}

function showLogin() {
  $("#app").hidden = true;
  $("#login").hidden = false;
  $("#p").value = "";
  $("#p2").value = "";
}

function enterApp() {
  $("#login").hidden = true;
  $("#app").hidden = false;
  paintHeader();
  $("#logout").textContent = state.guest ? "Log in" : "Log out";
  go("main");
  loadLevels();
}

function paintHeader() {
  const name = state.guest ? "guest" : state.profile.username;
  $("#uname").textContent = name + (isAdmin() ? " · admin" : "");
  $("#av").outerHTML = avatarHtml(name, state.guest ? null : state.profile.avatar_url).replace('class="av ', 'id="av" class="av ');
  const bar = $("#banBar");
  bar.hidden = !state.profile?.banned;
  if (state.profile?.banned) bar.textContent = "Your account is banned. You can't post comments or submit records." + (state.profile.ban_reason ? " Reason: " + state.profile.ban_reason : "");
}

$("#meBtn").onclick = () => {
  if (state.guest || !state.user) return toast("Log in to get a profile.");
  openProfile(state.user.id);
};

function openProfile(id) {
  state.profileId = id;
  $("#info").classList.remove("open");
  go("profile");
  window.scrollTo(0, 0);
}

function openLevel(id) {
  state.selected = id;
  go("main");
  renderList();
  renderInfo(true);
}

function go(page) {
  state.page = page;
  $$("#nav button").forEach(b => (b.dataset.page === page ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
  $$("[data-view]").forEach(v => (v.hidden = v.dataset.view !== page));
  if (page === "admin") renderAdmin();
  if (page === "submit") renderSubmit();
  if (page === "news") renderNews();
  if (page === "dev") renderDev();
  if (page === "profile") renderProfile();
}
$$("#nav button").forEach(b => (b.onclick = () => go(b.dataset.page)));

async function loadLevels() {
  if (!state.levels.length) $("#levels").innerHTML = `<p class="muted">Loading levels…</p>`;
  const { data, error } = await db.from("levels").select("*, records(progress,status)").order("position");
  if (error) {
    $("#levels").innerHTML = `<p class="err">Couldn't load levels: ${esc(error.message)}</p>`;
    return;
  }
  state.levels = data.map(l => {
    const acc = (l.records || []).filter(r => r.status === "accepted").map(r => r.progress);
    return { ...l, wr: acc.length ? Math.max(...acc) : null };
  });
  if (!state.levels.find(l => l.id === state.selected)) state.selected = state.levels[0]?.id ?? null;
  renderList();
  renderInfo(false);
}

function renderList() {
  const q = $("#q").value.trim().toLowerCase();
  const box = $("#levels");
  if (!state.levels.length) {
    box.innerHTML = `<div class="empty"><b>No levels on the list yet</b><span class="muted">${isAdmin() ? "Add the first level from the Admin tab." : "Check back soon. Admins are building the list."}</span></div>`;
    return;
  }
  const rows = state.levels
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => state.filter === "all" || (state.filter === "possible") === (l.possible !== false))
    .filter(({ l }) => !q || l.name.toLowerCase().includes(q) || [l.creator, ...(l.extra_creators || [])].some(c => c.toLowerCase().includes(q)));
  box.innerHTML = rows.map(({ l, i }) => `
    <button class="lvl" data-id="${l.id}" aria-pressed="${l.id === state.selected}">
      <div class="diff">${statusIcon(l)}</div>
      <div class="body">${thumb(l)}
        <span class="wr"><i>WR</i>${l.wr ? l.wr + "%" : "none"}</span>
        <h3><span class="rk">#${i + 1}</span>${esc(l.name)}${statusTag(l)}</h3>
        <p class="by">Creator: <b>${esc(l.creator)}</b>${l.extra_creators?.length ? `, and ${l.extra_creators.length} more` : ""}</p>
      </div>
    </button>`).join("") || `<p class="muted">No levels match this search or filter.</p>`;
  $$(".lvl").forEach(b => (b.onclick = () => {
    state.selected = +b.dataset.id;
    renderList();
    renderInfo(true);
  }));
}
$("#q").addEventListener("input", renderList);
$$("#filters button").forEach(b => (b.onclick = () => {
  state.filter = b.dataset.f;
  $$("#filters button").forEach(x => x.setAttribute("aria-pressed", x === b));
  renderList();
}));

function renderInfo(open) {
  const info = $("#info");
  const l = state.levels.find(x => x.id === state.selected);
  if (!l) {
    info.innerHTML = `<div class="pad"><p class="muted" style="margin:0">Pick a level to see its info.</p></div>`;
    info.classList.remove("open");
    return;
  }
  const rank = state.levels.indexOf(l) + 1;
  const vid = safeUrl(l.video);
  info.innerHTML = `
    <button class="close-info" aria-label="Close level info">×</button>
    ${thumb(l) ? `<div class="hero">${thumb(l)}<span class="rkbig">#${rank}</span></div>` : ""}
    <div class="pad">
      <div class="title-row">${statusIcon(l)}
        <div>
          <h2>${esc(l.name)}</h2>
          <p class="by">by <b>${esc([l.creator, ...(l.extra_creators || [])].join(", "))}</b>${l.verifier ? ` · verified by <b>${esc(l.verifier)}</b>` : ""}</p>
        </div>
      </div>
      <dl class="stats">
        <div><dt>Status</dt><dd>${statusTag(l).replace('class="tag', 'style="margin:0" class="tag')}${isAdmin() ? ` <button class="mini" id="flipStatus" style="margin-left:6px">Switch</button>` : ""}</dd></div>
        <div><dt>Position</dt><dd>#${rank}</dd></div>
        <div><dt>Level ID</dt><dd>${esc(l.gd_id || "—")}</dd></div>
        <div><dt>List WR</dt><dd>${l.wr ? l.wr + "%" : "None"}</dd></div>
      </dl>
      ${vid ? `<div class="links"><a href="${esc(vid)}" target="_blank" rel="noopener">Watch verification ↗</a></div>` : ""}
      <h3 class="sec-h">Records</h3>
      <ul class="victors" id="vic"><li class="muted">Loading…</li></ul>
      <h3 class="sec-h" id="cmHead">Comments</h3>
      <div class="comments" id="cms"><p class="muted" style="margin:0">Loading…</p></div>
      ${canPost()
        ? `<form class="addc" id="addc"><input type="text" id="cIn" placeholder="Add a comment" maxlength="300"><button class="btn sm" type="submit">Post</button></form>`
        : `<p class="muted" style="margin:0;font-size:13px">${state.profile?.banned ? "Your account is banned from commenting." : "Log in to comment."}</p>`}
    </div>`;
  info.classList.toggle("open", !!open);
  info.querySelector(".close-info").onclick = () => info.classList.remove("open");
  const f = $("#addc");
  if (f) f.onsubmit = async e => {
    e.preventDefault();
    const input = $("#cIn"), body = input.value.trim();
    if (!body) return;
    input.disabled = true;
    const { error } = await db.from("comments").insert({ level_id: l.id, body });
    input.disabled = false;
    if (error) return toast(friendly(error.message));
    input.value = "";
    toast("Comment posted");
    loadComments(l);
  };
  const flip = $("#flipStatus");
  if (flip) flip.onclick = async () => {
    flip.disabled = true;
    const { error } = await db.from("levels").update({ possible: l.possible === false }).eq("id", l.id);
    if (error) { flip.disabled = false; return toast(friendly(error.message)); }
    toast(`${l.name} is now ${l.possible === false ? "Possible" : "Impossible"}`);
    const wasOpen = info.classList.contains("open");
    await loadLevels();
    renderInfo(wasOpen);
  };
  loadRecords(l);
  loadComments(l);
}

async function loadRecords(l) {
  const { data, error } = await db.from("records").select("player,progress,video")
    .eq("level_id", l.id).eq("status", "accepted")
    .order("progress", { ascending: false }).order("created_at");
  if (state.selected !== l.id) return;
  const box = $("#vic");
  if (error) return (box.innerHTML = `<li class="err">${esc(error.message)}</li>`);
  const rows = [];
  if (l.verifier) rows.push(`<li><span>${esc(l.verifier)}</span><span class="rec-r">Verifier${watchBtn(l.video)}</span></li>`);
  data.forEach(r => rows.push(`<li><span>${esc(r.player)}</span><span class="rec-r">${r.progress}%${watchBtn(r.video)}</span></li>`));
  box.innerHTML = rows.join("") || `<li class="muted">No records yet.</li>`;
}

async function loadComments(l) {
  const { data, error } = await db.from("comments").select("id,body,created_at,user_id,profiles(username,avatar_url)")
    .eq("level_id", l.id).order("created_at", { ascending: false }).limit(50);
  if (state.selected !== l.id) return;
  const box = $("#cms");
  if (error) return (box.innerHTML = `<p class="err">${esc(error.message)}</p>`);
  $("#cmHead").textContent = `Comments (${data.length})`;
  box.innerHTML = data.length
    ? data.map(c => {
        const name = c.profiles?.username || "deleted";
        const mine = state.user && (c.user_id === state.user.id || isAdmin());
        return `<div class="cm">
          ${avatarHtml(name, c.profiles?.avatar_url)}
          <div><div class="who">${userLink(c.profiles ? c.user_id : null, name)}<small>${timeAgo(c.created_at)}</small></div><p>${esc(c.body)}</p></div>
          ${mine ? `<button class="del" data-id="${c.id}" aria-label="Delete comment">Delete</button>` : "<span></span>"}
        </div>`;
      }).join("")
    : `<p class="muted" style="margin:0;font-size:14px">No comments yet. Start the thread.</p>`;
  bindUserLinks(box);
  box.querySelectorAll(".del").forEach(b => (b.onclick = async () => {
    const { error } = await db.from("comments").delete().eq("id", b.dataset.id);
    if (error) return toast(friendly(error.message));
    toast("Comment deleted");
    loadComments(l);
  }));
}

function renderSubmit() {
  const form = $("#subForm");
  const sel = $("#sLevel");
  sel.innerHTML = state.levels.map((l, i) => `<option value="${l.id}">#${i + 1} ${esc(l.name)}</option>`).join("");
  const locked = !canPost();
  form.querySelectorAll("input,select,textarea,button").forEach(el => (el.disabled = locked || !state.levels.length));
  $("#sErr").textContent = state.profile?.banned ? "Your account is banned from submitting records." : locked ? "Log in to submit a record." : !state.levels.length ? "There are no levels on the list yet." : "";
  if (!locked && !$("#sPlayer").value) $("#sPlayer").value = state.profile.username;
  loadMySubs();
}

$("#subForm").addEventListener("submit", async e => {
  e.preventDefault();
  const err = $("#sErr");
  const player = $("#sPlayer").value.trim();
  const progress = parseInt($("#sProg").value, 10);
  const video = $("#sVid").value.trim();
  if (!player) return (err.textContent = "Add the player name.");
  if (!(progress >= 1 && progress <= 100)) return (err.textContent = "Progress must be a number from 1 to 100.");
  if (!safeUrl(video)) return (err.textContent = "Paste a full video link starting with https://");
  err.textContent = "";
  $("#sBtn").disabled = true;
  const { error } = await db.from("records").insert({
    level_id: +$("#sLevel").value, player, progress, video, notes: $("#sNote").value.trim() || null
  });
  $("#sBtn").disabled = false;
  if (error) return (err.textContent = friendly(error.message));
  $("#sVid").value = "";
  $("#sNote").value = "";
  toast("Record submitted for review");
  loadMySubs();
});

async function loadMySubs() {
  const box = $("#mySubs"), head = $("#mySubsH");
  if (!state.user || state.guest) {
    box.innerHTML = "";
    head.hidden = true;
    return;
  }
  const { data } = await db.from("records").select("id,player,progress,status,video,created_at,levels(name)")
    .eq("user_id", state.user.id).order("created_at", { ascending: false }).limit(20);
  head.hidden = !data?.length;
  box.innerHTML = data?.length ? `<div class="scroll-x"><table class="adm"><thead><tr><th>Level</th><th>Player</th><th>Progress</th><th>Sent</th><th>Status</th><th>Video</th></tr></thead><tbody>
    ${data.map(r => `<tr><td>${esc(r.levels?.name || "Removed level")}</td><td>${esc(r.player)}</td><td>${r.progress}%</td><td>${timeAgo(r.created_at)}</td><td><span class="pill ${r.status}">${r.status}</span></td><td>${watchBtn(r.video) || "—"}</td></tr>`).join("")}
  </tbody></table></div>` : "";
}

async function renderNews() {
  $("#newsForm").hidden = !isAdmin();
  const box = $("#newsList");
  box.innerHTML = `<p class="muted">Loading…</p>`;
  const { data, error } = await db.from("news").select("id,title,body,created_at,profiles(username)").order("created_at", { ascending: false }).limit(30);
  if (error) return (box.innerHTML = `<p class="err">${esc(error.message)}</p>`);
  box.innerHTML = data.length
    ? data.map(n => `<article><time>${fmtDate(n.created_at)}</time><h2>${esc(n.title)}</h2><p>${esc(n.body)}</p>
        ${isAdmin() ? `<div style="margin-top:10px"><button class="mini n" data-id="${n.id}">Delete</button></div>` : ""}</article>`).join("")
    : `<div class="empty"><b>No news yet</b><span class="muted">List updates will show up here.</span></div>`;
  box.querySelectorAll(".mini.n").forEach(b => armButton(b, async () => {
    const { error } = await db.from("news").delete().eq("id", b.dataset.id);
    if (error) return toast(friendly(error.message));
    toast("Post deleted");
    renderNews();
  }));
}

$("#newsForm").addEventListener("submit", async e => {
  e.preventDefault();
  const title = $("#nTitle").value.trim(), body = $("#nBody").value.trim();
  if (!title || !body) return ($("#nErr").textContent = "Add a title and some text.");
  $("#nErr").textContent = "";
  const { error } = await db.from("news").insert({ title, body });
  if (error) return ($("#nErr").textContent = friendly(error.message));
  $("#nTitle").value = "";
  $("#nBody").value = "";
  toast("Post published");
  renderNews();
});

function armButton(btn, action) {
  const label = btn.textContent;
  btn.onclick = () => {
    if (!btn.classList.contains("arm")) {
      btn.classList.add("arm");
      btn.textContent = "Confirm?";
      setTimeout(() => { btn.classList.remove("arm"); btn.textContent = label; }, 3000);
      return;
    }
    btn.disabled = true;
    action();
  };
}

async function renderAdmin() {
  const body = $("#adminBody");
  if (!isAdmin()) {
    $("#adminLead").textContent = "Only list moderators can open this page.";
    body.innerHTML = `<div class="panel"><p style="margin:0">${state.guest ? "You're browsing as a guest." : `You're signed in as <b>${esc(state.profile.username)}</b>, which isn't an admin account.`}</p></div>`;
    return;
  }
  $("#adminLead").textContent = "Manage the list, records, players and comments.";
  const tabs = [["overview", "Overview"], ["records", "Records"], ["levels", "Levels"], ["users", "Players"], ["comments", "Comments"]];
  body.innerHTML = `<div class="atabs" role="tablist">${tabs.map(([k, v]) => `<button role="tab" data-tab="${k}" aria-selected="${state.adminTab === k}">${v}${k === "records" ? `<span class="count" id="pendCount" hidden></span>` : ""}</button>`).join("")}</div><div id="aPane"></div>`;
  body.querySelectorAll("[data-tab]").forEach(b => (b.onclick = () => {
    state.adminTab = b.dataset.tab;
    body.querySelectorAll("[data-tab]").forEach(x => x.setAttribute("aria-selected", x === b));
    renderAdminPane();
  }));
  refreshPendingCount();
  renderAdminPane();
}

async function refreshPendingCount() {
  const { count } = await db.from("records").select("id", { count: "exact", head: true }).eq("status", "pending");
  const el = $("#pendCount");
  if (!el) return;
  el.hidden = !count;
  el.textContent = count || "";
}

function switchAdminTab(tab) {
  state.adminTab = tab;
  renderAdmin();
}

function renderAdminPane() {
  const pane = $("#aPane");
  const t = state.adminTab;
  if (t === "overview") return renderOverview(pane);
  if (t === "records") return renderRecordsPane(pane);
  if (t === "levels") return renderLevelsPane(pane);
  if (t === "users") return renderUsersPane(pane);
  if (t === "comments") return renderCommentsPane(pane);
}

async function renderOverview(pane) {
  pane.innerHTML = `<p class="muted">Loading…</p>`;
  const head = { count: "exact", head: true };
  const [players, banned, pending, accepted, comments] = await Promise.all([
    db.from("profiles").select("id", head),
    db.from("profiles").select("id", head).eq("banned", true),
    db.from("records").select("id", head).eq("status", "pending"),
    db.from("records").select("id", head).eq("status", "accepted"),
    db.from("comments").select("id", head)
  ]);
  const tiles = [
    ["records", pending.count ?? 0, "Pending records", pending.count > 0],
    ["levels", state.levels.length, "Levels"],
    ["records", accepted.count ?? 0, "Accepted records"],
    ["users", players.count ?? 0, "Players"],
    ["users", banned.count ?? 0, "Banned", banned.count > 0],
    ["comments", comments.count ?? 0, "Comments"]
  ];
  pane.innerHTML = `<div class="ov">${tiles.map(([tab, n, label, warn]) => `<button data-go="${tab}" class="${warn ? "warn" : ""}"><b>${n}</b><span>${label}</span></button>`).join("")}</div>`;
  pane.querySelectorAll("[data-go]").forEach(b => (b.onclick = () => switchAdminTab(b.dataset.go)));
}

function renderRecordsPane(pane) {
  pane.innerHTML = `
    <h2 class="h" style="margin-top:0">Pending records</h2>
    <div id="pending"><p class="muted">Loading…</p></div>
    <h2 class="h">Edit records</h2>
    <div class="toolbar"><label style="flex:1 1 220px;max-width:340px">Level<select id="recLevel"></select></label></div>
    <div id="recEdit"></div>`;
  loadPending();
  const rl = $("#recLevel");
  rl.innerHTML = state.levels.map((l, i) => `<option value="${l.id}">#${i + 1} ${esc(l.name)}</option>`).join("");
  if (state.selected) rl.value = state.selected;
  rl.onchange = () => loadRecordEditor(+rl.value);
  if (rl.value) loadRecordEditor(+rl.value);
  else $("#recEdit").innerHTML = `<p class="muted">No levels yet.</p>`;
}

function renderLevelsPane(pane) {
  pane.innerHTML = `
    <h2 class="h" style="margin-top:0">Add a level</h2>
    <form class="panel" id="addLevel" novalidate>
      <div class="grid2">
        <label>Name<input type="text" id="aName" maxlength="60"></label>
        <label>Position<input type="number" id="aPos" min="1" value="${state.levels.length + 1}"></label>
      </div>
      <div class="grid2">
        <label>Creator<input type="text" id="aCreator"></label>
        <label>Other creators<input type="text" id="aMore" placeholder="Comma separated"></label>
      </div>
      <div class="grid2">
        <label>Verifier<input type="text" id="aVer"></label>
        <label>GD level ID<input type="text" id="aGd" inputmode="numeric"></label>
      </div>
      <div class="grid2">
        <label>Verification video<input type="url" id="aVid" placeholder="https://youtube.com/…"></label>
        <label>Status<select id="aPossible"><option value="true">Possible</option><option value="false">Impossible</option></select></label>
      </div>
      <p class="err" id="aErr"></p>
      <button class="btn sm" type="submit" style="align-self:flex-start">Add to list</button>
    </form>
    <h2 class="h">Levels</h2>
    <p class="muted" style="margin:-6px 0 12px;font-size:13px">Tap a status to switch it between Possible and Impossible.</p>
    <div id="order"></div>`;
  renderOrder();
  $("#addLevel").addEventListener("submit", async e => {
    e.preventDefault();
    const name = $("#aName").value.trim(), creator = $("#aCreator").value.trim();
    const pos = parseInt($("#aPos").value, 10);
    const vid = $("#aVid").value.trim();
    if (!name || !creator) return ($("#aErr").textContent = "Name and creator are required.");
    if (!(pos >= 1)) return ($("#aErr").textContent = "Position must be 1 or higher.");
    if (vid && !safeUrl(vid)) return ($("#aErr").textContent = "Video link must start with https://");
    const possible = $("#aPossible").value === "true";
    const { data: newId, error } = await db.rpc("add_level", {
      p_position: pos, p_name: name, p_creator: creator,
      p_extra: $("#aMore").value.split(",").map(s => s.trim()).filter(Boolean),
      p_verifier: $("#aVer").value.trim() || null, p_gd_id: $("#aGd").value.trim() || null, p_video: vid || null
    });
    if (error) return ($("#aErr").textContent = friendly(error.message));
    if (!possible) await db.from("levels").update({ possible: false }).eq("id", newId);
    toast(`${name} added at #${Math.min(pos, state.levels.length + 1)}`);
    await loadLevels();
    renderLevelsPane(pane);
  });
}

async function renderUsersPane(pane) {
  pane.innerHTML = `
    <div class="toolbar">
      <div class="search"><svg viewBox="0 0 24 24"><path d="M10 2a8 8 0 0 1 6.3 12.9l5.4 5.4-1.4 1.4-5.4-5.4A8 8 0 1 1 10 2zm0 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12z"/></svg><input type="search" id="uq" placeholder="Search players"></div>
      <div class="filters" id="ufilt"><button data-u="all" aria-pressed="true">All</button><button data-u="admin" aria-pressed="false">Admins</button><button data-u="banned" aria-pressed="false">Banned</button></div>
    </div>
    <div id="ulist"><p class="muted">Loading…</p></div>`;
  let mode = "all", timer;
  const load = async () => {
    const q = $("#uq").value.trim();
    let req = db.from("profiles").select("id,username,is_admin,banned,avatar_url,created_at").order("created_at", { ascending: false }).limit(200);
    if (q) req = req.ilike("username", `%${q.replace(/[%_]/g, m => "\\" + m)}%`);
    if (mode === "admin") req = req.eq("is_admin", true);
    if (mode === "banned") req = req.eq("banned", true);
    const { data, error } = await req;
    const box = $("#ulist");
    if (!box) return;
    if (error) return (box.innerHTML = `<p class="err">${esc(error.message)}</p>`);
    if (!data.length) return (box.innerHTML = `<p class="muted">No players found.</p>`);
    box.innerHTML = `<div class="scroll-x"><table class="adm"><thead><tr><th>Player</th><th>Joined</th><th>Role</th><th></th></tr></thead><tbody>
      ${data.map(u => {
        const me = u.id === state.user.id;
        return `<tr data-id="${u.id}">
        <td><div class="ucell">${avatarHtml(u.username, u.avatar_url)}${userLink(u.id, u.username)}</div></td>
        <td>${fmtDate(u.created_at)}</td>
        <td>${u.is_admin ? `<span class="badge">Admin</span> ` : ""}${u.banned ? `<span class="badge ban">Banned</span>` : ""}${!u.is_admin && !u.banned ? `<span class="muted">Player</span>` : ""}</td>
        <td>${me ? `<span class="muted">You</span>` : `<div class="row-actions">
          <button class="mini ${u.banned ? "y" : "n"}" data-act="ban">${u.banned ? "Unban" : "Ban"}</button>
          <button class="mini" data-act="admin">${u.is_admin ? "Remove admin" : "Make admin"}</button>
          <button class="mini n" data-act="wipe">Delete comments</button>
          <button class="mini n" data-act="del">Delete account</button>
        </div>`}</td>
      </tr>`;
      }).join("")}
    </tbody></table></div>`;
    bindUserLinks(box);
    box.querySelectorAll("tr[data-id]").forEach(tr => {
      const u = data.find(x => x.id === tr.dataset.id);
      const btn = a => tr.querySelector(`[data-act="${a}"]`);
      if (!btn("ban")) return;
      btn("ban").onclick = async () => { if (await setBan(u, !u.banned, null)) load(); };
      armButton(btn("admin"), async () => { await setAdmin(u, !u.is_admin); load(); });
      armButton(btn("wipe"), async () => { await wipeComments(u); load(); });
      armButton(btn("del"), async () => { await deleteAccount(u); load(); });
    });
  };
  $("#uq").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(load, 250); });
  $$("#ufilt button").forEach(b => (b.onclick = () => {
    mode = b.dataset.u;
    $$("#ufilt button").forEach(x => x.setAttribute("aria-pressed", x === b));
    load();
  }));
  load();
}

async function renderCommentsPane(pane) {
  pane.innerHTML = `
    <div class="toolbar"><div class="search"><svg viewBox="0 0 24 24"><path d="M10 2a8 8 0 0 1 6.3 12.9l5.4 5.4-1.4 1.4-5.4-5.4A8 8 0 1 1 10 2zm0 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12z"/></svg><input type="search" id="cq" placeholder="Filter by text, player or level"></div></div>
    <div id="clist"><p class="muted">Loading…</p></div>`;
  const { data, error } = await db.from("comments").select("id,body,created_at,user_id,level_id,profiles(username,avatar_url),levels(name)")
    .order("created_at", { ascending: false }).limit(150);
  const box = $("#clist");
  if (!box) return;
  if (error) return (box.innerHTML = `<p class="err">${esc(error.message)}</p>`);
  let rows = data;
  const draw = () => {
    const q = $("#cq").value.trim().toLowerCase();
    const list = rows.filter(c => !q || c.body.toLowerCase().includes(q) || (c.profiles?.username || "").toLowerCase().includes(q) || (c.levels?.name || "").toLowerCase().includes(q));
    if (!list.length) return (box.innerHTML = `<p class="muted">${rows.length ? "No comments match." : "No comments yet."}</p>`);
    box.innerHTML = `<div class="plist">${list.map(c => `<div data-id="${c.id}">
      <div class="ucell" style="align-items:flex-start">${avatarHtml(c.profiles?.username || "?", c.profiles?.avatar_url)}
        <div style="min-width:0"><b>${userLink(c.profiles ? c.user_id : null, c.profiles?.username)}</b> <small>on <button class="ulink" data-lvl="${c.level_id}">${esc(c.levels?.name || "removed level")}</button> · ${timeAgo(c.created_at)}</small><p>${esc(c.body)}</p></div>
      </div>
      <button class="mini n" data-del="${c.id}">Delete</button>
    </div>`).join("")}</div>`;
    bindUserLinks(box);
    box.querySelectorAll("[data-lvl]").forEach(b => (b.onclick = () => openLevel(+b.dataset.lvl)));
    box.querySelectorAll("[data-del]").forEach(b => (b.onclick = async () => {
      b.disabled = true;
      const { error } = await db.from("comments").delete().eq("id", b.dataset.del);
      if (error) { b.disabled = false; return toast(friendly(error.message)); }
      rows = rows.filter(c => c.id !== +b.dataset.del);
      toast("Comment deleted");
      draw();
    }));
  };
  $("#cq").addEventListener("input", draw);
  draw();
}

async function setBan(u, banned, reason) {
  const { error } = await db.from("profiles").update({ banned, ban_reason: banned ? (reason || null) : null }).eq("id", u.id);
  if (error) { toast(friendly(error.message)); return false; }
  toast(banned ? `${u.username} is banned` : `${u.username} is unbanned`);
  return true;
}

async function setAdmin(u, value) {
  const { error } = await db.from("profiles").update({ is_admin: value }).eq("id", u.id);
  if (error) return toast(friendly(error.message));
  toast(value ? `${u.username} is now an admin` : `${u.username} is no longer an admin`);
}

async function wipeComments(u) {
  const { error } = await db.from("comments").delete().eq("user_id", u.id);
  if (error) return toast(friendly(error.message));
  toast(`Deleted all comments by ${u.username}`);
}

async function deleteAccount(u) {
  const { error } = await db.rpc("admin_delete_user", { p_id: u.id });
  if (error) { toast(friendly(error.message)); return false; }
  toast(`${u.username}'s account was deleted`);
  return true;
}

async function renderProfile() {
  const box = $("#profileBody");
  const id = state.profileId;
  box.innerHTML = `<p class="muted">Loading profile…</p>`;
  const [pr, rr, cr] = await Promise.all([
    db.from("profiles").select("id,username,is_admin,banned,ban_reason,avatar_url,banner_url,bio,created_at").eq("id", id).maybeSingle(),
    db.from("records").select("id,progress,status,video,created_at,level_id,levels(name)").eq("user_id", id).order("created_at", { ascending: false }).limit(100),
    db.from("comments").select("id,body,created_at,level_id,levels(name)").eq("user_id", id).order("created_at", { ascending: false }).limit(30)
  ]);
  if (state.profileId !== id || state.page !== "profile") return;
  const p = pr.data;
  if (pr.error) return (box.innerHTML = `<p class="err">${esc(pr.error.message)}</p>`);
  if (!p) return (box.innerHTML = `<div class="empty"><b>Player not found</b><span class="muted">This account doesn't exist or was deleted.</span></div>`);
  const me = state.user?.id === p.id;
  const adm = isAdmin();
  const recs = rr.data || [];
  const cms = cr.data || [];
  const accepted = recs.filter(r => r.status === "accepted");
  const shownRecs = me || adm ? recs : accepted;
  box.innerHTML = `<div class="prof">
    <div class="prof-banner" id="pfBanner">${safeUrl(p.banner_url) ? `<img src="${esc(p.banner_url)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}</div>
    <div class="prof-head">
      <div id="pfAvatar">${avatarHtml(p.username, p.avatar_url, "av-xl")}</div>
      <div class="prof-name">
        <h1>${esc(p.username)}<span class="badges">${p.is_admin ? `<span class="badge">Admin</span>` : ""}${p.banned ? `<span class="badge ban">Banned</span>` : ""}</span></h1>
        <p class="muted">Joined ${fmtDate(p.created_at)}</p>
      </div>
    </div>
    ${p.bio ? `<p class="prof-bio">${esc(p.bio)}</p>` : me ? `<p class="prof-bio muted">No bio yet. Add one below.</p>` : ""}
    ${p.banned && (me || adm) && p.ban_reason ? `<div class="note">Ban reason: ${esc(p.ban_reason)}</div>` : ""}
    <dl class="stats">
      <div><dt>Records</dt><dd>${accepted.length}</dd></div>
      <div><dt>Completions</dt><dd>${accepted.filter(r => r.progress === 100).length}</dd></div>
      <div><dt>Comments</dt><dd>${cms.length}${cms.length === 30 ? "+" : ""}</dd></div>
    </dl>
    <h2 class="h">Records</h2>
    ${shownRecs.length ? `<div class="plist">${shownRecs.map(r => `<div>
      <div><button class="ulink" data-lvl="${r.level_id}"><b>${esc(r.levels?.name || "Removed level")}</b></button><br><small>${timeAgo(r.created_at)}</small></div>
      <div style="display:flex;gap:8px;align-items:center"><b style="font-variant-numeric:tabular-nums">${r.progress}%</b>${me || adm ? `<span class="pill ${r.status}">${r.status}</span>` : ""}${watchBtn(r.video)}</div>
    </div>`).join("")}</div>` : `<p class="muted" style="margin:0">No records yet.</p>`}
    <h2 class="h">Recent comments</h2>
    ${cms.length ? `<div class="plist">${cms.map(c => `<div>
      <div style="min-width:0"><small>on <button class="ulink" data-lvl="${c.level_id}">${esc(c.levels?.name || "removed level")}</button> · ${timeAgo(c.created_at)}</small><p>${esc(c.body)}</p></div>
      ${me || adm ? `<button class="mini n" data-cdel="${c.id}">Delete</button>` : "<span></span>"}
    </div>`).join("")}</div>` : `<p class="muted" style="margin:0">No comments yet.</p>`}
    ${me ? `
    <h2 class="h">Edit profile</h2>
    <form class="panel" id="pfForm" novalidate>
      <label>Profile picture link<input type="url" id="pfAv" value="${esc(p.avatar_url || "")}" placeholder="https://…/picture.png"></label>
      <label>Banner link<input type="url" id="pfBn" value="${esc(p.banner_url || "")}" placeholder="https://…/banner.jpg"></label>
      <label>Bio<textarea id="pfBio" rows="3" maxlength="300" placeholder="Tell people about yourself">${esc(p.bio || "")}</textarea></label>
      <p class="muted small">Paste a direct image link, one that opens just the picture (usually ending in .png, .jpg, .gif or .webp). Leave a box empty to remove it. The preview updates as you type.</p>
      <p class="err" id="pfErr"></p>
      <button class="btn sm" type="submit" style="align-self:flex-start">Save profile</button>
    </form>` : ""}
    ${adm && !me ? `
    <h2 class="h">Admin tools</h2>
    <div class="panel tools">
      <h3>Moderate ${esc(p.username)}</h3>
      ${p.banned ? "" : `<label>Ban reason (optional)<input type="text" id="pfReason" maxlength="200" placeholder="Shown to the player"></label>`}
      <div class="row-actions">
        <button class="mini ${p.banned ? "y" : "n"}" id="pfBan">${p.banned ? "Unban" : "Ban player"}</button>
        <button class="mini" id="pfAdm">${p.is_admin ? "Remove admin" : "Make admin"}</button>
        <button class="mini n" id="pfWipe">Delete all comments</button>
        <button class="mini n" id="pfDel">Delete account</button>
      </div>
      <p class="muted small">Deleting an account removes the player, their comments and their pending records. Accepted records stay on the list. This can't be undone.</p>
    </div>` : ""}
  </div>`;
  box.querySelectorAll("[data-lvl]").forEach(b => (b.onclick = () => openLevel(+b.dataset.lvl)));
  box.querySelectorAll("[data-cdel]").forEach(b => (b.onclick = async () => {
    b.disabled = true;
    const { error } = await db.from("comments").delete().eq("id", b.dataset.cdel);
    if (error) { b.disabled = false; return toast(friendly(error.message)); }
    toast("Comment deleted");
    renderProfile();
  }));
  const form = $("#pfForm");
  if (form) {
    const avIn = $("#pfAv"), bnIn = $("#pfBn");
    avIn.addEventListener("input", () => ($("#pfAvatar").innerHTML = avatarHtml(p.username, avIn.value.trim(), "av-xl")));
    bnIn.addEventListener("input", () => {
      const u = bnIn.value.trim();
      $("#pfBanner").innerHTML = safeUrl(u) ? `<img src="${esc(u)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : "";
    });
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const avatar_url = avIn.value.trim(), banner_url = bnIn.value.trim(), bio = $("#pfBio").value.trim();
      const err = $("#pfErr");
      if (avatar_url && !safeUrl(avatar_url)) return (err.textContent = "Picture link must start with https://");
      if (banner_url && !safeUrl(banner_url)) return (err.textContent = "Banner link must start with https://");
      err.textContent = "";
      const btn = form.querySelector("button[type=submit]");
      btn.disabled = true;
      const { error } = await db.from("profiles").update({ avatar_url: avatar_url || null, banner_url: banner_url || null, bio: bio || null }).eq("id", p.id);
      btn.disabled = false;
      if (error) return (err.textContent = friendly(error.message));
      state.profile.avatar_url = avatar_url || null;
      paintHeader();
      toast("Profile saved");
      renderProfile();
    });
  }
  if (adm && !me) {
    $("#pfBan").onclick = async () => { if (await setBan(p, !p.banned, $("#pfReason")?.value.trim())) renderProfile(); };
    armButton($("#pfAdm"), async () => { await setAdmin(p, !p.is_admin); renderProfile(); });
    armButton($("#pfWipe"), async () => { await wipeComments(p); renderProfile(); });
    armButton($("#pfDel"), async () => { if (await deleteAccount(p)) go("main"); else renderProfile(); });
  }
}

function renderOrder() {
  const box = $("#order");
  if (!state.levels.length) return (box.innerHTML = `<p class="muted">No levels yet.</p>`);
  box.innerHTML = `<div class="scroll-x"><table class="adm"><thead><tr><th>#</th><th>Level</th><th>Creator</th><th>Status</th><th>Move to</th><th></th></tr></thead><tbody>
    ${state.levels.map((l, i) => `<tr>
      <td>${i + 1}</td><td>${esc(l.name)}</td><td>${esc(l.creator)}</td>
      <td><button class="mini" data-flip="${l.id}" title="Switch status">${l.possible === false ? "Impossible" : "Possible"} ⇄</button></td>
      <td><div class="row-actions"><input type="number" min="1" max="${state.levels.length}" value="${i + 1}" id="mv${l.id}" aria-label="New position for ${esc(l.name)}"><button class="mini" data-move="${l.id}">Move</button></div></td>
      <td><button class="mini n" data-rm="${l.id}">Remove</button></td>
    </tr>`).join("")}
  </tbody></table></div>`;
  box.querySelectorAll("[data-move]").forEach(b => (b.onclick = async () => {
    const id = +b.dataset.move, pos = parseInt($("#mv" + id).value, 10);
    if (!(pos >= 1)) return toast("Enter a position of 1 or higher.");
    const { error } = await db.rpc("move_level", { p_id: id, p_position: pos });
    if (error) return toast(friendly(error.message));
    toast("List order updated");
    await loadLevels();
    renderOrder();
  }));
  box.querySelectorAll("[data-flip]").forEach(b => (b.onclick = async () => {
    const l = state.levels.find(x => x.id === +b.dataset.flip);
    b.disabled = true;
    const { error } = await db.from("levels").update({ possible: l.possible === false }).eq("id", l.id);
    if (error) { b.disabled = false; return toast(friendly(error.message)); }
    toast(`${l.name} is now ${l.possible === false ? "Possible" : "Impossible"}`);
    await loadLevels();
    renderOrder();
  }));
  box.querySelectorAll("[data-rm]").forEach(b => armButton(b, async () => {
    const { error } = await db.rpc("remove_level", { p_id: +b.dataset.rm });
    if (error) return toast(friendly(error.message));
    toast("Level removed");
    await loadLevels();
    renderOrder();
  }));
}

async function loadRecordEditor(levelId) {
  const box = $("#recEdit");
  box.innerHTML = `<p class="muted">Loading…</p>`;
  const { data, error } = await db.from("records").select("id,player,progress,video,status,created_at,user_id,profiles(username)")
    .eq("level_id", levelId).order("progress", { ascending: false }).order("created_at");
  if (+$("#recLevel").value !== levelId) return;
  if (error) return (box.innerHTML = `<p class="err">${esc(error.message)}</p>`);
  if (!data.length) return (box.innerHTML = `<p class="muted">No records on this level yet.</p>`);
  box.innerHTML = `<div class="scroll-x"><table class="adm rec-edit"><thead><tr><th>Player</th><th>Progress</th><th>Video</th><th>Status</th><th></th></tr></thead><tbody>
    ${data.map(r => `<tr data-id="${r.id}">
      <td><input type="text" class="rPlayer" value="${esc(r.player)}" maxlength="40" aria-label="Player"><small class="muted">by ${userLink(r.profiles ? r.user_id : null, r.profiles?.username || "—")}</small></td>
      <td><input type="number" class="rProg" min="1" max="100" value="${r.progress}" aria-label="Progress"></td>
      <td><input type="url" class="rVid" value="${esc(r.video)}" aria-label="Video link"></td>
      <td><select class="rStatus" aria-label="Status">
        ${["pending", "accepted", "rejected"].map(st => `<option value="${st}"${st === r.status ? " selected" : ""}>${st[0].toUpperCase() + st.slice(1)}</option>`).join("")}
      </select></td>
      <td><div class="row-actions"><button class="mini y rSave">Save</button><button class="mini n rDel">Delete</button></div></td>
    </tr>`).join("")}
  </tbody></table></div>`;
  bindUserLinks(box);
  box.querySelectorAll("tr[data-id]").forEach(tr => {
    const id = tr.dataset.id;
    tr.querySelector(".rSave").onclick = async () => {
      const player = tr.querySelector(".rPlayer").value.trim();
      const progress = parseInt(tr.querySelector(".rProg").value, 10);
      const video = tr.querySelector(".rVid").value.trim();
      const status = tr.querySelector(".rStatus").value;
      if (!player) return toast("Player name can't be empty.");
      if (!(progress >= 1 && progress <= 100)) return toast("Progress must be from 1 to 100.");
      if (!safeUrl(video)) return toast("Video link must start with https://");
      const { error } = await db.from("records").update({ player, progress, video, status }).eq("id", id);
      if (error) return toast(friendly(error.message));
      toast("Record saved");
      await loadLevels();
      loadPending();
      refreshPendingCount();
    };
    armButton(tr.querySelector(".rDel"), async () => {
      const { error } = await db.from("records").delete().eq("id", id);
      if (error) return toast(friendly(error.message));
      toast("Record deleted");
      await loadLevels();
      loadPending();
      loadRecordEditor(levelId);
    });
  });
}

async function loadPending() {
  const box = $("#pending");
  const { data, error } = await db.from("records").select("id,player,progress,video,notes,created_at,user_id,levels(name),profiles(username)")
    .eq("status", "pending").order("created_at");
  if (error) return (box.innerHTML = `<p class="err">${esc(error.message)}</p>`);
  if (!data.length) return (box.innerHTML = `<p class="muted">Nothing waiting for review.</p>`);
  box.innerHTML = `<div class="scroll-x"><table class="adm"><thead><tr><th>Level</th><th>Player</th><th>Progress</th><th>Video</th><th>Sent by</th><th></th></tr></thead><tbody>
    ${data.map(r => `<tr>
      <td>${esc(r.levels?.name || "Removed level")}</td><td>${esc(r.player)}${r.notes ? `<br><small class="muted">${esc(r.notes)}</small>` : ""}</td>
      <td>${r.progress}%</td>
      <td>${watchBtn(r.video) || "—"}</td>
      <td>${userLink(r.profiles ? r.user_id : null, r.profiles?.username || "—")}<br><small class="muted">${timeAgo(r.created_at)}</small></td>
      <td><div class="row-actions"><button class="mini y" data-id="${r.id}" data-s="accepted">Accept</button><button class="mini n" data-id="${r.id}" data-s="rejected">Reject</button></div></td>
    </tr>`).join("")}
  </tbody></table></div>`;
  bindUserLinks(box);
  box.querySelectorAll("[data-s]").forEach(b => (b.onclick = async () => {
    b.disabled = true;
    const { error } = await db.from("records").update({ status: b.dataset.s }).eq("id", b.dataset.id);
    if (error) { b.disabled = false; return toast(friendly(error.message)); }
    toast(b.dataset.s === "accepted" ? "Record accepted" : "Record rejected");
    loadPending();
    loadLevels();
    refreshPendingCount();
  }));
}

async function renderDev() {
  const box = $("#devStatus");
  box.innerHTML = `<dt>Database</dt><dd class="muted">Checking…</dd>`;
  const t0 = performance.now();
  const { count, error } = await db.from("levels").select("id", { count: "exact", head: true });
  const ms = Math.round(performance.now() - t0);
  box.innerHTML = `
    <dt>Database</dt><dd><span class="dot ${error ? "off" : "on"}"></span>${error ? esc(friendly(error.message)) : `Connected (${ms} ms)`}</dd>
    <dt>Levels</dt><dd>${error ? "—" : count}</dd>
    <dt>Signed in</dt><dd>${state.guest ? "Guest" : esc(state.profile?.username)}${isAdmin() ? " (admin)" : ""}</dd>`;
}
