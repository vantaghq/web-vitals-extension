/*
 Copyright 2020 Google Inc. All Rights Reserved.
 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at
     http://www.apache.org/licenses/LICENSE-2.0
 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
*/

import { loadLocalMetrics, getOptions, getURL } from './chrome.js';
import { CrUX } from './crux.js';
import { LCP, CLS, INP, FCP, TTFB } from './metric.js';
import { ServerInfo } from './server-info.js';
import { DNSInfo } from './dns-info.js';
import { SEOInfo } from './seo-info.js';
import { TechInfo } from './tech-info.js';
import { A11yInfo } from './a11y-info.js';

class Popup {

  static ACTIVE_TAB_STORAGE_KEY = 'webVitalsActiveTab';

  constructor({ metrics, background, options, url, error }) {
    const { timestamp, ..._metrics } = metrics || {};
    // Format as a short timestamp (HH:MM:SS).
    const formattedTimestamp = timestamp ?
      new Date(timestamp).toLocaleTimeString('en-US', { hourCycle: 'h23' }) : '';

    this.timestamp = formattedTimestamp;
    this._metrics = _metrics;
    this.background = background;
    this.options = options || {};
    this.metrics = {};
    this.url = url || '';

    this.init();

    if (error) {
      this.setStatus('Web Vitals are unavailable for this page.\n' + error);
    }
  }

  init() {
    this.initViewportMode();
    this.initTheme();
    this.initLiveUpdates();
    this.initSidePanel();
    this.initTabs();
    this.initStatus();
    this.initPage();
    this.initTimestamp();
    this.initMetrics();
    this.initFieldData();
    this.initExportButton();
    this.initFooterLinks();
  }

  initViewportMode() {
    // Detect sidepanel by viewport width (sidepanel ~360px, popup ~760px).
    if (window.innerWidth < 500) {
      document.documentElement.classList.add('sidepanel-mode');
    }
  }

  initTheme() {
    const htmlElement = document.documentElement;
    const themeToggle = document.getElementById('theme-toggle');

    // Load saved theme preference
    chrome.storage.sync.get({ darkMode: false }, ({ darkMode }) => {
      if (darkMode) {
        htmlElement.classList.add('dark-mode');
      }
    });

    // Toggle theme
    themeToggle.addEventListener('click', () => {
      const isDarkMode = htmlElement.classList.toggle('dark-mode');
      chrome.storage.sync.set({ darkMode: isDarkMode });
    });
  }

