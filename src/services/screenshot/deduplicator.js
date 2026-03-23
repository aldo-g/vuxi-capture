const fs = require('fs-extra');
const sharp = require('sharp');

class ScreenshotDeduplicator {
  constructor(options = {}) {
    this.threshold = options.threshold ?? 5;
  }

  async run(successful = []) {
    const seen = [];
    const removed = [];

    const processRecord = async (entry, interaction = null) => {
      const target = interaction ? interaction.screenshot : entry;
      if (!target?.outputPath || !(await fs.pathExists(target.outputPath))) {
        return;
      }

      const hash = await this.#computeImageHash(target.outputPath);
      if (!hash) {
        return;
      }

      const match = this.#findSimilarHash(seen, hash);
      if (match) {
        const keeper = match;
        removed.push({
          removed: {
            type: interaction ? 'interaction' : 'base',
            url: entry.url,
            filename: target.filename
          },
          kept: {
            type: keeper.interaction ? 'interaction' : 'base',
            url: keeper.entry.url,
            filename: keeper.target.filename
          }
        });

        await fs.remove(target.outputPath).catch(() => {});

        if (interaction) {
          interaction.status = 'duplicate';
          interaction.duplicateOf = {
            url: keeper.entry.url,
            filename: keeper.target.filename
          };
          interaction.screenshot = { ...keeper.target };
        } else {
          entry.duplicate = true;
          entry.duplicateOf = {
            url: keeper.entry.url,
            filename: keeper.target.filename
          };
          entry.removedFilename = entry.filename;
          entry.filename = keeper.target.filename;
          entry.path = keeper.target.path;
          entry.outputPath = keeper.target.outputPath;
        }
      } else {
        seen.push({ hash, entry, interaction, target });
      }
    };

    for (const entry of successful) {
      await processRecord(entry);
      for (const interaction of entry.interactions || []) {
        if (interaction.status === 'captured' && interaction.screenshot) {
          await processRecord(entry, interaction);
        }
      }
    }

    return {
      totalDuplicates: removed.length,
      removed
    };
  }

  async #computeImageHash(filePath) {
    try {
      const data = await sharp(filePath)
        .greyscale()
        .resize(16, 16, { fit: 'fill' })
        .raw()
        .toBuffer();

      const avg = data.reduce((sum, value) => sum + value, 0) / data.length;
      return Array.from(data, value => (value > avg ? 1 : 0));
    } catch {
      return null;
    }
  }

  #findSimilarHash(seen, hash) {
    for (const candidate of seen) {
      const distance = this.#hammingDistance(hash, candidate.hash);
      if (distance <= this.threshold) {
        return candidate;
      }
    }
    return null;
  }

  #hammingDistance(hashA = [], hashB = []) {
    const length = Math.min(hashA.length, hashB.length);
    let distance = 0;
    for (let i = 0; i < length; i += 1) {
      if (hashA[i] !== hashB[i]) {
        distance += 1;
      }
    }
    return distance + Math.abs(hashA.length - hashB.length);
  }
}

module.exports = { ScreenshotDeduplicator };
