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
    console.log('🚀 Starting interactive content capture with dynamic discovery...');
    try {
      await this.env.init();
      this.currentPageDomain = this.env.currentDomain;

      await this.waits.waitForCompletePageLoadWithValidation();

      // Take baseline screenshot
      await this.screenshotter.takeScreenshotWithQualityCheck('00_baseline');

      // IMPORTANT: Capture baseline state after page is fully loaded
      await this.interactor.captureBaselineState();

      let discoveryRound = 0;
      let consecutiveEmptyRounds = 0;
      const maxEmptyRounds = 2; // Stop if we have 2 consecutive rounds with no new elements

      // Dynamic discovery loop
      while (this._shouldContinueProcessing() && consecutiveEmptyRounds < maxEmptyRounds) {
        discoveryRound++;
        console.log(`\n🔄 Discovery round ${discoveryRound}`);

        // Discover new elements in current page state
        const newElements = await this._discoverNewElements();
        
        if (newElements.length === 0) {
          consecutiveEmptyRounds++;
          console.log(`   ⚠️ No new elements found (empty round ${consecutiveEmptyRounds}/${maxEmptyRounds})`);
          
          // If no new elements, wait a bit for any delayed content and try once more
          if (consecutiveEmptyRounds === 1) {
            await this.page.waitForTimeout(1000);
            continue;
          } else {
            break;
          }
        } else {
          consecutiveEmptyRounds = 0;
        }

        // Process elements in this round
        const elementsToProcess = Math.min(
          newElements.length, 
          this.options.maxInteractions - this.totalInteractions,
          this.options.maxScreenshots - this.screenshotter.screenshots.length
        );

        console.log(`   🎯 Processing ${elementsToProcess} elements in this round`);
        let interactedInRound = false;

        for (let i = 0; i < elementsToProcess; i++) {
          const element = newElements[i];
          const signature = this._createElementSignature(element);
          
          // Mark as processed before interaction to avoid reprocessing
          this.processedElementSignatures.add(signature);
          
          console.log(`   📍 Element ${i + 1}/${elementsToProcess}: ${element.type} - "${element.text}"`);
          
          // Ensure baseline state before each interaction (except the first one)
          if (this.interactor.baselineState && i > 0) {
            await this.interactor.restoreToBaselineState();
            await this.page.waitForTimeout(300);
          }
          
          // Try to interact with the element
          const interactionResult = await this.interactor.interactWithElement(element, this.totalInteractions);
          
          // If interaction failed due to element not found, try refreshing and retrying
          if (!interactionResult || !interactionResult.success) {
            const signature = this._createElementSignature(element);
            
            // If we haven't already failed this element, try refreshing page and retrying
            if (!this.failedElements.has(signature)) {
              console.log(`   🔄 Element not found, refreshing page and retrying...`);
              this.failedElements.add(signature);
              
              // Refresh page and rediscover baseline
              await this._refreshAndRediscoverBaseline();
              
              // Try interaction again
              const retryResult = await this.interactor.interactWithElement(element, this.totalInteractions);
              
              if (retryResult && retryResult.success) {
                console.log(`   ✅ Retry successful after page refresh`);
                this.totalInteractions++;
                interactedInRound = true;
                
                // Check for new elements after successful retry
                if (retryResult.success) {
                  if (element.text.toLowerCase().includes('filter')) {
                    this.filterGroupInteracted = true;
                  }
                  await this.page.waitForTimeout(500);
                  
                  const immediateNewElements = await this._discoverNewElements();
                  if (immediateNewElements.length > 0) {
                    console.log(`   🆕 Found ${immediateNewElements.length} immediate new elements after retry`);
                  }
                }
              } else {
                console.log(`   ❌ Retry also failed, skipping element`);
              }
            } else {
              console.log(`   ❌ Element already failed before, skipping`);
            }
          } else {
            // Successful interaction
            this.totalInteractions++;
            interactedInRound = true;

            // Check if this interaction caused significant changes that might reveal new elements
            if (interactionResult.success) {
              if (element.text.toLowerCase().includes('filter')) {
                this.filterGroupInteracted = true;
              }
              // Wait for any animations or dynamic content to settle
              await this.page.waitForTimeout(500);
              
              // Only check for immediate new content if we're still in baseline state
              // (since we restore after each interaction)
              const immediateNewElements = await this._discoverNewElements();
              if (immediateNewElements.length > 0) {
                console.log(`   🆕 Found ${immediateNewElements.length} immediate new elements after interaction`);
              }
            }
          }

          // Add some breathing room between interactions
          if (i < elementsToProcess - 1) {
            await this.page.waitForTimeout(200);
          }

          // Check if we've hit our limits
          if (!this._shouldContinueProcessing()) {
            console.log(`   🛑 Stopping: reached interaction limit (${this.totalInteractions}/${this.options.maxInteractions}) or screenshot limit`);
            this.maxInteractionsReached = true;
            break;
          }
        }
        
        if (!interactedInRound) {
          consecutiveEmptyRounds++;
        }

        // Store discovered elements for reporting
        this.discoveredElements.push(...newElements.slice(0, elementsToProcess));

        console.log(`   ✅ Round ${discoveryRound} complete. Total interactions: ${this.totalInteractions}, Screenshots: ${this.screenshotter.screenshots.length}`);
      }

      console.log(`\n🏁 Dynamic discovery complete after ${discoveryRound} rounds`);
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

  _syncScreenshots() {
    this.screenshots = [...this.screenshotter.screenshots];
  }
}

module.exports = { InteractiveContentCapture };