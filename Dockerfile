# משיב בשרת ענן (למשל Hugging Face Spaces / כל שרת Docker)
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium zstd ca-certificates fonts-noto-core fonts-noto-color-emoji \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY meshiv/package.json meshiv/package-lock.json ./
ENV PUPPETEER_SKIP_DOWNLOAD=1
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY meshiv/ ./

# DASHBOARD_PASSWORD חובה (מגיע מהסודות של השרת) — בלעדיו השרת לא עולה
ENV HOST=0.0.0.0 \
    PORT=7860 \
    CHROME_PATH=/usr/bin/chromium \
    MESHIV_NO_SANDBOX=1 \
    MESHIV_DATA=/home/node/data

USER node
RUN mkdir -p /home/node/data
EXPOSE 7860
CMD ["node", "src/server.js"]
