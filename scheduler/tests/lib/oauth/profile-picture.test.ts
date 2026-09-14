import {
  extractLinkedInDecoratedProfilePicture,
  fetchLinkedInProfilePicture,
  fetchThreadsProfilePicture,
  fetchFreshProfilePicture,
} from "@/lib/oauth/profile-picture";

jest.mock("@/lib/logger", () => ({
  authLogger: { warn: jest.fn() },
}));

const fetchMock = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe("profile picture refresh", () => {
  it("fetches a fresh Threads CDN URL", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ threads_profile_picture_url: "https://scontent.example.cdninstagram.com/avatar.jpg" }),
        {
          status: 200,
        },
      ),
    );

    await expect(fetchThreadsProfilePicture("threads-access-token")).resolves.toBe(
      "https://scontent.example.cdninstagram.com/avatar.jpg",
    );

    const [requestUrl, init] = fetchMock.mock.calls[0];
    const url = new URL(String(requestUrl));
    expect(url.origin + url.pathname).toBe("https://graph.threads.net/v1.0/me");
    expect(url.searchParams.get("fields")).toBe("threads_profile_picture_url");
    expect(url.searchParams.get("access_token")).toBe("threads-access-token");
    expect(init).toEqual({ cache: "no-store" });
  });

  it("uses the current LinkedIn OpenID picture when available", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ picture: "https://media.licdn.com/current.jpg" }), { status: 200 }),
    );

    await expect(fetchLinkedInProfilePicture("linkedin-access-token")).resolves.toBe(
      "https://media.licdn.com/current.jpg",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("https://api.linkedin.com/v2/userinfo", {
      cache: "no-store",
      headers: { Authorization: "Bearer linkedin-access-token" },
    });
  });

  it("falls back to the largest decorated LinkedIn image for legacy credentials", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 403 })).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          profilePicture: {
            "displayImage~": {
              elements: [
                {
                  data: {
                    "com.linkedin.digitalmedia.mediaartifact.StillImage": {
                      storageSize: { width: 100, height: 100 },
                    },
                  },
                  identifiers: [{ identifier: "https://media.licdn.com/small.jpg" }],
                },
                {
                  data: {
                    "com.linkedin.digitalmedia.mediaartifact.StillImage": {
                      storageSize: { width: 400, height: 400 },
                    },
                  },
                  identifiers: [{ identifier: "https://media.licdn.com/large.jpg" }],
                },
              ],
            },
          },
        }),
        { status: 200 },
      ),
    );

    await expect(fetchLinkedInProfilePicture("linkedin-access-token")).resolves.toBe(
      "https://media.licdn.com/large.jpg",
    );
  });

  it("chooses decorated LinkedIn candidates by pixel area", () => {
    expect(
      extractLinkedInDecoratedProfilePicture({
        profilePicture: {
          "displayImage~": {
            elements: [
              { identifiers: [{ identifier: "https://media.licdn.com/unknown.jpg" }] },
              {
                data: {
                  "com.linkedin.digitalmedia.mediaartifact.StillImage": {
                    storageSize: { width: 200, height: 300 },
                  },
                },
                identifiers: [{ identifier: "https://media.licdn.com/largest.jpg" }],
              },
            ],
          },
        },
      }),
    ).toBe("https://media.licdn.com/largest.jpg");
  });
});

it("treats a successful LinkedIn profile without a photo as a normal absence", async () => {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ sub: "member" }), { status: 200 }));
  await expect(fetchLinkedInProfilePicture("linkedin-access-token")).resolves.toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("refreshes a Page logo from its organization without loading the admin's profile", async () => {
  fetchMock.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        logoV2: {
          "original~": { elements: [{ identifiers: [{ identifier: "https://media.licdn.com/company.jpg" }] }] },
        },
      }),
      { status: 200 },
    ),
  );
  await expect(fetchFreshProfilePicture("linkedin", "token", "urn:li:organization:123")).resolves.toBe(
    "https://media.licdn.com/company.jpg",
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toContain("rest/organizations/123");
});

it("does not substitute the admin photo when a Page logo cannot be loaded", async () => {
  fetchMock.mockResolvedValueOnce(new Response("forbidden", { status: 403 }));
  await expect(fetchFreshProfilePicture("linkedin", "token", "urn:li:organization:123")).resolves.toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toContain("rest/organizations/123");
});
