# Legacy documentation redirect

Permanently redirects requests for the former documentation hostname to [docs.simplepost.social](https://docs.simplepost.social), preserving the path and query string. Browsers preserve fragments when following the redirect. This Worker has no origin dependency and does not read or forward request bodies.

The route requires a proxied DNS record for the former host in the `simplepost.dev` zone. It does not change the canonical docs deployment or the website's `/docs` redirects.

From this directory, with Wrangler 4 installed and authenticated:

```bash
node --test redirect.test.mjs
wrangler deploy --dry-run
wrangler deploy
```

Verify root and nested links with `curl -I` after deployment; expect 308 and a canonical `Location` with the original query intact.
