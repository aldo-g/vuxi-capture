const fs = require('fs-extra');
const path = require('path');
const { URLDiscoveryService } = require('../src/services/url-discovery');

async function testURLDiscoveryService() {
  console.log('🧪 Testing URL Discovery Service...\n');
  
  // Initialize service with aggressive concurrent settings
  const service = new URLDiscoveryService({
    maxPages: 20,
    timeout: 5000,        // 5 seconds max per page
    waitTime: 0,          // No waiting
    concurrency: 4,       // Process 4 pages simultaneously
    fastMode: true,       // Enable all optimizations
    outputDir: './data'
  });
  
  try {
    // Test with Edinburgh Peace Institute
    const result = await service.discover('https://pre-sustainability.com');
    
    if (result.success) {
      console.log('✅ URL Discovery test PASSED');
      console.log(`📊 Found ${result.urls.length} URLs`);
      console.log(`⏱️  Duration: ${result.stats.duration}s`);
      console.log(`📄 Files saved:`);
      console.log(`   - ${result.files.urls}`);
      console.log(`   - ${result.files.simpleUrls}`);
      
      // Verify files were created
      const urlsExist = await fs.pathExists(result.files.urls);
      const simpleUrlsExist = await fs.pathExists(result.files.simpleUrls);
      
      if (urlsExist && simpleUrlsExist) {
        console.log('\n✅ Data files verified in data directory');
        
        // Show sample of URLs found
        console.log('\n📋 Sample URLs discovered:');
        result.urls.slice(0, 3).forEach((url, i) => {
          console.log(`   ${i + 1}. ${url}`);
        });
        
        if (result.urls.length > 3) {
          console.log(`   ... and ${result.urls.length - 3} more`);
        }
        
        // Show file sizes
        const urlsStats = await fs.stat(result.files.urls);
        const simpleStats = await fs.stat(result.files.simpleUrls);
        console.log(`\n📁 File sizes:`);
        console.log(`   urls.json: ${(urlsStats.size / 1024).toFixed(2)} KB`);
        console.log(`   urls_simple.json: ${(simpleStats.size / 1024).toFixed(2)} KB`);
        
      } else {
        console.log('❌ Data files NOT found in expected location');
      }
      
    } else {
      console.log('❌ URL Discovery test FAILED');
      console.log(`Error: ${result.error}`);
    }
    
  } catch (error) {
    console.log('❌ Test threw an exception:', error.message);
  }
  
  console.log('\n🏁 Test completed');
}

// Run the test
testURLDiscoveryService().catch(console.error);