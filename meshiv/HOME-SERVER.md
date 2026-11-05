# 🏠 הרצת משיב על המחשב בבית, עם כתובת meshiv.elyasharlabs.com

הבוט רץ על המחשב שלך 24/7. Cloudflare Tunnel מחבר את המחשב לכתובת `meshiv.elyasharlabs.com`
**בלי לפתוח פורטים בראוטר ובלי IP קבוע**. החיבור מוצפן (HTTPS), ולוח הבקרה מוגן בסיסמה.

```
הטלפון/הדפדפן ──HTTPS──▶ Cloudflare ──מנהרה מוצפנת──▶ המחשב בבית (localhost:3300) ──▶ WhatsApp
```

## שלב 1: התקנות (פעם אחת)

| | macOS | Windows | Linux (Ubuntu) |
|---|---|---|---|
| Node.js 20+ | `brew install node` | [nodejs.org](https://nodejs.org) (LTS) | [nodejs.org](https://nodejs.org) או `nvm` |
| Google Chrome | [google.com/chrome](https://www.google.com/chrome) | [google.com/chrome](https://www.google.com/chrome) | `google-chrome-stable` |
| zstd | `brew install zstd` | [מהגרסאות של zstd](https://github.com/facebook/zstd/releases): לחלץ ולהוסיף ל-PATH | `sudo apt install zstd` |
| pm2 | `npm install -g pm2` | `npm install -g pm2 pm2-windows-startup` | `npm install -g pm2` |

## שלב 2: התקנת משיב

**macOS / Linux:**
```bash
cd meshiv
bash scripts/setup-home.sh
```
הסקריפט מתקין את התלויות, יוצר קובץ `.env` עם **סיסמה אקראית ללוח הבקרה** (הוא מדפיס אותה), ומפעיל את הבוט ברקע.
כדי שהבוט יעלה גם אחרי הפעלה מחדש של המחשב: `pm2 startup`, ואז להעתיק ולהריץ את הפקודה שהוא מדפיס.

**Windows** (PowerShell, מתוך תיקיית meshiv):
```powershell
npm install
copy .env.example .env
notepad .env          # מלא DASHBOARD_PASSWORD=סיסמה-חזקה
pm2 start ecosystem.config.cjs
pm2 save
pm2-startup install   # עולה אוטומטית עם Windows
```

## שלב 3: חיבור WhatsApp

1. פתח במחשב: http://localhost:3300 (שם משתמש: כל דבר, הסיסמה מהקובץ `.env`).
2. בטלפון: WhatsApp ← הגדרות ← מכשירים מקושרים ← קישור מכשיר, וסרוק את ה-QR.
3. בדוק בלשונית 🧪 סימולטור שהחוקים עונים כמו שצריך.

## שלב 4: הכתובת meshiv.elyasharlabs.com (Cloudflare Tunnel)

1. היכנס ל-[Cloudflare Zero Trust](https://one.dash.cloudflare.com) ← **Networks ← Tunnels ← Create a tunnel** ← **Cloudflared**.
2. שם: `meshiv` ← בחר את מערכת ההפעלה של המחשב ← העתק והרץ במחשב את פקודת ההתקנה שמוצגת (`cloudflared service install …`). המנהרה תעלה כשירות, גם אחרי הפעלה מחדש.
3. בלשונית **Public Hostname**:
   - Subdomain: `meshiv`
   - Domain: `elyasharlabs.com`
   - Service: `HTTP` ← `localhost:3300`
4. שמור. Cloudflare יוצר את רשומת ה-DNS לבד. אחרי דקה הכתובת https://meshiv.elyasharlabs.com עובדת.

### מומלץ מאוד: שכבת הגנה נוספת (Cloudflare Access)

Zero Trust ← **Access ← Applications ← Add ← Self-hosted** ← דומיין `meshiv.elyasharlabs.com` ← מדיניות **Allow** עם כתובת המייל שלך.
מעכשיו, לפני הסיסמה של משיב, Cloudflare ישלח קוד חד-פעמי למייל שלך. אף אחד אחר לא יגיע אפילו למסך הכניסה.

> 🔒 משיב **חוסם כל גישה דרך Cloudflare אם לא הוגדרה סיסמה** ב-`.env`, כדי שהוואטסאפ שלך לא יהיה פתוח לאינטרנט בטעות.

## שלב 5: שהמחשב לא יירדם

- **macOS:** הגדרות מערכת ← סוללה/חיסכון בחשמל ← "מנע שינה אוטומטית כשהמסך כבוי".
- **Windows:** הגדרות ← מערכת ← צריכת חשמל ← שינה: "אף פעם" (כשמחובר לחשמל).
- הטלפון עם WhatsApp צריך להתחבר לאינטרנט מדי פעם (לפחות פעם בשבועיים), אחרת המכשיר המקושר מתנתק.

## תחזוקה

| מה | פקודה |
|---|---|
| לוגים | `pm2 logs meshiv` |
| הפעלה מחדש | `pm2 restart meshiv` |
| עצירה | `pm2 stop meshiv` |
| עדכון קוד | להחליף את הקבצים (בלי `data/` ו-`.env`), להריץ `npm install`, ואז `pm2 restart meshiv` |
| גיבוי | התיקייה `data/` (הגדרות, אנשי קשר, החיבור ל-WhatsApp) והקובץ `.env` |

אם WhatsApp מנותק (בטלפון ביטלת את המכשיר המקושר), לחץ "התחבר" בלוח הבקרה וסרוק שוב.
