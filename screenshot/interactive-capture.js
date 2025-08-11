class InteractiveContentCapture {
  constructor(page, options = {}) {
    this.page = page;
    this.options = {
      maxInteractions: options.maxInteractions || 50,
      maxScreenshots: options.maxScreenshots || 20,
      interactionDelay: options.interactionDelay || 800,
      changeDetectionTimeout: options.changeDetectionTimeout || 2000,
      scrollPauseTime: options.scrollPauseTime || 500,
      enableHoverCapture: options.enableHoverCapture || false,
      prioritizeNavigation: options.prioritizeNavigation !== false,
      skipSocialElements: options.skipSocialElements !== false,
      maxProcessingTime: options.maxProcessingTime || 120000,

      // Tab/section capture
      tabPostClickWait: options.tabPostClickWait || 1600,
      tabsFirst: options.tabsFirst !== false,
      forceScreenshotOnTabs: options.forceScreenshotOnTabs !== false,
      tabSectionAutoScroll: options.tabSectionAutoScroll !== false,
      tabSectionMinHeight: options.tabSectionMinHeight || 240,

      // Dedupe
      dedupeSimilarityThreshold: options.dedupeSimilarityThreshold || 99,

      // Overlay/unfinished content guardrails
      avoidOverlayScreenshots: options.avoidOverlayScreenshots !== false,
      overlayCoverageThreshold: options.overlayCoverageThreshold || 0.35,

      // Region capture sizing
      regionMinHeight: options.regionMinHeight || 420,
      regionMaxHeight: options.regionMaxHeight || 1400,
      regionPadding: options.regionPadding || 16,

      ...options
    };

    this.screenshots = [];
    this.interactionHistory = new Map();
    this.discoveredElements = [];
    this.deduplicationReport = null;
  }

  // ---------- validation ----------
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
      await this.attemptContentRecovery(validation.issues);
    }
    return validation;
  }

  async attemptContentRecovery(issues) {
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

  async waitForCompletePageLoadWithValidation() {
    await this.waitForCompletePageLoad();
    await this.validateContentLoaded();
  }

  async takeScreenshotWithQualityCheck(filename, { force = false, tags = [], clip = null } = {}) {
    try {
      if (!force) {
        const ok = await this.shouldTakeScreenshot();
        if (!ok) return null;
      }
      const options = clip ? { type: 'png', fullPage: false, clip } : { type: 'png', fullPage: true };
      const buffer = await this.page.screenshot(options);
      const data = { filename: `${filename}.png`, timestamp: new Date().toISOString(), size: buffer.length, buffer, tags };
      this.screenshots.push(data);
      console.log(`   📸 Screenshot saved: ${filename}.png${clip ? ' (region)' : ''}`);
      return data;
    } catch (e) {
      console.error(`Failed to take screenshot: ${e.message}`);
      return null;
    }
  }

  // ---------- discovery ----------
  async discoverInteractiveElements() {
    const elements = await this.page.evaluate((options) => {
      const out = [], seen = new Set();

      const getSelector = (el) => {
        if (el.id) return `#${CSS.escape(el.id)}`;
        if (el.className && typeof el.className === 'string') {
          const cls = el.className.trim().split(/\s+/).filter(c => c && /^[a-zA-Z_-]/.test(c)).slice(0, 2);
          if (cls.length) return `${el.tagName.toLowerCase()}.${cls.map(CSS.escape).join('.')}`;
        }
        const uid = 'interactive-' + Math.random().toString(36).slice(2, 10);
        el.setAttribute('data-interactive-id', uid);
        return `[data-interactive-id="${uid}"]`;
      };

      const interactive = (el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden' || s.pointerEvents === 'none') return false;
        return true;
      };

      const text = (el) => (el.textContent || el.innerText || '').trim().toLowerCase();

      const skip = (el, t) => {
        if (!options.skipSocialElements) return false;
        const p = ['facebook','twitter','instagram','linkedin','youtube','share','tweet','follow','subscribe','like','upvote','advertisement','sponsored','promo'];
        const html = el.outerHTML.toLowerCase();
        return p.some(s => t.includes(s) || html.includes(s));
      };

      const cats = [
        { name: 'tabs', priority: options.tabsFirst ? 98 : 85, selectors: ['[role="tab"]', '.tab', '.tab-button', '[data-tab]'], get: () => 'tab' },
        { name: 'explicit', priority: 96, selectors: ['button','input[type="submit"]','input[type="button"]','[role="button"]'], get: el => {
          const t = text(el);
          if (t.includes('submit') || t.includes('send')) return 'submit';
          if (t.includes('search')) return 'search';
          if (t.includes('next') || t.includes('continue')) return 'navigation';
          return 'button';
        }},
        { name: 'navigation', priority: 95, selectors: ['a[href]','nav a','[role="link"]'], get: el => el.closest('nav') ? 'nav-link' : (el.href && el.href.includes('#') ? 'anchor-link' : 'link') },
        { name: 'expandable', priority: 80, selectors: ['details','[aria-expanded]','.accordion','.collapsible','.expandable'], get: el => el.tagName === 'DETAILS' ? 'details' : (el.hasAttribute('aria-expanded') ? 'aria-expandable' : 'expandable') },
        { name: 'forms', priority: 75, selectors: ['input:not([type="hidden"])','select','textarea'], get: el => el.type || el.tagName.toLowerCase() },
        { name: 'modal-triggers', priority: 70, selectors: ['[data-toggle="modal"]','[data-modal]','.modal-trigger'], get: () => 'modal-trigger' },
        { name: 'interactive-generic', priority: 60, selectors: ['[onclick]','[onmouseover]','[data-action]'], get: el => el.hasAttribute('onclick') ? 'onclick' : (el.hasAttribute('onmouseover') ? 'hover' : 'data-action') }
      ];

      cats.forEach(c => c.selectors.forEach(sel => {
        try {
          document.querySelectorAll(sel).forEach(el => {
            if (!interactive(el)) return;
            const t = text(el);
            if (skip(el, t)) return;
            const id = el.outerHTML;
            if (seen.has(id)) return;
            seen.add(id);
            out.push({
              selector: getSelector(el),
              type: c.name,
              subtype: c.get(el),
              text: t.substring(0, 100),
              priority: c.priority
            });
          });
        } catch {}
      }));

      return out.sort((a, b) => b.priority - a.priority).slice(0, options.maxInteractions);
    }, this.options);

    this.discoveredElements = elements;
    console.log(`🎯 Discovered ${elements.length} interactive elements`);
  }

  // ---------- change detection ----------
  async detectContentChanges(beforeState, elementData) {
    const url = await this.page.url();
    const selectedElementCount = await this.page.evaluate(() =>
      document.querySelectorAll('[aria-selected="true"], .active, .selected, [class*="active"], [class*="selected"]').length
    );
    const hiddenElementCount = await this.page.evaluate(() =>
      document.querySelectorAll('[style*="display: none"], [style*="visibility: hidden"]').length
    );
    const mainContentLength = await this.page.evaluate(() => {
      const main = document.querySelector('main, [role="main"], .main-content, #main, .content');
      return main ? main.textContent.length : 0;
    });
    const modalCount = await this.page.evaluate(() =>
      document.querySelectorAll('[role="dialog"], .modal, .overlay, .popup').length
    );
    const activeTabText = (elementData && (elementData.type === 'tabs' || elementData.isTabLike))
      ? await this.page.evaluate(() => {
          const t = document.querySelector('[role="tab"][aria-selected="true"], .tab.active, .tab.selected, .tab-button.active, [aria-pressed="true"], [data-state="active"]');
          return t ? (t.textContent || '').trim().toLowerCase() : '';
        })
      : '';

    const payload = { beforeState: { ...beforeState, url, selectedElementCount, hiddenElementCount, mainContentLength, modalCount, activeTabText } };

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

  // ---------- tab/anchor helpers ----------
  async waitForTabActivation(elementData) {
    if (!elementData) return;
    try {
      await this.page.waitForFunction((selector) => {
        const el = document.querySelector(selector);
        if (!el) return false;
        const t = (el.textContent || '').trim().toLowerCase();
        const selected =
          (el.getAttribute && (el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-pressed') === 'true' || el.getAttribute('data-state') === 'active')) ||
          /(^|\s)(active|selected)(\s|$)/i.test(el.className || '');
        const active = document.querySelector('[role="tab"][aria-selected="true"], .tab.active, .tab.selected, .tab-button.active, [aria-pressed="true"], [data-state="active"]');
        const activeText = active ? (active.textContent || '').trim().toLowerCase() : '';
        return selected || (activeText && activeText === t);
      }, elementData.selector, { timeout: this.options.changeDetectionTimeout });
    } catch {}
  }

  async getAnchorTargetInfo(elementData) {
    return await this.page.evaluate((selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      let id = null;
      const href = el.getAttribute('href') || '';
      if (href.startsWith('#') && href.length > 1) id = href.slice(1);
      if (!id) id = el.getAttribute('data-target') || el.getAttribute('aria-controls') || null;
      if (!id) return null;
      const target = document.getElementById(id) || document.querySelector(`[name="${id}"]`) || document.querySelector(`#${CSS.escape(id)}`);
      if (!target) return { id, y: null, rect: null };
      const r = target.getBoundingClientRect();
      return {
        id,
        y: Math.max(0, r.top + window.scrollY),
        rect: { x: Math.max(0, r.left + window.scrollX), y: Math.max(0, r.top + window.scrollY), width: r.width, height: r.height }
      };
    }, elementData.selector);
  }

  async getTabPanelRect(elementData) {
    return await this.page.evaluate((selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      let panel = null;
      const ctrl = el.getAttribute('aria-controls');
      if (ctrl) panel = document.getElementById(ctrl);
      if (!panel) {
        const candidates = Array.from(document.querySelectorAll('[role="tabpanel"]')).filter(n => {
          const s = getComputedStyle(n), r = n.getBoundingClientRect();
          return s.display !== 'none' && s.visibility !== 'hidden' && r.height > 160 && r.width > 200;
        });
        panel = candidates[0] || null;
      }
      if (!panel) {
        // fallback: sizeable sibling below the tab group
        let node = el.closest('section, article, main, div') || el.parentElement;
        for (let i = 0; i < 5 && node; i++) {
          let sib = node.nextElementSibling;
          while (sib) {
            const s = getComputedStyle(sib); const r = sib.getBoundingClientRect();
            if (s.display !== 'none' && s.visibility !== 'hidden' && r.height > 160 && r.width > 200) { panel = sib; break; }
            sib = sib.nextElementSibling;
          }
          if (panel) break;
          node = node.parentElement;
        }
      }
      if (!panel) return null;
      const r = panel.getBoundingClientRect();
      return { x: Math.max(0, r.left + window.scrollX), y: Math.max(0, r.top + window.scrollY), width: r.width, height: r.height };
    }, elementData.selector);
  }

  async screenshotSectionRect(name, rect, extraTags = []) {
    if (!rect) return null;
    const viewport = await this.page.viewportSize();
    const pad = this.options.regionPadding;
    const clip = {
      x: Math.max(0, Math.floor(rect.x) - pad),
      y: Math.max(0, Math.floor(rect.y) - pad),
      width: Math.floor(Math.min(viewport.width, rect.width + pad * 2)),
      height: Math.floor(Math.min(this.options.regionMaxHeight, Math.max(this.options.regionMinHeight, rect.height + pad * 2)))
    };
    return await this.takeScreenshotWithQualityCheck(name, { force: true, clip, tags: extraTags });
  }

  // ---------- interaction engine ----------
  async interactWithElement(elementData, index) {
    try {
      console.log(`🎯 Interacting with element ${index + 1}/${this.discoveredElements.length}: ${elementData.type} - "${elementData.text.substring(0, 50)}"`);

      // classify tab-like
      const isTabLike = await this.page.evaluate((selector) => {
        const el = document.querySelector(selector);
        if (!el) return false;
        const group = el.closest('[role="tablist"], .tabs, .tablist, [data-tabgroup], .btn-group, .button-group');
        const siblings = group ? group.querySelectorAll('button, [role="tab"], a[role="tab"]').length : 0;
        const toggly = el.hasAttribute('aria-pressed') || el.getAttribute('data-state') === 'active';
        return !!group || siblings >= 2 || toggly;
      }, elementData.selector);
      elementData.isTabLike = elementData.type === 'tabs' || isTabLike;

      const beforeState = await this.page.evaluate(() => ({
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

      // click
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

      await this.page.waitForTimeout(this.options.interactionDelay);

      // type-specific waits
      if (elementData.isTabLike) {
        await this.waitForTabActivation(elementData);
        await this.page.waitForTimeout(this.options.tabPostClickWait);
      }
      await this.waitForImages();
      await this.waitForAnimations();

      // detect anchor/tabpanel and region capture first (this avoids dedupe problems)
      let regionShot = null;

      // 1) anchor/section target by id
      const anchorInfo = await this.getAnchorTargetInfo(elementData);
      if (anchorInfo && anchorInfo.rect) {
        regionShot = await this.screenshotSectionRect(`interaction_${index + 1}_anchor_${anchorInfo.id}`, anchorInfo.rect, ['anchor']);
      }

      // 2) tab panel rect
      if (!regionShot && elementData.isTabLike) {
        const panelRect = await this.getTabPanelRect(elementData);
        if (panelRect) {
          regionShot = await this.screenshotSectionRect(`interaction_${index + 1}_tabpanel`, panelRect, ['tabs','tabpanel']);
        }
      }

      // 3) fall back to full-page if no region panel/anchor found
      const changes = await this.detectContentChanges(beforeState, elementData);
      const forceTabShot = (elementData.isTabLike && this.options.forceScreenshotOnTabs);
      if (!regionShot && (changes.significantChange || forceTabShot)) {
        const label = elementData.text ? elementData.text.substring(0, 15) : elementData.type;
        const safe = label.replace(/[^a-zA-Z0-9]/g, '_') || elementData.type;
        await this.takeScreenshotWithQualityCheck(`interaction_${index + 1}_${safe}`, { force: forceTabShot, tags: [elementData.isTabLike ? 'tabs' : elementData.type] });
      }

      return true;
    } catch (e) {
      console.log(`   ❌ Error interacting with element: ${e.message}`);
      return null;
    }
  }

  // ---------- page-load helpers ----------
  async waitForCompletePageLoad() {
    try {
      await this.page.waitForLoadState('networkidle', { timeout: 10000 });
      await this.page.waitForLoadState('domcontentloaded', { timeout: 5000 });
      await this.waitForImages();
      await this.waitForFonts();
      await this.waitForAnimations();
      await this.triggerLazyLoading();
      await this.waitForPageStability();
    } catch {}
  }

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

  async waitForFonts() {
    return await this.page.evaluate(async () => {
      if (document.fonts) { try { await document.fonts.ready; } catch {} }
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

  // ---------- main ----------
  async captureInteractiveContent() {
    console.log('🚀 Starting interactive content capture...');
    try {
      await this.waitForCompletePageLoadWithValidation();

      await this.takeScreenshotWithQualityCheck('00_baseline');

      await this.discoverInteractiveElements();
      if (!this.discoveredElements.length) return this.screenshots;

      const max = Math.min(this.discoveredElements.length, this.options.maxInteractions);
      for (let i = 0; i < max; i++) {
        if (this.screenshots.length >= this.options.maxScreenshots) break;
        await this.interactWithElement(this.discoveredElements[i], i);
        if (i < max - 1) await this.page.waitForTimeout(200);
      }

      if (this.screenshots.length < 3) await this.takeScreenshotWithQualityCheck('99_final');

      // DEDUPE — always keep anchor/tab-panel shots
      const { ImageDeduplicationService } = require('./image-deduplication');
      const dd = new ImageDeduplicationService({
        similarityThreshold: this.options.dedupeSimilarityThreshold,
        keepHighestQuality: true,
        preserveFirst: true,
        verbose: true
      });
      let unique = await dd.processScreenshots(this.screenshots);
      const keepTags = new Set(['anchor', 'tabpanel', 'tabs']);
      const names = new Set(unique.map(u => u.filename));
      this.screenshots.forEach(s => {
        const tags = new Set(s.tags || []);
        if ([...tags].some(t => keepTags.has(t)) && !names.has(s.filename)) {
          unique.push(s);
          names.add(s.filename);
        }
      });
      this.screenshots = unique;
      this.deduplicationReport = dd.getDeduplicationReport();

      console.log(`🎉 Final: ${this.screenshots.length} unique screenshots`);
      return this.screenshots;
    } catch (e) {
      console.error(`❌ Interactive capture failed: ${e.message}`);
      return this.screenshots;
    }
  }

  // ---------- report ----------
  getCaptureReport() {
    const r = {
      totalScreenshots: this.screenshots.length,
      deduplication: this.deduplicationReport || null
    };
    return r;
  }
}

module.exports = { InteractiveContentCapture };