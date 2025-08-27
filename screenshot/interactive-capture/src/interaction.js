// aldo-g/vuxi-capture/vuxi-capture-37d1b686a0441eea729434faac648f100bc235e1/screenshot/interactive-capture/src/interaction.js
'use strict';

class InteractionEngine {
  constructor({ page, options, env, waits, changes, screenshotter, interactionHistoryRef }) {
    this.page = page;
    this.options = options;
    this.env = env;
    this.waits = waits;
    this.changes = changes;
    this.screenshotter = screenshotter;
    this.interactionHistory = interactionHistoryRef;
    this.baselineState = null;
    this.elementIdentifiers = new Map(); // Store element identifiers for reapplication
  }

  async captureBaselineState() {
    console.log('📄 Capturing baseline page state...');
    this.baselineState = await this.page.evaluate(() => {
      return {
        url: window.location.href,
        scrollPosition: { x: window.scrollX, y: window.scrollY }
      };
    });
    
    // Capture and store all element identifiers for later reapplication
    await this.captureElementIdentifiers();
    await this.reapplyElementIdentifiers();
    console.log('✅ Baseline state captured');
  }

  async captureElementIdentifiers() {
    console.log('📝 Capturing element identifiers for later reapplication...');
    const identifiers = await this.page.evaluate(() => {
      const identifierMap = new Map();
      
      // Capture all elements with data-interactive-id
      document.querySelectorAll('[data-interactive-id]').forEach(el => {
        const id = el.getAttribute('data-interactive-id');
        const signature = `${el.tagName}_${el.className}_${(el.textContent || '').trim().slice(0, 100)}`;
        identifierMap.set(signature, { type: 'interactive-id', value: id });
      });
      
      // Capture all elements with data-button-text
      document.querySelectorAll('[data-button-text]').forEach(el => {
        const text = el.getAttribute('data-button-text');
        const signature = `${el.tagName}_${el.className}_${(el.textContent || '').trim().slice(0, 100)}`;
        identifierMap.set(signature, { type: 'button-text', value: text });
      });
      
      // Capture all elements with data-nav-text
      document.querySelectorAll('[data-nav-text]').forEach(el => {
        const text = el.getAttribute('data-nav-text');
        const signature = `${el.tagName}_${el.className}_${(el.textContent || '').trim().slice(0, 100)}`;
        identifierMap.set(signature, { type: 'nav-text', value: text });
      });
      
      return Array.from(identifierMap.entries());
    });
    
    this.elementIdentifiers.clear();
    identifiers.forEach(([signature, data]) => {
      this.elementIdentifiers.set(signature, data);
    });
    
    console.log(`📝 Captured ${identifiers.length} element identifiers`);
  }

  async reapplyElementIdentifiers() {
    console.log('🔄 Reapplying element identifiers...');
    
    await this.page.evaluate((identifierData) => {
      const identifierMap = new Map(identifierData);
      
      // Reapply button text attributes
      document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]').forEach(button => {
        const textContent = (button.textContent || '').trim();
        if (textContent) {
          const escapedText = textContent.replace(/[^\w\s]/g, '').toLowerCase();
          if (escapedText) {
            button.setAttribute('data-button-text', escapedText);
          }
        }
      });
      
      // Reapply navigation text attributes  
      document.querySelectorAll('a, [role="link"]').forEach(link => {
        const textContent = (link.textContent || '').trim();
        if (textContent && textContent.length < 50) {
          const escapedText = textContent.replace(/[^\w\s]/g, '').toLowerCase();
          if (escapedText) {
            link.setAttribute('data-nav-text', escapedText);
          }
        }
      });
      
      // Reapply interactive IDs based on element signatures
      const reappliedCount = { interactiveIds: 0, buttonTexts: 0 };
      
