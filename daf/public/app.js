// ============================================================
// דף — מחברת בלוקים בעברית (RTL) עם עוזר AI שעובד עם כל מודל.
// כל הנתונים נשמרים מקומית ב-localStorage של הדפדפן.
// ============================================================

const $ = (s, r = document) => r.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const STORE_KEY = "daf.v1";
const SETTINGS_KEY = "daf.settings.v1";
const THEME_KEY = "daf.theme";

// ---------- Block types ----------
const TYPES = [
  { type: "p", label: "טקסט", hint: "פסקה רגילה", icon: "¶", keys: "text paragraph טקסט פסקה" },
  { type: "h1", label: "כותרת 1", hint: "כותרת גדולה", icon: "H1", keys: "h1 heading כותרת" },
  { type: "h2", label: "כותרת 2", hint: "כותרת בינונית", icon: "H2", keys: "h2 heading כותרת" },
  { type: "h3", label: "כותרת 3", hint: "כותרת קטנה", icon: "H3", keys: "h3 heading כותרת" },
  { type: "ul", label: "רשימת תבליטים", hint: "רשימה פשוטה", icon: "•", keys: "bullet list רשימה תבליט" },
  { type: "ol", label: "רשימה ממוספרת", hint: "רשימה עם מספרים", icon: "1.", keys: "number ordered list רשימה ממוספרת" },
  { type: "todo", label: "רשימת משימות", hint: "מעקב עם תיבות סימון", icon: "☑", keys: "todo task check משימה משימות" },
  { type: "quote", label: "ציטוט", hint: "ציטוט מודגש", icon: "❝", keys: "quote ציטוט" },
  { type: "callout", label: "תיבת הדגשה", hint: "הערה בולטת", icon: "💡", keys: "callout note הדגשה הערה" },
  { type: "code", label: "קוד", hint: "קטע קוד (LTR)", icon: "</>", keys: "code קוד" },
  { type: "divider", label: "קו מפריד", hint: "הפרדה בין חלקים", icon: "—", keys: "divider hr line קו מפריד" },
  { type: "page", label: "תת-דף", hint: "דף חדש בתוך הדף הזה", icon: "📄", keys: "page subpage דף תת" },
  { type: "ai", label: "שאל את ה-AI", hint: "כתיבה, סיכום ותרגום", icon: "✨", keys: "ai gpt claude llm בינה עוזר" },
];
const TEXT_TYPES = new Set(["p", "h1", "h2", "h3", "ul", "ol", "todo", "quote", "callout", "code"]);
const CONTINUE_TYPES = new Set(["ul", "ol", "todo"]);
const PLACEHOLDERS = { p: "הקלד / לפקודות…", h1: "כותרת 1", h2: "כותרת 2", h3: "כותרת 3", ul: "רשימה", ol: "רשימה", todo: "משימה", quote: "ציטוט", callout: "כתוב משהו…", code: "// קוד" };
const EMOJIS = "📄📝📚📌📅✅💡🎯🚀⭐🔥🧠💼🏠🛒✈️🎨🎵📷🧪💻🔧📊💬❤️🌱🍳🏃📖🗂️🔒🌍".match(/\p{Extended_Pictographic}️?/gu);

// ---------- AI presets ----------
const PRESETS = [
  { id: "ollama", name: "Ollama — מקומי וחינמי", kind: "openai", baseUrl: "http://localhost:11434/v1", model: "llama3.2", note: "חינמי לגמרי, רץ על המחשב שלך. התקן מ-ollama.com והרץ: ollama pull llama3.2" },
  { id: "lmstudio", name: "LM Studio — מקומי וחינמי", kind: "openai", baseUrl: "http://localhost:1234/v1", model: "local-model", note: "הפעל את ה-Local Server ב-LM Studio והעתק את שם המודל." },
  { id: "openrouter", name: "OpenRouter — מודלים חינמיים", kind: "openai", baseUrl: "https://openrouter.ai/api/v1", model: "meta-llama/llama-3.3-70b-instruct:free", note: "מפתח חינמי ב-openrouter.ai. מודלים שמסתיימים ב-:free חינמיים (עם מגבלת קצב)." },
  { id: "groq", name: "Groq — שכבה חינמית", kind: "openai", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile", note: "מפתח חינמי ב-console.groq.com. מהיר מאוד." },
  { id: "gemini", name: "Google Gemini — שכבה חינמית", kind: "openai", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.5-flash", note: "מפתח חינמי ב-aistudio.google.com." },
  { id: "hf", name: "Hugging Face — שכבה חינמית", kind: "openai", baseUrl: "https://router.huggingface.co/v1", model: "meta-llama/Llama-3.1-8B-Instruct", note: "טוקן חינמי ב-huggingface.co/settings/tokens." },
  { id: "mistral", name: "Mistral", kind: "openai", baseUrl: "https://api.mistral.ai/v1", model: "mistral-small-latest", note: "יש שכבת ניסיון חינמית ב-console.mistral.ai." },
  { id: "xai", name: "xAI Grok", kind: "openai", baseUrl: "https://api.x.ai/v1", model: "grok-3-mini", note: "מפתח ב-console.x.ai." },
  { id: "openai", name: "OpenAI", kind: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini", note: "מפתח ב-platform.openai.com (בתשלום)." },
  { id: "anthropic", name: "Anthropic Claude", kind: "anthropic", baseUrl: "https://api.anthropic.com", model: "claude-sonnet-5-5", note: "מפתח ב-console.anthropic.com (בתשלום)." },
  { id: "custom", name: "מותאם אישית (כל API תואם OpenAI)", kind: "openai", baseUrl: "", model: "", note: "כל שרת שתומך ב-/chat/completions: vLLM, llama.cpp, Together, DeepSeek ועוד." },
];

// ---------- State ----------
let state = loadState();
let settings = loadSettings();
let serverConfig = { hasServerKey: false };

function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && s.pages && Array.isArray(s.root)) return s;
  } catch {}
  return seedState();
}

