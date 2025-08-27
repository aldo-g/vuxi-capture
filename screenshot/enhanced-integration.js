const { chromium } = require('playwright');
const fs = require('fs-extra');
const path = require('path');
const { InteractiveContentCapture } = require('./interactive-capture');
const { ScreenshotEnhancer } = require('./enhancer');
const { createFilename } = require('./utils');
const { ImageDeduplicationService } = require('./image-deduplication');

class EnhancedScreenshotCapture {
  constructor(outputDir, options = {}) {
    this.outputDir = outputDir;
    this.viewport = {
      width: options.width || 1440,
      height: options.height || 900
    };
    this.timeout = options.timeout || 45000;
    this.browser = null;
    this.enhancer = new ScreenshotEnhancer();
    
    this.interactiveOptions = {
      maxInteractions: options.maxInteractions || 30,
      maxScreenshotsPerPage: options.maxScreenshotsPerPage || 15,
      interactionDelay: options.interactionDelay || 800,
      enableInteractiveCapture: options.enableInteractiveCapture !== false,
      changeDetectionTimeout: options.changeDetectionTimeout || 2000,
      maxInteractionsPerType: options.maxInteractionsPerType || 3, // Added this line!
      ...options
    };

    this.screenshotsDir = path.join(outputDir, 'desktop');
    fs.ensureDirSync(this.screenshotsDir);
  }
  
  async init() {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--memory-pressure-off',
          '--max_old_space_size=4096'
        ]
      });
    }
  }
  
  async close() {
    if (this.browser) {
      try {
        await this.browser.close();
        this.browser = null;
      } catch (error) {
        this.browser = null;
      }
    }
  }
  
  async captureUrl(url, index) {
    const startTime = Date.now();
    let context = null;
    
    try {
      await this.init();
      
      context = await this.browser.newContext({
        viewport: this.viewport,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        reducedMotion: 'reduce',
        colorScheme: 'light'
      });
      
      const page = await context.newPage();
      
      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: this.timeout
      });
      
      if (!response || response.status() >= 400) {
        throw new Error(`Failed to load page: HTTP ${response ? response.status() : 'unknown'}`);
      }
      
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
      await this.enhancer.enhance(page);
      await page.waitForTimeout(1000);
      
      let captureResults = [];
      
      if (this.interactiveOptions.enableInteractiveCapture) {
        const interactiveCapture = new InteractiveContentCapture(page, {
          maxInteractions: this.interactiveOptions.maxInteractions,
          maxScreenshots: this.interactiveOptions.maxScreenshotsPerPage,
          interactionDelay: this.interactiveOptions.interactionDelay,
          changeDetectionTimeout: this.interactiveOptions.changeDetectionTimeout,
          maxInteractionsPerType: this.interactiveOptions.maxInteractionsPerType // Added this line!
        });
        
        const interactiveResult = await interactiveCapture.captureInteractiveContent();
        const screenshots = interactiveResult.screenshots;
        
        for (let i = 0; i < screenshots.length; i++) {
          const screenshot = screenshots[i];
          const type = screenshot.filename.replace('.png', '');
          const filename = createEnhancedFilename(url, index, i, type);
          const filepath = path.join(this.screenshotsDir, filename);
          
          try {
            if (screenshot.buffer && screenshot.buffer.length > 0) {
              await fs.writeFile(filepath, screenshot.buffer);
            } else {
              continue;
            }
          } catch (saveError) {
             console.error(`   - Error saving screenshot ${filename}: ${saveError.message}`);
            continue;
          }
          
          captureResults.push({
            url: url,
            filename: filename,
            path: `desktop/${filename}`,
            filepath: filepath,
            timestamp: screenshot.timestamp,
            type: screenshot.filename.includes('baseline') ? 'baseline' : 'interactive',
            screenshotIndex: i,
            totalScreenshots: screenshots.length,
            buffer: screenshot.buffer
          });
        }
        
        const reportPath = path.join(this.screenshotsDir, `${createFilename(url, index)}_report.json`);
        const report = interactiveCapture.getCaptureReport();
        await fs.writeJson(reportPath, {
          url,
          timestamp: new Date().toISOString(),
          captureReport: report,
          interactionHistory: Array.from(interactiveCapture.interactionHistory.entries()),
          discoveredElements: interactiveCapture.discoveredElements
        }, { spaces: 2 });
        
      } else {
        const filename = createFilename(url, index);
        const filepath = path.join(this.screenshotsDir, filename);
        
        const buffer = await page.screenshot({
          path: filepath,
          fullPage: true,
          type: 'png'
        });
        
        captureResults.push({
          url: url,
          filename: filename,
          path: `desktop/${filename}`,
          filepath: filepath,
          timestamp: new Date().toISOString(),
          type: 'standard',
          screenshotIndex: 0,
          totalScreenshots: 1,
          buffer: buffer
        });
      }
      
      const duration = Date.now() - startTime;
      console.log(`📸 [${index}] ${url} - ${captureResults.length} screenshots (${duration}ms)`);
      
      return captureResults;
      
    } catch (error) {
      console.error(`❌ [${index}] ${url} - ${error.message}`);
      throw error;
    } finally {
      if (context) {
        try {
          await context.close();
        } catch (closeError) {
          // Silent fail
        }
      }
    }
  }
}

