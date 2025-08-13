'use strict';

const { buildOptions } = require('./options');
const { EnvironmentGuard } = require('./env');
const { PageValidator } = require('./validator');
const { PageWaits } = require('./waits');
const { ElementDiscovery } = require('./discovery');
const { ChangeDetector } = require('./changes');
const { RegionLocator } = require('./regions');
const { Screenshotter } = require('./screenshotter');
const { InteractionEngine } = require('./interaction');

class InteractiveContentCapture {
  constructor(page, options = {}) {
    this.page = page;
    this.options = buildOptions(options);

    // Public state (kept for backward compatibility)
    this.screenshots = [];
    this.interactionHistory = new Map();
    this.discoveredElements = [];
    this.deduplicationReport = null;
    this.currentPageDomain = null;

    // Subsystems
    this.env = new EnvironmentGuard(this.page);
    this.validator = new PageValidator(this.page, this.options);
    this.waits = new PageWaits(this.page, this.validator);
    this.changeDetector = new ChangeDetector(this.page, this.options);
    this.regionLocator = new RegionLocator(this.page, this.options);
    this.screenshotter = new Screenshotter(this.page, this.options, this.validator);
    this.interactor = new InteractionEngine({
      page: this.page,
      options: this.options,
      env: this.env,
      waits: this.waits,
      changes: this.changeDetector,
      regions: this.regionLocator,
      screenshotter: this.screenshotter,
      interactionHistoryRef: this.interactionHistory
    });
  }

  async captureInteractiveContent() {
    console.log('🚀 Starting interactive content capture (modular)...');
    try {
      await this.env.init();
      this.currentPageDomain = this.env.currentDomain;

      await this.waits.waitForCompletePageLoadWithValidation();

      await this.screenshotter.takeScreenshotWithQualityCheck('00_baseline');

      const discovery = new ElementDiscovery(this.page, this.options, this.env);
      this.discoveredElements = await discovery.discoverInteractiveElements();
      console.log(`🎯 Discovered ${this.discoveredElements.length} interactive elements (external links filtered)`);
      if (!this.discoveredElements.length) {
        this._syncScreenshots();
        return this.screenshots;
      }

      const max = Math.min(this.discoveredElements.length, this.options.maxInteractions);
      for (let i = 0; i < max; i++) {
        if (this.screenshotter.screenshots.length >= this.options.maxScreenshots) break;
        await this.interactor.interactWithElement(this.discoveredElements[i], i);
        if (i < max - 1) await this.page.waitForTimeout(200);
      }

      if (this.screenshotter.screenshots.length < 3) {
        await this.screenshotter.takeScreenshotWithQualityCheck('99_final');
      }

      // Deduplicate
      const { ImageDeduplicationService } = require('../../image-deduplication');
      const dd = new ImageDeduplicationService({
        similarityThreshold: this.options.dedupeSimilarityThreshold,
        keepHighestQuality: true,
        preserveFirst: true,
        verbose: true
      });
      let unique = await dd.processScreenshots(this.screenshotter.screenshots);
      const keepTags = new Set(['anchor', 'tabpanel', 'tabs']);
      const names = new Set(unique.map(u => u.filename));
      this.screenshotter.screenshots.forEach(s => {
        const tags = new Set(s.tags || []);
        if ([...tags].some(t => keepTags.has(t)) && !names.has(s.filename)) {
          unique.push(s);
          names.add(s.filename);
        }
      });
      this.screenshotter.screenshots = unique;
      this.deduplicationReport = dd.getDeduplicationReport();

      this._syncScreenshots();
      console.log(`🎉 Final: ${this.screenshots.length} unique screenshots`);
      return this.screenshots;
    } catch (e) {
      console.error(`❌ Interactive capture failed: ${e.message}`);
      this._syncScreenshots();
      return this.screenshots;
    }
  }

  getCaptureReport() {
    return {
      totalScreenshots: this.screenshots.length,
      deduplication: this.deduplicationReport || null
    };
  }

  // keep this.screenshots in sync with screenshotter.screenshots for backwards compatibility
  _syncScreenshots() {
    this.screenshots = this.screenshotter.screenshots;
  }
}

module.exports = { InteractiveContentCapture };
