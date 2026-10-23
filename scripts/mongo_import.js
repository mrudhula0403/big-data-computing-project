/**
 * ===================================================================
 * Script: mongo_import.js
 * Project: Big Data Driven Analysis of Indian Agricultural Market Prices
 * Description: Ingests real India Agriculture dataset (crop_production.csv)
 *              into MongoDB as semi-structured crop metadata documents.
 *              Also computes production aggregations for the dashboard.
 * 
 * INSTALLATION & EXECUTION INSTRUCTIONS:
 *   Step 1: cd scripts
 *   Step 2: npm install
 *           (Installs 'csv-parser' and 'mongodb')
 *   Step 3: node mongo_import.js
 * ===================================================================
 */

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { MongoClient } = require('mongodb');

// Configuration
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017';
const DB_NAME = 'agri_db';
const COLLECTION_NAME = 'crop_metadata';

// Locate real dataset file (data/crop_production.csv)
function resolveDatasetPath() {
  const possiblePaths = [
    path.join(__dirname, '../data/crop_production.csv'),
    '/data/crop_production.csv'
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  throw new Error('crop_production.csv not found in data/ or /data!');
}

async function run() {
  const datasetPath = resolveDatasetPath();
  const outputJsonPath = path.join(__dirname, '../dashboard/data/mongo_season_production.json');

  console.log(`\n==========================================================`);
  console.log(` MongoDB Crop Metadata Ingestion Engine`);
  console.log(` Connecting to: ${MONGO_URI}/${DB_NAME}`);
  console.log(` Ingesting from: ${datasetPath}`);
  console.log(`==========================================================\n`);

  const client = new MongoClient(MONGO_URI);

  try {
    await client.connect();
    console.log(' Connected successfully to MongoDB server.');

    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION_NAME);

    // Reset collection for clean idempotent import
    await collection.deleteMany({});
    console.log(` Cleared previous records from '${COLLECTION_NAME}' collection.`);

    const BATCH_SIZE = 5000;
    let batch = [];
    let totalImported = 0;

    // Stream and parse CSV in batches for optimal memory performance
    await new Promise((resolve, reject) => {
      const stream = fs.createReadStream(datasetPath).pipe(csv());

      stream.on('data', async (row) => {
        // Real columns: State_Name, District_Name, Crop_Year, Season, Crop, Area, Production
        const state = (row.State_Name || row.state || '').trim();
        const district = (row.District_Name || row.district || '').trim();
        const crop = (row.Crop || row.crop || '').trim();
        const season = (row.Season || row.season || '').trim();
        const areaValue = row.Area ?? row.area;
        const productionValue = row.Production ?? row.production;
        const yearValue = row.Crop_Year ?? row.crop_year;
        const area = areaValue && areaValue.trim() ? Number(areaValue) : NaN;
        const production = productionValue && productionValue.trim() ? Number(productionValue) : NaN;
        const cropYear = yearValue && yearValue.trim() ? Number(yearValue) : NaN;

        if (crop && state && season && Number.isFinite(area) &&
            Number.isFinite(production) && Number.isInteger(cropYear)) {
          batch.push({
            crop: crop,
            season: season,
            region: {
              state: state,
              district: district
            },
            crop_year: cropYear,
            area_hectares: area,
            production_tonnes: production,
            yield_tonnes_per_hectare: area > 0 ? +(production / area).toFixed(2) : null,
            imported_at: new Date()
          });
        }

        if (batch.length >= BATCH_SIZE) {
          stream.pause();
          try {
            await collection.insertMany(batch);
            totalImported += batch.length;
            process.stdout.write(`\r Ingested: ${totalImported.toLocaleString()} records...`);
            batch = [];
            stream.resume();
          } catch (err) {
            reject(err);
          }
        }
      });

      stream.on('end', async () => {
        try {
          if (batch.length > 0) {
            await collection.insertMany(batch);
            totalImported += batch.length;
          }
          console.log(`\n\n Completed Ingestion: ${totalImported.toLocaleString()} documents loaded into MongoDB.`);
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      stream.on('error', (err) => reject(err));
    });

    // Create Indexes
    await collection.createIndex({ crop: 1, 'region.district': 1 });
    await collection.createIndex({ season: 1 });
    console.log(' Indexes created on { crop: 1, "region.district": 1 } and { season: 1 }.');

    // Requirement 4: Season-wise Crop Production Aggregation from MongoDB
    console.log('\n Executing Season-wise Crop Production aggregation in MongoDB...');
    const seasonAggregation = await collection.aggregate([
      {
        $group: {
          _id: "$season",
          total_production_tonnes: { $sum: "$production_tonnes" },
          total_area_hectares: { $sum: "$area_hectares" },
          total_records: { $sum: 1 }
        }
      },
      {
        $project: {
          _id: 0,
          season: "$_id",
          total_production_tonnes: { $round: ["$total_production_tonnes", 2] },
          total_area_hectares: { $round: ["$total_area_hectares", 2] },
          avg_yield: {
            $cond: [
              { $gt: ["$total_area_hectares", 0] },
              { $round: [{ $divide: ["$total_production_tonnes", "$total_area_hectares"] }, 2] },
              null
            ]
          },
          total_records: 1
        }
      },
      { $sort: { total_production_tonnes: -1 } }
    ]).toArray();

    console.log(' Season-wise Aggregation Result:');
    console.table(seasonAggregation);

    // Export aggregation to dashboard data folder
    const dashboardDir = path.dirname(outputJsonPath);
    if (!fs.existsSync(dashboardDir)) {
      fs.mkdirSync(dashboardDir, { recursive: true });
    }
    fs.writeFileSync(outputJsonPath, JSON.stringify(seasonAggregation, null, 2), 'utf8');
    console.log(` Exported season production aggregation to: ${outputJsonPath}`);

    const yearlyAggregation = await collection.aggregate([
      {
        $group: {
          _id: {
            state: '$region.state',
            district: '$region.district',
            crop: '$crop',
            season: '$season',
            year: '$crop_year'
          },
          production: { $sum: '$production_tonnes' },
          area: { $sum: '$area_hectares' }
        }
      },
      {
        $project: {
          _id: 0,
          state: '$_id.state',
          district: '$_id.district',
          crop: '$_id.crop',
          season: '$_id.season',
          year: '$_id.year',
          production: 1,
          area: 1
        }
      },
      { $sort: { state: 1, district: 1, crop: 1, season: 1, year: 1 } }
    ]).toArray();
    fs.writeFileSync(
      path.join(dashboardDir, 'production_yearly_state_crop_season.json'),
      JSON.stringify(yearlyAggregation, null, 2),
      'utf8'
    );

    const topDistricts = await collection.aggregate([
      { $match: { 'region.district': { $exists: true, $nin: [null, ''] } } },
      { $group: { _id: '$region.district', production: { $sum: '$production_tonnes' } } },
      { $project: { _id: 0, district: '$_id', production: 1 } },
      { $sort: { production: -1, district: 1 } },
      { $limit: 10 }
    ]).toArray();
    fs.writeFileSync(
      path.join(dashboardDir, 'top_districts_production.json'),
      JSON.stringify(topDistricts, null, 2),
      'utf8'
    );

  } catch (error) {
    console.error(' ERROR during MongoDB import:', error);
    process.exit(1);
  } finally {
    await client.close();
    console.log(' Closed MongoDB connection.\n');
  }
}

run();
