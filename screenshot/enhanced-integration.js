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
    
    console.log(`📁 Screenshots will be saved to: ${this.screenshotsDir}`);
    if (this.interactiveOptions.enableInteractiveCapture) {
      console.log(`🎯 Interactive capture enabled (max ${this.interactiveOptions.maxScreenshotsPerPage} screenshots per page)`);
    }
  }
  
  async init() {
    if (!this.browser) {
      console.log('🚀 Launching browser...');
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
      console.log('🛑 Closing browser...');
      try {
        await this.browser.close();
        this.browser = null;
        console.log('✅ Browser closed successfully');
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
      console.log(`\n📸 [${index}] Starting enhanced capture: ${url}`);
      
      // Create browser context
      context = await this.browser.newContext({
        viewport: this.viewport,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        reducedMotion: 'reduce',
        colorScheme: 'light'
      });
      
      const page = await context.newPage();
      
      // Navigate to page
      console.log(`  ⏳ Loading page...`);
      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: this.timeout
      });
      
      if (!response || response.status() >= 400) {
        throw new Error(`Failed to load page: HTTP ${response ? response.status() : 'unknown'}`);
      }
      
      // Wait for network idle
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {
        console.log('  ⚠️  Network idle timeout, proceeding anyway');
      });
      
      // Apply page enhancements (cookie removal, etc.)
      console.log(`  ✨ Applying page enhancements...`);
      await this.enhancer.enhance(page);
      await page.waitForTimeout(1000);
      
      let captureResults = [];
      
      if (this.interactiveOptions.enableInteractiveCapture) {
        // ENHANCED INTERACTIVE CAPTURE
        console.log(`  🎯 Starting interactive content discovery and capture...`);
        
        const interactiveCapture = new InteractiveContentCapture(page, {
          maxInteractions: this.interactiveOptions.maxInteractions,
          maxScreenshots: this.interactiveOptions.maxScreenshotsPerPage,
          interactionDelay: this.interactiveOptions.interactionDelay
        });
        
        const screenshots = await interactiveCapture.captureInteractiveContent();
        
        console.log(`  🔍 DEBUG: Received ${screenshots.length} screenshots from InteractiveContentCapture`);
        
        // Save all screenshots from interactive capture
        for (let i = 0; i < screenshots.length; i++) {
          const screenshot = screenshots[i];
          const filename = createEnhancedFilename(url, index, i);
          const filepath = path.join(this.screenshotsDir, filename);
          
          console.log(`  💾 DEBUG: Saving screenshot ${i + 1}/${screenshots.length}:`);
          console.log(`    - Filename: ${filename}`);
          console.log(`    - Filepath: ${filepath}`);
          console.log(`    - Screenshot object keys:`, Object.keys(screenshot));
          console.log(`    - Buffer size:`, screenshot.buffer ? screenshot.buffer.length : 'NO BUFFER');
          
          try {
            if (screenshot.buffer && screenshot.buffer.length > 0) {
              await fs.writeFile(filepath, screenshot.buffer);
              console.log(`    ✅ Successfully saved ${filename} (${screenshot.buffer.length} bytes)`);
            } else {
              console.log(`    ❌ No valid buffer for ${filename}`);
              continue;
            }
          } catch (saveError) {
            console.error(`    ❌ Error saving ${filename}:`, saveError.message);
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
        
        console.log(`  📊 DEBUG: Successfully saved ${captureResults.length} out of ${screenshots.length} screenshots`);
        
        // Generate capture report
        const report = interactiveCapture.getCaptureReport();
        console.log(`  📊 Interactive capture report:`);
        console.log(`     • Total screenshots: ${report.totalScreenshots}`);
        console.log(`     • Successful interactions: ${report.successfulInteractions}/${report.discoveredElements}`);
        console.log(`     • Element types found: ${Object.keys(report.elementTypes).join(', ')}`);
        
        // Save detailed report
        const reportPath = path.join(this.screenshotsDir, `${createFilename(url, index)}_report.json`);
        await fs.writeJson(reportPath, {
          url,
          timestamp: new Date().toISOString(),
          captureReport: report,
          interactionHistory: Array.from(interactiveCapture.interactionHistory.entries()),
          discoveredElements: interactiveCapture.discoveredElements
        }, { spaces: 2 });
        
      } else {
        // STANDARD SINGLE SCREENSHOT
        console.log(`  📷 Taking standard screenshot...`);
        
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
      console.log(`  ✅ Enhanced capture complete in ${duration}ms: ${captureResults.length} screenshots`);
      
      return captureResults;
      
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`  ❌ Error after ${duration}ms: ${error.message}`);
      throw error;
    } finally {
      if (context) {
        try {
          await context.close();
        } catch (closeError) {
          console.error(`  ⚠️  Error closing context: ${closeError.message}`);
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
      console.log('📸 Enhanced Screenshot Service Starting...');
      console.log(`📋 URLs to capture: ${urls.length}`);
      console.log(`📁 Output: ${this.outputDir}`);
      console.log(`📐 Viewport: ${this.viewport.width}x${this.viewport.height}`);
      console.log(`🔀 Concurrency: ${this.concurrent} pages at once`);
      console.log(`🎯 Interactive capture: ${this.enableInteractiveCapture ? 'ENABLED' : 'DISABLED'}`);
      
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
        
        console.log(`\n📦 Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(urls.length/batchSize)} (${currentBatch.length} URLs concurrently)`);
        
        const batchResults = await this.processBatchConcurrent(currentBatch, i, screenshotCapture);
        allResults.push(...batchResults);
        
        const completed = Math.min(i + batchSize, urls.length);
        console.log(`✅ Completed ${completed}/${urls.length} URLs`);
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
        average_screenshots_per_page: successful.length > 0 ? (totalScreenshots / successful.length).toFixed(1) : '0',
        results: allResults,
        configuration: {
          viewport: this.viewport,
          timeout: this.timeout,
          concurrent: this.concurrent,
          enableInteractiveCapture: this.enableInteractiveCapture,
          maxInteractions: this.maxInteractions,
          maxScreenshotsPerPage: this.maxScreenshotsPerPage,
          interactionDelay: this.interactionDelay
        }
      };
      
      const metadataPath = path.join(this.outputDir, 'enhanced_metadata.json');
      await fs.writeJson(metadataPath, metadata, { spaces: 2 });
      
      // Enhanced summary
      console.log('\n🎉 Enhanced screenshot service completed');
      console.log(`📸 Total screenshots: ${totalScreenshots} (avg ${metadata.average_screenshots_per_page} per page)`);
      console.log(`⚡ Processing speed: ${(totalScreenshots / duration).toFixed(1)} screenshots/second`);
      console.log(`⏱️  Total duration: ${duration.toFixed(2)} seconds`);
      console.log(`✅ Successful pages: ${successful.length}/${urls.length}`);
      console.log(`❌ Failed pages: ${failed.length}/${urls.length}`);
      console.log(`📄 Enhanced metadata saved to: ${metadataPath}`);
      
      if (this.enableInteractiveCapture) {
        const interactivePages = successful.filter(r => Array.isArray(r.data) && r.data.length > 1);
        console.log(`🎯 Pages with interactive content: ${interactivePages.length}/${successful.length}`);
      }
      
      return {
        success: failed.length === 0,
        successful: successful,
        failed: failed,
        stats: {
          total: urls.length,
          successful: successful.length,
          failed: failed.length,
          totalScreenshots: totalScreenshots,
          averageScreenshotsPerPage: parseFloat(metadata.average_screenshots_per_page),
          duration: duration,
          interactivePagesFound: this.enableInteractiveCapture ? 
            successful.filter(r => Array.isArray(r.data) && r.data.length > 1).length : 0
        },
        files: {
          metadata: metadataPath,
          screenshotsDir: path.join(this.outputDir, 'desktop')
        }
      };
      
    } catch (error) {
      console.error('❌ Enhanced screenshot service failed:', error);
      return {
        success: false,
        error: error.message,
        successful: [],
        failed: [],
        stats: {}
      };
    } finally {
      if (screenshotCapture) {
        await screenshotCapture.close();
        console.log('🔒 Enhanced screenshot service cleanup completed');
      }
    }
  }

  async processBatchConcurrent(urls, startIndex, screenshotCapture) {
    const promises = urls.map((url, i) => 
      this.captureWithRetry(screenshotCapture, url, startIndex + i)
    );
    
    const results = await Promise.allSettled(promises);
    
    return results.map((result, i) => ({
      url: urls[i],
      success: result.status === 'fulfilled',
      data: result.status === 'fulfilled' ? result.value : null,
      error: result.status === 'rejected' ? result.reason.message : null
    }));
  }

  async captureWithRetry(screenshotCapture, url, index, maxRetries = 2) {
    let lastError = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await screenshotCapture.captureUrl(url, index);
      } catch (error) {
        lastError = error;
        console.log(`  ⚠️  [${index}] Attempt ${attempt}/${maxRetries} failed: ${error.message}`);
        
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
      }
    }
    
    throw lastError;
  }
}

