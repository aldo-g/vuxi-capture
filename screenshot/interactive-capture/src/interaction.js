'use strict';

class InteractionEngine {
  constructor({ page, options, env, waits, changes, regions, screenshotter, interactionHistoryRef }) {
    this.page = page;
    this.options = options;
    this.env = env;
    this.waits = waits;
    this.changes = changes;
    this.regions = regions;
    this.screenshotter = screenshotter;
    this.interactionHistory = interactionHistoryRef; // Map shared with orchestrator
    this.baselineState = null; // Added for state restoration
  }

  // Capture the baseline state of the page for restoration
  async captureBaselineState() {
    console.log('📄 Capturing baseline page state...');
    this.baselineState = await this.page.evaluate(() => {
      // Store information needed to restore the page to its initial state
      return {
        url: window.location.href,
        scrollPosition: { x: window.scrollX, y: window.scrollY },
        activeElements: {
          // Find currently active tabs
          activeTabs: Array.from(document.querySelectorAll('[role="tab"][aria-selected="true"], .tab.active, .tab-button.active, [data-state="active"]'))
            .map(el => ({
              selector: el.id ? `#${el.id}` : el.className ? `.${el.className.split(' ')[0]}` : el.tagName.toLowerCase(),
              text: (el.textContent || '').trim(),
              isActive: true
            })),
          // Find any expanded elements
          expandedElements: Array.from(document.querySelectorAll('[aria-expanded="true"], details[open]'))
            .map(el => ({
              selector: el.id ? `#${el.id}` : el.className ? `.${el.className.split(' ')[0]}` : el.tagName.toLowerCase(),
              isExpanded: true
            }))
        }
      };
    });
    
    // Also re-apply data-button-text attributes for consistency
    await this.reapplyElementIdentifiers();
    
    console.log('✅ Baseline state captured');
  }

  // Re-apply the data-button-text attributes and other identifiers that discovery process adds
  async reapplyElementIdentifiers() {
    console.log('🔧 Re-applying element identifiers...');
    
    await this.page.evaluate(() => {
      // Re-add data-button-text attributes to buttons with text
      document.querySelectorAll('button').forEach(button => {
        const textContent = (button.textContent || '').trim();
        if (textContent) {
          const escapedText = textContent.replace(/[^\w\s]/g, '').toLowerCase();
          if (escapedText) {
            button.setAttribute('data-button-text', escapedText);
          }
        }
      });
      
      // Re-add any data-interactive-id attributes that might be needed
      // This ensures selectors created during discovery will still work
      return true;
    });
  }

