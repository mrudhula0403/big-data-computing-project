#!/usr/bin/env python3
"""Export real Hive and Pig results as dashboard JSON."""

import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "dashboard" / "data"


def hive_rows(query):
    result = subprocess.run(
        ["hive", "-S", "-e", "USE agri_warehouse; " + query],
        check=True,
        capture_output=True,
        text=True,
    )
    return [line.split("\t") for line in result.stdout.splitlines() if line.strip()]


def number(value, integer=False):
    parsed = float(value)
    return int(parsed) if integer else parsed


def write(name, value):
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / name).write_text(
        json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )


def export_hive(name, query, fields, converters):
    rows = []
    for row in hive_rows(query):
        if len(row) != len(fields):
            raise ValueError(f"{name}: expected {len(fields)} columns, received {len(row)}")
        rows.append({field: convert(value) for field, convert, value in zip(fields, converters, row)})
    write(name, rows)


def main():
    export_hive(
        "mandi_records.json",
        "SELECT state, district, market, commodity, variety, grade, arrival_date, "
        "min_price, max_price, modal_price FROM hive_mandi_prices",
        ["state", "district", "market", "commodity", "variety", "grade", "arrival_date",
         "min_price", "max_price", "modal_price"],
        [str, str, str, str, str, str, str, number, number, number],
    )
    export_hive(
        "crop_prices.json",
        "SELECT commodity, MIN(min_price), AVG(modal_price), MAX(max_price), COUNT(*) "
        "FROM hive_mandi_prices GROUP BY commodity",
        ["crop", "min_price", "modal_price", "max_price", "records"],
        [str, number, number, number, lambda value: number(value, True)],
    )
    export_hive(
        "season_trends.json",
        "SELECT CASE WHEN CAST(SUBSTR(arrival_date,6,2) AS INT) IN (6,7,8,9,10) "
        "THEN 'Kharif' WHEN CAST(SUBSTR(arrival_date,6,2) AS INT) IN (11,12,1,2,3) "
        "THEN 'Rabi' ELSE 'Zaid' END, commodity, AVG(modal_price) "
        "FROM hive_mandi_prices GROUP BY CASE WHEN CAST(SUBSTR(arrival_date,6,2) AS INT) "
        "IN (6,7,8,9,10) THEN 'Kharif' WHEN CAST(SUBSTR(arrival_date,6,2) AS INT) "
        "IN (11,12,1,2,3) THEN 'Rabi' ELSE 'Zaid' END, commodity",
        ["season", "crop", "avg_modal_price"],
        [str, str, number],
    )
    export_hive(
        "district_comparison.json",
        "SELECT district, commodity, AVG(modal_price) FROM hive_mandi_prices "
        "GROUP BY district, commodity",
        ["district", "crop", "avg_modal_price"],
        [str, str, number],
    )
    heatmap_rows = hive_rows(
        "SELECT state, commodity, AVG(modal_price) FROM hive_mandi_prices "
        "GROUP BY state, commodity"
    )
    heatmap = {"states": [], "commodities": [], "data": {}}
    for state, commodity, average in heatmap_rows:
        if state not in heatmap["states"]:
            heatmap["states"].append(state)
        if commodity not in heatmap["commodities"]:
            heatmap["commodities"].append(commodity)
        heatmap["data"].setdefault(state, {})[commodity] = number(average)
    heatmap["states"].sort()
    heatmap["commodities"].sort()
    write("state_commodity_heatmap.json", heatmap)
    export_hive(
        "price_volatility.json",
        "SELECT commodity, AVG(modal_price), STDDEV_POP(modal_price), "
        "CASE WHEN AVG(modal_price) = 0 THEN NULL "
        "ELSE STDDEV_POP(modal_price) / AVG(modal_price) END, COUNT(*) "
        "FROM hive_mandi_prices GROUP BY commodity",
        ["crop", "mean_modal_price", "std_modal_price", "coefficient_of_variation", "records"],
        [str, number, lambda value: number(value), lambda value: None if value == "NULL" else number(value),
         lambda value: number(value, True)],
    )
    export_hive(
        "rainfall_vs_price.json",
        "SELECT r.state, r.month_name, r.month_num, r.avg_rainfall, AVG(m.modal_price) "
        "FROM hive_mandi_prices m JOIN hive_monthly_rainfall r "
        "ON LOWER(TRIM(m.state)) = LOWER(TRIM(r.state)) "
        "AND CAST(SUBSTR(m.arrival_date,6,2) AS INT) = r.month_num "
        "GROUP BY r.state, r.month_name, r.month_num, r.avg_rainfall "
        "ORDER BY r.month_num, r.state",
        ["state", "month", "month_num", "rainfall_mm", "avg_modal_price"],
        [str, str, lambda value: number(value, True), number, number],
    )
    count_rows = hive_rows("SELECT COUNT(*) FROM hive_mandi_prices")
    if len(count_rows) != 1 or len(count_rows[0]) != 1:
        raise ValueError("Hive returned an invalid mandi row count")
    write(
        "pipeline_meta.json",
        {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "mandi_records": number(count_rows[0][0], True),
        },
    )

    result = subprocess.run(
        ["hdfs", "dfs", "-cat", "/agri/output/keywords/part*"],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode:
        (OUTPUT / "keyword_frequencies.json").unlink(missing_ok=True)
    else:
        keywords = []
        for line in result.stdout.splitlines():
            columns = line.rsplit(",", 1)
            if len(columns) == 2 and columns[1].strip().isdigit():
                keywords.append({"keyword": columns[0], "frequency": int(columns[1].strip())})
        write("keyword_frequencies.json", keywords)


if __name__ == "__main__":
    main()
