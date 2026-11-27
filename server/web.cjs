// Serves the built app (dist/) plus a tiny API that mirrors the Electron IPC
// bridge, so Jarvis runs in a browser and installs on a phone as a PWA.
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const { handlers, ensureData, clearStartupLoadingThumbnails } = require("../electron/main.cjs");

const host = process.env.JARVIS_HOST || "127.0.0.1";
const port = Number(process.env.JARVIS_PORT || 8787);
const accessToken = process.env.JARVIS_ACCESS_TOKEN || "";
const distDir = path.join(process.cwd(), "dist");
const maxBody = 1024 * 1024;

if (accessToken.length < 24) {
  console.error("JARVIS_ACCESS_TOKEN must be set (24+ characters) in .env.local before starting the web server.");
  process.exit(1);
}

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

function authorized(req) {
  const given = Buffer.from(String(req.headers.authorization || "").replace(/^Bearer /, ""));
  const expected = Buffer.from(accessToken);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBody) throw Object.assign(new Error("Request too large"), { status: 413 });
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

async function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let file = path.normalize(path.join(distDir, urlPath));
  if (!file.startsWith(distDir)) return send(res, 403, { error: "Forbidden" });
  try {
    if ((await fs.stat(file)).isDirectory()) file = path.join(file, "index.html");
  } catch {
    file = path.join(distDir, "index.html");
  }
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  } catch {
    send(res, 404, { error: "Run npm run build first." });
  }
}

const routes = {
  "GET /api/tools": () => handlers["tools:list"](),
  "POST /api/realtime-token": () => handlers["realtime:create-token"](),
  "POST /api/tools/execute": async (req) => handlers["tools:execute"](null, await readJson(req)),
};

const server = http.createServer(async (req, res) => {
  const route = routes[`${req.method} ${new URL(req.url, "http://x").pathname}`];
  if (!route) return serveStatic(req, res);
  if (!authorized(req)) return send(res, 401, { error: "Unauthorized" });
  try {
    send(res, 200, await route(req));
  } catch (error) {
    send(res, error.status || 500, { error: error.message || "Server error" });
  }
});

(async () => {
  await ensureData();
  await clearStartupLoadingThumbnails();
  server.listen(port, host, () => console.log(`Jarvis web on http://${host}:${port}`));
})();
