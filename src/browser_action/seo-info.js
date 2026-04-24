/*
 SEO Information Module
 Extracts and analyzes SEO-related data from the current page
*/

export class SEOInfo {
  static async load(url, localMetrics = null) {
    try {
      const urlObj = new URL(url);
      const domain = urlObj.hostname;

      // Get active tab to extract SEO information
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab?.id) {
        throw new Error('Unable to access current tab');
      }

      // Execute script in the page to extract SEO data
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractSEOData,
      });

      if (!results || !results[0]) {
        throw new Error('Unable to extract SEO data');
      }

      const seoData = results[0].result || {};

      // Load external metrics in parallel (non-blocking)
      const externalMetrics = await loadExternalMetrics(url, domain);

      // Calculate SEO Score (include local Web Vitals if available)
      const seoScore = calculateSEOScore(seoData, externalMetrics, localMetrics);

      // Generate fix suggestions
      const fixSuggestions = generateSEOFixSuggestions(seoData, externalMetrics);

      // Return formatted SEO information
      return {
        domain: domain,
        url: url,
        title: seoData.title || 'Not found',
        titleLength: seoData.title ? seoData.title.length : 0,
        description: seoData.description || 'Not found',
        descriptionLength: seoData.description ? seoData.description.length : 0,
        keywords: seoData.keywords || 'Not found',
        canonical: seoData.canonical || 'Not found',
        robots: seoData.robots || 'Not found',
        ogTitle: seoData.ogTitle || 'Not found',
        ogDescription: seoData.ogDescription || 'Not found',
        ogImage: seoData.ogImage || 'Not found',
        ogType: seoData.ogType || 'Not found',
        twitterCard: seoData.twitterCard || 'Not found',
        twitterTitle: seoData.twitterTitle || 'Not found',
        twitterDescription: seoData.twitterDescription || 'Not found',
        twitterImage: seoData.twitterImage || 'Not found',
        h1Count: seoData.h1Count || 0,
        h2Count: seoData.h2Count || 0,
        imagesCount: seoData.imagesCount || 0,
        imagesWithoutAlt: seoData.imagesWithoutAlt || 0,
        linksInternal: seoData.linksInternal || 0,
        linksExternal: seoData.linksExternal || 0,
        hasSchema: seoData.hasSchema ? 'Yes' : 'No',
        schemaTypes: seoData.schemaTypes || 'None',
        viewport: seoData.viewport || 'Not found',
        language: seoData.language || 'Not found',
        charset: seoData.charset || 'Not found',
        wordCount: seoData.wordCount || 0,
        textToHtmlRatio: seoData.textToHtmlRatio || 0,
        hasFavicon: !!seoData.hasFavicon,
        deprecatedTags: seoData.deprecatedTags || [],
        // SEO Score calculations
        seoScore: seoScore,
        issues: identifySEOIssues(seoData, externalMetrics),
        fixSuggestions,
        // External metrics
        ...externalMetrics,
      };
    } catch (error) {
      console.error('SEO Info error:', error);
      throw new Error(error.message || 'Failed to load SEO information');
    }
  }
}

