#!/usr/bin/env bash
# התקנת משיב על מחשב ביתי (macOS / Linux). מריצים מתוך תיקיית meshiv:
#   bash scripts/setup-home.sh
set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\n❌ %s\n' "$*" >&2; exit 1; }

say "1/4 בודק דרישות"
command -v node >/dev/null || fail "Node.js לא מותקן. התקן גרסה 20 ומעלה מ-https://nodejs.org"
major=$(node -p 'process.versions.node.split(".")[0]')
[ "$major" -ge 20 ] || fail "נדרש Node.js 20 ומעלה (מותקן: $(node -v))"
command -v zstd >/dev/null || fail "חסר zstd (open-wa צריך אותו). macOS: brew install zstd | Ubuntu: sudo apt install zstd"
echo "✅ Node $(node -v), zstd"

say "2/4 מתקין תלויות"
npm install --no-audit --no-fund

say "3/4 קובץ הגדרות .env"
if [ ! -f .env ]; then
  pass=$(node -e 'console.log(require("crypto").randomBytes(12).toString("base64url"))')
  sed "s/^DASHBOARD_PASSWORD=.*/DASHBOARD_PASSWORD=$pass/" .env.example > .env
  chmod 600 .env
  echo "✅ נוצר .env עם סיסמה ללוח הבקרה: $pass"
  echo "   (שם משתמש: כל דבר, למשל admin. אפשר לשנות בקובץ .env)"
else
  grep -q '^DASHBOARD_PASSWORD=.\+' .env || fail "ב-.env חסרה DASHBOARD_PASSWORD — הלוח יהיה נגיש מבחוץ, חובה סיסמה"
  echo "✅ .env קיים"
fi

say "4/4 הפעלה ברקע עם pm2"
if ! command -v pm2 >/dev/null; then
  echo "pm2 לא מותקן. להתקנה: npm install -g pm2   ואז להריץ שוב את הסקריפט."
  echo "או להפעלה ידנית עכשיו: npm run start:env"
  exit 0
fi
pm2 startOrReload ecosystem.config.cjs
pm2 save
echo
echo "✅ משיב רץ: http://localhost:$(grep -E '^PORT=' .env | cut -d= -f2 || echo 3300)"
echo "   כדי שיעלה אוטומטית אחרי הפעלה מחדש של המחשב, הרץ: pm2 startup   (והעתק את הפקודה שהוא מדפיס)"
echo "   לוגים: pm2 logs meshiv"
