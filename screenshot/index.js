// Updated screenshot/index.js - Enhanced Screenshot Service Integration
const fs = require('fs-extra');
const path = require('path');

// Import the enhanced screenshot service
const { EnhancedScreenshotService } = require('./enhanced-integration');

// Keep the legacy ScreenshotCapture class as fallback (if needed)
const { ScreenshotCapture } = require('./capture');

/**
 * Enhanced Screenshot Service - Drop-in replacement for the original ScreenshotService
 * Provides backwards compatibility while adding advanced interactive capture capabilities
 */
class ScreenshotService {
  constructor(options = {}) {
    console.log('📸 Initializing Enhanced Screenshot Service...');
    
    // Determine if we should use enhanced features
    const useEnhancedCapture = options.enableInteractiveCapture !== false;
    
    if (useEnhancedCapture) {
      console.log('🎯 Enhanced interactive capture mode enabled');
      // Return the enhanced service with all new features
      return new EnhancedScreenshotService({
        outputDir: options.outputDir || './data/screenshots',
        viewport: options.viewport || { width: 1440, height: 900 },
        timeout: options.timeout || 30000,
        concurrent: options.concurrent || 4,
        
        // Enhanced interactive options
        enableInteractiveCapture: true,
        maxInteractions: options.maxInteractions || 30,
        maxScreenshotsPerPage: options.maxScreenshotsPerPage || 15,
        interactionDelay: options.interactionDelay || 800,
        changeDetectionTimeout: options.changeDetectionTimeout || 2000,
        
        // Advanced options
        enableHoverCapture: options.enableHoverCapture || false,
        prioritizeNavigation: options.prioritizeNavigation !== false,
        skipSocialElements: options.skipSocialElements !== false,
        maxProcessingTime: options.maxProcessingTime || 120000
      });
    } else {
      console.log('📷 Standard screenshot mode (legacy compatibility)');
      // Use legacy service for backwards compatibility
      this.outputDir = options.outputDir || './data/screenshots';
      this.viewport = {
        width: options.viewport?.width || 1440,
        height: options.viewport?.height || 900
      };
      this.timeout = options.timeout || 30000;
      this.concurrent = options.concurrent || 4;
      this.useLegacyMode = true;
    }
  }

  /**
   * Legacy compatibility method - automatically delegates to enhanced service
   * unless specifically disabled
   */
  async captureAll(urls) {
    if (this.useLegacyMode) {
      console.log('📷 Using legacy screenshot capture mode...');
      return this.legacyCaptureAll(urls);
    }
    
    // This should never be reached since we return the EnhancedService instance
    // But keeping for safety
    console.log('⚠️  Warning: Legacy mode fallback triggered');
    return this.legacyCaptureAll(urls);
  }

  /**
   * Legacy capture implementation (fallback)
   */
  async legacyCaptureAll(urls) {
    console.log('📸 Legacy Screenshot Service Starting...');
    console.log(`📋 URLs to capture: ${urls.length}`);
    console.log(`📁 Output: ${this.outputDir}`);
    
    const startTime = Date.now();
    let screenshotCapture = null;
    
    try {
      const screenshotsDir = path.join(this.outputDir, 'screenshots');
      await fs.ensureDir(screenshotsDir);
      
      screenshotCapture = new ScreenshotCapture(screenshotsDir, {
        width: this.viewport.width,
        height: this.viewport.height,
        timeout: this.timeout
      });
      
      // Process URLs in batches for concurrency
      const allResults = [];
      const batchSize = this.concurrent;
      
      for (let i = 0; i < urls.length; i += batchSize) {
        const currentBatch = urls.slice(i, i + batchSize);
        
        console.log(`\n📦 Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(urls.length/batchSize)} (${currentBatch.length} URLs)`);
        
        const batchResults = await this.processBatchConcurrent(currentBatch, i, screenshotCapture);
        allResults.push(...batchResults);
        
        const completed = Math.min(i + batchSize, urls.length);
        console.log(`✅ Completed ${completed}/${urls.length} URLs`);
      }
      
      // Calculate statistics
      const successful = allResults.filter(r => r.success);
      const failed = allResults.filter(r => !r.success);
      const duration = (Date.now() - startTime) / 1000;
      
      const metadata = {
        timestamp: new Date().toISOString(),
        duration_seconds: duration,
        total_urls: urls.length,
        successful_captures: successful.length,
        failed_captures: failed.length,
        total_screenshots: successful.length, // 1 per successful URL in legacy mode
        interactive_capture_enabled: false,
        results: allResults,
        configuration: {
          viewport: this.viewport,
          timeout: this.timeout,
          concurrent: this.concurrent,
          mode: 'legacy'
        }
      };
      
      const metadataPath = path.join(screenshotsDir, 'metadata.json');
      await fs.writeJson(metadataPath, metadata, { spaces: 2 });
      
      console.log('\n📸 Legacy screenshot service completed');
      console.log(`⏱️  Duration: ${duration.toFixed(2)} seconds`);
      console.log(`✅ Successful: ${successful.length}/${urls.length}`);
      
      return {
        success: failed.length === 0,
        successful: successful,
        failed: failed,
        stats: {
          total: urls.length,
          successful: successful.length,
          failed: failed.length,
          totalScreenshots: successful.length,
          duration: duration
        },
        files: {
          metadata: metadataPath,
          screenshotsDir: path.join(screenshotsDir, 'desktop')
        }
      };
      
    } catch (error) {
      console.error('❌ Legacy screenshot service failed:', error);
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

/**
 * Factory function to create the appropriate screenshot service
 * This provides a clean API for different use cases
 */
function createScreenshotService(options = {}) {
  return new ScreenshotService(options);
}

/**
 * Enhanced Screenshot Service - Direct access to enhanced features
 * Use this when you specifically want the enhanced interactive capture
 */
function createEnhancedScreenshotService(options = {}) {
  return new EnhancedScreenshotService({
    enableInteractiveCapture: true,
    maxInteractions: 30,
    maxScreenshotsPerPage: 15,
    interactionDelay: 800,
    ...options
  });
}

/**
 * Legacy Screenshot Service - Direct access to legacy features
 * Use this when you specifically want the old behavior
 */
function createLegacyScreenshotService(options = {}) {
  return new ScreenshotService({
    enableInteractiveCapture: false,
    ...options
  });
}

// Export the main service class and factory functions
module.exports = { 
  ScreenshotService,
  EnhancedScreenshotService,
  createScreenshotService,
  createEnhancedScreenshotService,
  createLegacyScreenshotService
};

// Export legacy classes for backwards compatibility
module.exports.ScreenshotCapture = ScreenshotCapture;