  // Restore the page to its baseline state and re-apply element identifiers
  async restoreToBaselineState() {
    if (!this.baselineState) {
      console.log('⚠️  No baseline state available for restoration');
      return false;
    }

    try {
      console.log('🔄 Restoring page to baseline state...');
      
      // Strategy 1: Try to navigate back to baseline URL if it's different
      const currentUrl = this.page.url();
      if (currentUrl !== this.baselineState.url) {
        console.log(`🔄 Navigating back to baseline URL: ${this.baselineState.url}`);
        await this.page.goto(this.baselineState.url, { waitUntil: 'networkidle' });
        await this.page.waitForTimeout(1000);
      }
      
      // Strategy 2: Reset page state through DOM manipulation and simulated user actions
      const resetResult = await this.page.evaluate((baselineState) => {
        console.log('🔄 Starting DOM-based restoration...');
        
        // 1. Reset scroll position
        window.scrollTo(baselineState.scrollPosition.x, baselineState.scrollPosition.y);
        
        // 2. Close any expanded elements
        document.querySelectorAll('[aria-expanded="true"]').forEach(el => {
          if (el.getAttribute('aria-expanded') === 'true') {
            console.log('Closing expanded element:', el);
            el.click();
          }
        });
        
        // Close any open details elements
        document.querySelectorAll('details[open]').forEach(el => {
          el.removeAttribute('open');
        });
        
        // 3. Reset ALL tabs to inactive state first
        const allTabs = document.querySelectorAll('[role="tab"], .tab, .tab-button, button[data-button-text]');
        console.log(`Found ${allTabs.length} tab-like elements`);
        
        allTabs.forEach(tab => {
          // Remove active states
          tab.setAttribute('aria-selected', 'false');
          tab.classList.remove('active', 'selected');
          tab.removeAttribute('data-state');
          
          // Add inactive classes if they exist
          if (tab.classList.contains('tab')) {
            tab.classList.add('inactive');
          }
        });
        
        // 4. Strategy A: Try to find and click the first/default tab
        console.log('🎯 Looking for default/first tab to activate...');
        
        // Look for buttons that might be the default state
        const possibleDefaultTabs = [
          // Try buttons without specific text (empty buttons often are navigation)
          ...Array.from(document.querySelectorAll('button')).filter(btn => {
            const text = (btn.textContent || '').trim();
            return text === '' || text.toLowerCase().includes('home') || text.toLowerCase().includes('default');
          }),
          // Try the first tab in any tab group
          document.querySelector('[role="tab"]:first-child'),
          document.querySelector('.tab:first-child'),
          document.querySelector('.tab-button:first-child'),
          // Try buttons that might represent the default view
          document.querySelector('button[aria-selected="false"]:first-of-type'),
          document.querySelector('button:first-of-type')
        ].filter(Boolean);
        
        console.log(`Found ${possibleDefaultTabs.length} possible default tabs`);
        
        // Try clicking the first viable default tab
        if (possibleDefaultTabs.length > 0) {
          const defaultTab = possibleDefaultTabs[0];
          console.log('Clicking default tab:', {
            text: defaultTab.textContent.trim(),
            className: defaultTab.className,
            tagName: defaultTab.tagName
          });
          
          // Activate the default tab
          defaultTab.setAttribute('aria-selected', 'true');
          defaultTab.classList.add('active');
          defaultTab.classList.remove('inactive');
          if (defaultTab.hasAttribute('data-state')) {
            defaultTab.setAttribute('data-state', 'active');
          }
          
          // Click to ensure proper activation
          defaultTab.click();
          
          return { success: true, method: 'default_tab_click', tab: defaultTab.textContent.trim() };
        }
        
        // 5. Strategy B: If we have baseline tab info, try to restore it
        if (baselineState.activeElements.activeTabs.length > 0) {
          console.log('🎯 Trying to restore baseline tabs...');
          
          baselineState.activeElements.activeTabs.forEach(tabInfo => {
            console.log('Looking for baseline tab:', tabInfo);
            
            const tabs = document.querySelectorAll('[role="tab"], .tab, .tab-button, button');
            tabs.forEach(tab => {
              const tabText = (tab.textContent || '').trim();
              if (tabText === tabInfo.text) {
                console.log('Found matching baseline tab:', tabText);
                
                // Activate this tab
                if (tab.hasAttribute('aria-selected')) {
                  tab.setAttribute('aria-selected', 'true');
                }
                if (tab.classList.contains('tab') || tab.classList.contains('tab-button')) {
                  tab.classList.add('active');
                  tab.classList.remove('inactive');
                }
                if (tab.hasAttribute('data-state')) {
                  tab.setAttribute('data-state', 'active');
                }
                
                // Click the baseline tab to ensure proper activation
                tab.click();
              }
            });
          });
          
          return { success: true, method: 'baseline_tabs_restored' };
        }
        
        // 6. Strategy C: Fallback - just ensure we're in a clean state
        console.log('🎯 Fallback: ensuring clean state...');
        
        // If all else fails, just make sure no tabs are in weird states
        allTabs.forEach(tab => {
          tab.setAttribute('aria-selected', 'false');
          tab.classList.remove('active', 'selected');
          tab.removeAttribute('data-state');
        });
        
        return { success: true, method: 'fallback_clean_state' };
        
      }, this.baselineState);
      
      console.log(`🔄 Reset result: ${JSON.stringify(resetResult)}`);
      
      // Wait for any animations or state changes to complete
      await this.page.waitForTimeout(1200);
      
      // Wait for any animations to complete
      if (this.waits && this.waits.waitForAnimations) {
        await this.waits.waitForAnimations();
      }
      
      // CRITICAL: Re-apply element identifiers that were added during discovery
      await this.reapplyElementIdentifiers();
      
      // Verify we're actually in the right state by checking what's visible
      const currentState = await this.page.evaluate(() => {
        const activeTabs = document.querySelectorAll('[role="tab"][aria-selected="true"], .tab.active, .tab-button.active, [data-state="active"]');
        const visibleButtons = Array.from(document.querySelectorAll('button')).filter(btn => {
          const rect = btn.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }).map(btn => ({
          text: (btn.textContent || '').trim(),
          hasDataButtonText: btn.hasAttribute('data-button-text')
        }));
        
        return {
          activeTabs: Array.from(activeTabs).map(tab => ({
            text: (tab.textContent || '').trim(),
            tagName: tab.tagName
          })),
          visibleButtons: visibleButtons
        };
      });
      
      console.log(`✅ Current state after restoration:`, JSON.stringify(currentState, null, 2));
      console.log('✅ Successfully restored to baseline state');
      return true;
      
    } catch (error) {
      console.log(`❌ Failed to restore baseline state: ${error.message}`);
      return false;
    }
  }

