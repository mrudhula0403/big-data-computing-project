#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "[1/8] Refresh HDFS source uploads"
bash "${SCRIPT_DIR}/hdfs_setup.sh"

echo "[2/8] Incremental MySQL → HDFS import"
bash "${SCRIPT_DIR}/sqoop_import.sh"

echo "[3/8] Pig multilingual keyword processing"
pig -x mapreduce "${SCRIPT_DIR}/keywords.pig"

echo "[4/8] Pig rainfall processing"
pig -x mapreduce "${SCRIPT_DIR}/rainfall.pig"

echo "[5/8] Hive partition refresh and analysis"
hive -f "${SCRIPT_DIR}/analysis.hql"

echo "[6/8] Export Hadoop analytics"
bash "${SCRIPT_DIR}/export_results.sh"

echo "[7/8] Refresh MongoDB aggregations"
node "${SCRIPT_DIR}/mongo_import.js"

echo "[8/8] Forecasts and source-file analysis"
python3 "${SCRIPT_DIR}/predict.py"

echo "Refresh completed at $(date --iso-8601=seconds)"
