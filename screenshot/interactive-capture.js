// Enhanced Interactive Content Capture System
// This system systematically discovers, interacts with, and captures all interactive content

class InteractiveContentCapture {
  constructor(page, options = {}) {
    this.page = page;
    this.options = {
      maxInteractions: options.maxInteractions || 50,
      maxScreenshots: options.maxScreenshots || 20,
      interactionDelay: options.interactionDelay || 800,
      changeDetectionTimeout: options.changeDetectionTimeout || 2000,
      scrollPauseTime: options.scrollPauseTime || 500,
      ...options
    };
    
    this.screenshots = [];
    this.interactionHistory = new Map();
    this.discoveredElements = [];
    this.pageState = {
      domHash: null,
      activeElements: new Set(),
      expandedElements: new Set(),
      visitedModals: new Set()
    };
  }

  // Phase 1: Comprehensive Element Discovery
  async discoverInteractiveElements() {
    console.log('🔍 Starting comprehensive element discovery...');
    
    const elements = await this.page.evaluate(() => {
      const discovered = [];
      const seenElements = new Set();

      // Helper function to get element selector
      const getSelector = (element) => {
        if (element.id) return `#${CSS.escape(element.id)}`;
        
        if (element.className && typeof element.className === 'string') {
          const classes = element.className.trim().split(/\s+/)
            .filter(cls => cls.length > 0 && /^[a-zA-Z_-]/.test(cls)) // Valid CSS class names only
            .slice(0, 2); // Limit to 2 classes to avoid overly complex selectors
          
          if (classes.length > 0) {
            const escapedClasses = classes.map(cls => CSS.escape(cls)).join('.');
            return `${element.tagName.toLowerCase()}.${escapedClasses}`;
          }
        }
        
        // Fallback: use a unique data attribute
        const uniqueId = 'interactive-' + Math.random().toString(36).substr(2, 9);
        element.setAttribute('data-interactive-id', uniqueId);
        return `[data-interactive-id="${uniqueId}"]`;
      };

      // Helper to check if element is interactive
      const isInteractive = (element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (style.pointerEvents === 'none') return false;
        
        return true;
      };

      // Helper to get element text content safely
      const getTextContent = (element) => {
        return (element.textContent || element.innerText || '').trim().toLowerCase();
      };

      // Helper function to get element priority (higher = more important)
      function getElementPriority(element, text) {
        // Navigation elements get highest priority
        if (element.closest('nav, .nav, .navigation, .menu')) return 10;
        
        // Tab-related elements
        if (element.getAttribute('role') === 'tab') return 10;
        if (text.includes('tab')) return 9;
        
        // Expandable content indicators
        if (text.includes('more') || text.includes('expand') || text.includes('show')) return 8;
        
        // Structural elements
        if (element.tagName === 'SUMMARY') return 9;
        if (element.getAttribute('aria-expanded') === 'false') return 8;
        
        // Regular buttons and links
        if (element.tagName === 'BUTTON') return 7;
        if (element.tagName === 'A') return 6;
        
        // Everything else
        return 5;
      }

      // 1. EXPLICIT INTERACTIVE ELEMENTS
      // Buttons and links
      document.querySelectorAll('button, a, [role="button"], [role="tab"], [role="menuitem"]').forEach(el => {
        if (!isInteractive(el) || seenElements.has(el)) return;
        
        const text = getTextContent(el);
        const selector = getSelector(el);
        
        discovered.push({
          selector,
          type: 'explicit',
          subtype: el.tagName.toLowerCase(),
          priority: getElementPriority(el, text),
          text: text,
          reason: 'explicit interactive element'
        });
        seenElements.add(el);
      });

      // 2. EXPANDABLE ELEMENTS
      // Details/summary, aria-expanded, data attributes
      document.querySelectorAll('details summary, [aria-expanded], [data-toggle], [data-collapse]').forEach(el => {
        if (!isInteractive(el) || seenElements.has(el)) return;
        
        const text = getTextContent(el);
        const selector = getSelector(el);
        
        discovered.push({
          selector,
          type: 'expandable',
          subtype: el.tagName.toLowerCase(),
          priority: getElementPriority(el, text),
          text: text,
          reason: 'expandable content element'
        });
        seenElements.add(el);
      });

      // 3. FORM ELEMENTS
      // Interactive form controls
      document.querySelectorAll('select, input[type="checkbox"], input[type="radio"], input[type="range"]').forEach(el => {
        if (!isInteractive(el) || seenElements.has(el)) return;
        
        const text = getTextContent(el.closest('label')) || getTextContent(el);
        const selector = getSelector(el);
        
        discovered.push({
          selector,
          type: 'form',
          subtype: el.tagName.toLowerCase(),
          priority: 6,
          text: text,
          reason: 'interactive form element'
        });
        seenElements.add(el);
      });

      // 4. HOVER-ACTIVATED ELEMENTS
      document.querySelectorAll('[title], [data-tooltip], .tooltip-trigger, [onmouseover]').forEach(el => {
        if (seenElements.has(el) || !isInteractive(el)) return;
        
        discovered.push({
          selector: getSelector(el),
          type: 'hover',
          subtype: 'tooltip-trigger',
          priority: 3, // Lower priority
          text: getTextContent(el),
          reason: 'hover-activated element'
        });
        seenElements.add(el);
      });

      // 5. CLICKABLE ELEMENTS
      // Elements with click handlers or pointer cursor
      document.querySelectorAll('*').forEach(el => {
        if (!isInteractive(el) || seenElements.has(el)) return;
        
        const style = getComputedStyle(el);
        const hasClickHandler = el.onclick || el.getAttribute('onclick') || 
                               el.hasAttribute('data-action') || el.hasAttribute('data-click');
        const hasPointerCursor = style.cursor === 'pointer';
        
        if (hasClickHandler || hasPointerCursor) {
          const text = getTextContent(el);
          if (text.length < 3 || text.length > 200) return; // Skip very short or very long text
          
          const selector = getSelector(el);
          
          discovered.push({
            selector,
            type: 'clickable',
            subtype: hasClickHandler ? 'onclick-handler' : 'pointer-cursor',
            priority: 5,
            text: text,
            reason: hasClickHandler ? 'has onclick handler' : 'pointer cursor'
          });
          seenElements.add(el);
        }
      });

      // Sort by priority (highest first)
      return discovered.sort((a, b) => b.priority - a.priority);
    });

    this.discoveredElements = elements;
    console.log(`🎯 Discovered ${elements.length} interactive elements`);
    
    // Group elements by priority for logging
    const priorityGroups = {};
    elements.forEach(el => {
      if (!priorityGroups[el.priority]) priorityGroups[el.priority] = [];
      priorityGroups[el.priority].push(el);
    });
    
    Object.keys(priorityGroups).sort((a, b) => b - a).forEach(priority => {
      console.log(`   Priority ${priority}: ${priorityGroups[priority].length} elements (${priorityGroups[priority][0]?.type})`);
    });

    return elements;
  }

