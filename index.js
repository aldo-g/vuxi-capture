const { URLDiscoveryService } = require('./url-discovery');
const { EnhancedScreenshotService } = require('./screenshot/enhanced-integration');

async function capture(baseUrl, options = {}) {
  console.log(`🚀 Starting enhanced capture for: ${baseUrl}`);
  
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
  
  console.log(`✅ Found ${urlResult.urls.length} URLs`);
  
  // Enhanced Screenshot Capture
  const screenshotService = new EnhancedScreenshotService({
    outputDir: options.outputDir || './data/screenshots',
    concurrent: options.concurrent || 4,
    timeout: options.timeout || 30000,
    viewport: options.viewport || { width: 1440, height: 900 },
    
    // Enhanced interactive capture options
    enableInteractiveCapture: options.captureInteractive !== false, // Default true
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
  
  console.log('📸 Taking enhanced screenshots...');
  if (options.captureInteractive !== false) {
    console.log('🎯 Interactive capture ENABLED - will discover and interact with:');
    console.log('   • Tabs and navigation elements');
    console.log('   • Expandable content (accordions, "show more" buttons)');
    console.log('   • Modal triggers and overlay content');
    console.log('   • Dropdown menus and hidden panels');
    console.log('   • Interactive media elements');
    console.log(`   • Max ${options.maxInteractions || 30} interactions per page`);
    console.log(`   • Max ${options.maxScreenshotsPerPage || 15} screenshots per page`);
  } else {
    console.log('📷 Standard capture mode (1 screenshot per page)');
  }
  
  const screenshotResult = await screenshotService.captureAll(urlResult.urls);
  
  if (!screenshotResult.success) {
    throw new Error(`Screenshot capture failed: ${screenshotResult.error}`);
  }
  
  // Enhanced results with detailed statistics
  const results = {
    urls: urlResult.urls,
    screenshots: screenshotResult.successful,
    stats: {
      urlDiscovery: urlResult.stats,
      screenshots: screenshotResult.stats
    },
    files: {
      urls: urlResult.files,
      screenshots: screenshotResult.files
    },
    
    // Enhanced capture analytics
    enhancedCapture: {
      interactiveEnabled: options.captureInteractive !== false,
      totalScreenshots: screenshotResult.stats?.totalScreenshots || 0,
      averageScreenshotsPerPage: screenshotResult.stats?.averageScreenshotsPerPage || '1.0',
      interactivePagesFound: screenshotResult.stats?.interactivePagesFound || 0,
      interactionSuccessRate: screenshotResult.stats?.interactivePagesFound > 0 ? 
        (screenshotResult.stats.interactivePagesFound / screenshotResult.successful.length * 100).toFixed(1) + '%' : '0%',
      totalUrlsProcessed: urlResult.urls.length,
      successfullyProcessed: screenshotResult.successful.length,
      failedProcessing: screenshotResult.failed.length
    }
  };
  
  // Enhanced completion summary
  console.log('\n🎉 Enhanced capture completed successfully!');
  console.log(`📸 Total screenshots: ${results.enhancedCapture.totalScreenshots}`);
  console.log(`📊 Average screenshots per page: ${results.enhancedCapture.averageScreenshotsPerPage}`);
  console.log(`🎯 Interactive pages found: ${results.enhancedCapture.interactivePagesFound}/${results.enhancedCapture.totalUrlsProcessed}`);
  console.log(`📁 Screenshots saved to: ${screenshotResult.files.screenshotsDir}`);
  
  if (results.enhancedCapture.interactiveEnabled) {
    console.log(`⚡ Interaction success rate: ${results.enhancedCapture.interactionSuccessRate}`);
    if (results.enhancedCapture.interactivePagesFound > 0) {
      console.log(`✨ Successfully discovered and captured hidden content behind interactive elements!`);
    }
  }
  
  return results;
}

// Enhanced standalone execution with better option handling
async function main() {
  try {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
      console.log('Usage: node index.js <baseUrl> [options]');
      console.log('');
      console.log('Enhanced Capture Options:');
      console.log('  --no-interactive         Disable interactive capture');
      console.log('  --max-interactions <n>   Max interactions per page (default: 30)');
      console.log('  --max-screenshots <n>    Max screenshots per page (default: 15)');
      console.log('  --interaction-delay <ms> Delay between interactions (default: 800)');
      console.log('  --enable-hover           Enable hover capture');
      console.log('  --max-pages <n>          Max pages to discover (default: 20)');
      console.log('  --output <dir>           Output directory (default: ./data)');
      console.log('');
      console.log('Examples:');
      console.log('  node index.js https://example.com');
      console.log('  node index.js https://example.com --max-interactions 20 --max-screenshots 10');
      console.log('  node index.js https://example.com --no-interactive --max-pages 10');
      console.log('  node index.js https://example.com --enable-hover --interaction-delay 1000');
      process.exit(1);
    }
    
    const baseUrl = args[0];
    const options = {};
    
    // Parse command line options
    for (let i = 1; i < args.length; i += 2) {
      const flag = args[i];
      const value = args[i + 1];
      
      switch (flag) {
        case '--no-interactive':
          options.captureInteractive = false;
          i--; // No value for this flag
          break;
        case '--max-interactions':
          options.maxInteractions = parseInt(value);
          break;
        case '--max-screenshots':
          options.maxScreenshotsPerPage = parseInt(value);
          break;
        case '--interaction-delay':
          options.interactionDelay = parseInt(value);
          break;
        case '--enable-hover':
          options.enableHoverCapture = true;
          i--; // No value for this flag
          break;
        case '--max-pages':
          options.maxPages = parseInt(value);
          break;
        case '--output':
          options.outputDir = value;
          break;
        case '--timeout':
          options.timeout = parseInt(value);
          break;
        case '--concurrency':
          options.concurrency = parseInt(value);
          break;
        default:
          console.warn(`Unknown option: ${flag}`);
          i--; // Don't skip the next argument
      }
    }
    
    console.log('🚀 Starting enhanced capture with options:', {
      baseUrl,
      captureInteractive: options.captureInteractive !== false,
      maxInteractions: options.maxInteractions || 30,
      maxScreenshotsPerPage: options.maxScreenshotsPerPage || 15,
      maxPages: options.maxPages || 20,
      outputDir: options.outputDir || './data'
    });
    
    const result = await capture(baseUrl, options);
    
    console.log('\n📊 Final Results Summary:');
    console.log(`   URLs discovered: ${result.urls.length}`);
    console.log(`   Pages processed: ${result.enhancedCapture.successfullyProcessed}`);
    console.log(`   Total screenshots: ${result.enhancedCapture.totalScreenshots}`);
    console.log(`   Interactive pages: ${result.enhancedCapture.interactivePagesFound}`);
    console.log(`   Success rate: ${result.enhancedCapture.interactionSuccessRate}`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Enhanced capture failed:', error.message);
    process.exit(1);
  }
}

// Export both the function and run main if called directly
module.exports = { capture };

if (require.main === module) {
  main();
}