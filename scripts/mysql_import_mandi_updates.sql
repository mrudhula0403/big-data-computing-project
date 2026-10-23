-- Import newly downloaded mandi rows without dropping the existing table.
-- Run from scripts/ with: mysql --local-infile=1 -u root -p < mysql_import_mandi_updates.sql
USE agri_db;

CREATE TEMPORARY TABLE mandi_prices_stage LIKE mandi_prices;

LOAD DATA LOCAL INFILE '../data/mandi_prices.csv'
IGNORE INTO TABLE mandi_prices_stage
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

INSERT INTO mandi_prices (
    state, district, market, commodity, variety, grade, arrival_date,
    min_price, max_price, modal_price
)
SELECT staged.state, staged.district, staged.market, staged.commodity,
       staged.variety, staged.grade, staged.arrival_date,
       staged.min_price, staged.max_price, staged.modal_price
FROM (
    SELECT DISTINCT state, district, market, commodity, variety, grade,
           arrival_date, min_price, max_price, modal_price
    FROM mandi_prices_stage
) AS staged
WHERE NOT EXISTS (
    SELECT 1
    FROM mandi_prices AS existing
    WHERE existing.state = staged.state
      AND existing.district = staged.district
      AND existing.market = staged.market
      AND existing.commodity = staged.commodity
      AND existing.variety <=> staged.variety
      AND existing.grade <=> staged.grade
      AND existing.arrival_date = staged.arrival_date
);

SELECT ROW_COUNT() AS newly_inserted_rows;
