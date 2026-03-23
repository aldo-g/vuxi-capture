# Vuxi Capture

Minimal web capture service that discovers internal links for a site and saves full page screenshots for each discovered page. The project intentionally focuses on the core flow—discover URLs, take screenshots, expose job progress via a small API—so the codebase stays easy to reason about and run. While capturing every page, the service now scans for unique interactive elements (buttons, nav items, inputs, etc.), safely exercises each without leaving the page, and stores extra screenshots that showcase those interactive states plus metadata about how they were triggered. After a run finishes, a lightweight deduplication pass removes redundant screenshots so only unique visual states remain on disk.

## Getting Started

```bash
npm install
npm run dev   # starts the API with nodemon
# or
npm start     # plain node server.js
```

The server listens on `PORT` (defaults to `3001`).

## API

| Endpoint | Description |
| --- | --- |
| `GET /health` | Basic service info plus active job count. |
| `POST /api/capture` | Body: `{ "baseUrl": "https://example.com", "options": { ... } }`. Starts a background job and returns `{ jobId }`. |
| `GET /api/capture/:jobId` | Returns the full job record (status, progress, stats, files). |
| `GET /api/jobs` | Lists all jobs in memory (useful during local development). |
| `GET /data/...` | Static file server exposing generated artifacts inside `data/`. |

### Capture Options

All options are optional:

| Option | Default | Notes |
| --- | --- | --- |
| `maxPages` | `10` | Maximum number of unique internal pages to crawl. |
| `concurrency` | `3` | Pages crawled concurrently during discovery. |
| `timeout` | `10000` | Timeout (ms) for both discovery navigation and screenshots. |
| `viewport` | `{ width: 1280, height: 720 }` | Playwright viewport for screenshots. |
| `concurrentCaptures` | `2` | How many screenshots run at the same time. |

Responses from `GET /api/capture/:jobId` include discovery statistics, screenshot counts, and the file paths for `urls.json`, `urls_simple.json`, `metadata.json`, and the `desktop/` screenshot folder (all within `data/job_<id>/`).

## Running a Capture Without the API

The package exports a simple helper:

```js
const { capture } = require('@vuxi/capture');

capture('https://example.com', { maxPages: 5 })
  .then(result => console.log(result))
  .catch(console.error);
```

This uses the exact same discovery and screenshot services as the API.

## Tests

We keep the test suite lightweight by injecting stub services so the core orchestration logic can be verified without hitting the network or launching a browser.

```
npm test
```

## Project Layout

```
src/
  app.js           # Express app + routes
  jobs/jobRunner   # Job lifecycle + orchestration
  services/
    urlDiscovery   # Minimal Playwright crawler
    screenshot     # Screenshot helper
tests/             # Mocha tests
data/              # Output directory written at runtime
```

The runtime never persists state outside `data/`, so cleaning up after manual runs simply requires removing the job folders within `data/`.
