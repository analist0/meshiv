// ============================================================
// engine.js — מנוע המענה האוטומטי. טהור: בלי WhatsApp ובלי קבצים,
// כך שאפשר לבדוק אותו בסימולטור ובבדיקות.
//
// handle(message) מחזיר החלטה: { replies, reason, ruleId, delayMs }
// ============================================================

// ברירות המחדל נמצאות בקובץ JSON משותף לשרת ולאפליקציית האנדרואיד
import DEFAULT_CONFIG from "./default-config.json" with { type: "json" };
export { DEFAULT_CONFIG };

// משלים שדות חסרים מברירת המחדל (הגדרות ישנות / קובץ מיובא)
export function withDefaults(cfg) {
  const d = structuredClone(DEFAULT_CONFIG);
  if (!cfg || typeof cfg !== "object") return d;
  const out = { ...d, ...cfg };
  for (const k of ["delay", "welcome", "businessHours", "menu", "ai"]) out[k] = { ...d[k], ...(cfg[k] || {}) };
  if (!Array.isArray(out.rules)) out.rules = d.rules;
  return out;
}

// מחזיר הודעת שגיאה בעברית, או null אם ההגדרות תקינות
export function configError(c) {
  if (!c || typeof c !== "object" || Array.isArray(c)) return "הגדרות לא תקינות";
  if (c.rules !== undefined && !Array.isArray(c.rules)) return "rules חייב להיות רשימה";
  for (const r of c.rules || []) {
    if (!r || typeof r !== "object" || !r.id) return "לכל חוק חייב להיות id";
    if (r.match !== "regex") continue;
    for (const k of r.keywords || []) {
      try {
        new RegExp(k, "iu");
      } catch {
        return `ביטוי רגולרי לא תקין בחוק "${r.name || r.id}": ${k}`;
      }
    }
  }
  return null;
}

const DAY_NAMES = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

// ---------- Text helpers ----------
const FINALS = { ך: "כ", ם: "מ", ן: "נ", ף: "פ", ץ: "צ" };
export function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[֑-ׇ]/g, "") // ניקוד וטעמים
    .replace(/[̀-ͯ]/g, "")
    .replace(/[ךםןףץ]/g, (c) => FINALS[c])
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}
export function similarity(a, b) {
  const max = Math.max(a.length, b.length);
  return max ? 1 - levenshtein(a, b) / max : 1;
}

// התאמה מקורבת: משווה את מילת המפתח לכל רצף מילים באורך דומה בהודעה
function fuzzyContains(text, keyword, threshold) {
  if (!keyword) return false;
  if (` ${text} `.includes(` ${keyword} `)) return true;
  const words = text.split(" ");
  const n = keyword.split(" ").length;
  for (let i = 0; i + n <= words.length; i++) {
    if (similarity(words.slice(i, i + n).join(" "), keyword) >= threshold) return true;
  }
  return false;
}

export function matchRule(rule, body) {
  const text = normalize(body);
  const keywords = (rule.keywords || []).map((k) => String(k));
  switch (rule.match) {
    case "any":
      return true;
    case "exact":
      return keywords.some((k) => normalize(k) === text);
    case "startsWith":
      return keywords.some((k) => normalize(k) && text.startsWith(normalize(k)));
    case "endsWith":
      return keywords.some((k) => normalize(k) && text.endsWith(normalize(k)));
    case "regex":
      return keywords.some((k) => {
        try {
          return new RegExp(k, "iu").test(String(body || ""));
        } catch {
          return false;
        }
      });
    case "fuzzy":
      return keywords.some((k) => fuzzyContains(text, normalize(k), rule.fuzzyThreshold ?? 0.8));
    case "contains":
    default:
      return keywords.some((k) => {
        const nk = normalize(k);
        if (!nk) return false;
        // מילים קצרות (עד 2 אותיות) — רק כמילה שלמה; ארוכות — גם עם תחילית (והמחיר, במחיר)
        return ` ${text} `.includes(` ${nk} `) || (nk.length > 2 && text.includes(nk));
      });
  }
}

