'use strict';

class InteractionEngine {
  constructor({ page, options, env, waits, changes, screenshotter, interactionHistoryRef }) {
    this.page = page;
    this.options = options;
    this.env = env;
    this.waits = waits;
    this.changes = changes;
    // this.regions = regions; // No longer needed
    this.screenshotter = screenshotter;
    this.interactionHistory = interactionHistoryRef;
    this.baselineState = null;
  }

  // Capture the baseline state of the page for restoration
  async captureBaselineState() {
    console.log('📄 Capturing baseline page state...');
    this.baselineState = await this.page.evaluate(() => {
      return {
        url: window.location.href,
        scrollPosition: { x: window.scrollX, y: window.scrollY }
      };
    });
    await this.reapplyElementIdentifiers();
    console.log('✅ Baseline state captured');
  }

  // Re-apply the data-button-text attributes and other identifiers
  async reapplyElementIdentifiers() {
    await this.page.evaluate(() => {
      document.querySelectorAll('button').forEach(button => {
        const textContent = (button.textContent || '').trim();
        if (textContent) {
          const escapedText = textContent.replace(/[^\w\s]/g, '').toLowerCase();
          if (escapedText) {
            button.setAttribute('data-button-text', escapedText);
          }
        }
      });
    });
  }

  // Restore the page to its baseline state
  async restoreToBaselineState() {
    if (!this.baselineState) return false;
    try {
      const currentUrl = this.page.url();
      if (currentUrl !== this.baselineState.url) {
        console.log(`🔄 Navigating back to baseline URL: ${this.baselineState.url}`);
        await this.page.goto(this.baselineState.url, { waitUntil: 'networkidle' });
      } else {
         await this.page.evaluate(baseState => {
            window.scrollTo(baseState.scrollPosition.x, baseState.scrollPosition.y);
         }, this.baselineState);
      }
      await this.page.waitForTimeout(1000);
      await this.reapplyElementIdentifiers();
      return true;
    } catch (error) {
      console.log(`❌ Failed to restore baseline state: ${error.message}`);
      return false;
    }
  }

  async interactWithElement(elementData, index) {
    try {
      console.log(`🎯 Interacting with element ${index + 1}: ${elementData.type} - "${(elementData.text || '').substring(0, 50)}"`);

      // NEW: Simplified interaction logic
      const clickRes = await this.page.evaluate((selector) => {
        try {
          const el = document.querySelector(selector);
          if (!el) return { success: false, reason: 'Element not found' };
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return { success: false, reason: 'Element not visible' };
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(() => el.click(), 150); // Slightly increased delay for stability
          return { success: true };
        } catch (e) { return { success: false, reason: e.message }; }
      }, elementData.selector);

      if (!clickRes.success) {
        console.log(`   ❌ Interaction failed: ${clickRes.reason}`);
        return null;
      }

      this.interactionHistory.set(`interaction_${index + 1}`, {
        selector: elementData.selector,
        type: elementData.type,
        text: elementData.text
      });

      // Wait for the page to settle after the click
      await this.page.waitForTimeout(this.options.interactionDelay + 500);
      await this.waits.waitForAnimations();
      await this.waits.validator.waitForImages();

      // **THE FIX**: Always take a full-page screenshot after every interaction
      const safeLabel = (elementData.text || elementData.type).replace(/[^a-zA-Z0-9]/g, '_').substring(0, 20);
      await this.screenshotter.takeScreenshotWithQualityCheck(`interaction_${index + 1}_${safeLabel}`, {
          force: true, // Force the screenshot
          tags: [elementData.type]
      });

      // Restore the page to its original state to prepare for the next interaction
      console.log(`   🔄 Restoring to baseline state after interaction`);
      await this.restoreToBaselineState();

      return { success: true };

    } catch (error) {
      console.error(`❌ Error interacting with element ${index + 1}:`, error.message);
      await this.restoreToBaselineState();
      return null;
    }
  }
}

module.exports = { InteractionEngine };