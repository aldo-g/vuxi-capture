'use strict';

class Screenshotter {
  constructor(page, options, validator) {
    this.page = page;
    this.options = options;
    this.validator = validator;
    this.screenshots = [];
  }

  async takeScreenshotWithQualityCheck(filename, { force = false, tags = [], clip = null } = {}) {
    try {
      if (!force) {
        const ok = await this.validator.shouldTakeScreenshot();
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
}

module.exports = { Screenshotter };
