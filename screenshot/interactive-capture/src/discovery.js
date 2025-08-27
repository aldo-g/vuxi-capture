'use strict';

class ElementDiscovery {
  constructor(page, options, env) {
    this.page = page;
    this.options = options;
    this.env = env;
  }

  async discoverInteractiveElements() {
    console.log(`🚨 ENHANCED DISCOVERY CODE IS RUNNING! maxInteractionsPerType = ${this.options.maxInteractionsPerType} 🚨`);
    
    const elements = await this.page.evaluate((args) => {
      const { options, currentDomain } = args;
      const out = [], seen = new Set();
      
      // Enhanced selector generation with better reliability
      const getSelector = (el) => {
        const strategies = [];
        
        // Strategy 1: Use stable data attributes first
        const stableAttrs = ['data-testid', 'data-cy', 'data-qa', 'id'];
        for (const attr of stableAttrs) {
          const value = attr === 'id' ? el.id : el.getAttribute(attr);
          if (value) {
            const selector = attr === 'id' ? `#${CSS.escape(value)}` : `[${attr}="${CSS.escape(value)}"]`;
            strategies.push({ selector, priority: 10, type: attr });
          }
        }
        
        // Strategy 2: Enhanced button text handling
        if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' || el.matches('input[type="submit"], input[type="button"]')) {
          const textContent = (el.textContent || '').trim();
          if (textContent && textContent.length > 0 && textContent.length < 100) {
            const escapedText = textContent.replace(/[^\w\s]/g, '').toLowerCase().trim();
            if (escapedText && escapedText.length > 0) {
              // Set the attribute immediately
              el.setAttribute('data-button-text', escapedText);
              
              // Create multiple selector options for reliability
              strategies.push({ 
                selector: `button[data-button-text="${escapedText}"]`, 
                priority: 9, 
                type: 'button-text' 
              });
              
              // Also try with tag-agnostic approach
              strategies.push({ 
                selector: `[data-button-text="${escapedText}"]`, 
                priority: 8, 
                type: 'button-text-generic' 
              });
            }
          }
        }
        
        // Strategy 3: Enhanced navigation and interactive element handling
        if (el.tagName === 'A' || el.getAttribute('role') === 'link') {
          // Handle data-panel navigation
          if (el.hasAttribute('data-panel')) {
            const panelValue = el.getAttribute('data-panel');
            strategies.push({
              selector: `a[data-panel="${panelValue}"]`,
              priority: 10,
              type: 'data-panel'
            });
          }
          
          // Handle class-based navigation
          if (el.classList.contains('panel_link')) {
            const linkText = (el.textContent || '').trim();
            if (linkText && linkText.length > 0 && linkText.length < 50) {
              const escapedText = linkText.replace(/[^\w\s]/g, '').toLowerCase().trim();
              if (escapedText) {
                el.setAttribute('data-nav-text', escapedText);
                strategies.push({ 
                  selector: `a.panel_link[data-nav-text="${escapedText}"]`, 
                  priority: 9, 
                  type: 'panel-link-text' 
                });
              }
            }
            strategies.push({
              selector: 'a.panel_link',
              priority: 8,
              type: 'panel-link-class'
            });
          }
          
          // Handle regular navigation links
          const linkText = (el.textContent || '').trim();
          if (linkText && linkText.length > 0 && linkText.length < 50) {
            const escapedText = linkText.replace(/[^\w\s]/g, '').toLowerCase().trim();
            if (escapedText) {
              el.setAttribute('data-nav-text', escapedText);
              strategies.push({ 
                selector: `a[data-nav-text="${escapedText}"]`, 
                priority: 7, 
                type: 'nav-text' 
              });
            }
          }
        }
        
        // Strategy 4: Use distinctive classes but be smarter about it
        if (el.className && typeof el.className === 'string') {
          const classes = el.className.trim().split(/\s+/).filter(c => c && /^[a-zA-Z_-]/.test(c));
          if (classes.length) {
            // Filter out common utility classes
            const distinctiveClasses = classes.filter(cls => 
              !['relative', 'absolute', 'z-10', 'z-20', 'px-1', 'px-2', 'px-3', 'px-4', 'px-5', 'px-6', 
                'py-1', 'py-2', 'py-3', 'py-4', 'py-5', 'py-6', 'text-sm', 'text-base', 'text-lg', 
                'rounded', 'rounded-full', 'rounded-lg', 'transition', 'transition-all', 'duration-300', 
                'duration-200', 'active:scale-95', 'select-none', 'whitespace-nowrap', 'cursor-pointer',
                'hover:opacity-80', 'focus:outline-none', 'inline-block', 'block', 'flex', 'items-center',
                'justify-center', 'w-full', 'h-full'].includes(cls)
            );
            
            // Prioritize meaningful classes for interactive elements
            const meaningfulClasses = classes.filter(cls =>
              ['member', 'panel_link', 'card', 'nav-link', 'button', 'btn', 'link', 'interactive', 'clickable', 'hover'].some(meaningful => cls.includes(meaningful))
            );
            
            if (meaningfulClasses.length > 0) {
              strategies.push({ 
                selector: `${el.tagName.toLowerCase()}.${meaningfulClasses.slice(0, 2).map(CSS.escape).join('.')}`, 
                priority: 7, 
                type: 'meaningful-class' 
              });
            } else if (distinctiveClasses.length > 0) {
              strategies.push({ 
                selector: `${el.tagName.toLowerCase()}.${distinctiveClasses.slice(0, 2).map(CSS.escape).join('.')}`, 
                priority: 6, 
                type: 'distinctive-class' 
              });
            } else if (classes.length <= 3) {
              strategies.push({ 
                selector: `${el.tagName.toLowerCase()}.${classes.slice(0, 2).map(CSS.escape).join('.')}`, 
                priority: 5, 
                type: 'utility-class' 
              });
            }
          }
        }
        
        // Strategy 5: Position-based selector for similar elements
        const parent = el.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter(child => 
            child.tagName === el.tagName
          );
          
          if (siblings.length > 1 && siblings.length <= 10) {
            const index = siblings.indexOf(el);
            if (index >= 0) {
              let parentSelector = '';
              if (parent.id) {
                parentSelector = `#${CSS.escape(parent.id)}`;
              } else if (parent.className) {
                const parentClasses = parent.className.trim().split(/\s+/);
                if (parentClasses.length > 0) {
                  parentSelector = `.${parentClasses[0]}`;
                }
              } else {
                parentSelector = parent.tagName.toLowerCase();
              }
              
              strategies.push({ 
                selector: `${parentSelector} > ${el.tagName.toLowerCase()}:nth-child(${index + 1})`, 
                priority: 4, 
                type: 'position-based' 
              });
            }
          }
        }
        
        // Strategy 6: Create and use unique identifier as fallback
        const uid = 'elem-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
        el.setAttribute('data-interactive-id', uid);
        strategies.push({ 
          selector: `[data-interactive-id="${uid}"]`, 
          priority: 3, 
          type: 'generated-id' 
        });
        
        // Sort by priority (higher priority first) and return the best one
        strategies.sort((a, b) => b.priority - a.priority);
        
        // Validate the top strategies
        for (const strategy of strategies.slice(0, 3)) {
          try {
            const testElements = document.querySelectorAll(strategy.selector);
            if (testElements.length === 1 && testElements[0] === el) {
              console.log(`✅ Selected strategy "${strategy.type}" for element: ${strategy.selector}`);
              return strategy.selector;
            } else if (testElements.length > 1) {
              console.log(`⚠️ Strategy "${strategy.type}" not unique (${testElements.length} matches): ${strategy.selector}`);
            }
          } catch (e) {
            console.log(`❌ Strategy "${strategy.type}" validation failed: ${e.message}`);
          }
        }
        
        // If no strategy worked, return the generated ID as absolute fallback
        console.log(`⚠️ Using fallback generated ID for element`);
        return `[data-interactive-id="${uid}"]`;
      };

      // Enhanced element visibility and interaction checks
      const interactive = (el) => {
        // Basic visibility checks
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        
        const s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
        
        // Check if element is actually clickable
        if (s.pointerEvents === 'none') return false;
        
        // Ensure element is not completely outside viewport
        if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) {
          return false;
        }
        
        // Check if element is covered by other elements (basic check)
        const centerX = r.left + r.width / 2;
        const centerY = r.top + r.height / 2;
        const elementAtCenter = document.elementFromPoint(centerX, centerY);
        
        if (elementAtCenter && elementAtCenter !== el && !el.contains(elementAtCenter)) {
          // Element might be covered, but allow some exceptions
          const coveringStyle = getComputedStyle(elementAtCenter);
          if (coveringStyle.pointerEvents !== 'none' && elementAtCenter.tagName !== 'svg') {
            console.log(`⚠️ Element might be covered by ${elementAtCenter.tagName}`);
          }
        }
        
        return true;
      };

