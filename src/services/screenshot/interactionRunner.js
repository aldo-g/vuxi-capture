const path = require('path');
const {
  INTERACTIVE_ACTIONS,
  INTERACTION_DELAY_MS,
  SAMPLE_INPUT_VALUE
} = require('./constants');
const { buildInteractionFilename } = require('./fileNaming');
const { waitForImages, waitForPageSettled } = require('./pageReadiness');

class InteractionRunner {
  constructor(options = {}) {
    this.screenshotsDir = options.screenshotsDir;
    this.timeout = options.timeout ?? 30000;
    this.mediaWaitTimeout = options.mediaWaitTimeout ?? 5000;
    this.pageSettleTimeout = options.pageSettleTimeout ?? 8000;
    this.stableWaitTime = options.stableWaitTime ?? 600;
    this.resetBetweenInteractions = options.resetBetweenInteractions ?? false;
    this.retryWithPageReload = options.retryWithPageReload ?? false;
  }

  async capture({ page, url, baseFilename, groups = [], pageIndex = 0 }) {
    if (!page) {
      throw new Error('InteractionRunner.capture requires a page instance');
    }
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

      if (this.resetBetweenInteractions && index > 0) {
        await this.#resetPage(page, url, pageIndex, `interaction #${index + 1}`);
      }

      console.log(
        `[screenshot] (${pageIndex}) interaction #${index + 1}/${groups.length}: ${
          group.descriptor || group.tag
        } [${group.action}]`
      );

      try {
        const interactionFilename = buildInteractionFilename(
          baseFilename,
          group,
          index + 1
        );
        const capture = await this.#captureOnCurrentPage({
          page,
          url,
          group,
          filename: interactionFilename
        });

        if (capture) {
          results.push({
            ...baseDescriptor,
            status: 'captured',
            screenshot: capture
          });
          console.log(
            `[screenshot] (${pageIndex}) interaction #${index + 1} captured -> ${capture.path}`
          );
          continue;
        }

        if (this.retryWithPageReload) {
          console.log(
            `[screenshot] (${pageIndex}) interaction #${index + 1} retrying after reload`
          );
          await this.#resetPage(page, url, pageIndex, `interaction retry #${index + 1}`);
          const retryCapture = await this.#captureOnCurrentPage({
            page,
            url,
            group,
            filename: interactionFilename
          });
          if (retryCapture) {
            results.push({
              ...baseDescriptor,
              status: 'captured',
              screenshot: retryCapture
            });
            console.log(
              `[screenshot] (${pageIndex}) interaction #${index + 1} captured after reload -> ${retryCapture.path}`
            );
            continue;
          }
        }

        results.push({
          ...baseDescriptor,
          status: 'skipped',
          reason: 'Element not found on page'
        });
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

  async #captureOnCurrentPage({ page, url, group, filename }) {
    const locator = page.locator(`css=${group.selector}`);
    if ((await locator.count()) === 0) {
      return null;
    }

    const target = locator.first();
    await target.scrollIntoViewIfNeeded();
    await this.#performAction(page, target, group.action);
    await page.waitForTimeout(INTERACTION_DELAY_MS);
    await this.#waitForReadiness(page, url, `interaction after ${group.action}`);

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
  }

  async #resetPage(page, url, pageIndex, contextLabel) {
    console.log(
      `[screenshot] (${pageIndex}) resetting page before ${contextLabel}`
    );
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: this.timeout
    });
    await page.waitForLoadState('networkidle', {
      timeout: Math.min(this.timeout / 2, 5000)
    }).catch(() => {});
    await this.#waitForReadiness(page, url, contextLabel);
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

  async #waitForReadiness(page, url, phase) {
    const settled = await waitForPageSettled(page, {
      timeout: this.pageSettleTimeout,
      stableMillis: this.stableWaitTime
    });
    if (!settled) {
      console.warn(
        `[screenshot] ${phase} continuing before DOM settled on ${url}`
      );
    }

    const imagesReady = await waitForImages(page, {
      timeout: this.mediaWaitTimeout
    });
    if (!imagesReady) {
      console.warn(
        `[screenshot] ${phase} continuing before all images finished loading on ${url}`
      );
    }

    return settled && imagesReady;
  }
}

module.exports = { InteractionRunner };
