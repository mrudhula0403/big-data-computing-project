#!/usr/bin/env python3
"""Fetch and safely merge real mandi records from the data.gov.in API."""

import argparse
import csv
import io
import json
import os
import re
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
STATE_FILE = ROOT / "dashboard" / "data" / "production_states.json"
DEFAULT_OUTPUT = ROOT / "data" / "mandi_prices.csv"
RESOURCE_ID = "9ef84268-d588-465a-a308-a864a43d0070"
API_URL = f"https://api.data.gov.in/resource/{RESOURCE_ID}"
PAGE_SIZE = 1000
OUTPUT_FIELDS = [
    "State",
    "District",
    "Market",
    "Commodity",
    "Variety",
    "Grade",
    "Arrival_Date",
    "Min_x0020_Price",
    "Max_x0020_Price",
    "Modal_x0020_Price",
]
FIELD_ALIASES = {
    "state": {"state"},
    "district": {"district"},
    "market": {"market"},
    "commodity": {"commodity"},
    "variety": {"variety"},
    "grade": {"grade"},
    "arrival_date": {"arrivaldate", "date"},
    "min_price": {"minprice", "minx0020price"},
    "max_price": {"maxprice", "maxx0020price"},
    "modal_price": {"modalprice", "modalx0020price"},
}
STATE_ALIASES = {
    "andaman and nicobar": "Andaman and Nicobar Islands",
    "chattisgarh": "Chhattisgarh",
    "keralam": "Kerala",
    "pondicherry": "Puducherry",
}
REQUIRED_FIELDS = {
    "state",
    "district",
    "market",
    "commodity",
    "arrival_date",
    "min_price",
    "max_price",
    "modal_price",
}


class FetchError(Exception):
    """Raised when an API response cannot safely be used."""


def normalize_header(value):
    return re.sub(r"[^a-z0-9]", "", value.strip().lower())


def field_mapping(headers):
    normalized = {normalize_header(header): header for header in headers}
    mapping = {}
    for canonical, aliases in FIELD_ALIASES.items():
        source = next((normalized[alias] for alias in aliases if alias in normalized), None)
        if source is not None:
            mapping[canonical] = source
    missing = REQUIRED_FIELDS - mapping.keys()
    if missing:
        raise FetchError(
            "The API response is missing required CSV columns: "
            + ", ".join(sorted(missing))
        )
    return mapping


def canonical_record(row, mapping, context):
    record = {
        field: (row.get(source) or "").strip()
        for field, source in mapping.items()
    }
    for field in ("variety", "grade"):
        record.setdefault(field, "")
    record["state"] = STATE_ALIASES.get(record["state"].casefold(), record["state"])

    if any(not record.get(field) for field in ("state", "district", "market", "commodity")):
        raise FetchError(f"{context}: a required text field is empty")
    try:
        parsed_date = None
        for date_format in ("%d/%m/%Y", "%Y-%m-%d", "%Y-%m-%d %H:%M:%S"):
            try:
                parsed_date = datetime.strptime(record["arrival_date"], date_format)
                break
            except ValueError:
                continue
        if parsed_date is None:
            raise ValueError("unsupported date format")
        record["arrival_date"] = parsed_date.strftime("%d/%m/%Y")

        for field in ("min_price", "max_price", "modal_price"):
            record[field] = float(record[field].replace(",", ""))
            if record[field] < 0:
                raise ValueError(f"{field} is negative")
        if record["min_price"] > record["max_price"]:
            raise ValueError("minimum price exceeds maximum price")
    except (TypeError, ValueError) as exc:
        raise FetchError(f"{context}: invalid mandi date or price ({exc})") from exc
    return record