      identifierMap.forEach((data, signature) => {
        // Find elements that match this signature
        document.querySelectorAll('*').forEach(el => {
          const currentSignature = `${el.tagName}_${el.className}_${(el.textContent || '').trim().slice(0, 100)}`;
          
          if (currentSignature === signature) {
            if (data.type === 'interactive-id' && !el.hasAttribute('data-interactive-id')) {
              el.setAttribute('data-interactive-id', data.value);
              reappliedCount.interactiveIds++;
            } else if (data.type === 'button-text' && !el.hasAttribute('data-button-text')) {
              el.setAttribute('data-button-text', data.value);
              reappliedCount.buttonTexts++;
            } else if (data.type === 'nav-text' && !el.hasAttribute('data-nav-text')) {
              el.setAttribute('data-nav-text', data.value);
              reappliedCount.navTexts = (reappliedCount.navTexts || 0) + 1;
            }
          }
        });
      });
      
      console.log(`✅ Reapplied ${reappliedCount.interactiveIds} interactive IDs, ${reappliedCount.buttonTexts} button texts, and ${reappliedCount.navTexts || 0} nav texts`);
      
    }, Array.from(this.elementIdentifiers.entries()));
  }

  async _dismissCookieModal() {
    try {
      await this.page.evaluate(() => {
        // Quick cookie modal dismissal
        const acceptButton = document.querySelector('.cky-btn-accept, .cookie-accept, button[data-action="accept"], button:contains("Accept All")');
        if (acceptButton) {
          acceptButton.click();
          return;
        }
        
        // Remove cookie overlays
        const cookieElements = document.querySelectorAll('[class*="cky"], [class*="cookie"], [id*="cookie"]');
        cookieElements.forEach(el => {
          const styles = window.getComputedStyle(el);
          if (styles.position === 'fixed' || styles.position === 'absolute') {
            el.remove();
          }
        });
      });
      
      await this.page.waitForTimeout(1000);
    } catch (error) {
      // Silent fail - don't break the flow
    }
  }

  async restoreToBaselineState() {
    if (!this.baselineState) return false;
    try {
      const currentUrl = this.page.url();
      if (currentUrl !== this.baselineState.url) {
        console.log(`⚠️  Attempted to restore baseline from an unexpected URL.
Navigating back.`);
        await this.page.goto(this.baselineState.url, { waitUntil: 'networkidle' });
      } else {
         await this.page.evaluate(baseState => {
            window.scrollTo(baseState.scrollPosition.x, baseState.scrollPosition.y);
         }, this.baselineState);
      }
      await this.page.waitForTimeout(1000);
      
      // Crucial: Reapply all element identifiers after restoration
      await this.reapplyElementIdentifiers();
      return true;
    } catch (error) {
      console.log(`❌ Failed to restore baseline state: ${error.message}`);
      return false;
    }
  }

  async interactWithElement(elementData, index) {
    if (elementData.type === 'state-change-container') {
      return this.handleStateChangeInteraction(elementData, index);
    }
    try {
      if (elementData.type === 'hover-and-click' || elementData.type === 'interactive-container') {
        console.log(`✨ Performing hover and click interaction...`);
        try {
            // Hover to trigger the effect
            await this.page.hover(elementData.selector);
            await this.page.waitForTimeout(500); // Wait for transition

            // Take screenshot of the hover state
            const safeLabelHover = (elementData.text || 'hover_effect').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 20);
            await this.screenshotter.takeScreenshotWithQualityCheck(`interaction_${index + 1}_${safeLabelHover}`, { force: true, tags: ['hover-effect'] });

            // Now click the element
            await this.page.click(elementData.selector);
            await this.page.waitForTimeout(this.options.interactionDelay);

            // Take screenshot of the clicked state
            const safeLabelClick = (elementData.text || 'click_effect').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 20);
            await this.screenshotter.takeScreenshotWithQualityCheck(`interaction_${index + 1}_${safeLabelClick}`, { force: true, tags: ['click-effect'] });
            
            this.interactionHistory.set(`interaction_${index + 1}`, {
                selector: elementData.selector,
                type: elementData.type,
                text: elementData.text,
                action: 'hover and click'
            });

            await this.restoreToBaselineState();
            return { success: true, navigated: false };

        } catch (e) {
            console.log(`   ❌ Hover and click interaction failed: ${e.message}`);
            await this.restoreToBaselineState();
            return null;
        }
      }
      
      console.log(`🎯 Interacting with element ${index + 1}: ${elementData.type} - "${(elementData.text || '').substring(0, 50)}"`);

      // First, try to find the element and log what we're trying to use
      console.log(`   🔍 Using selector: ${elementData.selector}`);
      
      const elementInfo = await this.page.evaluate((selector) => {
        const el = document.querySelector(selector);
        if (!el) {
          // Try some fallback strategies
          const fallbacks = [];
          
          // If selector contains data-panel, try to find by that attribute
          if (selector.includes('data-panel')) {
            const match = selector.match(/data-panel="([^"]+)"/);
            if (match) {
              const panelValue = match[1];
              const panelElement = document.querySelector(`a[data-panel="${panelValue}"]`);
              if (panelElement) {
                fallbacks.push(`Found element by data-panel: ${panelValue}`);
                return { 
                  found: true, 
                  visible: true, 
                  fallback: true, 
                  fallbackType: 'data-panel',
                  element: panelElement,
                  rect: panelElement.getBoundingClientRect()
                };
              }
            }
          }
          
          // If selector contains panel_link class, try to find by that class
          if (selector.includes('panel_link')) {
            const panelLinks = document.querySelectorAll('a.panel_link');
            if (panelLinks.length > 0) {
              fallbacks.push(`Found ${panelLinks.length} panel_link elements`);
              // Return the first one for now, could be improved with text matching
              return { 
                found: true, 
                visible: true, 
                fallback: true, 
                fallbackType: 'panel_link',
                element: panelLinks[0],
                rect: panelLinks[0].getBoundingClientRect()
              };
            }
          }
          
          // If selector contains data-interactive-id, try to find by text content
          if (selector.includes('data-interactive-id')) {
            fallbacks.push('data-interactive-id fallback');
          }
          
          // If selector contains data-button-text, try to find by that
          if (selector.includes('data-button-text')) {
            const match = selector.match(/data-button-text="([^"]+)"/);
            if (match) {
              const buttonText = match[1];
              const buttonByText = document.querySelector(`button[data-button-text="${buttonText}"]`);
              if (buttonByText) {
                fallbacks.push(`Found button by text: ${buttonText}`);
                return { 
                  found: true, 
                  visible: true, 
                  fallback: true, 
                  fallbackType: 'button-text',
                  element: buttonByText,
                  rect: buttonByText.getBoundingClientRect()
                };
              }
            }
          }
          
          // If selector contains data-nav-text, try to find by that
          if (selector.includes('data-nav-text')) {
            const match = selector.match(/data-nav-text="([^"]+)"/);
            if (match) {
              const navText = match[1];
              const navByText = document.querySelector(`a[data-nav-text="${navText}"]`);
              if (navByText) {
                fallbacks.push(`Found nav element by text: ${navText}`);
                return { 
                  found: true, 
                  visible: true, 
                  fallback: true, 
                  fallbackType: 'nav-text',
                  element: navByText,
                  rect: navByText.getBoundingClientRect()
                };
              }
            }
          }
          
          return { 
            found: false, 
            fallbacks: fallbacks,
            availableButtons: Array.from(document.querySelectorAll('button')).map(btn => ({
              text: btn.textContent.trim(),
              dataText: btn.getAttribute('data-button-text'),
              classes: btn.className
            })).slice(0, 5), // First 5 for debugging
            availableLinks: Array.from(document.querySelectorAll('a')).map(link => ({
              text: link.textContent.trim(),
              href: link.href,
              classes: link.className,
              dataPanel: link.getAttribute('data-panel')
            })).slice(0, 5) // First 5 for debugging
          };
        }
        
        const r = el.getBoundingClientRect();
        return { 
          found: true, 
          visible: r.width > 0 && r.height > 0,
          rect: r
        };
      }, elementData.selector);

      if (!elementInfo.found) {
        console.log(`   ❌ Element not found with selector: ${elementData.selector}`);
        if (elementInfo.availableButtons?.length > 0) {
          console.log(`   📊 Available buttons on page:`, elementInfo.availableButtons);
        }
        if (elementInfo.availableLinks?.length > 0) {
          console.log(`   📊 Available links on page:`, elementInfo.availableLinks);
        }
        
        // Check if we're seeing cookie buttons - if so, try to dismiss them
        const hasCookieButtons = elementInfo.availableButtons?.some(btn => 
          btn.text.toLowerCase().includes('cookie') || 
          btn.text.toLowerCase().includes('accept') ||
          btn.classes.includes('cky-')
        );
        
        if (hasCookieButtons) {
          console.log('   🍪 Detected cookie modal blocking access, attempting dismissal...');
          await this._dismissCookieModal();
          
          // Retry element detection after cookie dismissal
          const retryElementInfo = await this.page.evaluate((selector) => {
            const el = document.querySelector(selector);
            return { 
              found: !!el, 
              visible: el ? (el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0) : false
            };
          }, elementData.selector);
          
          if (retryElementInfo.found) {
            console.log('   ✅ Element found after cookie dismissal');
            // Continue with interaction
          } else {
            return null;
          }
        } else {
          return null;
        }
      }

      if (elementInfo.fallback) {
        console.log(`   ✅ Found element using fallback strategy: ${elementInfo.fallbackType}`);
      }

      if (!elementInfo.visible) {
        console.log(`   ❌ Element found but not visible`);
        return null;
      }

      // Perform the actual click
      const clickRes = await this.page.evaluate((selector) => {
        try {
          const el = document.querySelector(selector);
          if (!el) {
            // Try fallback strategies during click
            
            // Try data-panel fallback
            const panelMatch = selector.match(/data-panel="([^"]+)"/);
            if (panelMatch) {
              const panelValue = panelMatch[1];
              const panelElement = document.querySelector(`a[data-panel="${panelValue}"]`);
              if (panelElement) {
                panelElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                setTimeout(() => panelElement.click(), 150);
                return { success: true, usedFallback: true, fallbackType: 'data-panel' };
              }
            }
            
            // Try panel_link fallback
            if (selector.includes('panel_link')) {
              const panelLinks = document.querySelectorAll('a.panel_link');
              if (panelLinks.length > 0) {
                panelLinks[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
                setTimeout(() => panelLinks[0].click(), 150);
                return { success: true, usedFallback: true, fallbackType: 'panel_link' };
              }
            }
            
            // Try button text fallback
            const buttonMatch = selector.match(/data-button-text="([^"]+)"/);
            if (buttonMatch) {
              const buttonText = buttonMatch[1];
              const buttonByText = document.querySelector(`button[data-button-text="${buttonText}"]`);
              if (buttonByText) {
                buttonByText.scrollIntoView({ behavior: 'smooth', block: 'center' });
                setTimeout(() => buttonByText.click(), 150);
                return { success: true, usedFallback: true, fallbackType: 'button-text' };
              }
            }
            
            // Try nav text fallback
            const navMatch = selector.match(/data-nav-text="([^"]+)"/);
            if (navMatch) {
              const navText = navMatch[1];
              const navByText = document.querySelector(`a[data-nav-text="${navText}"]`);
              if (navByText) {
                navByText.scrollIntoView({ behavior: 'smooth', block: 'center' });
                setTimeout(() => navByText.click(), 150);
                return { success: true, usedFallback: true, fallbackType: 'nav-text' };
              }
            }
            
            return { success: false, reason: 'Element not found during click' };
          }
          
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) {
            return { success: false, reason: 'Element not visible during click' };
          }
          
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(() => el.click(), 150);
          return { success: true };
        } catch (e) { 
          return { success: false, reason: e.message }; 
        }
      }, elementData.selector);

      if (!clickRes.success) {
        console.log(`   ❌ Interaction failed: ${clickRes.reason}`);
        return null;
      }

      if (clickRes.usedFallback) {
        console.log(`   ✅ Click successful using fallback strategy: ${clickRes.fallbackType}`);
      }

      this.interactionHistory.set(`interaction_${index + 1}`, {
        selector: elementData.selector,
        type: elementData.type,
        text: elementData.text
      });
      
      await this.page.waitForTimeout(this.options.interactionDelay + 500);
      
      const navigated = this.page.url() !== this.baselineState.url;

      if (navigated) {
        console.log(`   ➡️  Navigation detected to: ${this.page.url()}`);
        console.log('   📸 Skipping screenshot for new URL.');
        console.log(`   ↩️  Returning to baseline URL to continue other interactions...`);
        await this.page.goto(this.baselineState.url, { waitUntil: 'networkidle' });
        await this.reapplyElementIdentifiers();
        return { success: true, navigated: true }; // Return early
      }

      // If we are here, it means we did NOT navigate.
      await this.waits.waitForAnimations();
      await this.waits.validator.waitForImages();

      const safeLabel = (elementData.text || elementData.type).replace(/[^a-zA-Z0-9]/g, '_').substring(0, 20);
      await this.screenshotter.takeScreenshotWithQualityCheck(`interaction_${index + 1}_${safeLabel}`, {
          force: true,
          tags: [elementData.type]
      });

      console.log(`   🔄 Restoring to baseline state after on-page interaction`);
      await this.restoreToBaselineState();

      return { success: true, navigated: false };

    } catch (error) {
      console.error(`❌ Error interacting with element ${index + 1}:`, error.message);
      await this.page.goto(this.baselineState.url, { waitUntil: 'networkidle' });
      await this.reapplyElementIdentifiers();
      return null;
    }
  }

  async handleStateChangeInteraction(elementData, index) {
    try {
      console.log(`✨ Performing state-change interaction on: ${elementData.selector}`);

      // 1. Get the initial class list
      const initialClasses = await this.page.evaluate(selector => {
        const el = document.querySelector(selector);
        return el ? el.className : null;
      }, elementData.selector);

      if (initialClasses === null) {
        console.log(`   ❌ Element not found before click: ${elementData.selector}`);
        return null;
      }

      // 2. Click the element
      await this.page.click(elementData.selector);
      await this.page.waitForTimeout(this.options.interactionDelay);

      // 3. Get the new class list
      const newClasses = await this.page.evaluate(selector => {
        const el = document.querySelector(selector);
        return el ? el.className : null;
      }, elementData.selector);

      // 4. Compare class lists
      if (newClasses !== initialClasses) {
        console.log(`   ✅ State change detected: "${initialClasses}" -> "${newClasses}"`);
        const safeLabel = (elementData.text || 'state_change').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 20);
        await this.screenshotter.takeScreenshotWithQualityCheck(`interaction_${index + 1}_${safeLabel}`, {
          force: true,
          tags: ['state-change']
        });

        // Click again to attempt to revert the state
        await this.page.click(elementData.selector);
        await this.page.waitForTimeout(this.options.interactionDelay);
      } else {
        console.log(`   ℹ️  No state change detected after click.`);
      }

      await this.restoreToBaselineState();
      return { success: true, navigated: false };

    } catch (e) {
      console.log(`   ❌ State-change interaction failed: ${e.message}`);
      await this.restoreToBaselineState();
      return null;
    }
  }
}

module.exports = { InteractionEngine };