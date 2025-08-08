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
  ({ EnhancedScreenshotService } = require('./screenshot'));
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
    version: '1.1.0', // Updated version for enhanced features
    features: {
      interactiveCapture: true,
      multipleScreenshotsPerPage: true
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
    service: 'Vuxi Capture Service',
    version: '1.1.0',
    features: {
      interactiveCapture: 'Captures tabs, expandable content, modals, and dropdowns',
      multipleScreenshots: 'Takes multiple screenshots per page for interactive elements'
    },
    endpoints: {
      health: '/health',
      createJob: 'POST /api/capture',
      getJob: 'GET /api/capture/:jobId',
      listJobs: 'GET /api/jobs'
    },
    newOptions: {
      captureInteractive: 'Enable/disable interactive element capture (default: true)',
      maxScreenshotsPerPage: 'Maximum screenshots per page (default: 5)',
      interactionDelay: 'Delay between interactions in ms (default: 1000)'
    }
  });
});

// Create a new capture job
app.post('/api/capture', async (req, res) => {
  try {
    console.log('🚀 Creating new capture job:', req.body);
    
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
        maxPages: options.maxPages || 20,
        timeout: options.timeout || 8000,
        concurrency: options.concurrency || 3,
        fastMode: options.fastMode !== false,
        outputDir,
        // New enhanced screenshot options
        captureInteractive: options.captureInteractive !== false, // Default true
        maxScreenshotsPerPage: options.maxScreenshotsPerPage || 5,
        interactionDelay: options.interactionDelay || 1000
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
      console.log(`🎯 Interactive capture ENABLED (max ${job.options.maxScreenshotsPerPage} screenshots per page)`);
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
      captureInteractive: job.options.captureInteractive,
      maxScreenshotsPerPage: job.options.maxScreenshotsPerPage,
      maxPages: job.options.maxPages,
      concurrency: job.options.concurrency
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
    interactiveCapture: job.options?.captureInteractive || false
  }));
  
  res.json(jobList);
});

// Serve static files (screenshots, reports)
app.use('/data', express.static(path.join(__dirname, 'data')));

// Process a job with timeout and better error handling
async function processJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) throw new Error('Job not found');
  
  console.log(`🚀 Starting job processing: ${jobId.slice(0,8)}`);
  
  try {
    updateJobStatus(jobId, JOB_STATUS.RUNNING, {
      progress: {
        stage: 'starting',
        percentage: 5,
        message: 'Starting analysis...'
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
    
    // Phase 2: Enhanced Screenshot Capture
    console.log(`📸 Starting enhanced screenshot capture for ${urlResult.urls.length} URLs`);
    if (job.options.captureInteractive) {
      console.log(`🎯 Interactive capture enabled - will capture tabs, expandable content, and modals`);
    }
    
    updateJobStatus(jobId, JOB_STATUS.SCREENSHOT_CAPTURE, {
      progress: {
        stage: 'screenshot_capture',
        percentage: 45,
        message: job.options.captureInteractive ? 
          'Capturing screenshots with interactive elements...' : 
          'Capturing screenshots...'
      }
    });
    
    const screenshotService = new EnhancedScreenshotService({
      outputDir: job.options.outputDir,
      concurrent: job.options.concurrency || 4,
      timeout: job.options.timeout || 30000,
      viewport: { width: 1440, height: 900 },
      // Enhanced options
      captureInteractive: job.options.captureInteractive,
      maxScreenshotsPerPage: job.options.maxScreenshotsPerPage,
      interactionDelay: job.options.interactionDelay
    });
    
    const screenshotResult = await screenshotService.captureAll(urlResult.urls);
    
    console.log(`📸 Screenshot capture completed:`, {
      success: screenshotResult.success,
      successful: screenshotResult.successful?.length || 0,
      failed: screenshotResult.failed?.length || 0,
      totalScreenshots: screenshotResult.stats?.totalScreenshots || 0
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
        averageScreenshotsPerPage: screenshotResult.stats?.totalScreenshots ? 
          (screenshotResult.stats.totalScreenshots / screenshotResult.successful.length).toFixed(1) : '1.0'
      }
    };
    
    const completionMessage = job.options.captureInteractive ? 
      `Enhanced analysis complete! Captured ${screenshotResult.stats?.totalScreenshots || 0} total screenshots (including interactive elements) from ${urlResult.urls.length} URLs` :
      `Analysis complete! Captured ${screenshotResult.successful.length} screenshots from ${urlResult.urls.length} URLs`;
    
    console.log(`✅ Job ${jobId.slice(0,8)} completed successfully`);
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
  console.log(`🎯 New features: Interactive capture, multiple screenshots per page`);
});

module.exports = app;