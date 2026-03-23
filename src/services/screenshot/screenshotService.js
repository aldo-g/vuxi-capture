const { chromium } = require('playwright');
const fs = require('fs-extra');
const path = require('path');
const { buildFilename } = require('./fileNaming');
const { discoverInteractiveGroups } = require('./interactionDiscovery');
const { InteractionRunner } = require('./interactionRunner');
const { ScreenshotDeduplicator } = require('./deduplicator');
const {
  waitForImages,
  waitForPageSettled,
  installPageReadinessHooks
} = require('./pageReadiness');
const { installInteractionGuards } = require('./pageGuards');

class ScreenshotService {
  constructor(options = {}) {
    this.outputDir = options.outputDir || path.join(process.cwd(), 'data');
    this.viewport = options.viewport || { width: 1280, height: 720 };
    this.timeout = options.timeout ?? 30000;
    this.concurrent = options.concurrent ?? 2;
    this.mediaWaitTimeout = options.mediaWaitTimeout ?? 5000;
    this.pageSettleTimeout = options.pageSettleTimeout ?? 8000;
    this.stableWaitTime = options.stableWaitTime ?? 600;
    this.resetBetweenInteractions = options.resetBetweenInteractions ?? false;
    this.retryInteractionOnReload = options.retryInteractionOnReload ?? false;
    this.screenshotsDir = path.join(this.outputDir, 'desktop');
    this.deduplicator = new ScreenshotDeduplicator();
  }

  async captureAll(urls = []) {
    if (!urls.length) {
      return this.#emptyResult();
    }

    console.log(`[screenshot] capturing ${urls.length} page(s)`);
    await fs.ensureDir(this.screenshotsDir);

    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const interactionRunner = new InteractionRunner({
      timeout: this.timeout,
      screenshotsDir: this.screenshotsDir,
      mediaWaitTimeout: this.mediaWaitTimeout,
      pageSettleTimeout: this.pageSettleTimeout,
      stableWaitTime: this.stableWaitTime,
      resetBetweenInteractions: this.resetBetweenInteractions,
      retryWithPageReload: this.retryInteractionOnReload
    });

    const successful = [];
    const failed = [];
    const startedAt = Date.now();

    try {
      for (let i = 0; i < urls.length; i += this.concurrent) {
        const batch = urls.slice(i, i + this.concurrent);
        const results = await Promise.all(
          batch.map((url, batchIndex) =>
            this.#captureSingle({
              browser,
              interactionRunner,
              url,
              index: i + batchIndex + 1
            })
          )
        );

        results.forEach(result => {
          if (result.success) {
            successful.push(result.data);
          } else {
            failed.push({ url: result.url, error: result.error });
          }
        });
      }
    } finally {
      await browser.close();
    }

    const deduplication = await this.deduplicator.run(successful);
    const durationSeconds = Number(((Date.now() - startedAt) / 1000).toFixed(2));
    const interactionTotals = this.#calculateInteractionTotals(successful);
    const metadata = this.#buildMetadata({
      urls,
      successful,
      failed,
      durationSeconds,
      interactionTotals,
      deduplication
    });

    const metadataPath = path.join(this.outputDir, 'metadata.json');
    await fs.writeJson(metadataPath, metadata, { spaces: 2 });
    this.#logSummary(successful.length, interactionTotals, deduplication);

    return {
      success: successful.length > 0,
      successful,
      failed,
      stats: {
        durationSeconds,
        totalScreenshots: successful.length
      },
      files: {
        metadata: metadataPath,
        screenshotsDir: this.screenshotsDir
      }
    };
  }

  async #captureSingle({ browser, interactionRunner, url, index }) {
    const context = await browser.newContext({
      viewport: this.viewport
    });
    await installPageReadinessHooks(context);
    await installInteractionGuards(context);
    const page = await context.newPage();

    try {
      console.log(`[screenshot] (${index}) visiting ${url}`);
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: this.timeout
      });
      await page.waitForLoadState('networkidle', {
        timeout: Math.min(this.timeout / 2, 5000)
      }).catch(() => {});
      await this.#waitForPageReady(page, url, index);

      const filename = buildFilename(url, index);
      const filepath = path.join(this.screenshotsDir, filename);

      await page.screenshot({
        path: filepath,
        fullPage: true,
        type: 'png'
      });
      console.log(`[screenshot] (${index}) saved base screenshot -> desktop/${filename}`);

      let interactions = [];
      try {
        const groups = await discoverInteractiveGroups(page);
        if (groups.length) {
          console.log(
            `[screenshot] (${index}) found ${groups.length} interactive group(s) on ${url}`
          );
        } else {
          console.log(`[screenshot] (${index}) no interactive elements detected on ${url}`);
        }

        interactions = await interactionRunner.capture({
          page,
          url,
          baseFilename: filename,
          groups,
          pageIndex: index
        });
      } catch (interactionError) {
        console.warn(
          `[screenshot] interaction capture skipped for ${url}: ${interactionError.message}`
        );
      }

      return {
        success: true,
        data: {
          url,
          filename,
          path: `desktop/${filename}`,
          outputPath: filepath,
          interactions
        }
      };
    } catch (error) {
      console.error(`[screenshot] (${index}) failed for ${url}: ${error.message}`);
      return {
        success: false,
        url,
        error: error.message
      };
    } finally {
      await context.close();
    }
  }

  #calculateInteractionTotals(successful = []) {
    return successful.reduce(
      (totals, entry) => {
        const interactions = entry.interactions || [];
        totals.groups += interactions.length;
        totals.screenshots += interactions.filter(i => i.status === 'captured').length;
        return totals;
      },
      { groups: 0, screenshots: 0 }
    );
  }

  #buildMetadata({ urls, successful, failed, durationSeconds, interactionTotals, deduplication }) {
    return {
      capturedAt: new Date().toISOString(),
      durationSeconds,
      totalUrls: urls.length,
      successful: successful.length,
      failed: failed.length,
      interactions: interactionTotals,
      deduplication
    };
  }

  #logSummary(successfulCount, interactionTotals, deduplication) {
    const interactionNote = interactionTotals.screenshots
      ? ` + ${interactionTotals.screenshots} interaction screenshot(s)`
      : '';
    console.log(
      `[screenshot] captured ${successfulCount} base screenshot(s)${interactionNote}`
    );
    if (deduplication.totalDuplicates > 0) {
      console.log(
        `[screenshot] removed ${deduplication.totalDuplicates} duplicate screenshot(s)`
      );
    }
  }

  #emptyResult() {
    return {
      success: false,
      successful: [],
      failed: [],
      stats: { durationSeconds: 0, totalScreenshots: 0 },
      files: {}
    };
  }

  async #waitForPageReady(page, url, label) {
    const settled = await waitForPageSettled(page, {
      timeout: this.pageSettleTimeout,
      stableMillis: this.stableWaitTime
    });
    if (!settled) {
      console.warn(
        `[screenshot] (${label}) continuing before DOM settled on ${url}`
      );
    }

    const imagesReady = await waitForImages(page, {
      timeout: this.mediaWaitTimeout
    });
    if (!imagesReady) {
      console.warn(
        `[screenshot] (${label}) continuing before all images finished loading on ${url}`
      );
    }
  }
}

module.exports = { ScreenshotService };
