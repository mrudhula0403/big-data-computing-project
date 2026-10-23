-- ===================================================================
-- Script: keywords.pig
-- Project: Big Data Driven Analysis of Indian Agricultural Market Prices
-- Description: Apache Pig Latin script to clean unstructured text from
--              farmer call queries and extract frequencies of critical
--              agricultural keywords in English, transliterated Hindi,
--              Devanagari, and Tamil.
--              Tokenizes and tallies across BOTH 'questions' and 'answers' columns.
--
-- Run with: pig -x mapreduce keywords.pig
--           or in local test mode: pig -x local keywords.pig
-- ===================================================================

-- 1. Load Raw Text Lines from HDFS
-- Using TextLoader ensures both 'questions' and 'answers' columns are ingested
-- regardless of embedded commas or quotes in conversational responses.
raw_queries = LOAD '/agri/queries/farmer_queries.csv' USING TextLoader() AS (line:chararray);

-- 2. Filter out CSV header line
no_header = FILTER raw_queries BY NOT (line MATCHES '^questions,answers.*' OR line MATCHES '^questions.*');

-- 3. Clean text: convert to lowercase and replace punctuation/delimiters with space
cleaned_text = FOREACH no_header GENERATE 
    LOWER(REPLACE(line, '[,\\.\\?!\\(\\)\"\'\\-\\/\\\\;:\t@#$%^&*~`]', ' ')) AS clean_line;

-- 4. Tokenize cleaned text into individual word bags across both columns
word_bags = FOREACH cleaned_text GENERATE 
    FLATTEN(TOKENIZE(clean_line)) AS word;

-- 5. Match source-language tokens without replacing or inventing query data.
target_words = FILTER word_bags BY 
    (word == 'rainfall' OR 
     word == 'rain' OR
     word == 'precipitation' OR
     word == 'barish' OR word == 'barsaat' OR word == 'varsha' OR word == 'vrishti' OR
     word == 'बारिश' OR word == 'वर्षा' OR word == 'बरसात' OR
     word == 'மழை' OR word == 'மழைப்பொழிவு' OR
     word == 'drought' OR word == 'sukha' OR word == 'akaal' OR
     word == 'सूखा' OR word == 'अकाल' OR word == 'வறட்சி' OR
     word == 'flood' OR word == 'baadh' OR word == 'बाढ़' OR word == 'வெள்ளம்' OR
     word == 'pest' OR word == 'keet' OR word == 'keeda' OR
     word == 'कीट' OR word == 'பூச்சி' OR
     word == 'yield' OR word == 'upaj' OR word == 'paidavar' OR
     word == 'उपज' OR word == 'पैदावार' OR word == 'விளைச்சல்' OR word == 'மகசூல்');

-- 6. Group by Keyword
grouped_keywords = GROUP target_words BY word;

-- 7. Compute Frequency Count for each keyword
keyword_counts = FOREACH grouped_keywords GENERATE 
    group AS keyword, 
    COUNT(target_words) AS frequency;

-- 8. Order Results by Frequency in Descending Order
sorted_keywords = ORDER keyword_counts BY frequency DESC;

-- 9. Output & Store Results in HDFS
rmf /agri/output/keywords;
STORE sorted_keywords INTO '/agri/output/keywords' USING PigStorage(',');

-- Print results to terminal console for live verification
DUMP sorted_keywords;
