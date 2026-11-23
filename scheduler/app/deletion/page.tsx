import Link from "next/link";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { UiCopy } from "@/components/ui-copy";
import { getUiCopy } from "@/lib/i18n/request-copy";

export default async function DataDeletionPage() {
  const { copy, locale } = await getUiCopy();
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-[10px]">
        <div className="max-w-4xl mx-auto px-[clamp(18px,4vw,48px)] h-14 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <img src="/simplepost-logo.png" alt="SimplePost" className="w-7 h-7 drop-shadow-lg" />
            <span className="font-mono text-sm font-medium text-foreground tracking-tight">SimplePost</span>
          </Link>
          <Link href="/">
            <Button variant="ghost" size="sm" className="gap-2">
              <svg className="h-3.5 w-3.5 rtl:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              <span className="font-mono text-[11px] uppercase tracking-[0.12em]">{copy("Back home")}</span>
            </Button>
          </Link>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-3xl mx-auto px-[clamp(18px,4vw,48px)] py-16">
        <div className="space-y-6">
          <div className="animate-reveal">
            <div className="section-kicker">
              <span className="section-kicker-dot" />
              <span className="section-kicker-label">{copy("Data deletion")}</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-[-0.03em] text-foreground mb-2">
              <UiCopy
                source="Request <part1>data deletion</part1>"
                components={{ part1: <span className="text-primary" /> }}
              />
            </h1>
            <p className="text-sm text-muted-foreground max-w-2xl">
              {copy(
                "We respect your privacy. This page explains how you can request deletion of your data from SimplePost.",
              )}{" "}
            </p>
          </div>

          <Alert>
            <AlertDescription>
              {copy(
                "This page is provided to comply with data protection regulations and platform policies (Facebook, Instagram, etc.). If you connected your social media accounts through SimplePost, you can request deletion of your data at any time.",
              )}{" "}
            </AlertDescription>
          </Alert>

          <Card>
            <CardHeader>
              <CardTitle>{copy("What Data We Collect")}</CardTitle>
              <CardDescription>{copy("Information stored when you use SimplePost")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <h4 className="font-medium text-foreground">{copy("Account Information")}</h4>
                <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-2">
                  <li>{copy("Email address and profile information")}</li>
                  <li>{copy("Connected social media account credentials (access tokens)")}</li>
                  <li>{copy("Social media account usernames and profile pictures")}</li>
                </ul>
              </div>
              <div className="space-y-2">
                <h4 className="font-medium text-foreground">{copy("Content Data")}</h4>
                <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-2">
                  <li>{copy("Scheduled posts (text content and metadata)")}</li>
                  <li>{copy("Uploaded media files (images and videos)")}</li>
                  <li>{copy("Post history and publishing status")}</li>
                </ul>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{copy("How to Delete Your Data")}</CardTitle>
              <CardDescription>{copy("Choose the appropriate method based on your needs")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <h4 className="font-semibold text-foreground flex items-center gap-2">
                  <UiCopy
                    source="<part1></part1>Disconnect Individual Social Media Accounts"
                    components={{
                      part1: (
                        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm">
                          {new Intl.NumberFormat(locale).format(1)}
                        </span>
                      ),
                    }}
                  />
                </h4>
                <p className="text-muted-foreground ms-8">
                  {copy(
                    "If you only want to remove specific social media connections while keeping your SimplePost account:",
                  )}{" "}
                </p>
                <ol className="list-decimal list-inside text-muted-foreground space-y-2 ms-8">
                  <li>{copy("Log in to your SimplePost account")}</li>
                  <li>{copy("Navigate to the Accounts page")}</li>
                  <li>{copy('Click "Disconnect" on any connected social media account')}</li>
                  <li>{copy("Confirm the disconnection")}</li>
                </ol>
                <Alert className="ms-8">
                  <AlertDescription className="text-sm">
                    {copy(
                      "This will immediately remove the connection and delete the stored access tokens for that account.",
                    )}{" "}
                  </AlertDescription>
                </Alert>
              </div>

              <div className="space-y-3">
                <h4 className="font-semibold text-foreground flex items-center gap-2">
                  <UiCopy
                    source="<part1></part1>Delete Your Entire SimplePost Account"
                    components={{
                      part1: (
                        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm">
                          {new Intl.NumberFormat(locale).format(2)}
                        </span>
                      ),
                    }}
                  />
                </h4>
                <p className="text-muted-foreground ms-8">
                  <UiCopy
                    source="Account deletion is currently handled as a verified support request. Send an email from your registered SimplePost address to <part1></part1>:"
                    components={{
                      part1: (
                        <a href="mailto:support@simplepost.social" className="text-primary hover:underline font-medium">
                          support@simplepost.social
                        </a>
                      ),
                    }}
                  />
                </p>
                <ol className="list-decimal list-inside text-muted-foreground space-y-2 ms-8">
                  <li>{copy('Use the subject line "Data Deletion Request"')}</li>
                  <li>{copy("State that you want your SimplePost account and associated data deleted")}</li>
                  <li>{copy("Include the email address used for your SimplePost account")}</li>
                  <li>{copy("Complete any identity verification requested by support")}</li>
                </ol>
                <Alert className="ms-8" variant="destructive">
                  <AlertDescription className="text-sm">
                    <UiCopy
                      source="<part1>Warning:</part1> This action is permanent and cannot be undone. All your posts, media files, and connected accounts will be permanently deleted."
                      components={{ part1: <strong /> }}
                    />
                  </AlertDescription>
                </Alert>
              </div>

              <div className="space-y-3">
                <h4 className="font-semibold text-foreground flex items-center gap-2">
                  <UiCopy
                    source="<part1></part1>If You Cannot Email From the Registered Address"
                    components={{
                      part1: (
                        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm">
                          {new Intl.NumberFormat(locale).format(3)}
                        </span>
                      ),
                    }}
                  />
                </h4>
                <p className="text-muted-foreground ms-8">
                  {copy(
                    "If you have lost access to the registered address, contact support and explain the situation. We may ask for additional information to verify that you control the account before deleting it.",
                  )}{" "}
                </p>
                <div className="ms-8 space-y-4">
                  <p className="text-muted-foreground">
                    <UiCopy
                      source="Send an email to <part1></part1>. Requests are normally completed within 30 days after identity verification. Billing, fraud prevention, tax, or other records may be retained where required by law."
                      components={{
                        part1: (
                          <a
                            href="mailto:support@simplepost.social"
                            className="text-primary hover:underline font-medium">
                            support@simplepost.social
                          </a>
                        ),
                      }}
                    />
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{copy("What Happens After Deletion")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-muted-foreground">{copy("When you delete your data or account:")}</p>
              <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-2">
                <li>
                  {copy(
                    "Your personal information is deleted or anonymized except where retention is legally required",
                  )}
                </li>
                <li>
                  {copy(
                    "Connected social media account tokens and SimplePost MCP, CLI, and API credentials are revoked",
                  )}
                </li>
                <li>{copy("All uploaded media files are deleted from our storage")}</li>
                <li>{copy("Scheduled posts and post history are permanently deleted")}</li>
                <li>{copy("You will no longer be able to log in or access SimplePost services")}</li>
              </ul>
              <Alert className="mt-4">
                <AlertDescription>
                  <UiCopy
                    source="<part1>Note:</part1> Content that was already published to your social media accounts will remain on those platforms. SimplePost cannot delete posts from external platforms after they've been published. You'll need to delete those posts directly from each platform."
                    components={{ part1: <strong /> }}
                  />
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{copy("Data Retention")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-muted-foreground">
                {copy("We may retain certain information for legal compliance purposes:")}
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-2">
                <li>
                  <UiCopy
                    source="<part1>Transaction logs:</part1> Retained for up to 90 days for security and fraud prevention"
                    components={{ part1: <strong /> }}
                  />
                </li>
                <li>
                  <UiCopy
                    source="<part1>Backup copies:</part1> May exist in system backups for up to 30 days before permanent deletion"
                    components={{ part1: <strong /> }}
                  />
                </li>
                <li>
                  <UiCopy
                    source="<part1>Legal obligations:</part1> Information required by law may be retained as necessary"
                    components={{ part1: <strong /> }}
                  />
                </li>
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{copy("Third-Party Data")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-muted-foreground">
                {copy(
                  "When you connect social media accounts, we receive access tokens from third-party platforms (Facebook, Instagram, X, YouTube, TikTok, Telegram). To fully remove your data:",
                )}{" "}
              </p>
              <ol className="list-decimal list-inside text-muted-foreground space-y-2 ml-2">
                <li>{copy("Delete or disconnect your accounts from SimplePost")}</li>
                <li>
                  {copy("Visit each social media platform's app settings and revoke SimplePost's access:")}{" "}
                  <ul className="list-disc list-inside ml-6 mt-2 space-y-1">
                    <li>{copy("Facebook: Settings → Apps and Websites")}</li>
                    <li>{copy("Instagram: Settings → Security → Apps and Websites")}</li>
                    <li>{copy("X (Twitter): Settings → Security and account access → Apps and sessions")}</li>
                    <li>
                      <UiCopy
                        source="Google/YouTube: revoke SimplePost access from the <part1>Google security settings connections page</part1>"
                        components={{
                          part1: (
                            <a
                              href="https://myaccount.google.com/connections?filters=3,4&hl=en"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline font-medium"
                            />
                          ),
                        }}
                      />
                    </li>
                    <li>{copy("TikTok: Settings → Security and privacy → Authorized apps")}</li>
                  </ul>
                </li>
              </ol>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{copy("Questions or Concerns?")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-muted-foreground">
                {copy("If you have any questions about data deletion or privacy, please contact us:")}{" "}
              </p>
              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <Button asChild className="gap-2 w-full sm:w-auto">
                  <a href="mailto:support@simplepost.social">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                      />
                    </svg>
                    support@simplepost.social{" "}
                  </a>
                </Button>
                <Link href="/privacy">
                  <Button variant="outline" className="gap-2 w-full sm:w-auto">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      />
                    </svg>
                    {copy("Privacy policy")}{" "}
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>

          <div className="text-center text-sm text-muted-foreground pt-6 pb-4">
            <p>{copy("Last updated: July 10, 2026")}</p>
          </div>
        </div>
      </main>
    </div>
  );
}