class EnhancedScreenshotService {
  constructor(options = {}) {
    this.outputDir = options.outputDir || './data/screenshots';
    this.viewport = options.viewport || { width: 1440, height: 900 };
    this.timeout = options.timeout || 45000;
    this.concurrent = options.concurrent || 4;
    
    this.enableInteractiveCapture = options.enableInteractiveCapture !== false;
    this.maxInteractions = options.maxInteractions || 30;
    this.maxScreenshotsPerPage = options.maxScreenshotsPerPage || 15;
    this.interactionDelay = options.interactionDelay || 800;
    this.changeDetectionTimeout = options.changeDetectionTimeout || 2000;
    this.maxInteractionsPerType = options.maxInteractionsPerType || 3; // Added this line!
    
    console.log(`📸 Enhanced Screenshot Service - Interactive: ${this.enableInteractiveCapture ? 'ENABLED' : 'DISABLED'}`);
  }
  
  async captureAll(urls) {
    const startTime = Date.now();
    let screenshotCapture = null;
    
    try {
      console.log(`📸 Starting capture of ${urls.length} URLs`);
      
      screenshotCapture = new EnhancedScreenshotCapture(this.outputDir, {
        width: this.viewport.width,
        height: this.viewport.height,
        timeout: this.timeout,
        enableInteractiveCapture: this.enableInteractiveCapture,
        maxInteractions: this.maxInteractions,
        maxScreenshotsPerPage: this.maxScreenshotsPerPage,
        interactionDelay: this.interactionDelay,
        changeDetectionTimeout: this.changeDetectionTimeout,
        maxInteractionsPerType: this.maxInteractionsPerType // Added this line!
      });
      
      const allResults = [];
      const batchSize = this.concurrent;
      
      for (let i = 0; i < urls.length; i += batchSize) {
        const currentBatch = urls.slice(i, i + batchSize);
        const batchResults = await this.processBatchConcurrent(currentBatch, i, screenshotCapture);
        allResults.push(...batchResults);
      }
      
      const successfulCaptures = allResults.filter(r => r.success).map(r => r.data).flat();
      const failedCaptures = allResults.filter(r => !r.success);
      
      // --- GLOBAL DEDUPLICATION ---
      console.log(`\n🔍 Starting global deduplication of ${successfulCaptures.length} total screenshots...`);
      const dedupService = new ImageDeduplicationService({
          similarityThreshold: 98,
          preserveFirst: true,
          verbose: true
      });
      const uniqueScreenshots = await dedupService.processScreenshots(successfulCaptures);
      console.log(`✅ Global deduplication complete. Kept ${uniqueScreenshots.length} unique screenshots.`);

      const uniqueFilenames = new Set(uniqueScreenshots.map(s => s.filename));
      const duplicateScreenshots = successfulCaptures.filter(s => !uniqueFilenames.has(s.filename));

      if (duplicateScreenshots.length > 0) {
          console.log(`🗑️  Removing ${duplicateScreenshots.length} duplicate screenshot files...`);
          for (const duplicate of duplicateScreenshots) {
              try {
                  await fs.remove(duplicate.filepath);
                  console.log(`   - Removed: ${duplicate.filename}`);
              } catch (e) {
                  console.error(`   - Error removing ${duplicate.filename}: ${e.message}`);
              }
          }
      }
      // --- END GLOBAL DEDUPLICATION ---

      const duration = (Date.now() - startTime) / 1000;
      const totalScreenshots = uniqueScreenshots.length;
      
      // Remove buffer before writing metadata
      const finalSuccessful = uniqueScreenshots.map(({ buffer, filepath, ...rest }) => rest);

      const metadata = {
        timestamp: new Date().toISOString(),
        duration_seconds: duration,
        total_urls: urls.length,
        successful_captures: finalSuccessful.length,
        failed_captures: failedCaptures.length,
        total_screenshots: totalScreenshots,
        interactive_capture_enabled: this.enableInteractiveCapture,
        average_screenshots_per_page: finalSuccessful.length > 0 ? 
          (totalScreenshots / finalSuccessful.length).toFixed(1) : '0.0',
        interactive_pages_found: finalSuccessful.filter(r => r.totalScreenshots > 1).length
      };
      
      const metadataPath = path.join(this.outputDir, 'enhanced_metadata.json');
      await fs.writeJson(metadataPath, metadata, { spaces: 2 });
      
      console.log(`✅ Captured ${totalScreenshots} screenshots from ${finalSuccessful.length}/${urls.length} pages (${duration.toFixed(1)}s)`);
      
      return {
        success: finalSuccessful.length > 0,
        successful: finalSuccessful,
        failed: failedCaptures.map(r => ({ url: r.url, error: r.error })),
        stats: {
          totalScreenshots,
          averageScreenshotsPerPage: metadata.average_screenshots_per_page,
          interactivePagesFound: metadata.interactive_pages_found,
          duration,
          processingSpeed: (totalScreenshots/duration).toFixed(1)
        },
        files: {
          metadata: metadataPath,
          screenshotsDir: path.join(this.outputDir, 'desktop')
        }
      };
      
    } catch (error) {
      console.error('❌ Enhanced screenshot service failed:', error.message);
      throw error;
    } finally {
      if (screenshotCapture) {
        await screenshotCapture.close();
      }
    }
  }
  
  async processBatchConcurrent(urls, startIndex, screenshotCapture) {
    const batchPromises = urls.map((url, batchIndex) => {
      const globalIndex = startIndex + batchIndex;
      return this.processSingleUrl(url, globalIndex, screenshotCapture);
    });
    
    return await Promise.allSettled(batchPromises).then(results => 
      results.map((result, index) => {
        const url = urls[index];
        if (result.status === 'fulfilled') {
          return { success: true, url, data: result.value };
        } else {
          return { success: false, url, error: result.reason.message };
        }
      })
    );
  }
  
  async processSingleUrl(url, index, screenshotCapture) {
    try {
      return await screenshotCapture.captureUrl(url, index + 1);
    } catch (error) {
      throw new Error(`Failed to capture ${url}: ${error.message}`);
    }
  }
}

function createEnhancedFilename(url, index, screenshotIndex, type = 'interactive') {
    const baseFilename = createFilename(url, index);
    const nameWithoutExt = baseFilename.replace('.png', '');
    const safeType = type.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 20);
    return `${nameWithoutExt}_${screenshotIndex.toString().padStart(2, '0')}_${safeType}.png`;
}

module.exports = { EnhancedScreenshotService, EnhancedScreenshotCapture };