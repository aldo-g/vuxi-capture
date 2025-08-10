// Enhanced Interactive Content Capture System
// This system systematically discovers, interacts with, and captures all interactive content
// Designed to work generically across all websites without hardcoded assumptions

class InteractiveContentCapture {
  constructor(page, options = {}) {
    this.page = page;
    this.options = {
      maxInteractions: options.maxInteractions || 50,
      maxScreenshots: options.maxScreenshots || 20,
      interactionDelay: options.interactionDelay || 800,
      changeDetectionTimeout: options.changeDetectionTimeout || 2000,
      scrollPauseTime: options.scrollPauseTime || 500,
      enableHoverCapture: options.enableHoverCapture || false,
      prioritizeNavigation: options.prioritizeNavigation !== false,
      skipSocialElements: options.skipSocialElements !== false,
      maxProcessingTime: options.maxProcessingTime || 120000,
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
    
    const elements = await this.page.evaluate((options) => {
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

      // Helper to check if element should be skipped (social media, ads, etc.)
      const shouldSkipElement = (element, text) => {
        if (!options.skipSocialElements) return false;
        
        // Skip common social and tracking elements
        const socialPatterns = [
          'share', 'tweet', 'facebook', 'linkedin', 'instagram', 'youtube',
          'google+', 'pinterest', 'snapchat', 'tiktok', 'whatsapp',
          'cookie', 'gdpr', 'privacy', 'analytics', 'tracking',
          'advertisement', 'sponsored', 'promo'
        ];
        
        const textLower = text.toLowerCase();
        const classNames = (element.className || '').toLowerCase();
        const id = (element.id || '').toLowerCase();
        
        return socialPatterns.some(pattern => 
          textLower.includes(pattern) || classNames.includes(pattern) || id.includes(pattern)
        );
      };

      // Helper function to get element priority (higher = more important)
      function getElementPriority(element, text) {
        // Navigation elements get highest priority
        if (element.closest('nav, .nav, .navigation, .menu, header, .header')) return 10;
        
        // Tab-related elements (generic detection)
        if (element.getAttribute('role') === 'tab') return 10;
        if (element.getAttribute('role') === 'tabpanel') return 9;
        if (element.classList.contains('tab') || element.getAttribute('data-tab')) return 9;
        
        // Expandable content indicators (generic)
        const expandableKeywords = ['more', 'expand', 'show', 'toggle', 'collapse', 'accordion'];
        if (expandableKeywords.some(keyword => text.includes(keyword))) return 8;
        
        // Structural elements
        if (element.tagName === 'SUMMARY') return 9;
        if (element.getAttribute('aria-expanded') === 'false') return 8;
        
        // Modal and overlay triggers
        if (element.getAttribute('data-modal') || element.getAttribute('data-toggle') === 'modal') return 7;
        
        // Regular buttons and links
        if (element.tagName === 'BUTTON') return 7;
        if (element.tagName === 'A' && element.getAttribute('href') !== '#') return 6;
        
        // Form elements
        if (['SELECT', 'INPUT', 'TEXTAREA'].includes(element.tagName)) return 6;
        
        // Everything else
        return 5;
      }

      // 1. EXPLICIT INTERACTIVE ELEMENTS
      // Buttons and links
      document.querySelectorAll('button, a, [role="button"], [role="tab"], [role="menuitem"]').forEach(el => {
        if (!isInteractive(el) || seenElements.has(el)) return;
        
        const text = getTextContent(el);
        if (shouldSkipElement(el, text)) return;
        
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
        if (shouldSkipElement(el, text)) return;
        
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
        if (shouldSkipElement(el, text)) return;
        
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

      // 4. HOVER-ACTIVATED ELEMENTS (if enabled)
      if (options.enableHoverCapture) {
        document.querySelectorAll('[title], [data-tooltip], .tooltip-trigger, [onmouseover]').forEach(el => {
          if (seenElements.has(el) || !isInteractive(el)) return;
          
          const text = getTextContent(el);
          if (shouldSkipElement(el, text)) return;
          
          discovered.push({
            selector: getSelector(el),
            type: 'hover',
            subtype: 'tooltip-trigger',
            priority: 3, // Lower priority
            text: text,
            reason: 'hover-activated element'
          });
          seenElements.add(el);
        });
      }

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
          if (shouldSkipElement(el, text)) return;
          
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
    }, this.options);

    this.discoveredElements = elements;
    
    // Group elements by priority for logging
    const priorityGroups = {};
    elements.forEach(el => {
      if (!priorityGroups[el.priority]) priorityGroups[el.priority] = [];
      priorityGroups[el.priority].push(el);
    });
    
    console.log(`📊 Discovered ${elements.length} interactive elements:`);
    Object.keys(priorityGroups).sort((a, b) => b - a).forEach(priority => {
      const group = priorityGroups[priority];
      const types = [...new Set(group.map(el => el.type))].join(', ');
      console.log(`   Priority ${priority}: ${group.length} elements (${types})`);
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
        visibilityChanged: false,
        textChanged: false,
        layoutChanged: false,
        newImages: [],
        urlChanged: false,
        activeElementChanged: false,
        styleChanges: false,
        significantChange: false
      };

      // 1. Check URL changes (for navigation)
      if (window.location.href !== beforeState.url) {
        changes.urlChanged = true;
        changes.significantChange = true;
      }

      // 2. Check DOM structure changes (more sensitive)
      const currentDomHash = document.documentElement.innerHTML.length;
      if (Math.abs(currentDomHash - beforeState.domHash) > 50) {  // More sensitive threshold
        changes.domChanged = true;
        changes.significantChange = true;
      }

      // 3. Check for visibility changes (key for tabs and expandable content)
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
        changes.significantChange = true;
      }

      // 4. Check for active/selected element changes
      const selectedElements = document.querySelectorAll('[aria-selected="true"], .active, .selected, [class*="active"], [class*="selected"]');
      if (selectedElements.length !== beforeState.selectedElementCount) {
        changes.activeElementChanged = true;
        changes.significantChange = true;
      }

      // 5. Check for new images
      const images = document.querySelectorAll('img');
      if (images.length > beforeState.imageCount) {
        changes.newImages = Array.from(images).slice(beforeState.imageCount);
        changes.significantChange = true;
      }

      // 6. More sensitive text content change detection
      const currentTextLength = document.body.textContent.length;
      if (Math.abs(currentTextLength - beforeState.textLength) > 50) {  // Lower threshold
        changes.textChanged = true;
        changes.significantChange = true;
      }

      // 7. Check for significant style changes (hidden/shown content)
      const hiddenElements = document.querySelectorAll('[style*="display: none"], [style*="visibility: hidden"]');
      if (Math.abs(hiddenElements.length - beforeState.hiddenElementCount) > 1) {
        changes.styleChanges = true;
        changes.significantChange = true;
      }

      // 8. Check for content area changes (common in SPAs)
      const mainContent = document.querySelector('main, [role="main"], .main-content, #main, .content');
      if (mainContent) {
        const currentMainText = mainContent.textContent.length;
        if (Math.abs(currentMainText - (beforeState.mainContentLength || 0)) > 100) {
          changes.textChanged = true;
          changes.significantChange = true;
        }
      }

      // 9. Check for modal/overlay appearance
      const modals = document.querySelectorAll('[role="dialog"], .modal, .overlay, .popup');
      if (modals.length > (beforeState.modalCount || 0)) {
        changes.significantChange = true;
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
      }),
      modalCount: await this.page.evaluate(() => 
        document.querySelectorAll('[role="dialog"], .modal, .overlay, .popup').length
      )
    });
  }

