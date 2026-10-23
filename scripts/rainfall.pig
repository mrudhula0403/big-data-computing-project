-- ===================================================================
-- Script: rainfall.pig
-- Project: Big Data Driven Analysis of Indian Agricultural Market Prices
-- Description: Apache Pig Latin script to compute average rainfall by
--              state and month, mapping IMD meteorological SUBDIVISIONs
--              to canonical administrative state names.
--
-- Run with: pig -x mapreduce rainfall.pig
--           or in local test mode: pig -x local rainfall.pig
-- ===================================================================

-- 1. Load Rainfall Data from HDFS
raw_rainfall = LOAD '/agri/rainfall/rainfall_india.csv' USING PigStorage(',') AS (
    subdivision:chararray,
    year:int,
    jan:double,
    feb:double,
    mar:double,
    apr:double,
    may:double,
    jun:double,
    jul:double,
    aug:double,
    sep:double,
    oct:double,
    nov:double,
    dec:double,
    annual:double,
    jf:double,
    mam:double,
    jjas:double,
    ond:double
);

-- 2. Skip CSV Header line
clean_rainfall = FILTER raw_rainfall BY (subdivision != 'SUBDIVISION' AND subdivision is not null);

-- 3. Map IMD Meteorological Subdivisions to Canonical State Names
mapped_rainfall = FOREACH clean_rainfall GENERATE
    (CASE 
        WHEN (UPPER(subdivision) MATCHES '.*MAHARASHTRA.*' OR 
              UPPER(subdivision) MATCHES '.*MARATHWADA.*' OR 
              UPPER(subdivision) MATCHES '.*VIDARBHA.*' OR 
              UPPER(subdivision) MATCHES '.*KONKAN.*') THEN 'Maharashtra'
        WHEN (UPPER(subdivision) MATCHES '.*ANDHRA.*' OR 
              UPPER(subdivision) MATCHES '.*RAYALSEEMA.*') THEN 'Andhra Pradesh'
        WHEN UPPER(subdivision) MATCHES '.*PUNJAB.*' THEN 'Punjab'
        WHEN UPPER(subdivision) MATCHES '.*UTTAR PRADESH.*' THEN 'Uttar Pradesh'
        WHEN UPPER(subdivision) MATCHES '.*TAMIL NADU.*' THEN 'Tamil Nadu'
        WHEN (UPPER(subdivision) MATCHES '.*HARYANA.*' OR 
              UPPER(subdivision) MATCHES '.*DELHI.*') THEN 'Haryana'
        WHEN (UPPER(subdivision) MATCHES '.*GUJARAT.*' OR 
              UPPER(subdivision) MATCHES '.*SAURASHTRA.*') THEN 'Gujarat'
        WHEN UPPER(subdivision) MATCHES '.*KARNATAKA.*' THEN 'Karnataka'
        WHEN UPPER(subdivision) MATCHES '.*MADHYA PRADESH.*' THEN 'Madhya Pradesh'
        WHEN UPPER(subdivision) MATCHES '.*RAJASTHAN.*' THEN 'Rajasthan'
        WHEN (UPPER(subdivision) MATCHES '.*ORISSA.*' OR 
              UPPER(subdivision) MATCHES '.*ODISHA.*') THEN 'Odisha'
        WHEN UPPER(subdivision) MATCHES '.*BIHAR.*' THEN 'Bihar'
        WHEN UPPER(subdivision) MATCHES '.*JHARKHAND.*' THEN 'Jharkhand'
        WHEN UPPER(subdivision) MATCHES '.*BENGAL.*' THEN 'West Bengal'
        WHEN UPPER(subdivision) MATCHES '.*KERALA.*' THEN 'Kerala'
        WHEN UPPER(subdivision) MATCHES '.*ASSAM.*' THEN 'Assam'
        ELSE subdivision
    END) AS state:chararray,
    subdivision AS original_subdivision,
    year,
    jan, feb, mar, apr, may, jun, jul, aug, sep, oct, nov, dec, annual;

-- 4. Group by State to Compute Monthly and Annual Averages
grouped_by_state = GROUP mapped_rainfall BY state;

state_monthly_avg = FOREACH grouped_by_state GENERATE
    group AS state,
    ROUND(AVG(mapped_rainfall.jan) * 10.0) / 10.0 AS avg_jan,
    ROUND(AVG(mapped_rainfall.feb) * 10.0) / 10.0 AS avg_feb,
    ROUND(AVG(mapped_rainfall.mar) * 10.0) / 10.0 AS avg_mar,
    ROUND(AVG(mapped_rainfall.apr) * 10.0) / 10.0 AS avg_apr,
    ROUND(AVG(mapped_rainfall.may) * 10.0) / 10.0 AS avg_may,
    ROUND(AVG(mapped_rainfall.jun) * 10.0) / 10.0 AS avg_jun,
    ROUND(AVG(mapped_rainfall.jul) * 10.0) / 10.0 AS avg_jul,
    ROUND(AVG(mapped_rainfall.aug) * 10.0) / 10.0 AS avg_aug,
    ROUND(AVG(mapped_rainfall.sep) * 10.0) / 10.0 AS avg_sep,
    ROUND(AVG(mapped_rainfall.oct) * 10.0) / 10.0 AS avg_oct,
    ROUND(AVG(mapped_rainfall.nov) * 10.0) / 10.0 AS avg_nov,
    ROUND(AVG(mapped_rainfall.dec) * 10.0) / 10.0 AS avg_dec,
    ROUND(AVG(mapped_rainfall.annual) * 10.0) / 10.0 AS avg_annual;

-- 5. Flatten to Normalized (state, month_num, month_name, avg_rainfall) Format for Relational Joins
unpivoted_months = FOREACH state_monthly_avg GENERATE 
    state,
    FLATTEN(
        TOBAG(
            TOTUPLE(1, 'Jan', avg_jan),
            TOTUPLE(2, 'Feb', avg_feb),
            TOTUPLE(3, 'Mar', avg_mar),
            TOTUPLE(4, 'Apr', avg_apr),
            TOTUPLE(5, 'May', avg_may),
            TOTUPLE(6, 'Jun', avg_jun),
            TOTUPLE(7, 'Jul', avg_jul),
            TOTUPLE(8, 'Aug', avg_aug),
            TOTUPLE(9, 'Sep', avg_sep),
            TOTUPLE(10, 'Oct', avg_oct),
            TOTUPLE(11, 'Nov', avg_nov),
            TOTUPLE(12, 'Dec', avg_dec)
        )
    ) AS (month_num:int, month_name:chararray, avg_rainfall:double);

-- 6. Store Output
rmf /agri/output/rainfall_avg;
rmf /agri/output/rainfall_state_matrix;
STORE state_monthly_avg INTO '/agri/output/rainfall_state_matrix' USING PigStorage(',');
STORE unpivoted_months INTO '/agri/output/rainfall_avg' USING PigStorage(',');

-- Display preview
DUMP state_monthly_avg;
