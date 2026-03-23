const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const { URLDiscoveryService } = require('../services/urlDiscovery');
const { ScreenshotService } = require('../services/screenshot');

const JOB_STATUS = {
  PENDING: 'pending',
  URL_DISCOVERY: 'url_discovery',
  SCREENSHOT: 'screenshot',
  COMPLETED: 'completed',
  FAILED: 'failed'
};

class JobRunner {
  constructor(factories = {}) {
    this.jobs = new Map();
    this.discoveryFactory =
      factories.discoveryFactory ||
      (options => new URLDiscoveryService(options));
    this.screenshotFactory =
      factories.screenshotFactory ||
      (options => new ScreenshotService(options));
  }

  listJobs() {
    return Array.from(this.jobs.values());
  }

  getJob(jobId) {
    return this.jobs.get(jobId);
  }

  createJob(baseUrl, options = {}) {
    const jobId = uuidv4();
    const outputDir = path.join(process.cwd(), 'data', `job_${jobId}`);
    const timestamp = new Date().toISOString();

    const job = {
      id: jobId,
      baseUrl,
      status: JOB_STATUS.PENDING,
      createdAt: timestamp,
      updatedAt: timestamp,
      outputDir,
      options: {
        maxPages: options.maxPages ?? 10,
        concurrency: options.concurrency ?? 3,
        timeout: options.timeout ?? 10000,
        viewport: options.viewport || { width: 1280, height: 720 },
        concurrentCaptures: options.concurrentCaptures ?? 2
      },
      progress: {
        stage: 'queued',
        message: 'Waiting to start'
      }
    };

    this.jobs.set(jobId, job);
    fs.ensureDir(outputDir).catch(() => {});

    setImmediate(() => {
      this.#process(jobId).catch(error => {
        this.#updateJob(jobId, {
          status: JOB_STATUS.FAILED,
          error: error.message,
          progress: {
            stage: 'failed',
            message: error.message
          }
        });
      });
    });

    return job;
  }

  async #process(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) {
      return;
    }

    console.log(`[job ${jobId}] starting capture run for ${job.baseUrl}`);

    this.#updateJob(jobId, {
      status: JOB_STATUS.URL_DISCOVERY,
      progress: {
        stage: 'url_discovery',
        message: 'Discovering internal URLs'
      }
    });

    const discoveryService = this.discoveryFactory({
      maxPages: job.options.maxPages,
      concurrency: job.options.concurrency,
      timeout: job.options.timeout,
      outputDir: job.outputDir
    });

    const discoveryResult = await discoveryService.discover(job.baseUrl);
    if (!discoveryResult.success || !discoveryResult.urls.length) {
      throw new Error('No URLs discovered');
    }

    this.#updateJob(jobId, {
      discovery: {
        count: discoveryResult.urls.length,
        stats: discoveryResult.stats,
        files: discoveryResult.files
      },
      progress: {
        stage: 'url_discovery_complete',
        message: `Found ${discoveryResult.urls.length} URL(s)`
      }
    });

    this.#updateJob(jobId, {
      status: JOB_STATUS.SCREENSHOT,
      progress: {
        stage: 'screenshot',
        message: 'Capturing screenshots'
      }
    });

    const screenshotService = this.screenshotFactory({
      outputDir: job.outputDir,
      viewport: job.options.viewport,
      timeout: job.options.timeout,
      concurrent: job.options.concurrentCaptures
    });

    const screenshotResult = await screenshotService.captureAll(
      discoveryResult.urls
    );
    if (!screenshotResult.success) {
      throw new Error('Screenshot capture failed');
    }

    this.#updateJob(jobId, {
      status: JOB_STATUS.COMPLETED,
      results: {
        urls: discoveryResult.urls,
        screenshots: screenshotResult.successful,
        stats: {
          discovery: discoveryResult.stats,
          screenshots: screenshotResult.stats
        },
        files: {
          urls: discoveryResult.files,
          screenshots: screenshotResult.files
        },
        outputDir: job.outputDir
      },
      progress: {
        stage: 'completed',
        message: 'Job completed successfully'
      }
    });
  }

  #updateJob(jobId, updates) {
    const job = this.jobs.get(jobId);
    if (!job) {
      return;
    }

    const nextJob = {
      ...job,
      ...updates,
      updatedAt: new Date().toISOString()
    };

    if (updates.options) {
      nextJob.options = { ...job.options, ...updates.options };
    }

    if (updates.progress) {
      nextJob.progress = { ...job.progress, ...updates.progress };
    }

    if (updates.discovery) {
      nextJob.discovery = updates.discovery;
    }

    if (updates.results) {
      nextJob.results = updates.results;
    }

    this.jobs.set(jobId, nextJob);
  }
}

module.exports = { JobRunner, JOB_STATUS };
