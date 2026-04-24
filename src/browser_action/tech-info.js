/*
 Tech Stack Information Module
 Detects technologies used on the current page
*/

export class TechInfo {
    static async load(url) {
        try {
            // Get active tab to extract tech information
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

            if (!tab?.id) {
                throw new Error('Unable to access current tab');
            }

            // Execute script in the page to extract DOM-based tech data
            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: extractTechData,
                world: 'MAIN', // We need access to the main world to check window variables
            });

            if (!results || !results[0]) {
                throw new Error('Unable to extract tech data');
            }

            const domData = results[0].result;

            // Fetch headers for Server/Backend info
            const headerData = await fetchHeaders(url);

            // Merge data
            return {
                cms: [...new Set([...domData.cms, ...headerData.cms])],
                frameworks: [...new Set(domData.frameworks)],
                server: headerData.server,
                language: headerData.language,
                analytics: [...new Set(domData.analytics)],
                fonts: [...new Set(domData.fonts)],
                databases: headerData.databases, // Usually inferred from headers
            };

        } catch (error) {
            console.error('Tech Info error:', error);
            // Return empty data on error to avoid breaking the UI
            return {
                cms: [],
                frameworks: [],
                server: 'Unknown',
                language: 'Unknown',
                analytics: [],
                fonts: [],
                databases: [],
            };
        }
    }
}

async function fetchHeaders(url) {
    const data = {
        server: 'Unknown',
        language: 'Unknown',
        cms: [],
        databases: [],
    };

    try {
        // Use chrome.debugger API to get actual response headers
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!tab?.id) {
            throw new Error('Unable to access current tab');
        }

        // Try to get headers from webRequest API stored in background
        // This is a simpler approach than debugger API
        const response = await chrome.runtime.sendMessage({
            type: 'GET_RESPONSE_HEADERS',
            url: url
        });

        if (response && response.headers) {
            const headers = response.headers;

            // Server
            const serverHeader = headers['server'];
            if (serverHeader) {
                data.server = serverHeader;
            }

            // X-Powered-By (Language/CMS)
            const poweredBy = headers['x-powered-by'];
            if (poweredBy) {
                if (poweredBy.includes('PHP')) {
                    data.language = poweredBy;
                } else if (poweredBy.includes('ASP.NET')) {
                    data.language = 'ASP.NET';
                } else if (poweredBy.includes('Express')) {
                    data.server = `Express (Node.js)`;
                    data.language = 'Node.js';
                } else if (poweredBy.includes('Next.js')) {
                    data.cms.push('Next.js');
                    data.language = 'Node.js';
                }
            }

            // X-Generator (CMS)
            const generator = headers['x-generator'];
            if (generator) {
                data.cms.push(generator);
            }

            // Additional language detection from content-type
            const contentType = headers['content-type'];
            if (contentType) {
                if (contentType.includes('application/json') && data.language === 'Unknown') {
                    data.language = 'API/JSON';
                }
            }
        }

    } catch (e) {
        console.warn('Failed to fetch headers:', e);
        // Fallback: try basic detection from URL and DOM
        try {
            const urlObj = new URL(url);

            // Common backend patterns from URL
            if (urlObj.pathname.includes('.php')) {
                data.language = 'PHP';
            } else if (urlObj.pathname.includes('.asp') || urlObj.pathname.includes('.aspx')) {
                data.language = 'ASP.NET';
            } else if (urlObj.pathname.includes('.jsp')) {
                data.language = 'Java';
            }
        } catch (urlError) {
            // URL parsing failed, keep defaults
        }
    }

    return data;
}