function seedState() {
  const welcome = newPage(null, "ברוכים הבאים לדף", "👋");
  const tips = newPage(welcome.id, "טיפים מהירים", "💡");
  welcome.blocks = [
    B("p", "זו מחברת בלוקים בעברית, מיושרת לימין, שעובדת עם כל מודל AI — גם מקומי וחינמי."),
    B("h2", "איך מתחילים"),
    B("todo", "הקלד / בשורה ריקה כדי לבחור סוג בלוק"),
    B("todo", "לחץ על ✨ AI למעלה כדי לסכם, להמשיך לכתוב או לתרגם"),
    B("todo", "בחר מודל ב-⚙️ הגדרות מודל AI (למשל Ollama חינמי)"),
    B("callout", "הכל נשמר אוטומטית בדפדפן שלך. אפשר לייצא גיבוי מהסרגל הצדדי."),
    { ...B("link", ""), pageId: tips.id },
  ];
  tips.blocks = [
    B("h2", "קיצורי Markdown"),
    B("ul", "# רווח → כותרת 1,  ## → כותרת 2,  ### → כותרת 3"),
    B("ul", "- רווח → תבליט,  1. רווח → רשימה ממוספרת"),
    B("ul", "[] רווח → משימה,  > רווח → ציטוט"),
    B("ul", "``` → קוד,  --- → קו מפריד"),
    B("h2", "מקלדת"),
    B("ul", "Enter — בלוק חדש,  Shift+Enter — שורה חדשה באותו בלוק"),
    B("ul", "Backspace בתחילת בלוק — מיזוג עם הקודם"),
    B("ul", "Ctrl+K — חיפוש דפים"),
  ];
  const pages = { [welcome.id]: welcome, [tips.id]: tips };
  welcome.children = [tips.id];
  return { root: [welcome.id], pages, current: welcome.id, expanded: { [welcome.id]: true } };
}

function B(type, text = "", extra = {}) {
  return { id: uid(), type, text, ...extra };
}

function newPage(parentId, title = "", icon = "📄") {
  const now = Date.now();
  return { id: uid(), parentId, title, icon, blocks: [B("p")], children: [], createdAt: now, updatedAt: now };
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  setStatus("שומר…");
  saveTimer = setTimeout(flushSave, 250);
}
function flushSave() {
  clearTimeout(saveTimer);
  saveTimer = null;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
    setStatus("נשמר");
  } catch (e) {
    setStatus("⚠️ שמירה נכשלה");
    console.error(e);
  }
}
addEventListener("pagehide", () => saveTimer && flushSave());
document.addEventListener("visibilitychange", () => document.hidden && saveTimer && flushSave());
function touch() {
  const p = page();
  if (p) p.updatedAt = Date.now();
  save();
}
function setStatus(t) {
  $("#status").textContent = t;
}

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    if (s && s.kind) return s;
  } catch {}
  return presetSettings(PRESETS[0], true);
}
function presetSettings(p, isDefault = false) {
  return { preset: p.id, kind: p.kind, baseUrl: p.baseUrl, model: p.model, apiKey: "", ...(isDefault ? { isDefault: true } : {}) };
}
const LOCAL_PRESETS = new Set(["ollama", "lmstudio"]);
function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {}
  updateModelLabel();
}

const page = () => state.pages[state.current];
const blockIndex = (id) => page().blocks.findIndex((b) => b.id === id);
const blockEl = (id) => document.querySelector(`.block[data-id="${id}"]`);
const contentEl = (id) => blockEl(id)?.querySelector(".content");

// ---------- Caret helpers ----------
function getCaret(el) {
  const sel = getSelection();
  if (!sel.rangeCount || !el.contains(sel.anchorNode)) return el.textContent.length;
  const r = sel.getRangeAt(0);
  const pre = r.cloneRange();
  pre.selectNodeContents(el);
  pre.setEnd(r.startContainer, r.startOffset);
  return pre.toString().length;
}
function setCaret(el, pos) {
  el.focus();
  const sel = getSelection();
  const range = document.createRange();
  let remaining = Math.max(0, pos);
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (remaining <= node.length) {
      range.setStart(node, remaining);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    remaining -= node.length;
  }
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}
function isCollapsed() {
  const s = getSelection();
  return s.rangeCount && s.getRangeAt(0).collapsed;
}
function readText(el) {
  const t = el.innerText;
  return t === "\n" ? "" : t.replace(/ /g, " ");
}
function focusBlock(id, pos = "end") {
  const el = contentEl(id);
  if (!el) return;
  setCaret(el, pos === "end" ? el.textContent.length : pos);
  el.scrollIntoView({ block: "nearest" });
}

// ---------- Rendering ----------
function render() {
  if (!page()) state.current = state.root[0] || createPage(null).id;
  renderTree();
  renderPage();
}

