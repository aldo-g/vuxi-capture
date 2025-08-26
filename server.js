const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs-extra');

// Import enhanced services
const { URLDiscoveryService } = require('./url-discovery');
const { EnhancedScreenshotService } = require('./screenshot/enhanced-integration');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// In-memory job storage (replace with database in production)
const jobs = new Map();

// Job status constants
const JOB_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  URL_DISCOVERY: 'url_discovery',
  URL_REVIEW_PENDING: 'url_review_pending',  // NEW STATUS
  SCREENSHOT_CAPTURE: 'screenshot_capture',
  COMPLETED: 'completed',
  FAILED: 'failed'
};

// Helper function to update job status
function updateJobStatus(jobId, status, updates = {}) {
  const job = jobs.get(jobId);
  if (job) {
    job.status = status;
    job.updatedAt = new Date().toISOString();
    Object.assign(job, updates);
    jobs.set(jobId, job);
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  const activeJobs = Array.from(jobs.values()).filter(j => 
    j.status === JOB_STATUS.RUNNING || 
    j.status === JOB_STATUS.URL_DISCOVERY || 
    j.status === JOB_STATUS.SCREENSHOT_CAPTURE
  ).length;
  
  res.json({
    status: 'healthy',
    service: 'Vuxi Enhanced Capture Service',
    version: '2.1.0',
    timestamp: new Date().toISOString(),
    activeJobs,
    totalJobs: jobs.size,
    runningJobs: Array.from(jobs.values()).filter(j => 
      j.status === JOB_STATUS.URL_DISCOVERY || 
      j.status === JOB_STATUS.SCREENSHOT_CAPTURE
    ).length,
    reviewPendingJobs: Array.from(jobs.values()).filter(j => 
      j.status === JOB_STATUS.URL_REVIEW_PENDING
    ).length
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'Vuxi Enhanced Capture Service',
    version: '2.1.0',
    description: 'Advanced web content capture with URL review and systematic interactive element discovery',
    features: {
      interactiveCapture: 'Systematically discovers and interacts with tabs, accordions, expandable content',
      multipleScreenshots: 'Takes multiple targeted screenshots per page based on content changes',
      intelligentDiscovery: 'AI-powered element discovery using multiple detection strategies',
      changeDetection: 'Only captures screenshots when content actually changes',
      prioritization: 'Smart prioritization of interactive elements for optimal capture',
      urlReview: 'Manual review and editing of discovered URLs before screenshotting' // NEW FEATURE
    },
    endpoints: {
      health: '/health',
      createJob: 'POST /api/capture',
      getJob: 'GET /api/capture/:jobId',
      listJobs: 'GET /api/jobs',
      updateUrls: 'PUT /api/capture/:jobId/urls',  // NEW ENDPOINT
      proceedWithScreenshots: 'POST /api/capture/:jobId/proceed'  // NEW ENDPOINT
    },
    enhancedOptions: {
      captureInteractive: 'Enable/disable interactive element capture (default: true)',
      maxInteractions: 'Maximum interactive elements to process per page (default: 30)',
      maxScreenshotsPerPage: 'Maximum screenshots per page (default: 15)',
      interactionDelay: 'Delay between interactions in ms (default: 800)',
      changeDetectionTimeout: 'Time to wait for content changes after interaction (default: 2000ms)',
      maxInteractionsPerType: 'Maximum interactions per selector type (default: 3)',
      manualReview: 'Enable manual URL review before screenshotting (default: false)'  // NEW OPTION
    }
  });
});

