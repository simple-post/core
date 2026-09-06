export default {
  fetch(request) {
    const url = new URL(request.url);
    if (url.hostname !== "docs.simplepost.dev") {
      return new Response("Not found", { status: 404 });
    }
    url.protocol = "https:";
    url.hostname = "docs.simplepost.social";
    url.port = "";
    return Response.redirect(url.href, 308);
  },
};
