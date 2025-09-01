'use strict';

const { buildOptions } = require('./options');
const { EnvironmentGuard } = require('./env');
const { PageValidator } = require('./validator');
const { PageWaits } = require('./waits');
const { ElementDiscovery } = require('./discovery');
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
    this.retryAttempts = new Map(); // Track retry attempts per element

    this.env = new EnvironmentGuard(this.page);
    this.validator = new PageValidator(this.page, this.options);
    this.waits = new PageWaits(this.page, this.validator);
    this.screenshotter = new Screenshotter(this.page, this.options, this.validator);
    this.interactor = new InteractionEngine({
      page: this.page,
      options: this.options,
      env: this.env,
      waits: this.waits,
      screenshotter: this.screenshotter,
      interactionHistoryRef: this.interactionHistory
    });
  }

  _createElementSignature(element) {
    // Create a more comprehensive signature for better tracking
    return `${element.type}_${element.subtype || ''}_${(element.text || '').substring(0, 50)}_${element.selector.replace(/\[data-interactive-id="[^"]+"\]/, '[data-interactive-id="*"]').replace(/data-button-text="[^"]+"/, 'data-button-text="*"')}`;
  }

  _shouldContinueProcessing() {
    return (
      this.totalInteractions < this.options.maxInteractions &&
      this.screenshotter.screenshots.length < this.options.maxScreenshots &&
      !this.maxInteractionsReached
    );
  }

  async _discoverNewElements() {
    console.log('🔍 Discovering interactive elements...');
    const discovery = new ElementDiscovery(this.page, this.options, this.env);
    const allElements = await discovery.discoverInteractiveElements();
    
    const newElements = allElements.filter(element => {
      const signature = this._createElementSignature(element);
      const isNew = !this.processedElementSignatures.has(signature);
      if (!isNew) {
        console.log(`🔄 Skipping already processed element: ${signature.substring(0, 60)}`);
      }
      return isNew;
    });

    console.log(`🔍 Discovered ${allElements.length} total elements, ${newElements.length} new elements to process`);
    
    return newElements;
  }

  async _refreshAndRediscoverBaseline() {
    console.log(`   🔄 Refreshing page to rediscover baseline elements...`);
    
    try {
      // Navigate back to the baseline URL
      await this.page.goto(this.interactor.baselineState.url, { 
        waitUntil: 'networkidle',
        timeout: 30000 
      });
      
      // Wait for page to be fully loaded
      await this.waits.waitForCompletePageLoadWithValidation();
      await this.page.waitForTimeout(1000);
      
      // CRITICAL: Handle cookie consent again after refresh
      console.log('   🍪 Re-handling cookie consent after page refresh...');
      await this._handleCookieConsentAndOverlays();
      
      // Wait a bit more for page to stabilize
      await this.page.waitForTimeout(1000);
      
      // Recapture baseline state with element identifiers
      await this.interactor.captureBaselineState();
      
      console.log(`   ✅ Page refreshed and baseline state recaptured`);
      return true;
    } catch (error) {
      console.log(`   ❌ Failed to refresh and rediscover baseline: ${error.message}`);
      return false;
    }
  }

  async _handleFailedElement(element, elementIndex) {
    const signature = this._createElementSignature(element);
    const currentRetries = this.retryAttempts.get(signature) || 0;
    const maxRetries = 2; // Allow up to 2 retries per element
    
    if (currentRetries < maxRetries) {
      console.log(`   🔄 Element failed, attempting retry ${currentRetries + 1}/${maxRetries}...`);
      this.retryAttempts.set(signature, currentRetries + 1);
      
      // Try refreshing the page and reapplying identifiers
      const refreshSuccess = await this._refreshAndRediscoverBaseline();
      
      if (refreshSuccess) {
        // Give the page some time to settle after refresh
        await this.page.waitForTimeout(1000);
        
        // Try the interaction again
        const retryResult = await this.interactor.interactWithElement(element, this.totalInteractions);
        
        if (retryResult && retryResult.success) {
          console.log(`   ✅ Retry successful after page refresh`);
          this.totalInteractions++;
          return true;
        } else {
          console.log(`   ❌ Retry failed after page refresh`);
          if (currentRetries + 1 >= maxRetries) {
            this.failedElements.add(signature);
            console.log(`   🚫 Element permanently failed after ${maxRetries} retries`);
          }
          return false;
        }
      } else {
        console.log(`   ❌ Failed to refresh page for retry`);
        return false;
      }
    } else {
      console.log(`   ❌ Element already failed ${maxRetries} times, skipping`);
      return false;
    }
  }

  async _handleCookieConsentAndOverlays() {
    try {
      console.log('🔍 Looking for cookie consent dialogs and overlays...');
      
      const handled = await this.page.evaluate(() => {
        // First, try to find and click accept buttons
        const acceptSelectors = [
          'button:contains("Accept")',
          'button:contains("Accept All")',
          'button:contains("I Accept")',
          'button:contains("Agree")',
          '.cky-btn-accept',
          '.cookie-accept',
          '#cookie-accept',
          '[data-action="accept"]',
          '[data-action="accept-all"]'
        ];
        
        // Use a more comprehensive text-based search
        const buttons = Array.from(document.querySelectorAll('button, a, .btn'));
        let acceptButton = null;
        
        for (const button of buttons) {
          const text = (button.textContent || '').toLowerCase().trim();
          const classes = (button.className || '').toLowerCase();
          
          if (
            (text.includes('accept') || text.includes('agree') || text.includes('ok')) &&
            !text.includes('reject') &&
            !text.includes('decline') &&
            !text.includes('deny')
          ) {
            const rect = button.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              acceptButton = button;
              console.log('✅ Found cookie accept button:', text);
              break;
            }
          }
        }
        
        if (acceptButton) {
          try {
            acceptButton.click();
            console.log('🍪 Clicked cookie accept button');
            return true;
          } catch (e) {
            console.log('❌ Failed to click accept button:', e.message);
          }
        }
        
        // If no accept button found, try to remove cookie overlays
        const overlaySelectors = [
          '[id*="cookie" i]',
          '[class*="cookie" i]', 
          '[id*="consent" i]',
          '[class*="consent" i]',
          '[class*="cky" i]', // CookieYes specific
          '.modal-backdrop',
          '.overlay',
          '[style*="position: fixed"]',
          '[style*="z-index"]'
        ];
        
        let removedOverlay = false;
        for (const selector of overlaySelectors) {
          try {
            const elements = document.querySelectorAll(selector);
            for (const element of elements) {
              const text = (element.textContent || '').toLowerCase();
              const styles = window.getComputedStyle(element);
              
              if (
                (text.includes('cookie') || text.includes('privacy') || text.includes('consent')) &&
                (styles.position === 'fixed' || styles.position === 'absolute') &&
                parseInt(styles.zIndex) > 100
              ) {
                console.log('🗑️ Removing cookie overlay:', element.className);
                element.remove();
                removedOverlay = true;
              }
            }
          } catch (e) {
            // Continue with next selector
          }
        }
        
        return removedOverlay;
      });
      
      if (handled) {
        console.log('✅ Cookie consent handled, waiting for page to stabilize...');
        await this.page.waitForTimeout(2000); // Give page time to settle
        
        // Wait for any animations or redirects to complete
        await this.waits.waitForCompletePageLoadWithValidation();
      } else {
        console.log('ℹ️ No cookie consent dialogs found or already handled');
      }
      
    } catch (error) {
      console.log('⚠️ Cookie consent handling failed:', error.message);
      // Continue anyway - don't let cookie handling block the capture
    }
  }

  async _processElement(element, elementIndex, totalElements) {
    const signature = this._createElementSignature(element);
    
    // Skip if we've already permanently failed this element
    if (this.failedElements.has(signature)) {
      console.log(`   ❌ Skipping permanently failed element: ${signature.substring(0, 60)}`);
      return false;
    }
    
    // Mark as processed regardless of outcome to avoid reprocessing
    this.processedElementSignatures.add(signature);
    
    console.log(`   📍 Element ${elementIndex + 1}/${totalElements}: ${element.type} - "${(element.text || '').substring(0, 50)}"`);
    
    // Ensure we're in the baseline state before interaction
    if (this.interactor.baselineState && this.totalInteractions > 0) {
      console.log(`   🔄 Restoring to baseline state before interaction...`);
      const restoreSuccess = await this.interactor.restoreToBaselineState();
      if (!restoreSuccess) {
        console.log(`   ⚠️ Failed to restore baseline state, attempting page refresh...`);
        await this._refreshAndRediscoverBaseline();
      }
      await this.page.waitForTimeout(500); // Brief pause for stability
    }
    
    // Attempt the interaction
    const interactionResult = await this.interactor.interactWithElement(element, this.totalInteractions);
    
    if (interactionResult && interactionResult.success) {
      console.log(`   ✅ Interaction successful`);
      this.totalInteractions++;
      return true;
    } else {
      console.log(`   ❌ Initial interaction failed, attempting recovery...`);
      return await this._handleFailedElement(element, elementIndex);
    }
  }

  async captureInteractiveContent() {
    console.log('🚀 Starting enhanced interactive content capture...');
    
    try {
      // Initialize environment
      await this.env.init();
      this.currentPageDomain = this.env.currentDomain;

      // Wait for complete page load
      console.log('⏳ Waiting for complete page load...');
      await this.waits.waitForCompletePageLoadWithValidation();

      // Handle cookie consent and overlays BEFORE taking screenshots or discovery
      console.log('🍪 Handling cookie consent and overlays...');
      await this._handleCookieConsentAndOverlays();

      // Take baseline screenshot
      console.log('📸 Taking baseline screenshot...');
      await this.screenshotter.takeScreenshotWithQualityCheck('00_baseline');

      // Capture initial baseline state
      console.log('📄 Capturing baseline state...');
      await this.interactor.captureBaselineState();

      console.log(`\n🔄 Starting discovery and interaction phase...`);
      console.log(`📊 Limits: ${this.options.maxInteractions} interactions, ${this.options.maxScreenshots} screenshots`);

      // Discover interactive elements
      const newElements = await this._discoverNewElements();
      
      if (newElements.length > 0) {
        const elementsToProcess = Math.min(
          newElements.length, 
          this.options.maxInteractions - this.totalInteractions,
          this.options.maxScreenshots - this.screenshotter.screenshots.length
        );

        console.log(`   🎯 Processing ${elementsToProcess} elements`);

        let successfulInteractions = 0;
        let failedInteractions = 0;

        for (let i = 0; i < elementsToProcess; i++) {
          if (!this._shouldContinueProcessing()) {
            console.log(`   🛑 Stopping: reached interaction or screenshot limit.`);
            break;
          }

          const element = newElements[i];
          const success = await this._processElement(element, i, elementsToProcess);
          
          if (success) {
            successfulInteractions++;
          } else {
            failedInteractions++;
          }
          
          // Brief pause between elements to ensure stability
          if (i < elementsToProcess - 1) {
            await this.page.waitForTimeout(300);
          }
        }
        
        console.log(`\n📊 Interaction Summary:`);
        console.log(`   ✅ Successful: ${successfulInteractions}`);
        console.log(`   ❌ Failed: ${failedInteractions}`);
        console.log(`   📸 Screenshots taken: ${this.screenshotter.screenshots.length}`);
        
      } else {
        console.log("   ⚠️ No new interactive elements found in the discovery phase.");
      }

      // Take final screenshot
      console.log('📸 Taking final screenshot...');
      await this.screenshotter.takeScreenshotWithQualityCheck('99_final');

      console.log(`\n🏁 Interaction phase complete.`);
      console.log(`   📊 Total interactions: ${this.totalInteractions}`);
      console.log(`   📸 Total screenshots before deduplication: ${this.screenshotter.screenshots.length}`);
      console.log(`   🔍 Unique elements processed: ${this.processedElementSignatures.size}`);

      // Compile results
      const results = {
        success: true,
        totalInteractions: this.totalInteractions,
        screenshots: this.screenshotter.screenshots,
        processedElements: this.processedElementSignatures.size,
        failedElements: this.failedElements.size,
        discoveredElements: this.discoveredElements.length,
        interactionHistory: Array.from(this.interactionHistory.entries()),
        deduplicationReport: this.deduplicationReport
      };

      console.log('✅ Enhanced interactive content capture completed successfully');
      return results;

    } catch (error) {
      console.error('❌ Error during interactive content capture:', error);
      
      // Try to take an error screenshot if possible
      try {
        await this.screenshotter.takeScreenshotWithQualityCheck('error_state', { force: true });
      } catch (screenshotError) {
        console.error('❌ Could not take error screenshot:', screenshotError.message);
      }
      
      throw error;
    }
  }

  // Add the missing getCaptureReport method
  getCaptureReport() {
    return {
      totalInteractions: this.totalInteractions,
      totalScreenshots: this.screenshotter.screenshots.length,
      uniqueElementsProcessed: this.processedElementSignatures.size,
      failedElements: this.failedElements.size,
      discoveredElements: this.discoveredElements.length,
      deduplicationReport: this.deduplicationReport,
      interactionHistory: Array.from(this.interactionHistory.entries())
    };
  }
}

module.exports = { InteractiveContentCapture };