function renderTree() {
  const tree = $("#tree");
  const q = $("#search").value.trim().toLowerCase();
  tree.textContent = "";
  if (q) {
    const hits = Object.values(state.pages).filter((p) => (p.title || "ללא כותרת").toLowerCase().includes(q) || p.blocks.some((b) => b.text?.toLowerCase().includes(q)));
    if (!hits.length) tree.append(Object.assign(document.createElement("div"), { className: "tree-empty", textContent: "לא נמצאו דפים" }));
    for (const p of hits) tree.append(treeItem(p, 0, true));
    return;
  }
  if (!state.root.length) tree.append(Object.assign(document.createElement("div"), { className: "tree-empty", textContent: "אין דפים עדיין" }));
  for (const id of state.root) appendTree(tree, id);
}
function appendTree(container, id) {
  const p = state.pages[id];
  if (!p) return;
  container.append(treeItem(p));
  if (p.children.length && state.expanded[id]) {
    const kids = document.createElement("div");
    kids.className = "tree-children";
    for (const c of p.children) appendTree(kids, c);
    container.append(kids);
  }
}
function treeItem(p, _depth, flat = false) {
  const row = document.createElement("div");
  row.className = "tree-item" + (p.id === state.current ? " active" : "");
  row.dataset.id = p.id;
  const tw = document.createElement("button");
  tw.className = "twisty" + (!p.children.length || flat ? " empty" : "");
  tw.textContent = state.expanded[p.id] ? "▼" : "◀";
  tw.title = "הרחב/כווץ";
  tw.onclick = (e) => {
    e.stopPropagation();
    state.expanded[p.id] = !state.expanded[p.id];
    save();
    renderTree();
  };
  const icon = Object.assign(document.createElement("span"), { className: "t-icon", textContent: p.icon || "📄" });
  const title = Object.assign(document.createElement("span"), { className: "t-title", textContent: p.title || "ללא כותרת" });
  const actions = document.createElement("span");
  actions.className = "t-actions";
  const add = Object.assign(document.createElement("button"), { className: "icon-btn", textContent: "＋", title: "תת-דף חדש" });
  add.onclick = (e) => {
    e.stopPropagation();
    const np = createPage(p.id);
    openPage(np.id, true);
  };
  const del = Object.assign(document.createElement("button"), { className: "icon-btn", textContent: "🗑", title: "מחק דף" });
  del.onclick = (e) => {
    e.stopPropagation();
    deletePage(p.id);
  };
  actions.append(add, del);
  row.append(tw, icon, title, actions);
  row.onclick = () => openPage(p.id);
  return row;
}

function renderCrumbs() {
  const crumbs = $("#crumbs");
  crumbs.textContent = "";
  const chain = [];
  for (let p = page(); p; p = state.pages[p.parentId]) chain.unshift(p);
  chain.forEach((p, i) => {
    if (i) crumbs.append(Object.assign(document.createElement("span"), { className: "sep", textContent: "/" }));
    const a = Object.assign(document.createElement("a"), { textContent: `${p.icon || ""} ${p.title || "ללא כותרת"}` });
    a.onclick = () => openPage(p.id);
    crumbs.append(a);
  });
}

function renderPage() {
  const p = page();
  $("#pageIcon").textContent = p.icon || "📄";
  const title = $("#title");
  if (document.activeElement !== title) title.textContent = p.title;
  document.title = `${p.title || "ללא כותרת"} — דף`;
  renderCrumbs();
  renderBlocks();
}

function renderBlocks() {
  const wrap = $("#blocks");
  wrap.textContent = "";
  let n = 0;
  for (const b of page().blocks) {
    n = b.type === "ol" ? n + 1 : 0;
    wrap.append(blockNode(b, n));
  }
}

function blockNode(b, num) {
  const el = document.createElement("div");
  el.className = `block ${b.type}` + (b.type === "todo" && b.checked ? " done" : "");
  el.dataset.id = b.id;

  const handle = document.createElement("div");
  handle.className = "handle";
  handle.innerHTML = `<button class="add" title="הוסף בלוק מתחת">＋</button><button class="drag" title="גרור להזזה · לחץ לתפריט" draggable="true">⋮⋮</button>`;
  el.append(handle);

  if (b.type === "divider") {
    el.tabIndex = 0;
    el.append(document.createElement("hr"));
    return el;
  }

  const marker = document.createElement("span");
  marker.className = "marker";
  if (b.type === "ul") marker.textContent = "•";
  else if (b.type === "ol") marker.textContent = `${num}.`;
  else if (b.type === "callout") marker.textContent = b.icon || "💡";
  else if (b.type === "link") marker.textContent = state.pages[b.pageId]?.icon || "📄";
  else if (b.type === "todo") {
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!b.checked;
    cb.className = "todo-check";
    marker.append(cb);
  }
  if (marker.childNodes.length) el.append(marker);

  const c = document.createElement("div");
  c.className = "content";
  if (b.type === "link") {
    const target = state.pages[b.pageId];
    c.textContent = target ? target.title || "ללא כותרת" : "(הדף נמחק)";
    c.tabIndex = 0;
  } else {
    c.contentEditable = "plaintext-only";
    if (c.contentEditable !== "plaintext-only") c.contentEditable = "true";
    c.spellcheck = b.type !== "code";
    c.dataset.placeholder = PLACEHOLDERS[b.type] || "";
    c.textContent = b.text || "";
    if (b.type === "code") c.dir = "ltr";
  }
  el.append(c);
  return el;
}

// ---------- Block operations ----------
function insertBlockAfter(afterId, block) {
  const blocks = page().blocks;
  const i = afterId ? blockIndex(afterId) : blocks.length - 1;
  blocks.splice(i + 1, 0, block);
  touch();
  renderBlocks();
  return block;
}
function setType(id, type) {
  const b = page().blocks[blockIndex(id)];
  if (!b) return;
  if (type === "page") {
    const np = createPage(state.current, { linkInParent: false });
    Object.assign(b, { type: "link", text: "", pageId: np.id });
    touch();
    openPage(np.id, true);
    return;
  }
  if (type === "ai") {
    b.text = "";
    touch();
    renderBlocks();
    focusBlock(id);
    openAI();
    return;
  }
  b.type = type;
  if (type === "todo") b.checked = !!b.checked;
  if (type === "divider") {
    b.text = "";
    const next = page().blocks[blockIndex(id) + 1];
    touch();
    if (next && TEXT_TYPES.has(next.type)) {
      renderBlocks();
      focusBlock(next.id, 0);
    } else {
      const nb = insertBlockAfter(id, B("p"));
      focusBlock(nb.id);
    }
    return;
  }
  touch();
  renderBlocks();
  focusBlock(id);
}
function removeBlock(id, focusPrev = true) {
  const blocks = page().blocks;
  const i = blockIndex(id);
  if (i < 0) return;
  blocks.splice(i, 1);
  if (!blocks.length) blocks.push(B("p"));
  touch();
  renderBlocks();
  const target = blocks[Math.max(0, focusPrev ? i - 1 : i)] || blocks[0];
  if (TEXT_TYPES.has(target.type)) focusBlock(target.id);
}
function duplicateBlock(id) {
  const b = page().blocks[blockIndex(id)];
  const copy = { ...structuredClone(b), id: uid() };
  if (copy.type === "link") copy.type = "p", (copy.text = state.pages[b.pageId]?.title || ""), delete copy.pageId;
  insertBlockAfter(id, copy);
}
function moveBlock(id, targetId, after) {
  const blocks = page().blocks;
  const from = blockIndex(id);
  if (from < 0 || id === targetId) return;
  const [b] = blocks.splice(from, 1);
  let to = blocks.findIndex((x) => x.id === targetId);
  if (after) to += 1;
  blocks.splice(to, 0, b);
  touch();
  renderBlocks();
}

