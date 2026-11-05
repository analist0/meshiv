import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_CONFIG, createEngine, inWindow, localParts, matchRule, normalize } from "../src/engine.js";

// יום שלישי 14:00 שעון ישראל
const TUE_14 = new Date("2026-11-03T12:00:00Z");

function setup(patch = {}, { at = TUE_14, ai = null } = {}) {
  const config = { ...structuredClone(DEFAULT_CONFIG), delay: { minSec: 0, maxSec: 0 }, ...patch };
  let now = at;
  const state = {};
  const engine = createEngine({ getConfig: () => config, state, ai, now: () => now, random: () => 0 });
  const send = (body, extra = {}) => engine.handle({ chatId: "972501234567@c.us", from: "972501234567@c.us", name: "דנה", body, isGroup: false, fromMe: false, ...extra });
  return { config, state, engine, send, advance: (ms) => (now = new Date(now.getTime() + ms)) };
}

test("normalize: ניקוד, אותיות סופיות וסימנים", () => {
  assert.equal(normalize("שָׁלוֹם!!"), "שלומ");
  assert.equal(normalize("  כמה   עולה?"), "כמה עולה");
});

test("matchRule: סוגי התאמה", () => {
  assert.ok(matchRule({ match: "exact", keywords: ["שלום"] }, "שלום!"));
  assert.ok(!matchRule({ match: "exact", keywords: ["שלום"] }, "שלום לך"));
  assert.ok(matchRule({ match: "contains", keywords: ["מחיר"] }, "מה המחיר בבקשה"));
  assert.ok(matchRule({ match: "startsWith", keywords: ["הזמנה"] }, "הזמנה מספר 5"));
  assert.ok(matchRule({ match: "regex", keywords: ["^\\d{4}$"] }, "1234"));
  assert.ok(!matchRule({ match: "regex", keywords: ["(("] }, "x"), "regex שבור לא מפיל");
  assert.ok(matchRule({ match: "fuzzy", keywords: ["שלום"], fuzzyThreshold: 0.75 }, "שלוםם מה קורה"));
  assert.ok(matchRule({ match: "any", keywords: [] }, "כל דבר"));
});

test("inWindow: שעות פעילות כולל חצות", () => {
  const p = localParts(TUE_14, "Asia/Jerusalem");
  assert.equal(p.day, 2);
  assert.equal(p.hour, 14);
  assert.ok(inWindow({ days: [2], from: "09:00", to: "18:00" }, p));
  assert.ok(!inWindow({ days: [3], from: "09:00", to: "18:00" }, p));
  const night = localParts(new Date("2026-11-03T23:30:00Z"), "Asia/Jerusalem"); // רביעי 01:30
  assert.ok(inWindow({ days: [2], from: "22:00", to: "02:00" }, night), "שייך ליום שלישי");
});

test("ברוך הבא + חוק בהודעה הראשונה, ובשנייה רק חוק", async () => {
  const { send } = setup();
  const d1 = await send("מה המחיר?");
  assert.equal(d1.replies.length, 2);
  assert.match(d1.replies[0], /צהריים טובים דנה/);
  assert.match(d1.replies[1], /מחירון/);
  const d2 = await send("והמחיר למשלוח?");
  assert.deepEqual(d2.replies.length, 1);
  assert.equal(d2.reason, "rule");
});

test("השהיית חוק (cooldown) לכל איש קשר", async () => {
  const { send, advance } = setup({ welcome: { enabled: false } });
  assert.equal((await send("היי")).replies.length, 1);
  assert.equal((await send("היי")).replies.length, 0);
  advance(61 * 60000);
  assert.equal((await send("היי")).replies.length, 1);
});

test("תפריט: כניסה, תת-תפריט, חזרה ובחירה", async () => {
  const { send } = setup({ welcome: { enabled: false } });
  const m = await send("תפריט");
  assert.match(m.replies[0], /1\. שעות פעילות/);
  const sub = await send("3");
  assert.match(sub.replies[0], /בחר שירות/);
  const pick = await send("2");
  assert.match(pick.replies[0], /תאר את התקלה/);
  const after = await send("2");
  assert.notEqual(after.reason, "menu", "אחרי בחירה סופית התפריט נסגר");
});

