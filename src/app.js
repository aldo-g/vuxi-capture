const express = require('express');
const cors = require('cors');
const path = require('path');
const { JobRunner, JOB_STATUS } = require('./jobs/jobRunner');

const app = express();
const jobRunner = new JobRunner();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/health', (req, res) => {
  const jobs = jobRunner.listJobs();
  const activeJobs = jobs.filter(job =>
    [JOB_STATUS.URL_DISCOVERY, JOB_STATUS.SCREENSHOT].includes(job.status)
  );

  res.json({
    status: 'ok',
    service: 'vuxi-capture',
    timestamp: new Date().toISOString(),
    totalJobs: jobs.length,
    activeJobs: activeJobs.length
  });
});

app.post('/api/capture', (req, res) => {
  const { baseUrl, options } = req.body || {};

  if (!baseUrl) {
    return res.status(400).json({ error: 'baseUrl is required' });
  }

  const job = jobRunner.createJob(baseUrl, options);
  res.status(202).json({ jobId: job.id });
});

app.get('/api/capture/:jobId', (req, res) => {
  const job = jobRunner.getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.json(job);
});

app.get('/api/jobs', (req, res) => {
  const jobs = jobRunner.listJobs();
  res.json(jobs);
});

app.use('/data', express.static(path.join(process.cwd(), 'data')));

module.exports = { app, jobRunner, JOB_STATUS };