// ---------- Pages ----------
function createPage(parentId, { linkInParent = true } = {}) {
  const p = newPage(parentId);
  state.pages[p.id] = p;
  if (parentId && state.pages[parentId]) {
    state.pages[parentId].children.push(p.id);
    state.expanded[parentId] = true;
    const parent = state.pages[parentId];
    if (linkInParent) parent.blocks.push({ ...B("link"), pageId: p.id });
  } else {
    state.root.push(p.id);
  }
  save();
  return p;
}
function openPage(id, focusTitle = false) {
  if (!state.pages[id]) return;
  state.current = id;
  for (let p = state.pages[id]; p?.parentId; p = state.pages[p.parentId]) state.expanded[p.parentId] = true;
  save();
  closeMenus();
  render();
  $("#scroller").scrollTop = 0;
  $("#sidebar").classList.remove("open");
  if (focusTitle) setCaret($("#title"), 0);
}
function deletePage(id) {
  const p = state.pages[id];
  if (!p) return;
  const count = countDescendants(id);
  if (!confirm(`למחוק את "${p.title || "ללא כותרת"}"${count ? ` ועוד ${count} תתי-דפים` : ""}?`)) return;
  const removed = new Set();
  (function rm(pid) {
    const x = state.pages[pid];
    if (!x) return;
    x.children.forEach(rm);
    removed.add(pid);
    delete state.pages[pid];
  })(id);
  if (p.parentId && state.pages[p.parentId]) {
    const parent = state.pages[p.parentId];
    parent.children = parent.children.filter((c) => c !== id);
    parent.blocks = parent.blocks.filter((b) => !(b.type === "link" && removed.has(b.pageId)));
    if (!parent.blocks.length) parent.blocks.push(B("p"));
  } else {
    state.root = state.root.filter((r) => r !== id);
  }
  if (removed.has(state.current)) state.current = p.parentId && state.pages[p.parentId] ? p.parentId : state.root[0];
  if (!state.root.length) state.current = createPage(null).id;
  save();
  render();
}
function countDescendants(id) {
  const p = state.pages[id];
  return p ? p.children.reduce((n, c) => n + 1 + countDescendants(c), 0) : 0;
}

// ---------- Markdown <-> blocks ----------
function blocksToMarkdown(blocks) {
  let n = 0;
  return blocks
    .map((b) => {
      n = b.type === "ol" ? n + 1 : 0;
      switch (b.type) {
        case "h1": return `# ${b.text}`;
        case "h2": return `## ${b.text}`;
        case "h3": return `### ${b.text}`;
        case "ul": return `- ${b.text}`;
        case "ol": return `${n}. ${b.text}`;
        case "todo": return `- [${b.checked ? "x" : " "}] ${b.text}`;
        case "quote": return `> ${b.text}`;
        case "callout": return `> 💡 ${b.text}`;
        case "code": return "```\n" + b.text + "\n```";
        case "divider": return "---";
        case "link": return `[${state.pages[b.pageId]?.title || "דף"}]`;
        default: return b.text;
      }
    })
    .join("\n");
}
function markdownToBlocks(md) {
  const out = [];
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      const buf = [];
      while (++i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i]);
      out.push(B("code", buf.join("\n")));
      continue;
    }
    const t = line.trim();
    if (!t) continue;
    let m;
    const clean = (s) => s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1").replace(/`([^`]+)`/g, "$1");
    if ((m = t.match(/^(#{1,6})\s+(.*)$/))) out.push(B(m[1].length === 1 ? "h1" : m[1].length === 2 ? "h2" : "h3", clean(m[2])));
    else if ((m = t.match(/^[-*+]\s+\[([ xX])\]\s+(.*)$/))) out.push(B("todo", clean(m[2]), { checked: m[1] !== " " }));
    else if ((m = t.match(/^[-*+•]\s+(.*)$/))) out.push(B("ul", clean(m[1])));
    else if ((m = t.match(/^\d+[.)]\s+(.*)$/))) out.push(B("ol", clean(m[1])));
    else if ((m = t.match(/^>\s?(.*)$/))) out.push(B("quote", clean(m[1])));
    else if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) out.push(B("divider"));
    else out.push(B("p", clean(t)));
  }
  return out;
}

// ---------- Editor events ----------
const blocksEl = $("#blocks");

