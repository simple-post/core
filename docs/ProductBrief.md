# UbsubPost \- Product Brief

## I. Project Concept

The project, named **UbsubPost**, is a software library designed for publishing various types of content (text, images, video) across multiple social media platforms. Supported platforms include:

- X (formerly Twitter)
- YouTube (including YouTube Shorts)
- Facebook Pages
- Instagram (including Instagram Threads)
- TikTok
- Pinterest
- LinkedIn
- Other relevant platforms as they emerge

## II. Problem Addressed

This library aims to provide an alternative to existing solutions:

- **Direct Social Media APIs:**
  - Challenging due to highly varied implementations across platforms.
  - Lack of SDKs for some platforms.
  - Complex and time-consuming setup for authentication, API keys, often requiring creation of separate "apps."
- **Existing API Services:**
  - Offer ease of use (simple API calls after initial setup).
  - Major drawback: Require ongoing subscription payments, which can be expensive.
- **UI-based Scheduling Services:** Some offer APIs but share similar limitations.

## III. Proposed Solution & Unique Selling Proposition (USP)

- **Product Name:** **UbsubPost**. The name is derived from "unsubscribe," highlighting the core benefit of helping users unsubscribe from recurring monthly fees.
- **Model:** A software library offered with a **one-time payment**. Users pay for the product itself, not an ongoing service.
- **Delivery:** Purchasers receive access to a **private GitHub repository** containing all the code, which they can use as they wish.
- **Core Benefit:** A cost-effective solution providing developers with full control over their social media publishing integration, avoiding recurring fees and vendor lock-in.

## IV. Product Components

The private GitHub repository will include:

1. **Unified TypeScript Library:**

   - Contains classes and logic for publishing content.
   - Features a unified abstraction layer, providing a consistent interface for developers across all supported social media platforms.
   - Designed for ease of use by developers.
   - Can be integrated as a private NPM package into other applications.

2. **Wrappers for Automation Platforms:**

   - **Initial Support:** N8n (custom private N8n nodes for publishing).
   - **Future Expansion:** Support for other automation platforms like Airtable, Make, and others.
   - **Goal:** Enable easy integration into various automated pipelines and workflows.

3. **The Magic OAuth Helper & Configuration Tools (Key Value Proposition):**
   - This component is the product's core differentiator and primary value driver.
   - **Focus:** Simplifying the difficult and poorly documented setup of API keys and authentication tokens for social media platforms.
   - **Objective:** To make the setup process extremely simple for developers, turning a multi-day task into a process that takes minutes.
   - **Tools Provided:**
     - An internal application/page with implemented OAuth2 flows.
     - Simple "Connect" buttons (e.g., "Connect YouTube," "Connect X") for one-click OAuth2 approval, handling the complex token exchange in the background.

## V. Pre-Launch Go-to-Market Strategy

### Sales Strategy: Pre-Launch Founder's Offer

Instead of a waitlist, the product will be sold directly from a landing page before it is fully complete. This approach allows for early revenue generation and community building. Early adopters, or "Founding Members," will be offered a **50% lifetime discount** as an incentive to purchase during the pre-launch phase.

### Pricing Tiers

The product will launch with two distinct tiers:

1. **Base Tier**

   - **Pre-launch Price:** **$99**
   - **Regular Price:** $199
   - **Includes:**
     - Lifetime access to the UbsubPost Library
     - The Magic OAuth Helper tool
     - N8n wrapper
     - Access to the code upon v1.0 release
     - 1 year of product updates

2. **Premium Tier**
   - **Pre-launch Price:** **$199**
   - **Regular Price:** $399
   - **Includes:**
     - Everything in the Base tier, plus:
     - **Immediate Early Access** to the private GitHub repository
     - **Direct 1-on-1 Support** from the founder
     - **Priority Feature Requests** (influence the product roadmap)
     - **Lifetime** product updates
