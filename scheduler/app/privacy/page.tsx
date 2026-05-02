import Link from "next/link";

import { Button } from "@/components/ui/button";

export const metadata = {
  title: "Privacy Policy - Simple Post Scheduler",
  description: "Privacy policy for Simple Post Scheduler",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-[clamp(18px,4vw,48px)] py-16">
        <div className="mb-10 animate-reveal">
          <Link href="/">
            <Button variant="ghost" size="sm" className="gap-2 mb-6 -ml-2">
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              <span className="font-mono text-[11px] uppercase tracking-[0.12em]">Back to login</span>
            </Button>
          </Link>
          <div className="section-kicker">
            <span className="section-kicker-dot" />
            <span className="section-kicker-label">Legal</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-[-0.03em] text-foreground mb-2">
            Privacy <span className="text-primary">policy</span>
          </h1>
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            Last updated: April 26, 2026
          </p>
        </div>

        <div className="prose prose-neutral dark:prose-invert max-w-none space-y-8 text-foreground">
          <section>
            <h2 className="text-xl font-semibold tracking-[-0.025em] mb-3">1. Introduction</h2>
            <p className="text-muted-foreground leading-relaxed">
              Welcome to Simple Post Scheduler ("we," "our," or "us"). We respect your privacy and are committed to
              protecting your personal data. This privacy policy explains how we collect, use, disclose, and safeguard
              your information when you use our Service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold tracking-[-0.025em] mb-3">2. Information We Collect</h2>

            <h3 className="text-base font-semibold tracking-[-0.02em] mb-2 mt-5">2.1 Information You Provide</h3>
            <p className="text-muted-foreground leading-relaxed mb-3">
              We collect information that you provide directly to us, including:
            </p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
              <li>Account information (email address, name)</li>
              <li>Social media account credentials and access tokens</li>
              <li>Content you create, upload, or schedule (text, images, videos)</li>
              <li>
                Draft post text, target account IDs, scheduling mode, and scheduled times submitted through MCP clients
              </li>
              <li>Communications with us</li>
            </ul>

            <h3 className="text-base font-semibold tracking-[-0.02em] mb-2 mt-5">
              2.2 Automatically Collected Information
            </h3>
            <p className="text-muted-foreground leading-relaxed mb-3">
              When you use our Service, we automatically collect:
            </p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
              <li>Log data (IP address, browser type, pages visited, time and date of visits)</li>
              <li>Device information (device type, operating system)</li>
              <li>Usage information (features used, actions taken)</li>
              <li>Cookies and similar tracking technologies</li>
            </ul>

            <h3 className="text-base font-semibold tracking-[-0.02em] mb-2 mt-5">2.3 Information from Third Parties</h3>
            <p className="text-muted-foreground leading-relaxed">
              When you connect your social media accounts, we receive information from those platforms in accordance
              with their authorization procedures, including profile information and posting permissions.
            </p>

            <h3 className="text-base font-semibold tracking-[-0.02em] mb-2 mt-5">
              2.4 Information from AI and MCP Clients
            </h3>
            <p className="text-muted-foreground leading-relaxed">
              If you authorize ChatGPT or another Model Context Protocol client to use SimplePost, that client may send
              tool requests containing draft post text, selected SimplePost account IDs, posting mode, and scheduled
              time. SimplePost may return connected account metadata, validation results, previews, and posting results
              to the authorized client. We do not return social platform access tokens or credentials through MCP tools.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold tracking-[-0.025em] mb-3">3. How We Use Your Information</h2>
            <p className="text-muted-foreground leading-relaxed mb-3">We use the information we collect to:</p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
              <li>Provide, maintain, and improve the Service</li>
              <li>Schedule and publish your content to connected social media platforms</li>
              <li>Operate authorized MCP integrations such as the SimplePost ChatGPT app</li>
              <li>Send you technical notices, updates, and support messages</li>
              <li>Respond to your comments and questions</li>
              <li>Monitor and analyze trends, usage, and activities</li>
              <li>Detect, prevent, and address technical issues and security threats</li>
              <li>Comply with legal obligations</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold tracking-[-0.025em] mb-3">4. How We Share Your Information</h2>
            <p className="text-muted-foreground leading-relaxed mb-3">
              We may share your information in the following circumstances:
            </p>

            <h3 className="text-base font-semibold tracking-[-0.02em] mb-2 mt-5">4.1 With Social Media Platforms</h3>
            <p className="text-muted-foreground leading-relaxed">
              We share your content with the social media platforms you've connected to publish posts on your behalf.
            </p>

            <h3 className="text-base font-semibold tracking-[-0.02em] mb-2 mt-5">4.2 With Service Providers</h3>
            <p className="text-muted-foreground leading-relaxed">
              We may share your information with third-party service providers who perform services on our behalf, such
              as hosting, data storage, security, and analytics.
            </p>

            <h3 className="text-base font-semibold tracking-[-0.02em] mb-2 mt-5">4.3 With Authorized MCP Clients</h3>
            <p className="text-muted-foreground leading-relaxed">
              When you authorize an MCP client such as ChatGPT, we share tool responses with that client so it can show
              connected accounts, validation results, post previews, and publishing or scheduling results. You can
              revoke the connection from the client&apos;s app or connector settings.
            </p>

            <h3 className="text-base font-semibold tracking-[-0.02em] mb-2 mt-5">4.4 For Legal Purposes</h3>
            <p className="text-muted-foreground leading-relaxed">
              We may disclose your information if required by law or in response to valid legal requests, such as court
              orders or subpoenas.
            </p>

            <h3 className="text-base font-semibold tracking-[-0.02em] mb-2 mt-5">4.5 Business Transfers</h3>
            <p className="text-muted-foreground leading-relaxed">
              If we are involved in a merger, acquisition, or sale of assets, your information may be transferred as
              part of that transaction.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold tracking-[-0.025em] mb-3">5. Data Storage and Security</h2>
            <p className="text-muted-foreground leading-relaxed">
              We implement appropriate technical and organizational measures to protect your information against
              unauthorized access, alteration, disclosure, or destruction. However, no method of transmission over the
              internet or electronic storage is 100% secure, and we cannot guarantee absolute security.
            </p>
            <p className="text-muted-foreground leading-relaxed mt-4">
              Your data is stored on secure servers and may be processed in various locations where our service
              providers operate. We use encryption for data in transit and at rest where applicable.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold tracking-[-0.025em] mb-3">6. Data Retention</h2>
            <p className="text-muted-foreground leading-relaxed">
              We retain your information for as long as necessary to provide the Service and fulfill the purposes
              outlined in this privacy policy. When you delete your account, we will delete or anonymize your personal
              information, except where we are required to retain it for legal or compliance purposes.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold tracking-[-0.025em] mb-3">7. Your Rights and Choices</h2>
            <p className="text-muted-foreground leading-relaxed mb-3">
              Depending on your location, you may have certain rights regarding your personal information:
            </p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
              <li>Access and receive a copy of your personal information</li>
              <li>Correct inaccurate or incomplete information</li>
              <li>Request deletion of your information</li>
              <li>Object to or restrict certain processing of your information</li>
              <li>Data portability</li>
              <li>Withdraw consent where processing is based on consent</li>
            </ul>
            <p className="text-muted-foreground leading-relaxed mt-4">
              To exercise these rights, please contact us through the application. You can also disconnect your social
              media accounts, disconnect authorized MCP clients from their app or connector settings, and delete your
              account at any time through the settings.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold tracking-[-0.025em] mb-3">8. Cookies and Tracking Technologies</h2>
            <p className="text-muted-foreground leading-relaxed">
              We use cookies and similar tracking technologies to track activity on our Service and hold certain
              information. Cookies are files with a small amount of data that may include an anonymous unique
              identifier. You can instruct your browser to refuse all cookies or to indicate when a cookie is being
              sent. However, if you do not accept cookies, you may not be able to use some portions of our Service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold tracking-[-0.025em] mb-3">9. Third-Party Links</h2>
            <p className="text-muted-foreground leading-relaxed">
              Our Service may contain links to third-party websites or services that are not owned or controlled by us.
              We have no control over and assume no responsibility for the content, privacy policies, or practices of
              any third-party sites or services. We encourage you to review the privacy policies of these third parties.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold tracking-[-0.025em] mb-3">10. Children's Privacy</h2>
            <p className="text-muted-foreground leading-relaxed">
              Our Service is not intended for children under the age of 13. We do not knowingly collect personal
              information from children under 13. If you become aware that a child has provided us with personal
              information, please contact us. If we discover that we have collected personal information from a child
              under 13, we will take steps to delete that information.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold tracking-[-0.025em] mb-3">11. International Data Transfers</h2>
            <p className="text-muted-foreground leading-relaxed">
              Your information may be transferred to and processed in countries other than your country of residence.
              These countries may have data protection laws that are different from the laws of your country. We take
              appropriate safeguards to ensure that your information remains protected in accordance with this privacy
              policy.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold tracking-[-0.025em] mb-3">12. Changes to This Privacy Policy</h2>
            <p className="text-muted-foreground leading-relaxed">
              We may update this privacy policy from time to time. We will notify you of any changes by posting the new
              privacy policy on this page and updating the "Last updated" date. We encourage you to review this privacy
              policy periodically for any changes.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold tracking-[-0.025em] mb-3">13. Contact Us</h2>
            <p className="text-muted-foreground leading-relaxed">
              If you have any questions about this privacy policy or our privacy practices, please contact us through
              the appropriate channels provided in the application.
            </p>
          </section>
        </div>

        <div className="mt-12 pt-8 border-t border-border">
          <Link href="/">
            <Button variant="outline" className="gap-2">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to login
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