  // Phase 2: Enhanced Change Detection System
  async detectContentChanges(beforeState) {
    await this.page.waitForTimeout(this.options.changeDetectionTimeout);
    
    return await this.page.evaluate((beforeState) => {
      const changes = {
        domChanged: false,
        newElements: [],
        visibilityChanged: [],
        textChanged: false,
        layoutChanged: false,
        newImages: [],
        urlChanged: false,
        activeElementChanged: false,
        styleChanges: false
      };

      // 1. Check URL changes (for navigation)
      if (window.location.href !== beforeState.url) {
        changes.urlChanged = true;
      }

      // 2. Check DOM structure changes (more sensitive)
      const currentDomHash = document.documentElement.innerHTML.length;
      if (Math.abs(currentDomHash - beforeState.domHash) > 50) {  // More sensitive threshold
        changes.domChanged = true;
      }

      // 3. Check for visibility changes (key for tabs)
      const visibleElements = Array.from(document.querySelectorAll('*')).filter(el => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && 
               style.display !== 'none' && 
               style.visibility !== 'hidden' &&
               style.opacity !== '0';
      });

      const visibilityChange = Math.abs(visibleElements.length - beforeState.visibleElementCount);
      if (visibilityChange > 2) {  // More than 2 elements changed visibility
        changes.visibilityChanged = true;
      }

      // 4. Check for active/selected element changes
      const activeElement = document.activeElement;
      const selectedElements = document.querySelectorAll('[aria-selected="true"], .active, .selected, [class*="active"], [class*="selected"]');
      if (selectedElements.length !== beforeState.selectedElementCount) {
        changes.activeElementChanged = true;
      }

      // 5. Check for new images
      const images = document.querySelectorAll('img');
      if (images.length > beforeState.imageCount) {
        changes.newImages = Array.from(images).slice(beforeState.imageCount);
      }

      // 6. More sensitive text content change detection
      const currentTextLength = document.body.textContent.length;
      if (Math.abs(currentTextLength - beforeState.textLength) > 50) {  // Lower threshold
        changes.textChanged = true;
      }

      // 7. Check for significant style changes (hidden/shown content)
      const hiddenElements = document.querySelectorAll('[style*="display: none"], [style*="visibility: hidden"]');
      if (Math.abs(hiddenElements.length - beforeState.hiddenElementCount) > 1) {
        changes.styleChanges = true;
      }

      // 8. Check for content area changes (common in SPAs)
      const mainContent = document.querySelector('main, [role="main"], .main-content, #main, .content');
      if (mainContent) {
        const currentMainText = mainContent.textContent.length;
        if (Math.abs(currentMainText - beforeState.mainContentLength) > 100) {
          changes.textChanged = true;
        }
      }

      return changes;
    }, {
      ...beforeState,
      url: await this.page.url(),
      selectedElementCount: await this.page.evaluate(() => 
        document.querySelectorAll('[aria-selected="true"], .active, .selected, [class*="active"], [class*="selected"]').length
      ),
      hiddenElementCount: await this.page.evaluate(() => 
        document.querySelectorAll('[style*="display: none"], [style*="visibility: hidden"]').length
      ),
      mainContentLength: await this.page.evaluate(() => {
        const mainContent = document.querySelector('main, [role="main"], .main-content, #main, .content');
        return mainContent ? mainContent.textContent.length : 0;
      })
    });
  }

  // Phase 3: Smart Interaction Logic
  async interactWithElement(elementData, index) {
    try {
      console.log(`🎯 Interacting with element ${index + 1}/${this.discoveredElements.length}: ${elementData.type} - "${elementData.text.substring(0, 50)}"`);

      // Get current page state before interaction
      const beforeState = await this.page.evaluate(() => ({
        domHash: document.documentElement.innerHTML.length,
        visibleElementCount: Array.from(document.querySelectorAll('*')).filter(el => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }).length,
        imageCount: document.querySelectorAll('img').length,
        textLength: document.body.textContent.length,
        scrollY: window.scrollY,
        selectedElementCount: document.querySelectorAll('[aria-selected="true"], .active, .selected, [class*="active"], [class*="selected"]').length,
        hiddenElementCount: document.querySelectorAll('[style*="display: none"], [style*="visibility: hidden"]').length,
        mainContentLength: (() => {
          const mainContent = document.querySelector('main, [role="main"], .main-content, #main, .content');
          return mainContent ? mainContent.textContent.length : 0;
        })(),
        pageTextPreview: document.body.textContent.substring(0, 200) // First 200 chars for comparison
      }));

      console.log(`   📊 Before interaction - Text preview: "${beforeState.pageTextPreview.replace(/\s+/g, ' ').trim()}"`);

      // Try to interact with the element - Enhanced with multiple strategies
      const interactionResult = await this.page.evaluate(({ selector, elementType }) => {
        const element = document.querySelector(selector);
        if (!element) return { success: false, reason: 'Element not found' };

        // Check if element is still interactive
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
          return { success: false, reason: 'Element not visible' };
        }

        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') {
          return { success: false, reason: 'Element hidden' };
        }

        // Scroll element into view
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });

        try {
          if (elementType === 'hover') {
            // Create and dispatch mouseover event
            const event = new MouseEvent('mouseover', { bubbles: true });
            element.dispatchEvent(event);
            return { success: true, method: 'hover' };
          } else {
            // Multiple click strategies for better success rate
            
            // Strategy 1: Standard click
            element.click();
            
            // Strategy 2: If element text suggests it's a tab, try alternative approaches
            const elementText = (element.textContent || '').toLowerCase();
            if (elementText.includes('experience') || elementText.includes('tab')) {
              
              // Strategy 2a: Try clicking parent elements (common tab pattern)
              let parent = element.parentElement;
              while (parent && parent !== document.body) {
                if (parent.tagName === 'BUTTON' || parent.getAttribute('role') === 'tab' || 
                    parent.classList.contains('tab') || parent.onclick) {
                  parent.click();
                  break;
                }
                parent = parent.parentElement;
              }
              
              // Strategy 2b: Try finding and clicking related tab elements
              const tabButtons = document.querySelectorAll('[role="tab"], .tab, button[data-tab], [aria-controls]');
              for (const tab of tabButtons) {
                const tabText = (tab.textContent || '').toLowerCase();
                if (tabText.includes('experience')) {
                  tab.click();
                  break;
                }
              }
              
              // Strategy 2c: Dispatch multiple event types
              ['mousedown', 'mouseup', 'click'].forEach(eventType => {
                const event = new MouseEvent(eventType, { 
                  bubbles: true, 
                  cancelable: true,
                  view: window 
                });
                element.dispatchEvent(event);
              });
            }
            
            return { success: true, method: 'click_enhanced' };
          }
        } catch (error) {
          return { success: false, reason: error.message };
        }
      }, { selector: elementData.selector, elementType: elementData.type });

      if (!interactionResult.success) {
        console.log(`   ❌ Interaction failed: ${interactionResult.reason}`);
        return null;
      }

      console.log(`   ✅ Click successful, waiting for initial response...`);
      
      // Wait for immediate response to the click
      await this.page.waitForTimeout(this.options.interactionDelay);

      // Special handling for tab-like elements
      const isTabElement = elementData.text.includes('experience') || 
                         elementData.text.includes('projects') || 
                         elementData.selector.includes('tab') ||
                         elementData.text.includes('tab');

      if (isTabElement) {
        console.log(`   🎯 DETECTED TAB ELEMENT: "${elementData.text}"`);
        console.log(`   ⏳ Waiting for tab content to fully load...`);
        
        // Wait for tab transition animations
        await this.page.waitForTimeout(2000);
        
        // Wait for network requests to complete (common in tab switches)
        try {
          await this.page.waitForLoadState('networkidle', { timeout: 3000 });
        } catch (e) {
          console.log(`   ⚠️  Network idle timeout, continuing anyway...`);
        }
        
        // Additional wait for dynamic content
        await this.page.waitForTimeout(1000);
      }

      // Get page state after interaction and all waits
      const afterState = await this.page.evaluate(() => ({
        domHash: document.documentElement.innerHTML.length,
        textLength: document.body.textContent.length,
        pageTextPreview: document.body.textContent.substring(0, 300), // Increased to 300 chars
        visibleElementCount: Array.from(document.querySelectorAll('*')).filter(el => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }).length,
        selectedElementCount: document.querySelectorAll('[aria-selected="true"], .active, .selected, [class*="active"], [class*="selected"]').length,
        mainContentLength: (() => {
          const mainContent = document.querySelector('main, [role="main"], .main-content, #main, .content');
          return mainContent ? mainContent.textContent.length : 0;
        })(),
        // Check for specific content indicators
        hasProjectsContent: document.body.textContent.toLowerCase().includes('featured projects'),
        hasExperienceContent: document.body.textContent.toLowerCase().includes('professional experience') || 
                             document.body.textContent.toLowerCase().includes('devops engineer'),
        bodyTextHash: document.body.textContent.replace(/\s+/g, ' ').trim().substring(0, 500)
      }));

      console.log(`   📊 After interaction - Text preview: "${afterState.pageTextPreview.replace(/\s+/g, ' ').trim()}"`);
      console.log(`   📊 Content comparison:`);
      console.log(`     - DOM size change: ${beforeState.domHash} → ${afterState.domHash} (${afterState.domHash - beforeState.domHash})`);
      console.log(`     - Text length change: ${beforeState.textLength} → ${afterState.textLength} (${afterState.textLength - beforeState.textLength})`);
      console.log(`     - Visible elements: ${beforeState.visibleElementCount} → ${afterState.visibleElementCount} (${afterState.visibleElementCount - beforeState.visibleElementCount})`);
      console.log(`     - Selected elements: ${beforeState.selectedElementCount} → ${afterState.selectedElementCount}`);
      console.log(`     - Text content same: ${beforeState.pageTextPreview === afterState.pageTextPreview ? '❌ IDENTICAL' : '✅ CHANGED'}`);
      console.log(`     - Body text hash same: ${beforeState.bodyTextHash === afterState.bodyTextHash ? '❌ IDENTICAL' : '✅ CHANGED'}`);
      console.log(`     - Projects content: ${afterState.hasProjectsContent ? '✅ DETECTED' : '❌ NOT FOUND'}`);
      console.log(`     - Experience content: ${afterState.hasExperienceContent ? '✅ DETECTED' : '❌ NOT FOUND'}`);

      // Enhanced change detection based on content type
      let contentTypeChanged = false;
      if (elementData.text.includes('experience')) {
        contentTypeChanged = afterState.hasExperienceContent && !beforeState.hasProjectsContent;
        console.log(`     - Experience tab success: ${contentTypeChanged ? '✅ SUCCESS' : '❌ FAILED'}`);
      } else if (elementData.text.includes('projects')) {
        contentTypeChanged = afterState.hasProjectsContent && !beforeState.hasExperienceContent;
        console.log(`     - Projects tab success: ${contentTypeChanged ? '✅ SUCCESS' : '❌ FAILED'}`);
      }

      if (hasSignificantChanges) {
        console.log(`   ✅ Content changed! Details:`, {
          domChanged: changes.domChanged,
          textChanged: changes.textChanged,
          urlChanged: changes.urlChanged,
          activeElementChanged: changes.activeElementChanged,
          visibilityChanged: changes.visibilityChanged,
          styleChanges: changes.styleChanges
        });
        
        // For important tab elements, wait even longer to ensure content is stable
        if (elementData.text.includes('experience')) {
          console.log(`   🎯 EXPERIENCE TAB DETECTED! Waiting extra time for content to stabilize...`);
          await this.page.waitForTimeout(3000);
          
          // Check if experience content is actually visible
          const experienceContentCheck = await this.page.evaluate(() => {
            const bodyText = document.body.textContent.toLowerCase();
            const hasExperienceKeywords = bodyText.includes('experience') && 
                                        (bodyText.includes('work') || bodyText.includes('role') || 
                                         bodyText.includes('company') || bodyText.includes('position') ||
                                         bodyText.includes('job') || bodyText.includes('career'));
            
            // Also check for specific experience content structure
            const experienceElements = document.querySelectorAll('[class*="experience"], [id*="experience"], [data-*="experience"]');
            
            return {
              hasExperienceKeywords,
              experienceElementsFound: experienceElements.length,
              bodyTextSample: document.body.textContent.substring(0, 500)
            };
          });
          
          console.log(`   📋 Experience content check:`, experienceContentCheck);
        }
        
        // Take screenshot of the new state with descriptive filename
        const elementDescription = elementData.text ? elementData.text.substring(0, 15) : elementData.type;
        const screenshotData = await this.takeScreenshot(`interaction_${index + 1}_${elementDescription.replace(/[^a-zA-Z0-9]/g, '_')}`);
        
        // Record interaction
        this.interactionHistory.set(elementData.selector, {
          elementData,
          interactionResult,
          changes,
          screenshot: screenshotData,
          timestamp: Date.now()
        });

        return screenshotData;
      } else {
        console.log(`   ℹ️  No significant changes detected`);
        return null;
      }

    } catch (error) {
      console.log(`   ❌ Error interacting with element: ${error.message}`);
      return null;
    }
  }

  // Phase 4: Screenshot Management
  async takeScreenshot(filename) {
    try {
      const screenshotBuffer = await this.page.screenshot({
        fullPage: true,
        type: 'png'
      });

      const screenshotData = {
        filename: `${filename}.png`,
        timestamp: new Date().toISOString(),
        size: screenshotBuffer.length,
        buffer: screenshotBuffer
      };

      this.screenshots.push(screenshotData);
      return screenshotData;
    } catch (error) {
      console.error(`Failed to take screenshot: ${error.message}`);
      return null;
    }
  }

  // Phase 5: Main Execution Flow
  async captureInteractiveContent() {
    console.log('🚀 Starting interactive content capture...');

    try {
      // Step 1: Take baseline screenshot
      console.log('📸 Taking baseline screenshot...');
      await this.takeScreenshot('00_baseline');

      // Step 2: Discover all interactive elements
      await this.discoverInteractiveElements();

      if (this.discoveredElements.length === 0) {
        console.log('ℹ️  No interactive elements found');
        return this.screenshots;
      }

      // Step 3: Process elements systematically
      const maxInteractions = Math.min(this.discoveredElements.length, this.options.maxInteractions);
      console.log(`🎯 Processing top ${maxInteractions} interactive elements...`);

      for (let i = 0; i < maxInteractions; i++) {
        if (this.screenshots.length >= this.options.maxScreenshots) {
          console.log(`📸 Reached screenshot limit (${this.options.maxScreenshots})`);
          break;
        }

        const element = this.discoveredElements[i];
        await this.interactWithElement(element, i);

        // Small delay between interactions to avoid overwhelming the page
        if (i < maxInteractions - 1) {
          await this.page.waitForTimeout(200);
        }
      }

      // Step 4: Final screenshot if we haven't taken many
      if (this.screenshots.length < 3) {
        console.log('📸 Taking final comprehensive screenshot...');
        await this.takeScreenshot('99_final');
      }

      console.log(`✅ Capture complete! Generated ${this.screenshots.length} screenshots`);
      return this.screenshots;

    } catch (error) {
      console.error(`❌ Interactive capture failed: ${error.message}`);
      return this.screenshots;
    }
  }

  // Utility method to get capture summary
  getCaptureReport() {
    const report = {
      totalScreenshots: this.screenshots.length,
      totalInteractions: this.interactionHistory.size,
      discoveredElements: this.discoveredElements.length,
      successfulInteractions: Array.from(this.interactionHistory.values()).filter(h => h.screenshot).length,
      elementTypes: {},
      interactionTypes: {}
    };

    // Analyze discovered elements
    this.discoveredElements.forEach(el => {
      report.elementTypes[el.type] = (report.elementTypes[el.type] || 0) + 1;
    });

    // Analyze successful interactions
    Array.from(this.interactionHistory.values()).forEach(interaction => {
      const type = interaction.elementData.type;
      report.interactionTypes[type] = (report.interactionTypes[type] || 0) + 1;
    });

    return report;
  }
}

module.exports = { InteractiveContentCapture };