  // Phase 3: Generic Smart Interaction Logic
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
        modalCount: document.querySelectorAll('[role="dialog"], .modal, .overlay, .popup').length,
        pageTextPreview: document.body.textContent.substring(0, 200)
      }));

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
            // Enhanced click strategies for better success rate
            
            // Strategy 1: Standard click
            element.click();
            
            // Strategy 2: For tab-like elements, try additional approaches
            if (element.getAttribute('role') === 'tab' || 
                element.classList.contains('tab') || 
                element.getAttribute('data-tab')) {
              
              // Try clicking parent elements (common tab pattern)
              let parent = element.parentElement;
              while (parent && parent !== document.body) {
                if (parent.tagName === 'BUTTON' || parent.getAttribute('role') === 'tab' || 
                    parent.classList.contains('tab') || parent.onclick) {
                  parent.click();
                  break;
                }
                parent = parent.parentElement;
              }
              
              // Dispatch multiple event types for better compatibility
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
      
      // Wait for immediate response to the interaction
      await this.page.waitForTimeout(this.options.interactionDelay);

      // Enhanced waiting strategy based on element type
      if (elementData.type === 'explicit' && elementData.subtype === 'button') {
        // Wait longer for buttons as they often trigger significant changes
        await this.page.waitForTimeout(1500);
        
        // Wait for network requests to complete (common in dynamic content)
        try {
          await this.page.waitForLoadState('networkidle', { timeout: 5000 });
        } catch (e) {
          console.log(`   ⚠️  Network idle timeout, continuing anyway...`);
        }
        
        // Wait for any new images that might have loaded
        await this.waitForImages();
        
      } else if (elementData.type === 'expandable') {
        // Wait for animations and transitions
        await this.page.waitForTimeout(1000);
        await this.waitForAnimations();
      }

      // Additional wait for content to stabilize
      await this.page.waitForTimeout(500);

      // Detect changes after interaction
      const changes = await this.detectContentChanges(beforeState);

      if (changes.significantChange) {
        console.log(`   ✅ Content changed! Details:`, {
          domChanged: changes.domChanged,
          textChanged: changes.textChanged,
          urlChanged: changes.urlChanged,
          activeElementChanged: changes.activeElementChanged,
          visibilityChanged: changes.visibilityChanged,
          styleChanges: changes.styleChanges
        });
        
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

  // Enhanced page load waiting system
  async waitForCompletePageLoad() {
    console.log('🔄 Ensuring complete page load...');
    
    try {
      // Step 1: Wait for network to be idle (no requests for 500ms)
      console.log('   📡 Waiting for network idle...');
      await this.page.waitForLoadState('networkidle', { timeout: 10000 });
      
      // Step 2: Wait for DOM to be completely loaded
      console.log('   🌐 Waiting for DOM content loaded...');
      await this.page.waitForLoadState('domcontentloaded', { timeout: 5000 });
      
      // Step 3: Wait for all images to load
      console.log('   🖼️  Waiting for images to load...');
      await this.waitForImages();
      
      // Step 4: Wait for fonts to load
      console.log('   📝 Waiting for fonts to load...');
      await this.waitForFonts();
      
      // Step 5: Wait for CSS animations/transitions to complete
      console.log('   ✨ Waiting for animations to settle...');
      await this.waitForAnimations();
      
      // Step 6: Wait for lazy-loaded content
      console.log('   🔄 Triggering lazy-loaded content...');
      await this.triggerLazyLoading();
      
      // Step 7: Final stability check
      console.log('   ⚖️  Performing stability check...');
      await this.waitForPageStability();
      
      console.log('✅ Page fully loaded and stable');
      
    } catch (error) {
      console.log(`⚠️  Page load timeout, continuing anyway: ${error.message}`);
    }
  }

  // Wait for all images to load
  async waitForImages() {
    return await this.page.evaluate(async () => {
      const images = Array.from(document.querySelectorAll('img'));
      
      if (images.length === 0) return;
      
      const imagePromises = images.map(img => {
        return new Promise((resolve) => {
          if (img.complete) {
            resolve();
          } else {
            img.addEventListener('load', resolve, { once: true });
            img.addEventListener('error', resolve, { once: true }); // Resolve even on error
            
            // Timeout after 5 seconds for any single image
            setTimeout(resolve, 5000);
          }
        });
      });
      
      await Promise.all(imagePromises);
      console.log(`   ✅ ${images.length} images loaded`);
    });
  }

  // Wait for fonts to load
  async waitForFonts() {
    return await this.page.evaluate(async () => {
      if ('fonts' in document) {
        try {
          await document.fonts.ready;
          console.log('   ✅ Fonts loaded');
        } catch (e) {
          console.log('   ⚠️  Font loading timeout');
        }
      }
    });
  }

  // Wait for CSS animations and transitions to complete
  async waitForAnimations() {
    await this.page.evaluate(async () => {
      const elementsWithAnimations = Array.from(document.querySelectorAll('*')).filter(el => {
        const style = getComputedStyle(el);
        return style.animationName !== 'none' || style.transitionProperty !== 'none';
      });
      
      if (elementsWithAnimations.length > 0) {
        console.log(`   🎬 Found ${elementsWithAnimations.length} elements with animations`);
        
        // Wait for animations to complete
        const animationPromises = elementsWithAnimations.map(el => {
          return new Promise(resolve => {
            const onAnimationEnd = () => {
              el.removeEventListener('animationend', onAnimationEnd);
              el.removeEventListener('transitionend', onAnimationEnd);
              resolve();
            };
            
            el.addEventListener('animationend', onAnimationEnd, { once: true });
            el.addEventListener('transitionend', onAnimationEnd, { once: true });
            
            // Timeout after 3 seconds
            setTimeout(resolve, 3000);
          });
        });
        
        await Promise.race([
          Promise.all(animationPromises),
          new Promise(resolve => setTimeout(resolve, 3000)) // Max 3 seconds
        ]);
      }
    });
    
    // Additional wait for any remaining animations
    await this.page.waitForTimeout(500);
  }

  // Trigger lazy loading by scrolling
  async triggerLazyLoading() {
    const pageHeight = await this.page.evaluate(() => document.body.scrollHeight);
    const viewportHeight = await this.page.evaluate(() => window.innerHeight);
    
    // Scroll through the page to trigger lazy loading
    let currentPosition = 0;
    const scrollStep = viewportHeight * 0.8; // Scroll 80% of viewport at a time
    
    while (currentPosition < pageHeight) {
      await this.page.evaluate((position) => {
        window.scrollTo(0, position);
      }, currentPosition);
      
      // Wait a bit for lazy content to load
      await this.page.waitForTimeout(300);
      
      currentPosition += scrollStep;
    }
    
    // Scroll back to top
    await this.page.evaluate(() => window.scrollTo(0, 0));
    await this.page.waitForTimeout(500);
    
    // Wait for any newly loaded images
    await this.waitForImages();
  }

  // Check page stability (no more DOM changes)
  async waitForPageStability() {
    let previousDomHash = '';
    let stableCount = 0;
    const maxChecks = 10;
    
    for (let i = 0; i < maxChecks; i++) {
      const currentDomHash = await this.page.evaluate(() => {
        // Create a hash of the visible content structure
        const visibleElements = Array.from(document.querySelectorAll('*')).filter(el => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
        
        return visibleElements.length + '_' + document.body.textContent.length;
      });
      
      if (currentDomHash === previousDomHash) {
        stableCount++;
        if (stableCount >= 3) { // 3 consecutive stable checks
          console.log('   ✅ Page content stable');
          break;
        }
      } else {
        stableCount = 0;
      }
      
      previousDomHash = currentDomHash;
      await this.page.waitForTimeout(500);
    }
  }
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
      console.log(`   📸 Screenshot saved: ${filename}.png`);
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
      // Step 1: Wait for complete page load
      console.log('⏳ Waiting for complete page load...');
      await this.waitForCompletePageLoad();

      // Step 2: Take baseline screenshot
      console.log('📸 Taking baseline screenshot...');
      await this.takeScreenshot('00_baseline');

      // Step 3: Discover all interactive elements
      console.log('🔍 Discovering interactive elements...');
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

      console.log(`✅ Capture complete! Generated ${this.screenshots.length} screenshots from ${this.interactionHistory.size} successful interactions`);
      
      // Step 5: Deduplicate screenshots
      console.log('🔍 Running image deduplication...');
      const { ImageDeduplicationService } = require('./image-deduplication');
      
      const deduplicationService = new ImageDeduplicationService({
        similarityThreshold: 95, // 95% similarity threshold
        keepHighestQuality: true, // Keep highest quality when duplicates found
        preserveFirst: false, // Don't always preserve first (baseline) screenshot
        verbose: true // Enable detailed logging
      });
      
      this.screenshots = await deduplicationService.processScreenshots(this.screenshots);
      
      // Update the capture report with deduplication info
      this.deduplicationReport = deduplicationService.getDeduplicationReport();
      
      console.log(`🎉 Final result: ${this.screenshots.length} unique screenshots ready!`);
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
      interactionTypes: {},
      deduplication: this.deduplicationReport || null
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