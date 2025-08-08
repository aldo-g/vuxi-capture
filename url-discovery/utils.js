/**
 * Validates if a URL is properly formatted
 * @param {string} url - URL to validate
 * @returns {boolean} True if valid, false otherwise
 */
function isValidUrl(url) {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalizes a URL for deduplication purposes
 * @param {string} url - URL to normalize
 * @param {boolean} removeQueryParams - Whether to remove query parameters
 * @returns {string} Normalized URL
 */
function normalizeUrl(url, removeQueryParams = false) {
  try {
    const urlObj = new URL(url);
    
    // Remove www. prefix for consistency
    if (urlObj.hostname.startsWith('www.')) {
      urlObj.hostname = urlObj.hostname.substring(4);
    }
    
    // Remove fragment
    urlObj.hash = '';
    
    if (removeQueryParams) {
      // Remove all query parameters for deduplication
      urlObj.search = '';
    } else {
      // Keep query parameters but sort them
      const params = new URLSearchParams(urlObj.search);
      params.sort();
      urlObj.search = params.toString();
    }
    
    // Remove trailing slash from pathname (unless it's just '/')
    if (urlObj.pathname !== '/' && urlObj.pathname.endsWith('/')) {
      urlObj.pathname = urlObj.pathname.slice(0, -1);
    }
    
    return urlObj.toString();
  } catch {
    return url;
  }
}

/**
 * Creates a simplified URL for deduplication
 * @param {string} url - URL to simplify
 * @returns {string} Simplified URL without language/irrelevant query params
 */
function createDeduplicationKey(url) {
  try {
    const urlObj = new URL(url);
    
    // Remove www. prefix for consistency
    if (urlObj.hostname.startsWith('www.')) {
      urlObj.hostname = urlObj.hostname.substring(4);
    }
    
    // Remove fragment
    urlObj.hash = '';
    
    // Remove common query parameters that don't change content
    const paramsToRemove = [
      'hsLang',           // Hubspot language
      'utm_source',       // UTM tracking
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'fbclid',          // Facebook tracking
      'gclid',           // Google tracking
      '_ga',             // Google Analytics
      '__cf_chl_captcha_tk__', // Cloudflare
      'replytocom',      // WordPress comments
      'lang',            // Language parameters
      'language',
      'locale'
    ];
    
    const params = new URLSearchParams(urlObj.search);
    paramsToRemove.forEach(param => params.delete(param));
    
    // Only keep params that actually change content (e.g., paginated results, search queries)
    const contentChangingParams = ['page', 'search', 'q', 'query', 'category', 'tag'];
    const newParams = new URLSearchParams();
    
    for (const [key, value] of params) {
      if (contentChangingParams.some(allowedParam => key.toLowerCase().includes(allowedParam))) {
        newParams.set(key, value);
      }
    }
    
    urlObj.search = newParams.toString();
    
    // Remove trailing slash
    if (urlObj.pathname !== '/' && urlObj.pathname.endsWith('/') && urlObj.pathname.length > 1) {
      urlObj.pathname = urlObj.pathname.slice(0, -1);
    }
    
    return urlObj.toString();
  } catch {
    return url;
  }
}

/**
 * Checks if two URLs are from the same domain
 * @param {string} url1 - First URL
 * @param {string} url2 - Second URL
 * @returns {boolean} True if same domain, false otherwise
 */
function isSameDomain(url1, url2) {
  try {
    const domain1 = new URL(url1).hostname;
    const domain2 = new URL(url2).hostname;
    
    // Remove 'www.' for comparison
    const cleanDomain1 = domain1.replace(/^www\./, '');
    const cleanDomain2 = domain2.replace(/^www\./, '');
    
    return cleanDomain1 === cleanDomain2;
  } catch {
    return false;
  }
}

/**
 * Checks if a URL should be excluded based on patterns
 * @param {string} url - URL to check
 * @param {RegExp[]} excludePatterns - Array of regex patterns
 * @returns {boolean} True if URL should be excluded
 */
function shouldExcludeUrl(url, excludePatterns = []) {
  // Enhanced exclusions for reducing similar content - but keep important pages
  const defaultExclusions = [
    // File types
    /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|zip|rar|7z|tar|gz)$/i,
    /\.(jpg|jpeg|png|gif|svg|ico)$/i,
    /\.(mp3|mp4|avi|mov|wmv|flv|webm)$/i,
    
    // Protocol exclusions
    /^mailto:/i,
    /^tel:/i,
    /^javascript:/i,
    /\/#/,
    
    // WordPress/CMS specific
    /\/wp-json\//i,
    /\/feed\//i,
    /\?replytocom=/i,
    
    // Pagination beyond page 1
    /\/page\/[2-9]$/i,
    /\/page\/[1-9][0-9]+$/i,
    /\?page=[2-9]$/i,
    /\?page=[1-9][0-9]+$/i,
    
    // Author pages
    /\/author\//i,
    /\/users\//i,
    
    // Date-specific URLs
    /\/\d{2}-\d{2}-\d{2}-\d{2}$/i,
    /\/\d{4}-\d{2}-\d{2}/i,
    
    // Malformed URLs
    /%22%22$/i,
    /\/""$/i,
    
    // Admin/system pages
    /\/admin/i,
    /\/login/i,
    /\/register/i,
    /\/cart/i,
    /\/checkout/i,
    /\/account/i,
    
    // Search and filter URLs
    /\/search\?/i,
    /\?filter=/i,
    /\?sort=/i,
    
    // Print/mobile versions
    /\/print\//i,
    /\/mobile\//i,
    /\?print=/i,
    
    // Language duplicates
    /\/en-us\//i,
    /\/en-gb\//i,
    /\/fr\//i,
    /\/de\//i,
    /\/es\//i,
    /\/it\//i,
    /\?lang=/i,
    
    // Legal/footer pages (but keep contact pages!)
    /\/(legal|privacy|cookies|terms|disclaimer|gdpr)$/i,
    
    // Newsletter/subscribe forms (but keep contact pages!)
    /\/(newsletter|subscribe)$/i,
  ];
  
  // Check against default exclusions
  for (const pattern of defaultExclusions) {
    if (pattern.test(url)) {
      return true;
    }
  }
  
  // Check against custom exclusions
  for (const pattern of excludePatterns) {
    if (pattern.test(url)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Gets the depth of a URL path
 * @param {string} url - URL to analyze
 * @returns {number} Path depth
 */
function getUrlDepth(url) {
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/').filter(part => part.length > 0);
    return pathParts.length;
  } catch {
    return 0;
  }
}

/**
 * General URL filtering - intelligently reduces URLs to specified limit
 * @param {string[]} urls - Array of URLs
 * @param {Object} options - Filtering options
 * @returns {string[]} Filtered URL list
 */
function simpleAggressiveFilter(urls, options = {}) {
  const {
    maxUrlsTotal = 10
  } = options;
  
  console.log(`🔥 Applying general URL filter (target: ${maxUrlsTotal} URLs)...`);
  
  if (urls.length <= maxUrlsTotal) {
    console.log(`📊 No filtering needed - ${urls.length} URLs ≤ ${maxUrlsTotal} limit`);
    return urls;
  }
  
  // Score URLs by importance
  const scoredUrls = urls.map(url => {
    let score = 0;
    
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/').filter(part => part.length > 0);
      const depth = pathParts.length;
      const path = urlObj.pathname.toLowerCase();
      
      // Homepage gets highest priority
      if (depth === 0) {
        score += 100;
      }
      
      // Important pages get high priority
      if (path.includes('about') || path.includes('contact') || path.includes('service') || 
          path.includes('product') || path.includes('training') || path.includes('research') ||
          path.includes('project')) {
        score += 50;
      }
      
      // Overview/category pages (1-2 levels deep) get medium-high priority
      if (depth >= 1 && depth <= 2) {
        score += 30;
      }
      
      // Shorter paths are generally more important
      score += Math.max(0, 10 - depth);
      
      // Shorter URLs are often more general/important
      score += Math.max(0, 10 - Math.floor(url.length / 20));
      
      // Penalize very deep or complex URLs
      if (depth > 4) {
        score -= 20;
      }
      
      // Penalize URLs with many query parameters
      const paramCount = urlObj.searchParams.size;
      if (paramCount > 2) {
        score -= paramCount * 5;
      }
      
    } catch (error) {
      // If URL parsing fails, give it a neutral score
      score = 25;
    }
    
    return { url, score };
  });
  
  // Sort by score (highest first) and take the top URLs
  const sortedUrls = scoredUrls
    .sort((a, b) => b.score - a.score)
    .slice(0, maxUrlsTotal)
    .map(item => item.url);
  
  console.log(`📉 URLs filtered from ${urls.length} to ${sortedUrls.length}`);
  console.log(`   Kept highest-scoring URLs based on importance and depth`);
  
  return sortedUrls;
}

/**
 * Prioritizes URLs using hierarchical sampling
 * @param {string[]} urls - Array of URLs
 * @param {Object} options - Sampling options
 * @returns {string[]} Prioritized and sampled URLs
 */
function hierarchicalSampling(urls, options = {}) {
  const {
    maxDepth = 3,           // Maximum path depth to include
    samplesPerCategory = 2, // Max individual items per category
    prioritizeOverviews = true, // Prefer category pages over individual items
    skipLegalPages = true   // Skip legal/footer pages
  } = options;
  
  const categorized = new Map();
  const overview = [];
  const individual = [];
  
  // Categorize URLs
  for (const url of urls) {
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/').filter(part => part.length > 0);
      const depth = pathParts.length;
      
      // Skip very deep URLs
      if (depth > maxDepth) continue;
      
      // Skip legal pages if enabled (but keep contact pages)
      if (skipLegalPages && /\/(legal|privacy|cookies|terms|disclaimer|newsletter|subscribe)$/i.test(url)) {
        continue;
      }
      
      // Root page
      if (depth === 0) {
        overview.push(url);
        continue;
      }
      
      // Category overview pages (1-2 levels deep)
      if (depth <= 2) {
        overview.push(url);
        continue;
      }
      
      // Individual content pages (3+ levels deep)
      const category = pathParts.slice(0, 2).join('/'); // First 2 path segments
      if (!categorized.has(category)) {
        categorized.set(category, []);
      }
      categorized.get(category).push(url);
      
    } catch (error) {
      // If URL parsing fails, include it in overview
      overview.push(url);
    }
  }
  
  // Sample from individual content
  for (const [category, categoryUrls] of categorized) {
    // Sort by URL length (shorter URLs often have more general content)
    const sorted = categoryUrls.sort((a, b) => a.length - b.length);
    individual.push(...sorted.slice(0, samplesPerCategory));
  }
  
  // Combine results, prioritizing overview pages
  return prioritizeOverviews ? [...overview, ...individual] : [...individual, ...overview];
}

