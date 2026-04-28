import Link from "next/link";

import { Button } from "@/components/ui/button";

export const metadata = {
  title: "Terms and Conditions - Simple Post Scheduler",
  description: "Terms and conditions for using Simple Post Scheduler",
};

export default function TermsPage() {
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
            Terms &amp; <span className="text-primary">conditions</span>
          </h1>
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            Last updated: April 26, 2026
          </p>
        </div>

        <div className="prose prose-neutral dark:prose-invert max-w-none space-y-8 text-foreground">
          <section>
            <h2 className="text-xl font-semibold tracking-[-0.025em] mb-3">1. Acceptance of Terms</h2>
            <p className="text-muted-foreground leading-relaxed">
              By accessing and using Simple Post Scheduler ("the Service"), you accept and agree to be bound by the
              terms and provision of this agreement. If you do not agree to these terms, please do not use the Service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold tracking-[-0.025em] mb-3">2. Description of Service</h2>
            <p className="text-muted-foreground leading-relaxed">
              Simple Post Scheduler is a social media scheduling platform that allows users to create, schedule, and
              publish content across multiple social media platforms. The Service provides tools for managing social
              media accounts and scheduling posts in advance, including optional integrations with authorized Model
              Context Protocol clients such as ChatGPT.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold tracking-[-0.025em] mb-3">3. User Accounts</h2>
            <p className="text-muted-foreground leading-relaxed mb-3">
              To use the Service, you must create an account. You agree to:
            </p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
              <li>Provide accurate, current, and complete information during the registration process</li>
              <li>Maintain and promptly update your account information</li>
              <li>Maintain the security of your account credentials</li>
              <li>Accept responsibility for all activities that occur under your account</li>
              <li>Notify us immediately of any unauthorized use of your account</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold tracking-[-0.025em] mb-3">4. Connected Social Media Accounts</h2>
            <p className="text-muted-foreground leading-relaxed">
              When you connect your social media accounts to the Service, you grant us permission to access and post
              content on your behalf. You are solely responsible for the content you create and publish through the
              Service. You must ensure that you have the necessary rights and permissions for all content you schedule.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold tracking-[-0.025em] mb-3">5. AI and MCP Client Integrations</h2>
            <p className="text-muted-foreground leading-relaxed">
              If you authorize ChatGPT or another MCP client to access SimplePost, that client may ask SimplePost to
              list connected accounts, validate draft content, preview a post, or create and schedule posts. Publishing
              or scheduling through an MCP client is still your responsibility. Review tool-call details before
              approving any action that creates or publishes content.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold tracking-[-0.025em] mb-3">6. Acceptable Use</h2>
            <p className="text-muted-foreground leading-relaxed mb-3">You agree not to use the Service to:</p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
              <li>
                Post content that is illegal, harmful, threatening, abusive, harassing, or otherwise objectionable
              </li>
              <li>Violate any applicable laws or regulations</li>
              <li>Infringe upon the intellectual property rights of others</li>
              <li>Transmit spam, viruses, or any other malicious code</li>
              <li>Attempt to gain unauthorized access to the Service or related systems</li>
              <li>Interfere with or disrupt the Service or servers connected to the Service</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold tracking-[-0.025em] mb-3">7. Content Ownership and Rights</h2>
            <p className="text-muted-foreground leading-relaxed">
              You retain all rights to the content you create and upload to the Service. By using the Service, you grant
              us a limited license to store, process, and transmit your content solely for the purpose of providing the
              Service to you.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold tracking-[-0.025em] mb-3">8. Service Availability</h2>
            <p className="text-muted-foreground leading-relaxed">
              While we strive to provide reliable service, we do not guarantee that the Service will be available at all
              times. The Service may be subject to interruptions, delays, or failures due to maintenance, updates, or
              circumstances beyond our control. We are not liable for any issues arising from service unavailability.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold tracking-[-0.025em] mb-3">9. Third-Party Services</h2>
            <p className="text-muted-foreground leading-relaxed">
              The Service integrates with third-party social media platforms. Your use of these platforms is subject to
              their respective terms of service and privacy policies. We are not responsible for the actions, content,
              or policies of these third-party services.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold tracking-[-0.025em] mb-3">10. Termination</h2>
            <p className="text-muted-foreground leading-relaxed">
              We reserve the right to suspend or terminate your account and access to the Service at our sole
              discretion, without notice, for conduct that we believe violates these Terms or is harmful to other users,
              us, or third parties, or for any other reason.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold tracking-[-0.025em] mb-3">11. Disclaimer of Warranties</h2>
            <p className="text-muted-foreground leading-relaxed">
              THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR
              IMPLIED. WE DISCLAIM ALL WARRANTIES, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY,
              FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold tracking-[-0.025em] mb-3">12. Limitation of Liability</h2>
            <p className="text-muted-foreground leading-relaxed">
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL,
              CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS OR REVENUES, WHETHER INCURRED DIRECTLY OR
              INDIRECTLY, OR ANY LOSS OF DATA, USE, OR OTHER INTANGIBLE LOSSES.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold tracking-[-0.025em] mb-3">13. Changes to Terms</h2>
            <p className="text-muted-foreground leading-relaxed">
              We reserve the right to modify these Terms at any time. We will notify users of any material changes by
              updating the "Last updated" date at the top of this page. Your continued use of the Service after such
              changes constitutes your acceptance of the new Terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold tracking-[-0.025em] mb-3">14. Contact Information</h2>
            <p className="text-muted-foreground leading-relaxed">
              If you have any questions about these Terms, please contact us through the appropriate channels provided
              in the application.
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