const SHORTCUTS = [
  [/^#\s$/, "h1"], [/^##\s$/, "h2"], [/^###\s$/, "h3"],
  [/^[-*]\s$/, "ul"], [/^1[.)]\s$/, "ol"], [/^\[\]\s$/, "todo"], [/^\[ \]\s$/, "todo"],
  [/^>\s$/, "quote"], [/^```$/, "code"], [/^---$/, "divider"],
];

blocksEl.addEventListener("input", (e) => {
  const c = e.target.closest(".content");
  if (!c) return;
  const id = c.closest(".block").dataset.id;
  const b = page().blocks[blockIndex(id)];
  b.text = readText(c);
  if (b.type === "p") {
    for (const [re, type] of SHORTCUTS) {
      if (re.test(b.text)) {
        b.text = "";
        closeMenus();
        setType(id, type);
        return;
      }
    }
  }
  if (b.text.startsWith("/") && b.type !== "code") openSlash(id, b.text.slice(1));
  else if (slash.open) closeMenus();
  touch();
});

blocksEl.addEventListener("keydown", (e) => {
  const c = e.target.closest(".content");
  const blockDiv = e.target.closest(".block");
  if (!blockDiv) return;
  const id = blockDiv.dataset.id;
  const blocks = page().blocks;
  const i = blockIndex(id);
  const b = blocks[i];

  if (slash.open && handleMenuKeys(e)) return;

  // Non-text blocks (divider / page link)
  if (!c || !c.isContentEditable) {
    if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      if (b.type === "link") return;
      removeBlock(id);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (b.type === "link") return openPage(b.pageId);
      focusBlock(insertBlockAfter(id, B("p")).id);
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      focusNeighbor(i, e.key === "ArrowUp" ? -1 : 1);
    }
    return;
  }

  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    if (b.type === "code" && !(e.ctrlKey || e.metaKey)) return; // newline inside code
    e.preventDefault();
    const text = readText(c);
    if (CONTINUE_TYPES.has(b.type) && !text) return setType(id, "p");
    const pos = isCollapsed() ? getCaret(c) : text.length;
    b.text = text.slice(0, pos);
    const nb = B(CONTINUE_TYPES.has(b.type) ? b.type : "p", text.slice(pos), b.type === "todo" ? { checked: false } : {});
    insertBlockAfter(id, nb);
    focusBlock(nb.id, 0);
    return;
  }

  if (e.key === "Backspace" && isCollapsed() && getCaret(c) === 0) {
    e.preventDefault();
    if (b.type !== "p") return setType(id, "p");
    const prev = blocks[i - 1];
    if (!prev) return;
    if (!TEXT_TYPES.has(prev.type)) {
      if (!b.text) return removeBlock(id);
      blocks.splice(i - 1, 1);
      touch();
      renderBlocks();
      return focusBlock(id, 0);
    }
    const join = prev.text.length;
    prev.text += b.text;
    blocks.splice(i, 1);
    touch();
    renderBlocks();
    focusBlock(prev.id, join);
    return;
  }

  if (e.key === "Delete" && isCollapsed() && getCaret(c) === c.textContent.length) {
    const next = blocks[i + 1];
    if (next && TEXT_TYPES.has(next.type)) {
      e.preventDefault();
      const pos = b.text.length;
      b.text += next.text;
      blocks.splice(i + 1, 1);
      touch();
      renderBlocks();
      focusBlock(id, pos);
    }
    return;
  }

  if (e.key === "ArrowUp" && getCaret(c) === 0) {
    e.preventDefault();
    if (i === 0) return setCaret($("#title"), $("#title").textContent.length);
    focusNeighbor(i, -1);
  } else if (e.key === "ArrowDown" && getCaret(c) === c.textContent.length) {
    e.preventDefault();
    focusNeighbor(i, 1);
  } else if (e.key === "Tab" && b.type === "code") {
    e.preventDefault();
    document.execCommand("insertText", false, "  ");
  } else if (e.key === "Escape") {
    c.blur();
  }
});

function focusNeighbor(i, dir) {
  const blocks = page().blocks;
  const t = blocks[i + dir];
  if (!t) return;
  if (TEXT_TYPES.has(t.type)) focusBlock(t.id, dir < 0 ? "end" : 0);
  else (t.type === "link" ? contentEl(t.id) : blockEl(t.id))?.focus();
}

blocksEl.addEventListener("paste", (e) => {
  const c = e.target.closest(".content");
  if (!c || !c.isContentEditable) return;
  const text = e.clipboardData.getData("text/plain");
  e.preventDefault();
  const id = c.closest(".block").dataset.id;
  const b = page().blocks[blockIndex(id)];
  if (!text.includes("\n") || b.type === "code") {
    document.execCommand("insertText", false, text);
    return;
  }
  const parsed = markdownToBlocks(text);
  if (!parsed.length) return;
  const blocks = page().blocks;
  const at = blockIndex(id);
  if (!b.text) blocks.splice(at, 1, ...parsed);
  else blocks.splice(at + 1, 0, ...parsed);
  touch();
  renderBlocks();
  focusBlock(parsed.at(-1).id);
});

blocksEl.addEventListener("click", (e) => {
  const blockDiv = e.target.closest(".block");
  if (!blockDiv) return;
  const id = blockDiv.dataset.id;
  const b = page().blocks[blockIndex(id)];
  if (e.target.classList.contains("todo-check")) {
    b.checked = e.target.checked;
    blockDiv.classList.toggle("done", b.checked);
    touch();
  } else if (e.target.closest(".handle .add")) {
    focusBlock(insertBlockAfter(id, B("p")).id);
  } else if (e.target.closest(".handle .drag")) {
    openBlockMenu(id, e.target.closest("button"));
  } else if (b.type === "link" && e.target.closest(".content")) {
    openPage(b.pageId);
  } else if (b.type === "divider") {
    blockDiv.focus();
  }
});

// Drag & drop reorder
let dragId = null;
blocksEl.addEventListener("dragstart", (e) => {
  const blockDiv = e.target.closest?.(".block");
  if (!blockDiv || !e.target.closest(".drag")) return;
  dragId = blockDiv.dataset.id;
  blockDiv.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", dragId);
  e.dataTransfer.setDragImage(blockDiv, 0, 0);
});
blocksEl.addEventListener("dragover", (e) => {
  if (!dragId) return;
  const t = e.target.closest(".block");
  if (!t) return;
  e.preventDefault();
  clearDrop();
  const r = t.getBoundingClientRect();
  t.classList.add(e.clientY > r.top + r.height / 2 ? "drop-after" : "drop-before");
});
blocksEl.addEventListener("drop", (e) => {
  if (!dragId) return;
  e.preventDefault();
  const t = e.target.closest(".block");
  const after = t?.classList.contains("drop-after");
  if (t) moveBlock(dragId, t.dataset.id, after);
  dragId = null;
  clearDrop();
});
blocksEl.addEventListener("dragend", () => {
  dragId = null;
  clearDrop();
  document.querySelectorAll(".dragging").forEach((x) => x.classList.remove("dragging"));
});
function clearDrop() {
  document.querySelectorAll(".drop-before,.drop-after").forEach((x) => x.classList.remove("drop-before", "drop-after"));
}

// Click empty area below → new / focus last block
$("#addHint").addEventListener("click", () => {
  const blocks = page().blocks;
  const last = blocks.at(-1);
  if (last && last.type === "p" && !last.text) return focusBlock(last.id);
  focusBlock(insertBlockAfter(last?.id, B("p")).id);
});

// Title
const titleEl = $("#title");
titleEl.addEventListener("input", () => {
  page().title = readText(titleEl).replace(/\n/g, " ");
  touch();
  renderTree();
  renderCrumbs();
  document.title = `${page().title || "ללא כותרת"} — דף`;
});
titleEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || (e.key === "ArrowDown" && getCaret(titleEl) === titleEl.textContent.length)) {
    e.preventDefault();
    const first = page().blocks[0];
    if (e.key === "Enter" && first && (first.text || first.type !== "p")) {
      const nb = B("p");
      page().blocks.unshift(nb);
      touch();
      renderBlocks();
      return focusBlock(nb.id, 0);
    }
    if (first) focusNeighbor(-1, 1);
  }
});

// Page icon
$("#pageIcon").addEventListener("click", (e) => {
  const m = $("#blockMenu");
  m.innerHTML = `<div class="m-label">בחר אייקון</div><div class="emoji-grid">${EMOJIS.map((x) => `<button data-e="${x}">${x}</button>`).join("")}</div>`;
  m.onclick = (ev) => {
    const btn = ev.target.closest("[data-e]");
    if (!btn) return;
    page().icon = btn.dataset.e;
    touch();
    closeMenus();
    render();
  };
  showMenu(m, e.currentTarget);
});

// ---------- Slash menu ----------
const slash = { open: false, blockId: null, items: [], sel: 0 };

function openSlash(blockId, query) {
  const q = query.trim().toLowerCase();
  slash.items = TYPES.filter((t) => !q || t.label.toLowerCase().includes(q) || t.keys.toLowerCase().includes(q));
  slash.blockId = blockId;
  slash.sel = Math.min(slash.sel, Math.max(0, slash.items.length - 1));
  if (!slash.open) slash.sel = 0;
  slash.open = true;
  const m = $("#slashMenu");
  m.innerHTML =
    `<div class="m-label">בלוקים</div>` +
    (slash.items.length
      ? slash.items.map((t, i) => `<button class="m-item${i === slash.sel ? " sel" : ""}" data-i="${i}"><span class="m-icon">${t.icon}</span><span class="m-text">${t.label}<small>${t.hint}</small></span></button>`).join("")
      : `<div class="m-empty">אין תוצאות</div>`);
  m.onmousedown = (ev) => {
    const btn = ev.target.closest("[data-i]");
    if (!btn) return;
    ev.preventDefault();
    chooseSlash(Number(btn.dataset.i));
  };
  showMenu(m, contentEl(blockId));
}
function chooseSlash(i) {
  const t = slash.items[i];
  const id = slash.blockId;
  closeMenus();
  if (!t) return;
  const b = page().blocks[blockIndex(id)];
  b.text = "";
  setType(id, t.type);
}
function handleMenuKeys(e) {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const n = slash.items.length || 1;
    slash.sel = (slash.sel + (e.key === "ArrowDown" ? 1 : -1) + n) % n;
    const b = page().blocks[blockIndex(slash.blockId)];
    openSlash(slash.blockId, b.text.slice(1));
    $("#slashMenu .m-item.sel")?.scrollIntoView({ block: "nearest" });
    return true;
  }
  if (e.key === "Enter" || e.key === "Tab") {
    e.preventDefault();
    if (slash.items.length) chooseSlash(slash.sel);
    else closeMenus();
    return true;
  }
  if (e.key === "Escape") {
    e.preventDefault();
    closeMenus();
    return true;
  }
  return false;
}

// ---------- Block menu (handle) ----------
function openBlockMenu(id, anchor) {
  const b = page().blocks[blockIndex(id)];
  const m = $("#blockMenu");
  const turnInto = TYPES.filter((t) => TEXT_TYPES.has(t.type) && t.type !== b.type && b.type !== "link" && b.type !== "divider");
  m.innerHTML =
    `<button class="m-item" data-a="dup"><span class="m-icon">⧉</span><span class="m-text">שכפל</span></button>` +
    (b.type === "link" ? `<button class="m-item" data-a="open"><span class="m-icon">↗</span><span class="m-text">פתח דף</span></button>` : "") +
    `<button class="m-item danger" data-a="del"><span class="m-icon">🗑</span><span class="m-text">מחק בלוק</span></button>` +
    (turnInto.length ? `<div class="m-label">הפוך ל…</div>` + turnInto.map((t) => `<button class="m-item" data-t="${t.type}"><span class="m-icon">${t.icon}</span><span class="m-text">${t.label}</span></button>`).join("") : "");
  m.onclick = (ev) => {
    const btn = ev.target.closest("button");
    if (!btn) return;
    closeMenus();
    if (btn.dataset.a === "dup") duplicateBlock(id);
    else if (btn.dataset.a === "open") openPage(b.pageId);
    else if (btn.dataset.a === "del") {
      if (b.type === "link" && state.pages[b.pageId] && confirm("למחוק גם את הדף המקושר?")) return deletePage(b.pageId);
      removeBlock(id);
    } else if (btn.dataset.t) setType(id, btn.dataset.t);
  };
  showMenu(m, anchor);
}

function showMenu(m, anchor) {
  for (const other of document.querySelectorAll(".menu")) if (other !== m) other.hidden = true;
  m.hidden = false;
  const r = anchor.getBoundingClientRect();
  const w = m.offsetWidth;
  const h = m.offsetHeight;
  let top = r.bottom + 4;
  if (top + h > innerHeight - 8) top = Math.max(8, r.top - h - 4);
  let left = Math.min(r.right - w, innerWidth - w - 8); // RTL: align to the right edge
  m.style.top = `${top}px`;
  m.style.left = `${Math.max(8, left)}px`;
}
function closeMenus() {
  slash.open = false;
  document.querySelectorAll(".menu").forEach((m) => (m.hidden = true));
}
document.addEventListener("mousedown", (e) => {
  if (!e.target.closest(".menu") && !e.target.closest(".handle") && !e.target.closest("#pageIcon")) closeMenus();
});
$("#scroller").addEventListener("scroll", () => {
  if (!slash.open) closeMenus();
});

// ---------- Sidebar ----------
$("#addRoot").onclick = () => openPage(createPage(null).id, true);
$("#search").addEventListener("input", renderTree);
$("#openSidebar").onclick = () => $("#sidebar").classList.add("open");
$("#closeSidebar").onclick = () => $("#sidebar").classList.remove("open");
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    $("#sidebar").classList.add("open");
    $("#search").focus();
    $("#search").select();
  }
});

$("#exportBtn").onclick = () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `daf-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$("#importFile").onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const s = JSON.parse(await f.text());
    if (!s.pages || !Array.isArray(s.root)) throw new Error("bad");
    if (!confirm("הייבוא יחליף את כל הדפים הנוכחיים. להמשיך?")) return;
    state = s;
    if (!state.expanded) state.expanded = {};
    save();
    render();
  } catch {
    alert("קובץ הגיבוי לא תקין");
  } finally {
    e.target.value = "";
  }
};