/**
 * Groups URLs by category and limits the number per category
 * @param {string[]} urls - Array of URLs
 * @param {number} maxPerCategory - Maximum URLs per category
 * @returns {string[]} Filtered array
 */
function limitUrlsPerCategory(urls, maxPerCategory = 5) {
  const categories = new Map();
  
  for (const url of urls) {
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/').filter(part => part.length > 0);
      
      // Use the first path segment as category (e.g., /articles, /customer-cases)
      const category = pathParts[0] || 'root';
      
      if (!categories.has(category)) {
        categories.set(category, []);
      }
      
      const categoryUrls = categories.get(category);
      if (categoryUrls.length < maxPerCategory) {
        categoryUrls.push(url);
      }
    } catch (error) {
      // If URL parsing fails, include it anyway
      continue;
    }
  }
  
  // Flatten all category arrays
  const result = [];
  for (const categoryUrls of categories.values()) {
    result.push(...categoryUrls);
  }
  
  return result;
}

/**
 * Extracts the domain from a URL
 * @param {string} url - URL to extract domain from
 * @returns {string|null} Domain name or null if invalid
 */
function extractDomain(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * Formats a duration in milliseconds to a human-readable string
 * @param {number} milliseconds - Duration in milliseconds
 * @returns {string} Formatted duration string
 */
function formatDuration(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${remainingSeconds}s`;
}

/**
 * Deduplicates an array of URLs, preferring simpler versions
 * @param {string[]} urls - Array of URLs
 * @returns {string[]} Deduplicated array
 */
function deduplicateUrls(urls) {
  const urlMap = new Map();
  
  // Group URLs by their deduplicated key
  for (const url of urls) {
    const key = createDeduplicationKey(url);
    
    if (!urlMap.has(key)) {
      urlMap.set(key, []);
    }
    urlMap.get(key).push(url);
  }
  
  // For each group, prefer the non-www version if available, otherwise the simplest
  const result = [];
  for (const [key, similarUrls] of urlMap) {
    // Sort by preference: 
    // 1. Non-www URLs first
    // 2. Fewer query parameters
    // 3. Shorter path length
    const sorted = similarUrls.sort((a, b) => {
      const aHasWww = new URL(a).hostname.startsWith('www.');
      const bHasWww = new URL(b).hostname.startsWith('www.');
      
      // Prefer non-www
      if (aHasWww && !bHasWww) return 1;
      if (!aHasWww && bHasWww) return -1;
      
      // If both have same www status, prefer fewer query params
      const paramsA = new URL(a).searchParams.size;
      const paramsB = new URL(b).searchParams.size;
      if (paramsA !== paramsB) return paramsA - paramsB;
      
      // If same query params, prefer shorter path
      const pathA = new URL(a).pathname.length;
      const pathB = new URL(b).pathname.length;
      return pathA - pathB;
    });
    
    // Take the preferred URL
    result.push(sorted[0]);
  }
  
  return result;
}

module.exports = {
  isValidUrl,
  normalizeUrl,
  createDeduplicationKey,
  isSameDomain,
  shouldExcludeUrl,
  getUrlDepth,
  hierarchicalSampling,
  simpleAggressiveFilter,
  limitUrlsPerCategory,
  extractDomain,
  formatDuration,
  deduplicateUrls
};