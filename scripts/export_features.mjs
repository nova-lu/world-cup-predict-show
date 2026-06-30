import { getTrainingData } from '../server/ml/data/loader.js';
import { buildFeatureBatch, exportToCSV, splitDataset } from '../server/ml/data/features.js';

const matches = getTrainingData({ minYear: 1950, filterLevel: 'P2' });
console.log('Total matches:', matches.length);

const features = await buildFeatureBatch(matches);
console.log('Feature rows:', features.length);

const outPath = 'data/ml/train/v1/features_full.csv';
exportToCSV(features, outPath);
console.log('Exported to:', outPath);

const split = splitDataset(features);
console.log('Train:', split.stats.train, 'Val:', split.stats.val, 'Test:', split.stats.test);
console.log('Features:', JSON.stringify(split.stats.features));
