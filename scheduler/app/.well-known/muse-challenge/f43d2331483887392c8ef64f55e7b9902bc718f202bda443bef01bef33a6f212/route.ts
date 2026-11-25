export function GET() {
  return new Response("muse-challenge=f43d2331483887392c8ef64f55e7b9902bc718f202bda443bef01bef33a6f212\n", {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
