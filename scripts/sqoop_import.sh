#!/usr/bin/env bash
# ===================================================================
# Script: sqoop_import.sh
# Project: Big Data Driven Analysis of Indian Agricultural Market Prices
# Description: Imports structured mandi prices from MySQL to HDFS via Sqoop.
#              Uses secure runtime password prompt (-P).
# ===================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MYSQL_HOST="localhost"
MYSQL_PORT="3306"
MYSQL_DB="agri_db"
MYSQL_USER="root"
TABLE_NAME="mandi_prices"
HDFS_TARGET_DIR="/agri/mandi"
CHECKPOINT_FILE="${SCRIPT_DIR}/.sqoop_last_record_id"

if [ -f "${CHECKPOINT_FILE}" ]; then
  LAST_VALUE="$(cat "${CHECKPOINT_FILE}")"
else
  LAST_VALUE="0"
fi

echo "=========================================================="
echo " Starting incremental Apache Sqoop Import: MySQL -> HDFS"
echo " Database: ${MYSQL_DB} | Table: ${TABLE_NAME}"
echo " HDFS Target Directory: ${HDFS_TARGET_DIR}"
echo " Record ID checkpoint: ${LAST_VALUE}"
echo "=========================================================="

if [ ! -f "${CHECKPOINT_FILE}" ] && hdfs dfs -ls "${HDFS_TARGET_DIR}/part*" >/dev/null 2>&1; then
  echo "ERROR: HDFS target already contains imported files but no local checkpoint exists."
  echo "Set up a clean initial target or restore the matching ${CHECKPOINT_FILE} checkpoint."
  exit 1
fi
if [ -f "${CHECKPOINT_FILE}" ] && ! hdfs dfs -ls "${HDFS_TARGET_DIR}/part*" >/dev/null 2>&1; then
  echo "ERROR: Local Sqoop checkpoint exists but HDFS import files are missing."
  echo "Restore the matching HDFS data or reset both the target and checkpoint deliberately."
  exit 1
fi

echo "[1/3] Ensuring HDFS target directory exists..."
hdfs dfs -mkdir -p "${HDFS_TARGET_DIR}"

echo "[2/3] Executing incremental sqoop import (Enter MySQL password when prompted)..."
PASSWORD_ARGS=(-P)
if [ -n "${SQOOP_PASSWORD_FILE:-}" ]; then
  PASSWORD_ARGS=(--password-file "${SQOOP_PASSWORD_FILE}")
fi

sqoop import \
  --connect "jdbc:mysql://${MYSQL_HOST}:${MYSQL_PORT}/${MYSQL_DB}?useSSL=false" \
  --username "${MYSQL_USER}" \
  "${PASSWORD_ARGS[@]}" \
  --table "${TABLE_NAME}" \
  --incremental append \
  --check-column record_id \
  --last-value "${LAST_VALUE}" \
  --append \
  --target-dir "${HDFS_TARGET_DIR}" \
  --as-textfile \
  --fields-terminated-by ',' \
  -m 1

# Derive the checkpoint from imported MySQL primary keys after Sqoop succeeds.
NEW_VALUE="$(hdfs dfs -cat "${HDFS_TARGET_DIR}/part*" | awk -F',' -v previous="${LAST_VALUE}" '
  $1 ~ /^[0-9]+$/ && $1 + 0 > maximum { maximum = $1 + 0 }
  END { if (maximum > previous) print maximum; else print previous }
')"
printf '%s\n' "${NEW_VALUE}" > "${CHECKPOINT_FILE}"

echo "[3/3] Verifying HDFS contents..."
hdfs dfs -ls "${HDFS_TARGET_DIR}"
ROW_COUNT="$(hdfs dfs -cat "${HDFS_TARGET_DIR}/part*" | wc -l)"
echo "----------------------------------------------------------"
echo " SUCCESS: HDFS now contains ${ROW_COUNT} imported rows in ${HDFS_TARGET_DIR}"
echo " Sample records in HDFS:"
hdfs dfs -cat "${HDFS_TARGET_DIR}/part*" | head -n 3
echo "----------------------------------------------------------"
