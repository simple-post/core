import { OAuthAccountProvider, fetchJson } from "./oauth.js";

interface TumblrBlog {
  name?: string;
  title?: string;
  url?: string;
  uuid?: string;
}

interface TumblrUserInfoResponse {
  response?: { user?: { blogs?: TumblrBlog[] } };
}

export class TumblrAuthProvider extends OAuthAccountProvider {
  public constructor() {
    super("tumblr", {
      async completeLogin({ context, tokenSet }) {
        const result = await fetchJson<TumblrUserInfoResponse>(
          "https://api.tumblr.com/v2/user/info",
          { headers: { Authorization: `Bearer ${tokenSet.accessToken}`, "User-Agent": "SimplePost CLI" } },
          "Tumblr blog lookup",
        );
        const blogs = result.response?.user?.blogs?.filter((blog) => blog.name) ?? [];
        if (blogs.length === 0) throw new Error("Tumblr did not return a blog for this account.");
        const selectedName =
          blogs.length === 1
            ? blogs[0].name!
            : await context.prompt.select(
                "Choose a Tumblr blog",
                blogs.map((item) => ({
                  label: item.title ? `${item.title} (${item.name})` : item.name!,
                  value: item.name!,
                })),
              );
        const blog = blogs.find((item) => item.name === selectedName)!;
        return {
          displayName: blog.title ?? blog.name,
          settings: { blogIdentifier: blog.name, blogUrl: blog.url },
          userId: blog.name!,
          username: blog.name,
        };
      },
    });
  }
}
