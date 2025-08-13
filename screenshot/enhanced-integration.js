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
    
    this.interactiveOptions = {
      maxInteractions: options.maxInteractions || 30,
      maxScreenshotsPerPage: options.maxScreenshotsPerPage || 15,
      interactionDelay: options.interactionDelay || 800,
      enableInteractiveCapture: options.enableInteractiveCapture !== false,
      ...options
    };

    this.screenshotsDir = path.join(outputDir, 'desktop');
    fs.ensureDirSync(this.screenshotsDir);
  }
  
  async init() {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: false,
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
          interactionDelay: this.interactiveOptions.interactionDelay
        });
        
        const screenshots = await interactiveCapture.captureInteractiveContent();
        
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
        interactionDelay: this.interactionDelay
      });
      
      const allResults = [];
      const batchSize = this.concurrent;
      
      for (let i = 0; i < urls.length; i += batchSize) {
        const currentBatch = urls.slice(i, i + batchSize);
        const batchResults = await this.processBatchConcurrent(currentBatch, i, screenshotCapture);
        allResults.push(...batchResults);
      }
      
      const successful = allResults.filter(r => r.success);
      const failed = allResults.filter(r => !r.success);
      const duration = (Date.now() - startTime) / 1000;
      
      const totalScreenshots = successful.reduce((total, result) => {
        return total + (Array.isArray(result.data) ? result.data.length : 1);
      }, 0);
      
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
      
      const metadataPath = path.join(this.outputDir, 'enhanced_metadata.json');
      await fs.writeJson(metadataPath, metadata, { spaces: 2 });
      
      console.log(`✅ Captured ${totalScreenshots} screenshots from ${successful.length}/${urls.length} pages (${duration.toFixed(1)}s)`);
      
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

function createEnhancedFilename(url, index, screenshotIndex) {
  const baseFilename = createFilename(url, index);
  const nameWithoutExt = baseFilename.replace('.png', '');
  return `${nameWithoutExt}_${screenshotIndex.toString().padStart(2, '0')}.png`;
}

module.exports = { EnhancedScreenshotService, EnhancedScreenshotCapture };