// Create a new capture job
app.post('/api/capture', async (req, res) => {
  try {
    const { baseUrl, options = {} } = req.body;
    
    if (!baseUrl) {
      return res.status(400).json({ error: 'baseUrl is required' });
    }

    const jobId = uuidv4();
    const outputDir = path.join(__dirname, 'data', `job_${jobId}`);
        
    // Create job record with enhanced options
    const job = {
      id: jobId,
      baseUrl,
      options: {
        // EXISTING URL DISCOVERY OPTIONS
        maxPages: options.maxPages || 20,
        timeout: options.timeout || 8000,
        concurrency: options.concurrency || 3,
        fastMode: options.fastMode !== false,
        outputDir,
        
        // ENHANCED INTERACTIVE CAPTURE OPTIONS
        captureInteractive: options.captureInteractive !== false,
        maxInteractions: options.maxInteractions || 30,
        maxScreenshotsPerPage: options.maxScreenshotsPerPage || 15,
        interactionDelay: options.interactionDelay || 800,
        changeDetectionTimeout: options.changeDetectionTimeout || 2000,
        maxInteractionsPerType: options.maxInteractionsPerType || 3,
        
        // ADVANCED OPTIONS (optional)
        enableHoverCapture: options.enableHoverCapture || false,
        prioritizeNavigation: options.prioritizeNavigation !== false,
        skipSocialElements: options.skipSocialElements !== false,
        maxProcessingTime: options.maxProcessingTime || 120000,
        
        // NEW MANUAL REVIEW OPTION
        manualReview: options.manualReview || false
      },
      status: JOB_STATUS.PENDING,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      progress: {
        stage: 'initializing',
        percentage: 0,
        message: 'Job created, waiting to start...'
      }
    };
    
    jobs.set(jobId, job);
    console.log(`✅ Job ${jobId.slice(0,8)} created for ${baseUrl} ${job.options.manualReview ? '(with manual review)' : ''}`);
    
    // Start processing asynchronously with better error handling
    setImmediate(() => {
      processJob(jobId).catch(error => {
        console.error(`❌ Job ${jobId.slice(0,8)} failed:`, error);
        updateJobStatus(jobId, JOB_STATUS.FAILED, {
          error: error.message,
          progress: {
            stage: 'failed',
            percentage: 0,
            message: `Job failed: ${error.message}`
          }
        });
      });
    });
    
    res.json({ jobId, status: job.status });
    
  } catch (error) {
    console.error('Error creating job:', error);
    res.status(500).json({ error: 'Failed to create job' });
  }
});

// REMOVED: Complex API endpoints for URL review
// The manual review now happens interactively in the terminal

// Get job status
app.get('/api/capture/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);
  
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  
  res.json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    baseUrl: job.baseUrl,
    options: {
      captureInteractive: job.options.captureInteractive,
      maxInteractions: job.options.maxInteractions,
      maxScreenshotsPerPage: job.options.maxScreenshotsPerPage,
      maxPages: job.options.maxPages,
      concurrency: job.options.concurrency,
      maxInteractionsPerType: job.options.maxInteractionsPerType,
      enableHoverCapture: job.options.enableHoverCapture,
      interactionDelay: job.options.interactionDelay,
      changeDetectionTimeout: job.options.changeDetectionTimeout,
      manualReview: job.options.manualReview
    },
    // Include URL discovery results if available
    ...(job.urlDiscovery && {
      urlDiscovery: {
        urlCount: job.urlDiscovery.urls?.length || 0,
        urls: job.urlDiscovery.urls || [],
        stats: job.urlDiscovery.stats,
        originalUrlCount: job.urlDiscovery.originalUrlCount,
        reviewedUrlCount: job.urlDiscovery.reviewedUrlCount,
        urlsModified: job.urlDiscovery.urlsModified || false
      }
    }),
    ...(job.status === JOB_STATUS.COMPLETED && {
      results: job.results
    }),
    ...(job.status === JOB_STATUS.FAILED && {
      error: job.error
    })
  });
});

// Get all jobs (for debugging)
app.get('/api/jobs', (req, res) => {
  const jobList = Array.from(jobs.values()).map(job => ({
    id: job.id,
    status: job.status,
    baseUrl: job.baseUrl,
    createdAt: job.createdAt,
    progress: job.progress,
    urlCount: job.urlDiscovery?.urls?.length || 0,
    manualReview: job.options?.manualReview || false,
    enhancedCapture: {
      interactiveEnabled: job.options?.captureInteractive || false,
      maxInteractions: job.options?.maxInteractions || 0,
      maxScreenshots: job.options?.maxScreenshotsPerPage || 0,
      maxInteractionsPerType: job.options?.maxInteractionsPerType || 3
    }
  }));
  
  res.json(jobList);
});

// Serve static files (screenshots, reports)
app.use('/data', express.static(path.join(__dirname, 'data')));

