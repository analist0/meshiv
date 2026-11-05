// ============================================================
// משיב — לוח בקרה
// ============================================================
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const uid = () => "r-" + Math.random().toString(36).slice(2, 8);
const DAYS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];

const MATCH_TYPES = {
  contains: "מכיל",
  exact: "התאמה מדויקת",
  startsWith: "מתחיל ב-",
  endsWith: "מסתיים ב-",
  fuzzy: "דומה (סובל שגיאות כתיב)",
  regex: "ביטוי רגולרי",
  any: "כל הודעה",
};
const REASONS = {
  rule: "חוק", welcome: "ברוך הבא", away: "מחוץ לשעות", menu: "תפריט", ai: "AI", "welcome+ai": "ברוך הבא + AI",
  "ai-error": "שגיאת AI", paused: "הבוט מושתק בצ'אט", "daily-limit": "מגבלה יומית", "group-off": "קבוצות כבויות",
  "private-off": "פרטי כבוי", "ignored-contact": "מספר חסום", "not-in-only-list": "לא ברשימה המותרת",
  disabled: "הבוט כבוי", "no-match": "אין התאמה", "from-me": "הודעה שלך — הבוט מושתק זמנית",
  "owner-stop": "הבוט הושתק בצ'אט", "owner-start": "הבוט הופעל בצ'אט", status: "סטטוס",
};
const AI_PRESETS = [
  { id: "", name: "— בחר —" },
  { id: "ollama", name: "Ollama — מקומי וחינמי", kind: "openai", baseUrl: "http://localhost:11434/v1", model: "llama3.2", note: "חינמי לגמרי. התקן מ-ollama.com והרץ: ollama pull llama3.2" },
  { id: "lmstudio", name: "LM Studio — מקומי וחינמי", kind: "openai", baseUrl: "http://localhost:1234/v1", model: "local-model", note: "הפעל Local Server ב-LM Studio." },
  { id: "openrouter", name: "OpenRouter — מודלים חינמיים", kind: "openai", baseUrl: "https://openrouter.ai/api/v1", model: "meta-llama/llama-3.3-70b-instruct:free", note: "מפתח חינמי ב-openrouter.ai. מודלים עם :free חינמיים." },
  { id: "groq", name: "Groq — שכבה חינמית", kind: "openai", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile", note: "מפתח חינמי ב-console.groq.com." },
  { id: "gemini", name: "Google Gemini — שכבה חינמית", kind: "openai", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.5-flash", note: "מפתח חינמי ב-aistudio.google.com." },
  { id: "hf", name: "Hugging Face", kind: "openai", baseUrl: "https://router.huggingface.co/v1", model: "meta-llama/Llama-3.1-8B-Instruct", note: "טוקן ב-huggingface.co/settings/tokens." },
  { id: "openai", name: "OpenAI", kind: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini", note: "בתשלום." },
  { id: "anthropic", name: "Anthropic Claude", kind: "anthropic", baseUrl: "https://api.anthropic.com", model: "claude-sonnet-5-5", note: "בתשלום." },
];

let saved = null; // הגדרות כפי שנשמרו בשרת
let cfg = null; // עותק עריכה
let stats = {};

// ---------- API ----------
// באפליקציית האנדרואיד אין שרת: הבקשות עוברות לקוד Kotlin דרך גשר
const ANDROID = Boolean(window.MeshivAndroid);
if (ANDROID) document.documentElement.dataset.platform = "android";
const pending = new Map();
let nextId = 0;
window.__meshivResolve = (id, status, text) => {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  let j = {};
  try {
    j = JSON.parse(text);
  } catch {}
  if (status >= 200 && status < 300) p.resolve(j);
  else p.reject(new Error(j.error || `שגיאה ${status}`));
};

async function api(path, opts = {}) {
  if (ANDROID) {
    const id = String(++nextId);
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      window.MeshivAndroid.request(id, path, opts.method || "GET", opts.body ? JSON.stringify(opts.body) : "");
    });
  }
  const r = await fetch(path, { headers: { "content-type": "application/json" }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `שגיאה ${r.status}`);
  return j;
}
function toast(text, ms = 2500) {
  const t = $("#toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), ms);
}

// ---------- Dirty tracking ----------
function markDirty() {
  $("#saveBar").hidden = JSON.stringify(cfg) === JSON.stringify(saved);
}
async function save() {
  try {
    saved = await api("/api/config", { method: "PUT", body: cfg });
    cfg = structuredClone(saved);
    renderAll();
    markDirty();
    toast("✅ נשמר");
  } catch (err) {
    toast("❌ " + err.message, 5000);
  }
}
$("#save").onclick = save;
$("#discard").onclick = () => {
  cfg = structuredClone(saved);
  renderAll();
  markDirty();
};
addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    if (!$("#saveBar").hidden) save();
  }
});

