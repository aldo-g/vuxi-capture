const fs = require('fs-extra');
const path = require('path');
const { ScreenshotService } = require('../src/services/screenshot');

async function testScreenshotService() {
  console.log('🧪 Testing Screenshot Service...\n');
  
  try {
    // First, check if we have URLs from the URL discovery test
    const urlsPath = './data/urls_simple.json';
    let testUrls = [];
    
    if (await fs.pathExists(urlsPath)) {
      console.log('📥 Loading URLs from previous URL discovery...');
      const urls = await fs.readJson(urlsPath);
      // Take all URLs for testing, but limit to reasonable number
      testUrls = urls.slice(0, Math.min(urls.length, 10)); // Max 10 for testing
      console.log(`   Found ${urls.length} URLs, using first ${testUrls.length} for testing`);
    } else {
      console.log('📝 No URLs found, using test URLs...');
      testUrls = [
        'https://edinburghpeaceinstitute.org',
        'https://edinburghpeaceinstitute.org/training',
        'https://edinburghpeaceinstitute.org/contact-us'
      ];
    }
    
    console.log('📋 URLs to capture:');
    testUrls.forEach((url, i) => console.log(`   ${i + 1}. ${url}`));
    
    // Initialize service with higher concurrency
    const service = new ScreenshotService({
      outputDir: './data/screenshots',
      viewport: { width: 1440, height: 900 },
      timeout: 30000,
      concurrent: 4  // Increased concurrency
    });
    
    // Capture screenshots
    const result = await service.captureAll(testUrls);
    
    if (result.success) {
      console.log('\n✅ Screenshot test PASSED');
      console.log(`📸 Captured ${result.successful.length} screenshots`);
      console.log(`⏱️  Duration: ${result.stats.duration.toFixed(2)}s`);
      console.log(`📁 Screenshots saved to: ${result.files.screenshotsDir}`);
      console.log(`📄 Metadata saved to: ${result.files.metadata}`);
      
      // Verify files were created
      const desktopDir = result.files.screenshotsDir;
      const metadataExists = await fs.pathExists(result.files.metadata);
      
      if (await fs.pathExists(desktopDir) && metadataExists) {
        const screenshots = await fs.readdir(desktopDir);
        const pngFiles = screenshots.filter(f => f.endsWith('.png'));
        
        console.log(`\n✅ Files verified:`);
        console.log(`   📸 ${pngFiles.length} PNG files in desktop directory`);
        console.log(`   📄 Metadata file exists`);
        
        // Show sample screenshots
        console.log('\n📷 Screenshots captured:');
        pngFiles.forEach((file, i) => {
          console.log(`   ${i + 1}. ${file}`);
        });
        
        // Show successful vs failed
        if (result.failed.length > 0) {
          console.log(`\n⚠️  ${result.failed.length} failed captures:`);
          result.failed.forEach(failure => {
            console.log(`   ❌ ${failure.url}: ${failure.error}`);
          });
        }
        
      } else {
        console.log('❌ Expected files NOT found');
      }
      
    } else {
      console.log('❌ Screenshot test FAILED');
      console.log(`Error: ${result.error}`);
      if (result.failed.length > 0) {
        console.log('Failed captures:');
        result.failed.forEach(failure => {
          console.log(`   ❌ ${failure.url}: ${failure.error}`);
        });
      }
    }
    
  } catch (error) {
    console.log('❌ Test threw an exception:', error.message);
  }
  
  console.log('\n🏁 Screenshot test completed');
}

// Run the test
testScreenshotService().catch(console.error);