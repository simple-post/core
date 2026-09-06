import { Readable } from "node:stream";

import axios from "axios";

import { getAccountsByIds } from "../src/config/accounts.js";
import { validatePostForAccounts } from "../src/services/validation.js";

jest.mock("axios");
jest.mock("../src/config/accounts.js", () => ({ getAccountsByIds: jest.fn() }));

it("rejects a login page through the self-hosted API validation service", async () => {
  jest
    .mocked(getAccountsByIds)
    .mockReturnValue([
      { id: "instagram", platform: "instagram", rawPlatform: "instagram", platformAccountId: "test", credentials: {} },
    ]);
  const html = Buffer.from("<!doctype html><html>Sign in</html>");
  jest.mocked(axios.get).mockResolvedValue({
    status: 200,
    headers: { "content-type": "text/html", "content-length": html.length },
    data: Readable.from([html]),
  });
  const result = await validatePostForAccounts({
    message: "hello",
    accountIds: ["instagram"],
    media: [{ id: "image", type: "image", url: "https://drive.google.com/private", filename: "image.jpg", size: 0 }],
  });
  expect(result.summary.isValid).toBe(false);
  expect(result.results[0].errors).toContainEqual(
    expect.objectContaining({ code: "media_invalid", message: expect.stringContaining("Upload the file directly") })
  );
});
