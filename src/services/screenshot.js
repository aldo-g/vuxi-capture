const { chromium } = require('playwright');
const fs = require('fs-extra');
const path = require('path');
const sharp = require('sharp');

const INTERACTIVE_SELECTOR =
  'button, a[href], input:not([type="hidden"]), textarea, select, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="switch"], [tabindex], [aria-haspopup], [aria-controls], [style*="cursor: pointer"], [style*="cursor:pointer"], .cursor-pointer';

const INTERACTIVE_ACTIONS = {
  CLICK: 'click',
  HOVER: 'hover',
  TYPE_TEXT: 'type_text',
  CHECK_TOGGLE: 'check_toggle',
  SELECT_OPTION: 'select_option',
  RANGE: 'range'
};

const INTERACTION_DELAY_MS = 1200;
const SAMPLE_INPUT_VALUE = 'Sample input';

function slugify(value, fallback = 'interaction') {
  if (!value) {
    return fallback;
  }

  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

  return slug || fallback;
}

function buildFilename(url, index) {
  try {
    const urlObj = new URL(url);
    const host = urlObj.hostname.replace(/^www\./, '');
    const pathPart = urlObj.pathname
      .split('/')
      .filter(Boolean)
      .slice(0, 3)
      .join('-');

    const safePath = pathPart.replace(/[^a-z0-9-]/gi, '-');
    const safeHost = host.replace(/[^a-z0-9.-]/gi, '-');
    return `${String(index).padStart(3, '0')}_${safeHost}${safePath ? `_${safePath}` : ''}.png`;
  } catch {
    return `${String(index).padStart(3, '0')}_page.png`;
  }
}

class ScreenshotService {
  constructor(options = {}) {
    this.outputDir = options.outputDir || path.join(process.cwd(), 'data');
    this.viewport = options.viewport || { width: 1280, height: 720 };
    this.timeout = options.timeout ?? 30000;
    this.concurrent = options.concurrent ?? 2;
    this.screenshotsDir = path.join(this.outputDir, 'desktop');
  }

  async captureAll(urls = []) {
    if (!urls.length) {
      return {
        success: false,
        successful: [],
        failed: [],
        stats: { durationSeconds: 0, totalScreenshots: 0 },
        files: {}
      };
    }

    console.log(`[screenshot] capturing ${urls.length} page(s)`);
    await fs.ensureDir(this.screenshotsDir);

    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const successful = [];
    const failed = [];
    const startedAt = Date.now();

    try {
      for (let i = 0; i < urls.length; i += this.concurrent) {
        const batch = urls.slice(i, i + this.concurrent);
        const results = await Promise.all(
          batch.map((url, batchIndex) =>
            this.#captureSingle(browser, url, i + batchIndex + 1)
          )
        );

        results.forEach(result => {
          if (result.success) {
            successful.push(result.data);
          } else {
            failed.push({ url: result.url, error: result.error });
          }
        });
      }
    } finally {
      await browser.close();
    }

    const deduplication = await this.#deduplicateScreenshots(successful);
    const durationSeconds = Number(((Date.now() - startedAt) / 1000).toFixed(2));
    const interactionTotals = successful.reduce(
      (totals, entry) => {
        const interactions = entry.interactions || [];
        totals.groups += interactions.length;
        totals.screenshots += interactions.filter(i => i.status === 'captured').length;
        return totals;
      },
      { groups: 0, screenshots: 0 }
    );
    const metadata = {
      capturedAt: new Date().toISOString(),
      durationSeconds,
      totalUrls: urls.length,
      successful: successful.length,
      failed: failed.length,
      interactions: interactionTotals,
      deduplication
    };

    const metadataPath = path.join(this.outputDir, 'metadata.json');
    await fs.writeJson(metadataPath, metadata, { spaces: 2 });
    const interactionNote = interactionTotals.screenshots
      ? ` + ${interactionTotals.screenshots} interaction screenshot(s)`
      : '';
    console.log(
      `[screenshot] captured ${successful.length} base screenshot(s)${interactionNote}`
    );
    if (deduplication.totalDuplicates > 0) {
      console.log(
        `[screenshot] removed ${deduplication.totalDuplicates} duplicate screenshot(s)`
      );
    }

    return {
      success: successful.length > 0,
      successful,
      failed,
      stats: {
        durationSeconds,
        totalScreenshots: successful.length
      },
      files: {
        metadata: metadataPath,
        screenshotsDir: this.screenshotsDir
      }
    };
  }

