import { createServer } from "http";
import { config } from "dotenv";
import { getTimestampsFromYouTube } from "./gemini.js";
import { save } from "./storage.js";

config();

const PORT = Number(process.env.PORT) || 3001;

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function send(res, status, data) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.writeHead(status);
  res.end(JSON.stringify(data));
}

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    send(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && req.url === "/guest-token") {
    try {
      const { getGuestToken } = await import("./guestToken.js");
      const token = await getGuestToken();
      send(res, 200, { token });
    } catch (err) {
      send(res, 500, { error: err.message || String(err) });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/timestamps") {
    try {
      const body = await parseJsonBody(req);
      const url = body.url || body.videoUrl;
      if (!url || typeof url !== "string") {
        send(res, 400, { error: "Missing url or videoUrl in body" });
        return;
      }
      const result = await getTimestampsFromYouTube(url);
      await save(result);
      send(res, 200, result);
    } catch (err) {
      send(res, 500, { error: err.message || String(err) });
    }
    return;
  }

  send(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`Timestamp service running at http://localhost:${PORT}`);
  console.log("  POST /timestamps   body: { url: \"https://www.youtube.com/...\" }");
  console.log("  GET  /guest-token  returns { token } for shared guest sign-in");
  console.log("  GET  /health");
});
