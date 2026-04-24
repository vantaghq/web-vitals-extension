# Web Vitals Chrome Extension

A comprehensive Chrome extension to measure **Core Web Vitals**, analyze **SEO**, audit **Accessibility**, inspect **Server & DNS** information, and detect the **Technology Stack** of any website — all in one popup.

![Web Vitals Extension](media/cwv-extension-drilldown.png)

---

## Overview

This extension provides a complete toolkit for web developers, SEO professionals, and system administrators to analyze any website instantly. It combines real-time **Core Web Vitals** monitoring with deep-dive diagnostics across six specialized tabs.

All analyses run directly in your browser. No data is sent to third-party servers except for the public APIs used to fetch field data and server information.

---

## Features

### Six-Tab Diagnostic Interface

| Tab | What it does |
|-----|-------------|
| **Web Vitals** | Real-time Core Web Vitals (LCP, CLS, INP, FCP, TTFB) with CrUX field data comparison and actionable fix suggestions |
| **Server Info** | IP geolocation, ISP, ASN, timezone, and hosting details |
| **DNS Info** | A, AAAA, MX, NS, TXT, SOA, CNAME records and subdomain discovery |
| **SEO** | On-page SEO audit with score, Domain Authority/Rating estimation, structured data, Open Graph, and fix suggestions |
| **Tech Stack** | Automatic detection of CMS, frameworks, analytics, fonts, and server technologies |
| **A11y** | Accessibility audit with WCAG level estimation, issue detection, and actionable fix suggestions |

### Export Reports

Click the **download button** in the popup header to export a complete **Markdown report** with all tabs' data — even tabs you haven't opened yet are auto-loaded before export so nothing is missing.

### Dark & Light Mode

Toggle between dark and light themes. Your preference is saved across sessions.

### Side Panel Support

Click the side-panel icon to open the extension in Chrome's side panel (Chrome 114+).

---

## Usage

1. Install the extension from the Chrome Web Store or load it unpacked in `chrome://extensions`.
2. Visit any website.
3. Click the **Web Vitals** icon in your toolbar.
4. Browse the six tabs to analyze the page.
5. Click the **download icon** to export a Markdown report.

### Tab Details

#### Web Vitals
- Displays **LCP**, **CLS**, **INP**, **FCP**, and **TTFB** with color-coded ratings (good / needs improvement / poor).
- Compares your local metrics against real-user data from the **Chrome User Experience Report (CrUX)**.
- **Fix Suggestions** appear automatically when a metric is poor or needs improvement, with specific actionable advice (e.g., "Preload your hero image" or "Reserve space for ads to reduce layout shift").

#### Server Info
- IP address and geographic location (country, region, city).
- ISP, organization, and ASN.
- Server timezone and hostname.

#### DNS Info
- Complete DNS record lookup via Google Public DNS.
- A/AAAA, MX, NS, TXT, SOA, CNAME records.
- Discovered subdomains (when available).

#### SEO
- **SEO Score** (0-100) based on title, meta description, headings, images, structured data, Open Graph, security headers, and more.
- **Domain Authority** and **Domain Rating** estimations based on domain characteristics and security configuration.
- Content analysis: word count, heading structure, image alt text, internal/external links.
- **Fix Suggestions** for every issue found (e.g., "Your meta description is 180 characters. The recommended limit is 160.").

#### Tech Stack
- Detects CMS/SSGs (WordPress, Next.js, Hugo, etc.).
- Server software (Nginx, Apache, etc.).
- JavaScript frameworks and libraries.
- Analytics and marketing tools.
- Font providers.

#### Accessibility (A11y)
- **A11y Score** (0-100) with estimated WCAG compliance level (A, AA, AAA).
- Detects missing alt text, empty links/buttons, unlabeled form inputs, skipped heading levels, missing landmarks, and positive tabindex values.
- **Fix Suggestions** explain exactly how to fix each issue (e.g., "3 images are missing alt text. Add `alt=\"\"` for decorative images and descriptive alt for informative ones.").

---

## Architecture

