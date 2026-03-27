const { chromium } = require('playwright');
const {
  isValidUrl,
  normalizeUrl,
  isSameDomain,
  shouldExcludeUrl,
  createDeduplicationKey,
  deduplicateUrls,
  applyUrlDiversityFilters
} = require('./utils');

class URLCrawler {
  constructor(options = {}) {
    this.maxPages = options.maxPages || 50;
    this.timeout = options.timeout || 8000;
    this.waitTime = options.waitTime || 0.5;
    this.concurrency = options.concurrency || 3;
    this.excludePatterns = options.excludePatterns || [];
    this.fastMode = options.fastMode !== false;

    // New diversity options
    this.enableDiversityFilters = options.enableDiversityFilters !== false;
    this.diversityOptions = {
      maxPerCategory: options.maxPerCategory || 2,
      similarityThreshold: options.similarityThreshold || 0.7,
      prioritizeHigherLevels: options.prioritizeHigherLevels !== false,
      ...options.diversityOptions
    };

    this.visitedUrls = new Set();
    this.discoveredUrls = new Set();
    this.urlsToVisit = [];
    this.deduplicationKeys = new Set();
    this.actualBaseUrl = null;
    this.stats = {
      pagesCrawled: 0,
      pagesSkipped: 0,
      errors: 0,
      duplicatesSkipped: 0,
      redirectDetected: false,
      originalUrl: null,
      finalUrl: null,
      startTime: Date.now(),
      diversityFilteringEnabled: this.enableDiversityFilters,
      urlsBeforeDiversityFilter: 0,
      urlsAfterDiversityFilter: 0,
      urlsRemovedByDiversityFilter: 0
    };
  }

  async extractLinks(page, baseUrl) {
    try {
      await page.waitForTimeout(500);

      const links = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a[href]')).map(link => link.href);
      });

      const validLinks = [];
      const domainCheckUrl = this.actualBaseUrl || baseUrl;

      for (const link of links) {
        if (!isValidUrl(link)) continue;
        if (!link.startsWith('http://') && !link.startsWith('https://')) continue;
        if (!isSameDomain(domainCheckUrl, link)) continue;

        const normalizedUrl = normalizeUrl(link);
        if (shouldExcludeUrl(normalizedUrl, this.excludePatterns)) continue;

        const dedupKey = createDeduplicationKey(normalizedUrl);
        if (this.deduplicationKeys.has(dedupKey)) {
          this.stats.duplicatesSkipped++;
          continue;
        }

        if (this.discoveredUrls.has(normalizedUrl)) continue;

        validLinks.push(normalizedUrl);
        this.discoveredUrls.add(normalizedUrl);
        this.deduplicationKeys.add(dedupKey);
      }

