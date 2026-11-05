// ============================================================
// store.js — שמירה לקבצי JSON בתיקיית data/ (כתיבה אטומית).
// ============================================================
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export function createStore(dir) {
  const timers = new Map();
  const file = (name) => join(dir, `${name}.json`);

  async function load(name, fallback) {
    try {
      return JSON.parse(await readFile(file(name), "utf8"));
    } catch (err) {
      if (err.code !== "ENOENT") console.warn(`[store] לא ניתן לקרוא ${name}.json: ${err.message}`);
      return fallback;
    }
  }

  async function saveNow(name, data) {
    clearTimeout(timers.get(name));
    timers.delete(name);
    await mkdir(dir, { recursive: true });
    const tmp = `${file(name)}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2));
    await rename(tmp, file(name));
  }

  function saveSoon(name, getData, ms = 1000) {
    if (timers.has(name)) return;
    timers.set(name, setTimeout(() => saveNow(name, getData()).catch((e) => console.error(`[store] ${name}:`, e.message)), ms));
  }

  async function flush(entries) {
    await Promise.all(entries.map(([name, getData]) => (timers.has(name) ? saveNow(name, getData()) : null)));
  }

  return { load, saveNow, saveSoon, flush };
}
