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

      // TAB CAPTURE
      tabPostClickWait: options.tabPostClickWait || 1600,
      tabsFirst: options.tabsFirst !== false,
      forceScreenshotOnTabs: options.forceScreenshotOnTabs !== false,
      tabSectionAutoScroll: options.tabSectionAutoScroll !== false,
      tabSectionMinHeight: options.tabSectionMinHeight || 240,

      // DEDUP
      dedupeSimilarityThreshold: options.dedupeSimilarityThreshold || 99,

      // OVERLAY/INCOMPLETE CONTENT GUARDRAILS
      avoidOverlayScreenshots: options.avoidOverlayScreenshots !== false,
      overlayCoverageThreshold: options.overlayCoverageThreshold || 0.35, // 35% of viewport

      ...options
    };

    this.screenshots = [];
    this.interactionHistory = new Map();
    this.discoveredElements = [];
    this.pageState = {
      domHash: null,
      activeElements: new Set(),
      expandedElements: new Set(),
      visitedModals: new Set()
    };
  }

  // ====== ENHANCED CONTENT VALIDATION ======

  async validateContentLoaded() {
    console.log('🔍 Validating content is fully loaded...');

    const validation = await this.page.evaluate(() => {
      const issues = [];

      // 1) unloaded <img>
      const images = Array.from(document.querySelectorAll('img'));
      const unloadedImages = images.filter(img => !img.complete || img.naturalWidth === 0 || img.naturalHeight === 0);
      if (unloadedImages.length > 0) {
        issues.push({
          type: 'unloaded_images',
          count: unloadedImages.length,
          selectors: unloadedImages.map(img => img.src || img.outerHTML.substring(0, 100)).slice(0, 5)
        });
      }

      // 2) skeletons/placeholders
      const loadingElements = document.querySelectorAll(
        '[class*="loading"], [class*="skeleton"], [class*="placeholder"], [class*="spinner"], [data-loading], .loading, .skeleton, .placeholder'
      );
      if (loadingElements.length > 0) {
        issues.push({
          type: 'loading_placeholders',
          count: loadingElements.length,
          elements: Array.from(loadingElements).map(el => el.className || el.tagName).slice(0, 5)
        });
      }

      // 3) empty content areas
      const contentAreas = document.querySelectorAll('main, [role="main"], .content, .main-content, article, section');
      const emptyContentAreas = Array.from(contentAreas).filter(area => {
        const text = area.textContent.trim();
        const cntImgs = area.querySelectorAll('img').length;
        const cntVids = area.querySelectorAll('video').length;
        return text.length < 50 && cntImgs === 0 && cntVids === 0;
      });
      if (emptyContentAreas.length > 0) {
        issues.push({ type: 'empty_content_areas', count: emptyContentAreas.length });
      }

      // 4) explicit errors
      const errorElements = document.querySelectorAll(
        '[class*="error"], [class*="failed"], [class*="404"], .error, .failed, .not-found, [data-error]'
      );
      if (errorElements.length > 0) {
        issues.push({
          type: 'error_elements',
          count: errorElements.length,
          messages: Array.from(errorElements).map(el => el.textContent.trim()).slice(0, 3)
        });
      }

      // 5) lazy hints
      const lazyElements = document.querySelectorAll('[data-lazy], [loading="lazy"], [class*="lazy"]');
      if (lazyElements.length > 0) {
        issues.push({ type: 'lazy_elements', count: lazyElements.length });
      }

      return {
        isValid: issues.length === 0,
        issues,
        stats: {
          totalImages: images.length,
          loadedImages: images.length - unloadedImages.length,
          contentAreas: contentAreas.length,
          totalElements: document.querySelectorAll('*').length
        }
      };
    });

    if (!validation.isValid) {
      console.log('⚠️  Content validation issues found:', validation.issues);
      await this.attemptContentRecovery(validation.issues);
      const revalidation = await this.page.evaluate(() => {
        const images = Array.from(document.querySelectorAll('img'));
        const unloadedImages = images.filter(img => !img.complete || img.naturalWidth === 0);
        return { remainingIssues: unloadedImages.length, totalImages: images.length };
      });
      console.log(`🔍 After recovery: ${revalidation.remainingIssues}/${revalidation.totalImages} images still unloaded`);
    } else {
      console.log('✅ Content validation passed');
    }

    return validation;
  }

  async attemptContentRecovery(issues) {
    console.log('🔧 Attempting content recovery...');
    for (const issue of issues) {
      switch (issue.type) {
        case 'unloaded_images':
          console.log(`   🖼️  Attempting to reload ${issue.count} images...`);
          await this.page.evaluate(() => {
            const unloaded = Array.from(document.querySelectorAll('img')).filter(img => !img.complete || img.naturalWidth === 0);
            unloaded.forEach(img => {
              const src = img.src;
              if (src) {
                img.src = '';
                setTimeout(() => (img.src = src), 100);
              }
            });
          });
          await this.page.waitForTimeout(2000);
          await this.waitForImages();
          break;

        case 'loading_placeholders':
          console.log('   ⏳ Waiting longer for loading placeholders...');
          await this.page.waitForTimeout(3000);
          break;

        case 'lazy_elements':
          console.log('   🔄 Re-triggering lazy loading...');
          await this.triggerLazyLoading();
          break;
      }
    }
  }

  async shouldTakeScreenshot() {
    const { score, issues } = await this.page.evaluate((opts) => {
      const metrics = { score: 100, issues: [] };

      // Image loading ratio
      const images = Array.from(document.querySelectorAll('img'));
      const unloaded = images.filter(img => !img.complete || img.naturalWidth === 0 || img.naturalHeight === 0);
      const ratio = images.length > 0 ? (images.length - unloaded.length) / images.length : 1;
      if (ratio < 0.8 && images.length > 3) {
        metrics.score -= 30;
        metrics.issues.push(`${unloaded.length}/${images.length} images not loaded`);
      }

      // Loading/skeletons visible
      const loading = document.querySelectorAll('[class*="loading"], [class*="skeleton"], [class*="spinner"], [data-loading="true"], .loading, .skeleton');
      if (loading.length > 0) {
        metrics.score -= 20;
        metrics.issues.push(`${loading.length} loading placeholders visible`);
      }

      // Overlay/backdrop coverage (avoid interim states)
      if (opts.avoidOverlayScreenshots) {
        const nodes = Array.from(document.querySelectorAll('body *'));
        let area = 0;
        const vw = window.innerWidth, vh = window.innerHeight;
        const viewport = vw * vh;

        for (const el of nodes) {
          const s = getComputedStyle(el);
          if (!s) continue;
          if (s.visibility === 'hidden' || s.display === 'none' || s.opacity === '0') continue;
          const pos = s.position;
          if (!(pos === 'fixed' || pos === 'absolute' || pos === 'sticky')) continue;
          const r = el.getBoundingClientRect();
          if (r.width < vw * 0.4 || r.height < vh * 0.3) continue;
          const z = parseFloat(s.zIndex || '0');
          if (z < 10) continue;
          const hasBackdrop =
            s.backdropFilter !== 'none' ||
            /overlay|backdrop|modal|drawer/i.test(el.className || '') ||
            (s.backgroundColor && s.backgroundColor !== 'rgba(0, 0, 0, 0)');
          if (!hasBackdrop) continue;

          area += Math.max(0, Math.min(r.width, vw) * Math.min(r.height, vh));
        }

        const coverage = area / viewport;
        if (coverage > opts.overlayCoverageThreshold) {
          metrics.score -= 60;
          metrics.issues.push(`Overlay covers ${(coverage * 100).toFixed(0)}% viewport`);
        }
      }

      // Content density
      if (document.body.textContent.trim().length < 100) {
        metrics.score -= 25;
        metrics.issues.push('Low content density');
      }

      // Error states
      const errors = document.querySelectorAll('[class*="error"], [class*="404"], [class*="failed"], .error, .not-found');
      if (errors.length > 0) {
        metrics.score -= 40;
        metrics.issues.push('Error elements detected');
      }

      // Very few visible elements (likely blank)
      const visible = Array.from(document.querySelectorAll('*')).filter(el => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
      });
      if (visible.length < 10) {
        metrics.score -= 50;
        metrics.issues.push('Very few visible elements');
      }

      return metrics;
    }, { avoidOverlayScreenshots: this.options.avoidOverlayScreenshots, overlayCoverageThreshold: this.options.overlayCoverageThreshold });

    const shouldTake = score >= 70;
    if (!shouldTake) {
      console.log(`   ⚠️  Skipping screenshot - content quality score: ${score}/100`);
      console.log(`   Issues: ${issues.join(', ')}`);
    }
    return shouldTake;
  }

  // ====== LOAD / STABILITY ======

  async waitForCompletePageLoadWithValidation() {
    console.log('🔄 Ensuring complete page load with validation...');
    try {
      await this.waitForCompletePageLoad();
      const validation = await this.validateContentLoaded();
      if (!validation.isValid) {
        const critical = validation.issues.filter(i => i.type === 'unloaded_images' || i.type === 'empty_content_areas');
        if (critical.length > 0) {
          console.log('⚠️  Critical content issues detected, but proceeding with capture...');
        }
      }
      console.log('✅ Page fully loaded and validated');
    } catch (err) {
      console.log(`⚠️  Page load/validation timeout, continuing anyway: ${err.message}`);
    }
  }

  async takeScreenshotWithQualityCheck(filename, { force = false, tags = [] } = {}) {
    try {
      if (!force) {
        const ok = await this.shouldTakeScreenshot();
        if (!ok) {
          console.log(`   ⏭️  Skipping screenshot: ${filename} - content not ready`);
          return null;
        }
      }
      const buffer = await this.page.screenshot({ fullPage: true, type: 'png' });
      const data = { filename: `${filename}.png`, timestamp: new Date().toISOString(), size: buffer.length, buffer, tags };
      this.screenshots.push(data);
      console.log(`   📸 Screenshot saved: ${filename}.png`);
      return data;
    } catch (err) {
      console.error(`Failed to take screenshot: ${err.message}`);
      return null;
    }
  }

  // ====== DISCOVERY ======

  async discoverInteractiveElements() {
    const elements = await this.page.evaluate((options) => {
      const discovered = [];
      const seen = new Set();

      const getSelector = (el) => {
        if (el.id) return `#${CSS.escape(el.id)}`;
        if (el.className && typeof el.className === 'string') {
          const classes = el.className.trim().split(/\s+/).filter(c => c.length > 0 && /^[a-zA-Z_-]/.test(c)).slice(0, 2);
          if (classes.length > 0) {
            const esc = classes.map(c => CSS.escape(c)).join('.');
            return `${el.tagName.toLowerCase()}.${esc}`;
          }
        }
        const uid = 'interactive-' + Math.random().toString(36).slice(2, 11);
        el.setAttribute('data-interactive-id', uid);
        return `[data-interactive-id="${uid}"]`;
      };

      const isInteractive = (el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden' || s.pointerEvents === 'none') return false;
        return true;
      };

      const textOf = (el) => (el.textContent || el.innerText || '').trim().toLowerCase();

      const shouldSkip = (el, text) => {
        if (!options.skipSocialElements) return false;
        const patterns = ['facebook','twitter','instagram','linkedin','youtube','share','tweet','follow','subscribe','like','upvote','advertisement','sponsored','promo'];
        const html = el.outerHTML.toLowerCase();
        return patterns.some(p => text.includes(p) || html.includes(p));
      };

      const categories = [
        { // tabs first
          name: 'tabs',
          priority: options.tabsFirst ? 98 : 85,
          selectors: ['[role="tab"]', '.tab', '.tab-button', '[data-tab]'],
          getSubtype: () => 'tab'
        },
        {
          name: 'explicit',
          priority: 96,
          selectors: ['button', 'input[type="submit"]', 'input[type="button"]', '[role="button"]'],
          getSubtype: (el) => {
            const t = textOf(el);
            if (t.includes('submit') || t.includes('send')) return 'submit';
            if (t.includes('search')) return 'search';
            if (t.includes('next') || t.includes('continue')) return 'navigation';
            return 'button';
          }
        },
        {
          name: 'navigation',
          priority: 95,
          selectors: ['a[href]', 'nav a', '[role="link"]'],
          getSubtype: (el) => {
            if (el.closest('nav')) return 'nav-link';
            if (el.href && el.href.includes('#')) return 'anchor-link';
            return 'link';
          }
        },
        { name: 'expandable', priority: 80, selectors: ['details','[aria-expanded]','.accordion','.collapsible','.expandable'], getSubtype: (el) => el.tagName === 'DETAILS' ? 'details' : (el.hasAttribute('aria-expanded') ? 'aria-expandable' : 'expandable') },
        { name: 'forms', priority: 75, selectors: ['input:not([type="hidden"])','select','textarea'], getSubtype: (el) => el.type || el.tagName.toLowerCase() },
        { name: 'modal-triggers', priority: 70, selectors: ['[data-toggle="modal"]','[data-modal]','.modal-trigger'], getSubtype: () => 'modal-trigger' },
        { name: 'interactive-generic', priority: 60, selectors: ['[onclick]','[onmouseover]','[data-action]'], getSubtype: (el) => el.hasAttribute('onclick') ? 'onclick' : (el.hasAttribute('onmouseover') ? 'hover' : 'data-action') }
      ];

      categories.forEach(cat => {
        cat.selectors.forEach(sel => {
          try {
            document.querySelectorAll(sel).forEach(el => {
              if (!isInteractive(el)) return;
              const text = textOf(el);
              if (shouldSkip(el, text)) return;

              const id = el.outerHTML;
              if (seen.has(id)) return;
              seen.add(id);

              discovered.push({
                selector: getSelector(el),
                type: cat.name,
                subtype: cat.getSubtype(el),
                text: text.substring(0, 100),
                priority: cat.priority,
                rect: el.getBoundingClientRect(),
                tagName: el.tagName,
                hasText: text.length > 0,
                isVisible: true,
                attributes: {
                  id: el.id || null,
                  className: el.className || null,
                  href: el.href || null,
                  type: el.type || null
                }
              });
            });
          } catch (e) {
            console.warn(`Error processing selector ${sel}:`, e);
          }
        });
      });

      return discovered.sort((a, b) => b.priority - a.priority).slice(0, options.maxInteractions);
    }, this.options);

    this.discoveredElements = elements;
    console.log(`🎯 Discovered ${this.discoveredElements.length} interactive elements`);
    const distribution = {};
    this.discoveredElements.forEach(el => { distribution[el.type] = (distribution[el.type] || 0) + 1; });
    console.log('📊 Element distribution:', distribution);
  }

  // ====== CHANGE DETECTION ======

  async detectContentChanges(beforeState, elementData) {
    // gather dynamic parts outside evaluate
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
          const t = document.querySelector(
            '[role="tab"][aria-selected="true"], .tab.active, .tab.selected, .tab-button.active, [aria-pressed="true"], [data-state="active"]'
          );
          return t ? (t.textContent || '').trim().toLowerCase() : '';
        })
      : '';

    const payload = { beforeState: { ...beforeState, url, selectedElementCount, hiddenElementCount, mainContentLength, modalCount, activeTabText }, elementData };

    return await this.page.evaluate(({ beforeState, elementData }) => {
      const changes = {
        significantChange: false,
        domChanged: false,
        textChanged: false,
        urlChanged: false,
        activeElementChanged: false,
        visibilityChanged: false,
        styleChanges: false,
        newImages: [],
        selectedTabChanged: false
      };

      if (window.location.href !== beforeState.url) { changes.urlChanged = true; changes.significantChange = true; }

      const currentDomHash = document.documentElement.innerHTML.length;
      if (Math.abs(currentDomHash - beforeState.domHash) > 50) { changes.domChanged = true; changes.significantChange = true; }

      const visible = Array.from(document.querySelectorAll('*')).filter(el => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
      });
      if (Math.abs(visible.length - beforeState.visibleElementCount) > 2) { changes.visibilityChanged = true; changes.significantChange = true; }

      const selected = document.querySelectorAll('[aria-selected="true"], .active, .selected, [class*="active"], [class*="selected"]');
      if (selected.length !== beforeState.selectedElementCount) { changes.activeElementChanged = true; changes.significantChange = true; }

      if (elementData && (elementData.type === 'tabs' || elementData.isTabLike)) {
        const activeTab = document.querySelector('[role="tab"][aria-selected="true"], .tab.active, .tab.selected, .tab-button.active, [aria-pressed="true"], [data-state="active"]');
        const activeText = activeTab ? (activeTab.textContent || '').trim().toLowerCase() : '';
        if (activeText && activeText !== (beforeState.activeTabText || '')) {
          changes.selectedTabChanged = true;
          changes.significantChange = true;
        }
      }

      const imgs = document.querySelectorAll('img');
      if (imgs.length > beforeState.imageCount) { changes.newImages = Array.from(imgs).slice(beforeState.imageCount); changes.significantChange = true; }

      const currTextLength = document.body.textContent.length;
      if (Math.abs(currTextLength - beforeState.textLength) > 50) { changes.textChanged = true; changes.significantChange = true; }

      const hidden = document.querySelectorAll('[style*="display: none"], [style*="visibility: hidden"]');
      if (Math.abs(hidden.length - beforeState.hiddenElementCount) > 1) { changes.styleChanges = true; changes.significantChange = true; }

      const main = document.querySelector('main, [role="main"], .main-content, #main, .content');
      if (main) {
        const mainLen = main.textContent.length;
        if (Math.abs(mainLen - (beforeState.mainContentLength || 0)) > 100) { changes.textChanged = true; changes.significantChange = true; }
      }

      const modals = document.querySelectorAll('[role="dialog"], .modal, .overlay, .popup');
      if (modals.length > (beforeState.modalCount || 0)) { changes.significantChange = true; }

      return changes;
    }, payload);
  }

  // ====== TAB HELPERS ======

  async waitForTabActivation(elementData) {
    if (!elementData) return;
    try {
      await this.page.waitForFunction((selector) => {
        const el = document.querySelector(selector);
        if (!el) return false;
        const t = (el.textContent || '').trim().toLowerCase();
        const selected =
          (el.getAttribute && (el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-pressed') === 'true' || el.getAttribute('data-state') === 'active')) ||
          /(^|\\s)(active|selected)(\\s|$)/i.test(el.className || '');
        const active = document.querySelector('[role="tab"][aria-selected="true"], .tab.active, .tab.selected, .tab-button.active, [aria-pressed="true"], [data-state="active"]');
        const activeText = active ? (active.textContent || '').trim().toLowerCase() : '';
        return selected || (activeText && activeText === t);
      }, elementData.selector, { timeout: this.options.changeDetectionTimeout });
    } catch (_) { /* not fatal */ }
  }

  async scrollToTabContent(elementData) {
    if (!this.options.tabSectionAutoScroll) return;
    try {
      const targetY = await this.page.evaluate((selector, minH) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        let node = el.closest('section, article, main, div') || el.parentElement;
        for (let i = 0; i < 5 && node; i++) {
          let sib = node.nextElementSibling;
          while (sib) {
            const r = sib.getBoundingClientRect();
            if (r.height > minH && r.width > 200) {
              return Math.max(0, r.top + window.scrollY - 16);
            }
            sib = sib.nextElementSibling;
          }
          node = node.parentElement;
        }
        const r = el.getBoundingClientRect();
        return r.bottom + window.scrollY + 200;
      }, elementData.selector, this.options.tabSectionMinHeight);

      if (targetY !== null) {
        await this.page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), targetY);
        await this.page.waitForTimeout(200);
      }
    } catch (_) {}
  }

  // ====== INTERACTION ENGINE ======

  async interactWithElement(elementData, index) {
    try {
      console.log(`🎯 Interacting with element ${index + 1}/${this.discoveredElements.length}: ${elementData.type} - "${elementData.text.substring(0, 50)}"`);

      // pre-classify: button-group behaving like tabs?
      const preMeta = await this.page.evaluate((selector) => {
        const el = document.querySelector(selector);
        if (!el) return { isTabLike: false };
        const group = el.closest('[role="tablist"], .tabs, .tablist, [data-tabgroup], .btn-group, .button-group');
        const siblings = group ? group.querySelectorAll('button, [role="tab"], a[role="tab"]').length : 0;
        const toggly = el.hasAttribute('aria-pressed') || el.getAttribute('data-state') === 'active';
        return { isTabLike: !!group || siblings >= 2 || toggly };
      }, elementData.selector);
      const isTabLike = elementData.type === 'tabs' || preMeta.isTabLike;
      elementData.isTabLike = isTabLike;

      // before state
      const beforeState = await this.page.evaluate(() => ({
        domHash: document.documentElement.innerHTML.length,
        visibleElementCount: Array.from(document.querySelectorAll('*')).filter(el => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        }).length,
        imageCount: document.querySelectorAll('img').length,
        textLength: document.body.textContent.length,
        scrollY: window.scrollY,
        selectedElementCount: document.querySelectorAll('[aria-selected="true"], .active, .selected, [class*="active"], [class*="selected"]').length,
        hiddenElementCount: document.querySelectorAll('[style*="display: none"], [style*="visibility: hidden"]').length,
        mainContentLength: (() => {
          const main = document.querySelector('main, [role="main"], .main-content, #main, .content');
          return main ? main.textContent.length : 0;
        })(),
        modalCount: document.querySelectorAll('[role="dialog"], .modal, .overlay, .popup').length
      }));

      // click
      const clicked = await this.page.evaluate((data) => {
        try {
          const el = document.querySelector(data.selector);
          if (!el) return { success: false, reason: 'Element not found' };
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return { success: false, reason: 'Element not visible' };
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(() => {
            if (el.tagName === 'DETAILS') {
              el.open = !el.open;
            } else if (el.hasAttribute('aria-expanded')) {
              const expanded = el.getAttribute('aria-expanded') === 'true';
              el.setAttribute('aria-expanded', (!expanded).toString());
              el.click();
            } else {
              el.click();
            }
          }, 100);
          return { success: true, action: 'click' };
        } catch (e) {
          return { success: false, reason: e.message };
        }
      }, { selector: elementData.selector, type: elementData.type });

      if (!clicked.success) {
        console.log(`   ❌ Interaction failed: ${clicked.reason}`);
        return null;
      }

      // waits by type
      await this.page.waitForTimeout(this.options.interactionDelay);

      if (elementData.type === 'explicit' && elementData.subtype === 'button' && !isTabLike) {
        await this.page.waitForTimeout(1200);
        try { await this.page.waitForLoadState('networkidle', { timeout: 5000 }); } catch { console.log('   ⚠️  Network idle timeout, continuing...'); }
        await this.waitForImages();
      } else if (elementData.type === 'expandable') {
        await this.page.waitForTimeout(1000);
        await this.waitForAnimations();
      } else if (elementData.type === 'tabs' || isTabLike) {
        await this.waitForTabActivation(elementData);
        await this.page.waitForTimeout(this.options.tabPostClickWait);
        await this.scrollToTabContent(elementData);
        await this.waitForImages();
        await this.waitForAnimations();
      }

      await this.page.waitForTimeout(500);

      // detect changes
      const changes = await this.detectContentChanges(beforeState, elementData);
      const forceTabShot = (elementData.type === 'tabs' || isTabLike) && this.options.forceScreenshotOnTabs;

      if (changes.significantChange || forceTabShot) {
        console.log('   ✅ Content changed! Details:', {
          domChanged: changes.domChanged,
          textChanged: changes.textChanged,
          urlChanged: changes.urlChanged,
          activeElementChanged: changes.activeElementChanged,
          visibilityChanged: changes.visibilityChanged,
          styleChanges: changes.styleChanges,
          selectedTabChanged: changes.selectedTabChanged
        });

        const label = elementData.text ? elementData.text.substring(0, 15) : elementData.type;
        const nameSafe = label.replace(/[^a-zA-Z0-9]/g, '_') || elementData.type;
        const tags = [ (isTabLike ? 'tabs' : elementData.type), elementData.subtype || '', elementData.text || '' ].filter(Boolean);

        const shot = await this.takeScreenshotWithQualityCheck(`interaction_${index + 1}_${nameSafe}`, { force: forceTabShot, tags });
        this.interactionHistory.set(elementData.selector, { elementData, interactionResult: clicked, changes, screenshot: shot, timestamp: Date.now() });

        if (elementData.type === 'tabs' || isTabLike) await this.page.waitForTimeout(800);
        return shot;
      } else {
        console.log('   ℹ️  No significant changes detected');
        return null;
      }
    } catch (error) {
      console.log(`   ❌ Error interacting with element: ${error.message}`);
      return null;
    }
  }

  // ====== PAGE LOAD HELPERS ======

  async waitForCompletePageLoad() {
    console.log('🔄 Ensuring complete page load...');
    try {
      console.log('   📡 Waiting for network idle...');
      await this.page.waitForLoadState('networkidle', { timeout: 10000 });

      console.log('   🌐 Waiting for DOM content loaded...');
      await this.page.waitForLoadState('domcontentloaded', { timeout: 5000 });

      console.log('   🖼️  Waiting for images to load...');
      await this.waitForImages();

      console.log('   📝 Waiting for fonts to load...');
      await this.waitForFonts();

      console.log('   ✨ Waiting for animations to settle...');
      await this.waitForAnimations();

      console.log('   🔄 Triggering lazy-loaded content...');
      await this.triggerLazyLoading();

      console.log('   ⚖️  Performing stability check...');
      await this.waitForPageStability();

      console.log('✅ Page fully loaded and stable');
    } catch (err) {
      console.log(`⚠️  Page load timeout, continuing anyway: ${err.message}`);
    }
  }

  async waitForImages() {
    return await this.page.evaluate(async () => {
      const imgs = Array.from(document.querySelectorAll('img'));
      if (imgs.length === 0) return;
      const promises = imgs.map(img => new Promise((resolve) => {
        if (img.complete) return resolve();
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', resolve, { once: true });
        setTimeout(resolve, 5000);
      }));
      await Promise.all(promises);
      console.log(`   ✅ ${imgs.length} images loaded`);
    });
  }

  async waitForFonts() {
    return await this.page.evaluate(async () => {
      if ('fonts' in document) {
        try { await document.fonts.ready; console.log('   ✅ Fonts loaded'); }
        catch { console.log('   ⚠️  Font loading timeout'); }
      }
    });
  }

  async waitForAnimations() {
    await this.page.evaluate(async () => {
      const animated = Array.from(document.querySelectorAll('*')).filter(el => {
        const s = getComputedStyle(el);
        return s.animationName !== 'none' || s.transitionProperty !== 'none';
      });
      if (animated.length > 0) {
        const promises = animated.map(el => new Promise(resolve => {
          const done = () => { el.removeEventListener('animationend', done); el.removeEventListener('transitionend', done); resolve(); };
          el.addEventListener('animationend', done, { once: true });
          el.addEventListener('transitionend', done, { once: true });
          setTimeout(resolve, 3000);
        }));
        await Promise.race([ Promise.all(promises), new Promise(r => setTimeout(r, 3000)) ]);
      }
    });
    await this.page.waitForTimeout(500);
  }

  async triggerLazyLoading() {
    const pageHeight = await this.page.evaluate(() => document.body.scrollHeight);
    const viewportHeight = await this.page.evaluate(() => window.innerHeight);
    let pos = 0;
    const step = viewportHeight * 0.8;
    while (pos < pageHeight) {
      await this.page.evaluate(y => window.scrollTo(0, y), pos);
      await this.page.waitForTimeout(300);
      pos += step;
    }
    await this.page.evaluate(() => window.scrollTo(0, 0));
    await this.page.waitForTimeout(500);
    await this.waitForImages();
  }

  async waitForPageStability() {
    let prev = '';
    let stable = 0;
    for (let i = 0; i < 10; i++) {
      const curr = await this.page.evaluate(() => {
        const visible = Array.from(document.querySelectorAll('*')).filter(el => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        });
        return visible.length + '_' + document.body.textContent.length;
      });
      if (curr === prev) { stable++; if (stable >= 3) { console.log('   ✅ Page content stable'); break; } }
      else { stable = 0; }
      prev = curr;
      await this.page.waitForTimeout(500);
    }
  }

  // legacy method
  async takeScreenshot(filename) {
    try {
      const buffer = await this.page.screenshot({ fullPage: true, type: 'png' });
      const data = { filename: `${filename}.png`, timestamp: new Date().toISOString(), size: buffer.length, buffer };
      this.screenshots.push(data);
      console.log(`   📸 Screenshot saved: ${filename}.png`);
      return data;
    } catch (err) {
      console.error(`Failed to take screenshot: ${err.message}`);
      return null;
    }
  }

  // ====== MAIN ======

  async captureInteractiveContent() {
    console.log('🚀 Starting interactive content capture...');

    try {
      console.log('⏳ Waiting for complete page load with validation...');
      await this.waitForCompletePageLoadWithValidation();

      console.log('📸 Taking baseline screenshot...');
      await this.takeScreenshotWithQualityCheck('00_baseline');

      console.log('🔍 Discovering interactive elements...');
      await this.discoverInteractiveElements();
      if (this.discoveredElements.length === 0) {
        console.log('ℹ️  No interactive elements found');
        return this.screenshots;
      }

      const maxInteractions = Math.min(this.discoveredElements.length, this.options.maxInteractions);
      console.log(`🎯 Processing top ${maxInteractions} interactive elements...`);

      for (let i = 0; i < maxInteractions; i++) {
        if (this.screenshots.length >= this.options.maxScreenshots) {
          console.log(`📸 Reached screenshot limit (${this.options.maxScreenshots})`);
          break;
        }
        const element = this.discoveredElements[i];
        await this.interactWithElement(element, i);
        if (i < maxInteractions - 1) await this.page.waitForTimeout(200);
      }

      if (this.screenshots.length < 3) {
        console.log('📸 Taking final comprehensive screenshot...');
        await this.takeScreenshotWithQualityCheck('99_final');
      }

      console.log(`✅ Capture complete! Generated ${this.screenshots.length} screenshots from ${this.interactionHistory.size} successful interactions`);

      // DEDUP — but keep TAB shots no matter what
      console.log('🔍 Running image deduplication...');
      const { ImageDeduplicationService } = require('./image-deduplication');
      const dedup = new ImageDeduplicationService({
        similarityThreshold: this.options.dedupeSimilarityThreshold,
        keepHighestQuality: true,
        preserveFirst: true,
        verbose: true
      });

      let unique = await dedup.processScreenshots(this.screenshots);

      // Ensure we never drop any tab screenshots
      const tabShots = this.screenshots.filter(s => (s.tags || []).includes('tabs'));
      const names = new Set(unique.map(u => u.filename));
      tabShots.forEach(s => {
        if (!names.has(s.filename)) {
          console.log(`   ➕ Re-inserting tab screenshot removed by dedupe: ${s.filename}`);
          unique.push(s);
        }
      });

      this.screenshots = unique;
      this.deduplicationReport = dedup.getDeduplicationReport();

      console.log(`🎉 Final result: ${this.screenshots.length} unique screenshots ready!`);
      return this.screenshots;

    } catch (err) {
      console.error(`❌ Interactive capture failed: ${err.message}`);
      return this.screenshots;
    }
  }

  // ====== REPORT ======

  getCaptureReport() {
    const report = {
      totalScreenshots: this.screenshots.length,
      totalInteractions: this.interactionHistory.size,
      discoveredElements: this.discoveredElements.length,
      successfulInteractions: Array.from(this.interactionHistory.values()).filter(h => h.screenshot).length,
      elementTypes: {},
      interactionTypes: {},
      deduplication: this.deduplicationReport || null
    };

    this.discoveredElements.forEach(el => {
      report.elementTypes[el.type] = (report.elementTypes[el.type] || 0) + 1;
    });

    Array.from(this.interactionHistory.values()).forEach(interaction => {
      const t = interaction.elementData.type;
      report.interactionTypes[t] = (report.interactionTypes[t] || 0) + 1;
    });

    return report;
  }
}

module.exports = { InteractiveContentCapture };