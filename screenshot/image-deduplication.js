// Image Deduplication Service
// Removes duplicate screenshots using perceptual hashing to identify similar images

const crypto = require('crypto');
const sharp = require('sharp');

class ImageDeduplicationService {
  constructor(options = {}) {
    this.options = {
      // Similarity threshold (0-100, lower = more strict)
      similarityThreshold: options.similarityThreshold || 95,
      
      // Hash size for perceptual hashing (larger = more precise)
      hashSize: options.hashSize || 16,
      
      // Whether to keep the highest quality image when duplicates found
      keepHighestQuality: options.keepHighestQuality !== false,
      
      // Whether to preserve the first screenshot when duplicates found
      preserveFirst: options.preserveFirst || false,
      
      // Enable detailed logging
      verbose: options.verbose || false,
      
      ...options
    };
    
    this.processedHashes = new Map();
    this.duplicateGroups = [];
  }

  // Generate perceptual hash for an image
  async generatePerceptualHash(imageBuffer) {
    try {
      // Resize to hash size and convert to grayscale
      const processed = await sharp(imageBuffer)
        .resize(this.options.hashSize, this.options.hashSize, {
          fit: 'fill',
          kernel: sharp.kernel.lanczos3
        })
        .grayscale()
        .raw()
        .toBuffer();

      // Calculate average pixel value
      const pixels = Array.from(processed);
      const average = pixels.reduce((sum, pixel) => sum + pixel, 0) / pixels.length;

      // Generate binary hash based on average
      let hash = '';
      for (let i = 0; i < pixels.length; i++) {
        hash += pixels[i] >= average ? '1' : '0';
      }

      return hash;
    } catch (error) {
      console.error(`Error generating perceptual hash: ${error.message}`);
      return null;
    }
  }

  // Calculate Hamming distance between two hashes
  calculateHammingDistance(hash1, hash2) {
    if (hash1.length !== hash2.length) {
      return Infinity;
    }

    let distance = 0;
    for (let i = 0; i < hash1.length; i++) {
      if (hash1[i] !== hash2[i]) {
        distance++;
      }
    }

    return distance;
  }

  // Calculate similarity percentage between two hashes
  calculateSimilarity(hash1, hash2) {
    const distance = this.calculateHammingDistance(hash1, hash2);
    const maxDistance = hash1.length;
    const similarity = ((maxDistance - distance) / maxDistance) * 100;
    return similarity;
  }

  // Generate additional metadata hash for tie-breaking
  async generateMetadataHash(imageBuffer) {
    try {
      const metadata = await sharp(imageBuffer).metadata();
      const metadataString = `${metadata.width}x${metadata.height}_${metadata.size}_${metadata.format}`;
      return crypto.createHash('md5').update(metadataString).digest('hex');
    } catch (error) {
      return crypto.createHash('md5').update(imageBuffer).digest('hex').substring(0, 8);
    }
  }

