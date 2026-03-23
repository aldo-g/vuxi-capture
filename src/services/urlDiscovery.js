const { chromium } = require('playwright');
const fs = require('fs-extra');
const path = require('path');

const SKIP_PATTERNS = [
  /\.(pdf|docx?|xlsx?|zip|rar|7z|tar|gz)$/i,
  /\.(jpe?g|png|gif|svg|ico)$/i,
  /^mailto:/i,
  /^tel:/i,
  /\?replytocom=/i,
  /\/wp-json\//i,
  /\/(?:login|register|cart|checkout|account)/i
];

function normalizeUrl(url) {
  try {
    const urlObj = new URL(url);
    urlObj.hash = '';

    if (urlObj.hostname.startsWith('www.')) {
      urlObj.hostname = urlObj.hostname.slice(4);
    }

    if (urlObj.pathname.length > 1 && urlObj.pathname.endsWith('/')) {
      urlObj.pathname = urlObj.pathname.slice(0, -1);
    }

    return urlObj.toString();
  } catch {
    return null;
  }
}

function isSameDomain(base, candidate) {
  try {
    const baseHost = new URL(base).hostname.replace(/^www\./, '');
    const candidateHost = new URL(candidate).hostname.replace(/^www\./, '');
    return baseHost === candidateHost;
  } catch {
    return false;
  }
}

function shouldSkip(url) {
  return SKIP_PATTERNS.some(pattern => pattern.test(url));
}

class URLDiscoveryService {
  constructor(options = {}) {
    this.maxPages = options.maxPages ?? 10;
    this.concurrency = options.concurrency ?? 3;
    this.timeout = options.timeout ?? 8000;
    this.outputDir = options.outputDir || path.join(process.cwd(), 'data');
  }

  async discover(baseUrl) {
    const normalizedStart = normalizeUrl(baseUrl);
    if (!normalizedStart) {
      throw new Error('Invalid base URL');
    }

    console.log(`[discovery] scanning ${normalizedStart}`);

    const queue = [normalizedStart];
    const seen = new Set(queue);
    const visited = new Set();
    const discovered = [];
    const stats = {
      pagesCrawled: 0,
      linksCollected: 0,
      startedAt: new Date().toISOString()
    };
    const startTime = Date.now();

    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
      while (queue.length > 0 && discovered.length < this.maxPages) {
        const batch = [];

        while (
          batch.length < this.concurrency &&
          queue.length > 0 &&
          discovered.length + batch.length < this.maxPages
        ) {
          const candidate = queue.shift();
          if (!visited.has(candidate)) {
            batch.push(candidate);
          }
        }

        if (batch.length === 0) {
          break;
        }

        const results = await Promise.all(
          batch.map(url => this.#crawlPage(browser, url, normalizedStart))
        );

        results.forEach((links, index) => {
          const currentUrl = batch[index];
          visited.add(currentUrl);
          discovered.push(currentUrl);
          stats.pagesCrawled += 1;
          stats.linksCollected += links.length;

          links.forEach(link => {
            if (!seen.has(link)) {
              seen.add(link);
              queue.push(link);
            }
          });
        });
      }
    } finally {
      await browser.close();
    }

    stats.durationSeconds = Number(((Date.now() - startTime) / 1000).toFixed(2));
    stats.totalDiscovered = discovered.length;

    await this.#writeOutputs(baseUrl, discovered, stats);
    console.log(`[discovery] found ${discovered.length} url(s)`);

    return {
      success: discovered.length > 0,
      urls: discovered,
      stats,
      files: {
        urls: path.join(this.outputDir, 'urls.json'),
        simple: path.join(this.outputDir, 'urls_simple.json')
      }
    };
  }

  async #crawlPage(browser, url, rootUrl) {
    const page = await browser.newPage();

    try {
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: this.timeout
      });

      await page.waitForTimeout(400);

      const links = await page.$$eval('a[href]', anchors =>
        anchors.map(anchor => anchor.href)
      );

      const validLinks = links
        .map(normalizeUrl)
        .filter(Boolean)
        .filter(link => isSameDomain(rootUrl, link))
        .filter(link => !shouldSkip(link));

      return [...new Set(validLinks)];
    } catch {
      return [];
    } finally {
      await page.close();
    }
  }

  async #writeOutputs(baseUrl, urls, stats) {
    await fs.ensureDir(this.outputDir);

    const urlsPath = path.join(this.outputDir, 'urls.json');
    const simplePath = path.join(this.outputDir, 'urls_simple.json');

    const payload = {
      baseUrl,
      discoveredAt: new Date().toISOString(),
      count: urls.length,
      stats,
      urls
    };

    await fs.writeJson(urlsPath, payload, { spaces: 2 });
    await fs.writeJson(simplePath, urls, { spaces: 2 });
  }
}

module.exports = { URLDiscoveryService, normalizeUrl };
