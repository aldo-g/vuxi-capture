const path = require('path');
const fs = require('fs-extra');
const { URLDiscoveryService } = require('./src/services/urlDiscovery');
const { ScreenshotService } = require('./src/services/screenshot');

async function capture(baseUrl, options = {}) {
  if (!baseUrl) {
    throw new Error('baseUrl is required');
  }

  const outputDir =
    options.outputDir || path.join(process.cwd(), 'data', `run_${Date.now()}`);
  await fs.ensureDir(outputDir);

  const discoveryService = new URLDiscoveryService({
    maxPages: options.maxPages,
    concurrency: options.concurrency,
    timeout: options.timeout,
    outputDir
  });

  const discoveryResult = await discoveryService.discover(baseUrl);
  if (!discoveryResult.success || !discoveryResult.urls.length) {
    throw new Error('URL discovery did not return any pages');
  }

  const screenshotService = new ScreenshotService({
    outputDir,
    viewport: options.viewport,
    timeout: options.timeout,
    concurrent: options.concurrentCaptures
  });

  const screenshotResult = await screenshotService.captureAll(
    discoveryResult.urls
  );
  if (!screenshotResult.success) {
    throw new Error('Screenshot capture failed');
  }

  return {
    urls: discoveryResult.urls,
    screenshots: screenshotResult.successful,
    output: {
      dir: outputDir,
      urlsFile: discoveryResult.files,
      screenshotFiles: screenshotResult.files
    }
  };
}

async function main() {
  const [baseUrl] = process.argv.slice(2);

  if (!baseUrl) {
    console.log('Usage: node index.js <baseUrl>');
    process.exit(1);
  }

  try {
    await capture(baseUrl);
    console.log('Capture complete');
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { capture };
