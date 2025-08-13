'use strict';

class ElementDiscovery {
  constructor(page, options, env) {
    this.page = page;
    this.options = options;
    this.env = env;
  }

  async discoverInteractiveElements() {
    const elements = await this.page.evaluate((args) => {
      const { options, currentDomain } = args;
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
        { name: 'navigation', priority: 95, selectors: ['a[href]','nav a','[role="link"]'], get: el => {
          if (el.tagName === 'A' && el.href) {
            try {
              const linkDomain = new URL(el.href).hostname.toLowerCase().replace(/^www\./, '');
              if (linkDomain !== currentDomain) {
                console.log(`🚫 Skipping external link during discovery: ${el.href}`);
                return null;
              }
            } catch (e) { return null; }
          }
          return el.closest('nav') ? 'nav-link' : (el.href && el.href.includes('#') ? 'anchor-link' : 'link');
        }},
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

            const elementType = c.get(el);
            if (!elementType) return;

            const id = el.outerHTML;
            if (seen.has(id)) return;
            seen.add(id);
            out.push({
              selector: getSelector(el),
              type: c.name,
              subtype: elementType,
              text: t.substring(0, 100),
              priority: c.priority
            });
          });
        } catch (_) {}
      }));

      return out.sort((a, b) => b.priority - a.priority).slice(0, options.maxInteractions);
    }, { options: this.options, currentDomain: this.env.currentDomain });

    const filtered = [];
    for (const el of elements) {
      if (el.type === 'navigation' && el.selector) {
        const external = await this.env.isExternalLink(el.selector);
        if (external) { console.log(`🚫 Server-side filtered external link: ${el.selector}`); continue; }
      }
      filtered.push(el);
    }
    return filtered;
  }
}

module.exports = { ElementDiscovery };