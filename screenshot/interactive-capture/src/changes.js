'use strict';

class ChangeDetector {
  constructor(page, options) {
    this.page = page;
    this.options = options;
  }

  async snapshotBeforeState() {
    return await this.page.evaluate(() => ({
      domHash: document.documentElement.innerHTML.length,
      visibleElementCount: Array.from(document.querySelectorAll('*')).filter(el => {
        const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0;
      }).length,
      imageCount: document.querySelectorAll('img').length,
      textLength: document.body.textContent.length,
      scrollY: window.scrollY,
      selectedElementCount: document.querySelectorAll('[aria-selected="true"], .active, .selected, [class*="active"], [class*="selected"]').length,
      hiddenElementCount: document.querySelectorAll('[style*="display: none"], [style*="visibility: hidden"]').length,
      mainContentLength: (() => {
        const m = document.querySelector('main, [role="main"], .main-content, #main, .content');
        return m ? m.textContent.length : 0;
      })(),
      modalCount: document.querySelectorAll('[role="dialog"], .modal, .overlay, .popup').length
    }));
  }

  async detectContentChanges(beforeState, elementData) {
    const url = await this.page.url();
    const payload = { beforeState: { ...beforeState, url } };

    return await this.page.evaluate(({ beforeState }) => {
      const ch = { significantChange: false, domChanged: false, textChanged: false, urlChanged: false, activeElementChanged: false, visibilityChanged: false, styleChanges: false, newImages: [], selectedTabChanged: false };

      if (location.href !== beforeState.url) { ch.urlChanged = true; ch.significantChange = true; }

      const domHash = document.documentElement.innerHTML.length;
      if (Math.abs(domHash - beforeState.domHash) > 50) { ch.domChanged = true; ch.significantChange = true; }

      const visible = Array.from(document.querySelectorAll('*')).filter(el => {
        const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
      });
      if (Math.abs(visible.length - beforeState.visibleElementCount) > 2) { ch.visibilityChanged = true; ch.significantChange = true; }

      const sel = document.querySelectorAll('[aria-selected="true"], .active, .selected, [class*="active"], [class*="selected"]');
      if (sel.length !== beforeState.selectedElementCount) { ch.activeElementChanged = true; ch.significantChange = true; }

      const imgs = document.querySelectorAll('img');
      if (imgs.length > beforeState.imageCount) { ch.newImages = Array.from(imgs).slice(beforeState.imageCount); ch.significantChange = true; }

      const txt = document.body.textContent.length;
      if (Math.abs(txt - beforeState.textLength) > 50) { ch.textChanged = true; ch.significantChange = true; }

      const hidden = document.querySelectorAll('[style*="display: none"], [style*="visibility: hidden"]');
      if (Math.abs(hidden.length - beforeState.hiddenElementCount) > 1) { ch.styleChanges = true; ch.significantChange = true; }

      const main = document.querySelector('main, [role="main"], .main-content, #main, .content');
      if (main) {
        const m = main.textContent.length;
        if (Math.abs(m - (beforeState.mainContentLength || 0)) > 100) { ch.textChanged = true; ch.significantChange = true; }
      }

      return ch;
    }, payload);
  }
}

module.exports = { ChangeDetector };
