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
    this.actualBaseUrl = null;
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
        waitUntil: 'domcontentloaded',
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
      
      if (this.waitTime > 0) {
        await page.waitForTimeout(this.waitTime * 1000);
      }
      
      const newLinks = await this.extractLinks(page, url);
      this.stats.pagesCrawled++;
      return newLinks;
      
    } catch (error) {
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
      this.stats.originalUrl = normalizedStartUrl;
      
      console.log(`🔍 Crawling ${normalizedStartUrl}...`);
      
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
      
      const finalUrls = deduplicateUrls(Array.from(this.discoveredUrls));
      
      this.stats.duration = (Date.now() - this.stats.startTime) / 1000;
      this.stats.finalUrlCount = finalUrls.length;
      this.stats.totalUrlsDiscovered = this.discoveredUrls.size;
      this.stats.duplicatesRemoved = this.discoveredUrls.size - finalUrls.length;
      
      if (!this.stats.finalUrl) {
        this.stats.finalUrl = this.stats.originalUrl;
      }
      
      console.log(`✅ Found ${finalUrls.length} URLs in ${this.stats.duration.toFixed(1)}s`);
      
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