def fetch_page(state, offset, api_key):
    params = urlencode(
        {
            "api-key": api_key,
            "format": "csv",
            "limit": PAGE_SIZE,
            "offset": offset,
            "filters[state]": state,
        }
    )
    request = Request(
        f"{API_URL}?{params}",
        headers={"User-Agent": "AgriBigDataDashboard/1.0"},
    )
    try:
        with urlopen(request, timeout=60) as response:
            content = response.read().decode("utf-8-sig")
    except HTTPError as exc:
        raise FetchError(
            f"API request failed for {state} (HTTP {exc.code}: {exc.reason})"
        ) from exc
    except URLError as exc:
        raise FetchError(f"API request failed for {state}: {exc.reason}") from exc
    except TimeoutError as exc:
        raise FetchError(f"API request timed out for {state}") from exc

    if not content.strip():
        raise FetchError(f"API returned an empty response for {state}")
    try:
        reader = csv.DictReader(io.StringIO(content))
        if not reader.fieldnames:
            raise FetchError(f"API response for {state} has no CSV header")
        mapping = field_mapping(reader.fieldnames)
        records = [
            canonical_record(row, mapping, f"{state}, row {index}")
            for index, row in enumerate(reader, start=2)
        ]
    except csv.Error as exc:
        raise FetchError(f"API response for {state} is not valid CSV: {exc}") from exc
    return records


def record_key(record):
    return tuple(
        record[field].strip().casefold()
        for field in (
            "state",
            "district",
            "market",
            "commodity",
            "variety",
            "grade",
            "arrival_date",
        )
    )


def as_output_row(record):
    return {
        "State": record["state"],
        "District": record["district"],
        "Market": record["market"],
        "Commodity": record["commodity"],
        "Variety": record["variety"],
        "Grade": record["grade"],
        "Arrival_Date": record["arrival_date"],
        "Min_x0020_Price": record["min_price"],
        "Max_x0020_Price": record["max_price"],
        "Modal_x0020_Price": record["modal_price"],
    }


def load_existing(path):
    if not path.exists():
        return []
    try:
        with path.open("r", encoding="utf-8-sig", newline="") as source:
            reader = csv.DictReader(source)
            if not reader.fieldnames:
                raise FetchError(f"Existing source file has no CSV header: {path}")
            mapping = field_mapping(reader.fieldnames)
            return [
                canonical_record(row, mapping, f"{path}, row {index}")
                for index, row in enumerate(reader, start=2)
            ]
    except (OSError, csv.Error) as exc:
        raise FetchError(f"Could not read existing mandi source file {path}: {exc}") from exc


def load_csv(path):
    try:
        with path.open("r", encoding="utf-8-sig", newline="") as source:
            reader = csv.DictReader(source)
            if not reader.fieldnames:
                raise FetchError(f"Input CSV has no header: {path}")
            mapping = field_mapping(reader.fieldnames)
            return [
                canonical_record(row, mapping, f"{path}, row {index}")
                for index, row in enumerate(reader, start=2)
            ]
    except (OSError, csv.Error) as exc:
        raise FetchError(f"Could not read mandi CSV {path}: {exc}") from exc


def write_atomically(path, records):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            newline="",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as output:
            temp_path = Path(output.name)
            writer = csv.DictWriter(output, fieldnames=OUTPUT_FIELDS)
            writer.writeheader()
            writer.writerows(records)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temp_path, path)
    except OSError as exc:
        raise FetchError(f"Could not safely write mandi source file {path}: {exc}") from exc
    finally:
        if temp_path is not None and temp_path.exists():
            temp_path.unlink()


