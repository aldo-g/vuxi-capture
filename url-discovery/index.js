const fs = require('fs-extra');
const path = require('path');
const { URLCrawler } = require('./crawler');
const { limitUrlsPerCategory, hierarchicalSampling, simpleAggressiveFilter } = require('./utils');

class URLDiscoveryService {
  constructor(options = {}) {
    this.maxPages = options.maxPages || 50;
    this.timeout = options.timeout || 8000;
    this.waitTime = options.waitTime || 0.5;
    this.concurrency = options.concurrency || 3;
    this.fastMode = options.fastMode !== undefined ? options.fastMode : true;
    this.excludePatterns = options.excludePatterns || [];
    this.outputDir = options.outputDir || './data';
    this.maxUrlsPerCategory = options.maxUrlsPerCategory || 5;
    this.enableCategoryLimiting = options.enableCategoryLimiting !== undefined ? options.enableCategoryLimiting : true;
    this.enableHierarchicalSampling = options.enableHierarchicalSampling !== undefined ? options.enableHierarchicalSampling : true;

    this.hierarchicalOptions = {
      maxDepth: options.hierarchicalOptions?.maxDepth || options.maxDepth || 3,
      samplesPerCategory: options.hierarchicalOptions?.samplesPerCategory || options.samplesPerCategory || 2,
      prioritizeOverviews: options.hierarchicalOptions?.prioritizeOverviews !== undefined ? options.hierarchicalOptions.prioritizeOverviews : true,
      skipLegalPages: options.hierarchicalOptions?.skipLegalPages !== undefined ? options.hierarchicalOptions.skipLegalPages : true,
      maxUrlsTotal: options.hierarchicalOptions?.maxUrlsTotal || options.maxUrlsTotal || 10
    };
  }

  async discover(startUrl) {
    const startTime = Date.now();
    
    try {
      const excludePatterns = this.excludePatterns.map(pattern => {
        return typeof pattern === 'string' ? new RegExp(pattern) : pattern;
      });
      
      const crawler = new URLCrawler({
        maxPages: this.maxPages,
        timeout: this.timeout,
        waitTime: parseFloat(this.waitTime) || 0.5,
        concurrency: this.concurrency,
        fastMode: this.fastMode,
        excludePatterns: excludePatterns
      });
      
      const results = await crawler.crawl(startUrl);
      
      let finalUrls = results.urls;
      
      // Apply hierarchical sampling if enabled
      if (this.enableHierarchicalSampling) {
        finalUrls = hierarchicalSampling(finalUrls, this.hierarchicalOptions);
      }
      
      // Apply category limiting if enabled
      if (this.enableCategoryLimiting) {
        finalUrls = limitUrlsPerCategory(finalUrls, this.maxUrlsPerCategory);
      }

      // Apply final hard limit
      const maxUrlsTotal = this.hierarchicalOptions.maxUrlsTotal || 10;
      if (finalUrls.length > maxUrlsTotal) {
        console.log(`📊 Limiting to ${maxUrlsTotal} URLs (reduced from ${finalUrls.length})`);
        finalUrls = finalUrls.slice(0, maxUrlsTotal);
      }

      // Apply final aggressive filter
      finalUrls = simpleAggressiveFilter(finalUrls);
      const duration = (Date.now() - startTime) / 1000;
      
      // Save files
      await fs.ensureDir(this.outputDir);
      
      const fullData = {
        discoveredAt: new Date().toISOString(),
        baseUrl: startUrl,
        finalBaseUrl: results.stats.finalUrl || startUrl,
        totalDiscovered: results.stats.totalUrlsDiscovered,
        totalAfterDeduplication: results.urls.length,
        finalUrlCount: finalUrls.length,
        processingStats: {
          hierarchicalSamplingEnabled: this.enableHierarchicalSampling,
          categoryLimitingEnabled: this.enableCategoryLimiting,
          maxUrlsPerCategory: this.maxUrlsPerCategory,
          maxUrlsTotal: maxUrlsTotal
        },
        crawlStats: results.stats,
        urls: finalUrls.map(url => ({
          url,
          normalizedUrl: url,
          discovered: true
        }))
      };

      const urlsPath = path.join(this.outputDir, 'urls.json');
      const simpleUrlsPath = path.join(this.outputDir, 'urls_simple.json');
      
      await fs.writeJson(urlsPath, fullData, { spaces: 2 });
      await fs.writeJson(simpleUrlsPath, finalUrls, { spaces: 2 });

      console.log(`💾 Saved ${finalUrls.length} URLs to data files`);

      return {
        success: true,
        urls: finalUrls,
        stats: {
          ...results.stats,
          duration,
          finalUrlCount: finalUrls.length,
          totalProcessed: results.stats.totalUrlsDiscovered
        },
        files: {
          urls: urlsPath,
          simpleUrls: simpleUrlsPath
        }
      };

    } catch (error) {
      console.error('❌ URL discovery failed:', error.message);
      return {
        success: false,
        error: error.message,
        urls: [],
        stats: { duration: (Date.now() - startTime) / 1000 }
      };
    }
  }
}

module.exports = { URLDiscoveryService };