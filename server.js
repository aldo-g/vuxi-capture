const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs-extra');

// Load environment variables from root .env file
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const app = express();
const PORT = process.env.PORT || 3001;

// Import services with error handling
let URLDiscoveryService, EnhancedScreenshotService;
try {
  console.log('📦 Loading URL Discovery Service...');
  ({ URLDiscoveryService } = require('./url-discovery'));
  console.log('✅ URL Discovery Service loaded');
  
  console.log('📦 Loading Enhanced Screenshot Service...');
  ({ EnhancedScreenshotService } = require('./screenshot/enhanced-integration'));
  console.log('✅ Enhanced Screenshot Service loaded');
} catch (error) {
  console.error('❌ Failed to load services:', error);
  console.error('Make sure the service files exist and export the correct classes');
  process.exit(1);
}

// Middleware
app.use(cors());
app.use(express.json());

// In-memory job storage (in production, use Redis or database)
const jobs = new Map();

// Job statuses
const JOB_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  URL_DISCOVERY: 'url_discovery',
  SCREENSHOT_CAPTURE: 'screenshot_capture',
  COMPLETED: 'completed',
  FAILED: 'failed'
};

// Helper function to update job status
function updateJobStatus(jobId, status, data = {}) {
  const job = jobs.get(jobId);
  if (job) {
    job.status = status;
    job.updatedAt = new Date().toISOString();
    Object.assign(job, data);
    console.log(`📊 Job ${jobId.slice(0,8)}: ${status} - ${data.progress?.message || ''}`);
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    service: 'vuxi-capture-service',
    version: '2.0.0', // Updated version for enhanced interactive features
    features: {
      interactiveCapture: true,
      multipleScreenshotsPerPage: true,
      systematicInteractionDiscovery: true,
      changeDetection: true,
      elementPrioritization: true
    },
    activeJobs: Array.from(jobs.values()).filter(j => 
      j.status === JOB_STATUS.RUNNING || 
      j.status === JOB_STATUS.URL_DISCOVERY || 
      j.status === JOB_STATUS.SCREENSHOT_CAPTURE
    ).length
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'Vuxi Enhanced Capture Service',
    version: '2.0.0',
    description: 'Advanced web content capture with systematic interactive element discovery',
    features: {
      interactiveCapture: 'Systematically discovers and interacts with tabs, accordions, expandable content',
      multipleScreenshots: 'Takes multiple targeted screenshots per page based on content changes',
      intelligentDiscovery: 'AI-powered element discovery using multiple detection strategies',
      changeDetection: 'Only captures screenshots when content actually changes',
      prioritization: 'Smart prioritization of interactive elements for optimal capture'
    },
    endpoints: {
      health: '/health',
      createJob: 'POST /api/capture',
      getJob: 'GET /api/capture/:jobId',
      listJobs: 'GET /api/jobs'
    },
    enhancedOptions: {
      captureInteractive: 'Enable/disable interactive element capture (default: true)',
      maxInteractions: 'Maximum interactive elements to process per page (default: 30)',
      maxScreenshotsPerPage: 'Maximum screenshots per page (default: 15)',
      interactionDelay: 'Delay between interactions in ms (default: 800)',
      changeDetectionTimeout: 'Time to wait for content changes after interaction (default: 2000ms)'
    }
  });
});

// Create a new capture job
app.post('/api/capture', async (req, res) => {
  try {
    console.log('🚀 Creating new enhanced capture job:', req.body);
    
    const { baseUrl, options = {} } = req.body;
    
    if (!baseUrl) {
      return res.status(400).json({ error: 'baseUrl is required' });
    }

    const jobId = uuidv4();
    const outputDir = path.join(__dirname, 'data', `job_${jobId}`);
    
    console.log(`📁 Job ${jobId.slice(0,8)} output directory: ${outputDir}`);
    
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
        captureInteractive: options.captureInteractive !== false, // Default true
        maxInteractions: options.maxInteractions || 30,
        maxScreenshotsPerPage: options.maxScreenshotsPerPage || 15,
        interactionDelay: options.interactionDelay || 800,
        changeDetectionTimeout: options.changeDetectionTimeout || 2000,
        
        // ADVANCED OPTIONS (optional)
        enableHoverCapture: options.enableHoverCapture || false,
        prioritizeNavigation: options.prioritizeNavigation !== false, // Default true
        skipSocialElements: options.skipSocialElements !== false, // Default true
        maxProcessingTime: options.maxProcessingTime || 120000 // 2 minutes max per page
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
    console.log(`✅ Job ${jobId.slice(0,8)} created for ${baseUrl}`);
    
    // Log enhanced features being used
    if (job.options.captureInteractive) {
      console.log(`🎯 ENHANCED INTERACTIVE CAPTURE ENABLED:`);
      console.log(`   • Max interactions per page: ${job.options.maxInteractions}`);
      console.log(`   • Max screenshots per page: ${job.options.maxScreenshotsPerPage}`);
      console.log(`   • Interaction delay: ${job.options.interactionDelay}ms`);
      console.log(`   • Change detection timeout: ${job.options.changeDetectionTimeout}ms`);
      if (job.options.enableHoverCapture) {
        console.log(`   • Hover capture: ENABLED`);
      }
    } else {
      console.log(`📸 Standard capture mode (1 screenshot per page)`);
    }
    
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
      // Core options
      captureInteractive: job.options.captureInteractive,
      maxInteractions: job.options.maxInteractions,
      maxScreenshotsPerPage: job.options.maxScreenshotsPerPage,
      maxPages: job.options.maxPages,
      concurrency: job.options.concurrency,
      
      // Advanced options
      enableHoverCapture: job.options.enableHoverCapture,
      interactionDelay: job.options.interactionDelay,
      changeDetectionTimeout: job.options.changeDetectionTimeout
    },
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
    enhancedCapture: {
      interactiveEnabled: job.options?.captureInteractive || false,
      maxInteractions: job.options?.maxInteractions || 0,
      maxScreenshots: job.options?.maxScreenshotsPerPage || 0
    }
  }));
  
  res.json(jobList);
});