// ---------- Time helpers ----------
export function localParts(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  const hour = Number(parts.hour) % 24;
  return { day, hour, minute: Number(parts.minute), dateKey: `${parts.year}-${parts.month}-${parts.day}`, date: `${parts.day}/${parts.month}/${parts.year}`, time: `${String(hour).padStart(2, "0")}:${parts.minute}` };
}
const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm || "0:0").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};
export function inWindow(win, parts) {
  if (!win) return true;
  const days = Array.isArray(win.days) && win.days.length ? win.days : [0, 1, 2, 3, 4, 5, 6];
  const now = parts.hour * 60 + parts.minute;
  const from = toMinutes(win.from ?? "00:00");
  const to = toMinutes(win.to ?? "24:00");
  if (from === to) return days.includes(parts.day);
  if (from < to) return days.includes(parts.day) && now >= from && now < to;
  // חלון שחוצה חצות (למשל 22:00–02:00): אחרי חצות שייך ליום הקודם
  if (now >= from) return days.includes(parts.day);
  if (now < to) return days.includes((parts.day + 6) % 7);
  return false;
}
function greeting(hour) {
  if (hour >= 5 && hour < 12) return "בוקר טוב";
  if (hour >= 12 && hour < 17) return "צהריים טובים";
  if (hour >= 17 && hour < 21) return "ערב טוב";
  return "לילה טוב";
}

export function fillTemplate(text, msg, parts) {
  const vars = {
    name: msg.name || "",
    phone: String(msg.from || "").replace(/@.*$/, ""),
    date: parts.date,
    time: parts.time,
    day: DAY_NAMES[parts.day] || "",
    greeting: greeting(parts.hour),
    message: msg.body || "",
  };
  return String(text || "")
    .replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m))
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ ([!?.,])/g, "$1")
    .trim();
}