```
src/
  browser_action/
    popup.html          — Six-tab popup UI
    popup.js            — Tab controller, rendering, export logic
    core.css            — All styles (dark/light mode, cards, scores)
    vitals.js           — Content script: collects Web Vitals via web-vitals.js
    metric.js           — Metric class (LCP, CLS, INP, FCP, TTFB)
    crux.js             — Chrome UX Report API integration
    server-info.js      — IP geolocation via ipwhois.app
    dns-info.js         — DNS lookup via Google Public DNS
    seo-info.js         — On-page SEO analysis + scoring + fix suggestions
    tech-info.js        — Technology detection from headers + DOM
    a11y-info.js        — Accessibility audit + fix suggestions
    chrome.js           — Chrome storage helpers
    web-vitals.js       — Bundled web-vitals library
    on-each-interaction.js — INP interaction tracking
    lodash-debounce-custom.js — CLS debouncing
    viewer.css          — Overlay styles
    options/            — Extension options page
  options/              — Options UI
service_worker.js       — Badge updates, tab management, header capture
```

---

## Development

### Prerequisites

- Node.js 18+
- Chrome 114+ (for side panel support)

### Setup

```bash
git clone https://github.com/VANTAGhq/web-vitals-extension.git
cd web-vitals-extension
npm install
npm run build   # Copies web-vitals.js into src/browser_action/
```

### Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the project root directory

### Build

```bash
npm run build
```

This copies `node_modules/web-vitals/dist/web-vitals.attribution.js` into `src/browser_action/web-vitals.js`.

### Lint

```bash
npm run lint
```

---

## APIs Used

| API | Purpose | Authentication |
|-----|---------|----------------|
| [Chrome UX Report (CrUX)](https://developer.chrome.com/docs/crux) | Field performance data | Public API key (bundled) |
| [ipwhois.app](https://ipwhois.app) | IP geolocation | None |
| [Google Public DNS](https://dns.google) | DNS record lookup | None |
| [Mozilla HTTP Observatory](https://http-observatory.security.mozilla.org) | Security headers scan | None |
| [RDAP.org](https://rdap.org) | Domain registration data | None |

No private API keys are required. The CrUX API key bundled in the extension is a public Google API key that works only from the extension context, matching the behavior of the original Google Web Vitals extension.

---

## Privacy

- All analyses run locally in your browser.
- Metrics are fetched from public APIs only.
- No personal data, browsing history, or metrics are sent to any server owned by the extension authors.
- The extension does not track you or collect analytics.

---

## Version History

### v2.5.0
- **Fix Suggestions**: Added actionable recommendations to Web Vitals, SEO, and A11y tabs.
- **Export Reports**: One-click Markdown export with auto-loading of all tabs.
- **Dark/Light Mode**: Persistent theme toggle across all pages.
- **Side Panel**: Full support for Chrome side panel (Chrome 114+).
- **Domain-based history removed**: Replaced with per-session, on-demand analysis for better privacy and performance.
- **UI Polish**: Shadcn-inspired card layouts, responsive design, improved color hierarchy.

### v2.0.0
- Added 5 new diagnostic tabs: Server Info, DNS Info, SEO, Tech Stack, A11y.
- Modern UI redesign with dark/light mode.
- Removed end-of-life notice from original Google extension.

### v1.x
- Original Google Web Vitals extension.
- Core Web Vitals monitoring with badge and overlay.

---

## FAQ

**Who is this extension for?**

Web developers, SEO professionals, system administrators, and anyone who wants to understand the performance, accessibility, and infrastructure of a website at a glance.

**Are the metrics from my machine or from real users?**

The **local metrics** are from your machine. The extension also fetches **field data** from the Chrome User Experience Report (CrUX), which reflects real-user experiences across the globe.

**Do I need an API key?**

No. All APIs used are public and do not require user configuration.

**Can I use this in the side panel?**

Yes. Click the side-panel icon in the popup header (requires Chrome 114+).

**How do I interpret the metrics?**

- **Good** (green): The page passes the recommended threshold.
- **Needs Improvement** (orange): The page is close but not optimal.
- **Poor** (red): The page fails the threshold and needs attention.

For optimization guides, see:
- [Optimize LCP](https://web.dev/articles/optimize-lcp)
- [Optimize CLS](https://web.dev/articles/optimize-cls)
- [Optimize INP](https://web.dev/articles/optimize-inp)

---

## Contributing

Bug reports and suggestions are welcome at [GitHub Issues](https://github.com/VANTAGhq/web-vitals-extension/issues).

For metric measurement discussions, use [GitHub Discussions](https://github.com/orgs/VANTAGhq/discussions).

---

## License

[Apache 2.0](/LICENSE)

---

Maintained by [vantag.es](https://vantag.es/) | [Report Issues](https://github.com/VANTAGhq/web-vitals-extension/issues)
