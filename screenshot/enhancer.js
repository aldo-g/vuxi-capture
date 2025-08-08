// This file contains all the JavaScript enhancements from your bash script
class ScreenshotEnhancer {
    async enhance(page) {
      // Inject all enhancements
      await page.addScriptTag({
        content: this.getEnhancementScript()
      });
      
      // Run enhancements
      await page.evaluate(() => window.screenshotEnhancer.main());
    }
    
    getEnhancementScript() {
      return `
        window.screenshotEnhancer = {
          // Function to handle cookie consent popups
          handleCookieConsent: async function() {
            console.log('Looking for cookie consent dialogs...');
            
            // Common cookie consent button selectors
            const acceptButtonSelectors = [
              'button:has-text("Accept")',
              'button:has-text("Accept All")',
              'button:has-text("Agree")',
              'button:has-text("OK")',
              'button[id*="accept"]',
              'button[class*="accept"]',
              'a[id*="accept"]',
              'a[class*="accept"]',
              '.accept-all',
              '#accept-all',
              '[aria-label*="accept"]',
              '[aria-label*="cookies"]',
              '.cc-accept',
              '#cookieAcceptButton',
              // Add selectors from the visible popup in your screenshot
              'button.tabindex',
              '.accept-button',
              'button[data-action="accept-all"]',
              'button:contains("Accept All")'
            ];
            
            // Try each selector
            for (const selector of acceptButtonSelectors) {
              try {
                const buttons = document.querySelectorAll(selector);
                for (const button of buttons) {
                  // Check if the button is visible and contains accept text
                  const buttonText = button.textContent.toLowerCase();
                  const rect = button.getBoundingClientRect();
                  if (rect.width > 0 && rect.height > 0 && 
                      (buttonText.includes('accept') || buttonText.includes('agree'))) {
                    console.log('Found cookie accept button:', buttonText);
                    button.click();
                    console.log('Clicked cookie accept button');
                    // Wait a moment for dialog to close
                    await new Promise(r => setTimeout(r, 500));
                    return true;
                  }
                }
              } catch (e) {
                // Continue trying other selectors
              }
            }
            
            // Try clicking the specific button in the example
            try {
              // Directly target the 'Accept All' green button based on its appearance
              const specificAcceptButton = document.querySelector('.tabindex[aria-label="Accept All"], button.tabindex:nth-child(3)');
              if (specificAcceptButton) {
                console.log('Found specific accept button');
                specificAcceptButton.click();
                console.log('Clicked specific accept button');
                await new Promise(r => setTimeout(r, 500));
                return true;
              }
            } catch (e) {
              console.log('Error clicking specific accept button:', e);
            }
            
            // If all else fails, try to remove the consent dialog from the DOM
            try {
              // Look for common cookie dialog containers
              const dialogSelectors = [
                '[id*="cookie"]', 
                '[class*="cookie"]',
                '[id*="consent"]',
                '[class*="consent"]',
                '[id*="privacy"]',
                '[class*="privacy"]',
                '.modal',
                '#modal',
                '.dialog',
                '#dialog',
                // Specific to the dialog in your screenshot
                '[role="dialog"]',
                '.privacy-dialog',
                '.cookie-banner'
              ];
              
              for (const selector of dialogSelectors) {
                const dialogs = document.querySelectorAll(selector);
                for (const dialog of dialogs) {
                  if (dialog.textContent.toLowerCase().includes('cookie') || 
                      dialog.textContent.toLowerCase().includes('privacy') ||
                      dialog.textContent.toLowerCase().includes('data')) {
                    console.log('Found cookie dialog, removing from DOM');
                    dialog.remove();
                    return true;
                  }
                }
              }
            } catch (e) {
              console.log('Error removing cookie dialog:', e);
            }
            
            return false;
          },
          
          // Function to extract YouTube video ID
          getYouTubeVideoId: function(url) {
            if (!url) return null;
            
            try {
              if (url.includes('youtu.be/')) {
                const match = url.match(/youtu\\.be\\/([^\\/?&]+)/);
                if (match && match[1]) return match[1];
              }
              
              if (url.includes('youtube.com/embed/')) {
                const match = url.match(/youtube\\.com\\/embed\\/([^\\/?&]+)/);
                if (match && match[1]) return match[1];
              }
              
              if (url.includes('youtube.com/v/')) {
                const match = url.match(/youtube\\.com\\/v\\/([^\\/?&]+)/);
                if (match && match[1]) return match[1];
              }
              
              const match = url.match(/[?&]v=([^&#]+)/);
              if (match && match[1]) return match[1];
            } catch (e) {
              console.error('Error extracting YouTube ID:', e);
            }
            
            return null;
          },
          
          // Replace YouTube iframes with clean thumbnails
          replaceWithCleanThumbnails: function() {
            document.querySelectorAll('iframe').forEach((iframe, index) => {
              try {
                const src = iframe.src || '';
                if (!src.includes('youtube') && !src.includes('youtu.be')) {
                  return; // Not a YouTube iframe
                }
                
                console.log('Processing YouTube iframe #' + index + ':', iframe.src);
                
                // Get dimensions
                const width = iframe.width || iframe.clientWidth || 480;
                const height = iframe.height || iframe.clientHeight || 270;
                
                // Extract video ID
                const videoId = this.getYouTubeVideoId(iframe.src);
                
                if (!videoId) {
                  console.log('Could not extract video ID from:', iframe.src);
                  return;
                }
                
                console.log('Found YouTube video ID:', videoId);
                
                // Create wrapper div (to preserve sizing)
                const wrapper = document.createElement('div');
                wrapper.style.width = width + 'px';
                wrapper.style.height = height + 'px';
                wrapper.style.position = 'relative';
                wrapper.style.backgroundColor = '#000';
                wrapper.style.overflow = 'hidden';
                
                // Create image element with maximum quality thumbnail
                const img = document.createElement('img');
                
                // Handle fallbacks for different thumbnail qualities
                img.onerror = function() {
                  if (this.src.includes('maxresdefault')) {
                    this.src = 'https://img.youtube.com/vi/' + videoId + '/sddefault.jpg';
                  } else if (this.src.includes('sddefault')) {
                    this.src = 'https://img.youtube.com/vi/' + videoId + '/hqdefault.jpg';
                  } else if (this.src.includes('hqdefault')) {
                    this.src = 'https://img.youtube.com/vi/' + videoId + '/mqdefault.jpg';
                  } else if (this.src.includes('mqdefault')) {
                    this.src = 'https://img.youtube.com/vi/' + videoId + '/default.jpg';
                  }
                };
                
                // Start with highest quality and let onerror handle fallbacks
                img.src = 'https://img.youtube.com/vi/' + videoId + '/maxresdefault.jpg';
                img.alt = 'Video Thumbnail';
                img.style.width = '100%';
                img.style.height = '100%';
                img.style.objectFit = 'cover';
                wrapper.appendChild(img);
                
                // FIXED: Correctly replace the iframe with our wrapper
                if (iframe.parentNode) {
                  console.log('Replacing YouTube iframe with clean thumbnail');
                  iframe.parentNode.replaceChild(wrapper, iframe);
                }
              } catch (e) {
                console.error('Error replacing YouTube iframe:', e);
              }
            });
          },
          
          // Scroll through the page to trigger lazy loading
          triggerLazyLoading: async function() {
            const maxScroll = Math.max(
              document.body.scrollHeight, 
              document.documentElement.scrollHeight
            );
            
            let currentScroll = 0;
            const step = window.innerHeight / 2;
            
            while (currentScroll <= maxScroll) {
              window.scrollTo(0, currentScroll);
              await new Promise(r => setTimeout(r, 100));
              currentScroll += step;
            }
            
            window.scrollTo(0, 0);
            await new Promise(r => setTimeout(r, 500));
          },
          
          // Function to remove YouTube branding and play buttons
          cleanupYouTubeElements: function() {
            // Remove any play button overlays that might exist on the page
            document.querySelectorAll('.ytp-large-play-button, [class*="play-button"], [class*="ytp-"]').forEach(el => {
              if (el && el.parentNode) {
                el.style.display = 'none';
                try {
                  el.parentNode.removeChild(el);
                } catch (e) {}
              }
            });
            
            // Also look for YouTube text elements
            document.querySelectorAll('*').forEach(el => {
              if (el.textContent && el.textContent.trim() === 'YouTube' && 
                  el.childNodes.length <= 3 && 
                  el.getBoundingClientRect().width < 100) {
                el.style.display = 'none';
              }
            });
          },
          
          // Main execution
          main: async function() {
            console.log('Starting processing sequence with cookie handling');
            
            // First handle any cookie consent popups
            await this.handleCookieConsent();
            
            // Scroll to trigger lazy loading
            await this.triggerLazyLoading();
            
            // Wait a moment to ensure all content has loaded
            await new Promise(r => setTimeout(r, 1000));
            
            // One more check for cookie dialogs
            await this.handleCookieConsent();
            
            // Replace YouTube iframes with clean thumbnails
            this.replaceWithCleanThumbnails();
            
            // Wait for images to load 
            await new Promise(r => setTimeout(r, 2500));
            
            // Clean up any YouTube branding that might still be visible
            this.cleanupYouTubeElements();
            
            // Final check for any cookie dialogs that might have appeared
            await this.handleCookieConsent();
            
            // Take screenshot
            console.log('Taking screenshot with clean YouTube thumbnails');
          }
        };
      `;
    }
  }
  
  module.exports = { ScreenshotEnhancer };