function extractTechData() {
    const data = {
        cms: [],
        frameworks: [],
        analytics: [],
        fonts: [],
    };

    // Helper to add unique items
    const add = (category, item) => {
        if (item && !data[category].includes(item)) {
            data[category].push(item);
        }
    };

    // --- CMS Detection ---

    // Meta Generator
    const generator = document.querySelector('meta[name="generator"]');
    if (generator?.content) {
        add('cms', generator.content);
    }

    // WordPress
    if (window.wp || document.querySelector('link[href*="wp-content"]')) {
        add('cms', 'WordPress');
    }

    // Drupal
    if (window.Drupal || document.querySelector('script[src*="drupal.js"]')) {
        add('cms', 'Drupal');
    }

    // Shopify
    if (window.Shopify) {
        add('cms', 'Shopify');
    }

    // Joomla
    if (document.querySelector('meta[content*="Joomla"]')) {
        add('cms', 'Joomla');
    }

    // Squarespace
    if (window.Static?.SQUARESPACE_CONTEXT) {
        add('cms', 'Squarespace');
    }

    // Wix
    if (window.wix || document.querySelector('meta[content*="Wix.com"]')) {
        add('cms', 'Wix');
    }

    // --- Frameworks & Libraries ---

    // React
    if (
        document.querySelector('[data-reactroot]') ||
        document.querySelector('[data-reactid]') ||
        window.React ||
        (window.__REACT_DEVTOOLS_GLOBAL_HOOK__ && window.__REACT_DEVTOOLS_GLOBAL_HOOK__.renderers.size > 0)
    ) {
        add('frameworks', 'React');
    }

    // Vue
    if (
        window.Vue ||
        window.__VUE__ ||
        document.querySelector('[vue-id]') ||
        document.querySelector('[data-v-app]') ||
        document.querySelector('[data-v-]')
    ) {
        add('frameworks', 'Vue.js');
    }

    // Angular
    if (
        window.angular ||
        document.querySelector('[ng-app]') ||
        document.querySelector('[ng-version]')
    ) {
        add('frameworks', 'Angular');
    }

    // Svelte
    if (window.__svelte) {
        add('frameworks', 'Svelte');
    }

    // jQuery
    if (window.jQuery || window.$?.fn?.jquery) {
        const version = window.jQuery?.fn?.jquery || window.$?.fn?.jquery || '';
        add('frameworks', `jQuery ${version}`);
    }

    // Bootstrap
    if (
        window.bootstrap ||
        document.querySelector('link[href*="bootstrap"]') ||
        document.querySelector('[class*="col-md-"]')
    ) {
        add('frameworks', 'Bootstrap');
    }

    // Tailwind CSS
    // Hard to detect reliably in production as classes are utility-based, 
    // but sometimes we can guess if we see many `text-`, `bg-`, `p-` classes.
    // Skipping for now to avoid false positives.

    // Next.js
    if (window.__NEXT_DATA__ || document.querySelector('#__next')) {
        add('frameworks', 'Next.js');
    }

    // Nuxt.js
    if (window.__NUXT__ || document.querySelector('#__nuxt')) {
        add('frameworks', 'Nuxt.js');
    }

    // Gatsby
    if (document.querySelector('#___gatsby')) {
        add('frameworks', 'Gatsby');
    }

    // --- Analytics & Tools ---

    // Google Analytics
    if (
        window.ga ||
        document.querySelector('script[src*="google-analytics.com"]') ||
        document.querySelector('script[src*="googletagmanager.com/gtag/js"]')
    ) {
        add('analytics', 'Google Analytics');
    }

    // Google Tag Manager
    if (
        window.google_tag_manager ||
        document.querySelector('script[src*="googletagmanager.com/gtm.js"]')
    ) {
        add('analytics', 'Google Tag Manager');
    }

    // Segment
    if (window.analytics && window.analytics.track) {
        add('analytics', 'Segment');
    }

    // Facebook Pixel
    if (window.fbq || document.querySelector('script[src*="connect.facebook.net"]')) {
        add('analytics', 'Facebook Pixel');
    }

    // Hotjar
    if (window.hj || document.querySelector('script[src*="hotjar"]')) {
        add('analytics', 'Hotjar');
    }

    // --- Fonts ---

    // Google Fonts
    if (document.querySelector('link[href*="fonts.googleapis.com"]')) {
        add('fonts', 'Google Fonts');
    }

    // Adobe Fonts (Typekit)
    if (document.querySelector('link[href*="use.typekit.net"]') || document.querySelector('script[src*="use.typekit.net"]')) {
        add('fonts', 'Adobe Fonts');
    }

    return data;
}