      const text = (el) => {
        let textContent = '';
        
        // Try multiple text extraction methods
        if (el.textContent && el.textContent.trim()) {
          textContent = el.textContent.trim();
        } else if (el.innerText && el.innerText.trim()) {
          textContent = el.innerText.trim();
        } else if (el.getAttribute('aria-label')) {
          textContent = el.getAttribute('aria-label');
        } else if (el.getAttribute('title')) {
          textContent = el.getAttribute('title');
        } else if (el.getAttribute('alt')) {
          textContent = el.getAttribute('alt');
        }
        
        return textContent.toLowerCase();
      };

      const skip = (el, t) => {
        // Skip cookie-related elements
        const cookiePatterns = ['cookie', 'consent', 'privacy', 'gdpr', 'cky-', 'necessary only', 'accept all'];
        const elementHtml = el.outerHTML.toLowerCase();
        const elementClasses = (el.className || '').toLowerCase();
        const elementId = (el.id || '').toLowerCase();
        
        const isCookieElement = cookiePatterns.some(pattern => 
          t.includes(pattern) || 
          elementHtml.includes(pattern) || 
          elementClasses.includes(pattern) ||
          elementId.includes(pattern)
        );
        
        if (isCookieElement) {
          console.log(`🚫 Skipping cookie-related element: ${t.substring(0, 30)}`);
          return true;
        }
        
        if (!options.skipSocialElements) return false;
        
        // Skip elements that are too small to be meaningful
        const r = el.getBoundingClientRect();
        if (r.width < 10 || r.height < 10) return true;
        
        const problematicPatterns = ['facebook','twitter','instagram','linkedin','youtube','share','tweet','follow','subscribe','like','upvote','advertisement','sponsored','promo'];
        const hasProblematicContent = problematicPatterns.some(s => t.includes(s) || elementHtml.includes(s));
        
        if (hasProblematicContent) {
          console.log(`🚫 Skipping social/promotional element: ${t.substring(0, 30)}`);
        }
        
        return hasProblematicContent;
      };