function applyTheme(t) {
  if (t) document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
try { applyTheme(localStorage.getItem(THEME_KEY)); } catch {}
$("#themeBtn").onclick = () => {
  const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  const next = dark ? "light" : "dark";
  applyTheme(next);
  try { localStorage.setItem(THEME_KEY, next); } catch {}
};

// ---------- AI ----------
const SYSTEM_PROMPT =
  "אתה עוזר כתיבה בתוך אפליקציית מחברת בעברית. ענה בעברית אלא אם התבקשת אחרת. " +
  "כתוב בפורמט Markdown פשוט בלבד: כותרות (#), רשימות (- או 1.), משימות (- [ ]), ציטוטים (>) ובלוקי קוד. בלי טבלאות ובלי HTML. " +
  "החזר רק את התוכן עצמו, בלי הקדמות כמו 'הנה'.";

const ACTIONS = {
  summarize: "סכם את הדף בקצרה: משפט פתיחה ואז 3–6 נקודות עיקריות.",
  continue: "המשך לכתוב את הדף באותו סגנון ובאותו נושא. החזר רק את ההמשך.",
  improve: "שכתב את כל תוכן הדף בעברית ברורה וזורמת יותר, שמור על המבנה והמשמעות.",
  todos: "חלץ מהדף את כל המשימות ופעולות ההמשך כרשימת משימות (- [ ]).",
  ideas: "תן 5–8 רעיונות חדשים ומעשיים שקשורים לנושא הדף, כרשימת תבליטים.",
  translate: "Translate the full page content to English. Keep the same structure. Output only the translation.",
};

let lastAI = { text: "", action: null };

function openAI() {
  const panel = $("#aiPanel");
  panel.classList.add("open");
  panel.setAttribute("aria-hidden", "false");
  updateModelLabel();
  $("#aiPrompt").focus();
}
$("#openAI").onclick = () => ($("#aiPanel").classList.contains("open") ? closeAI() : openAI());
$("#closeAI").onclick = closeAI;
function closeAI() {
  $("#aiPanel").classList.remove("open");
  $("#aiPanel").setAttribute("aria-hidden", "true");
}
function updateModelLabel() {
  const label = settings.model || (serverConfig.model ? `${serverConfig.model} (שרת)` : "לא הוגדר מודל");
  $("#aiModel").textContent = label;
  $("#aiModel").title = `${settings.baseUrl || serverConfig.baseUrl || ""}`;
}

async function callAI(messages) {
  const r = await fetch("/api/ai", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: { kind: settings.kind, baseUrl: settings.baseUrl, model: settings.model, apiKey: settings.apiKey }, messages }),
  });
  let j;
  try {
    j = await r.json();
  } catch {
    throw new Error(`השרת החזיר ${r.status}. האם הפעלת את האפליקציה עם npm start?`);
  }
  if (!r.ok) throw new Error(j.error || `שגיאה ${r.status}`);
  return j.text;
}