def write_dashboard_records(records):
    output_dir = ROOT / "dashboard" / "data"
    output_dir.mkdir(parents=True, exist_ok=True)
    dashboard_records = [
        {
            "state": row["State"],
            "district": row["District"],
            "market": row["Market"],
            "commodity": row["Commodity"],
            "variety": row["Variety"],
            "grade": row["Grade"],
            "arrival_date": row["Arrival_Date"],
            "min_price": float(row["Min_x0020_Price"]),
            "max_price": float(row["Max_x0020_Price"]),
            "modal_price": float(row["Modal_x0020_Price"]),
            "spread": float(row["Max_x0020_Price"]) - float(row["Min_x0020_Price"]),
        }
        for row in records
    ]
    heatmap_values = {}
    for row in dashboard_records:
        state = row["state"]
        commodity = row["commodity"]
        cell = heatmap_values.setdefault(state, {}).setdefault(commodity, [])
        cell.append(row["modal_price"])
    heatmap = {
        "states": sorted(heatmap_values),
        "commodities": sorted(
            {commodity for state_data in heatmap_values.values() for commodity in state_data}
        ),
        "data": {
            state: {
                commodity: sum(prices) / len(prices)
                for commodity, prices in state_data.items()
            }
            for state, state_data in heatmap_values.items()
        },
    }

    for filename, value in (
        ("mandi_records.json", dashboard_records),
        ("state_commodity_heatmap.json", heatmap),
    ):
        output_path = output_dir / filename
        temp_path = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                dir=output_dir,
                prefix=f".{output_path.name}.",
                suffix=".tmp",
                delete=False,
            ) as output:
                temp_path = Path(output.name)
                json.dump(value, output, ensure_ascii=False, indent=2, allow_nan=False)
                output.write("\n")
                output.flush()
                os.fsync(output.fileno())
            os.replace(temp_path, output_path)
        except (OSError, TypeError, ValueError) as exc:
            raise FetchError(
                f"Could not safely update dashboard data {output_path}: {exc}"
            ) from exc
        finally:
            if temp_path is not None and temp_path.exists():
                temp_path.unlink()


def main():
    parser = argparse.ArgumentParser(
        description="Fetch and merge real mandi prices using a data.gov.in API key."
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"CSV to merge into (default: {DEFAULT_OUTPUT})",
    )
    parser.add_argument(
        "--input",
        type=Path,
        help="Import a downloaded CSV instead of fetching the API (API key not required).",
    )
    args = parser.parse_args()

    if args.input:
        if not args.input.is_file():
            parser.error(f"Input CSV does not exist: {args.input}")
        fetched = load_csv(args.input)
        print(f"Validated {len(fetched):,} rows from {args.input}.")
    else:
        api_key = os.environ.get("DATA_GOV_IN_API_KEY", "").strip()
        if not api_key or api_key == "PASTE_YOUR_API_KEY":
            parser.error(
                "Set DATA_GOV_IN_API_KEY in your local environment or provide --input CSV."
            )
        if not STATE_FILE.is_file():
            parser.error(f"State list is missing: {STATE_FILE}")

        try:
            states = json.loads(STATE_FILE.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            parser.error(f"Could not read the exported production state list: {exc}")
        if not isinstance(states, list) or not all(isinstance(state, str) for state in states):
            parser.error(f"Invalid state list in {STATE_FILE}")

        fetched = []
        for index, state in enumerate(states):
            print(f"Fetching {state} ({index + 1}/{len(states)})...")
            offset = 0
            while True:
                page = fetch_page(state, offset, api_key)
                fetched.extend(page)
                print(f"  offset {offset}: {len(page)} records")
                if len(page) < PAGE_SIZE:
                    break
                offset += PAGE_SIZE
                time.sleep(0.5)

    if not fetched:
        print("No mandi records were found; the existing CSV was left unchanged.")
        return 0

    merged = {}
    for canonical in load_existing(args.output):
        row = as_output_row(canonical)
        merged[record_key(canonical)] = row
    for record in fetched:
        merged[record_key(record)] = as_output_row(record)

    merged_rows = list(merged.values())
    write_atomically(args.output, merged_rows)
    if args.output.resolve() == DEFAULT_OUTPUT.resolve():
        write_dashboard_records(merged_rows)
    states_with_records = {record["state"] for record in fetched}
    print(
        f"Imported {len(fetched):,} rows across {len(states_with_records)} states; "
        f"merged source now contains {len(merged):,} unique mandi rows at {args.output}."
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except FetchError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
