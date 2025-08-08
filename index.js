const { URLDiscoveryService } = require('./url-discovery');
const { ScreenshotService } = require('./screenshot');

async function capture(baseUrl, options = {}) {
  console.log(`🚀 Starting capture for: ${baseUrl}`);
  
  // Initialize URL discovery service
  const urlService = new URLDiscoveryService({
    maxPages: options.maxPages || 20,
    timeout: options.timeout || 8000,
    concurrency: options.concurrency || 3,
    fastMode: options.fastMode !== false,
    outputDir: options.outputDir || './data'
  });
  
  // Discover URLs
  console.log('🔍 Discovering URLs...');
  const urlResult = await urlService.discover(baseUrl);
  
  if (!urlResult.success) {
    throw new Error(`URL discovery failed: ${urlResult.error}`);
  }
  
  // Take screenshots
  const screenshotService = new ScreenshotService({
    outputDir: options.outputDir || './data/screenshots',
    concurrent: options.concurrent || 4,
    timeout: options.timeout || 30000
  });
  
  console.log('📸 Taking screenshots...');
  const screenshotResult = await screenshotService.captureAll(urlResult.urls);
  
  if (!screenshotResult.success) {
    throw new Error(`Screenshot capture failed: ${screenshotResult.error}`);
  }
  
  return {
    urls: urlResult.urls,
    screenshots: screenshotResult.successful,
    stats: {
      urlDiscovery: urlResult.stats,
      screenshots: screenshotResult.stats
    },
    files: {
      urls: urlResult.files,
      screenshots: screenshotResult.files
    }
  };
}

module.exports = { capture };