// ---------- Engine ----------
export function createEngine({ getConfig, state, ai = null, now = () => new Date(), random = Math.random }) {
  state.contacts ??= {};
  state.stats ??= { incoming: 0, replied: 0, ai: 0, byRule: {}, byDay: {} };
  state.rr ??= {}; // round-robin index per rule

  const contact = (id) => (state.contacts[id] ??= { firstSeen: null, lastWelcome: 0, lastAway: 0, ruleHits: {}, day: { key: "", n: 0 }, pausedUntil: 0, menu: null, history: [] });
  const phoneOf = (id) => String(id || "").replace(/@.*$/, "").replace(/\D/g, "");
  const listHas = (list, id) => (list || []).some((n) => phoneOf(n) && phoneOf(n) === phoneOf(id));

  function pickReply(rule) {
    const replies = (rule.replies || []).filter((r) => String(r).trim());
    if (!replies.length) return null;
    if (rule.replyMode === "sequence") {
      const i = state.rr[rule.id] ?? 0;
      state.rr[rule.id] = (i + 1) % replies.length;
      return replies[i % replies.length];
    }
    if (rule.replyMode === "all") return replies;
    return replies[Math.floor(random() * replies.length)];
  }

  function remember(c, role, content, cfg) {
    const max = Math.max(0, Number(cfg.ai?.memoryMessages ?? 10));
    if (!max) return;
    c.history.push({ role, content: String(content).slice(0, 2000) });
    if (c.history.length > max) c.history.splice(0, c.history.length - max);
  }

  function menuText(node) {
    const lines = [node.title || "בחר:"];
    (node.items || []).forEach((it, i) => lines.push(`${i + 1}. ${it.label}`));
    lines.push("", "0. חזרה לתפריט הראשי");
    return lines.join("\n");
  }
  function menuNode(menu, path) {
    let node = menu;
    for (const i of path) node = node?.items?.[i];
    return node;
  }

  function handleMenu(cfg, c, msg, parts) {
    const menu = cfg.menu;
    if (!menu?.enabled || !(menu.items || []).length) return null;
    const text = normalize(msg.body);
    const triggers = (menu.triggers || []).map(normalize);
    const t = parts.ts;
    const active = c.menu && t - c.menu.ts < (menu.timeoutMinutes ?? 15) * 60000;
    if (triggers.includes(text) && (text !== "0" || active || triggers.length === 1)) {
      c.menu = { path: [], ts: t };
      return { replies: [menuText(menu)], reason: "menu" };
    }
    if (!active) {
      c.menu = null;
      return null;
    }
    const n = Number(text);
    if (!Number.isInteger(n) || String(n) !== text) return null; // לא בחירה — ממשיכים לחוקים
    if (n === 0) {
      c.menu = { path: [], ts: t };
      return { replies: [menuText(menu)], reason: "menu" };
    }
    const node = menuNode(menu, c.menu.path);
    const item = node?.items?.[n - 1];
    if (!item) return { replies: [`אין אפשרות ${n}.\n\n${menuText(node)}`], reason: "menu" };
    if (item.items?.length) {
      c.menu = { path: [...c.menu.path, n - 1], ts: t };
      return { replies: [menuText(item)], reason: "menu" };
    }
    c.menu = null;
    if (item.pauseBotMinutes) c.pausedUntil = t + item.pauseBotMinutes * 60000;
    return { replies: [item.reply || ""], reason: "menu" };
  }

  async function handle(msg) {
    const cfg = getConfig();
    const date = now();
    const parts = { ...localParts(date, cfg.timezone || "Asia/Jerusalem"), ts: date.getTime() };
    const id = msg.chatId || msg.from;
    const c = contact(id);
    const fill = (r) => fillTemplate(r, msg, parts);
    const decision = (reason, replies = [], extra = {}) => ({ reason, replies: replies.filter((r) => String(r || "").trim()), ...extra });

    // --- הודעות שלך (מהטלפון) ---
    if (msg.fromMe) {
      const body = normalize(msg.body);
      if (cfg.ownerCommands && ["עצור", "stop"].map(normalize).includes(body)) {
        c.pausedUntil = parts.ts + 365 * 86400000;
        return decision("owner-stop");
      }
      if (cfg.ownerCommands && ["המשך", "start"].map(normalize).includes(body)) {
        c.pausedUntil = 0;
        return decision("owner-start");
      }
      if (!msg.isBot && cfg.humanTakeoverMinutes > 0) c.pausedUntil = Math.max(c.pausedUntil, parts.ts + cfg.humanTakeoverMinutes * 60000);
      return decision("from-me");
    }

    state.stats.incoming++;
    if (!cfg.enabled) return decision("disabled");
    if (msg.isStatus || msg.isBroadcast) return decision("status");
    if (msg.isGroup ? !cfg.replyToGroups : !cfg.replyToPrivate) return decision(msg.isGroup ? "group-off" : "private-off");
    if (listHas(cfg.ignoreContacts, msg.from)) return decision("ignored-contact");
    if ((cfg.onlyContacts || []).length && !listHas(cfg.onlyContacts, msg.from)) return decision("not-in-only-list");
    if (c.pausedUntil > parts.ts) return decision("paused");

    if (c.day.key !== parts.dateKey) c.day = { key: parts.dateKey, n: 0 };
    if (cfg.dailyLimitPerContact > 0 && c.day.n >= cfg.dailyLimitPerContact) return decision("daily-limit");

    remember(c, "user", msg.body || "", cfg);
    const out = [];
    let reason = "no-match";
    let ruleId = null;
    let stop = false;

    // 1. ברוך הבא — פנייה ראשונה (או אחרי X ימים)
    const isNew = !c.firstSeen;
    if (isNew) c.firstSeen = parts.ts;
    const w = cfg.welcome;
    if (w?.enabled && (isNew || (w.everyDays > 0 && parts.ts - c.lastWelcome >= w.everyDays * 86400000))) {
      c.lastWelcome = parts.ts;
      out.push(fill(w.text));
      reason = "welcome";
    }

    // 2. מחוץ לשעות הפעילות
    const bh = cfg.businessHours;
    if (bh?.enabled && !inWindow(bh, parts)) {
      if (parts.ts - c.lastAway >= (bh.awayCooldownMinutes ?? 180) * 60000) {
        c.lastAway = parts.ts;
        out.push(fill(bh.awayText));
        reason = "away";
      }
      if (bh.stopAfterAway) stop = true;
    }

    // 3. תפריט
    if (!stop) {
      const m = handleMenu(cfg, c, msg, parts);
      if (m) {
        out.push(...m.replies.map(fill));
        reason = m.reason;
        stop = true;
      }
    }

    // 4. חוקים לפי הסדר
    let matchedRule = false;
    if (!stop && !(cfg.ai?.enabled && cfg.ai.mode === "always")) {
      for (const rule of cfg.rules || []) {
        if (!rule.enabled) continue;
        if (rule.scope === "private" && msg.isGroup) continue;
        if (rule.scope === "groups" && !msg.isGroup) continue;
        if (rule.schedule && !inWindow(rule.schedule, parts)) continue;
        if (!matchRule(rule, msg.body)) continue;
        const last = c.ruleHits[rule.id] || 0;
        if (rule.cooldownMinutes > 0 && parts.ts - last < rule.cooldownMinutes * 60000) {
          matchedRule = true; // התאים אבל בהשהיה — לא נופלים ל-AI
          if (!rule.continue) break;
          continue;
        }
        c.ruleHits[rule.id] = parts.ts;
        state.stats.byRule[rule.id] = (state.stats.byRule[rule.id] || 0) + 1;
        matchedRule = true;
        ruleId = rule.id;
        reason = "rule";
        if (rule.action === "ai") {
          matchedRule = false; // החוק מפנה ל-AI
          break;
        }
        const r = pickReply(rule);
        if (Array.isArray(r)) out.push(...r.map(fill));
        else if (r) out.push(fill(r));
        if (rule.pauseBotMinutes) c.pausedUntil = parts.ts + rule.pauseBotMinutes * 60000;
        if (!rule.continue) break;
      }
    }

    // 5. AI
    if (!stop && !matchedRule && cfg.ai?.enabled && ai && String(msg.body || "").trim()) {
      try {
        const system = [cfg.ai.persona, cfg.ai.knowledge ? `מידע על העסק (השתמש בו בלבד, אל תמציא):\n${cfg.ai.knowledge}` : "", `שם הלקוח: ${msg.name || "לא ידוע"}. היום יום ${DAY_NAMES[parts.day]}, ${parts.date} ${parts.time}.`]
          .filter(Boolean)
          .join("\n\n");
        const text = await ai({ ...cfg.ai }, [{ role: "system", content: system }, ...c.history]);
        const clean = String(text || "").trim().slice(0, cfg.ai.maxReplyChars || 800);
        if (clean) {
          out.push(clean.replace(/\{/g, "{​")); // לא להחליף משתנים בתוך תשובת AI
          state.stats.ai++;
          reason = reason === "welcome" ? "welcome+ai" : "ai";
        }
      } catch (err) {
        return finish(decision(reason === "welcome" ? "welcome" : "ai-error", out, { ruleId, error: String(err.message || err) }));
      }
    }

    return finish(decision(reason, out, { ruleId }));

    function finish(d) {
      d.replies = d.replies.map((r) => r.replace(/\{​/g, "{"));
      if (d.replies.length) {
        c.day.n++;
        state.stats.replied++;
        state.stats.byDay[parts.dateKey] = (state.stats.byDay[parts.dateKey] || 0) + 1;
        for (const r of d.replies) remember(c, "assistant", r, cfg);
        const min = Math.max(0, Number(cfg.delay?.minSec ?? 0));
        const max = Math.max(min, Number(cfg.delay?.maxSec ?? min));
        d.delayMs = Math.round((min + random() * (max - min)) * 1000);
      } else d.delayMs = 0;
      return d;
    }
  }

  return { handle, contact };
}
