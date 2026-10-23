#!/usr/bin/env bash
# ===================================================================
# Script: hdfs_setup.sh
# Project: Big Data Driven Analysis of Indian Agricultural Market Prices
# Description: Creates HDFS directory structure and uploads real rainfall &
#              farmer query datasets to HDFS.
# ===================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="${SCRIPT_DIR}/../data"

echo "=========================================================="
echo " Setting up HDFS Directory Hierarchy for Agriculture Data"
echo "=========================================================="

# 1. Create HDFS directories
echo "[1/3] Creating HDFS directories..."
hdfs dfs -mkdir -p /agri
hdfs dfs -mkdir -p /agri/mandi
hdfs dfs -mkdir -p /agri/rainfall
hdfs dfs -mkdir -p /agri/queries
hdfs dfs -mkdir -p /agri/output/keywords
hdfs dfs -mkdir -p /agri/output/rainfall_avg

# 2. Upload Rainfall Dataset
echo "[2/3] Uploading Rainfall in India dataset..."
if [ -f "${DATA_DIR}/rainfall_india.csv" ]; then
    RAINFALL_SRC="${DATA_DIR}/rainfall_india.csv"
elif [ -f "/data/rainfall_india.csv" ]; then
    RAINFALL_SRC="/data/rainfall_india.csv"
else
    echo "ERROR: rainfall_india.csv not found in ${DATA_DIR} or /data!"
    exit 1
fi

hdfs dfs -put -f "${RAINFALL_SRC}" /agri/rainfall/rainfall_india.csv
echo "  -> Uploaded ${RAINFALL_SRC} to /agri/rainfall/rainfall_india.csv"

# 3. Upload Farmer Queries Dataset
echo "[3/3] Uploading Farmers Call Query dataset..."
if [ -f "${DATA_DIR}/farmer_queries.csv" ]; then
    QUERIES_SRC="${DATA_DIR}/farmer_queries.csv"
elif [ -f "/data/farmer_queries.csv" ]; then
    QUERIES_SRC="/data/farmer_queries.csv"
else
    echo "ERROR: farmer_queries.csv not found in ${DATA_DIR} or /data!"
    exit 1
fi

hdfs dfs -put -f "${QUERIES_SRC}" /agri/queries/farmer_queries.csv
echo "  -> Uploaded ${QUERIES_SRC} to /agri/queries/farmer_queries.csv"

# Verification
echo "----------------------------------------------------------"
echo " HDFS Directory Structure Verification:"
hdfs dfs -ls -R /agri
echo "----------------------------------------------------------"
echo " SUCCESS: HDFS setup and real dataset ingestion complete!"
