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
        if (element.id) return `#${element.id}`;
        if (element.className && typeof element.className === 'string') {
          const classes = element.className.trim().split(/\s+/).slice(0, 3);
          if (classes.length > 0) {
            return `${element.tagName.toLowerCase()}.${classes.join('.')}`;
          }
        }
        return element.tagName.toLowerCase();
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

      // 1. EXPLICIT INTERACTIVE ELEMENTS
      // Buttons and links
      document.querySelectorAll('button, a, [role="button"], [role="tab"], [role="menuitem"]').forEach(el => {
        if (!isInteractive(el) || seenElements.has(el)) return;
        
        const text = getTextContent(el);
        const selector = getSelector(el);
        
        discovered.push({
          element: el,
          selector,
          type: 'explicit',
          subtype: el.tagName.toLowerCase(),
          priority: this.getElementPriority(el, text),
          text: text,
          reason: 'explicit interactive element'
        });
        seenElements.add(el);
      });

      // 2. EXPANDABLE CONTENT PATTERNS
      const expandablePatterns = [
        /show\s*more/i, /read\s*more/i, /view\s*more/i, /see\s*more/i,
        /expand/i, /details/i, /learn\s*more/i, /more\s*info/i,
        /\+\s*more/i, /\d+\s*more/i, /additional/i, /full\s*description/i
      ];

      document.querySelectorAll('*').forEach(el => {
        if (seenElements.has(el) || !isInteractive(el)) return;
        
        const text = getTextContent(el);
        const isExpandable = expandablePatterns.some(pattern => pattern.test(text));
        
        if (isExpandable) {
          discovered.push({
            element: el,
            selector: getSelector(el),
            type: 'expandable',
            subtype: 'text-pattern',
            priority: 8, // High priority for expandable content
            text: text,
            reason: 'expandable text pattern'
          });
          seenElements.add(el);
        }
      });

      // 3. STRUCTURAL INTERACTIVE ELEMENTS
      // Details/Summary
      document.querySelectorAll('details summary').forEach(el => {
        if (seenElements.has(el)) return;
        
        discovered.push({
          element: el,
          selector: getSelector(el),
          type: 'structural',
          subtype: 'details-summary',
          priority: 9,
          text: getTextContent(el),
          reason: 'details/summary element'
        });
        seenElements.add(el);
      });

      // 4. ARIA-BASED INTERACTIVE ELEMENTS
      document.querySelectorAll('[aria-expanded], [aria-controls], [data-toggle], [data-target]').forEach(el => {
        if (seenElements.has(el) || !isInteractive(el)) return;
        
        const ariaExpanded = el.getAttribute('aria-expanded');
        const priority = ariaExpanded === 'false' ? 9 : 6;
        
        discovered.push({
          element: el,
          selector: getSelector(el),
          type: 'aria',
          subtype: 'aria-interactive',
          priority: priority,
          text: getTextContent(el),
          reason: 'ARIA interactive attributes',
          ariaState: ariaExpanded
        });
        seenElements.add(el);
      });

      // 5. TAB-LIKE ELEMENTS
      const findTabGroups = () => {
        const tabGroups = [];
        
        // Look for explicit tab lists
        document.querySelectorAll('[role="tablist"]').forEach(tablist => {
          const tabs = Array.from(tablist.querySelectorAll('[role="tab"], button, a')).filter(isInteractive);
          if (tabs.length > 1) {
            tabGroups.push({
              container: tablist,
              tabs: tabs,
              type: 'explicit-tablist'
            });
          }
        });

        // Look for button groups that act like tabs
        document.querySelectorAll('.tabs, .tab-container, [class*="tab"], .nav, .navigation').forEach(container => {
          const buttons = Array.from(container.querySelectorAll('button, a')).filter(isInteractive);
          if (buttons.length > 1) {
            tabGroups.push({
              container: container,
              tabs: buttons,
              type: 'button-group'
            });
          }
        });

        return tabGroups;
      };

      const tabGroups = findTabGroups();
      tabGroups.forEach((group, groupIndex) => {
        group.tabs.forEach((tab, tabIndex) => {
          if (seenElements.has(tab)) return;
          
          discovered.push({
            element: tab,
            selector: getSelector(tab),
            type: 'tab',
            subtype: group.type,
            priority: 10, // Highest priority for tabs
            text: getTextContent(tab),
            reason: `tab ${tabIndex + 1} in group ${groupIndex + 1}`,
            tabGroup: groupIndex,
            tabIndex: tabIndex
          });
          seenElements.add(tab);
        });
      });

      // 6. HOVER-ACTIVATED ELEMENTS
      document.querySelectorAll('[title], [data-tooltip], .tooltip-trigger, [onmouseover]').forEach(el => {
        if (seenElements.has(el) || !isInteractive(el)) return;
        
        discovered.push({
          element: el,
          selector: getSelector(el),
          type: 'hover',
          subtype: 'tooltip-trigger',
          priority: 3, // Lower priority
          text: getTextContent(el),
          reason: 'hover-activated element'
        });
        seenElements.add(el);
      });

      // 7. ELEMENTS WITH CLICK HANDLERS
      document.querySelectorAll('*').forEach(el => {
        if (seenElements.has(el) || !isInteractive(el)) return;
        
        const style = getComputedStyle(el);
        const hasClickCursor = style.cursor === 'pointer';
        const hasClickHandler = el.onclick !== null || el.getAttribute('onclick');
        
        if (hasClickCursor || hasClickHandler) {
          discovered.push({
            element: el,
            selector: getSelector(el),
            type: 'clickable',
            subtype: hasClickHandler ? 'onclick-handler' : 'pointer-cursor',
            priority: 5,
            text: getTextContent(el),
            reason: hasClickHandler ? 'has onclick handler' : 'pointer cursor'
          });
          seenElements.add(el);
        }
      });

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

  // Phase 2: Change Detection System
  async detectContentChanges(beforeState) {
    await this.page.waitForTimeout(this.options.changeDetectionTimeout);
    
    return await this.page.evaluate((beforeState) => {
      const changes = {
        domChanged: false,
        newElements: [],
        visibilityChanged: [],
        textChanged: false,
        layoutChanged: false,
        newImages: []
      };

      // Check DOM structure changes
      const currentDomHash = document.documentElement.innerHTML.length;
      if (currentDomHash !== beforeState.domHash) {
        changes.domChanged = true;
      }

      // Check for new visible elements
      const visibleElements = Array.from(document.querySelectorAll('*')).filter(el => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && 
               style.display !== 'none' && 
               style.visibility !== 'hidden' &&
               style.opacity !== '0';
      });

      if (visibleElements.length > beforeState.visibleElementCount) {
        changes.newElements = visibleElements.slice(beforeState.visibleElementCount);
      }

      // Check for new images
      const images = document.querySelectorAll('img');
      if (images.length > beforeState.imageCount) {
        changes.newImages = Array.from(images).slice(beforeState.imageCount);
      }

      // Simple text content change detection
      const currentTextLength = document.body.textContent.length;
      if (Math.abs(currentTextLength - beforeState.textLength) > 100) {
        changes.textChanged = true;
      }

      return changes;
    }, beforeState);
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
        scrollY: window.scrollY
      }));

      // Try to interact with the element
      const interactionResult = await this.page.evaluate((selector, elementData) => {
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

        // Choose interaction method based on element type
        try {
          if (elementData.type === 'hover') {
            // Create and dispatch mouseover event
            const event = new MouseEvent('mouseover', { bubbles: true });
            element.dispatchEvent(event);
          } else {
            // Standard click
            element.click();
          }
          
          return { success: true, method: elementData.type === 'hover' ? 'hover' : 'click' };
        } catch (error) {
          return { success: false, reason: error.message };
        }
      }, elementData.selector, elementData);

      if (!interactionResult.success) {
        console.log(`   ❌ Interaction failed: ${interactionResult.reason}`);
        return null;
      }

      // Wait for any animations or transitions
      await this.page.waitForTimeout(this.options.interactionDelay);

      // Detect if content actually changed
      const changes = await this.detectContentChanges(beforeState);
      const hasSignificantChanges = changes.domChanged || 
                                   changes.newElements.length > 0 || 
                                   changes.newImages.length > 0 || 
                                   changes.textChanged;

      if (hasSignificantChanges) {
        console.log(`   ✅ Content changed! Taking screenshot...`);
        
        // Take screenshot of the new state
        const screenshotData = await this.takeScreenshot(`interaction_${index + 1}_${elementData.type}`);
        
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