// ============================================================
// whatsapp.js — חיבור ל-WhatsApp דרך open-wa (@open-wa/wa-automate).
// open-wa מפעיל את WhatsApp Web בדפדפן Chrome ברקע.
// שים לב: זה חיבור לא רשמי; WhatsApp עלולה לחסום מספרים שמשתמשים באוטומציה.
// ============================================================

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function normalizeMessage(m) {
  const fromMe = Boolean(m.fromMe);
  const chatId = m.chatId || m.chat?.id || (fromMe ? m.to : m.from);
  // v5: id יכול להיות מחרוזת או אובייקט עם _serialized
  const isText = m.type === "chat" || m.type === "text" || !m.type;
  return {
    id: m.id?._serialized || m.id,
    chatId,
    from: m.author || m.sender?.id || m.from,
    name: m.sender?.pushname || m.sender?.formattedName || m.notifyName || m.sender?.name || "",
    body: isText ? String(m.body || "") : String(m.caption || ""),
    type: m.type || "chat",
    isGroup: Boolean(m.isGroupMsg),
    fromMe,
    isStatus: m.from === "status@broadcast" || chatId === "status@broadcast",
    isBroadcast: String(chatId || "").endsWith("@broadcast"),
  };
}

export async function startWhatsApp({ sessionDir, onQr, onState, onMessage, log }) {
  let wa;
  try {
    wa = await import("@open-wa/wa-automate");
  } catch {
    throw new Error("open-wa לא מותקן. הרץ: npm install (בתיקיית meshiv)");
  }
  const lib = wa.create ? wa : wa.default;

  // open-wa v5 מעביר את קוד ה-QR (טקסט) ואת שלבי ההפעלה דרך "output sink"
  lib.setCliOutputSink?.({
    write: (e) => e.level !== "debug" && log(`open-wa: ${e.message}`),
    status: (u) => u.detail && log(`open-wa: ${u.detail}`),
    qr: (p) => onQr(String(p.qr)),
  });

  onState("STARTING");
  const client = await lib.create({
    sessionId: "meshiv",
    sessionDataPath: sessionDir,
    multiDevice: true,
    headless: true,
    qrTimeout: 0,
    authTimeout: 0,
    useChrome: !process.env.CHROME_PATH,
    executablePath: process.env.CHROME_PATH || undefined,
    disableSpins: true,
    logConsole: false,
    popup: false,
    killProcessOnBrowserClose: true,
    licenseKey: process.env.OPENWA_LICENSE_KEY || undefined,
    // Chrome לא עולה כ-root עם sandbox (שרתים/דוקר). במחשב רגיל זה לא נדרש.
    ...(process.getuid?.() === 0 || process.env.MESHIV_NO_SANDBOX === "1" ? { chromiumArgs: ["--no-sandbox"], allowDangerousBrowserArgs: true } : {}),
  });
  onState("CONNECTED");
  onQr(null);

  // הודעות שהבוט עצמו שלח — כדי לא לזהות אותן כ"מענה ידני"
  const recentBot = new Map(); // key -> expiry
  const botKey = (chatId, text) => `${chatId}\u0000${String(text).trim()}`;
  const isRecentBot = (chatId, text) => {
    const now = Date.now();
    for (const [k, exp] of recentBot) if (exp < now) recentBot.delete(k);
    return recentBot.has(botKey(chatId, text));
  };

  client.onStateChanged((s) => onState(String(s)));
  client.onAnyMessage((raw) => {
    try {
      const msg = normalizeMessage(raw);
      if (msg.fromMe) msg.isBot = isRecentBot(msg.chatId, msg.body);
      onMessage(msg);
    } catch (err) {
      log(`שגיאה בעיבוד הודעה: ${err.message}`);
    }
  });

  return {
    async send(chatId, texts, { delayMs = 0, quoteId = null } = {}) {
      for (const [i, text] of texts.entries()) {
        recentBot.set(botKey(chatId, text), Date.now() + 120000);
        await sleep(i === 0 ? delayMs : Math.min(4000, 600 + text.length * 25));
        if (quoteId && i === 0) await client.reply(chatId, text, quoteId);
        else await client.sendText(chatId, text);
      }
    },
    async stop() {
      await client.stop?.("meshiv stop").catch(() => {});
      onState("STOPPED");
    },
  };
}