// ---------- Simple bindings (data-bind="a.b") ----------
const getPath = (obj, path) => path.split(".").reduce((o, k) => o?.[k], obj);
function setPath(obj, path, val) {
  const keys = path.split(".");
  const last = keys.pop();
  const target = keys.reduce((o, k) => (o[k] ??= {}), obj);
  target[last] = val;
}
function readInput(el) {
  const t = el.dataset.type;
  if (el.type === "checkbox") return el.checked;
  if (t === "number") return el.value === "" ? 0 : Number(el.value);
  if (t === "csv") return el.value.split(",").map((s) => s.trim()).filter(Boolean);
  if (t === "lines") return el.value.split("\n").map((s) => s.trim()).filter(Boolean);
  return el.value;
}
function writeInput(el, v) {
  const t = el.dataset.type;
  if (el.type === "checkbox") el.checked = v === undefined ? el.dataset.default === "true" : Boolean(v);
  else if (t === "csv") el.value = (v || []).join(", ");
  else if (t === "lines") el.value = (v || []).join("\n");
  else el.value = v ?? "";
}
function renderBindings() {
  for (const el of $$("[data-bind]")) writeInput(el, getPath(cfg, el.dataset.bind));
  for (const box of $$("[data-days]")) renderDays(box, () => getPath(cfg, box.dataset.days), (v) => setPath(cfg, box.dataset.days, v));
}
document.addEventListener("input", (e) => {
  const el = e.target.closest("[data-bind]");
  if (!el || !cfg) return;
  setPath(cfg, el.dataset.bind, readInput(el));
  markDirty();
});

function renderDays(box, get, set) {
  const cur = new Set(get() || []);
  box.innerHTML = DAYS.map((d, i) => `<label><input type="checkbox" value="${i}" ${cur.has(i) ? "checked" : ""}/>${d}</label>`).join("");
  box.onchange = () => {
    set($$("input", box).filter((x) => x.checked).map((x) => Number(x.value)));
    markDirty();
  };
}

// ---------- Tabs ----------
$("#tabs").onclick = (e) => {
  const b = e.target.closest("[data-tab]");
  if (!b) return;
  $$("#tabs button").forEach((x) => x.classList.toggle("active", x === b));
  $$(".tab").forEach((t) => (t.hidden = t.id !== `tab-${b.dataset.tab}`));
  if (b.dataset.tab === "log") loadContacts();
  if (b.dataset.tab === "dash") loadStats();
  try { localStorage.setItem("meshiv.tab", b.dataset.tab); } catch {}
};

// ---------- Master switch ----------
$("#masterSwitch").onchange = async (e) => {
  cfg.enabled = e.target.checked;
  saved.enabled = cfg.enabled;
  try {
    const next = structuredClone(saved);
    await api("/api/config", { method: "PUT", body: next });
    toast(cfg.enabled ? "הבוט פעיל" : "הבוט כבוי");
  } catch (err) {
    toast("❌ " + err.message);
  }
  markDirty();
};