  initSidePanel() {
    const sidePanelButton = document.getElementById('sidePanel');
    if (!sidePanelButton) {
      return;
    }

    if (!chrome.sidePanel || !chrome.sidePanel.open) {
      sidePanelButton.disabled = true;
      sidePanelButton.title = 'Side Panel requiere Chrome 114 o superior';
      return;
    }

    sidePanelButton.addEventListener('click', async () => {
      try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const windowId = activeTab?.windowId;

        if (!windowId) {
          throw new Error('No se encontro una ventana activa');
        }

        await chrome.sidePanel.open({ windowId });

        // Close popup after opening the side panel to avoid overlaying both UIs.
        window.close();
      } catch (error) {
        console.error('No se pudo abrir el Side Panel:', error);
      }
    });
  }

  initLiveUpdates() {
    if (!chrome.tabs?.onActivated || !chrome.tabs?.onUpdated) {
      return;
    }

    let refreshTimeout = null;
    const scheduleRefresh = () => {
      clearTimeout(refreshTimeout);
      refreshTimeout = setTimeout(() => {
        window.location.reload();
      }, 250);
    };

    chrome.tabs.onActivated.addListener(() => {
      scheduleRefresh();
    });

    chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
      if (!tab?.active) {
        return;
      }

      if (changeInfo.status === 'complete' || !!changeInfo.url) {
        scheduleRefresh();
      }
    });
  }

  initTabs() {
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');

    tabButtons.forEach(button => {
      button.addEventListener('click', () => {
        const targetTab = button.getAttribute('data-tab');

        this.activateTab(targetTab, tabButtons, tabContents);
      });
    });

    let savedTab = 'vitals';
    try {
      savedTab = sessionStorage.getItem(Popup.ACTIVE_TAB_STORAGE_KEY) || 'vitals';
    } catch (_e) {
      // Keep default tab when sessionStorage is unavailable.
    }

    this.activateTab(savedTab, tabButtons, tabContents);
  }

  activateTab(targetTab, tabButtons, tabContents) {
    if (!targetTab) {
      return;
    }

    const targetButton = document.querySelector(`.tab-button[data-tab="${targetTab}"]`);
    const targetContent = document.getElementById(`${targetTab}-tab`);

    if (!targetButton || !targetContent) {
      return;
    }

    // Remove active class from all buttons and contents.
    tabButtons.forEach(btn => btn.classList.remove('active'));
    tabContents.forEach(content => content.classList.remove('active'));

    // Activate the selected tab and persist user selection across reloads.
    targetButton.classList.add('active');
    targetContent.classList.add('active');
    try {
      sessionStorage.setItem(Popup.ACTIVE_TAB_STORAGE_KEY, targetTab);
    } catch (_e) {
      // Ignore persistence failures.
    }

    // Load server info if server tab is clicked.
    if (targetTab === 'server' && !this.serverInfoLoaded) {
      this.loadServerInfo();
    }

    // Load DNS info if DNS tab is clicked.
    if (targetTab === 'dns' && !this.dnsInfoLoaded) {
      this.loadDNSInfo();
    }

    // Load SEO info if SEO tab is clicked.
    if (targetTab === 'seo' && !this.seoInfoLoaded) {
      this.loadSEOInfo();
    }

    // Load Tech info if Tech tab is clicked.
    if (targetTab === 'tech' && !this.techInfoLoaded) {
      this.loadTechInfo();
    }

    // Load A11y info if A11y tab is clicked.
    if (targetTab === 'a11y' && !this.a11yInfoLoaded) {
      this.loadA11yInfo();
    }
  }

  async loadServerInfo() {
    this.serverInfoLoaded = true;

    try {
      const serverInfo = await ServerInfo.load(this.url);

      // Update all server info fields
      document.getElementById('server-ip').innerText = serverInfo.ip;
      document.getElementById('server-hostname').innerText = serverInfo.hostname;
      document.getElementById('server-location').innerText = serverInfo.location;
      document.getElementById('server-country').innerText = `${serverInfo.country} (${serverInfo.countryCode})`;
      document.getElementById('server-region').innerText = serverInfo.region;
      document.getElementById('server-timezone').innerText = serverInfo.timezone;
      document.getElementById('server-isp').innerText = serverInfo.isp;
      document.getElementById('server-org').innerText = serverInfo.org;
      document.getElementById('server-asn').innerText = serverInfo.asn;

    } catch (e) {
      const errorMessage = e.message || 'Unable to load server information';
      console.error('Server info error:', errorMessage);

      // Set all fields to error state
      const errorFields = ['server-ip', 'server-hostname', 'server-location', 'server-country',
        'server-region', 'server-timezone',
        'server-isp', 'server-org', 'server-asn'];
      errorFields.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
          element.innerText = 'Error';
          element.style.color = 'var(--color-poor-text)';
        }
      });
    }
  }

  async loadDNSInfo() {
    this.dnsInfoLoaded = true;

    try {
      const dnsInfo = await DNSInfo.load(this.url);

      // Update DNS info fields
      document.getElementById('dns-domain').innerText = dnsInfo.domain;
      document.getElementById('dns-a-record').innerText = dnsInfo.aRecord;
      document.getElementById('dns-aaaa-record').innerText = dnsInfo.aaaaRecord;
      document.getElementById('dns-cname').innerText = dnsInfo.cname;
      document.getElementById('dns-mx').innerText = dnsInfo.mx;
      document.getElementById('dns-ns').innerText = dnsInfo.ns;
      document.getElementById('dns-txt').innerText = dnsInfo.txt;
      document.getElementById('dns-soa').innerText = dnsInfo.soa;

      // Render discovered subdomains
      const subdomainsContainer = document.getElementById('dns-subdomains-container');
      const subdomainsGrid = document.getElementById('dns-subdomains-grid');
      if (dnsInfo.subdomains && dnsInfo.subdomains.length > 0) {
        subdomainsGrid.innerHTML = '';
        dnsInfo.subdomains.forEach(sub => {
          const item = document.createElement('div');
          item.className = 'info-item';
          item.innerHTML = `
            <div class="info-label">${sub.subdomain}</div>
            <div class="info-value">${sub.type}: ${sub.value}</div>
          `;
          subdomainsGrid.appendChild(item);
        });
        subdomainsContainer.style.display = 'block';
      } else {
        subdomainsContainer.style.display = 'none';
      }

    } catch (e) {
      const errorMessage = e.message || 'Unable to load DNS information';
      console.error('DNS info error:', errorMessage);

      // Set all fields to error state
      const errorFields = ['dns-domain', 'dns-a-record', 'dns-aaaa-record', 'dns-cname',
        'dns-mx', 'dns-ns', 'dns-txt', 'dns-soa'];
      errorFields.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
          element.innerText = 'Error';
          element.style.color = 'var(--color-poor-text)';
        }
      });

      const subdomainsContainer = document.getElementById('dns-subdomains-container');
      if (subdomainsContainer) subdomainsContainer.style.display = 'none';
    }
  }

  async loadSEOInfo() {
    this.seoInfoLoaded = true;

    try {
      const startTime = performance.now();
      const seoInfo = await SEOInfo.load(this.url, this._metrics);
      const loadTime = Math.round(performance.now() - startTime);

      // Extract numeric scores
      const daMatch = seoInfo.domainAuthority.match(/(\d+)/);
      const daScore = daMatch ? parseInt(daMatch[1]) : 0;

      const drMatch = seoInfo.domainRating.match(/(\d+)/);
      const drScore = drMatch ? parseInt(drMatch[1]) : 0;

      // Update circles in order: DA, DR, SEO
      this.updateCircleScore('domain-authority-circle', 'domain-authority-text', daScore, daScore >= 70 ? 'good' : daScore >= 40 ? 'needs-improvement' : 'poor');
      this.updateCircleScore('domain-rating-circle', 'domain-rating-text', drScore, drScore >= 70 ? 'good' : drScore >= 40 ? 'needs-improvement' : 'poor');
      this.updateSEOScore(seoInfo.seoScore);

      // Update SEO Fix Suggestions
      const fixContainer = document.getElementById('seo-fix-suggestions');
      const fixList = document.getElementById('seo-fix-list');
      if (fixContainer && fixList) {
        if (seoInfo.fixSuggestions && seoInfo.fixSuggestions.length > 0) {
          fixList.innerHTML = '';
          seoInfo.fixSuggestions.forEach(suggestion => {
            const li = document.createElement('li');
            li.textContent = suggestion;
            fixList.appendChild(li);
          });
          fixContainer.style.display = 'block';
        } else {
          fixContainer.style.display = 'none';
        }
      }

      // Update SEO Issues
      const issuesContainer = document.getElementById('seo-issues-container');
      if (seoInfo.issues && seoInfo.issues.length > 0) {
        const issuesList = document.getElementById('seo-issues-list');
        issuesList.innerHTML = '';
        seoInfo.issues.forEach(issue => {
          const li = document.createElement('li');
          li.textContent = issue;
          issuesList.appendChild(li);
        });
        issuesContainer.style.display = 'block';
      } else {
        // Hide issues container if no issues found
        issuesContainer.style.display = 'none';
      }

      // Update Basic Information
      document.getElementById('seo-title').innerText = seoInfo.title;
      document.getElementById('seo-title-length').innerText = `${seoInfo.titleLength} characters`;
      this.updateLengthIndicator('seo-title-length', seoInfo.titleLength, 30, 60);

      document.getElementById('seo-description').innerText = seoInfo.description;
      document.getElementById('seo-description-length').innerText = `${seoInfo.descriptionLength} characters`;
      this.updateLengthIndicator('seo-description-length', seoInfo.descriptionLength, 120, 160);

      document.getElementById('seo-keywords').innerText = seoInfo.keywords;
      document.getElementById('seo-canonical').innerText = seoInfo.canonical;
      document.getElementById('seo-robots').innerText = seoInfo.robots;
      document.getElementById('seo-language').innerText = seoInfo.language;
      document.getElementById('seo-viewport').innerText = seoInfo.viewport;
      document.getElementById('seo-charset').innerText = seoInfo.charset;

      // Update Content Analysis
      document.getElementById('seo-word-count').innerText = seoInfo.wordCount;
      this.updateCountIndicator('seo-word-count', seoInfo.wordCount, 300, 10000); // Good if > 300

      document.getElementById('seo-h1-count').innerText = seoInfo.h1Count;
      this.updateCountIndicator('seo-h1-count', seoInfo.h1Count, 1, 1);

      document.getElementById('seo-h2-count').innerText = seoInfo.h2Count;
      document.getElementById('seo-images-count').innerText = seoInfo.imagesCount;
      document.getElementById('seo-images-no-alt').innerText = seoInfo.imagesWithoutAlt;

      if (seoInfo.imagesWithoutAlt > 0) {
        document.getElementById('seo-images-no-alt').style.color = 'var(--color-poor-text)';
      }

      document.getElementById('seo-links-internal').innerText = seoInfo.linksInternal;
      document.getElementById('seo-links-external').innerText = seoInfo.linksExternal;

      document.getElementById('seo-favicon').innerText = seoInfo.hasFavicon ? 'Present' : 'Missing';
      this.updateSecurityIndicator('seo-favicon', seoInfo.hasFavicon ? 'Yes' : 'No');

      const deprecatedCount = seoInfo.deprecatedTags ? seoInfo.deprecatedTags.length : 0;
      document.getElementById('seo-deprecated-tags').innerText = deprecatedCount === 0 ? 'None' : `${deprecatedCount} found`;
      if (deprecatedCount > 0) {
        document.getElementById('seo-deprecated-tags').style.color = 'var(--color-poor-text)';
      } else {
        document.getElementById('seo-deprecated-tags').style.color = 'var(--color-good-text)';
      }

      // Update Structured Data
      document.getElementById('seo-schema').innerText = seoInfo.hasSchema;
      document.getElementById('seo-schema-types').innerText = seoInfo.schemaTypes;

      // Update Open Graph
      document.getElementById('seo-og-title').innerText = seoInfo.ogTitle;
      document.getElementById('seo-og-description').innerText = seoInfo.ogDescription;
      document.getElementById('seo-og-image').innerText = seoInfo.ogImage;
      document.getElementById('seo-og-type').innerText = seoInfo.ogType;

      // Update Twitter Card
      document.getElementById('seo-twitter-card').innerText = seoInfo.twitterCard;
      document.getElementById('seo-twitter-title').innerText = seoInfo.twitterTitle;
      document.getElementById('seo-twitter-description').innerText = seoInfo.twitterDescription;
      document.getElementById('seo-twitter-image').innerText = seoInfo.twitterImage;

      console.log(`✓ SEO analysis completed in ${loadTime}ms - DA: ${daScore} | DR: ${drScore} | SEO: ${seoInfo.seoScore}`);
    } catch (e) {
      const errorMessage = e.message || 'Unable to analyze SEO';
      console.error('SEO analysis error:', errorMessage);
    }
  }

  async loadTechInfo() {
    this.techInfoLoaded = true;

    try {
      const startTime = performance.now();
      const techInfo = await TechInfo.load(this.url);
      const loadTime = Math.round(performance.now() - startTime);

      // Helper to format list or show "-"
      const formatList = (list) => {
        if (!list || list.length === 0) return '-';
        return list.join(', ');
      };

      // CMS
      document.getElementById('tech-cms').innerText = formatList(techInfo.cms);

      // Server & Backend
      document.getElementById('tech-server').innerText = techInfo.server || 'Unknown';

      let langText = '';
      if (techInfo.language && techInfo.language !== 'Unknown') {
        langText = techInfo.language;
      }
      if (techInfo.databases && techInfo.databases.length > 0) {
        langText += (langText ? ' | ' : '') + techInfo.databases.join(', ');
      }
      document.getElementById('tech-language').innerText = langText;

      // Frameworks
      document.getElementById('tech-frameworks').innerText = formatList(techInfo.frameworks);

      // Analytics
      document.getElementById('tech-analytics').innerText = formatList(techInfo.analytics);

      // Fonts
      document.getElementById('tech-fonts').innerText = formatList(techInfo.fonts);

      console.log(`✓ Tech analysis completed in ${loadTime}ms`);
    } catch (e) {
      const errorMessage = e.message || 'Unable to analyze Tech Stack';
      console.error('Tech analysis error:', errorMessage);

      // Show error in fields
      ['tech-cms', 'tech-server', 'tech-frameworks', 'tech-analytics', 'tech-fonts'].forEach(id => {
        document.getElementById(id).innerText = 'Error loading data';
        document.getElementById(id).style.color = 'var(--color-poor-text)';
      });
    }
  }

  async loadA11yInfo() {
    this.a11yInfoLoaded = true;

    try {
      const startTime = performance.now();
      const a11yInfo = await A11yInfo.load();
      const loadTime = Math.round(performance.now() - startTime);

      // Update Score
      this.updateCircleScore('a11y-score-circle', 'a11y-score-text', a11yInfo.score,
        a11yInfo.score >= 90 ? 'good' : a11yInfo.score >= 70 ? 'needs-improvement' : 'poor'
      );

      // Update Level
      const levelEl = document.getElementById('a11y-level');
      levelEl.innerText = a11yInfo.complianceLevel;
      if (a11yInfo.score >= 90) levelEl.style.color = 'var(--color-good-text)';
      else if (a11yInfo.score >= 70) levelEl.style.color = 'var(--color-needs-improvement-text)';
      else levelEl.style.color = 'var(--color-poor-text)';

      // Update A11y Fix Suggestions
      const a11yFixContainer = document.getElementById('a11y-fix-suggestions');
      const a11yFixList = document.getElementById('a11y-fix-list');
      if (a11yFixContainer && a11yFixList) {
        if (a11yInfo.fixSuggestions && a11yInfo.fixSuggestions.length > 0) {
          a11yFixList.innerHTML = '';
          a11yInfo.fixSuggestions.forEach(suggestion => {
            const li = document.createElement('li');
            li.textContent = suggestion;
            a11yFixList.appendChild(li);
          });
          a11yFixContainer.style.display = 'block';
        } else {
          a11yFixContainer.style.display = 'none';
        }
      }

      // Update Issues
      const issuesContainer = document.getElementById('a11y-issues-container');
      const issuesList = document.getElementById('a11y-issues-list');
      issuesList.innerHTML = '';

      if (a11yInfo.issues.length > 0) {
        a11yInfo.issues.forEach(issue => {
          const li = document.createElement('li');
          li.textContent = `[${issue.category}] ${issue.text}`;
          issuesList.appendChild(li);
        });
        issuesContainer.style.display = 'block';
      } else {
        issuesContainer.style.display = 'none';
      }

      // Update Good Practices
      const goodContainer = document.getElementById('a11y-good-container');
      const goodList = document.getElementById('a11y-good-list');
      goodList.innerHTML = '';

      if (a11yInfo.goodPractices.length > 0) {
        a11yInfo.goodPractices.forEach(practice => {
          const li = document.createElement('li');
          li.textContent = practice;
          goodList.appendChild(li);
        });
        goodContainer.style.display = 'block';
      } else {
        goodContainer.style.display = 'none';
      }

      // Update Stats
      document.getElementById('a11y-stats-images').innerText = a11yInfo.stats.images;
      document.getElementById('a11y-stats-links').innerText = a11yInfo.stats.links;
      document.getElementById('a11y-stats-buttons').innerText = a11yInfo.stats.buttons;
      document.getElementById('a11y-stats-inputs').innerText = a11yInfo.stats.inputs;

      console.log(`✓ A11y analysis completed in ${loadTime}ms - Score: ${a11yInfo.score}`);
    } catch (e) {
      const errorMessage = e.message || 'Unable to analyze Accessibility';
      console.error('A11y analysis error:', errorMessage);
    }
  }

  updateSEOScore(score) {
    const scoreText = document.getElementById('seo-score-text');
    const scoreCircle = document.getElementById('seo-score-circle');

    scoreText.innerText = score;

    // Calculate circle progress (circumference = 2 * π * r = 2 * π * 45 ≈ 283)
    const circumference = 2 * Math.PI * 45;
    const progress = (score / 100) * circumference;
    const dashoffset = circumference - progress;

    scoreCircle.style.strokeDasharray = circumference;
    scoreCircle.style.strokeDashoffset = dashoffset;

    // Color based on score
    if (score >= 80) {
      scoreCircle.style.stroke = 'var(--color-good)';
      scoreText.style.color = 'var(--color-good)';
    } else if (score >= 50) {
      scoreCircle.style.stroke = 'var(--color-needs-improvement)';
      scoreText.style.color = 'var(--color-needs-improvement)';
    } else {
      scoreCircle.style.stroke = 'var(--color-poor)';
      scoreText.style.color = 'var(--color-poor)';
    }
  }

  updateCircleScore(circleId, textId, score, rating) {
    const scoreText = document.getElementById(textId);
    const scoreCircle = document.getElementById(circleId);

    scoreText.innerText = score;

    // Calculate circle progress
    const circumference = 2 * Math.PI * 45;
    const progress = (score / 100) * circumference;
    const dashoffset = circumference - progress;

    scoreCircle.style.strokeDasharray = circumference;
    scoreCircle.style.strokeDashoffset = dashoffset;

    // Color based on rating
    const colorMap = {
      'good': 'var(--color-good)',
      'needs-improvement': 'var(--color-needs-improvement)',
      'poor': 'var(--color-poor)'
    };

    const color = colorMap[rating] || 'var(--color-text-muted)';
    scoreCircle.style.stroke = color;
    scoreText.style.color = color;
  }

  updateSecurityIndicator(elementId, value) {
    const element = document.getElementById(elementId);
    if (!element) return;

    if (value === 'Yes' || value === 'Enabled' || value === 'Configured') {
      element.style.color = 'var(--color-good-text)';
      element.style.fontWeight = '600';
    } else if (value === 'No' || (typeof value === 'string' && value.includes('Not'))) {
      element.style.color = 'var(--color-poor-text)';
      element.style.fontWeight = '600';
    } else {
      element.style.color = 'var(--color-text-muted)';
    }
  }

  updateLengthIndicator(elementId, length, min, max) {
    const element = document.getElementById(elementId);
    if (length === 0) {
      element.style.color = 'var(--color-poor-text)';
    } else if (length >= min && length <= max) {
      element.style.color = 'var(--color-good-text)';
    } else {
      element.style.color = 'var(--color-needs-improvement-text)';
    }
  }

  updateCountIndicator(elementId, count, min, max) {
    const element = document.getElementById(elementId);
    if (count >= min && count <= max) {
      element.style.color = 'var(--color-good-text)';
    } else {
      element.style.color = 'var(--color-needs-improvement-text)';
    }
  }

  initStatus() {
    this.setStatus('Loading field data…');
  }

  initPage() {
    this.setPage(this.url);
  }

  initTimestamp() {
    const timestamp = document.getElementById('timestamp');
    if (!timestamp) {
      return;
    }

    timestamp.innerText = this.timestamp;
  }

  initMetrics() {
    if (!this._metrics?.lcp || !this._metrics?.cls || !this._metrics?.inp || !this._metrics?.fcp || !this._metrics?.ttfb) {
      return;
    }

    this.metrics.lcp = new LCP({
      local: this._metrics.lcp.value,
      rating: this._metrics.lcp.rating,
      background: this.background
    });
    this.metrics.cls = new CLS({
      local: this._metrics.cls.value,
      rating: this._metrics.cls.rating,
      background: this.background
    });
    this.metrics.inp = new INP({
      local: this._metrics.inp.value,
      rating: this._metrics.inp.rating,
      background: this.background
    });
    this.metrics.fcp = new FCP({
      local: this._metrics.fcp.value,
      rating: this._metrics.fcp.rating,
      background: this.background
    });
    this.metrics.ttfb = new TTFB({
      local: this._metrics.ttfb.value,
      rating: this._metrics.ttfb.rating,
      background: this.background
    });

    this.renderMetrics();
    this.renderVitalsFixSuggestions();
  }

  renderVitalsFixSuggestions() {
    const container = document.getElementById('vitals-fix-suggestions');
    const list = document.getElementById('vitals-fix-list');
    if (!container || !list) return;

    const suggestions = this.generateVitalsFixSuggestions();

    if (suggestions.length === 0) {
      container.style.display = 'none';
      return;
    }

    list.innerHTML = '';
    suggestions.forEach(text => {
      const li = document.createElement('li');
      li.textContent = text;
      list.appendChild(li);
    });
    container.style.display = 'block';
  }

  generateVitalsFixSuggestions() {
    const suggestions = [];
    const lcp = this._metrics?.lcp?.value;
    const cls = this._metrics?.cls?.value;
    const inp = this._metrics?.inp?.value;
    const fcp = this._metrics?.fcp?.value;
    const ttfb = this._metrics?.ttfb?.value;

    // LCP suggestions
    if (lcp !== undefined) {
      if (lcp > 4000) {
        suggestions.push(`LCP is ${(lcp / 1000).toFixed(1)}s (poor). Preload the LCP image with \`<link rel="preload" as="image"\`\`, optimize and compress images (WebP/AVIF), implement responsive images with srcset, and consider using an image CDN.`);
      } else if (lcp > 2500) {
        suggestions.push(`LCP is ${(lcp / 1000).toFixed(1)}s (needs improvement). Preload the hero image, remove render-blocking resources, and ensure the LCP element is not lazily loaded.`);
      }
    }

    // CLS suggestions
    if (cls !== undefined) {
      if (cls > 0.25) {
        suggestions.push(`CLS is ${cls.toFixed(2)} (poor). Reserve space for images and ads with width/height attributes or aspect-ratio CSS, avoid inserting content above existing content, and use font-display: optional to prevent layout shifts from web fonts.`);
      } else if (cls > 0.1) {
        suggestions.push(`CLS is ${cls.toFixed(2)} (needs improvement). Add explicit width and height attributes to images and videos, reserve space for dynamic content, and avoid injecting banners or ads above the fold.`);
      }
    }

    // INP suggestions
    if (inp !== undefined) {
      if (inp > 500) {
        suggestions.push(`INP is ${Math.round(inp)}ms (poor). Break up long JavaScript tasks into smaller chunks with \`setTimeout\` or \`requestIdleCallback\`, move heavy computation off the main thread with Web Workers, and debounce event handlers.`);
      } else if (inp > 200) {
        suggestions.push(`INP is ${Math.round(inp)}ms (needs improvement). Reduce the amount of JavaScript executing on user interaction, optimize event listeners, and consider using \`content-visibility: auto\` for off-screen content.`);
      }
    }

    // FCP suggestions
    if (fcp !== undefined) {
      if (fcp > 3000) {
        suggestions.push(`FCP is ${(fcp / 1000).toFixed(1)}s (poor). Eliminate render-blocking resources by inlining critical CSS and deferring non-critical stylesheets, reduce server response time, and preload critical fonts.`);
      } else if (fcp > 1800) {
        suggestions.push(`FCP is ${(fcp / 1000).toFixed(1)}s (needs improvement). Defer non-critical JavaScript, minimize unused CSS, and ensure text remains visible during webfont load with \`font-display: swap\`.`);
      }
    }

    // TTFB suggestions
    if (ttfb !== undefined) {
      if (ttfb > 800) {
        suggestions.push(`TTFB is ${(ttfb / 1000).toFixed(1)}s (poor). Use a CDN to serve content closer to users, enable caching on the server, optimize database queries, and consider edge rendering or static site generation.`);
      } else if (ttfb > 600) {
        suggestions.push(`TTFB is ${(ttfb / 1000).toFixed(1)}s (needs improvement). Enable Keep-Alive connections, use HTTP/2 or HTTP/3, and review server-side processing time.`);
      }
    }

    return suggestions;
  }

  initFieldData() {
    if (!this.url) {
      return;
    }

    const formFactor = this.options.preferPhoneField ? CrUX.FormFactor.PHONE : CrUX.FormFactor.DESKTOP;
    CrUX.load(this.url, formFactor).then(fieldData => {
      this.renderFieldData(fieldData, formFactor);
    }).catch(() => {
      this.setStatus('Local metrics only (field data unavailable)');
    });
  }

  setStatus(status) {
    const statusElement = document.getElementById('status');
    if (!statusElement) {
      return;
    }

    if (typeof status === 'string') {
      statusElement.innerText = status;
    } else {
      statusElement.replaceChildren(status);
    }
  }

  setPage(url) {
    const page = document.getElementById('page');
    if (!page) {
      return;
    }

    page.innerText = url;
    page.title = url;
  }

  setDevice(formFactor) {
    const deviceElement = document.querySelector('.device-icon');
    if (!deviceElement) {
      return;
    }

    deviceElement.classList.add(`device-${formFactor.toLowerCase()}`);
  }

  setHovercardText(metric, fieldData, formFactor = '') {
    const hovercard = document.querySelector(`#${metric.id} .hovercard`);
    const abbr = metric.abbr;
    const local = metric.formatValue(metric.local);
    const assessment = metric.rating;
    let text = `Your local <strong>${abbr}</strong> experience is <strong class="hovercard-local">${local}</strong> and rated <strong class="hovercard-local">${assessment}</strong>.`;

    if (fieldData) {
      const assessmentIndex = metric.getAssessmentIndex(metric.rating);
      const density = metric.getDensity(assessmentIndex, 0);
      const scope = CrUX.isOriginFallback(fieldData) ? 'origin' : 'page';
      text += ` <strong>${density}</strong> of <span class="nowrap">real-user</span> ${formFactor.toLowerCase()} <strong>${abbr}</strong> experiences on this ${scope} were also rated <strong class="hovercard-local">${assessment}</strong>.`
    }

    hovercard.innerHTML = text;
  }

  renderMetrics() {
    Object.values(this.metrics).forEach(this.renderMetric.bind(this));
  }

  renderMetric(metric) {
    const template = document.getElementById('metric-template');
    const fragment = template.content.cloneNode(true);
    const metricElement = fragment.querySelector('.metric-wrapper');
    const name = fragment.querySelector('.metric-name');
    const local = fragment.querySelector('.metric-performance-local');
    const localValue = fragment.querySelector('.metric-performance-local-value');
    const infoElement = fragment.querySelector('.info');
    const info = metric.getInfo() || '';
    const rating = metric.rating;

    metricElement.id = metric.id;
    name.innerText = metric.name;
    local.style.marginLeft = metric.getRelativePosition(metric.local);
    localValue.innerText = metric.formatValue(metric.local);
    metricElement.classList.toggle(rating, !!rating);
    infoElement.title = info;
    infoElement.classList.toggle('hidden', info === '');

    // Append to metrics container instead of template parent
    const metricsContainer = document.querySelector('.metrics-container');
    metricsContainer.appendChild(fragment);

    requestAnimationFrame(_ => {
      // Check reversal before and after the transition is settled.
      this.checkReversal(metric);
      this.setHovercardText(metric);
    });
    this.whenSettled(metric).then(_ => this.checkReversal(metric));
  }

  checkReversal(metric) {
    const container = document.querySelector(`#${metric.id} .metric-performance`);
    const local = document.querySelector(`#${metric.id} .metric-performance-local`);
    const localValue = document.querySelector(`#${metric.id} .metric-performance-local-value`);

    const containerBoundingRect = container.getBoundingClientRect();
    const localValueBoundingRect = localValue.getBoundingClientRect();
    const isOverflow = localValueBoundingRect.right > containerBoundingRect.right;

    local.classList.toggle('reversed', isOverflow || local.classList.contains('reversed'));
  }

  renderFieldData(fieldData, formFactor) {
    if (CrUX.isOriginFallback(fieldData)) {
      const fragment = document.createDocumentFragment();
      const span = document.createElement('span');
      span.innerHTML = `Page-level field data is not available<br>Comparing local metrics to <strong>origin-level ${formFactor.toLowerCase()} field data</strong> instead`;
      fragment.appendChild(span);
      this.setStatus(fragment);
      this.setPage(CrUX.getOrigin(fieldData));
    } else {
      this.setStatus(`Local metrics compared to ${formFactor.toLowerCase()} field data`);

      const normalizedUrl = CrUX.getNormalizedUrl(fieldData);
      if (normalizedUrl) {
        this.setPage(normalizedUrl);
      }
    }

    CrUX.getMetrics(fieldData).forEach(({ id, data }) => {
      const metric = this.metrics[id];
      if (!metric) {
        // The API may return additional metrics that we don't support.
        return;
      }

      metric.distribution = CrUX.getDistribution(data);

      const local = document.querySelector(`#${metric.id} .metric-performance-local`);
      local.style.marginLeft = metric.getRelativePosition(metric.local);

      ['good', 'needs-improvement', 'poor'].forEach((rating, i) => {
        const ratingElement = document.querySelector(`#${metric.id} .metric-performance-distribution-rating.${rating}`);

        ratingElement.innerText = metric.getDensity(i);
        ratingElement.style.setProperty('--rating-width', metric.getDensity(i, 2));
        ratingElement.style.setProperty('--min-rating-width', `${metric.MIN_PCT * 100}%`);
      });

      this.setDevice(formFactor);
      this.setHovercardText(metric, fieldData, formFactor);
      this.whenSettled(metric).then(_ => this.checkReversal(metric));
    });
  }

  whenSettled(metric) {
    const local = document.querySelector(`#${metric.id} .metric-performance-local`);
    return new Promise(resolve => {
      local.addEventListener('transitionend', resolve);
    });
  }

  initFooterLinks() {
    const optionsLink = document.getElementById('open-options');

    if (optionsLink) {
      optionsLink.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.runtime.openOptionsPage();
      });
    }
  }

  initExportButton() {
    const exportBtn = document.getElementById('export-report');
    if (!exportBtn) return;

    exportBtn.addEventListener('click', () => this.exportMarkdownReport());
  }

  async exportMarkdownReport() {
    const exportBtn = document.getElementById('export-report');
    const originalTitle = exportBtn?.title;

    try {
      if (exportBtn) {
        exportBtn.disabled = true;
        exportBtn.title = 'Loading all tabs…';
      }

      // Preload all tabs that haven't been loaded yet before exporting.
      const promises = [];
      if (!this.serverInfoLoaded) promises.push(this.loadServerInfo());
      if (!this.dnsInfoLoaded) promises.push(this.loadDNSInfo());
      if (!this.seoInfoLoaded) promises.push(this.loadSEOInfo());
      if (!this.techInfoLoaded) promises.push(this.loadTechInfo());
      if (!this.a11yInfoLoaded) promises.push(this.loadA11yInfo());

      if (promises.length > 0) {
        await Promise.all(promises);
      }

      // Allow the DOM to settle after the last updates.
      await new Promise(resolve => requestAnimationFrame(resolve));

      const md = this.generateMarkdownReport();
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');

      const hostname = new URL(this.url).hostname.replace(/[^a-z0-9\-.]/gi, '_');
      const date = new Date().toISOString().split('T')[0];

      a.href = url;
      a.download = `web-vitals-report-${hostname}-${date}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      if (exportBtn) {
        exportBtn.disabled = false;
        exportBtn.title = originalTitle || 'Export report as Markdown';
      }
    }
  }

  generateMarkdownReport() {
    const url = this.url;
    const timestamp = this.timestamp || new Date().toLocaleString();
    const date = new Date().toISOString();

    let md = `# Web Vitals Report\n\n`;
    md += `**URL:** ${url}\n`;
    md += `**Date:** ${date}\n\n`;

    // --- Web Vitals ---
    md += `## Web Vitals\n\n`;
    md += `| Metric | Value | Rating |\n`;
    md += `|--------|-------|--------|\n`;

    const vitalNames = { lcp: 'LCP', cls: 'CLS', inp: 'INP', fcp: 'FCP', ttfb: 'TTFB' };
    Object.entries(vitalNames).forEach(([key, name]) => {
      const metric = this.metrics[key];
      if (metric) {
        md += `| ${name} | ${metric.formatValue(metric.local)} | ${metric.rating || 'N/A'} |\n`;
      } else {
        md += `| ${name} | - | Not loaded |\n`;
      }
    });
    md += `\n`;

    // --- Server Info ---
    md += `## Server Info\n\n`;
    const serverFields = [
      { id: 'server-ip', label: 'IP Address' },
      { id: 'server-hostname', label: 'Hostname' },
      { id: 'server-location', label: 'Location' },
      { id: 'server-country', label: 'Country' },
      { id: 'server-region', label: 'Region' },
      { id: 'server-timezone', label: 'Timezone' },
      { id: 'server-isp', label: 'ISP' },
      { id: 'server-org', label: 'Organization' },
      { id: 'server-asn', label: 'ASN' },
    ];
    const serverLoaded = this.serverInfoLoaded;
    if (serverLoaded) {
      md += `| Field | Value |\n`;
      md += `|-------|-------|\n`;
      serverFields.forEach(f => {
        const el = document.getElementById(f.id);
        md += `| ${f.label} | ${el ? el.innerText.trim() : '-'} |\n`;
      });
    } else {
      md += `_Not loaded. Visit the Server Info tab to populate this section._\n`;
    }
    md += `\n`;

    // --- DNS Info ---
    md += `## DNS Info\n\n`;
    const dnsFields = [
      { id: 'dns-domain', label: 'Domain' },
      { id: 'dns-a-record', label: 'A Record' },
      { id: 'dns-aaaa-record', label: 'AAAA Record' },
      { id: 'dns-cname', label: 'CNAME' },
      { id: 'dns-mx', label: 'MX Records' },
      { id: 'dns-ns', label: 'NS' },
      { id: 'dns-txt', label: 'TXT Records' },
      { id: 'dns-soa', label: 'SOA' },
    ];
    if (this.dnsInfoLoaded) {
      md += `| Field | Value |\n`;
      md += `|-------|-------|\n`;
      dnsFields.forEach(f => {
        const el = document.getElementById(f.id);
        md += `| ${f.label} | ${el ? el.innerText.trim() : '-'} |\n`;
      });
    } else {
      md += `_Not loaded. Visit the DNS Info tab to populate this section._\n`;
    }
    md += `\n`;

    // --- SEO Analysis ---
    md += `## SEO Analysis\n\n`;
    if (this.seoInfoLoaded) {
      const daText = document.getElementById('domain-authority-text')?.innerText.trim() || '-';
      const drText = document.getElementById('domain-rating-text')?.innerText.trim() || '-';
      const seoText = document.getElementById('seo-score-text')?.innerText.trim() || '-';
      md += `| Score | Value |\n`;
      md += `|-------|-------|\n`;
      md += `| Domain Authority | ${daText} |\n`;
      md += `| Domain Rating | ${drText} |\n`;
      md += `| SEO Score | ${seoText} |\n`;
      md += `\n`;

      const seoFields = [
        { id: 'seo-title', label: 'Title' },
        { id: 'seo-description', label: 'Meta Description' },
        { id: 'seo-canonical', label: 'Canonical URL' },
        { id: 'seo-robots', label: 'Robots' },
        { id: 'seo-language', label: 'Language' },
        { id: 'seo-viewport', label: 'Viewport' },
        { id: 'seo-charset', label: 'Charset' },
        { id: 'seo-word-count', label: 'Word Count' },
        { id: 'seo-h1-count', label: 'H1 Tags' },
        { id: 'seo-h2-count', label: 'H2 Tags' },
        { id: 'seo-images-count', label: 'Total Images' },
        { id: 'seo-images-no-alt', label: 'Images Without Alt' },
        { id: 'seo-links-internal', label: 'Internal Links' },
        { id: 'seo-links-external', label: 'External Links' },
        { id: 'seo-favicon', label: 'Favicon' },
        { id: 'seo-deprecated-tags', label: 'Deprecated Tags' },
        { id: 'seo-schema', label: 'Schema.org Present' },
        { id: 'seo-schema-types', label: 'Schema Types' },
        { id: 'seo-og-title', label: 'OG Title' },
        { id: 'seo-og-description', label: 'OG Description' },
        { id: 'seo-og-type', label: 'OG Type' },
        { id: 'seo-twitter-card', label: 'Twitter Card' },
      ];
      md += `### Basic Information\n\n`;
      md += `| Field | Value |\n`;
      md += `|-------|-------|\n`;
      seoFields.forEach(f => {
        const el = document.getElementById(f.id);
        md += `| ${f.label} | ${el ? el.innerText.trim() : '-'} |\n`;
      });
    } else {
      md += `_Not loaded. Visit the SEO tab to populate this section._\n`;
    }
    md += `\n`;

    // --- Tech Stack ---
    md += `## Tech Stack\n\n`;
    if (this.techInfoLoaded) {
      const techFields = [
        { id: 'tech-cms', label: 'CMS / Generator' },
        { id: 'tech-server', label: 'Server & Backend' },
        { id: 'tech-frameworks', label: 'Frameworks & Libraries' },
        { id: 'tech-analytics', label: 'Analytics & Tools' },
        { id: 'tech-fonts', label: 'Fonts' },
      ];
      md += `| Field | Value |\n`;
      md += `|-------|-------|\n`;
      techFields.forEach(f => {
        const el = document.getElementById(f.id);
        md += `| ${f.label} | ${el ? el.innerText.trim() : '-'} |\n`;
      });
    } else {
      md += `_Not loaded. Visit the Tech Stack tab to populate this section._\n`;
    }
    md += `\n`;

    // --- Accessibility ---
    md += `## Accessibility\n\n`;
    if (this.a11yInfoLoaded) {
      const a11yScore = document.getElementById('a11y-score-text')?.innerText.trim() || '-';
      const a11yLevel = document.getElementById('a11y-level')?.innerText.trim() || '-';
      md += `| Score | ${a11yScore} |\n`;
      md += `| Level | ${a11yLevel} |\n\n`;

      const a11yStats = [
        { id: 'a11y-stats-images', label: 'Images' },
        { id: 'a11y-stats-links', label: 'Links' },
        { id: 'a11y-stats-buttons', label: 'Buttons' },
        { id: 'a11y-stats-inputs', label: 'Inputs' },
      ];
      md += `### Elements Scanned\n\n`;
      md += `| Element | Count |\n`;
      md += `|---------|-------|\n`;
      a11yStats.forEach(f => {
        const el = document.getElementById(f.id);
        md += `| ${f.label} | ${el ? el.innerText.trim() : '-'} |\n`;
      });
    } else {
      md += `_Not loaded. Visit the A11y tab to populate this section._\n`;
    }
    md += `\n`;

    md += `---\n\n_Generated by Web Vitals Chrome Extension_\n`;

    return md;
  }

}

Promise.all([loadLocalMetrics(), getOptions(), getURL()]).then(([localMetrics, options, url]) => {
  window.popup = new Popup({ ...localMetrics, options, url });
});
