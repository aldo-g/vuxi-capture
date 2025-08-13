'use strict';

class PageValidator {
  constructor(page, options) {
    this.page = page;
    this.options = options;
  }

  async validateContentLoaded() {
    const validation = await this.page.evaluate(() => {
      const issues = [];
      const images = Array.from(document.querySelectorAll('img'));
      const unloadedImages = images.filter(i => !i.complete || i.naturalWidth === 0 || i.naturalHeight === 0);
      if (unloadedImages.length) issues.push({ type: 'unloaded_images', count: unloadedImages.length });

      const loading = document.querySelectorAll(
        '[class*="loading"], [class*="skeleton"], [class*="placeholder"], [class*="spinner"], [data-loading], .loading, .skeleton, .placeholder'
      );
      if (loading.length) issues.push({ type: 'loading_placeholders', count: loading.length });

      const areas = document.querySelectorAll('main, [role="main"], .content, .main-content, article, section');
      const empties = Array.from(areas).filter(a => a.textContent.trim().length < 50 && a.querySelectorAll('img,video').length === 0);
      if (empties.length) issues.push({ type: 'empty_content_areas', count: empties.length });

      const errors = document.querySelectorAll('[class*="error"], [class*="failed"], [class*="404"], .error, .failed, .not-found, [data-error]');
      if (errors.length) issues.push({ type: 'error_elements', count: errors.length });

      const lazy = document.querySelectorAll('[data-lazy], [loading="lazy"], [class*="lazy"]');
      if (lazy.length) issues.push({ type: 'lazy_elements', count: lazy.length });

      return {
        isValid: issues.length === 0,
        issues,
        stats: {
          totalImages: images.length,
          loadedImages: images.length - unloadedImages.length
        }
      };
    });

    if (!validation.isValid) {
      await this._attemptContentRecovery(validation.issues);
    }
    return validation;
  }

  async _attemptContentRecovery(issues) {
    for (const issue of issues) {
      if (issue.type === 'unloaded_images') {
        await this.page.evaluate(() => {
          const bad = Array.from(document.querySelectorAll('img')).filter(i => !i.complete || i.naturalWidth === 0);
          bad.forEach(img => { const s = img.src; if (s) { img.src = ''; setTimeout(() => (img.src = s), 100); } });
        });
        await this.page.waitForTimeout(2000);
        await this.waitForImages();
      } else if (issue.type === 'loading_placeholders' || issue.type === 'lazy_elements') {
        await this.triggerLazyLoading();
      }
    }
  }

  async shouldTakeScreenshot() {
    const { score } = await this.page.evaluate((opts) => {
      let score = 100;

      const imgs = Array.from(document.querySelectorAll('img'));
      const unloaded = imgs.filter(i => !i.complete || i.naturalWidth === 0 || i.naturalHeight === 0);
      if (imgs.length > 3 && (imgs.length - unloaded.length) / imgs.length < 0.8) score -= 30;

      const loading = document.querySelectorAll('[class*="loading"], [class*="skeleton"], [class*="spinner"], [data-loading="true"], .loading, .skeleton');
      if (loading.length) score -= 20;

      if (opts.avoidOverlayScreenshots) {
        const nodes = Array.from(document.querySelectorAll('body *'));
        let covered = 0;
        const vw = innerWidth, vh = innerHeight, viewport = vw * vh;
        for (const el of nodes) {
          const s = getComputedStyle(el);
          if (!s || s.visibility === 'hidden' || s.display === 'none' || s.opacity === '0') continue;
          const pos = s.position;
          if (!(pos === 'fixed' || pos === 'absolute' || pos === 'sticky')) continue;
          const r = el.getBoundingClientRect();
          if (r.width < vw * 0.4 || r.height < vh * 0.3) continue;
          const z = Number(s.zIndex || 0);
          if (z < 10) continue;
          const backdrop = s.backdropFilter !== 'none' || /overlay|backdrop|modal|drawer/i.test(el.className || '') ||
                           (s.backgroundColor && s.backgroundColor !== 'rgba(0, 0, 0, 0)');
          if (!backdrop) continue;
          covered += Math.min(r.width, vw) * Math.min(r.height, vh);
        }
        if (covered / viewport > opts.overlayCoverageThreshold) score -= 60;
      }

      if (document.body.textContent.trim().length < 100) score -= 25;

      const visible = Array.from(document.querySelectorAll('*')).filter(el => {
        const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
      });
      if (visible.length < 10) score -= 50;

      return { score };
    }, { avoidOverlayScreenshots: this.options.avoidOverlayScreenshots, overlayCoverageThreshold: this.options.overlayCoverageThreshold });

    return score >= 70;
  }

  // lightweight delegates used by Waits as fallbacks
  async waitForImages() {
    return await this.page.evaluate(async () => {
      const imgs = Array.from(document.querySelectorAll('img'));
      if (!imgs.length) return;
      await Promise.all(imgs.map(img => new Promise(res => {
        if (img.complete) return res();
        img.addEventListener('load', res, { once: true });
        img.addEventListener('error', res, { once: true });
        setTimeout(res, 5000);
      })));
    });
  }

  async triggerLazyLoading() {
    const pageHeight = await this.page.evaluate(() => document.body.scrollHeight);
    const vh = await this.page.evaluate(() => window.innerHeight);
    let y = 0, step = Math.floor(vh * 0.8);
    while (y < pageHeight) {
      await this.page.evaluate((yy) => window.scrollTo(0, yy), y);
      await this.page.waitForTimeout(250);
      y += step;
    }
    await this.page.evaluate(() => window.scrollTo(0, 0));
    await this.page.waitForTimeout(300);
    await this.waitForImages();
  }
}

module.exports = { PageValidator };