test("נציג אנושי מהתפריט משתיק את הבוט", async () => {
  const { send, advance } = setup({ welcome: { enabled: false } });
  await send("תפריט");
  await send("4");
  assert.equal((await send("היי")).reason, "paused");
  advance(121 * 60000);
  assert.equal((await send("היי")).reason, "rule");
});

test("מחוץ לשעות פעילות: הודעת לא זמין פעם אחת", async () => {
  const { send } = setup({ welcome: { enabled: false }, businessHours: { ...DEFAULT_CONFIG.businessHours, enabled: true, days: [0], from: "09:00", to: "18:00" } });
  const d = await send("היי");
  assert.equal(d.reason, "away");
  assert.equal(d.replies.length, 1);
  assert.equal((await send("היי")).replies.length, 0);
});

test("מענה ידני שלך משתיק את הבוט; !המשך מחזיר", async () => {
  const { send, engine } = setup({ welcome: { enabled: false } });
  await send("אני כאן", { fromMe: true });
  assert.equal((await send("היי")).reason, "paused");
  await send("!המשך", { fromMe: true });
  assert.equal((await send("היי")).reason, "rule");
  assert.ok(engine.contact("972501234567@c.us"));
});

test("קבוצות, רשימה שחורה ומגבלה יומית", async () => {
  const { send, config } = setup({ welcome: { enabled: false }, dailyLimitPerContact: 1 });
  assert.equal((await send("היי", { isGroup: true, chatId: "1@g.us" })).reason, "group-off");
  assert.equal((await send("מחיר")).reason, "rule");
  assert.equal((await send("מחיר")).reason, "daily-limit");
  config.ignoreContacts = ["+972-50-123-4567"];
  assert.equal((await send("מחיר")).reason, "ignored-contact");
});

test("AI כגיבוי עם זיכרון שיחה ומידע עסקי", async () => {
  const calls = [];
  const ai = async (p, messages) => {
    calls.push(messages);
    return "תשובה מה-AI {name}";
  };
  const { send } = setup({ welcome: { enabled: false }, ai: { ...DEFAULT_CONFIG.ai, enabled: true, knowledge: "פתוחים עד 20:00" } }, { ai });
  const d = await send("עד מתי אתם פתוחים?");
  assert.equal(d.reason, "ai");
  assert.equal(d.replies[0], "תשובה מה-AI {name}", "משתנים לא מוחלפים בתשובת AI");
  assert.match(calls[0][0].content, /פתוחים עד 20:00/);
  await send("ומחר?");
  const hist = calls[1].slice(1).map((m) => m.role);
  assert.deepEqual(hist, ["user", "assistant", "user"]);
  assert.equal((await send("מחיר")).reason, "rule", "חוק קודם ל-AI");
});

test("שגיאת AI לא מפילה ומחזירה סיבה", async () => {
  const { send } = setup({ welcome: { enabled: false }, ai: { ...DEFAULT_CONFIG.ai, enabled: true } }, { ai: async () => { throw new Error("boom"); } });
  const d = await send("שאלה כלשהי");
  assert.equal(d.reason, "ai-error");
  assert.equal(d.error, "boom");
  assert.equal(d.replies.length, 0);
});

test("normalizeMessage: מבנה הודעה של open-wa v5", async () => {
  const { normalizeMessage } = await import("../src/whatsapp.js");
  const group = normalizeMessage({ id: { _serialized: "false_1@g.us_ABC" }, chatId: "1@g.us", from: "1@g.us", author: "972501111111@c.us", sender: { pushname: "רון" }, body: "שלום", type: "chat", isGroupMsg: true, fromMe: false });
  assert.deepEqual(
    { id: group.id, chatId: group.chatId, from: group.from, name: group.name, isGroup: group.isGroup },
    { id: "false_1@g.us_ABC", chatId: "1@g.us", from: "972501111111@c.us", name: "רון", isGroup: true },
  );
  const mine = normalizeMessage({ id: "x", from: "me@c.us", to: "972502222222@c.us", body: "אני כאן", type: "chat", fromMe: true });
  assert.equal(mine.chatId, "972502222222@c.us");
  const image = normalizeMessage({ id: "y", from: "972503333333@c.us", type: "image", caption: "תמונה", body: "base64...", fromMe: false });
  assert.equal(image.body, "תמונה");
  assert.ok(normalizeMessage({ id: "z", from: "status@broadcast", type: "chat", body: "" }).isStatus);
});