async function runAI(action) {
  const prompt = $("#aiPrompt").value.trim();
  const instruction = action ? ACTIONS[action] : prompt;
  if (!instruction) return $("#aiPrompt").focus();
  const p = page();
  const usePage = action ? true : $("#aiUsePage").checked;
  const doc = blocksToMarkdown(p.blocks).slice(0, 16000);
  const user = usePage ? `כותרת הדף: ${p.title || "ללא כותרת"}\n\nתוכן הדף:\n"""\n${doc}\n"""\n\nהבקשה: ${instruction}` : instruction;
  const out = $("#aiResult");
  const send = $("#aiSend");
  out.className = "ai-result loading";
  out.textContent = "חושב…";
  $("#aiResultActions").hidden = true;
  send.disabled = true;
  document.querySelectorAll(".ai-actions button").forEach((b) => (b.disabled = true));
  try {
    const text = (await callAI([{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: user }])).trim();
    lastAI = { text, action };
    out.className = "ai-result";
    out.textContent = text || "(תשובה ריקה)";
    $("#aiResultActions").hidden = !text;
  } catch (err) {
    out.className = "ai-result error";
    out.textContent = `⚠️ ${err.message}\n\nבדוק את ⚙️ הגדרות מודל AI.`;
  } finally {
    send.disabled = false;
    document.querySelectorAll(".ai-actions button").forEach((b) => (b.disabled = false));
  }
}
$("#aiSend").onclick = () => runAI(null);
$("#aiPrompt").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    runAI(null);
  }
});
document.querySelector(".ai-actions").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-act]");
  if (btn) runAI(btn.dataset.act);
});