// ---------- Rules ----------
function renderRules() {
  const list = $("#rulesList");
  list.textContent = "";
  cfg.rules.forEach((r, i) => list.append(ruleCard(r, i)));
  if (!cfg.rules.length) list.innerHTML = `<div class="card muted">אין חוקים. לחץ "חוק חדש".</div>`;
}
function ruleCard(r, i) {
  const el = document.createElement("div");
  el.className = "card rule" + (r.enabled ? "" : " off");
  const hits = stats.byRule?.[r.id] || 0;
  el.innerHTML = `
    <div class="rule-head">
      <label class="switch" title="פעיל"><input type="checkbox" data-f="enabled" ${r.enabled ? "checked" : ""}/><span></span></label>
      <input class="name" data-f="name" value="${esc(r.name)}" placeholder="שם החוק" />
      <span class="hits">${hits} הפעלות</span>
      <button class="btn sm" data-a="up" title="למעלה" ${i === 0 ? "disabled" : ""}>▲</button>
      <button class="btn sm" data-a="down" title="למטה" ${i === cfg.rules.length - 1 ? "disabled" : ""}>▼</button>
      <button class="btn sm" data-a="dup" title="שכפל">⧉</button>
      <button class="btn sm danger" data-a="del" title="מחק">🗑</button>
    </div>
    <div class="rule-body">
      <div class="grid3">
        <label>סוג התאמה<select data-f="match">${Object.entries(MATCH_TYPES).map(([k, v]) => `<option value="${k}" ${r.match === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
        <label>פעולה<select data-f="action"><option value="reply" ${r.action !== "ai" ? "selected" : ""}>לענות בטקסט</option><option value="ai" ${r.action === "ai" ? "selected" : ""}>להעביר ל-AI</option></select></label>
        <label>היכן<select data-f="scope"><option value="all" ${r.scope === "all" || !r.scope ? "selected" : ""}>פרטי וקבוצות</option><option value="private" ${r.scope === "private" ? "selected" : ""}>רק פרטי</option><option value="groups" ${r.scope === "groups" ? "selected" : ""}>רק קבוצות</option></select></label>
      </div>
      <label ${r.match === "any" ? "hidden" : ""}>מילות מפתח (אחת בכל שורה)${r.match === "regex" ? " — ביטויים רגולריים" : ""}<textarea rows="3" data-f="keywords" ${r.match === "regex" ? 'dir="ltr"' : ""}>${esc((r.keywords || []).join("\n"))}</textarea></label>
      ${r.match === "fuzzy" ? `<label>רמת דמיון (0.5–1)<input type="number" step="0.05" min="0.5" max="1" data-f="fuzzyThreshold" value="${r.fuzzyThreshold ?? 0.8}" /></label>` : ""}
      <div ${r.action === "ai" ? "hidden" : ""}>
        <label><span>תשובות (כדי לתת כמה תשובות, הפרד ביניהן בשורה <code>---</code>)</span><textarea rows="4" data-f="replies">${esc((r.replies || []).join("\n---\n"))}</textarea></label>
        <label>כשיש כמה תשובות<select data-f="replyMode"><option value="random" ${r.replyMode !== "sequence" && r.replyMode !== "all" ? "selected" : ""}>אקראית</option><option value="sequence" ${r.replyMode === "sequence" ? "selected" : ""}>לפי הסדר (סבב)</option><option value="all" ${r.replyMode === "all" ? "selected" : ""}>לשלוח את כולן</option></select></label>
      </div>
      <div class="grid3">
        <label>לא לחזור לאותו איש קשר במשך (דקות)<input type="number" min="0" data-f="cooldownMinutes" value="${r.cooldownMinutes ?? 0}" /></label>
        <label>להשתיק את הבוט אחרי (דקות, 0 = לא)<input type="number" min="0" data-f="pauseBotMinutes" value="${r.pauseBotMinutes ?? 0}" /></label>
        <label class="check"><input type="checkbox" data-f="continue" ${r.continue ? "checked" : ""}/> המשך לבדוק חוקים הבאים</label>
      </div>
      <label class="check"><input type="checkbox" data-f="hasSchedule" ${r.schedule ? "checked" : ""}/> פעיל רק בימים ובשעות מסוימים</label>
      <div ${r.schedule ? "" : "hidden"} class="sched">
        <div class="days"></div>
        <div class="grid2"><label>מ-<input type="time" data-f="from" value="${esc(r.schedule?.from || "09:00")}" /></label><label>עד<input type="time" data-f="to" value="${esc(r.schedule?.to || "18:00")}" /></label></div>
      </div>
    </div>`;
  if (r.schedule) renderDays($(".days", el), () => r.schedule.days, (v) => (r.schedule.days = v));

  el.addEventListener("input", (e) => {
    const f = e.target.dataset.f;
    if (!f) return;
    const v = e.target;
    if (f === "keywords") r.keywords = v.value.split("\n").map((s) => s.trim()).filter(Boolean);
    else if (f === "replies") r.replies = v.value.split(/\n-{3,}\n/).map((s) => s.trim()).filter(Boolean);
    else if (["cooldownMinutes", "pauseBotMinutes", "fuzzyThreshold"].includes(f)) r[f] = Number(v.value) || 0;
    else if (f === "from" || f === "to") r.schedule[f] = v.value;
    else if (f === "hasSchedule") {
      r.schedule = v.checked ? { days: [0, 1, 2, 3, 4], from: "09:00", to: "18:00" } : null;
      return rerender();
    } else if (v.type === "checkbox") {
      r[f] = v.checked;
      if (f === "enabled") el.classList.toggle("off", !v.checked);
    } else {
      r[f] = v.value;
      if (f === "match" || f === "action") return rerender();
    }
    markDirty();
  });
  el.addEventListener("click", (e) => {
    const a = e.target.closest("[data-a]")?.dataset.a;
    if (!a) return;
    const rules = cfg.rules;
    if (a === "up" && i > 0) [rules[i - 1], rules[i]] = [rules[i], rules[i - 1]];
    if (a === "down" && i < rules.length - 1) [rules[i + 1], rules[i]] = [rules[i], rules[i + 1]];
    if (a === "dup") rules.splice(i + 1, 0, { ...structuredClone(r), id: uid(), name: r.name + " (עותק)" });
    if (a === "del" && confirm(`למחוק את החוק "${r.name}"?`)) rules.splice(i, 1);
    rerender();
  });
  function rerender() {
    markDirty();
    renderRules();
  }
  return el;
}
$("#addRule").onclick = () => {
  cfg.rules.unshift({ id: uid(), name: "חוק חדש", enabled: true, match: "contains", keywords: [], replies: [""], replyMode: "random", scope: "all", cooldownMinutes: 0, schedule: null, continue: false, action: "reply" });
  renderRules();
  markDirty();
  $("#rulesList .name")?.select();
};

// ---------- Menu tree ----------
function renderMenu() {
  const box = $("#menuTree");
  box.textContent = "";
  (cfg.menu.items ||= []).forEach((it, i) => box.append(menuItemEl(it, i, cfg.menu.items)));
}
function menuItemEl(it, i, siblings) {
  const el = document.createElement("div");
  el.className = "menu-item";
  const isSub = Array.isArray(it.items);
  el.innerHTML = `
    <div class="row">
      <span class="num">${i + 1}.</span>
      <input data-f="label" value="${esc(it.label)}" placeholder="שם הפריט" style="flex:1;min-width:120px" />
      <select data-f="kind"><option value="reply" ${!isSub ? "selected" : ""}>תשובה</option><option value="sub" ${isSub ? "selected" : ""}>תת-תפריט</option></select>
      <button class="btn sm" data-a="up" ${i === 0 ? "disabled" : ""}>▲</button>
      <button class="btn sm danger" data-a="del">🗑</button>
    </div>
    ${isSub
      ? `<label>כותרת תת-התפריט<input data-f="title" value="${esc(it.title || "")}" /></label><div class="menu-children"></div><button class="btn sm" data-a="addchild">＋ פריט בתת-תפריט</button>`
      : `<label>תשובה<textarea rows="2" data-f="reply">${esc(it.reply || "")}</textarea></label>
         <label>להעביר לנציג — להשתיק את הבוט ל- (דקות, 0 = לא)<input type="number" min="0" data-f="pauseBotMinutes" value="${it.pauseBotMinutes || 0}" /></label>`}`;
  if (isSub) {
    const kids = $(".menu-children", el);
    it.items.forEach((c, j) => kids.append(menuItemEl(c, j, it.items)));
  }
  el.addEventListener("input", (e) => {
    if (e.target.closest(".menu-item") !== el) return;
    const f = e.target.dataset.f;
    if (!f) return;
    e.stopPropagation();
    if (f === "kind") {
      if (e.target.value === "sub") {
        delete it.reply;
        it.title = it.title || "בחר:";
        it.items = [{ label: "אפשרות", reply: "" }];
      } else {
        delete it.items;
        delete it.title;
        it.reply = "";
      }
      markDirty();
      return renderMenu();
    }
    it[f] = f === "pauseBotMinutes" ? Number(e.target.value) || 0 : e.target.value;
    markDirty();
  });
  el.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-a]");
    if (!btn || btn.closest(".menu-item") !== el) return;
    e.stopPropagation();
    const a = btn.dataset.a;
    if (a === "up" && i > 0) [siblings[i - 1], siblings[i]] = [siblings[i], siblings[i - 1]];
    if (a === "del") siblings.splice(i, 1);
    if (a === "addchild") it.items.push({ label: "אפשרות", reply: "" });
    markDirty();
    renderMenu();
  });
  return el;
}
$("#addMenuItem").onclick = () => {
  cfg.menu.items.push({ label: "פריט חדש", reply: "" });
  markDirty();
  renderMenu();
};

// ---------- AI ----------
$("#aiPreset").innerHTML = AI_PRESETS.map((p) => `<option value="${p.id}">${p.name}</option>`).join("");
$("#aiPreset").onchange = (e) => {
  const p = AI_PRESETS.find((x) => x.id === e.target.value);
  if (!p?.id) return;
  Object.assign(cfg.ai, { kind: p.kind, baseUrl: p.baseUrl, model: p.model });
  if (!cfg.ai.apiKey?.startsWith("••••")) cfg.ai.apiKey = "";
  $("#aiPresetNote").textContent = p.note;
  renderBindings();
  markDirty();
};
$("#aiTest").onclick = async () => {
  const out = $("#aiTestResult");
  out.textContent = "בודק…";
  try {
    const r = await api("/api/ai/test", { method: "POST", body: {} });
    out.textContent = r.ok ? `✅ עובד! תשובה: ${r.text.trim().slice(0, 60)}` : `❌ ${r.error}`;
  } catch (err) {
    out.textContent = `❌ ${err.message}`;
  }
};

// ---------- Backup ----------
$("#exportCfg").onclick = () => {
  const data = structuredClone(cfg);
  if (data.ai.apiKey) data.ai.apiKey = "";
  const name = `meshiv-config-${new Date().toISOString().slice(0, 10)}.json`;
  if (ANDROID) return api("/api/android/share", { method: "POST", body: { name, text: JSON.stringify(data, null, 2) } }).catch((e) => toast("❌ " + e.message));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$("#importCfg").onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!data || !Array.isArray(data.rules)) throw new Error();
    cfg = { ...data, ai: { ...data.ai, apiKey: data.ai?.apiKey || cfg.ai.apiKey } };
    renderAll();
    markDirty();
    toast("הקובץ נטען — לחץ שמור");
  } catch {
    toast("❌ קובץ לא תקין");
  }
};
$("#resetCfg").onclick = async () => {
  if (!confirm("לאפס את כל ההגדרות לברירת המחדל? (לא נשמר עד שתלחץ שמור)")) return;
  cfg = await api("/api/config/default");
  renderAll();
  markDirty();
};

// ---------- Simulator ----------
const chat = $("#simChat");
function bubble(cls, text, meta = "") {
  const b = document.createElement("div");
  b.className = `bubble ${cls}`;
  b.textContent = text;
  if (meta) b.append(Object.assign(document.createElement("span"), { className: "meta", textContent: meta }));
  chat.append(b);
  chat.scrollTop = chat.scrollHeight;
}
function sysline(text) {
  chat.append(Object.assign(document.createElement("div"), { className: "sysline", textContent: text }));
  chat.scrollTop = chat.scrollHeight;
}
$("#simForm").onsubmit = async (e) => {
  e.preventDefault();
  const text = $("#simText").value;
  if (!text.trim()) return;
  $("#simText").value = "";
  const fromMe = $("#simMe").checked;
  bubble(fromMe ? "me" : "user", text, fromMe ? "אני (ידני)" : $("#simName").value);
  if (!$("#saveBar").hidden) sysline("שים לב: יש שינויים שלא נשמרו — הסימולטור משתמש בהגדרות השמורות");
  try {
    const d = await api("/api/simulate", { method: "POST", body: { body: text, name: $("#simName").value, phone: $("#simPhone").value, isGroup: $("#simGroup").checked, fromMe } });
    const why = REASONS[d.reason] || d.reason;
    if (d.error) sysline(`שגיאת AI: ${d.error}`);
    if (!d.replies.length) return sysline(`אין תשובה — ${why}`);
    for (const r of d.replies) bubble("bot", r, `${why}${d.delayMs ? ` · אחרי ${(d.delayMs / 1000).toFixed(1)} ש׳` : ""}`);
  } catch (err) {
    sysline("❌ " + err.message);
  }
};
$("#simReset").onclick = async () => {
  await api("/api/simulate/reset", { method: "POST" });
  chat.textContent = "";
  sysline("שיחה חדשה — הלקוח נחשב לחדש");
};

// ---------- Log ----------
const fmtTime = (ts) => new Date(ts).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const shortChat = (c) => String(c || "").replace(/@.*$/, "");
function logEl(e) {
  const d = document.createElement("div");
  d.className = `e ${e.dir}`;
  const who = e.dir === "in" ? `${e.name || shortChat(e.chat)}${e.group ? " (קבוצה)" : ""}:` : e.dir === "out" ? `🤖 ← ${e.name || shortChat(e.chat)}:` : "⚙️";
  d.innerHTML = `<span class="t">${fmtTime(e.ts)}</span><span class="who">${esc(who)}</span><span class="txt">${esc(e.text)}</span>${e.reason ? `<span class="why">${esc(REASONS[e.reason] || e.reason)}</span>` : ""}`;
  return d;
}
function pushLog(e) {
  for (const box of [$("#dashLog"), $("#fullLog")]) {
    box.prepend(logEl(e));
    while (box.children.length > (box.id === "dashLog" ? 30 : 500)) box.lastChild.remove();
  }
}

async function loadContacts() {
  const list = await api("/api/contacts");
  const box = $("#contacts");
  if (!list.length) return (box.innerHTML = `<p class="muted">עדיין אין אנשי קשר.</p>`);
  box.innerHTML = `<table><thead><tr><th>שם</th><th>מספר</th><th>היום</th><th>מצב</th><th></th></tr></thead><tbody>${list
    .map((c) => `<tr><td>${esc(c.name || "—")}</td><td class="ltr">${esc(shortChat(c.id))}</td><td>${c.today}</td><td>${c.pausedUntil ? "🔇 מושתק" : "🟢 פעיל"}</td><td><button class="btn sm" data-id="${esc(c.id)}" data-act="${c.pausedUntil ? "resume" : "pause"}">${c.pausedUntil ? "הפעל" : "השתק"}</button></td></tr>`)
    .join("")}</tbody></table>`;
}
$("#contacts").onclick = async (e) => {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  await api(`/api/contacts/${encodeURIComponent(b.dataset.id)}/${b.dataset.act}`, { method: "POST" });
  loadContacts();
};
$("#refreshContacts").onclick = loadContacts;

// ---------- Stats ----------
async function loadStats() {
  stats = await api("/api/stats");
  const tiles = [["incoming", "הודעות נכנסות"], ["replied", "מענים שנשלחו"], ["ai", "תשובות AI"], ["contacts", "אנשי קשר"]];
  $("#stats").innerHTML = tiles.map(([k, l]) => `<div class="stat"><b>${(stats[k] || 0).toLocaleString("he-IL")}</b><span>${l}</span></div>`).join("");
  const names = Object.fromEntries((cfg?.rules || []).map((r) => [r.id, r.name]));
  const top = Object.entries(stats.byRule || {}).sort((a, b) => b[1] - a[1]).slice(0, 5);
  $("#topRules").innerHTML = top.length ? top.map(([id, n]) => `<li>${esc(names[id] || id)} — ${n}</li>`).join("") : `<li class="muted">עדיין אין</li>`;
}

// ---------- WhatsApp status ----------
const STATUS = {
  OFF: ["מנותק", "", "WhatsApp לא מחובר. לחץ התחבר."],
  STARTING: ["מתחבר…", "wait", "מפעיל את WhatsApp Web ברקע. בפעם הראשונה זה יכול לקחת דקה."],
  QR: ["ממתין לסריקה", "wait", "סרוק את הקוד עם הטלפון."],
  CONNECTED: ["מחובר", "ok", "מחובר ועונה להודעות."],
  ERROR: ["שגיאה", "bad", ""],
  STOPPED: ["מנותק", "", "החיבור נסגר."],
  ANDROID_ON: ["פעיל בטלפון", "ok", "משיב מאזין להתראות WhatsApp ועונה מתוכן."],
  ANDROID_OFF: ["אין הרשאה", "bad", "צריך לאשר למשיב לקרוא התראות. לחץ על הכפתור למטה."],
  SIMULATOR: ["מצב סימולטור", "wait", "השרת הופעל עם npm run sim — בלי WhatsApp. אפשר לבדוק הכל בלשונית סימולטור."],
  CONFLICT: ["פתוח במקום אחר", "bad", "WhatsApp Web פתוח במכשיר אחר."],
  UNPAIRED: ["לא מקושר", "bad", "הקישור בוטל מהטלפון. התחבר מחדש."],
};
function renderStatus(s) {
  const [label, cls, text] = STATUS[s.status] || [s.status, "", ""];
  $("#waPill").textContent = `WhatsApp: ${label}`;
  $("#waPill").className = `pill ${cls}`;
  $("#waText").textContent = s.error ? `❌ ${s.error}` : text;
  $("#qrBox").hidden = !s.qr;
  if (s.qr && s.qr !== renderStatus.lastQr) {
    renderStatus.lastQr = s.qr;
    const box = $("#qrImg");
    box.textContent = "";
    if (s.qr.startsWith("data:image")) box.append(Object.assign(document.createElement("img"), { src: s.qr, alt: "QR" }));
    else if (window.QRCode) new window.QRCode(box, { text: s.qr, width: 256, height: 256, correctLevel: window.QRCode.CorrectLevel.L });
    else box.textContent = "לא ניתן להציג QR (אין חיבור לאינטרנט לטעינת הספרייה). סרוק מהטרמינל.";
  }
  if (ANDROID) $("#waStart").textContent = s.status === "ANDROID_ON" ? "הגדרות הרשאת התראות" : "הפעל הרשאת התראות";
  $("#waStart").disabled = ["STARTING", "QR", "CONNECTED", "SIMULATOR"].includes(s.status);
  $("#waStop").disabled = ["OFF", "STOPPED", "SIMULATOR", "ERROR"].includes(s.status);
}
$("#waStart").onclick = () => api("/api/whatsapp/start", { method: "POST" }).catch((e) => toast("❌ " + e.message));
$("#batteryBtn").onclick = () => api("/api/android/battery", { method: "POST" }).catch((e) => toast("❌ " + e.message));
$("#waStop").onclick = () => api("/api/whatsapp/stop", { method: "POST" }).catch((e) => toast("❌ " + e.message));

// ---------- Boot ----------
function renderAll() {
  renderBindings();
  renderRules();
  renderMenu();
  $("#masterSwitch").checked = cfg.enabled;
}

async function boot() {
  saved = await api("/api/config");
  cfg = structuredClone(saved);
  await loadStats().catch(() => {});
  renderAll();
  for (const e of (await api("/api/log")).slice(-100)) pushLog(e);
  renderStatus(await api("/api/status"));
  const onLog = (e) => {
    pushLog(e);
    clearTimeout(boot.st);
    boot.st = setTimeout(() => loadStats().catch(() => {}), 1500);
  };
  if (ANDROID) {
    // אין SSE באפליקציה — בודקים כל כמה שניות
    let lastTs = Math.max(0, ...(await api("/api/log")).map((e) => e.ts));
    const poll = async () => {
      renderStatus(await api("/api/status"));
      for (const e of await api(`/api/log?since=${lastTs}`)) {
        lastTs = Math.max(lastTs, e.ts);
        onLog(e);
      }
    };
    window.__meshivRefresh = () => poll().catch(() => {});
    setInterval(window.__meshivRefresh, 3000);
  } else {
    const es = new EventSource("/api/events");
    es.addEventListener("status", (e) => renderStatus(JSON.parse(e.data)));
    es.addEventListener("log", (e) => onLog(JSON.parse(e.data)));
  }
  try {
    const tab = localStorage.getItem("meshiv.tab");
    if (tab) $(`#tabs [data-tab="${tab}"]`)?.click();
  } catch {}
  sysline("כתוב הודעה כאילו אתה לקוח, ותראה מה הבוט עונה.");
}
boot().catch((err) => toast("❌ " + err.message, 8000));
addEventListener("beforeunload", (e) => {
  if (!$("#saveBar").hidden) e.preventDefault();
});