      return validLinks;
    } catch (error) {
      return [];
    }
  }

  async discoverSpaRoutes(page, baseUrl) {
    const domainCheckUrl = this.actualBaseUrl || baseUrl;
    const discoveredRoutes = [];
    const urlBefore = page.url();

    // Snapshot element metadata upfront — text + bounding box for re-identification
    const selector = [
      'button:not([type="submit"]):not([type="reset"])',
      '[role="button"]',
      '[role="link"]',
      '[onclick]',
      '[data-href]',
      '[data-url]',
      '[data-route]',
    ].join(',');

    // Snapshot all element identifiers from a clean page load
    // We use innerText + index as identity since we reload before each click
    let elementTexts = [];
    try {
      elementTexts = await page.evaluate((sel) => {
        return Array.from(document.querySelectorAll(sel))
          .filter(el => {
            if (el.closest('a[href]')) return false;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
            return el.offsetWidth > 0 && el.offsetHeight > 0;
          })
          .map((el, i) => ({ i, text: el.innerText?.trim().substring(0, 80) || '' }));
      }, selector);
    } catch {
      return discoveredRoutes;
    }

    for (const { i, text } of elementTexts) {
      try {
        // Always reload to get a clean page state before each click
        await page.goto(urlBefore, { waitUntil: 'networkidle', timeout: this.timeout });
        await page.waitForTimeout(300);

        // Re-find the element by its position among filtered elements
        const handle = await page.evaluateHandle(({ sel, idx }) => {
          const els = Array.from(document.querySelectorAll(sel)).filter(el => {
            if (el.closest('a[href]')) return false;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
            return el.offsetWidth > 0 && el.offsetHeight > 0;
          });
          return els[idx] || null;
        }, { sel: selector, idx: i });

        const el = handle.asElement();
        if (!el) continue;

        await el.scrollIntoViewIfNeeded();
        await el.click();
        await page.waitForTimeout(800);

        const urlAfter = page.url();

        if (urlAfter !== urlBefore) {
          const normalized = normalizeUrl(urlAfter);
          if (
            isValidUrl(normalized) &&
            isSameDomain(domainCheckUrl, normalized) &&
            !shouldExcludeUrl(normalized, this.excludePatterns) &&
            !this.discoveredUrls.has(normalized)
          ) {
            const dedupKey = createDeduplicationKey(normalized);
            if (!this.deduplicationKeys.has(dedupKey)) {
              // Verify the URL is directly loadable (not state-gated — would redirect away)
              const verifyPage = await page.context().newPage();
              let directlyLoadable = false;
              try {
                await verifyPage.goto(normalized, { waitUntil: 'networkidle', timeout: this.timeout });
                const landedUrl = normalizeUrl(verifyPage.url());
                directlyLoadable = landedUrl === normalized;
              } catch {
                // If it errors, treat as not loadable
              } finally {
                await verifyPage.close();
              }

              if (directlyLoadable) {
                discoveredRoutes.push(normalized);
                this.discoveredUrls.add(normalized);
                this.deduplicationKeys.add(dedupKey);
                console.log(`  🖱️  Click on "${text.substring(0, 50) || 'element'}" revealed: ${normalized}`);
              } else {
                console.log(`  ⚠️  Skipping state-gated route (redirects when loaded directly): ${normalized}`);
              }
            }
          }
        }
      } catch {
        // Skip elements that fail
      }
    }

    return discoveredRoutes;
  }

  async crawlPage(browser, url, pageIndex) {
    let page = null;
    try {
      page = await browser.newPage();

      if (this.fastMode) {
        await page.route('**/*', (route) => {
          const request = route.request();
          const resourceType = request.resourceType();

          if (['image', 'media'].includes(resourceType)) {
            route.abort();
          } else {
            route.continue();
          }
        });
      }

      const response = await page.goto(url, {
        waitUntil: 'networkidle',
        timeout: this.timeout
      });

      if (!response || response.status() >= 400) {
        this.stats.pagesSkipped++;
        return [];
      }

      // Check for redirects on the first page
      if (pageIndex === 1) {
        const finalUrl = page.url();
        if (finalUrl !== url) {
          this.actualBaseUrl = finalUrl;
          this.stats.redirectDetected = true;
          this.stats.originalUrl = url;
          this.stats.finalUrl = finalUrl;

          const normalizedFinalUrl = normalizeUrl(finalUrl);
          if (!this.discoveredUrls.has(normalizedFinalUrl)) {
            this.discoveredUrls.add(normalizedFinalUrl);
            this.deduplicationKeys.add(createDeduplicationKey(normalizedFinalUrl));
          }
        }
      }

      this.stats.pagesCrawled++;

      if (this.waitTime > 0) {
        await page.waitForTimeout(this.waitTime * 1000);
      }

      const links = await this.extractLinks(page, url);

      // SPA discovery needs a clean page without the fastMode route interceptor
      // (the interceptor blocks navigation triggered by JS clicks)
      const spaPage = await browser.newPage();
      let spaRoutes = [];
      try {
        await spaPage.goto(url, { waitUntil: 'networkidle', timeout: this.timeout });
        spaRoutes = await this.discoverSpaRoutes(spaPage, url);
      } finally {
        await spaPage.close();
      }

      console.log(`  📄 ${url}: found ${links.length} new links, ${spaRoutes.length} SPA routes`);

      return [...links, ...spaRoutes];

    } catch (error) {
      console.log(`  ❌ ${url}: ${error.message}`);
      this.stats.errors++;
      return [];
    } finally {
      if (page) {
        await page.close();
      }
    }
  }

  async processBatch(browser, urls, startIndex) {
    const promises = urls.map((url, index) =>
      this.crawlPage(browser, url, startIndex + index + 1)
    );

    const results = await Promise.all(promises);
    return results.flat();
  }

  async crawl(startUrl) {
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
      const normalizedStartUrl = normalizeUrl(startUrl);
      this.actualBaseUrl = normalizedStartUrl;
      this.stats.originalUrl = startUrl;

      this.discoveredUrls.add(normalizedStartUrl);
      this.deduplicationKeys.add(createDeduplicationKey(normalizedStartUrl));
      this.urlsToVisit.push(normalizedStartUrl);

      console.log(`🔍 Crawling ${normalizedStartUrl}...`);
      if (this.enableDiversityFilters) {
        console.log(`🎯 Diversity filtering enabled (max ${this.diversityOptions.maxPerCategory} per category)`);
      }

      let processedCount = 0;

      while (this.urlsToVisit.length > 0 && processedCount < this.maxPages) {
        const batchSize = Math.min(this.concurrency, this.urlsToVisit.length, this.maxPages - processedCount);
        const currentBatch = [];

        for (let i = 0; i < batchSize; i++) {
          const url = this.urlsToVisit.shift();
          if (!this.visitedUrls.has(url)) {
            this.visitedUrls.add(url);
            currentBatch.push(url);
          }
        }

        if (currentBatch.length === 0) continue;

        const newLinks = await this.processBatch(browser, currentBatch, processedCount);

        for (const link of newLinks) {
          if (!this.visitedUrls.has(link) && !this.urlsToVisit.includes(link)) {
            this.urlsToVisit.push(link);
          }
        }

        processedCount += currentBatch.length;
      }

      // First apply standard deduplication
      let finalUrls = deduplicateUrls(Array.from(this.discoveredUrls));

      // Apply diversity filters if enabled and URL count is above 10
      if (this.enableDiversityFilters && finalUrls.length > 10) {
        this.stats.urlsBeforeDiversityFilter = finalUrls.length;
        console.log(`📊 Applying diversity filters to ${finalUrls.length} URLs...`);

        finalUrls = applyUrlDiversityFilters(finalUrls, this.diversityOptions);

        this.stats.urlsAfterDiversityFilter = finalUrls.length;
        this.stats.urlsRemovedByDiversityFilter = this.stats.urlsBeforeDiversityFilter - this.stats.urlsAfterDiversityFilter;

        console.log(`   ✨ Diversity filters removed ${this.stats.urlsRemovedByDiversityFilter} similar URLs`);
      } else if (this.enableDiversityFilters) {
        console.log(`ℹ️  Skipping diversity filters: ${finalUrls.length} URLs found (threshold is 10)`);
      }

      // Enforce the maxPages limit as the final step
      if (finalUrls.length > this.maxPages) {
        console.log(`✂️  Trimming final URL list from ${finalUrls.length} to ${this.maxPages}`);
        finalUrls = finalUrls.slice(0, this.maxPages);
      }

      this.stats.duration = (Date.now() - this.stats.startTime) / 1000;
      this.stats.finalUrlCount = finalUrls.length;
      this.stats.totalUrlsDiscovered = this.discoveredUrls.size;
      this.stats.duplicatesRemoved = this.discoveredUrls.size - finalUrls.length;

      if (!this.stats.finalUrl) {
        this.stats.finalUrl = this.stats.originalUrl;
      }

      console.log(`✅ Found ${finalUrls.length} diverse URLs in ${this.stats.duration.toFixed(1)}s`);

      return {
        urls: finalUrls,
        stats: this.stats
      };

    } finally {
      await browser.close();
    }
  }
}

module.exports = { URLCrawler };