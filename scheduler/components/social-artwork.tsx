/** Offline browser layout renders complete translated phrases with native text shaping. */
export default function SocialArtwork({
  locale,
  t,
  logo,
}: {
  locale: string;
  t: (key: string) => string;
  logo: string;
}) {
  return (
    <div
      lang={locale}
      dir={locale === "ar" ? "rtl" : "ltr"}
      style={{
        width: "100%",
        height: "100%",
        padding: "60px 78px",
        background: "radial-gradient(ellipse at top, #303b10, #10130c 78%)",
        color: "#f8f9f2",
        fontFamily: "Arial, Helvetica, sans-serif",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
      }}>
      <div dir="ltr" style={{ display: "flex", gap: 20, alignItems: "center", fontSize: 42, fontWeight: 600 }}>
        <img src={logo} alt="" width={68} height={68} style={{ borderRadius: 16 }} />
        <span>SimplePost</span>
      </div>
      <div
        style={{
          marginTop: 36,
          fontSize: 52,
          textWrap: "balance",
          wordBreak: locale === "ko" ? "keep-all" : "normal",
          lineHeight: 1.15,
          fontWeight: 600,
          letterSpacing: /^(ar|hi|ja|ko|zh-)/.test(locale) ? 0 : "-1.5px",
          color: "#c7ef1d",
        }}>
        {t("coreOgHeadline")}
      </div>
      <div
        style={{
          marginTop: 32,
          maxWidth: 1000,
          fontSize: 28,
          wordBreak: locale === "ko" ? "keep-all" : "normal",
          lineHeight: 1.4,
          color: "#cbcec3",
        }}>
        {t("coreOgDescription")}
      </div>
    </div>
  );
}
