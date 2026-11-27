// In Electron, preload.cjs provides window.ricky. In a browser or on a phone,
// the same calls go to server/web.cjs over HTTP.
const tokenKey = "jarvis-access-token";

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let token = localStorage.getItem(tokenKey) || "";
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!token) {
      token = window.prompt("Jarvis access token") || "";
      if (!token) throw new Error("Jarvis access token is required.");
      localStorage.setItem(tokenKey, token);
    }
    const response = await fetch(path, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 401) {
      localStorage.removeItem(tokenKey);
      token = "";
      continue;
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
    return data as T;
  }
  throw new Error("Jarvis access token was rejected.");
}

if (!window.ricky) {
  window.ricky = {
    web: true,
    createRealtimeToken: () => call("POST", "/api/realtime-token"),
    executeTool: (toolCall) => call("POST", "/api/tools/execute", toolCall),
    getToolSpecs: () => call("GET", "/api/tools"),
  };
}
