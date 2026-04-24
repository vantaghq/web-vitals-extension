/*
 Accessibility Information Module
 Detects common accessibility issues on the current page
*/

export class A11yInfo {
    static async load() {
        try {
            // Get active tab to extract a11y information
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

            if (!tab?.id) {
                throw new Error('Unable to access current tab');
            }

            // Execute script in the page to extract DOM-based a11y data
            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: extractA11yData,
            });

            if (!results || !results[0]) {
                throw new Error('Unable to extract accessibility data');
            }

            const a11yData = results[0].result;
            a11yData.fixSuggestions = generateA11yFixSuggestions(a11yData.issues, a11yData.stats);
            return a11yData;

        } catch (error) {
            console.error('A11y Info error:', error);
            return {
                score: 0,
                issues: [],
                goodPractices: [],
                stats: {
                    images: 0,
                    links: 0,
                    buttons: 0,
                    inputs: 0,
                    headings: 0
                }
            };
        }
    }
}

function extractA11yData() {
    const issues = [];
    const goodPractices = [];
    const stats = {
        images: 0,
        links: 0,
        buttons: 0,
        inputs: 0,
        headings: 0
    };

    // --- Images ---
    const images = document.querySelectorAll('img');
    stats.images = images.length;
    let imagesWithoutAlt = 0;

    images.forEach(img => {
        // Ignore decorative images if they have empty alt or role="presentation"
        if (!img.hasAttribute('alt') && img.getAttribute('role') !== 'presentation') {
            imagesWithoutAlt++;
        }
    });

    if (imagesWithoutAlt > 0) {
        issues.push({
            category: 'Images',
            text: `${imagesWithoutAlt} images missing alt text`,
            severity: 'critical'
        });
    } else if (stats.images > 0) {
        goodPractices.push('All images have alt text');
    }

    // --- Links ---
    const links = document.querySelectorAll('a');
    stats.links = links.length;
    let emptyLinks = 0;
    let genericLinks = 0;
    const genericTerms = ['click here', 'read more', 'more', 'here', 'link'];

    links.forEach(link => {
        const text = link.innerText.trim().toLowerCase();
        const ariaLabel = link.getAttribute('aria-label');
        const hasContent = text.length > 0 || ariaLabel || link.querySelector('img[alt]');

        if (!hasContent) {
            emptyLinks++;
        } else if (genericTerms.includes(text) && !ariaLabel) {
            genericLinks++;
        }
    });

    if (emptyLinks > 0) {
        issues.push({
            category: 'Links',
            text: `${emptyLinks} links are empty (no text or label)`,
            severity: 'critical'
        });
    }

    if (genericLinks > 0) {
        issues.push({
            category: 'Links',
            text: `${genericLinks} links use generic text ("click here")`,
            severity: 'warning'
        });
    }

    // --- Buttons ---
    const buttons = document.querySelectorAll('button');
    stats.buttons = buttons.length;
    let emptyButtons = 0;

    buttons.forEach(btn => {
        const text = btn.innerText.trim();
        const ariaLabel = btn.getAttribute('aria-label');
        const ariaLabelledBy = btn.getAttribute('aria-labelledby');

        if (!text && !ariaLabel && !ariaLabelledBy) {
            emptyButtons++;
        }
    });

    if (emptyButtons > 0) {
        issues.push({
            category: 'Buttons',
            text: `${emptyButtons} buttons are empty (no text or label)`,
            severity: 'critical'
        });
    }

    // --- Forms ---
    const inputs = document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea');
    stats.inputs = inputs.length;
    let missingLabels = 0;

    inputs.forEach(input => {
        const id = input.id;
        const cssId = id ? id.replace(/"/g, '\\"') : id;
        const hasLabel =
            (cssId && document.querySelector(`label[for="${cssId}"]`)) ||
            input.closest('label') ||
            input.getAttribute('aria-label') ||
            input.getAttribute('aria-labelledby') ||
            input.getAttribute('title'); // Title is a fallback but not ideal

        if (!hasLabel) {
            missingLabels++;
        }
    });

    if (missingLabels > 0) {
        issues.push({
            category: 'Forms',
            text: `${missingLabels} form inputs missing labels`,
            severity: 'critical'
        });
    } else if (stats.inputs > 0) {
        goodPractices.push('All form inputs have labels');
    }

    // --- Headings ---
    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
    stats.headings = headings.length;

    if (headings.length === 0) {
        issues.push({
            category: 'Structure',
            text: 'No headings found on page',
            severity: 'warning'
        });
    } else {
        const levels = headings.map(h => parseInt(h.tagName.substring(1)));
        let skippedLevels = 0;

        if (levels[0] !== 1) {
            issues.push({
                category: 'Structure',
                text: 'Page does not start with H1',
                severity: 'warning'
            });
        }

        for (let i = 0; i < levels.length - 1; i++) {
            if (levels[i + 1] > levels[i] + 1) {
                skippedLevels++;
            }
        }

        if (skippedLevels > 0) {
            issues.push({
                category: 'Structure',
                text: `${skippedLevels} skipped heading levels (e.g. H2 to H4)`,
                severity: 'warning'
            });
        }
    }

    // --- Landmarks ---
    const landmarks = {
        main: document.querySelector('main') || document.querySelector('[role="main"]'),
        nav: document.querySelector('nav') || document.querySelector('[role="navigation"]'),
        header: document.querySelector('header') || document.querySelector('[role="banner"]'),
        footer: document.querySelector('footer') || document.querySelector('[role="contentinfo"]')
    };

    if (!landmarks.main) {
        issues.push({
            category: 'Structure',
            text: 'Missing <main> landmark',
            severity: 'critical'
        });
    } else {
        goodPractices.push('<main> landmark present');
    }

    // --- Focus ---
    const badTabindex = document.querySelectorAll('[tabindex]:not([tabindex="-1"]):not([tabindex="0"])');
    if (badTabindex.length > 0) {
        issues.push({
            category: 'Focus',
            text: `${badTabindex.length} elements with positive tabindex (bad practice)`,
            severity: 'warning'
        });
    }

    // --- Score Calculation ---
    // Start with 100, deduct based on issues
    let score = 100;
    issues.forEach(issue => {
        if (issue.severity === 'critical') score -= 10;
        if (issue.severity === 'warning') score -= 5;
    });
    score = Math.max(0, score);

    // Estimate WCAG Level based on score (Heuristic)
    let complianceLevel = 'Fail';
    if (score === 100) {
        complianceLevel = 'AAA (Potential)';
    } else if (score >= 90) {
        complianceLevel = 'AA (Potential)';
    } else if (score >= 70) {
        complianceLevel = 'A (Potential)';
    }

    return {
        score,
        complianceLevel,
        issues,
        goodPractices,
        stats
    };
}

function generateA11yFixSuggestions(issues, stats) {
    const suggestions = [];

    // Images without alt
    const imagesIssue = issues.find(i => i.category === 'Images');
    if (imagesIssue) {
        const count = parseInt(imagesIssue.text);
        suggestions.push(`${count} images are missing alt text. Add alt="" for purely decorative images (icons, backgrounds) and descriptive alt attributes for informative images (charts, product photos, diagrams).`);
    }

    // Empty links
    const emptyLinksIssue = issues.find(i => i.text.includes('empty'));
    if (emptyLinksIssue) {
        const count = parseInt(emptyLinksIssue.text);
        suggestions.push(`${count} links are empty (no text or label). Ensure every link has visible text, an aria-label, or an image with alt text. Empty links are invisible to screen reader users.`);
    }

    // Generic links
    const genericLinksIssue = issues.find(i => i.text.includes('generic'));
    if (genericLinksIssue) {
        const count = parseInt(genericLinksIssue.text);
        suggestions.push(`${count} links use generic text like "click here" or "read more". Replace with descriptive text such as "Download the 2024 report" or "Read more about accessibility guidelines" so screen reader users understand the destination.`);
    }

    // Empty buttons
    const emptyButtonsIssue = issues.find(i => i.category === 'Buttons');
    if (emptyButtonsIssue) {
        const count = parseInt(emptyButtonsIssue.text);
        suggestions.push(`${count} buttons are empty (no text or label). Add visible text, an aria-label, or aria-labelledby pointing to a descriptive element. Empty buttons are unidentifiable to assistive technology.`);
    }

    // Missing labels
    const missingLabelsIssue = issues.find(i => i.category === 'Forms');
    if (missingLabelsIssue) {
        const count = parseInt(missingLabelsIssue.text);
        suggestions.push(`${count} form inputs are missing labels. Use an explicit \`<label for="id"\`\`, wrap the input in a \`<label\`\`, or add an aria-label / aria-labelledby attribute. Unlabeled inputs are impossible for screen reader users to understand.`);
    }

    // Headings structure
    const noHeadingsIssue = issues.find(i => i.text.includes('No headings'));
    if (noHeadingsIssue) {
        suggestions.push('No headings were found. Add an \`<h1\`\` for the main page title and use \`<h2\`\`–\`<h6\`\` to create a logical outline. Headings are the primary navigation method for screen reader users.');
    }

    const skippedHeadingsIssue = issues.find(i => i.text.includes('skipped'));
    if (skippedHeadingsIssue) {
        suggestions.push('Heading levels are skipped (e.g., jumping from H2 to H4). Maintain a sequential hierarchy: H1 → H2 → H3. Skipped levels confuse screen reader users who rely on headings to navigate.');
    }

    const noH1Issue = issues.find(i => i.text.includes('does not start with H1'));
    if (noH1Issue) {
        suggestions.push('The page does not start with an \`<h1\`\`. Every page should have exactly one H1 that describes the main topic. This is critical for screen reader navigation and SEO.');
    }

    // Landmarks
    const mainLandmarkIssue = issues.find(i => i.text.includes('<main>'));
    if (mainLandmarkIssue) {
        suggestions.push('No \`<main>\` landmark found. Wrap the primary content in a \`<main>\` element or add \`role="main"\`. Landmarks allow screen reader users to jump directly to the main content.');
    }

    // Focus
    const tabindexIssue = issues.find(i => i.text.includes('tabindex'));
    if (tabindexIssue) {
        suggestions.push('Avoid positive tabindex values (\`tabindex="1"\`, etc.). They break the natural tab order and make keyboard navigation unpredictable. Use \`tabindex="0"\` for custom interactive elements or focus management with JavaScript.');
    }

    // General suggestions if score is low
    if (suggestions.length === 0 && stats) {
        suggestions.push('Great job! Your page meets basic accessibility criteria. To go further, test keyboard navigation (Tab, Shift+Tab, Enter, Escape) and run an axe or Lighthouse audit for deeper analysis.');
    }

    return suggestions;
}