  async interactWithElement(elementData, index) {
    try {
      console.log(`🎯 Interacting with element ${index + 1}: ${elementData.type} - "${(elementData.text || '').substring(0, 50)}"`);

      if (elementData.type === 'navigation' && elementData.selector) {
        const isExternal = await this.env.isExternalLink(elementData.selector);
        if (isExternal) {
          console.log(`🚫 Skipping external link interaction: ${elementData.selector}`);
          return null;
        }
      }

      // Check if element exists before interaction with enhanced debugging and fallback
      let elementExists = await this.page.evaluate((selector) => {
        const el = document.querySelector(selector);
        return !!el;
      }, elementData.selector);

      if (!elementExists) {
        console.log(`   ❌ Interaction failed: Element not found - ${elementData.selector}`);
        console.log(`   🔄 Attempting to restore baseline state and retry...`);
        
        // Attempt to restore baseline state and retry
        const restored = await this.restoreToBaselineState();
        if (restored) {
          // Wait a bit for the page to settle
          await this.page.waitForTimeout(500);
          
          // Check if element exists now
          elementExists = await this.page.evaluate((selector) => {
            const el = document.querySelector(selector);
            return !!el;
          }, elementData.selector);
          
          if (!elementExists) {
            // Try alternative selectors based on the element text
            console.log(`   🔍 Trying alternative selectors for element with text: "${elementData.text}"`);
            
            // First, let's debug what buttons are actually available
            const availableButtons = await this.page.evaluate(() => {
              const buttons = Array.from(document.querySelectorAll('button'));
              return buttons.map(btn => ({
                text: (btn.textContent || '').trim(),
                className: btn.className,
                hasDataButtonText: btn.hasAttribute('data-button-text'),
                dataButtonTextValue: btn.getAttribute('data-button-text'),
                visible: btn.getBoundingClientRect().width > 0 && btn.getBoundingClientRect().height > 0
              }));
            });
            
            console.log(`   🔍 Available buttons on page:`, JSON.stringify(availableButtons, null, 2));
            
            const alternativeSelector = await this.page.evaluate((text, originalSelector) => {
              if (!text) return null;
              
              console.log(`Looking for button with text: "${text}"`);
              console.log(`Original selector was: ${originalSelector}`);
              
              // Strategy 1: Try to find button by exact text match
              const buttons = Array.from(document.querySelectorAll('button'));
              console.log(`Total buttons found: ${buttons.length}`);
              
              const matchingButton = buttons.find(btn => {
                const btnText = (btn.textContent || '').trim().toLowerCase();
                const match = btnText === text.toLowerCase();
                console.log(`Button text: "${btnText}", matches: ${match}`);
                return match;
              });
              
              if (matchingButton) {
                console.log(`Found matching button:`, {
                  text: matchingButton.textContent.trim(),
                  className: matchingButton.className,
                  id: matchingButton.id
                });
                
                // Strategy 1a: Use ID if available
                if (matchingButton.id) {
                  return `#${matchingButton.id}`;
                }
                
                // Strategy 1b: Re-add the data-button-text attribute and use it
                const escapedText = text.replace(/[^\w\s]/g, '').toLowerCase();
                matchingButton.setAttribute('data-button-text', escapedText);
                return `button[data-button-text="${escapedText}"]`;
              }
              
              // Strategy 2: Try partial text matching
              const partialMatch = buttons.find(btn => {
                const btnText = (btn.textContent || '').trim().toLowerCase();
                return btnText.includes(text.toLowerCase()) || text.toLowerCase().includes(btnText);
              });
              
              if (partialMatch) {
                console.log(`Found partial match button:`, partialMatch.textContent.trim());
                const tempId = 'temp-' + Math.random().toString(36).slice(2, 8);
                partialMatch.setAttribute('data-temp-id', tempId);
                return `[data-temp-id="${tempId}"]`;
              }
              
              return null;
            }, elementData.text, elementData.selector);
            
            if (alternativeSelector) {
              console.log(`   ✅ Found alternative selector: ${alternativeSelector}`);
              elementData.selector = alternativeSelector;
              elementExists = true;
            } else {
              console.log(`   ❌ Element still not found after baseline restoration and alternative selectors`);
              return null;
            }
          } else {
            console.log(`   ✅ Element found after baseline restoration, proceeding with interaction`);
          }
        } else {
          return null;
        }
      }

      const isTabLike = await this.page.evaluate((selector) => {
        const el = document.querySelector(selector);
        if (!el) return false;
        const group = el.closest('[role="tablist"], .tabs, .tablist, [data-tabgroup], .btn-group, .button-group');
        const siblings = group ? group.querySelectorAll('button, [role="tab"], a[role="tab"]').length : 0;
        const toggly = el.hasAttribute('aria-pressed') || el.getAttribute('data-state') === 'active';
        return !!group || siblings >= 2 || toggly;
      }, elementData.selector);
      elementData.isTabLike = elementData.type === 'tabs' || isTabLike;

      const beforeState = await this.changes.snapshotBeforeState();

      const clickRes = await this.page.evaluate((selector) => {
        try {
          const el = document.querySelector(selector);
          if (!el) return { success: false, reason: 'Element not found' };
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return { success: false, reason: 'Element not visible' };
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(() => el.click(), 100);
          return { success: true };
        } catch (e) { return { success: false, reason: e.message }; }
      }, elementData.selector);
      
      if (!clickRes.success) { 
        console.log(`   ❌ Interaction failed: ${clickRes.reason}`); 
        return null; 
      }

      this.interactionHistory.set(`interaction_${index + 1}`, { 
        selector: elementData.selector, 
        type: elementData.type, 
        text: elementData.text 
      });

      await this.page.waitForTimeout(this.options.interactionDelay);

      if (elementData.isTabLike) {
        await this.regions.waitForTabActivation(elementData, this.options.changeDetectionTimeout);
        await this.page.waitForTimeout(this.options.tabPostClickWait);
      }
      await this.waits.validator.waitForImages();
      await this.waits.waitForAnimations();

      let regionShot = null;
      const anchorInfo = await this.regions.getAnchorTargetInfo(elementData.selector);
      if (anchorInfo && anchorInfo.rect) {
        regionShot = await this._screenshotSectionRect(`interaction_${index + 1}_anchor_${anchorInfo.id}`, anchorInfo.rect, ['anchor']);
      }

      if (!regionShot && elementData.isTabLike) {
        const panelRect = await this.regions.getTabPanelRect(elementData.selector);
        if (panelRect) {
          regionShot = await this._screenshotSectionRect(`interaction_${index + 1}_tabpanel`, panelRect, ['tabs','tabpanel']);
        }
      }

      const changes = await this.changes.detectContentChanges(beforeState, elementData);
      const forceTabShot = (elementData.isTabLike && this.options.forceScreenshotOnTabs);
      if (!regionShot && (changes.significantChange || forceTabShot)) {
        const label = elementData.text ? elementData.text.substring(0, 15) : elementData.type;
        const safe = label.replace(/[^a-zA-Z0-9]/g, '_') || elementData.type;
        await this.screenshotter.takeScreenshotWithQualityCheck(`interaction_${index + 1}_${safe}`, { 
          force: forceTabShot, 
          tags: [elementData.isTabLike ? 'tabs' : elementData.type] 
        });
      }

      // After capturing the screenshot and changes, restore to baseline state
      // This ensures that subsequent elements can be found and interacted with
      if (elementData.isTabLike || changes.significantChange) {
        console.log(`   🔄 Restoring to baseline state after interaction with ${elementData.type}`);
        await this.restoreToBaselineState();
      }

      return {
        success: true,
        screenshot: regionShot,
        changes: changes,
        isTabLike: elementData.isTabLike
      };

    } catch (error) {
      console.error(`❌ Error interacting with element ${index + 1}:`, error);
      // Attempt to restore baseline state even after errors
      await this.restoreToBaselineState();
      return null;
    }
  }

  async _screenshotSectionRect(filename, rect, tags = []) {
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    
    try {
      const screenshot = await this.page.screenshot({
        type: 'png',
        clip: {
          x: Math.max(0, rect.x),
          y: Math.max(0, rect.y),
          width: Math.min(rect.width, 1920),
          height: Math.min(rect.height, 1080)
        }
      });
      
      const screenshotData = {
        filename: `${filename}.png`,
        buffer: screenshot,
        timestamp: new Date().toISOString(),
        tags: tags,
        metadata: { rect }
      };
      
      this.screenshotter.screenshots.push(screenshotData);
      console.log(`   📸 Screenshot saved: ${filename}.png`);
      return screenshotData;
    } catch (error) {
      console.error(`❌ Failed to take section screenshot ${filename}:`, error);
      return null;
    }
  }
}

module.exports = { InteractionEngine };