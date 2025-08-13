'use strict';

class InteractionEngine {
  constructor({ page, options, env, waits, changes, regions, screenshotter, interactionHistoryRef }) {
    this.page = page;
    this.options = options;
    this.env = env;
    this.waits = waits;
    this.changes = changes;
    this.regions = regions;
    this.screenshotter = screenshotter;
    this.interactionHistory = interactionHistoryRef; // Map shared with orchestrator
  }

  async interactWithElement(elementData, index) {
    try {
      console.log(`🎯 Interacting with element ${index + 1}: ${elementData.type} - "${(elementData.text || '').substring(0, 50)}"`);

      if (elementData.type === 'navigation' && elementData.selector) {
        const isExternal = await this.env.isExternalLink(elementData.selector);
        if (isExternal) {
          console.log(`🚫 Skipping external link interaction: ${elementData.selector}`);
          return null;
        }
      }

      const isTabLike = await this.page.evaluate((selector) => {
        const el = document.querySelector(selector);
        if (!el) return false;
        const group = el.closest('[role="tablist"], .tabs, .tablist, [data-tabgroup], .btn-group, .button-group');
        const siblings = group ? group.querySelectorAll('button, [role="tab"], a[role="tab"]').length : 0;
        const toggly = el.hasAttribute('aria-pressed') || el.getAttribute('data-state') === 'active';
        return !!group || siblings >= 2 || toggly;
      }, elementData.selector);
      elementData.isTabLike = elementData.type === 'tabs' || isTabLike;

      const beforeState = await this.changes.snapshotBeforeState();

      const clickRes = await this.page.evaluate((selector) => {
        try {
          const el = document.querySelector(selector);
          if (!el) return { success: false, reason: 'Element not found' };
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return { success: false, reason: 'Element not visible' };
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(() => el.click(), 100);
          return { success: true };
        } catch (e) { return { success: false, reason: e.message }; }
      }, elementData.selector);
      if (!clickRes.success) { console.log(`   ❌ Interaction failed: ${clickRes.reason}`); return null; }

      this.interactionHistory.set(`interaction_${index + 1}`, { selector: elementData.selector, type: elementData.type, text: elementData.text });

      await this.page.waitForTimeout(this.options.interactionDelay);

      if (elementData.isTabLike) {
        await this.regions.waitForTabActivation(elementData, this.options.changeDetectionTimeout);
        await this.page.waitForTimeout(this.options.tabPostClickWait);
      }
      await this.waits.validator.waitForImages();
      await this.waits.waitForAnimations();

      let regionShot = null;
      const anchorInfo = await this.regions.getAnchorTargetInfo(elementData.selector);
      if (anchorInfo && anchorInfo.rect) {
        regionShot = await this._screenshotSectionRect(`interaction_${index + 1}_anchor_${anchorInfo.id}`, anchorInfo.rect, ['anchor']);
      }

      if (!regionShot && elementData.isTabLike) {
        const panelRect = await this.regions.getTabPanelRect(elementData.selector);
        if (panelRect) {
          regionShot = await this._screenshotSectionRect(`interaction_${index + 1}_tabpanel`, panelRect, ['tabs','tabpanel']);
        }
      }

      const changes = await this.changes.detectContentChanges(beforeState, elementData);
      const forceTabShot = (elementData.isTabLike && this.options.forceScreenshotOnTabs);
      if (!regionShot && (changes.significantChange || forceTabShot)) {
        const label = elementData.text ? elementData.text.substring(0, 15) : elementData.type;
        const safe = label.replace(/[^a-zA-Z0-9]/g, '_') || elementData.type;
        await this.screenshotter.takeScreenshotWithQualityCheck(`interaction_${index + 1}_${safe}`, { force: forceTabShot, tags: [elementData.isTabLike ? 'tabs' : elementData.type] });
      }

      return true;
    } catch (e) {
      console.log(`   ❌ Error interacting with element: ${e.message}`);
      return null;
    }
  }

  async _screenshotSectionRect(name, rect, extraTags = []) {
    if (!rect) return null;
    const viewport = await this.page.viewportSize();
    const pad = this.options.regionPadding;
    const clip = {
      x: Math.max(0, Math.floor(rect.x) - pad),
      y: Math.max(0, Math.floor(rect.y) - pad),
      width: Math.floor(Math.min(viewport.width, rect.width + pad * 2)),
      height: Math.floor(Math.min(this.options.regionMaxHeight, Math.max(this.options.regionMinHeight, rect.height + pad * 2)))
    };
    return await this.screenshotter.takeScreenshotWithQualityCheck(name, { force: true, clip, tags: extraTags });
  }
}

module.exports = { InteractionEngine };
