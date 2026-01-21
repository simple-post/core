import Link from "next/link";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function DataDeletionPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/80 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto px-6 py-6">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="sm" className="gap-2">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                Back to Home
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              <img src="/simplepost-logo.png" alt="SimplePost Logo" className="w-7 h-7 drop-shadow-lg" />
              <h1 className="text-xl font-bold text-foreground">Data Deletion Instructions</h1>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-6 py-12">
        <div className="space-y-6">
          <div>
            <h2 className="text-3xl font-bold text-foreground mb-3">Request Data Deletion</h2>
            <p className="text-muted-foreground text-lg">
              We respect your privacy and are committed to protecting your personal data. This page explains how you can
              request deletion of your data from SimplePost.
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
                  To completely delete your SimplePost account and all associated data:
                </p>
                <ol className="list-decimal list-inside text-muted-foreground space-y-2 ml-8">
                  <li>Log in to your SimplePost account</li>
                  <li>Go to your account settings</li>
                  <li>Look for the "Delete Account" option</li>
                  <li>Follow the confirmation process</li>
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
                  Contact Us for Manual Deletion
                </h4>
                <p className="text-muted-foreground ml-8">
                  If you need assistance or prefer manual deletion of your data:
                </p>
                <div className="ml-8 space-y-4">
                  <p className="text-muted-foreground">
                    Send an email to{" "}
                    <a href="mailto:support@simplepost.dev" className="text-primary hover:underline font-medium">
                      support@simplepost.dev
                    </a>{" "}
                    with:
                  </p>
                  <ul className="list-disc list-inside text-muted-foreground space-y-1">
                    <li>Your registered email address</li>
                    <li>Subject line: "Data Deletion Request"</li>
                    <li>Clear statement that you want your data deleted</li>
                  </ul>
                  <p className="text-muted-foreground">
                    We will process your request within <strong>30 days</strong> and send you a confirmation email once
                    completed.
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
                <li>All your personal information is permanently removed from our databases</li>
                <li>Connected social media account tokens are immediately revoked and deleted</li>
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
                    <li>Google/YouTube: Account Settings → Security → Third-party apps</li>
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
              <div className="flex flex-col sm:flex-row gap-4 pt-2">
                <a
                  href="mailto:support@simplepost.dev"
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                    />
                  </svg>
                  support@simplepost.dev
                </a>
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
                    Privacy Policy
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>

          <div className="text-center text-sm text-muted-foreground pt-6 pb-4">
            <p>
              Last updated: {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
