// scrape+capture/src/services/url-discovery/index.js
const fs = require('fs-extra');
const path = require('path');
const { URLCrawler } = require('./crawler');
const { limitUrlsPerCategory, hierarchicalSampling, simpleAggressiveFilter } = require('./utils');

class URLDiscoveryService {
  constructor(options = {}) {
    this.maxPages = options.maxPages || 50;
    this.timeout = options.timeout || 8000;
    this.waitTime = options.waitTime || 0.5; // Ensure this is a number
    this.concurrency = options.concurrency || 3;
    this.fastMode = options.fastMode !== undefined ? options.fastMode : true; // Default to true if undefined
    this.excludePatterns = options.excludePatterns || [];
    this.outputDir = options.outputDir || './data'; // This will be overridden by batch_analyzer.js
    this.maxUrlsPerCategory = options.maxUrlsPerCategory || 5;
    this.enableCategoryLimiting = options.enableCategoryLimiting !== undefined ? options.enableCategoryLimiting : true; // Default to true
    
    // Hierarchical sampling options
    this.enableHierarchicalSampling = options.enableHierarchicalSampling !== undefined ? options.enableHierarchicalSampling : true; // Default to true

    this.hierarchicalOptions = {
      maxDepth: options.hierarchicalOptions?.maxDepth || options.maxDepth || 3, // Use specific or general maxDepth
      samplesPerCategory: options.hierarchicalOptions?.samplesPerCategory || options.samplesPerCategory || 2,
      prioritizeOverviews: options.hierarchicalOptions?.prioritizeOverviews !== undefined ? options.hierarchicalOptions.prioritizeOverviews : true,
      skipLegalPages: options.hierarchicalOptions?.skipLegalPages !== undefined ? options.hierarchicalOptions.skipLegalPages : true,
      maxUrlsTotal: options.hierarchicalOptions?.maxUrlsTotal || options.maxUrlsTotal || 10 // Max URLs total
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
        waitTime: parseFloat(this.waitTime) || 0.5, // Ensure waitTime is a number
        concurrency: this.concurrency,
        fastMode: this.fastMode,
        excludePatterns: excludePatterns
      });
      
      const results = await crawler.crawl(startUrl); // results.urls contains deduplicated URLs from crawler
      
      let finalUrls = results.urls;
      const urlsAfterInitialCrawlAndDeduplication = finalUrls.length;
      console.log(`\n🔗 URLs after initial crawl & deduplication: ${urlsAfterInitialCrawlAndDeduplication}`);

      // Apply hierarchical sampling if enabled
      if (this.enableHierarchicalSampling) {
        console.log(`\n🏗️  Applying hierarchical sampling...`);
        finalUrls = hierarchicalSampling(finalUrls, this.hierarchicalOptions);
        console.log(`📊 URLs after hierarchical sampling: ${finalUrls.length}`);
      }
      
      // Apply category limiting if enabled
      if (this.enableCategoryLimiting) {
        const urlsBeforeCategoryLimiting = finalUrls.length;
        console.log(`\n🗂️  Applying category limiting (max ${this.maxUrlsPerCategory} per category)...`);
        finalUrls = limitUrlsPerCategory(finalUrls, this.maxUrlsPerCategory);
        console.log(`📉 URLs after category limiting: ${finalUrls.length} (reduced from ${urlsBeforeCategoryLimiting})`);
      }

      // FINAL HARD LIMIT ENFORCEMENT - Always applied
      const maxUrlsTotal = this.hierarchicalOptions.maxUrlsTotal || 10;
      if (finalUrls.length > maxUrlsTotal) {
        console.log(`\n🚨 Final hard limit enforcement: ${finalUrls.length} > ${maxUrlsTotal} URLs`);
        console.log(`🔥 Applying final aggressive filter to reduce to ${maxUrlsTotal} URLs...`);
        finalUrls = simpleAggressiveFilter(finalUrls, { maxUrlsTotal });
        console.log(`📉 URLs reduced to final count: ${finalUrls.length}`);
      } else {
        console.log(`\n✅ Final URL count (${finalUrls.length}) is within limit (${maxUrlsTotal})`);
      }
      
      const outputData = {
        timestamp: new Date().toISOString(),
        startUrl: startUrl,
        totalFinalUrls: finalUrls.length,
        crawlStats: {
          pagesCrawled: results.stats.pagesCrawled,
          pagesSkipped: results.stats.pagesSkipped,
          errors: results.stats.errors,
          durationSeconds: results.stats.duration,
          totalUrlsDiscoveredByCrawler: results.stats.totalUrlsDiscovered,
          duplicatesSkippedByCrawler: results.stats.duplicatesSkipped,
          duplicatesRemovedByCrawler: results.stats.duplicatesRemoved,
          urlsAfterInitialCrawlAndDeduplication: urlsAfterInitialCrawlAndDeduplication,
          urlsAfterAllFiltering: finalUrls.length,
          hardLimitEnforced: finalUrls.length < urlsAfterInitialCrawlAndDeduplication
        },
        urls: finalUrls,
        excludePatternsUsed: this.excludePatterns.map(p => p.toString()),
        settings: {
          maxPagesSetForCrawl: this.maxPages,
          fastMode: this.fastMode,
          concurrency: this.concurrency,
          timeout: this.timeout,
          waitTime: this.waitTime,
          enableHierarchicalSamplingConfig: this.enableHierarchicalSampling,
          enableCategoryLimitingConfig: this.enableCategoryLimiting,
          maxUrlsPerCategorySet: this.maxUrlsPerCategory,
          hierarchicalOptionsUsed: this.hierarchicalOptions
        }
      };
      
      await fs.ensureDir(this.outputDir); 
      
      const urlsPath = path.join(this.outputDir, 'urls.json');
      const simpleUrlsPath = path.join(this.outputDir, 'urls_simple.json');
      
      await fs.writeJson(urlsPath, outputData, { spaces: 2 });
      await fs.writeJson(simpleUrlsPath, finalUrls, { spaces: 2 });
      
      const overallDurationSeconds = (Date.now() - startTime) / 1000;
      
      console.log('\n🎉 URL Discovery service execution completed successfully');
      if (overallDurationSeconds > 0 && finalUrls.length > 0) {
        console.log(`⚡ Overall processing speed: ${(finalUrls.length / overallDurationSeconds).toFixed(1)} final URLs/second`);
      }
      console.log(`⏱️  Overall duration for this service: ${overallDurationSeconds.toFixed(2)} seconds`);
      console.log(`🔗 Total final URLs selected: ${finalUrls.length}`);
      console.log(`📄 Full discovery data saved to: ${urlsPath}`);
      console.log(`📝 Simple list of final URLs saved to: ${simpleUrlsPath}`);
      
      return {
        success: true,
        urls: finalUrls,
        stats: outputData.crawlStats,
        outputData,
        files: {
          urls: urlsPath,
          simpleUrls: simpleUrlsPath
        }
      };
      
    } catch (error) {
      console.error('❌ URL Discovery service failed:', error);
      return {
        success: false,
        error: error.message,
        urls: [],
        stats: {}
      };
    }
  }
}

module.exports = { URLDiscoveryService };