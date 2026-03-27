const { expect } = require('chai');

const BASE_URL = 'http://localhost:3001';
const TIMEOUT = 3 * 60 * 1000; // 3 minutes

async function post(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
}

async function get(path) {
  const res = await fetch(`${BASE_URL}${path}`);
  return res.json();
}

function pollJob(jobId, interval = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setInterval(async () => {
      try {
        const job = await get(`/api/capture/${jobId}`);
        if (job.status === 'completed' || job.status === 'failed') {
          clearInterval(timer);
          resolve(job);
        }
      } catch (err) {
        clearInterval(timer);
        reject(err);
      }
    }, interval);
  });
}

describe('Integration: alastairgrant.dev capture', function () {
  this.timeout(TIMEOUT);

  it('produces exactly 5 screenshots for alastairgrant.dev', async function () {
    const { jobId } = await post('/api/capture', {
      baseUrl: 'https://www.alastairgrant.dev',
      options: {
        maxPages: 15,
        concurrency: 10,
        maxInteractionsPerType: 4
      }
    });

    expect(jobId, 'expected a jobId in response').to.be.a('string');

    const job = await pollJob(jobId);

    expect(job.status).to.equal('completed', `job failed: ${job.error}`);
    expect(job.results.screenshots).to.have.length(5);
  });
});
