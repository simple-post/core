import { lookup } from "node:dns/promises";
import { EventEmitter } from "node:events";
import https from "node:https";
import { Readable } from "node:stream";

import { fetchCardResource, isPublicAddress, validateCardUrl } from "../src/publishers/bluesky/card-fetch";

jest.mock("node:dns/promises", () => ({ lookup: jest.fn() }));
jest.mock("node:https", () => ({ get: jest.fn() }));
const dns = lookup as jest.Mock;
const get = https.get as jest.Mock;

beforeEach(() => {
  jest.resetAllMocks();
  dns.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
});

test.each([
  "127.0.0.1",
  "10.0.0.1",
  "172.16.1.1",
  "192.168.1.1",
  "169.254.169.254",
  "0.0.0.0",
  "::1",
  "fc00::1",
  "fe80::1",
  "::ffff:127.0.0.1",
  "224.0.0.1",
])("rejects nonpublic address %s", (address) => {
  expect(isPublicAddress(address)).toBe(false);
});
test.each([
  "http://127.1/",
  "https://[::1]/",
  "file:///etc/passwd",
  "https://user:pass@example.com/",
  "https://example.com:8080/",
])("rejects unsafe URL %s", (url) => {
  expect(() => validateCardUrl(url)).toThrow();
});

function response(body: Buffer, status = 200, headers = {}) {
  get.mockImplementationOnce((_url, _options, callback) => {
    // Node HTTP requests use EventEmitter, so the fixture must match that API.
    // eslint-disable-next-line unicorn/prefer-event-target
    const request = Object.assign(new EventEmitter(), { setTimeout: jest.fn(), destroy: jest.fn() });
    queueMicrotask(() => callback(Object.assign(Readable.from([body]), { statusCode: status, headers })));
    return request;
  });
}

test("pins the vetted DNS address rather than resolving again on connection", async () => {
  response(Buffer.from("hello"), 200, { "content-type": "text/html" });
  const result = await fetchCardResource("https://example.com/", AbortSignal.timeout(1000));
  expect(result.body.toString()).toBe("hello");
  const callback = jest.fn();
  expect(get.mock.calls[0][1].family).toBe(4);
  get.mock.calls[0][1].lookup("example.com", {}, callback);
  expect(callback).toHaveBeenCalledWith(null, "8.8.8.8", 4);
  expect(dns).toHaveBeenCalledTimes(1);
});

test("rejects mixed public/private DNS answers before sending a request", async () => {
  dns.mockResolvedValue([
    { address: "8.8.8.8", family: 4 },
    { address: "10.0.0.1", family: 4 },
  ]);
  await expect(fetchCardResource("https://example.com", AbortSignal.timeout(1000))).rejects.toThrow("DNS");
  expect(get).not.toHaveBeenCalled();
});

test("revalidates redirect targets before fetching them", async () => {
  response(Buffer.alloc(0), 302, { location: "http://169.254.169.254/latest" });
  await expect(fetchCardResource("https://example.com", AbortSignal.timeout(1000))).rejects.toThrow("Private");
  expect(get).toHaveBeenCalledTimes(1);
});

test("rejects malformed redirects without an uncaught response callback error", async () => {
  response(Buffer.alloc(0), 302, { location: "http://[" });
  await expect(fetchCardResource("https://example.com", AbortSignal.timeout(1000))).rejects.toThrow("Invalid");
  expect(get).toHaveBeenCalledTimes(1);
});

test("stops redirect loops after three hops", async () => {
  for (let i = 0; i < 4; i++) response(Buffer.alloc(0), 302, { location: "/loop" });
  await expect(fetchCardResource("https://example.com", AbortSignal.timeout(1000))).rejects.toThrow("Too many");
  expect(get).toHaveBeenCalledTimes(4);
});

test("rejects oversized streamed bodies without Content-Length", async () => {
  response(Buffer.alloc(1_000_001));
  await expect(fetchCardResource("https://example.com", AbortSignal.timeout(1000))).rejects.toThrow("Oversized");
});

test("aborts a stalled DNS lookup within the overall deadline", async () => {
  dns.mockImplementation(() => new Promise(() => {}));
  const controller = new AbortController();
  const pending = fetchCardResource("https://example.com", controller.signal);
  controller.abort();
  await expect(pending).rejects.toThrow("timed out");
  expect(get).not.toHaveBeenCalled();
});
