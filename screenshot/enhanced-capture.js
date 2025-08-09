// screenshot/enhanced-capture.js - GENERIC VERSION
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

  async tryClick(page, selector, labelForLog, retries = 2) {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const element = page.locator(selector).first();
        
        // Different strategies for different attempt numbers
        if (attempt === 0) {
          // First attempt: Standard approach
          await element.scrollIntoViewIfNeeded({ timeout: 1500 });
          await element.waitFor({ state: 'visible', timeout: 1500 });
          await element.click({ timeout: 1500 });
        } else {
          // Second attempt: Force click with JavaScript
          await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            if (el) {
              if (el.click) el.click();
              else if (el.dispatchEvent) {
                el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
              }
            }
          }, selector);
        }
        
        await SLEEP(this.interactionDelay);
        return true;
        
      } catch (e) {
        if (attempt < retries - 1) {
          console.log(`    ⚠️ Attempt ${attempt + 1} failed, trying different approach...`);
          await SLEEP(300);
          continue;
        }
      }
    }
    
    console.log(`    ❌ All click attempts failed on ${labelForLog || 'element'}`);
    return false;
  }

  // ---------- COMPLETELY GENERIC component discovery ----------
  async discoverInteractiveElements(page) {
    return await page.evaluate(() => {
      const elements = [];
      let elementCounter = 0;

      const isVisible = (el) => {
        if (!el || el.disabled) return false;
        const s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false;
        const r = el.getBoundingClientRect();
        return r.width > 5 && r.height > 5; // Must be reasonably sized
      };

      const createSelector = (el) => {
        const id = 'auto_interact_' + (++elementCounter);
        el.setAttribute('data-auto-id', id);
        return `[data-auto-id="${id}"]`;
      };

      const getText = (el) => {
        const text = (el.innerText || el.textContent || '').trim();
        return text.length > 100 ? text.substring(0, 97) + '...' : text;
      };

      // 1. HIGHEST PRIORITY: Role-based interactive elements
      document.querySelectorAll('[role="tab"], [role="button"], [role="tablist"] *').forEach(el => {
        if (isVisible(el)) {
          const priority = el.role === 'tab' ? 20 : (el.role === 'button' ? 15 : 12);
          elements.push({
            selector: createSelector(el),
            text: getText(el),
            type: el.role || 'role-element',
            priority: priority
          });
        }
      });

      // 2. NATIVE INTERACTIVE ELEMENTS: Buttons, links, form controls
      document.querySelectorAll('button, a[href], select, input[type="checkbox"], input[type="radio"]').forEach(el => {
        if (!isVisible(el)) return;
        
        const text = getText(el);
        if (text.length < 1 || text.length > 200) return; // Skip empty or very long text
        
        elements.push({
          selector: createSelector(el),
          text: text,
          type: el.tagName.toLowerCase(),
          priority: 10
        });
      });

      // 3. DISCLOSURE/EXPANDABLE ELEMENTS: Elements that can reveal content
      document.querySelectorAll('details summary, [aria-expanded], [aria-controls], [data-toggle]').forEach(el => {
        if (isVisible(el)) {
          elements.push({
            selector: createSelector(el),
            text: getText(el),
            type: 'disclosure',
            priority: 14
          });
        }
      });

      // 4. ELEMENTS WITH CLICK HANDLERS: Any element with explicit interaction
      document.querySelectorAll('[onclick], [data-action], [data-click], [data-target]').forEach(el => {
        if (!isVisible(el)) return;
        const text = getText(el);
        if (text && text.length > 1 && text.length < 150) {
          elements.push({
            selector: createSelector(el),
            text: text,
            type: 'clickable',
            priority: 8
          });
        }
      });

      // 5. DROPDOWN/MENU TRIGGERS
      document.querySelectorAll('[aria-haspopup], [data-dropdown], [data-menu]').forEach(el => {
        if (isVisible(el)) {
          elements.push({
            selector: createSelector(el),
            text: getText(el),
            type: 'dropdown',
            priority: 12
          });
        }
      });

      // 6. ELEMENTS IN LIKELY NAVIGATION/CONTROL AREAS (based on position and size)
      document.querySelectorAll('*').forEach(el => {
        if (!isVisible(el)) return;
        if (el.tagName === 'BUTTON' || el.tagName === 'A') return; // Already covered above
        
        const rect = el.getBoundingClientRect();
        const text = getText(el);
        
        // Look for small, positioned elements that might be controls
        if (text && text.length > 1 && text.length < 50 && 
            rect.width < 300 && rect.height < 100 && 
            (el.style.cursor === 'pointer' || window.getComputedStyle(el).cursor === 'pointer')) {
          
          elements.push({
            selector: createSelector(el),
            text: text,
            type: 'cursor-pointer',
            priority: 6
          });
        }
      });      // Sort by priority (higher first) and deduplicate by element reference
      const seen = new Set();
      return elements
        .sort((a, b) => b.priority - a.priority)
        .filter(el => {
          // Use the selector as deduplication key since each element gets unique selector
          if (seen.has(el.selector)) return false;
          seen.add(el.selector);
          return true;
        })
        .slice(0, 15); // Limit to top 15 most promising elements
    });
  }

  // ---------- Generic interaction handler ----------
  async handleInteractiveElements(page, baseFilename, results) {
    const elements = await this.discoverInteractiveElements(page);
    
    if (!elements.length) {
      console.log('  🔎 No interactive elements discovered.');
      return;
    }

    console.log(`  🎯 Found ${elements.length} interactive elements to try`);
    
    let successCount = 0;
    let attemptCount = 0;
    const maxSuccessful = 3; // Reduce to focus on key interactions
    const maxAttempts = Math.min(elements.length, 8); // Try fewer elements total

    for (const element of elements) {
      if (successCount >= maxSuccessful || attemptCount >= maxAttempts) break;
      if (results.length >= this.maxScreenshotsPerPage) break;
      
      attemptCount++;
      console.log(`  🔄 Trying ${element.type}: "${element.text.substring(0, 40)}..." (${attemptCount}/${maxAttempts})`);
      
      const clicked = await this.tryClick(page, element.selector, `${element.type}: ${element.text.substring(0, 30)}`);
      
      if (clicked) {
        await SLEEP(600); // Wait for any animations/content loading
        
        const safeName = element.type.replace(/[^a-z0-9]/gi, '');
        const name = baseFilename.replace('.png', `_interact-${successCount + 1}-${safeName}.png`);
        console.log(`    📷 Capturing interaction result -> ${name}`);
        
        await this.capture(page, path.join(this.screenshotsDir, name));
        results.push({
          filename: name,
          path: `desktop/${name}`,
          type: `interaction-${element.type}`,
          interaction: `${element.type}: ${element.text.substring(0, 50)}`,
          timestamp: new Date().toISOString(),
          viewport: this.viewport
        });
        
        successCount++;
        
        // Try to reset state for next interaction
        try {
          await page.keyboard.press('Escape');
          await SLEEP(200);
          // Click somewhere neutral to close any overlays
          await page.mouse.click(50, 50);
          await SLEEP(200);
        } catch {}
      }
    }
    
    console.log(`  ✅ Successfully captured ${successCount} interactions from ${attemptCount} attempts`);
  }

  // ---------- Main entry point ----------
  async captureUrl(url, index) {
    const startTime = Date.now();
    let context = null;
    try {
      await this.init();
      console.log(`📸 [${index}] Capturing: ${url}`);

      context = await this.browser.newContext({
        viewport: this.viewport,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
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

      // 1) Capture baseline screenshot
      console.log(`  📸 Capturing baseline screenshot...`);
      const basePath = path.join(this.screenshotsDir, baseFilename);
      await this.capture(page, basePath);
      results.push({
        filename: baseFilename,
        path: `desktop/${baseFilename}`,
        type: 'baseline',
        timestamp: new Date().toISOString(),
        viewport: this.viewport
      });

      // 2) Discover and interact with elements
      await this.handleInteractiveElements(page, baseFilename, results);

      // 3) Deduplicate screenshots
      const deduped = await this.deDupeScreenshots(results);

      console.log(`  ✅ Success in ${Date.now() - startTime}ms: ${deduped.length} unique screenshots`);
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