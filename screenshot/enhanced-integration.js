// Enhanced Screenshot Service Integration
// This integrates the InteractiveContentCapture with your existing screenshot workflow

const { chromium } = require('playwright');
const fs = require('fs-extra');
const path = require('path');
const { InteractiveContentCapture } = require('./interactive-capture');
const { ScreenshotEnhancer } = require('./enhancer');
const { createFilename } = require('./utils');

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
    
    // Interactive capture options
    this.interactiveOptions = {
      maxInteractions: options.maxInteractions || 30,
      maxScreenshotsPerPage: options.maxScreenshotsPerPage || 15,
      interactionDelay: options.interactionDelay || 800,
      enableInteractiveCapture: options.enableInteractiveCapture !== false,
      ...options
    };

    // Create output directory structure
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
        console.error('⚠️ Error closing browser:', error.message);
        this.browser = null;
      }
    }
  }
  
  async captureUrl(url, index) {
    const startTime = Date.now();
    let context = null;
    
    try {
      await this.init();
      console.log(`📸 [${index}] Starting capture: ${url}`);
      
      // Create browser context
      context = await this.browser.newContext({
        viewport: this.viewport,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        reducedMotion: 'reduce',
        colorScheme: 'light'
      });
      
      const page = await context.newPage();
      
      // Navigate to page
      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: this.timeout
      });
      
      if (!response || response.status() >= 400) {
        throw new Error(`Failed to load page: HTTP ${response ? response.status() : 'unknown'}`);
      }
      
      // Wait for network idle
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
      
      // Apply page enhancements (cookie removal, etc.)
      await this.enhancer.enhance(page);
      await page.waitForTimeout(1000);
      
      let captureResults = [];
      
      if (this.interactiveOptions.enableInteractiveCapture) {
        // ENHANCED INTERACTIVE CAPTURE
        const interactiveCapture = new InteractiveContentCapture(page, {
          maxInteractions: this.interactiveOptions.maxInteractions,
          maxScreenshots: this.interactiveOptions.maxScreenshotsPerPage,
          interactionDelay: this.interactiveOptions.interactionDelay
        });
        
        const screenshots = await interactiveCapture.captureInteractiveContent();
        
        // Save all screenshots from interactive capture
        for (let i = 0; i < screenshots.length; i++) {
          const screenshot = screenshots[i];
          const filename = createEnhancedFilename(url, index, i);
          const filepath = path.join(this.screenshotsDir, filename);
          
          try {
            if (screenshot.buffer && screenshot.buffer.length > 0) {
              await fs.writeFile(filepath, screenshot.buffer);
            } else {
              continue;
            }
          } catch (saveError) {
            console.error(`❌ Error saving ${filename}:`, saveError.message);
            continue;
          }
          
          captureResults.push({
            url: url,
            filename: filename,
            path: `desktop/${filename}`,
            timestamp: screenshot.timestamp,
            type: screenshot.filename.includes('baseline') ? 'baseline' : 'interactive',
            screenshotIndex: i,
            totalScreenshots: screenshots.length
          });
        }
        
        // Save detailed report
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
        // STANDARD SINGLE SCREENSHOT
        const filename = createFilename(url, index);
        const filepath = path.join(this.screenshotsDir, filename);
        
        await page.screenshot({
          path: filepath,
          fullPage: true,
          type: 'png'
        });
        
        captureResults.push({
          url: url,
          filename: filename,
          path: `desktop/${filename}`,
          timestamp: new Date().toISOString(),
          type: 'standard',
          screenshotIndex: 0,
          totalScreenshots: 1
        });
      }
      
      const duration = Date.now() - startTime;
      console.log(`✅ Captured ${captureResults.length} screenshots in ${duration}ms`);
      
      return captureResults;
      
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`❌ Error after ${duration}ms: ${error.message}`);
      throw error;
    } finally {
      if (context) {
        try {
          await context.close();
        } catch (closeError) {
          console.error(`⚠️ Error closing context: ${closeError.message}`);
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
    
    // Enhanced interactive capture options
    this.enableInteractiveCapture = options.enableInteractiveCapture !== false;
    this.maxInteractions = options.maxInteractions || 30;
    this.maxScreenshotsPerPage = options.maxScreenshotsPerPage || 15;
    this.interactionDelay = options.interactionDelay || 800;
    this.changeDetectionTimeout = options.changeDetectionTimeout || 2000;
    
    console.log('📸 Enhanced Screenshot Service initialized');
    console.log(`🎯 Interactive capture: ${this.enableInteractiveCapture ? 'ENABLED' : 'DISABLED'}`);
  }
  
  async captureAll(urls) {
    const startTime = Date.now();
    let screenshotCapture = null;
    
    try {
      console.log(`📸 Starting capture of ${urls.length} URLs`);
      
      if (this.enableInteractiveCapture) {
        console.log(`📊 Max screenshots per page: ${this.maxScreenshotsPerPage}`);
        console.log(`⚡ Max interactions per page: ${this.maxInteractions}`);
      }
      
      // Create enhanced screenshot capture instance
      screenshotCapture = new EnhancedScreenshotCapture(this.outputDir, {
        width: this.viewport.width,
        height: this.viewport.height,
        timeout: this.timeout,
        enableInteractiveCapture: this.enableInteractiveCapture,
        maxInteractions: this.maxInteractions,
        maxScreenshotsPerPage: this.maxScreenshotsPerPage,
        interactionDelay: this.interactionDelay
      });
      
      // Process URLs in batches for concurrency
      const allResults = [];
      const batchSize = this.concurrent;
      
      for (let i = 0; i < urls.length; i += batchSize) {
        const currentBatch = urls.slice(i, i + batchSize);
        const batchResults = await this.processBatchConcurrent(currentBatch, i, screenshotCapture);
        allResults.push(...batchResults);
      }
      
      // Calculate statistics
      const successful = allResults.filter(r => r.success);
      const failed = allResults.filter(r => !r.success);
      const duration = (Date.now() - startTime) / 1000;
      
      // Calculate total screenshots
      const totalScreenshots = successful.reduce((total, result) => {
        return total + (Array.isArray(result.data) ? result.data.length : 1);
      }, 0);
      
      // Enhanced metadata with interactive capture stats
      const metadata = {
        timestamp: new Date().toISOString(),
        duration_seconds: duration,
        total_urls: urls.length,
        successful_captures: successful.length,
        failed_captures: failed.length,
        total_screenshots: totalScreenshots,
        interactive_capture_enabled: this.enableInteractiveCapture,
        average_screenshots_per_page: successful.length > 0 ? 
          (totalScreenshots / successful.length).toFixed(1) : '0.0',
        interactive_pages_found: successful.filter(r => 
          Array.isArray(r.data) && r.data.length > 1
        ).length
      };
      
      // Save enhanced metadata
      const metadataPath = path.join(this.outputDir, 'enhanced_metadata.json');
      await fs.writeJson(metadataPath, metadata, { spaces: 2 });
      
      console.log(`🎉 Enhanced screenshot service completed`);
      console.log(`📸 Total screenshots: ${totalScreenshots} (avg ${metadata.average_screenshots_per_page} per page)`);
      console.log(`⚡ Processing speed: ${(totalScreenshots/duration).toFixed(1)} screenshots/second`);
      console.log(`⏱️  Total duration: ${duration.toFixed(2)} seconds`);
      console.log(`✅ Successful pages: ${successful.length}/${urls.length}`);
      console.log(`❌ Failed pages: ${failed.length}/${urls.length}`);
      console.log(`🎯 Pages with interactive content: ${metadata.interactive_pages_found}/${successful.length}`);
      
      return {
        success: successful.length > 0,
        successful: successful.map(r => r.data).flat(),
        failed: failed.map(r => ({ url: r.url, error: r.error })),
        stats: {
          totalScreenshots,
          averageScreenshotsPerPage: metadata.average_screenshots_per_page,
          interactivePagesFound: metadata.interactive_pages_found,
          duration,
          processingSpeed: (totalScreenshots/duration).toFixed(1)
        },
        files: {
          metadata: metadataPath
        }
      };
      
    } catch (error) {
      console.error('💥 Enhanced screenshot service failed:', error);
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
        if (result.status === 'fulfilled') {
          return { success: true, url: urls[index], data: result.value };
        } else {
          return { success: false, url: urls[index], error: result.reason.message };
        }
      })
    );
  }
  
  async processSingleUrl(url, index, screenshotCapture) {
    try {
      const results = await screenshotCapture.captureUrl(url, index);
      return results;
    } catch (error) {
      console.error(`❌ Failed to capture ${url}: ${error.message}`);
      throw error;
    }
  }
}

// Helper function to create enhanced filenames
function createEnhancedFilename(url, urlIndex, screenshotIndex) {
  const urlPart = new URL(url).hostname.replace(/[^a-zA-Z0-9]/g, '');
  const paddedUrlIndex = String(urlIndex + 1).padStart(3, '0');
  const paddedScreenshotIndex = String(screenshotIndex + 1).padStart(2, '0');
  return `${paddedUrlIndex}_${urlPart}_index_${paddedScreenshotIndex}.png`;
}

module.exports = {
  EnhancedScreenshotService,
  EnhancedScreenshotCapture
};