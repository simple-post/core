import crypto from "node:crypto";
import http from "node:http";

import app from "../components/simplepost/simplepost.app.mjs";

export const API_KEY = "sp_api_test_key";

/**
 * Starts a fake Scheduler API that records requests and replies from `routes`,
 * keyed by `METHOD /path`.
 */
export async function startScheduler(routes) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const url = new URL(req.url, "http://localhost");
      const raw = Buffer.concat(chunks);
      const isJson = (req.headers["content-type"] ?? "").includes("application/json");
      const request = {
        method: req.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        headers: req.headers,
        raw,
        body: isJson && raw.length ? JSON.parse(raw.toString("utf8")) : undefined,
      };
      requests.push(request);

      const handler = routes[`${req.method} ${url.pathname}`];
      if (!handler) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `No route for ${req.method} ${url.pathname}` }));
        return;
      }
      const { status = 200, body } = handler(request);
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** Builds a bound app instance the way Pipedream does for a connected account. */
export function createApp(baseUrl) {
  const instance = { $auth: { api_key: API_KEY, base_url: `${baseUrl}/` } };
  for (const [name, method] of Object.entries(app.methods)) {
    instance[name] = method.bind(instance);
  }
  instance.propOptions = (name, args = {}) => app.propDefinitions[name].options.call(instance, args);
  return instance;
}

/** A minimal step context capturing exports. */
export function createStep() {
  const exports = {};
  return {
    exports,
    export(key, value) {
      exports[key] = value;
    },
  };
}

export async function runAction(action, props) {
  const $ = createStep();
  const result = await action.run.call(props, { $ });
  return { result, summary: $.exports.$summary };
}

export function sign(secret, timestamp, body) {
  return `sha256=${crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}
