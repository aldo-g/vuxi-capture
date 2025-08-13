'use strict';

class PageWaits {
  constructor(page, validator) {
    this.page = page;
    this.validator = validator;
  }

  async waitForCompletePageLoad() {
    try {
      await this.page.waitForLoadState('networkidle', { timeout: 10000 });
      await this.page.waitForLoadState('domcontentloaded', { timeout: 5000 });
      await this.validator.waitForImages();
      await this.waitForFonts();
      await this.waitForAnimations();
      await this.validator.triggerLazyLoading();
      await this.waitForPageStability();
    } catch (_) { /* best effort */ }
  }

  async waitForCompletePageLoadWithValidation() {
    await this.waitForCompletePageLoad();
    return await this.validator.validateContentLoaded();
  }

  async waitForFonts() {
    return await this.page.evaluate(async () => {
      if (document.fonts) { try { await document.fonts.ready; } catch (_) {} }
    });
  }

  async waitForAnimations() {
    await this.page.evaluate(async () => {
      const els = Array.from(document.querySelectorAll('*')).filter(el => {
        const s = getComputedStyle(el);
        return s.animationName !== 'none' || s.transitionProperty !== 'none';
      });
      if (!els.length) return;
      await Promise.race([
        Promise.all(els.map(el => new Promise(res => {
          const done = () => { el.removeEventListener('animationend', done); el.removeEventListener('transitionend', done); res(); };
          el.addEventListener('animationend', done, { once: true });
          el.addEventListener('transitionend', done, { once: true });
          setTimeout(res, 3000);
        }))),
        new Promise(res => setTimeout(res, 3000))
      ]);
    });
    await this.page.waitForTimeout(200);
  }

  async waitForPageStability() {
    let prev = ''; let stable = 0;
    for (let i = 0; i < 10; i++) {
      const sig = await this.page.evaluate(() => {
        const vis = Array.from(document.querySelectorAll('*')).filter(el => {
          const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0;
        });
        return vis.length + '_' + document.body.textContent.length;
      });
      if (sig === prev) { stable++; if (stable >= 3) break; } else { stable = 0; }
      prev = sig;
      await this.page.waitForTimeout(300);
    }
  }
}

module.exports = { PageWaits };