// MODIFIED: Process a job with URL review support
async function processJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) throw new Error('Job not found');
  
  console.log(`🚀 Starting enhanced job processing: ${jobId.slice(0,8)}`);
  
  try {
    updateJobStatus(jobId, JOB_STATUS.RUNNING, {
      progress: {
        stage: 'starting',
        percentage: 5,
        message: 'Starting enhanced analysis...'
      }
    });
    
    await fs.ensureDir(job.options.outputDir);
    console.log(`📁 Created output directory: ${job.options.outputDir}`);
    
    // Phase 1: URL Discovery
    console.log(`🔍 Starting URL discovery for: ${job.baseUrl}`);
    updateJobStatus(jobId, JOB_STATUS.URL_DISCOVERY, {
      progress: {
        stage: 'url_discovery',
        percentage: 10,
        message: 'Discovering URLs...'
      }
    });
    
    const urlService = new URLDiscoveryService({
      ...job.options,
      outputDir: job.options.outputDir
    });
    
    const urlResult = await Promise.race([
      urlService.discover(job.baseUrl),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('URL discovery timeout after 2 minutes')), 120000)
      )
    ]);
    
    console.log(`✅ URL discovery completed:`, {
      success: urlResult.success,
      urlCount: urlResult.urls?.length || 0,
      error: urlResult.error
    });
    
    if (!urlResult.success) {
      throw new Error(`URL discovery failed: ${urlResult.error}`);
    }
    
    if (!urlResult.urls || urlResult.urls.length === 0) {
      throw new Error('No URLs discovered from the website');
    }
    
    // Store URL discovery results
    updateJobStatus(jobId, JOB_STATUS.URL_DISCOVERY, {
      progress: {
        stage: 'url_discovery_complete',
        percentage: 40,
        message: `Found ${urlResult.urls.length} URLs`
      },
      urlDiscovery: {
        urls: urlResult.urls,
        stats: urlResult.stats,
        originalUrlCount: urlResult.urls.length
      }
    });
    
    // Check if manual review is enabled
    if (job.options.manualReview) {
      console.log(`⏸️ Job ${jobId.slice(0,8)}: Manual review enabled, waiting for URL approval`);
      
      // The URLs are already saved to urls_simple.json by the URLDiscoveryService
      const urlsFilePath = path.join(job.options.outputDir, 'urls_simple.json');
      
      console.log(`📝 URLs saved to: ${urlsFilePath}`);
      console.log(`📋 Discovered URLs:`);
      urlResult.urls.forEach((url, i) => {
        console.log(`   ${i + 1}. ${url}`);
      });
      
      // Interactive prompt
      console.log(`\n🔍 Review and edit the URLs in: ${urlsFilePath}`);
      console.log(`⏸️  Press Enter to proceed with screenshotting...`);
      
      // Wait for user input
      await waitForEnter();
      
      // Read the edited URLs from urls_simple.json
      let editedUrls;
      try {
        editedUrls = await fs.readJson(urlsFilePath);
        if (!Array.isArray(editedUrls)) {
          throw new Error('urls_simple.json must contain an array');
        }
        console.log(`✅ Loaded ${editedUrls.length} URLs from edited file`);
        
        if (editedUrls.length !== urlResult.urls.length) {
          console.log(`📝 URLs modified: ${urlResult.urls.length} → ${editedUrls.length}`);
        }
      } catch (error) {
        console.log(`⚠️  Error reading edited URLs: ${error.message}`);
        console.log(`📋 Using original discovered URLs instead`);
        editedUrls = urlResult.urls;
      }
      
      // Update job with edited URLs
      updateJobStatus(jobId, JOB_STATUS.URL_DISCOVERY, {
        progress: {
          stage: 'url_discovery_complete',
          percentage: 40,
          message: `Using ${editedUrls.length} URLs for screenshotting`
        },
        urlDiscovery: {
          urls: editedUrls,
          stats: urlResult.stats,
          originalUrlCount: urlResult.urls.length,
          finalUrlCount: editedUrls.length,
          urlsModified: editedUrls.length !== urlResult.urls.length
        }
      });
      
      // Continue with the edited URLs
      urlResult.urls = editedUrls;
    }
    
    // If no manual review, proceed directly to screenshots
    await proceedWithScreenshots(jobId, urlResult);
    
  } catch (error) {
    console.error(`❌ Job ${jobId.slice(0,8)} failed:`, error);
    throw error;
  }
}

// Helper function to wait for Enter key press
function waitForEnter() {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    
    const onData = (key) => {
      if (key === '\r' || key === '\n' || key === '\u0003') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        console.log(''); // New line after Enter
        resolve();
      }
    };
    
    stdin.on('data', onData);
  });
}

