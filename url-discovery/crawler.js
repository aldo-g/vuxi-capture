const { chromium } = require('playwright');
const { isValidUrl, normalizeUrl, isSameDomain, shouldExcludeUrl, createDeduplicationKey, deduplicateUrls } = require('./utils');

class URLCrawler {
  constructor(options = {}) {
    this.maxPages = options.maxPages || 50;
    this.timeout = options.timeout || 8000;
    this.waitTime = options.waitTime || 0.5;
    this.concurrency = options.concurrency || 3;
    this.excludePatterns = options.excludePatterns || [];
    this.fastMode = options.fastMode !== false;
    
    this.visitedUrls = new Set();
    this.discoveredUrls = new Set();
    this.urlsToVisit = [];
    this.deduplicationKeys = new Set();
    this.actualBaseUrl = null; // Store the final URL after redirects
    this.stats = {
      pagesCrawled: 0,
      pagesSkipped: 0,
      errors: 0,
      duplicatesSkipped: 0,
      redirectDetected: false,
      originalUrl: null,
      finalUrl: null,
      startTime: Date.now()
    };
  }
  
  async extractLinks(page, baseUrl) {
    try {
      // Wait a moment for any dynamic content to load
      await page.waitForTimeout(500);
      
      const links = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a[href]')).map(link => link.href);
      });
      
      console.log(`    🔍 Raw links found: ${links.length}`);
      
      const validLinks = [];
      // Use the actual base URL (after redirects) for domain checking
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
      console.error('Error extracting links:', error);
      return [];
    }
  }
  
  async crawlPage(browser, url, pageIndex) {
    let page = null;
    try {
      page = await browser.newPage();
      
      // Balanced resource blocking - keep CSS for navigation, block heavy resources
      if (this.fastMode) {
        await page.route('**/*', (route) => {
          const request = route.request();
          const resourceType = request.resourceType();
          
          // Only block images and media, keep CSS and fonts for navigation
          if (['image', 'media'].includes(resourceType)) {
            route.abort();
          } else {
            route.continue();
          }
        });
      }
      
      console.log(`  📄 [${pageIndex}] Crawling: ${url}`);
      
      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: this.timeout
      });
      
      if (!response || response.status() >= 400) {
        console.log(`  ⚠️  [${pageIndex}] Warning: HTTP ${response ? response.status() : 'unknown'} for ${url}`);
        this.stats.pagesSkipped++;
        return [];
      }
      
      // Check for redirects on the first page
      if (pageIndex === 1) {
        const finalUrl = page.url();
        if (finalUrl !== url) {
          console.log(`  🔄 [${pageIndex}] Redirect detected:`);
          console.log(`      Original: ${url}`);
          console.log(`      Final: ${finalUrl}`);
          
          this.actualBaseUrl = finalUrl;
          this.stats.redirectDetected = true;
          this.stats.originalUrl = url;
          this.stats.finalUrl = finalUrl;
          
          // Add the final URL to our discovered URLs if it's not already there
          const normalizedFinalUrl = normalizeUrl(finalUrl);
          if (!this.discoveredUrls.has(normalizedFinalUrl)) {
            this.discoveredUrls.add(normalizedFinalUrl);
            this.deduplicationKeys.add(createDeduplicationKey(normalizedFinalUrl));
          }
        }
      }
      
      // Small wait for dynamic content
      if (this.waitTime > 0) {
        await page.waitForTimeout(this.waitTime * 1000);
      }
      
      const newLinks = await this.extractLinks(page, url);
      console.log(`  🔗 [${pageIndex}] Found ${newLinks.length} new links`);
      
      this.stats.pagesCrawled++;
      return newLinks;
      
    } catch (error) {
      console.error(`  ❌ [${pageIndex}] Error crawling ${url}:`, error.message);
      this.stats.errors++;
      return [];
    } finally {
      if (page) {
        await page.close().catch(() => {});
      }
    }
  }
  
  async processBatch(browser, urls, startIndex) {
    const promises = urls.map((url, i) => 
      this.crawlPage(browser, url, startIndex + i + 1)
    );
    
    const results = await Promise.allSettled(promises);
    
    const allNewLinks = [];
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        allNewLinks.push(...result.value);
      } else {
        console.error(`Batch error for ${urls[i]}:`, result.reason.message);
        this.stats.errors++;
      }
    });
    
    return allNewLinks;
  }
  
  async crawl(startUrl) {
    const browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-features=TranslateUI,BlinkGenPropertyTrees',
        '--disable-background-networking',
        '--disable-sync',
        '--disable-default-apps',
        '--no-first-run',
        '--disable-extensions'
      ]
    });
    
    try {
      const normalizedStartUrl = normalizeUrl(startUrl);
      this.urlsToVisit.push(normalizedStartUrl);
      this.discoveredUrls.add(normalizedStartUrl);
      this.deduplicationKeys.add(createDeduplicationKey(normalizedStartUrl));
      
      // Store original URL for stats
      this.stats.originalUrl = normalizedStartUrl;
      
      console.log(`🚀 Starting concurrent crawl (${this.concurrency} parallel) from: ${normalizedStartUrl}`);
      
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
        
        console.log(`\n[Batch ${Math.floor(processedCount/this.concurrency) + 1}] Processing ${currentBatch.length} URLs concurrently...`);
        
        const batchStartTime = Date.now();
        const newLinks = await this.processBatch(browser, currentBatch, processedCount);
        const batchDuration = (Date.now() - batchStartTime) / 1000;
        
        // Add new links to queue
        for (const link of newLinks) {
          if (!this.visitedUrls.has(link) && !this.urlsToVisit.includes(link)) {
            this.urlsToVisit.push(link);
          }
        }
        
        processedCount += currentBatch.length;
        
        console.log(`  ⚡ Batch completed in ${batchDuration.toFixed(2)}s`);
        console.log(`  📊 Queue: ${this.urlsToVisit.length} | Discovered: ${this.discoveredUrls.size} | Visited: ${this.visitedUrls.size} | Duplicates: ${this.stats.duplicatesSkipped}`);
        
        // Show redirect info if detected
        if (this.stats.redirectDetected && processedCount === currentBatch.length) {
          console.log(`  🔄 Using redirected domain: ${this.actualBaseUrl}`);
        }
      }
      
      const finalUrls = deduplicateUrls(Array.from(this.discoveredUrls));
      
      this.stats.duration = (Date.now() - this.stats.startTime) / 1000;
      this.stats.finalUrlCount = finalUrls.length;
      this.stats.totalUrlsDiscovered = this.discoveredUrls.size;
      this.stats.duplicatesRemoved = this.discoveredUrls.size - finalUrls.length;
      
      // Set final URL in stats if no redirect was detected
      if (!this.stats.finalUrl) {
        this.stats.finalUrl = this.stats.originalUrl;
      }
      
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