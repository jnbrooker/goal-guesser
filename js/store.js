// Per-browser study progress, kept in localStorage.
//
// Each row gets a Leitner box: 0 = never seen, 1 = learning (last answer wrong),
// 2 = right once, 3+ = mastered. Keys use names rather than indexes so progress
// survives a data rebuild.

import { DB } from "./data.js";

const KEY = "gg-progress-v1";
let progress = read(KEY, {});

function read(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: progress just won't persist */
  }
}

export const rowKey = (r) => `${DB.players[r.p]}|${DB.seasons[r.s]}|${DB.clubs[r.c]}`;

export function box(r) {
  return progress[rowKey(r)]?.b ?? 0;
}

export const isMastered = (r) => box(r) >= 3;

export function record(r, correct) {
  const k = rowKey(r);
  const e = progress[k] || { b: 0, n: 0, ok: 0 };
  e.n++;
  if (correct) {
    e.ok++;
    e.b = Math.min(5, e.b + 1);
  } else {
    e.b = 1;
  }
  e.t = Date.now();
  progress[k] = e;
  write(KEY, progress);
}

export function summary(rows) {
  let seen = 0, mastered = 0;
  for (const r of rows) {
    const b = box(r);
    if (b > 0) seen++;
    if (b >= 3) mastered++;
  }
  return { total: rows.length, seen, mastered };
}

export function resetProgress() {
  progress = {};
  write(KEY, progress);
}

/** Pick n rows, favouring ones in low boxes (unseen and weak first). */
export function pickForStudy(rows, n) {
  const weighted = rows.map((r) => {
    const b = box(r);
    const w = b === 0 ? 3 : b === 1 ? 4 : b === 2 ? 2 : 0.4;
    return { r, k: Math.random() ** (1 / w) };
  });
  weighted.sort((a, b) => b.k - a.k);
  return weighted.slice(0, n).map((x) => x.r);
}

// Small named settings (last deck filter, best streaks, …).
export const prefs = {
  get: (k, fallback) => read("gg-" + k, fallback),
  set: (k, v) => write("gg-" + k, v),
};