  async #captureSingle(browser, url, index) {
    const context = await browser.newContext({
      viewport: this.viewport
    });
    const page = await context.newPage();

    try {
      console.log(`[screenshot] (${index}) visiting ${url}`);
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: this.timeout
      });
      await page.waitForLoadState('networkidle', {
        timeout: Math.min(this.timeout / 2, 5000)
      }).catch(() => {});

      const filename = buildFilename(url, index);
      const filepath = path.join(this.screenshotsDir, filename);

      await page.screenshot({
        path: filepath,
        fullPage: true,
        type: 'png'
      });
      console.log(`[screenshot] (${index}) saved base screenshot -> desktop/${filename}`);

      let interactions = [];
      try {
        const groups = await this.#discoverInteractiveGroups(page);
        if (groups.length) {
          console.log(
            `[screenshot] (${index}) found ${groups.length} interactive group(s) on ${url}`
          );
        } else {
          console.log(`[screenshot] (${index}) no interactive elements detected on ${url}`);
        }
        interactions = await this.#captureInteractions(
          browser,
          url,
          filename,
          groups,
          index
        );
      } catch (interactionError) {
        console.warn(
          `[screenshot] interaction capture skipped for ${url}: ${interactionError.message}`
        );
      }

      return {
        success: true,
        data: {
          url,
          filename,
          path: `desktop/${filename}`,
          outputPath: filepath,
          interactions
        }
      };
    } catch (error) {
      console.error(`[screenshot] (${index}) failed for ${url}: ${error.message}`);
      return {
        success: false,
        url,
        error: error.message
      };
    } finally {
      await context.close();
    }
  }

  async #discoverInteractiveGroups(page) {
    const groups = await page.evaluate(
      ({ selector, actions }) => {
        const nodes = Array.from(document.querySelectorAll(selector));

        const cssEscape = value => {
          if (window.CSS && CSS.escape) {
            return CSS.escape(value);
          }
          return value.replace(/([\0-\x1f\x7f-\x9f!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
        };

        const buildSelector = element => {
          if (!element) return null;
          if (element.id) {
            return `#${cssEscape(element.id)}`;
          }

          const parts = [];
          let current = element;
          let depth = 0;
          while (current && current.nodeType === Node.ELEMENT_NODE && depth < 8) {
            let part = current.tagName.toLowerCase();
            const classList = Array.from(current.classList || []).slice(0, 2);
            if (classList.length) {
              part += classList.map(cls => `.${cssEscape(cls)}`).join('');
            }

            const siblings = Array.from(current.parentNode?.children || []).filter(
              sibling => sibling.tagName === current.tagName
            );
            if (siblings.length > 1) {
              const index = siblings.indexOf(current) + 1;
              part += `:nth-of-type(${index})`;
            }

            parts.unshift(part);
            current = current.parentElement;
            depth += 1;
          }

          return parts.join(' > ');
        };

        const isVisible = element => {
          const style = window.getComputedStyle(element);
          if (!style || style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) {
            return false;
          }

          const rect = element.getBoundingClientRect();
          return rect.width >= 2 && rect.height >= 2;
        };

        const getText = element => {
          const raw =
            element.innerText ||
            element.value ||
            element.getAttribute('aria-label') ||
            element.getAttribute('title') ||
            '';
          return raw.replace(/\s+/g, ' ').trim().slice(0, 80);
        };

        const currentUrl = new URL(window.location.href);
        const results = [];

        nodes.forEach(node => {
          if (!isVisible(node)) {
            return;
          }

          const tag = node.tagName.toLowerCase();
          const type = (node.getAttribute('type') || '').toLowerCase();
          const role = (node.getAttribute('role') || '').toLowerCase();
          const name = (node.getAttribute('name') || '').toLowerCase();
          const href = (node.getAttribute('href') || '').trim();
          const text = getText(node);
          const classSignature = Array.from(node.classList || [])
            .slice(0, 3)
            .join('.');

          const signature = [tag, type, role, name, text.toLowerCase(), classSignature].join('|');

          let action = actions.CLICK;
          let willLeave = false;

          if (tag === 'a' && href) {
            if (href.startsWith('#') || /^javascript:/i.test(href)) {
              willLeave = false;
            } else {
              try {
                const linkUrl = new URL(href, currentUrl.href);
                const samePage =
                  linkUrl.origin === currentUrl.origin &&
                  linkUrl.pathname === currentUrl.pathname;
                willLeave = !samePage;
              } catch {
                willLeave = true;
              }
            }
            action = willLeave ? actions.HOVER : actions.CLICK;
          } else if (tag === 'input') {
            if (['checkbox', 'radio'].includes(type)) {
              action = actions.CHECK_TOGGLE;
            } else if (type === 'range') {
              action = actions.RANGE;
            } else if (['button', 'reset', 'submit'].includes(type)) {
              action = actions.HOVER;
            } else {
              action = actions.TYPE_TEXT;
            }
          } else if (tag === 'textarea') {
            action = actions.TYPE_TEXT;
          } else if (tag === 'select') {
            action = actions.SELECT_OPTION;
          } else if (role === 'button' || role === 'tab' || role === 'menuitem' || role === 'switch') {
            action = actions.CLICK;
          } else if (node.hasAttribute('tabindex')) {
            action = actions.HOVER;
          }

          const descriptorParts = [tag];
          if (text) {
            descriptorParts.push(`"${text}"`);
          }
          if (type && tag === 'input') {
            descriptorParts.push(`[${type}]`);
          }

          const selectorPath = buildSelector(node);
          if (!selectorPath) {
            return;
          }

          results.push({
            signature,
            selector: selectorPath,
            descriptor: descriptorParts.join(' '),
            tag,
            type,
            role,
            text,
            action,
            willLeave,
            href
          });
        });

        return results;
      },
      {
        selector: INTERACTIVE_SELECTOR,
        actions: INTERACTIVE_ACTIONS
      }
    );

    const grouped = new Map();
    groups.forEach(item => {
      if (!grouped.has(item.signature)) {
        grouped.set(item.signature, { ...item, count: 1 });
      } else {
        grouped.get(item.signature).count += 1;
      }
    });

    return Array.from(grouped.values());
  }

  async #captureInteractions(browser, url, baseFilename, groups = [], pageIndex = 0) {
    if (!groups.length) {
      return [];
    }

    const results = [];

    for (let index = 0; index < groups.length; index += 1) {
      const group = groups[index];
      const baseDescriptor = {
        descriptor: group.descriptor,
        selector: group.selector,
        count: group.count,
        action: group.action,
        willLeave: group.willLeave,
        tag: group.tag,
        type: group.type,
        role: group.role,
        text: group.text,
        href: group.href
      };

      if (group.willLeave) {
        results.push({
          ...baseDescriptor,
          status: 'skipped',
          reason: 'Would navigate away from page'
        });
        continue;
      }

      if (!group.selector) {
        results.push({
          ...baseDescriptor,
          status: 'skipped',
          reason: 'No reliable selector available'
        });
        continue;
      }

      console.log(
        `[screenshot] (${pageIndex}) interaction #${index + 1}/${groups.length}: ${
          group.descriptor || group.tag
        } [${group.action}]`
      );

      try {
        const interactionFilename = this.#buildInteractionFilename(
          baseFilename,
          group,
          index + 1
        );
        const capture = await this.#interactOnFreshPage(
          browser,
          url,
          group,
          interactionFilename
        );

        if (capture) {
          results.push({
            ...baseDescriptor,
            status: 'captured',
            screenshot: capture
          });
          console.log(
            `[screenshot] (${pageIndex}) interaction #${index + 1} captured -> ${capture.path}`
          );
        } else {
          results.push({
            ...baseDescriptor,
            status: 'skipped',
            reason: 'Element not found after reload'
          });
        }
      } catch (error) {
        console.warn(
          `[screenshot] (${pageIndex}) interaction #${index + 1} failed: ${error.message}`
        );
        results.push({
          ...baseDescriptor,
          status: 'failed',
          error: error.message
        });
      }
    }

    return results;
  }

  async #interactOnFreshPage(browser, url, group, filename) {
    const context = await browser.newContext({ viewport: this.viewport });
    await context.addInitScript(() => {
      window.addEventListener(
        'submit',
        event => {
          event.preventDefault();
        },
        true
      );

      const preventLinkNavigation = event => {
        const anchor = event.target?.closest?.('a[href]');
        if (!anchor) {
          return;
        }

        const href = anchor.getAttribute('href') || '';
        if (!href || href.startsWith('#') || /^javascript:/i.test(href)) {
          return;
        }

        try {
          const linkUrl = new URL(href, window.location.href);
          const samePage =
            linkUrl.origin === window.location.origin &&
            linkUrl.pathname === window.location.pathname;
          if (!samePage) {
            event.preventDefault();
          }
        } catch {
          event.preventDefault();
        }
      };

      window.addEventListener('click', preventLinkNavigation, true);
      window.addEventListener('auxclick', preventLinkNavigation, true);
    });
    const page = await context.newPage();

    try {
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: this.timeout
      });
      await page.waitForLoadState('networkidle', {
        timeout: Math.min(this.timeout / 2, 5000)
      }).catch(() => {});

      const locator = page.locator(`css=${group.selector}`);
      if ((await locator.count()) === 0) {
        return null;
      }

      const target = locator.first();
      await target.scrollIntoViewIfNeeded();
      await this.#performAction(page, target, group.action);
      await page.waitForTimeout(INTERACTION_DELAY_MS);

      const filepath = path.join(this.screenshotsDir, filename);
      await page.screenshot({
        path: filepath,
        fullPage: true,
        type: 'png'
      });

      return {
        url,
        filename,
        path: `desktop/${filename}`,
        outputPath: filepath
      };
    } finally {
      await context.close();
    }
  }

  async #performAction(page, locator, action) {
    const timeout = Math.min(this.timeout, 5000);

    switch (action) {
      case INTERACTIVE_ACTIONS.CLICK:
        await locator.hover({ timeout }).catch(() => {});
        await locator.click({ timeout }).catch(() => locator.dispatchEvent('click'));
        break;
      case INTERACTIVE_ACTIONS.TYPE_TEXT:
        await locator.click({ timeout }).catch(() => {});
        await locator.fill(SAMPLE_INPUT_VALUE).catch(() => {});
        break;
      case INTERACTIVE_ACTIONS.CHECK_TOGGLE:
        if (await locator.isChecked().catch(() => false)) {
          await locator.uncheck({ timeout }).catch(() => {});
        } else {
          await locator.check({ timeout }).catch(() => locator.dispatchEvent('click'));
        }
        break;
      case INTERACTIVE_ACTIONS.SELECT_OPTION: {
        const option = await locator.evaluate(node => {
          if (!node || !node.options) {
            return null;
          }
          const options = Array.from(node.options);
          for (const candidate of options) {
            if (candidate.disabled) continue;
            if (!candidate.selected) {
              return {
                value: candidate.value,
                label: candidate.textContent.trim()
              };
            }
          }
          if (options.length) {
            return {
              value: options[0].value,
              label: options[0].textContent.trim()
            };
          }
          return null;
        });

        if (option?.value) {
          await locator.selectOption(option.value).catch(() => {});
        } else if (option?.label) {
          await locator.selectOption({ label: option.label }).catch(() => {});
        } else {
          await locator.focus().catch(() => {});
        }
        break;
      }
      case INTERACTIVE_ACTIONS.RANGE: {
        const handle = await locator.elementHandle();
        const box = handle ? await handle.boundingBox() : null;
        if (box) {
          await page.mouse.move(box.x + 2, box.y + box.height / 2);
          await page.mouse.down();
          await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2, {
            steps: 5
          });
          await page.mouse.up();
        } else {
          await locator.focus().catch(() => {});
          await page.keyboard.press('ArrowRight').catch(() => {});
        }
        break;
      }
      case INTERACTIVE_ACTIONS.HOVER:
      default:
        await locator.hover({ timeout }).catch(() => locator.focus());
        break;
    }
  }

  #buildInteractionFilename(baseFilename, descriptor, index) {
    const base = path.parse(baseFilename).name || 'page';
    const ext = path.extname(baseFilename) || '.png';
    const label = descriptor?.descriptor || `interaction-${index}`;
    const slug = slugify(label, `interaction-${index}`);
    return `${base}__interaction-${String(index).padStart(2, '0')}-${slug}${ext}`;
  }

  async #deduplicateScreenshots(successful = []) {
    const seen = [];
    const removed = [];

    const processRecord = async (entry, interaction = null) => {
      const target = interaction ? interaction.screenshot : entry;
      if (!target?.outputPath || !(await fs.pathExists(target.outputPath))) {
        return;
      }

      const hash = await this.#computeImageHash(target.outputPath);
      if (!hash) {
        return;
      }

      const match = this.#findSimilarHash(seen, hash);
      if (match) {
        const keeper = match;
        removed.push({
          removed: {
            type: interaction ? 'interaction' : 'base',
            url: entry.url,
            filename: target.filename
          },
          kept: {
            type: keeper.interaction ? 'interaction' : 'base',
            url: keeper.entry.url,
            filename: keeper.target.filename
          }
        });

        await fs.remove(target.outputPath).catch(() => {});

        if (interaction) {
          interaction.status = 'duplicate';
          interaction.duplicateOf = {
            url: keeper.entry.url,
            filename: keeper.target.filename
          };
          interaction.screenshot = { ...keeper.target };
        } else {
          entry.duplicate = true;
          entry.duplicateOf = {
            url: keeper.entry.url,
            filename: keeper.target.filename
          };
          entry.removedFilename = entry.filename;
          entry.filename = keeper.target.filename;
          entry.path = keeper.target.path;
          entry.outputPath = keeper.target.outputPath;
        }
      } else {
        seen.push({ hash, entry, interaction, target });
      }
    };

    for (const entry of successful) {
      await processRecord(entry);
      for (const interaction of entry.interactions || []) {
        if (interaction.status === 'captured' && interaction.screenshot) {
          await processRecord(entry, interaction);
        }
      }
    }

    return {
      totalDuplicates: removed.length,
      removed
    };
  }

  async #computeImageHash(filePath) {
    try {
      const data = await sharp(filePath)
        .greyscale()
        .resize(16, 16, { fit: 'fill' })
        .raw()
        .toBuffer();

      const avg = data.reduce((sum, value) => sum + value, 0) / data.length;
      return Array.from(data, value => (value > avg ? 1 : 0));
    } catch {
      return null;
    }
  }

  #findSimilarHash(seen, hash) {
    const threshold = 5; // allow small visual differences
    for (const candidate of seen) {
      const distance = this.#hammingDistance(hash, candidate.hash);
      if (distance <= threshold) {
        return candidate;
      }
    }
    return null;
  }

  #hammingDistance(hashA = [], hashB = []) {
    const length = Math.min(hashA.length, hashB.length);
    let distance = 0;
    for (let i = 0; i < length; i += 1) {
      if (hashA[i] !== hashB[i]) {
        distance += 1;
      }
    }
    return distance + Math.abs(hashA.length - hashB.length);
  }
}

module.exports = { ScreenshotService, buildFilename };
