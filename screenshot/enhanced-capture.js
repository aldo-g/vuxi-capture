// screenshot/enhanced-capture.js
const { chromium } = require('playwright');
const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
let sharp = null;
try { sharp = require('sharp'); } catch { /* optional */ }

const { ScreenshotEnhancer } = require('./enhancer');
const { createFilename } = require('./utils');

const SLEEP = (ms) => new Promise(r => setTimeout(r, ms));

class EnhancedScreenshotCapture {
  constructor(outputDir, options = {}) {
    this.outputDir = outputDir;
    this.viewport = {
      width: options.width || 1440,
      height: options.height || 900
    };
    this.timeout = options.timeout || 45000;

    this.browser = null;
    this.enhancer = new ScreenshotEnhancer();

    this.maxScreenshotsPerPage = options.maxScreenshotsPerPage || 20;
    this.interactionDelay = options.interactionDelay || 800;

    // arrival burst
    this.arrivalBurstCount = 3;
    this.arrivalBurstGapMs = 1000;

    this.screenshotsDir = path.join(outputDir, 'desktop');
    fs.ensureDirSync(this.screenshotsDir);

    console.log(`📁 Screenshots will be saved to: ${this.screenshotsDir}`);
    console.log(`🎯 Interactive capture enabled (max ${this.maxScreenshotsPerPage} shots/page)`);
  }

