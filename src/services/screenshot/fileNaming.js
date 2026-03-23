const path = require('path');

function slugify(value, fallback = 'interaction') {
  if (!value) {
    return fallback;
  }

  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

  return slug || fallback;
}

function buildFilename(url, index) {
  try {
    const urlObj = new URL(url);
    const host = urlObj.hostname.replace(/^www\./, '');
    const pathPart = urlObj.pathname
      .split('/')
      .filter(Boolean)
      .slice(0, 3)
      .join('-');

    const safePath = pathPart.replace(/[^a-z0-9-]/gi, '-');
    const safeHost = host.replace(/[^a-z0-9.-]/gi, '-');
    return `${String(index).padStart(3, '0')}_${safeHost}${safePath ? `_${safePath}` : ''}.png`;
  } catch {
    return `${String(index).padStart(3, '0')}_page.png`;
  }
}

function buildInteractionFilename(baseFilename, descriptor, index) {
  const base = path.parse(baseFilename).name || 'page';
  const ext = path.extname(baseFilename) || '.png';
  const label = descriptor?.descriptor || `interaction-${index}`;
  const slug = slugify(label, `interaction-${index}`);
  return `${base}__interaction-${String(index).padStart(2, '0')}-${slug}${ext}`;
}

module.exports = {
  slugify,
  buildFilename,
  buildInteractionFilename
};
