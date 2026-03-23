const { expect } = require('chai');
const path = require('path');
const os = require('os');
const fs = require('fs-extra');
const { JobRunner, JOB_STATUS } = require('../src/jobs/jobRunner');

const SUCCESSFUL_DISCOVERY = {
  success: true,
  urls: ['https://example.com', 'https://example.com/about'],
  stats: { pagesCrawled: 2 },
  files: {
    urls: 'urls.json',
    simple: 'urls_simple.json'
  }
};

const SUCCESSFUL_SCREENSHOT = {
  success: true,
  successful: [{ url: 'https://example.com', filename: '001_example.png' }],
  failed: [],
  stats: { totalScreenshots: 1, durationSeconds: 0.1 },
  files: { metadata: 'metadata.json', screenshotsDir: 'desktop' }
};

function waitFor(predicate, timeout = 1000) {
  const start = Date.now();

  return new Promise((resolve, reject) => {
    const check = () => {
      if (predicate()) {
        return resolve();
      }

      if (Date.now() - start > timeout) {
        return reject(new Error('Timed out waiting for condition'));
      }

      setTimeout(check, 25);
    };

    check();
  });
}

function createRunner(factories = {}) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vuxi-job-runner-'));
  tempDirs.push(tmpRoot);
  return new JobRunner(factories, { outputRoot: tmpRoot });
}

const tempDirs = [];

after(async () => {
  await Promise.all(tempDirs.map(dir => fs.remove(dir)));
});

describe('JobRunner', () => {
  it('completes a job with stubbed services', async () => {
    const runner = createRunner({
      discoveryFactory: () => ({
        discover: async () => SUCCESSFUL_DISCOVERY
      }),
      screenshotFactory: () => ({
        captureAll: async () => SUCCESSFUL_SCREENSHOT
      })
    });

    const job = runner.createJob('https://example.com');
    await waitFor(() => runner.getJob(job.id).status === JOB_STATUS.COMPLETED);

    const finished = runner.getJob(job.id);
    expect(finished.status).to.equal(JOB_STATUS.COMPLETED);
    expect(finished.discovery.count).to.equal(2);
    expect(finished.results.screenshots).to.have.length(1);
  });

  it('marks job as failed when services throw', async () => {
    const runner = createRunner({
      discoveryFactory: () => ({
        discover: async () => {
          throw new Error('boom');
        }
      })
    });

    const job = runner.createJob('https://example.com');
    await waitFor(() => runner.getJob(job.id).status === JOB_STATUS.FAILED);

    const failed = runner.getJob(job.id);
    expect(failed.status).to.equal(JOB_STATUS.FAILED);
    expect(failed.error).to.match(/boom/i);
  });
});
