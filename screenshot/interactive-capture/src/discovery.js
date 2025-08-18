'use strict';

class ElementDiscovery {
  constructor(page, options, env) {
    this.page = page;
    this.options = options;
    this.env = env;
  }

  async discoverInteractiveElements() {
    console.log(`🚨 NEW DISCOVERY CODE IS RUNNING! maxInteractionsPerType = ${this.options.maxInteractionsPerType} 🚨`);
    
    const elements = await this.page.evaluate((args) => {
      const { options, currentDomain } = args;
      const out = [], seen = new Set();

      const getSelector = (el) => {
        // Strategy 1: Use ID if available
        if (el.id) return `#${CSS.escape(el.id)}`;
        
        // Strategy 2: Use text content for buttons to make them unique
        if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') {
          const textContent = (el.textContent || '').trim();
          if (textContent) {
            // Try to create a selector that includes the text content
            const escapedText = textContent.replace(/[^\w\s]/g, '').toLowerCase();
            if (escapedText) {
              // Use a combination of tag and text content
              const textSelector = `button:contains("${textContent}")`;
              // Since :contains() isn't standard CSS, we'll use a more robust approach
              const buttonWithText = `button[data-button-text="${escapedText}"]`;
              // Set a temporary attribute for better selection
              el.setAttribute('data-button-text', escapedText);
              return buttonWithText;
            }
          }
        }

        // Strategy 3: Use classes but be more specific
        if (el.className && typeof el.className === 'string') {
          const classes = el.className.trim().split(/\s+/).filter(c => c && /^[a-zA-Z_-]/.test(c));
          if (classes.length) {
            // For buttons with similar classes, try to find distinguishing classes
            const distinctiveClasses = classes.filter(cls => 
              !['relative', 'z-10', 'px-6', 'py-3', 'text-base', 'rounded-full', 'transition-all', 'duration-300', 'active:scale-95', 'select-none', 'whitespace-nowrap'].includes(cls)
            );
            
            if (distinctiveClasses.length > 0) {
              return `${el.tagName.toLowerCase()}.${distinctiveClasses.slice(0, 3).map(CSS.escape).join('.')}`;
            } else {
              // Fall back to using more classes for specificity
              return `${el.tagName.toLowerCase()}.${classes.slice(0, 4).map(CSS.escape).join('.')}`;
            }
          }
        }

        // Strategy 4: Use position-based selector for similar elements
        const parent = el.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter(child => 
            child.tagName === el.tagName && 
            child.className === el.className
          );
          
          if (siblings.length > 1) {
            const index = siblings.indexOf(el);
            if (index >= 0) {
              // Create a more specific selector using nth-child
              const parentSelector = parent.id ? `#${CSS.escape(parent.id)}` : 
                                   parent.className ? `.${parent.className.split(/\s+/)[0]}` : 
                                   parent.tagName.toLowerCase();
              return `${parentSelector} > ${el.tagName.toLowerCase()}:nth-child(${index + 1})`;
            }
          }
        }

        // Strategy 5: Use aria attributes or data attributes
        const ariaLabel = el.getAttribute('aria-label');
        if (ariaLabel) {
          return `[aria-label="${ariaLabel}"]`;
        }

        const dataAttrs = Array.from(el.attributes).filter(attr => attr.name.startsWith('data-'));
        if (dataAttrs.length > 0) {
          const dataAttr = dataAttrs[0];
          return `[${dataAttr.name}="${dataAttr.value}"]`;
        }

        // Strategy 6: Create unique identifier as last resort
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
          if (t) {
            return `button:${t.replace(/\s+/g, '_').substring(0, 20)}`;
          }
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
          const t = text(el);
          const baseType = el.closest('nav') ? 'nav-link' : (el.href && el.href.includes('#') ? 'anchor-link' : 'link');
          if (t) {
            return `${baseType}:${t.replace(/\s+/g, '_').substring(0, 20)}`;
          }
          return baseType;
        }},
        { name: 'expandable', priority: 80, selectors: ['details','[aria-expanded]','.accordion','.collapsible','.expandable'], get: el => el.tagName === 'DETAILS' ? 'details' : (el.hasAttribute('aria-expanded') ? 'aria-expandable' : 'expandable') },
        { name: 'forms', priority: 75, selectors: ['input:not([type="hidden"])','select','textarea'], get: el => el.type || el.tagName.toLowerCase() },
        { name: 'modal-triggers', priority: 70, selectors: ['[data-toggle="modal"]','[data-modal]','.modal-trigger'], get: () => 'modal-trigger' },
        { name: 'interactive-generic', priority: 60, selectors: ['[onclick]','[onmouseover]','[data-action]'], get: el => el.hasAttribute('onclick') ? 'onclick' : (el.hasAttribute('onmouseover') ? 'hover' : 'data-action') }
      ];

      // Create a map to track elements by their text content to ensure uniqueness
      const elementsByText = new Map();
      const uniqueSignatures = new Set(); 
      const allCandidates = [];

      console.log(`🎯 PRE-DISCOVERY: Starting element discovery with maxInteractionsPerType = ${options.maxInteractionsPerType}`);

      cats.forEach(c => c.selectors.forEach(sel => {
        try {
          document.querySelectorAll(sel).forEach(el => {
            if (!interactive(el)) return;
            const t = text(el);
            if (skip(el, t)) return;

            const elementType = c.get(el);
            if (!elementType) return;

            const signature = `${el.tagName}_${el.className}_${t}`;
            if (uniqueSignatures.has(signature)) {
                console.log(`🔄 Skipping duplicate element with signature: "${signature}"`);
                return;
            }
            uniqueSignatures.add(signature);

            const uniqueKey = `${el.tagName}_${el.className}_${t}_${el.getAttribute('aria-label') || ''}_${el.outerHTML.slice(0, 200)}`;
            if (seen.has(uniqueKey)) return;
            seen.add(uniqueKey);

            if (c.name === 'explicit' && t) {
              if (elementsByText.has(t)) {
                console.log(`🔄 Skipping duplicate button with text: "${t}"`);
                return;
              }
              elementsByText.set(t, el);
            }

            const selector = getSelector(el);
            
            try {
              const testElements = document.querySelectorAll(selector);
              if (testElements.length !== 1 || testElements[0] !== el) {
                console.log(`⚠️ Selector not unique for element with text "${t}": ${selector}`);
                const moreSpecificSelector = el.getAttribute('data-interactive-id') ? 
                  `[data-interactive-id="${el.getAttribute('data-interactive-id')}"]` : 
                  getSelector(el);
                
                const retest = document.querySelectorAll(moreSpecificSelector);
                if (retest.length === 1 && retest[0] === el) {
                  console.log(`✅ Fixed selector for "${t}": ${moreSpecificSelector}`);
                  allCandidates.push({
                    selector: moreSpecificSelector,
                    type: c.name,
                    subtype: elementType,
                    text: t.substring(0, 100),
                    priority: c.priority
                  });
                  return;
                }
              }
            } catch (e) {
              console.log(`❌ Selector validation failed for "${t}": ${e.message}`);
            }

            allCandidates.push({
              selector: selector,
              type: c.name,
              subtype: elementType,
              text: t.substring(0, 100),
              priority: c.priority
            });
          });
        } catch (e) {
          console.log(`❌ Error processing selector ${sel}: ${e.message}`);
        }
      }));

      console.log(`🎯 PRE-LIMIT: Found ${allCandidates.length} total candidates`);

      // CRITICAL FIX: Apply selector-based limiting to the final output
      const selectorCounts = {};
      
      // Sort by priority first
      allCandidates.sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return (a.text || '').localeCompare(b.text || '');
      });
      
      // Then apply selector limits
      for (const element of allCandidates) {
        if (!selectorCounts[element.selector]) {
          selectorCounts[element.selector] = 0;
        }
        
        if (selectorCounts[element.selector] < options.maxInteractionsPerType) {
          selectorCounts[element.selector]++;
          out.push(element);
          console.log(`✅ KEEPING: "${element.selector}" with text "${element.text}" (count: ${selectorCounts[element.selector]}/${options.maxInteractionsPerType})`);
        } else {
          console.log(`🔄 LIMITING: Skipping "${element.selector}" with text "${element.text}" - reached limit (${options.maxInteractionsPerType})`);
        }
        
        // Respect overall maxInteractions limit
        if (out.length >= options.maxInteractions) {
          console.log(`🛑 Reached maxInteractions limit: ${options.maxInteractions}`);
          break;
        }
      }
      
      console.log(`🔢 FINAL SELECTOR COUNTS:`, selectorCounts);
      console.log(`🎯 FINAL OUTPUT: ${out.length} elements after selector limiting`);
      
      return out;

    }, { options: this.options, currentDomain: this.env.currentDomain });

    const filtered = [];
    for (const el of elements) {
      if (el.type === 'navigation' && el.selector) {
        const external = await this.env.isExternalLink(el.selector);
        if (external) { console.log(`🚫 Server-side filtered external link: ${el.selector}`); continue; }
      }
      filtered.push(el);
    }
    
    console.log(`🎯 FINAL FILTERED: ${filtered.length} elements after external link filtering`);
    return filtered;
  }
}

module.exports = { ElementDiscovery };