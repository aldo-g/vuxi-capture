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

    this.screenshots = [];
    this.interactionHistory = new Map();
    this.discoveredElements = [];
    this.deduplicationReport = null;
    this.currentPageDomain = null;

    this.processedElementSignatures = new Set();
    this.totalInteractions = 0;
    this.maxInteractionsReached = false;
    this.failedElements = new Set();

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

  _createElementSignature(element) {
    return `${element.type}_${element.text}_${element.selector.replace(/\[data-interactive-id="[^"]+"\]/, '[data-interactive-id="*"]')}`;
  }

  _shouldContinueProcessing() {
    return (
      this.totalInteractions < this.options.maxInteractions &&
      this.screenshotter.screenshots.length < this.options.maxScreenshots &&
      !this.maxInteractionsReached
    );
  }

  async _discoverNewElements() {
    const discovery = new ElementDiscovery(this.page, this.options, this.env);
    const allElements = await discovery.discoverInteractiveElements();
    
    const newElements = allElements.filter(element => {
      const signature = this._createElementSignature(element);
      return !this.processedElementSignatures.has(signature);
    });

    console.log(`🔍 Discovered ${allElements.length} total elements, ${newElements.length} new elements to process`);
    
    return newElements;
  }

  async _refreshAndRediscoverBaseline() {
    console.log(`   🔄 Refreshing page to rediscover baseline elements...`);
    
    await this.page.goto(this.interactor.baselineState.url, { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });
    
    await this.waits.waitForCompletePageLoadWithValidation();
    await this.page.waitForTimeout(1000);
    
    await this.interactor.reapplyElementIdentifiers();
    
    await this.interactor.captureBaselineState();
    
    console.log(`   ✅ Page refreshed and baseline state recaptured`);
  }

  async captureInteractiveContent() {
    console.log('🚀 Starting interactive content capture...');
    try {
      await this.env.init();
      this.currentPageDomain = this.env.currentDomain;

      await this.waits.waitForCompletePageLoadWithValidation();

      await this.screenshotter.takeScreenshotWithQualityCheck('00_baseline');

      await this.interactor.captureBaselineState();

      console.log(`\n🔄 Starting a single discovery and interaction round...`);

      const newElements = await this._discoverNewElements();
      
      if (newElements.length > 0) {
        const elementsToProcess = Math.min(
          newElements.length, 
          this.options.maxInteractions - this.totalInteractions,
          this.options.maxScreenshots - this.screenshotter.screenshots.length
        );

        console.log(`   🎯 Processing ${elementsToProcess} elements`);

        for (let i = 0; i < elementsToProcess; i++) {
          if (!this._shouldContinueProcessing()) {
            console.log(`   🛑 Stopping: reached interaction or screenshot limit.`);
            break;
          }

          const element = newElements[i];
          const signature = this._createElementSignature(element);
          
          this.processedElementSignatures.add(signature);
          
          console.log(`   📍 Element ${i + 1}/${elementsToProcess}: ${element.type} - "${element.text}"`);
          
          if (this.interactor.baselineState && this.totalInteractions > 0) {
            await this.interactor.restoreToBaselineState();
            await this.page.waitForTimeout(300);
          }
          
          const interactionResult = await this.interactor.interactWithElement(element, this.totalInteractions);
          
          if (interactionResult && interactionResult.success) {
            this.totalInteractions++;
          } else {
            const signature = this._createElementSignature(element);
            if (!this.failedElements.has(signature)) {
              console.log(`   🔄 Element not found, refreshing page and retrying...`);
              this.failedElements.add(signature);
              
              await this._refreshAndRediscoverBaseline();
              
              const retryResult = await this.interactor.interactWithElement(element, this.totalInteractions);
              
              if (retryResult && retryResult.success) {
                console.log(`   ✅ Retry successful after page refresh`);
                this.totalInteractions++;
              } else {
                console.log(`   ❌ Retry also failed, skipping element`);
              }
            } else {
              console.log(`   ❌ Element already failed before, skipping`);
            }
          }
        }
      } else {
        console.log("   ⚠️ No interactive elements found in the single discovery round.");
      }

      console.log(`\n🏁 Interaction round complete.`);
      console.log(`   📊 Total interactions: ${this.totalInteractions}`);
      console.log(`   📸 Total screenshots before deduplication: ${this.screenshotter.screenshots.length}`);
      console.log(`   🔍 Unique elements processed: ${this.processedElementSignatures.size}`);

      if (this.screenshotter.screenshots.length < 3) {
        await this.screenshotter.takeScreenshotWithQualityCheck('99_final');
      }

      const { ImageDeduplicationService } = require('../../image-deduplication');
      const dedup = new ImageDeduplicationService({
        similarityThreshold: this.options.dedupeSimilarityThreshold,
        keepHighestQuality: true,
        preserveFirst: true,
        verbose: true
      });
      const uniqueScreenshots = await dedup.processScreenshots(this.screenshotter.screenshots);
      this.deduplicationReport = dedup.getDeduplicationReport();

      this.screenshots = uniqueScreenshots;
      
      this._syncScreenshots();
      
      return this.screenshots;

    } catch (error) {
      console.error('❌ Interactive content capture failed:', error);
      this._syncScreenshots();
      throw error;
    }
  }

  getCaptureReport() {
    return {
      totalInteractions: this.totalInteractions,
      totalScreenshots: this.screenshots.length,
      uniqueElementsProcessed: this.processedElementSignatures.size,
      deduplicationReport: this.deduplicationReport,
    };
  }

  _syncScreenshots() {
    this.screenshots = [...this.screenshotter.screenshots];
  }
}

module.exports = { InteractiveContentCapture };