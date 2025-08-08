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

          // Base selectors that are safe for querySelectorAll
          const acceptButtonSelectors = [
            'button',
            'a',
            '.accept-all',
            '#accept-all',
            '[aria-label*="accept" i]',
            '[aria-label*="cookies" i]',
            '.cc-accept',
            '#cookieAcceptButton',
            '.accept-button',
            'button[data-action="accept-all"]'
          ];

          for (const selector of acceptButtonSelectors) {
            try {
              const buttons = document.querySelectorAll(selector);
              for (const button of buttons) {
                const buttonText = (button.textContent || '').toLowerCase();
                const rect = button.getBoundingClientRect();
                if (
                  rect.width > 0 &&
                  rect.height > 0 &&
                  (buttonText.includes('accept') || buttonText.includes('agree'))
                ) {
                  console.log('Found cookie accept button:', buttonText);
                  button.click();
                  await new Promise(r => setTimeout(r, 500));
                  return true;
                }
              }
            } catch (e) {
              // Ignore and continue
            }
          }

          // If all else fails, try to remove the consent dialog from the DOM
          const dialogSelectors = [
            '[id*="cookie" i]',
            '[class*="cookie" i]',
            '[id*="consent" i]',
            '[class*="consent" i]',
            '[id*="privacy" i]',
            '[class*="privacy" i]',
            '.modal',
            '#modal',
            '.dialog',
            '#dialog',
            '[role="dialog"]',
            '.privacy-dialog',
            '.cookie-banner'
          ];

          for (const selector of dialogSelectors) {
            const dialogs = document.querySelectorAll(selector);
            for (const dialog of dialogs) {
              const text = (dialog.textContent || '').toLowerCase();
              if (text.includes('cookie') || text.includes('privacy') || text.includes('data')) {
                console.log('Found cookie dialog, removing from DOM');
                dialog.remove();
                return true;
              }
            }
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

              const width = iframe.width || iframe.clientWidth || 480;
              const height = iframe.height || iframe.clientHeight || 270;
              const videoId = this.getYouTubeVideoId(iframe.src);

              if (!videoId) {
                console.log('Could not extract video ID from:', iframe.src);
                return;
              }

              console.log('Found YouTube video ID:', videoId);

              const wrapper = document.createElement('div');
              wrapper.style.width = width + 'px';
              wrapper.style.height = height + 'px';
              wrapper.style.position = 'relative';
              wrapper.style.backgroundColor = '#000';
              wrapper.style.overflow = 'hidden';

              const img = document.createElement('img');

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

              img.src = 'https://img.youtube.com/vi/' + videoId + '/maxresdefault.jpg';
              img.alt = 'Video Thumbnail';
              img.style.width = '100%';
              img.style.height = '100%';
              img.style.objectFit = 'cover';
              wrapper.appendChild(img);

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

        // Remove YouTube branding and play buttons
        cleanupYouTubeElements: function() {
          document.querySelectorAll('.ytp-large-play-button, [class*="play-button"], [class*="ytp-"]').forEach(el => {
            if (el && el.parentNode) {
              el.style.display = 'none';
              try {
                el.parentNode.removeChild(el);
              } catch (e) {}
            }
          });

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

          await this.handleCookieConsent();
          await this.triggerLazyLoading();
          await new Promise(r => setTimeout(r, 1000));
          await this.handleCookieConsent();
          this.replaceWithCleanThumbnails();
          await new Promise(r => setTimeout(r, 2500));
          this.cleanupYouTubeElements();
          await this.handleCookieConsent();

          console.log('Enhancement sequence complete');
        }
      };
    `;
  }
}

module.exports = { ScreenshotEnhancer };