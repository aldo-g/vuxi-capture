const path = require('path');
const fs = require('fs-extra');
const { URLCrawler } = require('./crawler');
const { 
  hierarchicalSampling, 
  limitUrlsPerCategory, 
  simpleAggressiveFilter,
  applyUrlDiversityFilters 
} = require('./utils');

class URLDiscoveryService {
  constructor(options = {}) {
    this.maxPages = options.maxPages || 20;
    this.timeout = options.timeout || 8000;
    this.waitTime = options.waitTime || 0.5;
    this.concurrency = options.concurrency || 3;
    this.fastMode = options.fastMode !== false;
    this.outputDir = options.outputDir || './data';
    this.excludePatterns = options.excludePatterns || [];
    
    // Enhanced diversity options
    this.enableDiversityFilters = options.enableDiversityFilters !== false;
    this.maxPerCategory = options.maxPerCategory || 2;
    this.similarityThreshold = options.similarityThreshold || 0.7;
    this.prioritizeHigherLevels = options.prioritizeHigherLevels !== false;
    
    // Legacy options for backward compatibility
    this.enableHierarchicalSampling = options.enableHierarchicalSampling || false;
    this.enableCategoryLimiting = options.enableCategoryLimiting || false;
    this.maxUrlsPerCategory = options.maxUrlsPerCategory || 5;
    this.maxUrlsTotal = options.maxUrlsTotal || 50;
  }
  
  async discover(startUrl) {
    const startTime = Date.now();
    console.log(`🔍 Starting URL discovery for: ${startUrl}`);
    
    try {
      // Initialize crawler with all options including diversity filters
      const crawler = new URLCrawler({
        maxPages: this.maxPages,
        timeout: this.timeout,
        waitTime: this.waitTime,
        concurrency: this.concurrency,
        fastMode: this.fastMode,
        excludePatterns: this.excludePatterns,
        
        // Pass diversity options to crawler
        enableDiversityFilters: this.enableDiversityFilters,
        maxPerCategory: this.maxPerCategory,
        similarityThreshold: this.similarityThreshold,
        prioritizeHigherLevels: this.prioritizeHigherLevels,
        diversityOptions: {
          maxPerCategory: this.maxPerCategory,
          similarityThreshold: this.similarityThreshold,
          prioritizeHigherLevels: this.prioritizeHigherLevels
        }
      });
      
      // Crawl and get diverse URLs
      const results = await crawler.crawl(startUrl);
      
      if (!results.success && results.urls.length === 0) {
        throw new Error('No URLs were discovered during crawling');
      }
      
      let finalUrls = results.urls;
      
      // Legacy processing for backward compatibility (if diversity filters disabled)
      if (!this.enableDiversityFilters) {
        console.log(`📊 Applying legacy filters to ${finalUrls.length} URLs...`);
        
        // Apply hierarchical sampling if enabled
        if (this.enableHierarchicalSampling) {
          console.log(`🔄 Applying hierarchical sampling (max ${this.maxUrlsTotal})...`);
          finalUrls = hierarchicalSampling(finalUrls, this.maxUrlsTotal);
          console.log(`   After hierarchical sampling: ${finalUrls.length} URLs`);
        }
        
        // Apply category limiting if enabled
        if (this.enableCategoryLimiting) {
          console.log(`🔄 Applying category limiting (max ${this.maxUrlsPerCategory} per category)...`);
          finalUrls = limitUrlsPerCategory(finalUrls, this.maxUrlsPerCategory);
          console.log(`   After category limiting: ${finalUrls.length} URLs`);
        }
        
        // Apply total URL limit
        if (finalUrls.length > this.maxUrlsTotal) {
          console.log(`🔄 Applying total limit (max ${this.maxUrlsTotal})...`);
          finalUrls = finalUrls.slice(0, this.maxUrlsTotal);
        }
        
        // Apply final aggressive filter
        finalUrls = simpleAggressiveFilter(finalUrls);
      }
      
      const duration = (Date.now() - startTime) / 1000;
      
      // Ensure output directory exists
      await fs.ensureDir(this.outputDir);
      
      // Create comprehensive data structure
      const fullData = {
        discoveredAt: new Date().toISOString(),
        baseUrl: startUrl,
        finalBaseUrl: results.stats.finalUrl || startUrl,
        totalDiscovered: results.stats.totalUrlsDiscovered || finalUrls.length,
        totalAfterDeduplication: results.stats.urlsBeforeDiversityFilter || finalUrls.length,
        finalUrlCount: finalUrls.length,
        processingStats: {
          diversityFilteringEnabled: this.enableDiversityFilters,
          maxPerCategory: this.maxPerCategory,
          similarityThreshold: this.similarityThreshold,
          urlsRemovedByDiversityFilter: results.stats.urlsRemovedByDiversityFilter || 0,
          
          // Legacy stats for backward compatibility
          hierarchicalSamplingEnabled: this.enableHierarchicalSampling,
          categoryLimitingEnabled: this.enableCategoryLimiting,
          maxUrlsPerCategory: this.maxUrlsPerCategory,
          maxUrlsTotal: this.maxUrlsTotal
        },
        crawlStats: results.stats,
        urls: finalUrls.map(url => ({
          url,
          normalizedUrl: url,
          discovered: true
        }))
      };

      // Save files
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
          totalProcessed: results.stats.totalUrlsDiscovered || finalUrls.length,
          diversityFilteringEnabled: this.enableDiversityFilters,
          urlsRemovedByDiversityFilter: results.stats.urlsRemovedByDiversityFilter || 0
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
        stats: { 
          duration: (Date.now() - startTime) / 1000,
          diversityFilteringEnabled: this.enableDiversityFilters
        }
      };
    }
  }
}

module.exports = { URLDiscoveryService };