// Load external metrics from various APIs
async function loadExternalMetrics(url, domain) {
  const metrics = {
    // Security & Performance
    httpsEnabled: 'Checking...',
    hsts: 'Checking...',
    contentSecurityPolicy: 'Checking...',
    xFrameOptions: 'Checking...',

    // Domain Metrics
    domainAuthority: 'Calculating...',
    domainRating: 'Calculating...',

    // Performance
    performanceScore: 'Loading...',

    // Additional metrics
    backlinksEstimate: 'Calculating...',
    domainAge: 'Estimating...',
  };

  try {
    // Load all metrics in parallel with timeout
    const results = await Promise.allSettled([
      loadMozillaObservatory(domain),
      loadRDAPDomainInfo(domain),
      extractSecurityFromPage(url),
    ]);

    // Process Mozilla Observatory results (for security headers)
    let securityData = {};
    if (results[0].status === 'fulfilled' && results[0].value) {
      const mozData = results[0].value;
      metrics.httpsEnabled = mozData.https ? 'Yes' : 'No';
      metrics.hsts = mozData.hsts ? 'Enabled' : 'Not configured';
      metrics.contentSecurityPolicy = mozData.csp ? 'Configured' : 'Not configured';
      metrics.xFrameOptions = mozData.xfo ? 'Configured' : 'Not configured';
      securityData = mozData;
    }

    // Process RDAP WHOIS results (for real domain age)
    let rdapData = null;
    if (results[1].status === 'fulfilled' && results[1].value) {
      rdapData = results[1].value;
    }

    // Process page security extraction
    if (results[2].status === 'fulfilled' && results[2].value) {
      const pageData = results[2].value;
      if (metrics.httpsEnabled === 'Checking...') {
        metrics.httpsEnabled = pageData.https ? 'Yes' : 'No';
      }
    }

    // Calculate Domain Metrics with real data where available
    const urlObj = new URL(url);
    const protocol = urlObj.protocol;

    const da = calculateDomainAuthorityScore(domain, protocol, rdapData, securityData);
    const dr = calculateDomainRatingScore(domain, protocol, rdapData, securityData);
    const age = estimateDomainAge(domain, rdapData);
    const backlinks = estimateBacklinks(domain, da, dr, rdapData);

    metrics.domainAuthority = `${da}/100`;
    metrics.domainRating = `${dr}/100`;
    metrics.backlinksEstimate = backlinks;
    metrics.domainAge = age;
    metrics.performanceScore = 'See Web Vitals tab';

  } catch (error) {
    console.error('Error loading external metrics:', error);
    // Fallback: use URL-based calculations
    try {
      const urlObj = new URL(url);
      const da = calculateDomainAuthorityScore(domain, urlObj.protocol);
      const dr = calculateDomainRatingScore(domain, urlObj.protocol);
      metrics.domainAuthority = `${da}/100`;
      metrics.domainRating = `${dr}/100`;
      metrics.backlinksEstimate = estimateBacklinks(domain, da, dr);
      metrics.domainAge = estimateDomainAge(domain);
    } catch (_e) {
      metrics.domainAuthority = 'Unavailable';
      metrics.domainRating = 'Unavailable';
    }
  }

  return metrics;
}

