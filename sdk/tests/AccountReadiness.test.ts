import axios from "axios";

import { checkAccountReadiness, readinessFailure } from "../src/utils/account-readiness";

jest.mock("axios");
const get = jest.mocked(axios.get);
beforeEach(() => jest.resetAllMocks());
it("uses the returned Instagram quota instead of a hardcoded daily limit", async () => {
  get.mockResolvedValueOnce({ data: { data: [{ quota_usage: 42, config: { quota_total: 42 } }] } });
  const issues = await checkAccountReadiness(
    "instagram",
    {},
    { instagram: { credentials: { accessToken: "secret", businessAccountId: "123" } } },
  );
  expect(issues).toContainEqual(
    expect.objectContaining({ code: "publishing_quota_exhausted", actual: 42, limit: 42, severity: "error" }),
  );
  expect(get.mock.calls[0][0]).toContain("/123/content_publishing_limit");
  expect(axios.post).not.toHaveBeenCalled();
});
it("does not declare an unknown quota valid", async () => {
  get.mockResolvedValueOnce({ data: { data: [] } });
  expect(
    await checkAccountReadiness("threads", {}, { threads: { credentials: { accessToken: "secret", userId: "123" } } }),
  ).toContainEqual(expect.objectContaining({ code: "account_readiness_unverified", severity: "warning" }));
});
it("checks X video entitlement above the default account duration", async () => {
  get.mockResolvedValueOnce({ data: { data: { subscription_type: "None" } } });
  expect(
    await checkAccountReadiness(
      "x",
      { media: [{ type: "video", path: "video.mp4", durationSec: 1201 }] },
      { x: { credentials: { accessToken: "secret" } } },
    ),
  ).toContainEqual(expect.objectContaining({ code: "x_premium_required", severity: "error" }));
});
it("blocks Telegram channel posting without bot administrator permission", async () => {
  get.mockResolvedValueOnce({ data: { ok: true, result: { id: 1 } } });
  get.mockResolvedValueOnce({ data: { ok: true, result: { type: "channel" } } });
  get.mockResolvedValueOnce({ data: { ok: true, result: { status: "member" } } });
  expect(
    await checkAccountReadiness(
      "telegram",
      { text: "Hello" },
      { telegram: { chatId: "-100", credentials: { botToken: "secret" } } },
    ),
  ).toContainEqual(expect.objectContaining({ severity: "error", code: "account_ineligible" }));
  expect(axios.post).not.toHaveBeenCalled();
});
it("distinguishes definitive token failures from optional scope failures without leaking request data", () => {
  const error = {
    response: { status: 403 },
    config: { headers: { Authorization: "Bearer secret" } },
    message: "https://api.telegram.org/botsecret/getMe",
  };
  expect(readinessFailure("telegram", error).severity).toBe("warning");
  expect(JSON.stringify(readinessFailure("telegram", error))).not.toContain("secret");
  expect(readinessFailure("instagram", { response: { status: 400, data: { error: { code: 190 } } } })).toMatchObject({
    severity: "error",
    code: "account_unauthorized",
  });
});
