// Enhanced screenshot/index.js
const fs = require('fs-extra');
const path = require('path');
const { EnhancedScreenshotCapture } = require('./enhanced-capture'); // New enhanced capture

class EnhancedScreenshotService {
  constructor(options = {}) {
    this.outputDir = options.outputDir || './data/screenshots';
    this.viewport = {
      width: options.viewport?.width || 1440,
      height: options.viewport?.height || 900
    };
    this.timeout = options.timeout || 30000;
    this.concurrent = options.concurrent || 4;
    
    // New interactive options
    this.captureInteractive = options.captureInteractive !== false; // Default true
    this.maxScreenshotsPerPage = options.maxScreenshotsPerPage || 5;
    this.interactionDelay = options.interactionDelay || 1000;
  }

  async captureAll(urls) {
    console.log('📸 Enhanced Screenshot Service Starting...');
    console.log(`📋 URLs to capture: ${urls.length}`);
    console.log(`📁 Output: ${this.outputDir}`);
    console.log(`📐 Viewport: ${this.viewport.width}x${this.viewport.height}`);
    console.log(`🔀 Concurrency: ${this.concurrent} screenshots at once`);
    console.log(`🎯 Interactive capture: ${this.captureInteractive ? 'ENABLED' : 'disabled'}`);
    if (this.captureInteractive) {
      console.log(`📊 Max screenshots per page: ${this.maxScreenshotsPerPage}`);
    }
    
    const startTime = Date.now();
    let screenshotCapture = null;
    
    try {
      const screenshotsDir = path.join(this.outputDir, 'screenshots');
      await fs.ensureDir(screenshotsDir);
      
      screenshotCapture = new EnhancedScreenshotCapture(screenshotsDir, {
        width: this.viewport.width,
        height: this.viewport.height,
        timeout: this.timeout,
        captureInteractive: this.captureInteractive,
        maxScreenshotsPerPage: this.maxScreenshotsPerPage,
        interactionDelay: this.interactionDelay
      });
      
      // Process URLs in batches for concurrency
      const allResults = [];
      const batchSize = this.concurrent;
      
      for (let i = 0; i < urls.length; i += batchSize) {
        const batchNum = Math.floor(i/batchSize) + 1;
        const totalBatches = Math.ceil(urls.length/batchSize);
        const currentBatch = urls.slice(i, i + batchSize);
        
        console.log(`\n📦 Processing batch ${batchNum}/${totalBatches} (${currentBatch.length} URLs concurrently)`);
        
        const batchStartTime = Date.now();
        const batchResults = await this.processBatchConcurrent(currentBatch, i, screenshotCapture);
        const batchDuration = (Date.now() - batchStartTime) / 1000;
        
        allResults.push(...batchResults);
        
        const completed = Math.min(i + batchSize, urls.length);
        console.log(`  ⚡ Batch completed in ${batchDuration.toFixed(2)}s`);
        console.log(`✅ Completed ${completed}/${urls.length} URLs`);
      }
      
      // Calculate statistics
      const successful = allResults.filter(r => r.success);
      const failed = allResults.filter(r => !r.success);
      const duration = (Date.now() - startTime) / 1000;
      
      // Count total screenshots
      const totalScreenshots = successful.reduce((total, result) => {
        return total + (Array.isArray(result.data) ? result.data.length : 1);
      }, 0);
      
      // Enhanced metadata
      const metadata = {
        timestamp: new Date().toISOString(),
        duration_seconds: duration,
        total_urls: urls.length,
        successful_captures: successful.length,
        failed_captures: failed.length,
        total_screenshots: totalScreenshots,
        interactive_capture_enabled: this.captureInteractive,
        results: allResults,
        configuration: {
          viewport: this.viewport,
          timeout: this.timeout,
          concurrent: this.concurrent,
          captureInteractive: this.captureInteractive,
          maxScreenshotsPerPage: this.maxScreenshotsPerPage,
          interactionDelay: this.interactionDelay
        }
      };
      
      const metadataPath = path.join(screenshotsDir, 'metadata.json');
      await fs.writeJson(metadataPath, metadata, { spaces: 2 });
      
      // Summary
      console.log('\n🎉 Enhanced screenshot service completed');
      console.log(`📸 Total screenshots: ${totalScreenshots} (avg ${(totalScreenshots / successful.length).toFixed(1)} per page)`);
      console.log(`⚡ Speed: ${(totalScreenshots / duration).toFixed(1)} screenshots/second`);
      console.log(`⏱️  Duration: ${duration.toFixed(2)} seconds`);
      console.log(`✅ Successful pages: ${successful.length}/${urls.length}`);
      console.log(`❌ Failed pages: ${failed.length}/${urls.length}`);
      console.log(`📄 Metadata saved to: ${metadataPath}`);
      
      return {
        success: failed.length === 0,
        successful: successful,
        failed: failed,
        stats: {
          total: urls.length,
          successful: successful.length,
          failed: failed.length,
          totalScreenshots: totalScreenshots,
          duration: duration
        },
        files: {
          metadata: metadataPath,
          screenshotsDir: path.join(screenshotsDir, 'desktop')
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
        try {
          await screenshotCapture.close();
          console.log('🔒 Enhanced screenshot service cleanup completed');
        } catch (error) {
          console.error('❌ Error during screenshot service cleanup:', error);
        }
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

module.exports = { EnhancedScreenshotService };