// MODIFIED: Handle screenshot capture phase (simplified)
async function proceedWithScreenshots(jobId, urlResult) {
  const job = jobs.get(jobId);
  if (!job) throw new Error('Job not found');
  
  // Get URLs from urlResult (which may have been edited during review)
  const urlsToCapture = urlResult.urls;
  
  console.log(`📸 Starting screenshot capture for ${urlsToCapture.length} URLs`);
  
  updateJobStatus(jobId, JOB_STATUS.SCREENSHOT_CAPTURE, {
    progress: {
      stage: 'screenshot_capture',
      percentage: 50,
      message: job.options.captureInteractive ?
        'Capturing screenshots with systematic interactive element discovery...' : 
        'Capturing standard screenshots...'
    }
  });
  
  const screenshotService = new EnhancedScreenshotService({
    outputDir: job.options.outputDir,
    concurrent: job.options.concurrency || 4,
    timeout: job.options.timeout || 30000,
    viewport: { width: 1440, height: 900 },
    
    // Enhanced interactive options
    enableInteractiveCapture: job.options.captureInteractive,
    maxInteractions: job.options.maxInteractions,
    maxScreenshotsPerPage: job.options.maxScreenshotsPerPage,
    interactionDelay: job.options.interactionDelay,
    changeDetectionTimeout: job.options.changeDetectionTimeout,
    maxInteractionsPerType: job.options.maxInteractionsPerType,
    enableHoverCapture: job.options.enableHoverCapture,
    prioritizeNavigation: job.options.prioritizeNavigation,
    skipSocialElements: job.options.skipSocialElements,
    maxProcessingTime: job.options.maxProcessingTime
  });
  
  const screenshotResult = await screenshotService.captureAll(urlsToCapture);
  
  console.log(`📸 Enhanced screenshot capture completed:`, {
    success: screenshotResult.success,
    successful: screenshotResult.successful?.length || 0,
    failed: screenshotResult.failed?.length || 0,
    totalScreenshots: screenshotResult.stats?.totalScreenshots || 0,
    interactivePagesFound: screenshotResult.stats?.interactivePagesFound || 0
  });
  
  if (!screenshotResult.success && screenshotResult.successful.length === 0) {
    throw new Error(`Screenshot capture failed: ${screenshotResult.error}`);
  }
  
  // Job completed successfully
  const results = {
    urls: urlsToCapture,
    screenshots: screenshotResult.successful,
    stats: {
      urlDiscovery: job.urlDiscovery.stats,
      screenshots: screenshotResult.stats
    },
    files: {
      urls: urlResult?.files || [],
      screenshots: screenshotResult.files
    },
    outputDir: job.options.outputDir,
    
    enhancedCapture: {
      interactiveEnabled: job.options.captureInteractive,
      totalScreenshots: screenshotResult.stats?.totalScreenshots || 0,
      averageScreenshotsPerPage: screenshotResult.stats?.averageScreenshotsPerPage || '1.0',
      interactivePagesFound: screenshotResult.stats?.interactivePagesFound || 0,
      interactionSuccessRate: screenshotResult.stats?.interactivePagesFound > 0 ? 
        (screenshotResult.stats.interactivePagesFound / screenshotResult.successful.length * 100).toFixed(1) + '%' : '0%'
    },
    
    // URL review information
    urlReview: {
      manualReviewEnabled: job.options.manualReview,
      originalUrlCount: job.urlDiscovery.originalUrlCount,
      finalUrlCount: urlsToCapture.length,
      urlsModified: job.urlDiscovery.urlsModified || false
    }
  };
  
  const completionMessage = job.options.captureInteractive ? 
    `🎉 ENHANCED ANALYSIS COMPLETE! 
    📸 Captured ${screenshotResult.stats?.totalScreenshots || 0} total screenshots from ${urlsToCapture.length} URLs
    🎯 Found interactive content on ${screenshotResult.stats?.interactivePagesFound || 0} pages
    ⚡ Average ${screenshotResult.stats?.averageScreenshotsPerPage || '1.0'} screenshots per page
    🔍 Successfully discovered and interacted with tabs, expandable content, and hidden elements` :
    `Analysis complete! Captured ${screenshotResult.successful.length} screenshots from ${urlsToCapture.length} URLs`;
  
  console.log(`✅ Job ${jobId.slice(0,8)} completed successfully`);
  console.log(`🎯 Interactive pages found: ${screenshotResult.stats?.interactivePagesFound || 0}/${screenshotResult.successful.length}`);
  
  updateJobStatus(jobId, JOB_STATUS.COMPLETED, {
    results,
    progress: {
      stage: 'completed',
      percentage: 100,
      message: completionMessage
    }
  });
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Enhanced Capture Service v2.1.0 running on port ${PORT}`);
  console.log(`📝 New features: Manual URL review before screenshotting`);
});

module.exports = app;