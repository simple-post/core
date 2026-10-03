const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");

beforeEach(() => {
  jest.resetModules();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { origin: "https://app.simplepost.social", pathname: "/privacy" } },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "test-browser" },
  });
  jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
  if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
  else Reflect.deleteProperty(globalThis, "window");
  if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
  else Reflect.deleteProperty(globalThis, "navigator");
});

it.each([
  new Error("Minified React error #418; visit https://react.dev/errors/418 for the full message."),
  "Minified React error #418; visit https://react.dev/errors/418 for the full message.",
])("omits the known privacy-page hydration report: %s", async (error) => {
  const { logClientError } = await import("@/lib/logger/client");
  logClientError(error, "Unhandled browser error");

  expect(fetch).not.toHaveBeenCalled();
  expect(console.error).not.toHaveBeenCalled();
});

it.each(["/", "/oauth/authorize", "/posts", "/privacy-settings"])(
  "continues reporting hydration errors on %s",
  async (pathname) => {
    window.location.pathname = pathname;
    const { logClientError } = await import("@/lib/logger/client");
    logClientError(new Error("Minified React error #418; hydration failed."), "Unhandled browser error");

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(jest.mocked(fetch).mock.calls[0][1]!.body as string)).toMatchObject({
      level: "error",
      url: `https://app.simplepost.social${pathname}`,
      error: { message: "Minified React error #418; hydration failed." },
    });
  },
);

it.each([
  "Failed to load the privacy page",
  "Minified React error #419; another React error.",
  "Minified React error #4180; a different error code.",
  "Hydration failed because the server rendered HTML didn't match the client.",
])("continues reporting other privacy-page errors: %s", async (message) => {
  const { logClientError } = await import("@/lib/logger/client");
  logClientError(new Error(message), "Unhandled browser error");

  expect(fetch).toHaveBeenCalledTimes(1);
  expect(console.error).toHaveBeenCalledTimes(1);
});
