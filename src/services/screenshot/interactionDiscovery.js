const { INTERACTIVE_SELECTOR, INTERACTIVE_ACTIONS } = require('./constants');

async function discoverInteractiveGroups(page) {
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

        nodes.forEach((node, index) => {
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
            href,
            order: index,
            navigationMeta: {
              inNavigationRegion: Boolean(
                node.closest?.(
                  'nav, [role="navigation"], [role="tablist"], [data-nav], [data-tabs], [data-menu]'
                )
              ),
              ariaControls: node.getAttribute('aria-controls') || '',
              ariaExpanded: node.getAttribute('aria-expanded') || '',
              ariaHaspopup: node.getAttribute('aria-haspopup') || '',
              ariaPressed: node.getAttribute('aria-pressed') || '',
              tabindex: node.getAttribute('tabindex') || '',
              dataToggle: node.getAttribute('data-toggle') || '',
              dataTarget: node.getAttribute('data-target') || ''
            }
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
        const existing = grouped.get(item.signature);
        existing.count += 1;
        existing.order = Math.min(existing.order, item.order);
      }
    });

    const prioritized = Array.from(grouped.values());
    const determinePriority = item => {
      if (item.willLeave) {
        return 5;
      }
      if (item.action === actions.TYPE_TEXT) {
        return 0;
      }
      if (
        item.action === actions.CHECK_TOGGLE ||
        item.action === actions.RANGE ||
        item.action === actions.SELECT_OPTION
      ) {
        return 1;
      }
      if (item.action === actions.HOVER) {
        return 2;
      }

      const navIndicators =
        item.role === 'tab' ||
        item.role === 'menuitem' ||
        item.navigationMeta?.inNavigationRegion ||
        Boolean(item.navigationMeta?.ariaControls) ||
        item.navigationMeta?.ariaHaspopup === 'true' ||
        /tab/i.test(item.navigationMeta?.dataToggle || '') ||
        /tab/i.test(item.navigationMeta?.dataTarget || '') ||
        (item.navigationMeta?.tabindex && Number(item.navigationMeta.tabindex) === 0);
      if (navIndicators) {
        return 4;
      }

      return 3;
    };

    prioritized.forEach(item => {
      item.priority = determinePriority(item);
    });

    prioritized.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return a.order - b.order;
    });

    return prioritized;
  }

module.exports = { discoverInteractiveGroups };
