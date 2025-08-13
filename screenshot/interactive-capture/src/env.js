'use strict';

class EnvironmentGuard {
  constructor(page) {
    this.page = page;
    this.currentDomain = null;
  }

  async init() {
    const currentUrl = this.page.url();
    this.currentDomain = new URL(currentUrl).hostname.toLowerCase().replace(/^www\./, '');
    await this._setupRouteBlocker();
  }

  async _setupRouteBlocker() {
    await this.page.route('**/*', (route, request) => {
      const url = request.url();
      try {
        const requestDomain = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
        if (requestDomain !== this.currentDomain && request.isNavigationRequest()) {
          console.log(`🚫 BLOCKED external navigation to: ${url}`);
          route.abort();
          return;
        }
      } catch (_) { /* allow if cannot parse */ }
      route.continue();
    });
  }

  async isExternalLink(selector) {
    return await this.page.evaluate((sel, currentDomain) => {
      const el = document.querySelector(sel);
      if (!el || el.tagName !== 'A') return false;
      const href = el.href;
      if (!href) return false;
      try {
        const linkDomain = new URL(href).hostname.toLowerCase().replace(/^www\./, '');
        const isExternal = linkDomain !== currentDomain;
        if (isExternal) console.log(`🚫 Detected external link: ${href} (domain: ${linkDomain}) - will skip`);
        return isExternal;
      } catch (_) {
        return true;
      }
    }, selector, this.currentDomain);
  }
}

module.exports = { EnvironmentGuard };
