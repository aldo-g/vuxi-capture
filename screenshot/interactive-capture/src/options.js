'use strict';

const defaultOptions = {
  // Core interaction limits
  maxInteractions: 30,
  maxScreenshots: 15,
  maxInteractionsPerType: 3,
  
  // Timing controls
  interactionDelay: 800,
  changeDetectionTimeout: 2000,
  elementStabilityWait: 500,
  
  // Enhanced reliability options
  maxRetryAttempts: 2,
  retryDelay: 1000,
  pageRefreshTimeout: 30000,
  
  // Content filtering
  skipSocialElements: true,
  skipExternalLinks: true,
  skipHiddenElements: true,
  
  // Element discovery options
  tabsFirst: true,
  prioritizeVisibleElements: true,
  useEnhancedSelectors: true,
  
  // Screenshot and quality options
  fullPage: true,
  quality: 90,
  enableDeduplication: true,
  screenshotComparison: true,
  
  // Debug and logging
  verbose: true,
  logElementDiscovery: true,
  logInteractionAttempts: true,
  
  // Advanced interaction options
  waitForAnimations: true,
  waitForImages: true,
  forceScreenshots: false,
  
  // Selector strategy preferences
  preferStableSelectors: true,
  useTextBasedSelectors: true,
  generateFallbackSelectors: true,
  
  // Element validation
  validateSelectorsOnDiscovery: true,
  requireUniqueSelectors: false, // Allow non-unique selectors with fallbacks
  skipInvalidElements: true,
  
  // Page state management
  maintainElementIdentifiers: true,
  reapplyIdentifiersAfterRefresh: true,
  captureElementContext: true
};

function buildOptions(userOptions = {}) {
  const options = { ...defaultOptions, ...userOptions };
  
  // Validation and normalization
  if (options.maxInteractions < 1) {
    console.warn('⚠️ maxInteractions must be at least 1, setting to 1');
    options.maxInteractions = 1;
  }
  
  if (options.maxInteractionsPerType < 1) {
    console.warn('⚠️ maxInteractionsPerType must be at least 1, setting to 1');
    options.maxInteractionsPerType = 1;
  }
  
  if (options.maxScreenshots < 1) {
    console.warn('⚠️ maxScreenshots must be at least 1, setting to 1');
    options.maxScreenshots = 1;
  }
  
  // Ensure reasonable timing values
  if (options.interactionDelay < 0) {
    console.warn('⚠️ interactionDelay cannot be negative, setting to 0');
    options.interactionDelay = 0;
  }
  
  if (options.changeDetectionTimeout < 500) {
    console.warn('⚠️ changeDetectionTimeout too low, setting to 500ms');
    options.changeDetectionTimeout = 500;
  }
  
  // Adjust dependent options
  if (options.maxInteractionsPerType > options.maxInteractions) {
    console.warn('⚠️ maxInteractionsPerType cannot exceed maxInteractions, adjusting');
    options.maxInteractionsPerType = Math.min(options.maxInteractionsPerType, options.maxInteractions);
  }
  
  // Ensure retry attempts are reasonable
  if (options.maxRetryAttempts < 0 || options.maxRetryAttempts > 5) {
    console.warn('⚠️ maxRetryAttempts should be between 0-5, adjusting');
    options.maxRetryAttempts = Math.max(0, Math.min(5, options.maxRetryAttempts));
  }
  
  // Log final configuration if verbose
  if (options.verbose) {
    console.log('📋 Enhanced Capture Configuration:');
    console.log(`   📊 Interactions: ${options.maxInteractions} (max ${options.maxInteractionsPerType} per type)`);
    console.log(`   📸 Screenshots: ${options.maxScreenshots}`);
    console.log(`   ⏱️  Timing: ${options.interactionDelay}ms interaction delay, ${options.changeDetectionTimeout}ms change detection`);
    console.log(`   🔄 Retries: ${options.maxRetryAttempts} attempts per element`);
    console.log(`   🎯 Features: ${options.tabsFirst ? 'tabs-first' : 'normal-priority'}, ${options.skipSocialElements ? 'skip-social' : 'include-social'}, ${options.useEnhancedSelectors ? 'enhanced-selectors' : 'basic-selectors'}`);
  }
  
  return options;
}

module.exports = { buildOptions, defaultOptions };