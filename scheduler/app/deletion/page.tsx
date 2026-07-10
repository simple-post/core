import Link from "next/link";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function DataDeletionPage() {
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
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              <span className="font-mono text-[11px] uppercase tracking-[0.12em]">Back home</span>
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
              <span className="section-kicker-label">Data deletion</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-[-0.03em] text-foreground mb-2">
              Request <span className="text-primary">data deletion</span>
            </h1>
            <p className="text-sm text-muted-foreground max-w-2xl">
              We respect your privacy. This page explains how you can request deletion of your data from SimplePost.
            </p>
          </div>

          <Alert>
            <AlertDescription>
              This page is provided to comply with data protection regulations and platform policies (Facebook,
              Instagram, etc.). If you connected your social media accounts through SimplePost, you can request deletion
              of your data at any time.
            </AlertDescription>
          </Alert>

          <Card>
            <CardHeader>
              <CardTitle>What Data We Collect</CardTitle>
              <CardDescription>Information stored when you use SimplePost</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <h4 className="font-medium text-foreground">Account Information</h4>
                <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-2">
                  <li>Email address and profile information</li>
                  <li>Connected social media account credentials (access tokens)</li>
                  <li>Social media account usernames and profile pictures</li>
                </ul>
              </div>
              <div className="space-y-2">
                <h4 className="font-medium text-foreground">Content Data</h4>
                <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-2">
                  <li>Scheduled posts (text content and metadata)</li>
                  <li>Uploaded media files (images and videos)</li>
                  <li>Post history and publishing status</li>
                </ul>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>How to Delete Your Data</CardTitle>
              <CardDescription>Choose the appropriate method based on your needs</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <h4 className="font-semibold text-foreground flex items-center gap-2">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm">
                    1
                  </span>
                  Disconnect Individual Social Media Accounts
                </h4>
                <p className="text-muted-foreground ml-8">
                  If you only want to remove specific social media connections while keeping your SimplePost account:
                </p>
                <ol className="list-decimal list-inside text-muted-foreground space-y-2 ml-8">
                  <li>Log in to your SimplePost account</li>
                  <li>Navigate to the Accounts page</li>
                  <li>Click "Disconnect" on any connected social media account</li>
                  <li>Confirm the disconnection</li>
                </ol>
                <Alert className="ml-8">
                  <AlertDescription className="text-sm">
                    This will immediately remove the connection and delete the stored access tokens for that account.
                  </AlertDescription>
                </Alert>
              </div>

              <div className="space-y-3">
                <h4 className="font-semibold text-foreground flex items-center gap-2">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm">
                    2
                  </span>
                  Delete Your Entire SimplePost Account
                </h4>
                <p className="text-muted-foreground ml-8">
                  Account deletion is currently handled as a verified support request. Send an email from your
                  registered SimplePost address to{" "}
                  <a href="mailto:support@simplepost.social" className="text-primary hover:underline font-medium">
                    support@simplepost.social
                  </a>
                  :
                </p>
                <ol className="list-decimal list-inside text-muted-foreground space-y-2 ml-8">
                  <li>Use the subject line "Data Deletion Request"</li>
                  <li>State that you want your SimplePost account and associated data deleted</li>
                  <li>Include the email address used for your SimplePost account</li>
                  <li>Complete any identity verification requested by support</li>
                </ol>
                <Alert className="ml-8" variant="destructive">
                  <AlertDescription className="text-sm">
                    <strong>Warning:</strong> This action is permanent and cannot be undone. All your posts, media
                    files, and connected accounts will be permanently deleted.
                  </AlertDescription>
                </Alert>
              </div>

              <div className="space-y-3">
                <h4 className="font-semibold text-foreground flex items-center gap-2">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm">
                    3
                  </span>
                  If You Cannot Email From the Registered Address
                </h4>
                <p className="text-muted-foreground ml-8">
                  If you have lost access to the registered address, contact support and explain the situation. We may
                  ask for additional information to verify that you control the account before deleting it.
                </p>
                <div className="ml-8 space-y-4">
                  <p className="text-muted-foreground">
                    Send an email to{" "}
                    <a href="mailto:support@simplepost.social" className="text-primary hover:underline font-medium">
                      support@simplepost.social
                    </a>
                    . Requests are normally completed within 30 days after identity verification. Billing, fraud
                    prevention, tax, or other records may be retained where required by law.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>What Happens After Deletion</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-muted-foreground">When you delete your data or account:</p>
              <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-2">
                <li>Your personal information is deleted or anonymized except where retention is legally required</li>
                <li>Connected social media account tokens and SimplePost MCP, CLI, and API credentials are revoked</li>
                <li>All uploaded media files are deleted from our storage</li>
                <li>Scheduled posts and post history are permanently deleted</li>
                <li>You will no longer be able to log in or access SimplePost services</li>
              </ul>
              <Alert className="mt-4">
                <AlertDescription>
                  <strong>Note:</strong> Content that was already published to your social media accounts will remain on
                  those platforms. SimplePost cannot delete posts from external platforms after they've been published.
                  You'll need to delete those posts directly from each platform.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Data Retention</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-muted-foreground">We may retain certain information for legal compliance purposes:</p>
              <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-2">
                <li>
                  <strong>Transaction logs:</strong> Retained for up to 90 days for security and fraud prevention
                </li>
                <li>
                  <strong>Backup copies:</strong> May exist in system backups for up to 30 days before permanent
                  deletion
                </li>
                <li>
                  <strong>Legal obligations:</strong> Information required by law may be retained as necessary
                </li>
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Third-Party Data</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-muted-foreground">
                When you connect social media accounts, we receive access tokens from third-party platforms (Facebook,
                Instagram, X, YouTube, TikTok, Telegram). To fully remove your data:
              </p>
              <ol className="list-decimal list-inside text-muted-foreground space-y-2 ml-2">
                <li>Delete or disconnect your accounts from SimplePost</li>
                <li>
                  Visit each social media platform's app settings and revoke SimplePost's access:
                  <ul className="list-disc list-inside ml-6 mt-2 space-y-1">
                    <li>Facebook: Settings → Apps and Websites</li>
                    <li>Instagram: Settings → Security → Apps and Websites</li>
                    <li>X (Twitter): Settings → Security and account access → Apps and sessions</li>
                    <li>
                      Google/YouTube: revoke SimplePost access from the{" "}
                      <a
                        href="https://myaccount.google.com/connections?filters=3,4&hl=en"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline font-medium">
                        Google security settings connections page
                      </a>
                    </li>
                    <li>TikTok: Settings → Security and privacy → Authorized apps</li>
                  </ul>
                </li>
              </ol>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Questions or Concerns?</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-muted-foreground">
                If you have any questions about data deletion or privacy, please contact us:
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
                    support@simplepost.social
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
                    Privacy policy
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>

          <div className="text-center text-sm text-muted-foreground pt-6 pb-4">
            <p>Last updated: July 10, 2026</p>
          </div>
        </div>
      </main>
    </div>
  );
}
