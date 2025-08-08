const path = require('path');

/**
 * Creates a safe filename from a URL and index
 * @param {string} url - The URL to create a filename from
 * @param {number} index - The index number for the screenshot
 * @returns {string} A safe filename
 */
function createFilename(url, index) {
  try {
    const urlObj = new URL(url);
    
    // Get domain without www
    let domain = urlObj.hostname.replace(/^www\./, '');
    
    // Get pathname without leading/trailing slashes
    let pathname = urlObj.pathname
      .replace(/^\/+|\/+$/g, '') // Remove leading/trailing slashes
      .replace(/\//g, '_')       // Replace slashes with underscores
      .replace(/[^a-zA-Z0-9_-]/g, '') || 'index'; // Remove special chars
    
    // Truncate if too long
    if (pathname.length > 50) {
      pathname = pathname.substring(0, 50);
    }
    
    // Create filename with index prefix
    const filename = `${String(index).padStart(3, '0')}_${domain}_${pathname}.png`;
    
    return filename;
  } catch (error) {
    // Fallback for invalid URLs
    console.warn(`Error parsing URL ${url}:`, error.message);
    return `${String(index).padStart(3, '0')}_invalid_url.png`;
  }
}

/**
 * Sanitizes a string to be safe for filenames
 * @param {string} str - String to sanitize
 * @returns {string} Sanitized string
 */
function sanitizeFilename(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')  // Replace non-alphanumeric chars
    .replace(/_+/g, '_')           // Collapse multiple underscores
    .replace(/^_+|_+$/g, '');      // Remove leading/trailing underscores
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

module.exports = {
  createFilename,
  sanitizeFilename,
  formatDuration,
  isValidUrl,
  extractDomain
};