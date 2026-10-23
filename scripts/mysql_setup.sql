-- ===================================================================
-- Script: mysql_setup.sql
-- Project: Big Data Driven Analysis of Indian Agricultural Market Prices
-- Description: Creates agricultural database and mandi_prices table,
--              then loads structured mandi arrival price dataset.
--              Handles arbitrary row counts, Min_x0020_Price columns,
--              and DD/MM/YYYY date parsing.
-- ===================================================================

-- 1. Create and switch to Database
CREATE DATABASE IF NOT EXISTS agri_db;
USE agri_db;

-- 2. Drop existing table if needed
DROP TABLE IF EXISTS mandi_prices;

-- 3. Create Table matching exact data.gov.in Agmarknet schema
CREATE TABLE mandi_prices (
    record_id INT AUTO_INCREMENT PRIMARY KEY,
    state VARCHAR(100) NOT NULL,
    district VARCHAR(100) NOT NULL,
    market VARCHAR(100) NOT NULL,
    commodity VARCHAR(100) NOT NULL,
    variety VARCHAR(100),
    grade VARCHAR(50),
    arrival_date DATE NOT NULL,
    min_price DECIMAL(10,2) NOT NULL,
    max_price DECIMAL(10,2) NOT NULL,
    modal_price DECIMAL(10,2) NOT NULL,
    INDEX idx_commodity (commodity),
    INDEX idx_district (district),
    INDEX idx_state_date (state, arrival_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4. Enable Local Data Loading
SET GLOBAL local_infile = 1;

-- 5. Load Real Mandi Price Data from CSV
-- Path is relative to scripts/ or absolute: ../data/mandi_prices.csv
LOAD DATA LOCAL INFILE '../data/mandi_prices.csv'
INTO TABLE mandi_prices
FIELDS TERMINATED BY ',' 
OPTIONALLY ENCLOSED BY '"'
LINES TERMINATED BY '\n'
IGNORE 1 LINES
(
    state, 
    district, 
    market, 
    commodity, 
    variety, 
    grade, 
    @arrival_date, 
    min_price, 
    max_price, 
    modal_price
)
SET arrival_date = STR_TO_DATE(TRIM(REPLACE(@arrival_date, '\r', '')), '%d/%m/%Y');

-- 6. Verification Queries
SELECT 'Verification: Total Mandi Records Ingested:' AS status, COUNT(*) AS total_rows FROM mandi_prices;
SELECT state, district, market, commodity, arrival_date, min_price, modal_price, max_price FROM mandi_prices LIMIT 5;