      // Enhanced categorization with better priorities
      const cats = [
        { 
          name: 'tabs', 
          priority: options.tabsFirst ? 98 : 85, 
          selectors: ['[role="tab"]', '.tab:not(.tab-content)', '.tab-button', '[data-tab]', '.nav-tabs a', '.nav-link[role="tab"]'], 
          get: () => 'tab' 
        },
        { 
          name: 'explicit', 
          priority: 96, 
          selectors: ['button:not([disabled])','input[type="submit"]:not([disabled])','input[type="button"]:not([disabled])','[role="button"]:not([disabled])'], 
          get: el => {
            const t = text(el);
            if (t.includes('submit') || t.includes('send')) return 'submit';
            if (t.includes('search')) return 'search';
            if (t.includes('next') || t.includes('continue')) return 'navigation';
            if (t.includes('close') || t.includes('dismiss')) return 'close';
            if (t.includes('show') || t.includes('expand')) return 'expand';
            if (t) {
              return `button:${t.replace(/\s+/g, '_').substring(0, 20)}`;
            }
            return 'button';
          }
        },
        { 
          name: 'navigation', 
          priority: 95, 
          selectors: [
            'a[href]:not([href=""])', 
            'nav a', 
            '[role="link"]', 
            'a[href="javascript:;"]', // Include JavaScript links
            'a[data-panel]', // Panel triggers
            'a[data-target]', // Target elements
            '.panel_link', // Specific to this site's navigation
            '[data-action]', // Elements with data actions
            'a[onclick]' // Links with onclick handlers
          ], 
          get: el => {
            // Handle JavaScript and data-driven navigation
            if (el.hasAttribute('data-panel') || el.hasAttribute('data-target') || el.classList.contains('panel_link')) {
              const t = text(el);
              return t ? `panel-nav:${t.replace(/\s+/g, '_').substring(0, 20)}` : 'panel-nav';
            }
            
            // Handle onclick navigation
            if (el.hasAttribute('onclick') || el.href === 'javascript:;') {
              const t = text(el);
              return t ? `js-nav:${t.replace(/\s+/g, '_').substring(0, 20)}` : 'js-nav';
            }
            
            // Handle regular navigation
            if (el.tagName === 'A' && el.href && !el.href.startsWith('javascript:')) {
              try {
                const linkDomain = new URL(el.href).hostname.toLowerCase().replace(/^www\./, '');
                if (linkDomain !== currentDomain) {
                  console.log(`🚫 Skipping external link during discovery: ${el.href}`);
                  return null;
                }
              } catch (e) { 
                // Invalid URL, but might still be a valid internal link
                console.log(`⚠️ Could not parse URL: ${el.href}, treating as internal`);
              }
            }
            
            const t = text(el);
            const baseType = el.closest('nav') ? 'nav-link' : (el.href && el.href.includes('#') ? 'anchor-link' : 'link');
            if (t) {
              return `${baseType}:${t.replace(/\s+/g, '_').substring(0, 20)}`;
            }
            return baseType;
          }
        },
        { 
          name: 'expandable', 
          priority: 80, 
          selectors: ['details:not([disabled])','[aria-expanded]:not([disabled])','.accordion:not([disabled])','.collapsible:not([disabled])','.expandable:not([disabled])'], 
          get: el => {
            if (el.tagName === 'DETAILS') return 'details';
            if (el.hasAttribute('aria-expanded')) return 'aria-expandable';
            return 'expandable';
          }
        },
        { 
          name: 'forms', 
          priority: 75, 
          selectors: ['input:not([type="hidden"]):not([disabled])','select:not([disabled])','textarea:not([disabled])'], 
          get: el => el.type || el.tagName.toLowerCase() 
        },
        { 
          name: 'modal-triggers', 
          priority: 70, 
          selectors: ['[data-toggle="modal"]:not([disabled])','[data-modal]:not([disabled])','.modal-trigger:not([disabled])'], 
          get: () => 'modal-trigger' 
        },
        {
          name: 'hover-interactive',
          priority: 68,
          selectors: ['.member', '.card', '.team-member', '.hover-card', '[data-hover]', '.interactive-card'],
          get: el => {
            const t = text(el);
            if (t) {
              return `hover-card:${t.replace(/\s+/g, '_').substring(0, 20)}`;
            }
            return 'hover-card';
          }
        },
        { 
          name: 'interactive-generic', 
          priority: 60, 
          selectors: ['[onclick]:not([disabled])','[data-action]:not([disabled])'], 
          get: el => {
            if (el.hasAttribute('onclick')) return 'onclick';
            if (el.hasAttribute('data-action')) return 'data-action';
            return 'interactive';
          }
        }
      ];

