import { fetchLinkedInPages } from "@/lib/oauth/linkedin-pages";

const fetchMock = jest.fn();
const approved = { status: { "com.linkedin.organization.Approved": {} } };
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const acl = (id: string, state = "APPROVED") => ({ organization: `urn:li:organization:${id}`, state });

beforeEach(() => {
  jest.resetAllMocks();
  global.fetch = fetchMock as typeof fetch;
});

it("paginates, deduplicates Pages, and checks organic publishing permission", async () => {
  fetchMock
    .mockResolvedValueOnce(
      response({
        elements: [acl("1"), acl("1")],
        paging: { count: 2, links: [{ rel: "next", href: "https://attacker.example" }] },
      }),
    )
    .mockResolvedValueOnce(response({ elements: [acl("2"), acl("3", "REVOKED")], paging: { count: 10 } }))
    .mockResolvedValueOnce(response(approved))
    .mockResolvedValueOnce(
      response({
        localizedName: "Company",
        vanityName: "company",
        logoV2: { "original~": { elements: [{ identifiers: [{ identifier: "https://media.licdn.com/logo.jpg" }] }] } },
      }),
    )
    .mockResolvedValueOnce(response({ status: { "com.linkedin.organization.Denied": {} } }));
  await expect(fetchLinkedInPages("token", "member")).resolves.toEqual([
    {
      id: "urn:li:organization:1",
      name: "Company",
      username: "company",
      profilePicture: "https://media.licdn.com/logo.jpg",
    },
  ]);
  expect(fetchMock.mock.calls[1][0]).toContain("start=2");
  expect(fetchMock.mock.calls[2][0]).toContain("ORGANIC_SHARE_CREATE");
  expect(fetchMock.mock.calls.every(([url]) => url.startsWith("https://api.linkedin.com/"))).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(5);
});

it("accepts organizationTarget and a Page with no logo", async () => {
  fetchMock
    .mockResolvedValueOnce(response({ elements: [{ organizationTarget: "urn:li:organization:2", state: "APPROVED" }] }))
    .mockResolvedValueOnce(response(approved))
    .mockResolvedValueOnce(response({ name: { localized: { en_US: "Company" } } }));
  await expect(fetchLinkedInPages("token", "member")).resolves.toMatchObject([
    { name: "Company", profilePicture: null },
  ]);
});

it("returns no Pages when no approved memberships exist", async () => {
  fetchMock.mockResolvedValueOnce(response({ elements: [] }));
  await expect(fetchLinkedInPages("token", "member")).resolves.toEqual([]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("reports permission failures without reflecting provider secrets", async () => {
  fetchMock.mockResolvedValueOnce(response({ token: "secret" }, 403));
  await expect(fetchLinkedInPages("token", "member")).rejects.toThrow("Reconnect and grant Page access");
});