  // ---------- lifecycle ----------
  async init() {
    if (!this.browser) {
      console.log('🚀 Launching browser...');
      this.browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--memory-pressure-off',
          '--max_old_space_size=4096'
        ]
      });
    }
  }

  async close() {
    if (this.browser) {
      console.log('🛑 Closing browser...');
      try {
        await this.browser.close();
        this.browser = null;
        console.log('✅ Browser closed successfully');
      } catch (error) {
        console.error('⚠️ Error closing browser:', error.message);
        this.browser = null;
      }
    }
  }

  // ---------- hashing / de-dup ----------
  async fileSha256(filePath) {
    const buf = await fs.readFile(filePath);
    return crypto.createHash('sha256').update(buf).digest('hex');
  }

  async fileAHash(filePath) {
    if (!sharp) return null;
    try {
      const img = await sharp(filePath)
        .resize(8, 8, { fit: 'fill' })
        .greyscale()
        .raw()
        .toBuffer();
      let sum = 0;
      for (let i = 0; i < img.length; i++) sum += img[i];
      const avg = sum / img.length;
      let bits = '';
      for (let i = 0; i < img.length; i++) bits += img[i] > avg ? '1' : '0';
      const chunks = bits.match(/.{1,4}/g) || [];
      return chunks.map(n => parseInt(n, 2).toString(16)).join('');
    } catch {
      return null;
    }
  }

  async deDupeScreenshots(results) {
    console.log('🔍 Hashing screenshots to remove duplicates…');
    const seen = new Map();
    const removed = [];
    for (const r of results) {
      const full = path.join(this.screenshotsDir, r.filename);
      let key = await this.fileAHash(full);
      if (!key) key = await this.fileSha256(full);
      if (seen.has(key)) {
        await fs.remove(full);
        removed.push(r.filename);
      } else {
        seen.set(key, r.filename);
      }
    }
    console.log(`✅ De-dupe complete. Removed ${removed.length} duplicate(s).`);
    return results.filter(r => !removed.includes(r.filename));
  }

  // ---------- helpers ----------
  async capture(page, filepath) {
    await page.screenshot({ path: filepath, fullPage: true, type: 'png' });
  }

  async tryClick(page, selector, labelForLog) {
    const loc = page.locator(selector).first();
    try { await loc.scrollIntoViewIfNeeded({ timeout: 2500 }); } catch {}
    try {
      await loc.click({ timeout: 3000 });
      await SLEEP(this.interactionDelay);
      return true;
    } catch (e) {
      console.log(`    ⚠️ Click failed on ${labelForLog || selector}: ${e.message}`);
      try {
        await loc.click({ timeout: 2000, force: true });
        await SLEEP(this.interactionDelay);
        return true;
      } catch {
        return false;
      }
    }
  }

  // ---------- discovery in page ----------
  async discoverExpandables(page) {
    return await page.evaluate(() => {
      const out = [];

      const isVisible = (el) => {
        if (!el || el.disabled) return false;
        const s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };

      const clsSig = (el) => Array.from(el.classList || []).sort().join('.');
      const buildSel = (el) => {
        if (!el) return '';
        if (el.id) return `#${CSS.escape(el.id)}`;
        const classes = Array.from(el.classList || []);
        if (classes.length) return `${el.tagName.toLowerCase()}.${classes.map(CSS.escape).join('.')}`;
        // fallback nth-of-type chain (short)
        let segs = [], cur = el;
        while (cur && segs.length < 4) {
          let nth = 1, sib = cur;
          while ((sib = sib.previousElementSibling) != null) if (sib.tagName === cur.tagName) nth++;
          segs.unshift(`${cur.tagName.toLowerCase()}:nth-of-type(${nth})`);
          cur = cur.parentElement;
        }
        return segs.join(' > ');
      };

      const looksExpandText = (t) => {
        t = (t || '').toLowerCase();
        return /(show more|show less|expand|details|filters|read more|view more|\+\s*\d+\s*more|\+\s*more)/i.test(t);
      };

      // details/summary
      document.querySelectorAll('details summary').forEach(sm => {
        const details = sm.closest('details');
        if (details && isVisible(sm)) {
          out.push({ selector: buildSel(sm), groupKey: `DETAILS|${clsSig(details)}`, reason: 'details' });
        }
      });

      // obvious expand triggers
      document.querySelectorAll('button, a, [role="button"]').forEach(el => {
        if (!isVisible(el)) return;
        const txt = (el.innerText || el.textContent || '').trim();
        if (looksExpandText(txt)) {
          out.push({ selector: buildSel(el), groupKey: `BTN|${clsSig(el)}`, reason: 'text-match' });
        }
      });

      // aria/accordion markers
      document.querySelectorAll('[aria-expanded], [aria-controls], [data-accordion], .accordion, .collapse')
        .forEach(el => {
          if (!isVisible(el)) return;
          out.push({ selector: buildSel(el), groupKey: `ARIA|${clsSig(el)}`, reason: 'aria' });
        });

      // project card “+N more” chips (click chip or the card)
      document.querySelectorAll('article, .card, [class*="card"]').forEach(card => {
        if (!isVisible(card)) return;
        const txt = (card.innerText || card.textContent || '').toLowerCase();
        if (/\+\s*\d+\s*more/.test(txt)) {
          // prefer the chip/button inside the card if present
          let trigger =
            card.querySelector('button, a, [role="button"]') ||
            card; // fall back to card itself
          if (trigger && isVisible(trigger)) {
            out.push({
              selector: buildSel(trigger),
              groupKey: `CARD|${clsSig(card)}`,
              reason: '+N more chip'
            });
          }
        }
      });

      // filter toggle near “Featured Projects”
      const filterBtn = Array.from(document.querySelectorAll('button, [role="button"], a'))
        .find(b => isVisible(b) && /(filter|filters)/i.test((b.innerText || b.textContent || '').trim()));
      if (filterBtn) {
        out.push({
          selector: buildSel(filterBtn),
          groupKey: `FILTERBTN|${clsSig(filterBtn)}`,
          reason: 'filters button'
        });
      }

      // dedupe by selector
      const uniq = new Map();
      for (const x of out) if (!uniq.has(x.selector)) uniq.set(x.selector, x);
      return Array.from(uniq.values());
    });
  }

  async discoverTabTargets(page) {
    // Try role=tablist first
    const tablists = await page.evaluate(() => {
      const lists = [];

      const isVisible = (el) => {
        if (!el || el.disabled) return false;
        const s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };

      const sel = (el) => {
        if (el.id) return `#${CSS.escape(el.id)}`;
        const classes = Array.from(el.classList || []);
        if (classes.length) return `${el.tagName.toLowerCase()}.${classes.map(CSS.escape).join('.')}`;
        return el.tagName.toLowerCase();
      };

      // ARIA tablist
      document.querySelectorAll('[role="tablist"]').forEach(list => {
        if (!isVisible(list)) return;
        const tabs = Array.from(list.querySelectorAll('[role="tab"], button, [aria-selected]'))
          .filter(isVisible)
          .map(el => ({ selector: sel(el), text: (el.innerText || el.textContent || '').trim() }))
          .filter(t => t.text);
        if (tabs.length > 1) lists.push({ container: sel(list), tabs });
      });

      return lists;
    });

    if (tablists.length) {
      // flatten into simple targets
      return tablists.flatMap(tl => tl.tabs);
    }

    // Heuristic for “Projects / Experience” pair near the header
    const explicit = await page.evaluate(() => {
      const out = [];
      const isVisible = (el) => {
        if (!el || el.disabled) return false;
        const s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const sel = (el) => {
        if (el.id) return `#${CSS.escape(el.id)}`;
        const classes = Array.from(el.classList || []);
        if (classes.length) return `${el.tagName.toLowerCase()}.${classes.map(CSS.escape).join('.')}`;
        return el.tagName.toLowerCase();
      };
      const labels = ['Projects', 'Experience'];
      labels.forEach(label => {
        const el = Array.from(document.querySelectorAll('button, a, [role="button"]'))
          .find(b => isVisible(b) && (b.innerText || b.textContent || '').trim().toLowerCase() === label.toLowerCase());
        if (el) out.push({ selector: sel(el), text: label });
      });
      return out;
    });

    return explicit;
  }

  // ---------- flows ----------
  async captureArrivalBurst(page, baseFilename, results) {
    const basePath = path.join(this.screenshotsDir, baseFilename);
    console.log(`    📸 Baseline initial -> ${baseFilename}`);
    await this.capture(page, basePath);
    results.push({
      filename: baseFilename,
      path: `desktop/${baseFilename}`,
      type: 'initial',
      timestamp: new Date().toISOString(),
      viewport: this.viewport
    });

    for (let i = 1; i <= this.arrivalBurstCount; i++) {
      await SLEEP(this.arrivalBurstGapMs);
      const name = baseFilename.replace('.png', `_arrival-${i}.png`);
      console.log(`    📸 Arrival shot #${i} -> ${name}`);
      await this.capture(page, path.join(this.screenshotsDir, name));
      results.push({
        filename: name,
        path: `desktop/${name}`,
        type: 'arrival',
        timestamp: new Date().toISOString(),
        viewport: this.viewport
      });
    }
  }

  async handleExpandables(page, baseFilename, results) {
    const items = await this.discoverExpandables(page);
    if (!items.length) {
      console.log('  🔎 No expandables found.');
      return;
    }

    // group by class signature (groupKey) to avoid clicking all identical cards
    const groups = new Map();
    for (const it of items) {
      if (!groups.has(it.groupKey)) groups.set(it.groupKey, []);
      groups.get(it.groupKey).push(it);
    }

    console.log(`  🔍 Expandable groups found: ${groups.size}`);

    let shot = 0;
    for (const [, list] of groups.entries()) {
      const first = list[0];
      const ok = await this.tryClick(page, first.selector, `expand[${first.reason}]`);
      if (!ok) continue;

      // if a dialog/modal appears, give it a moment
      await SLEEP(600);

      const name = baseFilename.replace('.png', `_expand-${++shot}.png`);
      console.log(`    📷 Capturing expanded -> ${name}`);
      await this.capture(page, path.join(this.screenshotsDir, name));
      results.push({
        filename: name,
        path: `desktop/${name}`,
        type: 'expandable',
        timestamp: new Date().toISOString(),
        viewport: this.viewport
      });

      // if a modal popped up, attempt to close it so we can continue (Esc)
      try { await page.keyboard.press('Escape'); await SLEEP(200); } catch {}

      if (results.length >= this.maxScreenshotsPerPage) return;
    }
  }

  async handleTabs(page, baseFilename, results) {
    const tabs = await this.discoverTabTargets(page);
    if (!tabs.length) {
      console.log('  🔎 No tab targets found.');
      return;
    }

    // click each tab once; prefer Experience then Projects so we capture both states
    const priority = (t) => {
      const txt = (t.text || '').toLowerCase();
      if (txt.includes('experience')) return 0;
      if (txt.includes('projects')) return 1;
      return 2;
    };
    tabs.sort((a, b) => priority(a) - priority(b));

    let shot = 0;
    const touched = new Set(); // avoid duplicate same-caption clicks
    for (const tb of tabs) {
      const key = (tb.text || '').toLowerCase();
      if (touched.has(key)) continue;
      touched.add(key);

      const ok = await this.tryClick(page, tb.selector, `tab "${tb.text}"`);
      if (!ok) continue;

      await SLEEP(500);
      const slug = (tb.text || 'tab').replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40);
      const name = baseFilename.replace('.png', `_tab-${++shot}-${slug}.png`);
      console.log(`    📷 Capturing tab -> ${name}`);
      await this.capture(page, path.join(this.screenshotsDir, name));
      results.push({
        filename: name,
        path: `desktop/${name}`,
        type: 'tab',
        timestamp: new Date().toISOString(),
        viewport: this.viewport
      });

      if (results.length >= this.maxScreenshotsPerPage) return;
    }
  }

  // ---------- entry ----------
  async captureUrl(url, index) {
    const startTime = Date.now();
    let context = null;
    try {
      await this.init();
      console.log(`📸 [${index}] Capturing: ${url}`);

      context = await this.browser.newContext({
        viewport: this.viewport,
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        reducedMotion: 'reduce',
        colorScheme: 'light'
      });
      const page = await context.newPage();

      console.log(`  ⏳ Loading page...`);
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.timeout });
      await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
      await SLEEP(900);
      if (!response || response.status() >= 400) {
        throw new Error(`Failed to load page: HTTP ${response ? response.status() : 'unknown'}`);
      }

      console.log(`  ✨ Applying enhancements...`);
      await this.enhancer.enhance(page);
      await SLEEP(900);

      const results = [];
      const baseFilename = createFilename(url, index);

      // 1) Arrival burst (no interaction)
      await this.captureArrivalBurst(page, baseFilename, results);
      if (results.length >= this.maxScreenshotsPerPage) return results;

      // 2) Expand filters & one card per identical class
      await this.handleExpandables(page, baseFilename, results);
      if (results.length >= this.maxScreenshotsPerPage) return results;

      // 3) Tabs (Projects / Experience)
      await this.handleTabs(page, baseFilename, results);

      // 4) De-dup
      const deduped = await this.deDupeScreenshots(results);

      console.log(`  ✅ Success in ${Date.now() - startTime}ms: ${deduped.length} screenshots (after de-dup)`);
      return deduped;
    } catch (error) {
      console.error(`  ❌ Error after ${Date.now() - startTime}ms: ${error.message}`);
      throw error;
    } finally {
      if (context) {
        try {
          await context.close();
        } catch (closeError) {
          console.error(`  ⚠️  Error closing context: ${closeError.message}`);
        }
      }
    }
  }
}

module.exports = { EnhancedScreenshotCapture };
