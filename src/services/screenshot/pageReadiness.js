const DEFAULT_MEDIA_TIMEOUT = 5000;
const DEFAULT_SETTLE_TIMEOUT = 8000;
const DEFAULT_STABLE_MILLIS = 600;

async function installPageReadinessHooks(context) {
  await context.addInitScript(() => {
    if (window.__vuxiReadinessInstalled) {
      return;
    }

    window.__vuxiReadinessInstalled = true;
    window.__vuxiPendingRequests = 0;
    window.__vuxiLastMutation = Date.now();
    window.__vuxiFontsReady = true;

    const markActivity = () => {
      window.__vuxiLastMutation = Date.now();
    };

    try {
      const observer = new MutationObserver(markActivity);
      observer.observe(document, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true
      });
    } catch {
      // ignore
    }

    const increment = () => {
      window.__vuxiPendingRequests = (window.__vuxiPendingRequests || 0) + 1;
      markActivity();
    };
    const decrement = () => {
      window.__vuxiPendingRequests = Math.max(
        0,
        (window.__vuxiPendingRequests || 0) - 1
      );
      markActivity();
    };

    if (window.fetch) {
      const originalFetch = window.fetch;
      window.fetch = (...args) => {
        increment();
        return originalFetch(...args).then(
          response => {
            decrement();
            return response;
          },
          error => {
            decrement();
            throw error;
          }
        );
      };
    }

    if (window.XMLHttpRequest && window.XMLHttpRequest.prototype) {
      const originalSend = window.XMLHttpRequest.prototype.send;
      window.XMLHttpRequest.prototype.send = function sendWithTracking(...args) {
        increment();
        try {
          this.addEventListener(
            'loadend',
            () => {
              decrement();
            },
            { once: true }
          );
        } catch {
          decrement();
        }
        return originalSend.apply(this, args);
      };
    }

    if (document.fonts && document.fonts.ready) {
      window.__vuxiFontsReady = document.fonts.status === 'loaded';
      document.fonts.ready
        .then(() => {
          window.__vuxiFontsReady = true;
          markActivity();
        })
        .catch(() => {});
    } else {
      window.__vuxiFontsReady = true;
    }
  });
}

async function waitForImages(page, options = {}) {
  const timeout = options.timeout ?? DEFAULT_MEDIA_TIMEOUT;

  try {
    await page.waitForFunction(
      () => {
        const images = Array.from(document.images || []);
        if (!images.length) {
          return true;
        }

        return images.every(image => {
          if (!image) {
            return true;
          }
          if (!image.complete) {
            return false;
          }
          if (typeof image.naturalWidth === 'number' && image.naturalWidth === 0) {
            return false;
          }
          if (typeof image.naturalHeight === 'number' && image.naturalHeight === 0) {
            return false;
          }
          return true;
        });
      },
      { timeout }
    );
    return true;
  } catch {
    return false;
  }
}

async function waitForPageSettled(page, options = {}) {
  const timeout = options.timeout ?? DEFAULT_SETTLE_TIMEOUT;
  const stableMillis = options.stableMillis ?? DEFAULT_STABLE_MILLIS;

  try {
    await page.waitForFunction(
      ({ stableMillis: stableDuration }) => {
        const now = Date.now();
        const readyState = document.readyState;
        const pending = window.__vuxiPendingRequests || 0;
        const lastMutation = window.__vuxiLastMutation || 0;
        const fontsReady =
          window.__vuxiFontsReady === undefined ? true : window.__vuxiFontsReady;

        return (
          readyState === 'complete' &&
          pending === 0 &&
          now - lastMutation >= stableDuration &&
          fontsReady
        );
      },
      { timeout },
      { stableMillis }
    );
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  waitForImages,
  waitForPageSettled,
  installPageReadinessHooks
};
