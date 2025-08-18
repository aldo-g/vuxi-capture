function buildOptions(user = {}) {
  return {
    // Core
    maxInteractions: user.maxInteractions ?? 50,
    maxScreenshots: user.maxScreenshots ?? 20,
    interactionDelay: user.interactionDelay ?? 800,
    changeDetectionTimeout: user.changeDetectionTimeout ?? 2000,
    scrollPauseTime: user.scrollPauseTime ?? 500,
    enableHoverCapture: user.enableHoverCapture ?? false,
    prioritizeNavigation: user.prioritizeNavigation !== false,
    skipSocialElements: user.skipSocialElements !== false,
    maxProcessingTime: user.maxProcessingTime ?? 120000,
    maxInteractionsPerType: user.maxInteractionsPerType ?? 3, // New option

    // Tabs/sections
    tabPostClickWait: user.tabPostClickWait ?? 1600,
    tabsFirst: user.tabsFirst !== false,
    forceScreenshotOnTabs: user.forceScreenshotOnTabs !== false,
    tabSectionAutoScroll: user.tabSectionAutoScroll !== false,
    tabSectionMinHeight: user.tabSectionMinHeight ?? 240,

    // Dedupe
    dedupeSimilarityThreshold: user.dedupeSimilarityThreshold ?? 99,

    // Overlay/unfinished content guardrails
    avoidOverlayScreenshots: user.avoidOverlayScreenshots !== false,
    overlayCoverageThreshold: user.overlayCoverageThreshold ?? 0.35,

    // Region capture sizing
    regionMinHeight: user.regionMinHeight ?? 420,
    regionMaxHeight: user.regionMaxHeight ?? 1400,
    regionPadding: user.regionPadding ?? 16,
  };
}

module.exports = { buildOptions };