function focusedBlockId() {
  const a = document.activeElement?.closest?.(".block");
  return a?.dataset.id || null;
}
let lastFocusedBlock = null;
blocksEl.addEventListener("focusin", (e) => {
  lastFocusedBlock = e.target.closest(".block")?.dataset.id || null;
});

$("#aiInsert").onclick = () => {
  const blocks = markdownToBlocks(lastAI.text);
  if (!blocks.length) return;
  const p = page();
  const anchorId = focusedBlockId() || lastFocusedBlock;
  let at = anchorId && blockIndex(anchorId) >= 0 ? blockIndex(anchorId) + 1 : p.blocks.length;
  const anchor = p.blocks[at - 1];
  if (anchor && anchor.type === "p" && !anchor.text) at -= 1, p.blocks.splice(at, 1);
  p.blocks.splice(at, 0, ...blocks);
  touch();
  renderBlocks();
  blockEl(blocks.at(-1).id)?.scrollIntoView({ block: "nearest" });
  setStatus("התוכן נוסף לדף");
};
$("#aiReplace").onclick = () => {
  const blocks = markdownToBlocks(lastAI.text);
  if (!blocks.length || !confirm("להחליף את כל תוכן הדף בתשובה?")) return;
  const links = page().blocks.filter((b) => b.type === "link");
  page().blocks = [...blocks, ...links];
  touch();
  renderBlocks();
};
$("#aiCopy").onclick = async () => {
  try {
    await navigator.clipboard.writeText(lastAI.text);
    setStatus("הועתק");
  } catch {
    setStatus("ההעתקה נכשלה");
  }
};

// ---------- Settings ----------
const dlg = $("#settings");
const sPreset = $("#sPreset");
sPreset.innerHTML = PRESETS.map((p) => `<option value="${p.id}">${p.name}</option>`).join("");
function fillSettings(s) {
  sPreset.value = s.preset || "custom";
  $("#sKind").value = s.kind || "openai";
  $("#sBaseUrl").value = s.baseUrl || "";
  $("#sModel").value = s.model || "";
  $("#sApiKey").value = s.apiKey || "";
  const note = PRESETS.find((p) => p.id === sPreset.value)?.note || "";
  $("#sPresetNote").textContent =
    serverConfig.publicMode && LOCAL_PRESETS.has(sPreset.value) ? "⚠️ מודל מקומי עובד רק כשמריצים את האפליקציה על המחשב שלך (npm start). בגרסה המפורסמת בחר ספק ענן, למשל OpenRouter עם מודל :free." : note;
  $("#sServerNote").textContent = serverConfig.hasServerKey ? "🔐 בשרת מוגדר מפתח (AI_API_KEY) — אפשר להשאיר את שדה המפתח ריק." : "";
  $("#sTestResult").textContent = "";
}
function readSettingsForm() {
  return { preset: sPreset.value, kind: $("#sKind").value, baseUrl: $("#sBaseUrl").value.trim(), model: $("#sModel").value.trim(), apiKey: $("#sApiKey").value.trim() };
}
sPreset.onchange = () => {
  const p = PRESETS.find((x) => x.id === sPreset.value);
  if (!p) return;
  const keepKey = $("#sApiKey").value;
  fillSettings({ preset: p.id, kind: p.kind, baseUrl: p.baseUrl, model: p.model, apiKey: p.id === settings.preset ? keepKey : "" });
};
$("#openSettings").onclick = () => {
  fillSettings(settings);
  dlg.showModal();
};
$("#sTest").onclick = async () => {
  const prev = settings;
  settings = readSettingsForm();
  const res = $("#sTestResult");
  res.textContent = "בודק…";
  try {
    const t = await callAI([{ role: "user", content: "ענה במילה אחת בלבד: שלום" }]);
    res.textContent = `✅ עובד! תשובה: ${t.trim().slice(0, 60)}`;
  } catch (err) {
    res.textContent = `❌ ${err.message}`;
  } finally {
    settings = prev;
  }
};
dlg.addEventListener("close", () => {
  if (dlg.returnValue === "save") {
    settings = readSettingsForm();
    saveSettings();
  }
});

// ---------- Boot ----------
fetch("/api/config")
  .then((r) => (r.ok ? r.json() : null))
  .then((c) => {
    if (c) serverConfig = c;
    // בגרסה המפורסמת אין גישה למודל מקומי — ברירת המחדל עוברת ל-OpenRouter (מודלים חינמיים).
    if (serverConfig.publicMode && settings.isDefault) settings = presetSettings(PRESETS.find((p) => p.id === "openrouter"), true);
    updateModelLabel();
  })
  .catch(() => {});

addEventListener("storage", (e) => {
  if (e.key === STORE_KEY && e.newValue) {
    try {
      state = JSON.parse(e.newValue);
      render();
    } catch {}
  }
});

render();
updateModelLabel();
