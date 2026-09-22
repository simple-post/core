import { analyticsEnabled, trackEvent, trackOnce } from "@/lib/analytics/plausible";

describe("Plausible client delivery", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const originalFetch = globalThis.fetch;
  let mockWindow: { location: { hostname: string; href: string }; localStorage: Storage; sessionStorage: Storage };
  let send: jest.Mock;
  const flush = async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };
  beforeEach(() => {
    jest.replaceProperty(process.env, "NODE_ENV", "production");
    const values = new Map<string, string>();
    const storage = {
      getItem: jest.fn((key: string) => values.get(key) || null),
      setItem: jest.fn((key: string, value: string) => values.set(key, value)),
    } as unknown as Storage;
    mockWindow = {
      location: { hostname: "app.simplepost.social", href: "https://app.simplepost.social/billing?session_id=secret" },
      localStorage: storage,
      sessionStorage: storage,
    };
    Object.defineProperty(globalThis, "window", { configurable: true, value: mockWindow });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { referrer: "https://app.simplepost.social/billing?session_id=private" },
    });
    send = jest.fn().mockResolvedValue({ status: 202 });
    globalThis.fetch = send;
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(() => {
    for (const [key, descriptor] of [
      ["window", originalWindow],
      ["document", originalDocument],
    ] as const) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    globalThis.fetch = originalFetch;
  });
  it("disables telemetry on local, development and self-hosted origins", () => {
    mockWindow.location.hostname = "localhost";
    expect(analyticsEnabled()).toBe(false);
    trackEvent("Checkout Started");
    expect(send).not.toHaveBeenCalled();
    mockWindow.location.hostname = "my-own-server.example";
    expect(analyticsEnabled()).toBe(false);
    mockWindow.location.hostname = "app.simplepost.social";
    jest.replaceProperty(process.env, "NODE_ENV", "development");
    expect(analyticsEnabled()).toBe(false);
  });
  it("honors opt-out for direct and deduplicated events without delaying checkout", () => {
    mockWindow.localStorage.setItem("plausible_ignore", "true");
    const callback = jest.fn();
    expect(analyticsEnabled()).toBe(false);
    trackEvent("Checkout Started", { plan: "basic" }, callback);
    trackOnce("opted-out-checkout", "Paid Subscription", { plan: "basic" }, true);
    expect(send).not.toHaveBeenCalled();
    expect(callback).toHaveBeenCalledTimes(1);
    mockWindow.localStorage.setItem("plausible_ignore", "false");
    trackOnce("opted-out-checkout", "Paid Subscription", { plan: "basic" }, true);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("skips optional events when the opt-out preference cannot be read", () => {
    jest.spyOn(mockWindow.localStorage, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const callback = jest.fn();
    trackEvent("Checkout Started", undefined, callback);
    expect(send).not.toHaveBeenCalled();
    expect(callback).toHaveBeenCalledTimes(1);
  });
  it("deduplicates in-flight and delivered payments and scrubs all private URLs", async () => {
    trackOnce("private-checkout-1", "Paid Subscription", { plan: "basic" }, true);
    trackOnce("private-checkout-1", "Paid Subscription", { plan: "basic" }, true);
    expect(send).toHaveBeenCalledTimes(1);
    const options = send.mock.calls[0][1];
    const event = JSON.parse(options.body);
    expect(event.url).toBe("https://app.simplepost.social/app/billing");
    expect(event.referrer).toBe("https://app.simplepost.social");
    expect(options.body).not.toMatch(/private|secret|session_id/);
    expect(options.keepalive).toBe(true);
    expect(options.referrerPolicy).toBe("no-referrer");
    await flush();
    trackOnce("private-checkout-1", "Paid Subscription", { plan: "basic" }, true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(mockWindow.localStorage.setItem).toHaveBeenCalledWith("simplepost:analytics:private-checkout-1", "1");
  });
  it("allows retry after failed delivery without saving a success marker", async () => {
    send.mockRejectedValueOnce(new Error("offline"));
    trackOnce("failed-checkout", "Paid Subscription", { plan: "pro" }, true);
    await flush();
    expect(mockWindow.localStorage.setItem).not.toHaveBeenCalled();
    send.mockResolvedValueOnce({ status: 500 });
    trackOnce("failed-checkout", "Paid Subscription", { plan: "pro" }, true);
    await flush();
    expect(send).toHaveBeenCalledTimes(2);
    expect(mockWindow.localStorage.setItem).not.toHaveBeenCalled();
  });
  it("honors an existing persisted receipt", () => {
    mockWindow.localStorage.setItem("simplepost:analytics:previous-checkout", "1");
    trackOnce("previous-checkout", "Paid Subscription", { plan: "pro" }, true);
    expect(send).not.toHaveBeenCalled();
  });
  it("keeps incidental app events from changing bounce rate", async () => {
    trackEvent("App Opened");
    expect(JSON.parse(send.mock.calls[0][1].body).interactive).toBe(false);
    await flush();
  });
  it("does not throw when storage and network access fail", async () => {
    Object.defineProperty(mockWindow, "localStorage", {
      get() {
        throw new Error("blocked");
      },
    });
    send.mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => trackOnce("blocked-checkout", "Paid Subscription", { plan: "pro" }, true)).not.toThrow();
    await flush();
  });
});
