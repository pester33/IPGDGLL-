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

const state = { user: null, profile: null, guest: false, levels: [], selected: null, page: "main", mode: "in", filter: "all" };

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
  if (/Failed to fetch|NetworkError/i.test(m)) return "Can't reach the server. Check your connection.";
  return m || "Something went wrong. Try again.";
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
    const { data } = await db.from("profiles").select("username,is_admin").eq("id", session.user.id).maybeSingle();
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
  const name = state.guest ? "guest" : state.profile.username;
  $("#uname").textContent = name + (isAdmin() ? " · admin" : "");
  $("#av").textContent = name[0].toUpperCase();
  $("#av").style.background = avColor(name);
  $("#logout").textContent = state.guest ? "Log in" : "Log out";
  go("main");
  loadLevels();
}

function go(page) {
  state.page = page;
  $$("#nav button").forEach(b => (b.dataset.page === page ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
  $$("[data-view]").forEach(v => (v.hidden = v.dataset.view !== page));
  if (page === "admin") renderAdmin();
  if (page === "submit") renderSubmit();
  if (page === "news") renderNews();
  if (page === "dev") renderDev();
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
  const canPost = state.user && !state.guest;
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
        <div><dt>Status</dt><dd>${statusTag(l).replace('class="tag', 'style="margin:0" class="tag')}</dd></div>
        <div><dt>Position</dt><dd>#${rank}</dd></div>
        <div><dt>Level ID</dt><dd>${esc(l.gd_id || "—")}</dd></div>
        <div><dt>List WR</dt><dd>${l.wr ? l.wr + "%" : "None"}</dd></div>
      </dl>
      ${vid ? `<div class="links"><a href="${esc(vid)}" target="_blank" rel="noopener">Watch verification ↗</a></div>` : ""}
      <h3 class="sec-h">Records</h3>
      <ul class="victors" id="vic"><li class="muted">Loading…</li></ul>
      <h3 class="sec-h" id="cmHead">Comments</h3>
      <div class="comments" id="cms"><p class="muted" style="margin:0">Loading…</p></div>
      ${canPost
        ? `<form class="addc" id="addc"><input type="text" id="cIn" placeholder="Add a comment" maxlength="300"><button class="btn sm" type="submit">Post</button></form>`
        : `<p class="muted" style="margin:0;font-size:13px">Log in to comment.</p>`}
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
  loadRecords(l);
  loadComments(l);
}

async function loadRecords(l) {
  const { data, error } = await db.from("records").select("player,progress")
    .eq("level_id", l.id).eq("status", "accepted")
    .order("progress", { ascending: false }).order("created_at");
  if (state.selected !== l.id) return;
  const box = $("#vic");
  if (error) return (box.innerHTML = `<li class="err">${esc(error.message)}</li>`);
  const rows = [];
  if (l.verifier) rows.push(`<li><span>${esc(l.verifier)}</span><span>Verifier</span></li>`);
  data.forEach(r => rows.push(`<li><span>${esc(r.player)}</span><span>${r.progress}%</span></li>`));
  box.innerHTML = rows.join("") || `<li class="muted">No records yet.</li>`;
}

async function loadComments(l) {
  const { data, error } = await db.from("comments").select("id,body,created_at,user_id,profiles(username)")
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
          <div class="av" style="background:${avColor(name)}">${esc(name[0].toUpperCase())}</div>
          <div><div class="who">${esc(name)}<small>${timeAgo(c.created_at)}</small></div><p>${esc(c.body)}</p></div>
          ${mine ? `<button class="del" data-id="${c.id}" aria-label="Delete comment">Delete</button>` : "<span></span>"}
        </div>`;
      }).join("")
    : `<p class="muted" style="margin:0;font-size:14px">No comments yet. Start the thread.</p>`;
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
  const locked = !state.user || state.guest;
  form.querySelectorAll("input,select,textarea,button").forEach(el => (el.disabled = locked || !state.levels.length));
  $("#sErr").textContent = locked ? "Log in to submit a record." : !state.levels.length ? "There are no levels on the list yet." : "";
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
  const { data } = await db.from("records").select("id,player,progress,status,created_at,levels(name)")
    .eq("user_id", state.user.id).order("created_at", { ascending: false }).limit(20);
  head.hidden = !data?.length;
  box.innerHTML = data?.length ? `<div class="scroll-x"><table class="adm"><thead><tr><th>Level</th><th>Player</th><th>Progress</th><th>Sent</th><th>Status</th></tr></thead><tbody>
    ${data.map(r => `<tr><td>${esc(r.levels?.name || "Removed level")}</td><td>${esc(r.player)}</td><td>${r.progress}%</td><td>${timeAgo(r.created_at)}</td><td><span class="pill ${r.status}">${r.status}</span></td></tr>`).join("")}
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
  $("#adminLead").textContent = "Review records and manage the list.";
  body.innerHTML = `
    <h2 class="h" style="margin-top:0">Pending records</h2>
    <div id="pending"><p class="muted">Loading…</p></div>
    <h2 class="h">Add a level</h2>
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
    <h2 class="h">List order</h2>
    <div id="order"></div>`;
  renderOrder();
  loadPending();
  $("#addLevel").addEventListener("submit", async e => {
    e.preventDefault();
    const name = $("#aName").value.trim(), creator = 
