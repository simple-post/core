// Cloudflare rewrites bare email text into links before React hydrates the page.
// Emit its documented exemption comments as HTML; JSX comments are not emitted.
// https://developers.cloudflare.com/waf/tools/scrape-shield/email-address-obfuscation/#prevent-cloudflare-from-obfuscating-email
const supportEmailHtml = { __html: "<!--email_off-->support@simplepost.social<!--/email_off-->" };

export function SupportEmail() {
  // This HTML is a fixed application constant and never contains user input.
  return <span dangerouslySetInnerHTML={supportEmailHtml} />;
}
