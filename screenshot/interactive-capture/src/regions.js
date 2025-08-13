'use strict';

class RegionLocator {
  constructor(page, options) {
    this.page = page;
    this.options = options;
  }

  async waitForTabActivation(elementData, timeout) {
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
      }, elementData.selector, { timeout });
    } catch (_) {}
  }

  async getAnchorTargetInfo(selector) {
    return await this.page.evaluate((sel) => {
      const el = document.querySelector(sel);
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
    }, selector);
  }

  async getTabPanelRect(selector) {
    return await this.page.evaluate((sel) => {
      const el = document.querySelector(sel);
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
    }, selector);
  }
}

module.exports = { RegionLocator };