// Serve static files (screenshots, reports)
app.use('/data', express.static(path.join(__dirname, 'data')));

// Process a job with timeout and better error handling
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
    
    // Phase 1: URL Discovery with timeout
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
    
    console.log(`🔍 URL Discovery options:`, {
      maxPages: job.options.maxPages,
      timeout: job.options.timeout,
      concurrency: job.options.concurrency,
      fastMode: job.options.fastMode
    });
    
    // Add timeout wrapper for URL discovery
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
    
    updateJobStatus(jobId, JOB_STATUS.URL_DISCOVERY, {
      progress: {
        stage: 'url_discovery_complete',
        percentage: 40,
        message: `Found ${urlResult.urls.length} URLs`
      },
      urlDiscovery: {
        urlCount: urlResult.urls.length,
        stats: urlResult.stats
      }
    });
    
    // Phase 2: Enhanced Interactive Screenshot Capture
    console.log(`📸 Starting ENHANCED interactive screenshot capture for ${urlResult.urls.length} URLs`);
    if (job.options.captureInteractive) {
      console.log(`🎯 INTERACTIVE CAPTURE ENABLED - will systematically discover and interact with:`);
      console.log(`   • Tabs and navigation elements`);
      console.log(`   • Expandable content (accordions, "show more" buttons)`);
      console.log(`   • Modal triggers and overlay content`);
      console.log(`   • Dropdown menus and hidden panels`);
      console.log(`   • Interactive media elements`);
    }
    
    updateJobStatus(jobId, JOB_STATUS.SCREENSHOT_CAPTURE, {
      progress: {
        stage: 'screenshot_capture',
        percentage: 45,
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
      enableHoverCapture: job.options.enableHoverCapture,
      prioritizeNavigation: job.options.prioritizeNavigation,
      skipSocialElements: job.options.skipSocialElements,
      maxProcessingTime: job.options.maxProcessingTime
    });
    
    const screenshotResult = await screenshotService.captureAll(urlResult.urls);
    
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
    
    // Job completed successfully with enhanced results
    const results = {
      urls: urlResult.urls,
      screenshots: screenshotResult.successful,
      stats: {
        urlDiscovery: urlResult.stats,
        screenshots: screenshotResult.stats
      },
      files: {
        urls: urlResult.files,
        screenshots: screenshotResult.files
      },
      outputDir: job.options.outputDir,
      
      // Enhanced statistics
      enhancedCapture: {
        interactiveEnabled: job.options.captureInteractive,
        totalScreenshots: screenshotResult.stats?.totalScreenshots || 0,
        averageScreenshotsPerPage: screenshotResult.stats?.averageScreenshotsPerPage || '1.0',
        interactivePagesFound: screenshotResult.stats?.interactivePagesFound || 0,
        interactionSuccessRate: screenshotResult.stats?.interactivePagesFound > 0 ? 
          (screenshotResult.stats.interactivePagesFound / screenshotResult.successful.length * 100).toFixed(1) + '%' : '0%'
      }
    };
    
    const completionMessage = job.options.captureInteractive ? 
      `🎉 ENHANCED ANALYSIS COMPLETE! 
      📸 Captured ${screenshotResult.stats?.totalScreenshots || 0} total screenshots from ${urlResult.urls.length} URLs
      🎯 Found interactive content on ${screenshotResult.stats?.interactivePagesFound || 0} pages
      ⚡ Average ${screenshotResult.stats?.averageScreenshotsPerPage || '1.0'} screenshots per page
      🔍 Successfully discovered and interacted with tabs, expandable content, and hidden elements` :
      `Analysis complete! Captured ${screenshotResult.successful.length} screenshots from ${urlResult.urls.length} URLs`;
    
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
    
  } catch (error) {
    console.error(`❌ Job ${jobId.slice(0,8)} failed:`, error);
    console.error('Error stack:', error.stack);
    updateJobStatus(jobId, JOB_STATUS.FAILED, {
      error: error.message,
      progress: {
        stage: 'failed',
        percentage: 0,
        message: `Job failed: ${error.message}`
      }
    });
    throw error;
  }
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Enhanced Capture Service running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`📝 API docs: http://localhost:${PORT}/api/jobs`);
  console.log(`🏠 Root endpoint: http://localhost:${PORT}/`);
  console.log(`🎯 NEW FEATURES:`);
  console.log(`   • Systematic interactive element discovery`);
  console.log(`   • Multiple screenshots per page`);
  console.log(`   • Smart content change detection`);
  console.log(`   • Prioritized interaction sequences`);
  console.log(`   • Detailed capture analytics`);
});

module.exports = app;