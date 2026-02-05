import { config } from "dotenv";
import { getTimestampsFromYouTube } from "./gemini.js";
import { save, loadByVideoUrl } from "./storage.js";

config();

async function main() {
  const videoUrl = process.argv[2] || process.env.YOUTUBE_URL;
  if (!videoUrl) {
    console.error("Usage: node src/index.js \"<youtube_url>\"");
    console.error("       (use quotes around the URL to avoid shell globbing)");
    console.error("   or: YOUTUBE_URL=\"https://...\" node src/index.js");
    process.exit(1);
  }

  try {
    const existing = await loadByVideoUrl(videoUrl);
    if (existing) {
      console.log("Found existing result; saving again as new file.");
    }

    const result = await getTimestampsFromYouTube(videoUrl);
    const filepath = await save(result);
    console.log("Saved to:", filepath);
    console.log("Summary:", result.summary?.slice(0, 200) + "...");
    console.log("Segments:", result.segments?.length ?? 0);
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}

main();
