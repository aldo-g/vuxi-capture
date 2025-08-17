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

    // Dynamic discovery state
    this.processedElementSignatures = new Set();
    this.totalInteractions = 0;
    this.maxInteractionsReached = false;
    this.filterGroupInteracted = false;
    this.filterOptionInteracted = false;
    this.failedElements = new Set(); // Track elements that failed to be found

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

  // Create a unique signature for an element to avoid duplicate interactions
  _createElementSignature(element) {
    return `${element.type}_${element.text}_${element.selector.replace(/\[data-interactive-id="[^"]+"\]/, '[data-interactive-id="*"]')}`;
  }

  // Check if we should continue processing more elements
  _shouldContinueProcessing() {
    return (
      this.totalInteractions < this.options.maxInteractions &&
      this.screenshotter.screenshots.length < this.options.maxScreenshots &&
      !this.maxInteractionsReached
    );
  }

  // Discover elements and filter out already processed ones
  async _discoverNewElements() {
    const discovery = new ElementDiscovery(this.page, this.options, this.env);
    const allElements = await discovery.discoverInteractiveElements();
    
    // Filter out elements we've already processed
    const newElements = allElements.filter(element => {
      const signature = this._createElementSignature(element);
      return !this.processedElementSignatures.has(signature);
    });

    console.log(`🔍 Discovered ${allElements.length} total elements, ${newElements.length} new elements to process`);
    
    return newElements;
  }

  // Refresh page and rediscover baseline elements
  async _refreshAndRediscoverBaseline() {
    console.log(`   🔄 Refreshing page to rediscover baseline elements...`);
    
    // Go back to baseline URL
    await this.page.goto(this.interactor.baselineState.url, { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });
    
    // Wait for page to fully load
    await this.waits.waitForCompletePageLoadWithValidation();
    await this.page.waitForTimeout(1000);
    
    // Reapply element identifiers
    await this.interactor.reapplyElementIdentifiers();
    
    // Capture new baseline state
    await this.interactor.captureBaselineState();
    
    console.log(`   ✅ Page refreshed and baseline state recaptured`);
  }

  async captureInteractiveContent() {
    console.log('🚀 Starting interactive content capture...');
    try {
      await this.env.init();
      this.currentPageDomain = this.env.currentDomain;

      await this.waits.waitForCompletePageLoadWithValidation();

      // Take baseline screenshot
      await this.screenshotter.takeScreenshotWithQualityCheck('00_baseline');

      // IMPORTANT: Capture baseline state after page is fully loaded
      await this.interactor.captureBaselineState();

      console.log(`\n🔄 Starting a single discovery and interaction round...`);

      // Discover new elements in current page state
      const newElements = await this._discoverNewElements();
      
      if (newElements.length > 0) {
        // Process elements in this round
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
          
          // Mark as processed before interaction to avoid reprocessing
          this.processedElementSignatures.add(signature);
          
          console.log(`   📍 Element ${i + 1}/${elementsToProcess}: ${element.type} - "${element.text}"`);
          
          // Ensure baseline state before each interaction
          if (this.interactor.baselineState && this.totalInteractions > 0) {
            await this.interactor.restoreToBaselineState();
            await this.page.waitForTimeout(300);
          }
          
          // Try to interact with the element
          const interactionResult = await this.interactor.interactWithElement(element, this.totalInteractions);
          
          if (interactionResult && interactionResult.success) {
            this.totalInteractions++;
          } else {
             // If interaction failed, try to refresh and retry once
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

      // Take final screenshot if we have too few
      if (this.screenshotter.screenshots.length < 3) {
        await this.screenshotter.takeScreenshotWithQualityCheck('99_final');
      }

      // Deduplicate screenshots
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
      
      // Sync public state
      this._syncScreenshots();
      
      // Return screenshots array for backward compatibility with enhanced-integration.js
      return this.screenshots;

    } catch (error) {
      console.error('❌ Interactive content capture failed:', error);
      this._syncScreenshots();
      throw error; // Re-throw to let enhanced-integration handle it
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