      const elementsByText = new Map();
      const uniqueSignatures = new Set(); 
      const allCandidates = [];

      console.log(`🎯 PRE-DISCOVERY: Starting element discovery with maxInteractionsPerType = ${options.maxInteractionsPerType}`);

      cats.forEach(c => c.selectors.forEach(sel => {
        try {
          document.querySelectorAll(sel).forEach(el => {
            if (!interactive(el)) {
              console.log(`❌ Element not interactive: ${sel}`);
              return;
            }
            
            const t = text(el);
            if (skip(el, t)) {
              console.log(`🚫 Skipping element: ${t.substring(0, 30)}`);
              return;
            }

            const elementType = c.get(el);
            if (!elementType) {
              console.log(`❌ No element type returned for: ${sel}`);
              return;
            }

            // Create a better signature for deduplication
            const signature = `${el.tagName}_${el.className}_${t}_${el.getAttribute('href') || ''}_${el.getAttribute('role') || ''}`;
            if (uniqueSignatures.has(signature)) {
                console.log(`🔄 Skipping duplicate element with signature: "${signature.substring(0, 50)}"`);
                return;
            }
            uniqueSignatures.add(signature);

            // Additional deduplication for explicit buttons by text
            if (c.name === 'explicit' && t) {
              if (elementsByText.has(t)) {
                console.log(`🔄 Skipping duplicate button with text: "${t}"`);
                return;
              }
              elementsByText.set(t, el);
            }

            const selector = getSelector(el);
            
            // Enhanced selector validation
            try {
              const testElements = document.querySelectorAll(selector);
              if (testElements.length === 0) {
                console.log(`❌ Selector returns no elements: ${selector}`);
                return;
              }
              
              if (testElements.length > 1) {
                console.log(`⚠️ Selector not unique (${testElements.length} matches): ${selector}`);
                // Try to make it more specific if possible
              }
              
              let targetElement = null;
              for (let testEl of testElements) {
                if (testEl === el) {
                  targetElement = testEl;
                  break;
                }
              }
              
              if (!targetElement) {
                console.log(`❌ Original element not found in selector results: ${selector}`);
                return;
              }
              
            } catch (e) {
              console.log(`❌ Selector validation failed for "${t}": ${e.message}`);
              return;
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

      // Enhanced limiting logic with better distribution
      const selectorCounts = {};
      const typeCounts = {};
      
      allCandidates.sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return (a.text || '').localeCompare(b.text || '');
      });
      
      for (const element of allCandidates) {
        if (!selectorCounts[element.selector]) {
          selectorCounts[element.selector] = 0;
        }
        if (!typeCounts[element.type]) {
          typeCounts[element.type] = 0;
        }
        
        // Apply both per-selector and per-type limits
        const selectorLimit = Math.min(options.maxInteractionsPerType, 3); // Cap at 3 per selector
        const typeLimit = Math.min(options.maxInteractions, 10); // Cap at 10 per type
        
        if (selectorCounts[element.selector] < selectorLimit && typeCounts[element.type] < typeLimit) {
          selectorCounts[element.selector]++;
          typeCounts[element.type]++;
          out.push(element);
          console.log(`✅ KEEPING: "${element.selector}" with text "${element.text}" (selector count: ${selectorCounts[element.selector]}/${selectorLimit}, type count: ${typeCounts[element.type]}/${typeLimit})`);
        } else {
          const reason = selectorCounts[element.selector] >= selectorLimit ? 'selector limit' : 'type limit';
          console.log(`🔄 LIMITING: Skipping "${element.selector}" with text "${element.text}" - reached ${reason}`);
        }
        
        if (out.length >= options.maxInteractions) {
          console.log(`🛑 Reached maxInteractions limit: ${options.maxInteractions}`);
          break;
        }
      }
      
      console.log(`🔢 FINAL SELECTOR COUNTS:`, selectorCounts);
      console.log(`🔢 FINAL TYPE COUNTS:`, typeCounts);
      console.log(`🎯 FINAL OUTPUT: ${out.length} elements after all limiting`);
      
      return out;

    }, { options: this.options, currentDomain: this.env.currentDomain });

    // Server-side filtering for external links (but exclude data-panel and JavaScript navigation)
    const filtered = [];
    for (const el of elements) {
      if (el.type === 'navigation' && el.selector) {
        // Skip external link check for JavaScript-based and data-driven navigation
        if (
          el.selector.includes('data-panel') || 
          el.selector.includes('data-target') || 
          el.selector.includes('panel_link') ||
          el.selector.includes('javascript:;') ||
          el.subtype?.includes('panel-nav') ||
          el.subtype?.includes('js-nav')
        ) {
          console.log(`✅ Keeping internal navigation element: ${el.selector}`);
          filtered.push(el);
          continue;
        }
        
        // Only check for external links on regular href-based navigation
        const external = await this.env.isExternalLink(el.selector);
        if (external) { 
          console.log(`🚫 Server-side filtered external link: ${el.selector}`); 
          continue; 
        }
      }
      filtered.push(el);
    }
    
    console.log(`🎯 FINAL FILTERED: ${filtered.length} elements after external link filtering`);
    return filtered;
  }
}

module.exports = { ElementDiscovery };