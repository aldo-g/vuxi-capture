/**
 * URL discovery utilities with enhanced diversity filtering
 */

/**
 * Checks if a URL is valid and accessible
 * @param {string} url - URL to validate
 * @returns {boolean} True if valid, false otherwise
 */
function isValidUrl(url) {
  if (!url || typeof url !== 'string') return false;
  
  try {
    const urlObj = new URL(url);
    return ['http:', 'https:'].includes(urlObj.protocol);
  } catch {
    return false;
  }
}

/**
 * Normalizes a URL for consistent comparison
 * @param {string} url - URL to normalize
 * @returns {string} Normalized URL
 */
function normalizeUrl(url) {
  try {
    const urlObj = new URL(url);
    
    // Remove www prefix for consistency
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
 * Creates a deduplication key for URL comparison
 * @param {string} url - URL to create key for
 * @returns {string} Deduplication key
 */
function createDeduplicationKey(url) {
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/').filter(part => part.length > 0);
    
    // Create a key based on domain + path structure
    const domain = urlObj.hostname.replace(/^www\./, '');
    const pathKey = pathParts.join('/');
    
    return `${domain}:${pathKey}`;
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
    /\/(newsletter|subscribe)$/i
  ];
  
  const allPatterns = [...defaultExclusions, ...excludePatterns];
  
  return allPatterns.some(pattern => pattern.test(url));
}

/**
 * Gets the depth of a URL path
 * @param {string} url - URL to analyze
 * @returns {number} Path depth
 */
function getUrlDepth(url) {
  try {
    const pathParts = new URL(url).pathname.split('/').filter(part => part.length > 0);
    return pathParts.length;
  } catch {
    return 0;
  }
}

/**
 * Performs hierarchical sampling of URLs
 * @param {string[]} urls - Array of URLs
 * @param {number} maxUrls - Maximum URLs to return
 * @returns {string[]} Sampled URLs
 */
function hierarchicalSampling(urls, maxUrls) {
  if (urls.length <= maxUrls) return urls;
  
  // Group URLs by depth
  const depthGroups = {};
  urls.forEach(url => {
    const depth = getUrlDepth(url);
    if (!depthGroups[depth]) depthGroups[depth] = [];
    depthGroups[depth].push(url);
  });
  
  const result = [];
  const depths = Object.keys(depthGroups).map(Number).sort((a, b) => a - b);
  
  // Distribute quota across depths, favoring shallower depths
  let remaining = maxUrls;
  for (const depth of depths) {
    if (remaining <= 0) break;
    
    const groupUrls = depthGroups[depth];
    const quota = Math.min(remaining, Math.ceil(remaining / (depths.length - depths.indexOf(depth))));
    
    // Take first 'quota' URLs from this depth
    result.push(...groupUrls.slice(0, quota));
    remaining -= quota;
  }
  
  return result.slice(0, maxUrls);
}

/**
 * Simple aggressive filtering to reduce similar URLs
 * @param {string[]} urls - URLs to filter
 * @param {number} maxUrls - Maximum URLs to keep
 * @returns {string[]} Filtered URLs
 */
function simpleAggressiveFilter(urls, maxUrls) {
  if (urls.length <= maxUrls) return urls;
  
  const result = [];
  const seenPatterns = new Set();
  
  // Sort by URL simplicity (shorter = more general)
  const sorted = urls.sort((a, b) => a.length - b.length);
  
  for (const url of sorted) {
    if (result.length >= maxUrls) break;
    
    try {
      const pathParts = new URL(url).pathname.split('/').filter(p => p);
      
      // Create pattern from first 2 path segments
      const pattern = pathParts.slice(0, 2).join('/');
      
      if (!seenPatterns.has(pattern) || seenPatterns.size < maxUrls * 0.7) {
        result.push(url);
        seenPatterns.add(pattern);
      }
    } catch {
      if (result.length < maxUrls) result.push(url);
    }
  }
  
  return result;
}

/**
 * Limits URLs per category pattern
 * @param {string[]} urls - URLs to process
 * @param {number} limitPerCategory - Max URLs per category
 * @returns {string[]} Limited URLs
 */
function limitUrlsPerCategory(urls, limitPerCategory = 3) {
  const categories = new Map();
  
  for (const url of urls) {
    try {
      const pathParts = new URL(url).pathname.split('/').filter(p => p);
      const category = pathParts[0] || 'root';
      
      if (!categories.has(category)) {
        categories.set(category, []);
      }
      
      const categoryUrls = categories.get(category);
      if (categoryUrls.length < limitPerCategory) {
        categoryUrls.push(url);
      }
    } catch {
      // If URL parsing fails, still include it
      const category = 'unknown';
      if (!categories.has(category)) {
        categories.set(category, []);
      }
      
      const categoryUrls = categories.get(category);
      if (categoryUrls.length < limitPerCategory) {
        categoryUrls.push(url);
      }
    }
  }
  
  return Array.from(categories.values()).flat();
}

/**
 * Extracts domain from URL
 * @param {string} url - URL to extract domain from
 * @returns {string} Domain name
 */
function extractDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

/**
 * Formats duration in human readable format
 * @param {number} seconds - Duration in seconds
 * @returns {string} Formatted duration
 */
function formatDuration(seconds) {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds.toFixed(1)}s`;
}

/**
 * Advanced deduplication of URLs
 * @param {string[]} urls - URLs to deduplicate
 * @returns {string[]} Deduplicated URLs
 */
function deduplicateUrls(urls) {
  const seen = new Set();
  const result = [];
  
  for (const url of urls) {
    const normalized = normalizeUrl(url);
    const key = createDeduplicationKey(normalized);
    
    if (!seen.has(key)) {
      seen.add(key);
      result.push(normalized);
    }
  }
  
  return result;
}

/**
 * Analyzes URL patterns and limits similar content
 * @param {string[]} urls - Array of URLs to filter
 * @param {Object} options - Filtering options
 * @returns {string[]} Filtered array of more diverse URLs
 */
function enhanceUrlDiversity(urls, options = {}) {
  const {
    maxPerCategory = 2,           // Max URLs per category (e.g., max 2 from /industries/*)
    maxDepthVariations = 3,       // Max variations at same depth level
    prioritizeHigherLevels = true, // Prefer /industries over /industries/sustainable-*
    excludeSimilarPatterns = true  // Remove very similar URL patterns
  } = options;

  // Group URLs by pattern categories
  const categories = new Map();
  const rootUrls = [];
  
  urls.forEach(url => {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/').filter(part => part.length > 0);
    
    // Handle root/homepage separately
    if (pathParts.length === 0) {
      rootUrls.push(url);
      return;
    }
    
    // Create category key based on path structure
    const categoryKey = pathParts.length > 1 ? pathParts[0] : 'single-level';
    const subcategoryKey = pathParts.length > 1 ? `${pathParts[0]}/${pathParts[1]}` : pathParts[0];
    
    if (!categories.has(categoryKey)) {
      categories.set(categoryKey, new Map());
    }
    
    if (!categories.get(categoryKey).has('items')) {
      categories.get(categoryKey).set('items', []);
    }
    
    categories.get(categoryKey).get('items').push({
      url,
      pathParts,
      depth: pathParts.length,
      subcategory: subcategoryKey
    });
  });

  const diverseUrls = [...rootUrls]; // Always include homepage
  
  // Process each category
  categories.forEach((subcategories, categoryName) => {
    const items = subcategories.get('items') || [];
    
    if (items.length === 0) return;
    
    // Sort by priority: shorter paths first (more general pages)
    items.sort((a, b) => {
      if (prioritizeHigherLevels && a.depth !== b.depth) {
        return a.depth - b.depth;
      }
      // Then by URL length (simpler URLs first)
      return a.url.length - b.url.length;
    });
    
    // Group by subcategory to ensure diversity
    const subcategoryGroups = new Map();
    items.forEach(item => {
      const key = item.depth === 1 ? 'root-level' : item.subcategory;
      if (!subcategoryGroups.has(key)) {
        subcategoryGroups.set(key, []);
      }
      subcategoryGroups.get(key).push(item);
    });
    
    // Select diverse URLs from this category
    const categoryUrls = [];
    let totalSelected = 0;
    
    // First, add one from each subcategory
    subcategoryGroups.forEach((subItems, subKey) => {
      if (totalSelected < maxPerCategory && subItems.length > 0) {
        categoryUrls.push(subItems[0].url);
        totalSelected++;
      }
    });
    
    // If we still have slots, fill from subcategories with multiple items
    if (totalSelected < maxPerCategory) {
      subcategoryGroups.forEach((subItems, subKey) => {
        for (let i = 1; i < subItems.length && totalSelected < maxPerCategory; i++) {
          categoryUrls.push(subItems[i].url);
          totalSelected++;
        }
      });
    }
    
    diverseUrls.push(...categoryUrls.slice(0, maxPerCategory));
  });
  
  return diverseUrls;
}

/**
 * Advanced pattern-based URL filtering
 * @param {string[]} urls - URLs to filter
 * @returns {string[]} Filtered URLs with better diversity
 */
function intelligentUrlFilter(urls) {
  const patterns = {
    // Define patterns and their limits
    blog: { pattern: /\/(blog|news|articles)\//, limit: 3 },
    products: { pattern: /\/(products?|services?)\//, limit: 4 },
    cases: { pattern: /\/(case-studies?|customer-cases?)\//, limit: 2 },
    industries: { pattern: /\/industries\//, limit: 2 },
    solutions: { pattern: /\/solutions\//, limit: 3 },
    about: { pattern: /\/(about|company|team)\//, limit: 2 },
    resources: { pattern: /\/(resources?|downloads?)\//, limit: 2 }
  };
  
  const categorized = { uncategorized: [] };
  
  // Categorize URLs
  urls.forEach(url => {
    let categorized_flag = false;
    
    for (const [category, config] of Object.entries(patterns)) {
      if (config.pattern.test(url)) {
        if (!categorized[category]) {
          categorized[category] = [];
        }
        categorized[category].push(url);
        categorized_flag = true;
        break;
      }
    }
    
    if (!categorized_flag) {
      categorized.uncategorized.push(url);
    }
  });
  
  const result = [];
  
  // Apply limits to each category
  Object.entries(categorized).forEach(([category, categoryUrls]) => {
    if (category === 'uncategorized') {
      // Add all uncategorized URLs (likely unique pages)
      result.push(...categoryUrls);
    } else {
      const limit = patterns[category]?.limit || 2;
      // Sort by URL simplicity (shorter is often more important)
      const sorted = categoryUrls.sort((a, b) => a.length - b.length);
      result.push(...sorted.slice(0, limit));
    }
  });
  
  return result;
}

/**
 * Remove URLs that are too similar to each other
 * @param {string[]} urls - URLs to deduplicate
 * @param {number} similarityThreshold - Similarity threshold (0-1)
 * @returns {string[]} URLs with similar ones removed
 */
function removeSimilarUrls(urls, similarityThreshold = 0.8) {
  const result = [];
  
  for (const url of urls) {
    let isSimilar = false;
    
    for (const existing of result) {
      if (calculateUrlSimilarity(url, existing) > similarityThreshold) {
        isSimilar = true;
        break;
      }
    }
    
    if (!isSimilar) {
      result.push(url);
    }
  }
  
  return result;
}

/**
 * Calculate similarity between two URLs
 * @param {string} url1 - First URL
 * @param {string} url2 - Second URL
 * @returns {number} Similarity score (0-1)
 */
function calculateUrlSimilarity(url1, url2) {
  try {
    const path1 = new URL(url1).pathname.split('/').filter(p => p);
    const path2 = new URL(url2).pathname.split('/').filter(p => p);
    
    // If they have different number of path segments, less similar
    const lengthDiff = Math.abs(path1.length - path2.length);
    const maxLength = Math.max(path1.length, path2.length);
    
    if (maxLength === 0) return 1; // Both are root paths
    
    let matchingSegments = 0;
    const minLength = Math.min(path1.length, path2.length);
    
    for (let i = 0; i < minLength; i++) {
      if (path1[i] === path2[i]) {
        matchingSegments++;
      } else {
        break; // Stop at first difference in path hierarchy
      }
    }
    
    // Calculate similarity based on matching segments and length difference
    const similarity = (matchingSegments / maxLength) - (lengthDiff / maxLength * 0.3);
    return Math.max(0, similarity);
  } catch {
    return 0;
  }
}

/**
 * Main function to apply all diversity enhancements
 * @param {string[]} urls - Original URL list
 * @param {Object} options - Configuration options
 * @returns {string[]} Filtered diverse URL list
 */
function applyUrlDiversityFilters(urls, options = {}) {
  console.log(`🔍 Applying diversity filters to ${urls.length} URLs...`);
  
  // Step 1: Remove obviously similar URLs
  let filtered = removeSimilarUrls(urls, options.similarityThreshold || 0.7);
  console.log(`   After similarity filter: ${filtered.length} URLs`);
  
  // Step 2: Apply intelligent pattern-based filtering
  filtered = intelligentUrlFilter(filtered);
  console.log(`   After pattern filter: ${filtered.length} URLs`);
  
  // Step 3: Apply category-based diversity enhancement
  filtered = enhanceUrlDiversity(filtered, {
    maxPerCategory: options.maxPerCategory || 2,
    prioritizeHigherLevels: options.prioritizeHigherLevels !== false
  });
  console.log(`   After diversity enhancement: ${filtered.length} URLs`);
  
  return filtered;
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
  deduplicateUrls,
  enhanceUrlDiversity,
  intelligentUrlFilter,
  removeSimilarUrls,
  calculateUrlSimilarity,
  applyUrlDiversityFilters
};