  // Process screenshots and identify duplicates
  async processScreenshots(screenshots) {
    console.log(`🔍 Starting deduplication of ${screenshots.length} screenshots...`);
    
    if (screenshots.length <= 1) {
      console.log('ℹ️  Only one or no screenshots, no deduplication needed');
      return screenshots;
    }

    const imageAnalysis = [];
    
    // Step 1: Generate hashes for all images
    console.log('📊 Generating perceptual hashes...');
    for (let i = 0; i < screenshots.length; i++) {
      const screenshot = screenshots[i];
      
      try {
        const perceptualHash = await this.generatePerceptualHash(screenshot.buffer);
        const metadataHash = await this.generateMetadataHash(screenshot.buffer);
        
        if (perceptualHash) {
          imageAnalysis.push({
            index: i,
            screenshot,
            perceptualHash,
            metadataHash,
            size: screenshot.buffer.length,
            kept: true // Will be set to false for duplicates
          });
          
          if (this.options.verbose) {
            console.log(`   ${i + 1}/${screenshots.length}: ${screenshot.filename} - Hash: ${perceptualHash.substring(0, 16)}...`);
          }
        } else {
          console.log(`   ⚠️  Failed to hash ${screenshot.filename}, keeping original`);
          imageAnalysis.push({
            index: i,
            screenshot,
            perceptualHash: null,
            metadataHash: null,
            size: screenshot.buffer.length,
            kept: true
          });
        }
      } catch (error) {
        console.error(`   ❌ Error processing ${screenshot.filename}: ${error.message}`);
        imageAnalysis.push({
          index: i,
          screenshot,
          perceptualHash: null,
          metadataHash: null,
          size: screenshot.buffer.length,
          kept: true
        });
      }
    }

    // Step 2: Find duplicate groups
    console.log('🔍 Identifying duplicate groups...');
    const duplicateGroups = [];
    const processed = new Set();

    for (let i = 0; i < imageAnalysis.length; i++) {
      if (processed.has(i) || !imageAnalysis[i].perceptualHash) continue;

      const group = [i];
      const baseHash = imageAnalysis[i].perceptualHash;

      // Find all similar images
      for (let j = i + 1; j < imageAnalysis.length; j++) {
        if (processed.has(j) || !imageAnalysis[j].perceptualHash) continue;

        const similarity = this.calculateSimilarity(baseHash, imageAnalysis[j].perceptualHash);
        
        if (similarity >= this.options.similarityThreshold) {
          group.push(j);
          
          if (this.options.verbose) {
            console.log(`   📸 Found duplicate: ${imageAnalysis[i].screenshot.filename} ↔ ${imageAnalysis[j].screenshot.filename} (${similarity.toFixed(1)}% similar)`);
          }
        }
      }

      if (group.length > 1) {
        duplicateGroups.push(group);
        group.forEach(idx => processed.add(idx));
      }
    }

    // Step 3: Choose which images to keep from each duplicate group
    console.log(`🗂️  Processing ${duplicateGroups.length} duplicate groups...`);
    
    for (const group of duplicateGroups) {
      let keepIndex;

      if (this.options.preserveFirst) {
        // Keep the first screenshot (baseline preference)
        keepIndex = group.reduce((earliest, current) => 
          imageAnalysis[current].index < imageAnalysis[earliest].index ? current : earliest
        );
      } else if (this.options.keepHighestQuality) {
        // Keep the largest file size (usually highest quality)
        keepIndex = group.reduce((largest, current) => 
          imageAnalysis[current].size > imageAnalysis[largest].size ? current : largest
        );
      } else {
        // Keep the first one found
        keepIndex = group[0];
      }

      // Mark others as duplicates
      group.forEach(idx => {
        if (idx !== keepIndex) {
          imageAnalysis[idx].kept = false;
          
          if (this.options.verbose) {
            console.log(`   🗑️  Marking duplicate for removal: ${imageAnalysis[idx].screenshot.filename}`);
          }
        }
      });

      console.log(`   ✅ Keeping: ${imageAnalysis[keepIndex].screenshot.filename} (${group.length - 1} duplicates removed)`);
    }

    // Step 4: Filter out duplicates
    const uniqueScreenshots = imageAnalysis
      .filter(analysis => analysis.kept)
      .map(analysis => analysis.screenshot);

    const removedCount = screenshots.length - uniqueScreenshots.length;
    
    console.log(`✅ Deduplication complete:`);
    console.log(`   📸 Original: ${screenshots.length} screenshots`);
    console.log(`   🗑️  Removed: ${removedCount} duplicates`);
    console.log(`   ✨ Final: ${uniqueScreenshots.length} unique screenshots`);

    return uniqueScreenshots;
  }

  // Get deduplication report
  getDeduplicationReport() {
    return {
      totalProcessed: this.processedHashes.size,
      duplicateGroups: this.duplicateGroups.length,
      totalDuplicatesRemoved: this.duplicateGroups.reduce((sum, group) => sum + group.length - 1, 0),
      settings: {
        similarityThreshold: this.options.similarityThreshold,
        hashSize: this.options.hashSize,
        keepHighestQuality: this.options.keepHighestQuality,
        preserveFirst: this.options.preserveFirst
      }
    };
  }

  // Utility method to compare two specific images
  async compareImages(imageBuffer1, imageBuffer2) {
    try {
      const hash1 = await this.generatePerceptualHash(imageBuffer1);
      const hash2 = await this.generatePerceptualHash(imageBuffer2);
      
      if (!hash1 || !hash2) {
        return { similarity: 0, error: 'Failed to generate hashes' };
      }

      const similarity = this.calculateSimilarity(hash1, hash2);
      const hammingDistance = this.calculateHammingDistance(hash1, hash2);

      return {
        similarity,
        hammingDistance,
        isDuplicate: similarity >= this.options.similarityThreshold,
        hash1: hash1.substring(0, 16) + '...',
        hash2: hash2.substring(0, 16) + '...'
      };
    } catch (error) {
      return { similarity: 0, error: error.message };
    }
  }
}

module.exports = { ImageDeduplicationService };