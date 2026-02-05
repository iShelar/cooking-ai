import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");

/**
 * Storage abstraction: local JSON for now.
 * Later: replace implementation with Firebase (same interface).
 * @param {object} result - { videoUrl, summary, segments, createdAt }
 * @returns {Promise<string>} - id or path for the saved record
 */
export async function save(result) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const safeId = result.videoUrl.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
  const filename = `${safeId}_${Date.now()}.json`;
  const filepath = path.join(DATA_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(result, null, 2), "utf8");
  return filepath;
}

/**
 * Load by videoUrl (finds latest file matching that URL).
 * Later: Firebase get by videoUrl or id.
 */
export async function loadByVideoUrl(videoUrl) {
  if (!fs.existsSync(DATA_DIR)) return null;
  const safePrefix = videoUrl.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
  const files = fs.readdirSync(DATA_DIR).filter((f) => f.startsWith(safePrefix) && f.endsWith(".json"));
  if (files.length === 0) return null;
  const latest = files.sort().reverse()[0];
  const raw = fs.readFileSync(path.join(DATA_DIR, latest), "utf8");
  return JSON.parse(raw);
}