// Mozilla Observatory API (for security headers only)
async function loadMozillaObservatory(domain) {
  try {
    // First, initiate a scan
    const scanResponse = await fetch(`https://http-observatory.security.mozilla.org/api/v1/analyze?host=${domain}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    
    if (!scanResponse.ok) throw new Error('Observatory scan failed');
    
    // Wait a bit for scan to complete
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Get results
    const resultResponse = await fetch(`https://http-observatory.security.mozilla.org/api/v1/analyze?host=${domain}`);
    
    if (!resultResponse.ok) throw new Error('Observatory results failed');
    
    const data = await resultResponse.json();
    
    return {
      https: data.tests_passed >= 1,
      hsts: data.tests?.['strict-transport-security']?.pass || false,
      csp: data.tests?.['content-security-policy']?.pass || false,
      xfo: data.tests?.['x-frame-options']?.pass || false,
    };
  } catch (error) {
    console.warn('Mozilla Observatory error:', error);
    return null;
  }
}

// Calculate Domain Authority Score (0-100)
function calculateDomainAuthorityScore(domain, protocol, rdapData = null, securityData = {}) {
  let score = 25; // Lower base score for realism

  // HTTPS (+15 points)
  if (protocol === 'https:') {
    score += 15;
  }

  // TLD quality (+20 points max)
  const tldScores = {
    '.gov': 20, '.edu': 18, '.org': 12, '.com': 10, '.net': 8,
    '.io': 8, '.co': 6, '.info': 4, '.biz': 3
  };

  for (const [tld, points] of Object.entries(tldScores)) {
    if (domain.endsWith(tld)) {
      score += points;
      break;
    }
  }

  // Domain length factor (+10 points max)
  const domainParts = domain.split('.');
  const mainDomain = domainParts[domainParts.length - 2] || domain;
  const length = mainDomain.length;

  if (length <= 4) score += 10;
  else if (length <= 6) score += 8;
  else if (length <= 8) score += 6;
  else if (length <= 10) score += 4;
  else if (length <= 12) score += 2;

  // WWW prefix suggests established site (+3 points)
  if (domain.startsWith('www.')) {
    score += 3;
  }

  // Known high-authority domains (+15 points max)
  const highAuthDomains = ['google', 'amazon', 'facebook', 'apple', 'microsoft', 'github', 'stackoverflow', 'twitter', 'youtube', 'wikipedia', 'reddit', 'medium', 'linkedin', 'netflix', 'instagram', 'adobe', 'salesforce', 'shopify', 'wordpress'];
  if (highAuthDomains.some(word => domain.includes(word))) {
    score += 15;
  }

  // Real domain age from RDAP (+15 points max)
  if (rdapData?.registrationDate) {
    const ageYears = (Date.now() - rdapData.registrationDate.getTime()) / (1000 * 60 * 60 * 24 * 365);
    if (ageYears >= 15) score += 15;
    else if (ageYears >= 10) score += 12;
    else if (ageYears >= 7) score += 9;
    else if (ageYears >= 5) score += 6;
    else if (ageYears >= 3) score += 3;
    else if (ageYears >= 1) score += 1;
  }

  // Security headers bonus (+8 points max)
  if (securityData.hsts) score += 3;
  if (securityData.csp) score += 3;
  if (securityData.xfo) score += 2;

  // Domain quality penalties
  if (mainDomain.includes('-')) score -= 2;
  if (/\d/.test(mainDomain)) score -= 2;
  if (mainDomain.length > 20) score -= 3;

  return Math.max(1, Math.min(Math.round(score), 100));
}

// Calculate Domain Rating Score (0-100) - Similar to Ahrefs DR
function calculateDomainRatingScore(domain, protocol, rdapData = null, securityData = {}) {
  let score = 20; // Lower base score for realism

  // HTTPS (+18 points)
  if (protocol === 'https:') {
    score += 18;
  }

  // TLD quality (+22 points max)
  const tldScores = {
    '.gov': 22, '.edu': 20, '.org': 14, '.com': 11, '.net': 9,
    '.io': 9, '.co': 7, '.info': 4, '.biz': 3
  };

  for (const [tld, points] of Object.entries(tldScores)) {
    if (domain.endsWith(tld)) {
      score += points;
      break;
    }
  }

  // Domain characteristics (+12 points max)
  const domainParts = domain.split('.');
  const mainDomain = domainParts[domainParts.length - 2] || domain;
  const length = mainDomain.length;

  if (length <= 3) score += 12;
  else if (length <= 5) score += 10;
  else if (length <= 7) score += 7;
  else if (length <= 9) score += 4;
  else if (length <= 12) score += 2;

  // No hyphens or numbers suggests quality (+4 points)
  if (!mainDomain.includes('-') && !/\d/.test(mainDomain)) {
    score += 4;
  }

  // Known high-authority domains (+12 points)
  const highAuthDomains = ['google', 'amazon', 'facebook', 'apple', 'microsoft', 'github', 'stackoverflow', 'twitter', 'youtube', 'wikipedia', 'reddit', 'medium', 'linkedin', 'netflix', 'instagram'];
  if (highAuthDomains.some(word => domain.includes(word))) {
    score += 12;
  }

  // Real domain age from RDAP (+14 points max)
  if (rdapData?.registrationDate) {
    const ageYears = (Date.now() - rdapData.registrationDate.getTime()) / (1000 * 60 * 60 * 24 * 365);
    if (ageYears >= 15) score += 14;
    else if (ageYears >= 10) score += 11;
    else if (ageYears >= 7) score += 8;
    else if (ageYears >= 5) score += 5;
    else if (ageYears >= 3) score += 2;
    else if (ageYears >= 1) score += 1;
  }

  // Security headers bonus (+6 points max)
  if (securityData.hsts) score += 2;
  if (securityData.csp) score += 2;
  if (securityData.xfo) score += 2;

  // Domain quality penalties
  if (mainDomain.includes('-')) score -= 3;
  if (/\d/.test(mainDomain)) score -= 3;
  if (mainDomain.length > 20) score -= 4;

  return Math.max(1, Math.min(Math.round(score), 100));
}

// Estimate backlinks based on DA and DR
function estimateBacklinks(domain, da, dr, rdapData = null) {
  // Use real age data to adjust estimates
  let ageMultiplier = 1;
  if (rdapData?.registrationDate) {
    const ageYears = (Date.now() - rdapData.registrationDate.getTime()) / (1000 * 60 * 60 * 24 * 365);
    ageMultiplier = Math.min(2, 0.5 + (ageYears / 10));
  }

  const avgScore = ((da + dr) / 2) * ageMultiplier;

  if (avgScore >= 90) return '100K+ (estimated)';
  if (avgScore >= 80) return '10K-100K (estimated)';
  if (avgScore >= 70) return '5K-10K (estimated)';
  if (avgScore >= 60) return '1K-5K (estimated)';
  if (avgScore >= 50) return '500-1K (estimated)';
  if (avgScore >= 40) return '100-500 (estimated)';
  if (avgScore >= 30) return '50-100 (estimated)';
  if (avgScore >= 20) return '10-50 (estimated)';
  return '<10 (estimated)';
}

// Estimate domain age using RDAP data when available
function estimateDomainAge(domain, rdapData = null) {
  // Use real RDAP data if available
  if (rdapData?.registrationDate) {
    const ageYears = Math.floor((Date.now() - rdapData.registrationDate.getTime()) / (1000 * 60 * 60 * 24 * 365));
    if (ageYears >= 1) return `${ageYears} years (real)`;
    return '<1 year (real)';
  }

  // Fallback: rough estimation based on domain characteristics
  const domainParts = domain.split('.');
  const mainDomain = domainParts[domainParts.length - 2] || domain;

  if (mainDomain.length <= 4) return '10+ years (estimated)';
  if (mainDomain.length <= 6) return '5-10 years (estimated)';
  if (mainDomain.length <= 8) return '3-5 years (estimated)';
  if (mainDomain.length <= 10) return '1-3 years (estimated)';
  return '<1 year (estimated)';
}

// RDAP WHOIS lookup for real domain age and registration data
async function loadRDAPDomainInfo(domain) {
  try {
    const response = await fetch(`https://rdap.org/domain/${domain}`, {
      method: 'GET',
      headers: { 'Accept': 'application/rdap+json' }
    });

    if (!response.ok) return null;

    const data = await response.json();

    // Extract registration date from events
    let registrationDate = null;
    let expirationDate = null;
    let registrar = null;

    if (data.events && Array.isArray(data.events)) {
      data.events.forEach(event => {
        if (event.eventAction && event.eventAction.toLowerCase().includes('registration')) {
          registrationDate = new Date(event.eventDate);
        }
        if (event.eventAction && event.eventAction.toLowerCase().includes('expiration')) {
          expirationDate = new Date(event.eventDate);
        }
      });
    }

    // Extract registrar from entities
    if (data.entities && Array.isArray(data.entities)) {
      data.entities.forEach(entity => {
        if (entity.roles && entity.roles.includes('registrar') && entity.vcardArray) {
          const vcard = entity.vcardArray[1];
          if (vcard && Array.isArray(vcard)) {
            const fn = vcard.find(item => item[0] === 'fn');
            if (fn) registrar = fn[3];
          }
        }
      });
    }

    return {
      registrationDate,
      expirationDate,
      registrar,
      raw: data,
    };
  } catch (error) {
    console.warn('RDAP lookup error:', error);
    return null;
  }
}

// Extract security and tech info from the current page
async function extractSecurityFromPage(url) {
  try {
    const urlObj = new URL(url);
    
    return {
      https: urlObj.protocol === 'https:',
    };
  } catch (error) {
    console.warn('Page extraction error:', error);
    return null;
  }
}

// Calculate Trust Score based on SEO Score, Domain Authority, Domain Rating, and security factors
// This function runs in the context of the page
function extractSEOData() {
  const data = {};

  try {
    // Basic meta tags
    data.title = document.title || '';

    const metaDescription = document.querySelector('meta[name="description"]');
    data.description = metaDescription?.content || '';

    const metaKeywords = document.querySelector('meta[name="keywords"]');
    data.keywords = metaKeywords?.content || '';

    const canonical = document.querySelector('link[rel="canonical"]');
    data.canonical = canonical?.href || '';

    const robots = document.querySelector('meta[name="robots"]');
    data.robots = robots?.content || '';

    // Open Graph tags
    const ogTitle = document.querySelector('meta[property="og:title"]');
    data.ogTitle = ogTitle?.content || '';

    const ogDescription = document.querySelector('meta[property="og:description"]');
    data.ogDescription = ogDescription?.content || '';

    const ogImage = document.querySelector('meta[property="og:image"]');
    data.ogImage = ogImage?.content || '';

    const ogType = document.querySelector('meta[property="og:type"]');
    data.ogType = ogType?.content || '';

    // Twitter Card tags
    const twitterCard = document.querySelector('meta[name="twitter:card"]');
    data.twitterCard = twitterCard?.content || '';

    const twitterTitle = document.querySelector('meta[name="twitter:title"]');
    data.twitterTitle = twitterTitle?.content || '';

    const twitterDescription = document.querySelector('meta[name="twitter:description"]');
    data.twitterDescription = twitterDescription?.content || '';

    const twitterImage = document.querySelector('meta[name="twitter:image"]');
    data.twitterImage = twitterImage?.content || '';

    // Viewport
    const viewport = document.querySelector('meta[name="viewport"]');
    data.viewport = viewport?.content || '';

    // Language
    data.language = document.documentElement.lang || document.querySelector('meta[http-equiv="content-language"]')?.content || '';

    // Charset
    const charset = document.querySelector('meta[charset]') || document.querySelector('meta[http-equiv="Content-Type"]');
    data.charset = charset?.getAttribute('charset') || charset?.content?.match(/charset=([^;]+)/)?.[1] || '';

    // Heading counts
    data.h1Count = document.querySelectorAll('h1').length;
    data.h2Count = document.querySelectorAll('h2').length;

    // Images analysis
    const images = document.querySelectorAll('img');
    data.imagesCount = images.length;
    data.imagesWithoutAlt = Array.from(images).filter(img => !img.alt || img.alt.trim() === '').length;

    // Links analysis
    const links = document.querySelectorAll('a[href]');
    const currentDomain = window.location.hostname;
    data.linksInternal = 0;
    data.linksExternal = 0;

    links.forEach(link => {
      try {
        const href = link.getAttribute('href');
        if (href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) {
          return;
        }
        const linkUrl = new URL(href, window.location.href);
        if (linkUrl.hostname === currentDomain) {
          data.linksInternal++;
        } else {
          data.linksExternal++;
        }
      } catch (e) {
        // Invalid URL
      }
    });

    // Structured data (Schema.org)
    const schemaScripts = document.querySelectorAll('script[type="application/ld+json"]');
    data.hasSchema = schemaScripts.length > 0;

    if (data.hasSchema) {
      const schemaTypes = new Set();
      schemaScripts.forEach(script => {
        try {
          const json = JSON.parse(script.textContent);
          const extractTypes = (obj) => {
            if (obj && obj['@type']) {
              if (Array.isArray(obj['@type'])) {
                obj['@type'].forEach(type => schemaTypes.add(type));
              } else {
                schemaTypes.add(obj['@type']);
              }
            }
            if (obj && obj['@graph']) {
              obj['@graph'].forEach(item => extractTypes(item));
            }
          };
          extractTypes(json);
        } catch (e) {
          // Invalid JSON
        }
      });
      data.schemaTypes = Array.from(schemaTypes).join(', ') || 'Unknown';
    } else {
      data.schemaTypes = '';
    }

    // Word Count
    data.wordCount = 0;
    data.textToHtmlRatio = 0;
    if (document.body) {
      const bodyText = document.body.innerText || document.body.textContent || '';
      if (bodyText) {
        data.wordCount = bodyText.split(/\s+/).filter(w => w.length > 0).length;
        const htmlLength = document.documentElement.outerHTML.length;
        const textLength = bodyText.length;
        data.textToHtmlRatio = htmlLength > 0 ? Math.round((textLength / htmlLength) * 100) : 0;
      }
    }

    // Favicon detection
    data.hasFavicon = false;
    try {
      const faviconSelectors = [
        'link[rel~="icon"]',
        'link[rel="shortcut icon"]',
        'link[rel="apple-touch-icon"]',
        'link[rel="mask-icon"]',
      ];
      for (const selector of faviconSelectors) {
        const favicon = document.querySelector(selector);
        if (favicon) {
          data.hasFavicon = true;
          break;
        }
      }
      // Fallback: check if a root favicon.ico request would succeed (check via known path pattern)
      // We can't fetch from injected script due to CSP, so we rely on link tags.
      // Some sites use <link rel="icon" type="image/x-icon" href="/favicon.ico">
      if (!data.hasFavicon) {
        const anyFavicon = document.querySelector('link[href*="favicon"]');
        if (anyFavicon) {
          data.hasFavicon = true;
        }
      }
    } catch (_e) {
      data.hasFavicon = false;
    }

    // Deprecated Tags
    data.deprecatedTags = [];
    if (document.querySelector('meta[name="keywords"]')) {
      data.deprecatedTags.push('<meta name="keywords">');
    }
    if (document.querySelector('center')) {
      data.deprecatedTags.push('<center>');
    }
    if (document.querySelector('font')) {
      data.deprecatedTags.push('<font>');
    }
  } catch (error) {
    console.warn('extractSEOData error:', error);
  }

  return data;
}

// Calculate SEO score based on various factors
function calculateSEOScore(data, externalMetrics = {}, localMetrics = null) {
  let score = 0;
  const maxScore = 100;

  // Title (10 points)
  if (data.title && data.title.length > 0) {
    score += 3;
    if (data.title.length >= 30 && data.title.length <= 60) {
      score += 7;
    } else if (data.title.length > 0) {
      score += 3;
    }
  }

  // Description (10 points)
  if (data.description && data.description.length > 0) {
    score += 3;
    if (data.description.length >= 120 && data.description.length <= 160) {
      score += 7;
    } else if (data.description.length > 0) {
      score += 3;
    }
  }

  // H1 tags (8 points)
  if (data.h1Count === 1) {
    score += 8;
  } else if (data.h1Count > 0) {
    score += 4;
  }

  // Images with alt (8 points)
  if (data.imagesCount > 0) {
    const altRatio = (data.imagesCount - data.imagesWithoutAlt) / data.imagesCount;
    score += Math.round(altRatio * 8);
  } else {
    score += 8;
  }

  // Canonical tag (4 points)
  if (data.canonical) {
    score += 4;
  }

  // Viewport (4 points)
  if (data.viewport) {
    score += 4;
  }

  // Language (4 points)
  if (data.language) {
    score += 4;
  }

  // Charset (4 points)
  if (data.charset) {
    score += 4;
  }

  // Open Graph (8 points)
  let ogScore = 0;
  if (data.ogTitle) ogScore += 2;
  if (data.ogDescription) ogScore += 2;
  if (data.ogImage) ogScore += 2;
  if (data.ogType) ogScore += 2;
  score += ogScore;

  // Twitter Cards (4 points)
  let twScore = 0;
  if (data.twitterCard) twScore += 1;
  if (data.twitterTitle) twScore += 1;
  if (data.twitterDescription) twScore += 1;
  if (data.twitterImage) twScore += 1;
  score += twScore;

  // Structured data (6 points)
  if (data.hasSchema) {
    score += 6;
  }

  // Internal links (3 points)
  if (data.linksInternal > 0) {
    score += 3;
  }

  // Robots tag (4 points) - check if not blocking
  if (!data.robots || !data.robots.includes('noindex')) {
    score += 4;
  }

  // Word Count (4 points)
  if (data.wordCount > 500) {
    score += 4;
  } else if (data.wordCount > 300) {
    score += 3;
  } else if (data.wordCount > 100) {
    score += 1;
  }

  // Favicon (2 points)
  if (data.hasFavicon) {
    score += 2;
  }

  // Deprecated Tags Penalty (-2 points per tag, max -6)
  if (data.deprecatedTags && data.deprecatedTags.length > 0) {
    score -= Math.min(data.deprecatedTags.length * 2, 6);
  }

  // Security & HTTPS (10 points from external metrics)
  if (externalMetrics.httpsEnabled === 'Yes') {
    score += 5;
  }
  if (externalMetrics.hsts === 'Enabled') {
    score += 3;
  }
  if (externalMetrics.contentSecurityPolicy === 'Configured') {
    score += 2;
  }

  // Performance score from local Web Vitals (10 points max)
  if (localMetrics) {
    // LCP (4 points) - good < 2.5s
    const lcp = localMetrics.lcp?.value;
    if (lcp !== undefined) {
      if (lcp < 2500) score += 4;
      else if (lcp < 4000) score += 2;
    } else {
      score += 2; // Unknown gets partial credit
    }

    // CLS (3 points) - good < 0.1
    const cls = localMetrics.cls?.value;
    if (cls !== undefined) {
      if (cls < 0.1) score += 3;
      else if (cls < 0.25) score += 1;
    } else {
      score += 1;
    }

    // INP (3 points) - good < 200ms
    const inp = localMetrics.inp?.value;
    if (inp !== undefined) {
      if (inp < 200) score += 3;
      else if (inp < 500) score += 1;
    } else {
      score += 1;
    }
  } else {
    // No local metrics available, give partial credit
    score += 6;
  }

  // Ensure score is within 0-100
  return Math.max(0, Math.min(Math.round(score), maxScore));
}

// Identify SEO issues
function identifySEOIssues(data, externalMetrics = {}) {
  const issues = [];

  // Title issues
  if (!data.title || data.title.length === 0) {
    issues.push('Missing title tag');
  } else if (data.title.length < 30) {
    issues.push('Title too short (< 30 characters)');
  } else if (data.title.length > 60) {
    issues.push('Title too long (> 60 characters)');
  }

  // Description issues
  if (!data.description || data.description.length === 0) {
    issues.push('Missing meta description');
  } else if (data.description.length < 120) {
    issues.push('Description too short (< 120 characters)');
  } else if (data.description.length > 160) {
    issues.push('Description too long (> 160 characters)');
  }

  // H1 issues
  if (data.h1Count === 0) {
    issues.push('No H1 tag found');
  } else if (data.h1Count > 1) {
    issues.push(`Multiple H1 tags (${data.h1Count})`);
  }

  // Images without alt
  if (data.imagesWithoutAlt > 0) {
    issues.push(`${data.imagesWithoutAlt} images without alt text`);
  }

  // Missing canonical
  if (!data.canonical) {
    issues.push('Missing canonical URL');
  }

  // Missing viewport
  if (!data.viewport) {
    issues.push('Missing viewport meta tag (not mobile-friendly)');
  }

  // Missing language
  if (!data.language) {
    issues.push('Missing language attribute');
  }

  // Missing Open Graph
  if (!data.ogTitle && !data.ogDescription) {
    issues.push('Missing Open Graph tags (poor social sharing)');
  }

  // Missing structured data
  if (!data.hasSchema) {
    issues.push('No structured data found (limits rich snippets)');
  }

  // Robots issues
  if (data.robots && data.robots.includes('noindex')) {
    issues.push('Page is blocked from indexing (noindex)');
  }

  // Word Count Issues
  if (data.wordCount < 300) {
    issues.push(`Low word count (${data.wordCount} words). Aim for 300+.`);
  }

  // Favicon Issue
  if (!data.hasFavicon) {
    issues.push('Missing favicon');
  }

  // Deprecated Tags Issues
  if (data.deprecatedTags && data.deprecatedTags.length > 0) {
    issues.push(`Deprecated tags found: ${data.deprecatedTags.join(', ')}`);
  }

  // Security issues from external metrics
  if (externalMetrics.httpsEnabled === 'No') {
    issues.push('HTTPS not enabled (security risk & SEO penalty)');
  }

  if (externalMetrics.hsts === 'Not configured') {
    issues.push('HSTS not configured (security improvement needed)');
  }

  if (externalMetrics.contentSecurityPolicy === 'Not configured') {
    issues.push('Content Security Policy not configured');
  }

  return issues;
}

// Generate actionable fix suggestions
function generateSEOFixSuggestions(data, externalMetrics = {}) {
  const suggestions = [];

  // Title suggestions
  if (!data.title || data.title.length === 0) {
    suggestions.push('Add a <title> tag to every page. It is the single most important on-page SEO element.');
  } else if (data.title.length < 30) {
    suggestions.push(`Your title is only ${data.title.length} characters. Expand it to 50–60 characters to include a primary keyword and a compelling value proposition.`);
  } else if (data.title.length > 60) {
    suggestions.push(`Your title is ${data.title.length} characters long. Search engines typically truncate after ~60 characters. Shorten it while keeping your primary keyword at the beginning.`);
  }

  // Description suggestions
  if (!data.description || data.description.length === 0) {
    suggestions.push('Add a meta description. While it does not directly affect rankings, it heavily influences click-through rates from search results.');
  } else if (data.description.length < 120) {
    suggestions.push(`Your meta description is only ${data.description.length} characters. Expand it to 120–160 characters to provide a compelling summary that encourages clicks.`);
  } else if (data.description.length > 160) {
    suggestions.push(`Your meta description is ${data.description.length} characters long. The recommended limit is 160 characters to avoid truncation in search results. Focus on the most compelling message in the first 120 characters.`);
  }

  // H1 suggestions
  if (data.h1Count === 0) {
    suggestions.push('Add exactly one <h1> tag per page. It should clearly describe the main topic and include your primary keyword.');
  } else if (data.h1Count > 1) {
    suggestions.push(`You have ${data.h1Count} H1 tags. Use only one H1 per page to establish a clear content hierarchy. Convert the others to H2 or H3.`);
  }

  // Images without alt
  if (data.imagesWithoutAlt > 0) {
    suggestions.push(`${data.imagesWithoutAlt} images are missing alt text. Add descriptive alt attributes for informative images and alt="" for purely decorative ones. This improves both accessibility and image search visibility.`);
  }

  // Canonical suggestions
  if (!data.canonical) {
    suggestions.push('Add a canonical URL tag to prevent duplicate content issues when the same content is accessible via multiple URLs.');
  }

  // Viewport suggestions
  if (!data.viewport) {
    suggestions.push('Add a viewport meta tag to ensure your page is mobile-friendly. Google uses mobile-first indexing, so this is critical for SEO.');
  }

  // Language suggestions
  if (!data.language) {
    suggestions.push('Add a lang attribute to the <html> tag (e.g., <html lang="en">). It helps search engines understand the target audience and can improve international rankings.');
  }

  // Open Graph suggestions
  if (!data.ogTitle || !data.ogDescription || !data.ogImage) {
    suggestions.push('Complete your Open Graph tags (og:title, og:description, og:image). They control how your page appears when shared on social media and messaging apps, which indirectly drives traffic and backlinks.');
  }

  // Twitter Card suggestions
  if (!data.twitterCard) {
    suggestions.push('Add Twitter Card meta tags to enhance link previews on X/Twitter, improving engagement and click-through rates from social sharing.');
  }

  // Structured data suggestions
  if (!data.hasSchema) {
    suggestions.push('Implement Schema.org structured data using JSON-LD. Start with basic types like Organization, WebPage, or Article to enable rich snippets in search results.');
  }

  // Word count suggestions
  if (data.wordCount < 300) {
    suggestions.push(`Your page has only ${data.wordCount} words. Aim for at least 300 words of unique, valuable content to have a chance of ranking. Comprehensive guides (1,000+ words) tend to perform better for competitive keywords.`);
  } else if (data.wordCount < 600) {
    suggestions.push(`Your page has ${data.wordCount} words. Consider expanding to 800–1,200 words to cover the topic more comprehensively and increase topical authority.`);
  }

  // Favicon suggestions
  if (!data.hasFavicon) {
    suggestions.push('Add a favicon. It improves brand recognition in browser tabs and bookmark bars, and its absence can make your site look unprofessional.');
  }

  // Deprecated tags suggestions
  if (data.deprecatedTags && data.deprecatedTags.length > 0) {
    suggestions.push(`Remove deprecated tags (${data.deprecatedTags.join(', ')}). Replace <center> with CSS text-align:center, <font> with CSS classes, and remove the keywords meta tag as modern search engines ignore it.`);
  }

  // HTTPS suggestions
  if (externalMetrics.httpsEnabled === 'No') {
    suggestions.push('Migrate to HTTPS immediately. It is a confirmed ranking factor and essential for user trust. Obtain a free SSL certificate from Let\'s Encrypt.');
  }

  // HSTS suggestions
  if (externalMetrics.hsts === 'Not configured') {
    suggestions.push('Enable HTTP Strict Transport Security (HSTS) to force browsers to always use HTTPS connections, protecting users from downgrade attacks.');
  }

  // CSP suggestions
  if (externalMetrics.contentSecurityPolicy === 'Not configured') {
    suggestions.push('Implement a Content Security Policy (CSP) header. It protects against XSS attacks and shows search engines that you take security seriously.');
  }

  // Internal links suggestions
  if (data.linksInternal === 0) {
    suggestions.push('Add internal links to other pages on your site. Internal linking helps search engines discover content and distributes PageRank/authority across your site.');
  }

  // External links suggestions
  if (data.linksExternal === 0) {
    suggestions.push('Consider adding a few relevant external links to authoritative sources. It signals to search engines that your content is well-researched and trustworthy.');
  }

  // Robots suggestions
  if (data.robots && data.robots.includes('noindex')) {
    suggestions.push('Your page has a noindex directive. Remove it if you want this page to appear in search results. Only use noindex for pages like admin panels, thank-you pages, or duplicate content.');
  }

  return suggestions;
}