// Enhanced createFilename function for multiple screenshots
function createEnhancedFilename(url, index, screenshotIndex = null) {
  try {
    const urlObj = new URL(url);
    
    // Get domain without www
    let domain = urlObj.hostname.replace(/^www\./, '');
    
    // Get pathname without leading/trailing slashes
    let pathname = urlObj.pathname
      .replace(/^\/+|\/+$/g, '') // Remove leading/trailing slashes
      .replace(/\//g, '_')       // Replace slashes with underscores
      .replace(/[^a-zA-Z0-9_-]/g, '') || 'index'; // Remove special chars
    
    // Truncate if too long
    if (pathname.length > 30) {
      pathname = pathname.substring(0, 30);
    }
    
    // Create base filename
    let filename = `${String(index + 1).padStart(3, '0')}_${domain}_${pathname}`;
    
    // Add screenshot index if multiple screenshots
    if (screenshotIndex !== null) {
      filename += `_${String(screenshotIndex + 1).padStart(2, '0')}`;
    }
    
    filename += '.png';
    
    return filename;
  } catch (error) {
    // Fallback for invalid URLs
    console.warn(`Error parsing URL ${url}:`, error.message);
    const base = `${String(index + 1).padStart(3, '0')}_invalid_url`;
    return screenshotIndex !== null ? `${base}_${String(screenshotIndex + 1).padStart(2, '0')}.png` : `${base}.png`;
  }
}

module.exports = { 
  EnhancedScreenshotService, 
  EnhancedScreenshotCapture,
  InteractiveContentCapture 
};