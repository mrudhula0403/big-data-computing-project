-- ===================================================================
-- Script: analysis.hql
-- Project: Big Data Driven Analysis of Indian Agricultural Market Prices
-- Description: HiveQL script defining warehouse external tables over HDFS,
--              executing the 5 core analytical queries from the project report,
--              and performing the state + month relational join with rainfall.
--              Fully dynamic — handles any dataset size without hardcoded limits.
--
-- Run with: hive -f analysis.hql
-- ===================================================================

-- 1. Database Setup
CREATE DATABASE IF NOT EXISTS agri_warehouse;
USE agri_warehouse;

-- Sqoop appends new CSV rows to the stable ingest location.
CREATE EXTERNAL TABLE IF NOT EXISTS hive_mandi_raw (
    record_id INT,
    state STRING,
    district STRING,
    market STRING,
    commodity STRING,
    variety STRING,
    grade STRING,
    arrival_date STRING,
    min_price DOUBLE,
    max_price DOUBLE,
    modal_price DOUBLE
)
ROW FORMAT DELIMITED
FIELDS TERMINATED BY ','
STORED AS TEXTFILE
LOCATION '/agri/mandi';

-- Rebuild the query table from the accumulated import, partitioned by date.
DROP TABLE IF EXISTS hive_mandi_prices;
CREATE TABLE IF NOT EXISTS hive_mandi_prices (
    record_id INT,
    state STRING,
    district STRING,
    market STRING,
    commodity STRING,
    variety STRING,
    grade STRING,
    arrival_date STRING,
    min_price DOUBLE,
    max_price DOUBLE,
    modal_price DOUBLE
)
PARTITIONED BY (year STRING, month STRING)
STORED AS ORC;

SET hive.exec.dynamic.partition=true;
SET hive.exec.dynamic.partition.mode=nonstrict;
INSERT OVERWRITE TABLE hive_mandi_prices PARTITION (year, month)
SELECT record_id, state, district, market, commodity, variety, grade,
       arrival_date, min_price, max_price, modal_price,
       SUBSTR(arrival_date, 1, 4) AS year,
       SUBSTR(arrival_date, 6, 2) AS month
FROM hive_mandi_raw;

-- 3. Create External Table over Pig-processed Monthly Rainfall in HDFS
DROP TABLE IF EXISTS hive_monthly_rainfall;
CREATE EXTERNAL TABLE hive_monthly_rainfall (
    state STRING,
    month_num INT,
    month_name STRING,
    avg_rainfall DOUBLE
)
ROW FORMAT DELIMITED
FIELDS TERMINATED BY ','
STORED AS TEXTFILE
LOCATION '/agri/output/rainfall_avg';


-- ===================================================================
-- ANALYTICAL QUERY 1: Crop-wise Price Spectrum (Min, Modal, Max Prices)
-- ===================================================================
SELECT '=== QUERY 1: CROP-WISE AVERAGE, MINIMUM, AND MAXIMUM PRICES ===' AS title;

SELECT 
    commodity,
    COUNT(*) AS total_lots_traded,
    ROUND(MIN(min_price), 2) AS overall_min_price,
    ROUND(AVG(modal_price), 2) AS avg_modal_price,
    ROUND(MAX(max_price), 2) AS overall_max_price,
    ROUND(MAX(max_price) - MIN(min_price), 2) AS price_spread
FROM hive_mandi_prices
GROUP BY commodity
ORDER BY avg_modal_price DESC;


-- ===================================================================
-- ANALYTICAL QUERY 2: District-wise Price Comparison Across Crops
-- ===================================================================
SELECT '=== QUERY 2: DISTRICT-WISE PRICE COMPARISON ===' AS title;

SELECT 
    district,
    commodity,
    COUNT(*) AS mandi_arrivals,
    ROUND(AVG(modal_price), 2) AS avg_modal_price,
    ROUND(MIN(min_price), 2) AS min_price,
    ROUND(MAX(max_price), 2) AS max_price
FROM hive_mandi_prices
GROUP BY district, commodity
ORDER BY district ASC, avg_modal_price DESC;


-- ===================================================================
-- ANALYTICAL QUERY 3: Season-wise Price Trends (Kharif, Rabi, Zaid)
-- ===================================================================
SELECT '=== QUERY 3: SEASON-WISE PRICE TRENDS ===' AS title;

SELECT 
    CASE 
        WHEN CAST(SUBSTR(arrival_date, 6, 2) AS INT) IN (6, 7, 8, 9, 10) THEN 'Kharif'
        WHEN CAST(SUBSTR(arrival_date, 6, 2) AS INT) IN (11, 12, 1, 2, 3) THEN 'Rabi'
        ELSE 'Zaid'
    END AS season,
    commodity,
    COUNT(*) AS lots_count,
    ROUND(AVG(modal_price), 2) AS seasonal_avg_modal_price
FROM hive_mandi_prices
GROUP BY 
    CASE 
        WHEN CAST(SUBSTR(arrival_date, 6, 2) AS INT) IN (6, 7, 8, 9, 10) THEN 'Kharif'
        WHEN CAST(SUBSTR(arrival_date, 6, 2) AS INT) IN (11, 12, 1, 2, 3) THEN 'Rabi'
        ELSE 'Zaid'
    END,
    commodity
ORDER BY season, seasonal_avg_modal_price DESC;


-- ===================================================================
-- ANALYTICAL QUERY 4: Top-Performing Crops per District
-- ===================================================================
SELECT '=== QUERY 4: TOP-PERFORMING CROPS PER DISTRICT ===' AS title;

WITH ranked_crops AS (
    SELECT 
        district,
        commodity,
        ROUND(AVG(modal_price), 2) AS avg_price,
        COUNT(*) AS total_lots,
        ROW_NUMBER() OVER (PARTITION BY district ORDER BY AVG(modal_price) DESC) as price_rank
    FROM hive_mandi_prices
    GROUP BY district, commodity
)
SELECT 
    district,
    commodity AS top_crop,
    avg_price AS top_modal_price,
    total_lots
FROM ranked_crops
WHERE price_rank = 1
ORDER BY top_modal_price DESC;


-- ===================================================================
-- ANALYTICAL QUERY 5: Rainfall vs Price Comparison (Joined on State + Month)
-- ===================================================================
SELECT '=== QUERY 5: RAINFALL VS MODAL PRICE JOIN (STATE + MONTH) ===' AS title;

SELECT 
    m.state,
    r.month_name,
    r.month_num,
    ROUND(r.avg_rainfall, 1) AS monthly_rainfall_mm,
    COUNT(m.record_id) AS mandi_transactions,
    ROUND(AVG(m.modal_price), 2) AS avg_mandi_price,
    ROUND(MIN(m.min_price), 2) AS min_price,
    ROUND(MAX(m.max_price), 2) AS max_price
FROM hive_mandi_prices m
JOIN hive_monthly_rainfall r 
  ON (LOWER(TRIM(m.state)) = LOWER(TRIM(r.state)) 
      AND CAST(SUBSTR(m.arrival_date, 6, 2) AS INT) = r.month_num)
GROUP BY m.state, r.month_name, r.month_num, r.avg_rainfall
ORDER BY r.month_num ASC;
