// Enhanced Interactive Content Capture System
// This system systematically discovers, interacts with, and captures all interactive content
// Designed to work generically across all websites without hardcoded assumptions
// NOW WITH ENHANCED CONTENT VALIDATION TO PREVENT UNLOADED CONTENT CAPTURE

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

  // ====== ENHANCED CONTENT VALIDATION METHODS ======

  async validateContentLoaded() {
    console.log('🔍 Validating content is fully loaded...');
    
    const validation = await this.page.evaluate(() => {
      const issues = [];
      
      // 1. Check for unloaded images
      const images = Array.from(document.querySelectorAll('img'));
      const unloadedImages = images.filter(img => {
        return !img.complete || img.naturalWidth === 0 || img.naturalHeight === 0;
      });
      
      if (unloadedImages.length > 0) {
        issues.push({
          type: 'unloaded_images',
          count: unloadedImages.length,
          selectors: unloadedImages.map(img => img.src || img.outerHTML.substring(0, 100)).slice(0, 5)
        });
      }
      
      // 2. Check for loading placeholders/skeletons
      const loadingElements = document.querySelectorAll(
        '[class*="loading"], [class*="skeleton"], [class*="placeholder"], ' +
        '[class*="spinner"], [data-loading], .loading, .skeleton, .placeholder'
      );
      
      if (loadingElements.length > 0) {
        issues.push({
          type: 'loading_placeholders',
          count: loadingElements.length,
          elements: Array.from(loadingElements).map(el => el.className || el.tagName).slice(0, 5)
        });
      }
      
      // 3. Check for empty content areas that should have content
      const contentAreas = document.querySelectorAll(
        'main, [role="main"], .content, .main-content, article, section'
      );
      
      const emptyContentAreas = Array.from(contentAreas).filter(area => {
        const text = area.textContent.trim();
        const images = area.querySelectorAll('img').length;
        const videos = area.querySelectorAll('video').length;
        
        // Consider it empty if it has very little content
        return text.length < 50 && images === 0 && videos === 0;
      });
      
      if (emptyContentAreas.length > 0) {
        issues.push({
          type: 'empty_content_areas',
          count: emptyContentAreas.length
        });
      }
      
      // 4. Check for error messages or failed content
      const errorElements = document.querySelectorAll(
        '[class*="error"], [class*="failed"], [class*="404"], ' +
        '.error, .failed, .not-found, [data-error]'
      );
      
      if (errorElements.length > 0) {
        issues.push({
          type: 'error_elements',
          count: errorElements.length,
          messages: Array.from(errorElements).map(el => el.textContent.trim()).slice(0, 3)
        });
      }
      
      // 5. Check for lazy loading indicators
      const lazyElements = document.querySelectorAll(
        '[data-lazy], [loading="lazy"], [class*="lazy"]'
      );
      
      if (lazyElements.length > 0) {
        issues.push({
          type: 'lazy_elements',
          count: lazyElements.length
        });
      }
      
      return {
        isValid: issues.length === 0,
        issues: issues,
        stats: {
          totalImages: images.length,
          loadedImages: images.length - unloadedImages.length,
          contentAreas: contentAreas.length,
          totalElements: document.querySelectorAll('*').length
        }
      };
    });
    
    if (!validation.isValid) {
      console.log('⚠️  Content validation issues found:', validation.issues);
      
      // Try to fix some issues
      await this.attemptContentRecovery(validation.issues);
      
      // Re-validate after recovery attempt
      const revalidation = await this.page.evaluate(() => {
        const images = Array.from(document.querySelectorAll('img'));
        const unloadedImages = images.filter(img => !img.complete || img.naturalWidth === 0);
        return {
          remainingIssues: unloadedImages.length,
          totalImages: images.length
        };
      });
      
      console.log(`🔍 After recovery: ${revalidation.remainingIssues}/${revalidation.totalImages} images still unloaded`);
    } else {
      console.log('✅ Content validation passed');
    }
    
    return validation;
  }

  async attemptContentRecovery(issues) {
    console.log('🔧 Attempting content recovery...');
    
    for (const issue of issues) {
      switch (issue.type) {
        case 'unloaded_images':
          console.log(`   🖼️  Attempting to reload ${issue.count} images...`);
          await this.page.evaluate(() => {
            const unloadedImages = Array.from(document.querySelectorAll('img')).filter(img => 
              !img.complete || img.naturalWidth === 0
            );
            
            unloadedImages.forEach(img => {
              const src = img.src;
              if (src) {
                img.src = '';
                setTimeout(() => img.src = src, 100);
              }
            });
          });
          
          await this.page.waitForTimeout(2000);
          await this.waitForImages();
          break;
          
        case 'loading_placeholders':
          console.log('   ⏳ Waiting longer for loading placeholders...');
          await this.page.waitForTimeout(3000);
          break;
          
        case 'lazy_elements':
          console.log('   🔄 Re-triggering lazy loading...');
          await this.triggerLazyLoading();
          break;
      }
    }
  }

  async shouldTakeScreenshot() {
    const contentQuality = await this.page.evaluate(() => {
      // Check content quality metrics
      const metrics = {
        score: 100,
        issues: []
      };
      
      // 1. Check image loading ratio
      const images = Array.from(document.querySelectorAll('img'));
      const unloadedImages = images.filter(img => 
        !img.complete || img.naturalWidth === 0 || img.naturalHeight === 0
      );
      
      const imageLoadRatio = images.length > 0 ? (images.length - unloadedImages.length) / images.length : 1;
      
      if (imageLoadRatio < 0.8 && images.length > 3) {
        metrics.score -= 30;
        metrics.issues.push(`${unloadedImages.length}/${images.length} images not loaded`);
      }
      
      // 2. Check for loading states
      const loadingElements = document.querySelectorAll(
        '[class*="loading"], [class*="skeleton"], [class*="spinner"], ' +
        '[data-loading="true"], .loading, .skeleton'
      );
      
      if (loadingElements.length > 0) {
        metrics.score -= 20;
        metrics.issues.push(`${loadingElements.length} loading placeholders visible`);
      }
      
      // 3. Check content density
      const textContent = document.body.textContent.trim();
      const contentDensity = textContent.length;
      
      if (contentDensity < 100) {
        metrics.score -= 25;
        metrics.issues.push('Low content density');
      }
      
      // 4. Check for error states
      const errorElements = document.querySelectorAll(
        '[class*="error"], [class*="404"], [class*="failed"], .error, .not-found'
      );
      
      if (errorElements.length > 0) {
        metrics.score -= 40;
        metrics.issues.push('Error elements detected');
      }
      
      // 5. Check for blank/white screen
      const visibleElements = Array.from(document.querySelectorAll('*')).filter(el => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && 
               style.display !== 'none' && 
               style.visibility !== 'hidden';
      });
      
      if (visibleElements.length < 10) {
        metrics.score -= 50;
        metrics.issues.push('Very few visible elements');
      }
      
      return metrics;
    });
    
    const shouldTake = contentQuality.score >= 70; // Threshold for acceptable content
    
    if (!shouldTake) {
      console.log(`   ⚠️  Skipping screenshot - content quality score: ${contentQuality.score}/100`);
      console.log(`   Issues: ${contentQuality.issues.join(', ')}`);
    }
    
    return shouldTake;
  }

  // Enhanced version of waitForCompletePageLoad with validation
  async waitForCompletePageLoadWithValidation() {
    console.log('🔄 Ensuring complete page load with validation...');
    
    try {
      // Run existing page load logic
      await this.waitForCompletePageLoad();
      
      // Add content validation
      const validation = await this.validateContentLoaded();
      
      // If content issues remain, decide whether to proceed or retry
      if (!validation.isValid) {
        const criticalIssues = validation.issues.filter(issue => 
          issue.type === 'unloaded_images' || issue.type === 'empty_content_areas'
        );
        
        if (criticalIssues.length > 0) {
          console.log('⚠️  Critical content issues detected, but proceeding with capture...');
          // You could choose to throw an error here instead: throw new Error('Critical content not loaded');
        }
      }
      
      console.log('✅ Page fully loaded and validated');
      
    } catch (error) {
      console.log(`⚠️  Page load/validation timeout, continuing anyway: ${error.message}`);
    }
  }

  // Enhanced takeScreenshot with quality check
  async takeScreenshotWithQualityCheck(filename) {
    try {
      // Check if content is ready for screenshot
      const shouldTake = await this.shouldTakeScreenshot();
      
      if (!shouldTake) {
        console.log(`   ⏭️  Skipping screenshot: ${filename} - content not ready`);
        return null;
      }
      
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

  // ====== EXISTING METHODS (UPDATED TO USE NEW VALIDATION) ======

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
        
        const socialPatterns = [
          'facebook', 'twitter', 'instagram', 'linkedin', 'youtube',
          'share', 'tweet', 'follow', 'subscribe', 'like', 'upvote',
          'advertisement', 'sponsored', 'promo'
        ];
        
        const elementHtml = element.outerHTML.toLowerCase();
        return socialPatterns.some(pattern => 
          text.includes(pattern) || elementHtml.includes(pattern)
        );
      };

      // Element discovery categories with priority scoring
      const elementCategories = [
        // High Priority: Navigation & Core Actions
        {
          name: 'explicit',
          priority: 100,
          selectors: ['button', 'input[type="submit"]', 'input[type="button"]', '[role="button"]'],
          getSubtype: (el) => {
            const text = getTextContent(el);
            if (text.includes('submit') || text.includes('send')) return 'submit';
            if (text.includes('search')) return 'search';
            if (text.includes('next') || text.includes('continue')) return 'navigation';
            return 'button';
          }
        },
        {
          name: 'navigation',
          priority: 95,
          selectors: ['a[href]', 'nav a', '[role="link"]'],
          getSubtype: (el) => {
            if (el.closest('nav')) return 'nav-link';
            if (el.href && el.href.includes('#')) return 'anchor-link';
            return 'link';
          }
        },
        // Medium Priority: Interactive Content
        {
          name: 'expandable',
          priority: 80,
          selectors: ['details', '[aria-expanded]', '.accordion', '.collapsible', '.expandable'],
          getSubtype: (el) => {
            if (el.tagName === 'DETAILS') return 'details';
            if (el.hasAttribute('aria-expanded')) return 'aria-expandable';
            return 'expandable';
          }
        },
        {
          name: 'tabs',
          priority: 85,
          selectors: ['[role="tab"]', '.tab', '.tab-button', '[data-tab]'],
          getSubtype: () => 'tab'
        },
        {
          name: 'forms',
          priority: 75,
          selectors: ['input:not([type="hidden"])', 'select', 'textarea'],
          getSubtype: (el) => el.type || el.tagName.toLowerCase()
        },
        // Lower Priority: Secondary Interactions
        {
          name: 'modal-triggers',
          priority: 70,
          selectors: ['[data-toggle="modal"]', '[data-modal]', '.modal-trigger'],
          getSubtype: () => 'modal-trigger'
        },
        {
          name: 'interactive-generic',
          priority: 60,
          selectors: ['[onclick]', '[onmouseover]', '[data-action]'],
          getSubtype: (el) => {
            if (el.hasAttribute('onclick')) return 'onclick';
            if (el.hasAttribute('onmouseover')) return 'hover';
            return 'data-action';
          }
        }
      ];

      // Process each category
      elementCategories.forEach(category => {
        category.selectors.forEach(selector => {
          try {
            const elements = document.querySelectorAll(selector);
            
            elements.forEach(element => {
              if (!isInteractive(element)) return;
              
              const text = getTextContent(element);
              if (shouldSkipElement(element, text)) return;
              
              const elementId = element.outerHTML;
              if (seenElements.has(elementId)) return;
              seenElements.add(elementId);

              discovered.push({
                selector: getSelector(element),
                type: category.name,
                subtype: category.getSubtype(element),
                text: text.substring(0, 100),
                priority: category.priority,
                rect: element.getBoundingClientRect(),
                tagName: element.tagName,
                hasText: text.length > 0,
                isVisible: true,
                attributes: {
                  id: element.id || null,
                  className: element.className || null,
                  href: element.href || null,
                  type: element.type || null
                }
              });
            });
          } catch (e) {
            console.warn(`Error processing selector ${selector}:`, e);
          }
        });
      });

      // Sort by priority and filter duplicates
      const uniqueElements = discovered
        .sort((a, b) => b.priority - a.priority)
        .slice(0, options.maxInteractions);

      return uniqueElements;
    }, this.options);

    this.discoveredElements = elements;
    console.log(`🎯 Discovered ${this.discoveredElements.length} interactive elements`);
    
    // Log distribution by type
    const distribution = {};
    this.discoveredElements.forEach(el => {
      distribution[el.type] = (distribution[el.type] || 0) + 1;
    });
    console.log('📊 Element distribution:', distribution);
  }

  // Phase 2: Content Change Detection (after interaction)
  async detectContentChanges(beforeState) {
    return await this.page.evaluate((beforeState) => {
      const changes = {
        significantChange: false,
        domChanged: false,
        textChanged: false,
        urlChanged: false,
        activeElementChanged: false,
        visibilityChanged: false,
        styleChanges: false,
        newImages: []
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
        modalCount: document.querySelectorAll('[role="dialog"], .modal, .overlay, .popup').length
      }));

      // Perform the interaction
      const interactionResult = await this.page.evaluate((data) => {
        try {
          const element = document.querySelector(data.selector);
          if (!element) {
            return { success: false, reason: 'Element not found' };
          }

          // Check if element is still visible and interactive
          const rect = element.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) {
            return { success: false, reason: 'Element not visible' };
          }

          // Scroll element into view
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });

          // Wait a moment for scroll
          setTimeout(() => {
            // Determine interaction type based on element
            if (element.tagName === 'DETAILS') {
              element.open = !element.open;
            } else if (element.hasAttribute('aria-expanded')) {
              const expanded = element.getAttribute('aria-expanded') === 'true';
              element.setAttribute('aria-expanded', (!expanded).toString());
              element.click();
            } else {
              // Default to click
              element.click();
            }
          }, 100);

          return { success: true, action: 'click' };
        } catch (error) {
          return { success: false, reason: error.message };
        }
      }, { selector: elementData.selector, type: elementData.type });

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
        
        // Take screenshot with quality check
        const elementDescription = elementData.text ? elementData.text.substring(0, 15) : elementData.type;
        const screenshotData = await this.takeScreenshotWithQualityCheck(`interaction_${index + 1}_${elementDescription.replace(/[^a-zA-Z0-9]/g, '_')}`);
        
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

  // Legacy takeScreenshot method (for compatibility)
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
      // Step 1: Wait for complete page load WITH VALIDATION
      console.log('⏳ Waiting for complete page load with validation...');
      await this.waitForCompletePageLoadWithValidation();

      // Step 2: Take baseline screenshot WITH QUALITY CHECK
      console.log('📸 Taking baseline screenshot...');
      await this.takeScreenshotWithQualityCheck('00_baseline');

      // Step 3: Discover all interactive elements
      console.log('🔍 Discovering interactive elements...');
      await this.discoverInteractiveElements();

      if (this.discoveredElements.length === 0) {
        console.log('ℹ️  No interactive elements found');
        return this.screenshots;
      }

      // Step 4: Process elements systematically
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

      // Step 5: Final screenshot if we haven't taken many
      if (this.screenshots.length < 3) {
        console.log('📸 Taking final comprehensive screenshot...');
        await this.takeScreenshotWithQualityCheck('99_final');
      }

      console.log(`✅ Capture complete! Generated ${this.screenshots.length} screenshots from ${this.interactionHistory.size} successful interactions`);
      
      // Step 6: Deduplicate screenshots
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