#!/usr/bin/env python3
"""Build forecasts and supporting analyses from the four source CSV files."""

import json
import math
import re
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, mean_squared_error
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import OneHotEncoder


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
OUTPUT = ROOT / "dashboard" / "data"


def write_json(name, value):
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / name).write_text(
        json.dumps(
            value,
            ensure_ascii=False,
            indent=2,
            allow_nan=False,
            default=lambda item: item.item() if hasattr(item, "item") else str(item),
        ) + "\n",
        encoding="utf-8",
    )


def metric_pack(actual, predicted):
    actual_series = pd.Series(actual, dtype="float64")
    predicted_series = pd.Series(predicted, dtype="float64")
    errors = actual_series - predicted_series
    nonzero = actual_series.abs() > 0
    return {
        "mae": float(mean_absolute_error(actual_series, predicted_series)),
        "rmse": float(math.sqrt(mean_squared_error(actual_series, predicted_series))),
        "mape": (
            float((errors[nonzero].abs() / actual_series[nonzero].abs()).mean() * 100)
            if nonzero.any()
            else None
        ),
        "test_points": int(len(actual_series)),
    }


def forecast_production():
    aggregation_path = OUTPUT / "production_yearly_state_crop_season.json"
    if not aggregation_path.is_file():
        raise FileNotFoundError(
            f"{aggregation_path} is missing; run mongo_import.js to create the MongoDB aggregation first"
        )
    production_series = pd.DataFrame(json.loads(aggregation_path.read_text(encoding="utf-8")))
    if production_series.empty:
        raise ValueError("MongoDB returned no yearly production aggregation rows")
    production_series["year"] = pd.to_numeric(production_series["year"], errors="coerce")
    production_series["production"] = pd.to_numeric(production_series["production"], errors="coerce")
    production_series["area"] = pd.to_numeric(production_series["area"], errors="coerce")
    production_series = production_series.dropna(
        subset=["state", "crop", "season", "year", "production"]
    )
    yearly = (
        production_series.groupby(["state", "crop", "season", "year"], as_index=False)
        .agg(production=("production", "sum"), area=("area", "sum"))
        .sort_values("year")
    )
    group_columns = ["state", "crop", "season"]
    years = sorted(yearly["year"].unique())
    final_year = int(max(years))
    held_year_count = min(3, max(2, len(years) - 2)) if len(years) >= 4 else 0
    metrics = {}
    forecast_rows = []

    def make_model(estimator):
        encoder = ColumnTransformer(
            [
                ("categories", OneHotEncoder(handle_unknown="ignore"), group_columns),
                ("year", "passthrough", ["year"]),
            ]
        )
        return make_pipeline(encoder, estimator)

    if held_year_count:
        test_years = years[-held_year_count:]
        test_start = test_years[0]
        train = yearly[yearly["year"] < test_start]
        test = yearly[yearly["year"].isin(test_years)].copy()
        if len(train) >= 2 and not test.empty:
            models = {
                "linear_regression": make_model(LinearRegression()),
                "random_forest": make_model(
                    RandomForestRegressor(
                        n_estimators=150,
                        min_samples_leaf=2,
                        random_state=42,
                        n_jobs=-1,
                    )
                ),
            }
            features = group_columns + ["year"]
            for name, model in models.items():
                model.fit(train[features], train["production"])
                test[f"{name}_prediction"] = model.predict(test[features])

            baseline = []
            valid_indices = []
            history_by_group = {
                key if isinstance(key, tuple) else (key,): group
                for key, group in yearly.groupby(group_columns, sort=False)
            }
            for index, row in test.iterrows():
                key = tuple(row[column] for column in group_columns)
                history = history_by_group.get(key)
                previous = (
                    history[history["year"] < row["year"]]
                    .sort_values("year")
                    .tail(1)
                    if history is not None
                    else pd.DataFrame()
                )
                if not previous.empty:
                    valid_indices.append(index)
                    baseline.append(float(previous.iloc[0]["production"]))
            comparable = test.loc[valid_indices]
            if not comparable.empty:
                actual = comparable["production"].tolist()
                metrics["linear_regression"] = metric_pack(
                    actual, comparable["linear_regression_prediction"].tolist()
                )
                metrics["random_forest"] = metric_pack(
                    actual, comparable["random_forest_prediction"].tolist()
                )
                metrics["last_year_repeated"] = metric_pack(actual, baseline)

    feature_rows = group_columns
    latest = yearly.sort_values("year").groupby(feature_rows, as_index=False).tail(1)
    future_years = [final_year + offset for offset in range(1, 4)]
    future = pd.concat(
        [
            latest[feature_rows].assign(year=year)
            for year in future_years
        ],
        ignore_index=True,
    )
    if not yearly.empty:
        linear_model = make_model(LinearRegression()).fit(yearly[group_columns + ["year"]], yearly["production"])
        forest_model = make_model(
            RandomForestRegressor(
                n_estimators=150,
                min_samples_leaf=2,
                random_state=42,
                n_jobs=-1,
            )
        ).fit(yearly[group_columns + ["year"]], yearly["production"])
        predictions = {
            "linear_regression": linear_model.predict(future[group_columns + ["year"]]),
            "random_forest": forest_model.predict(future[group_columns + ["year"]]),
        }
        key_index = pd.MultiIndex.from_frame(future[group_columns])
        key_map = latest.set_index(group_columns)["production"]
        naive = [float(key_map.loc[key]) for key in key_index]
        predictions["last_year_repeated"] = naive
        for model_name, values in predictions.items():
            result = future[["year"]].copy()
            result["model"] = model_name
            result["production"] = [max(0.0, float(value)) for value in values]
            totals = result.groupby("year", as_index=False)["production"].sum()
            forecast_rows.extend(totals.to_dict(orient="records"))
            for row in forecast_rows[-len(totals):]:
                row["model"] = model_name

    actual_by_year = (
        yearly.groupby("year", as_index=False)["production"].sum()
        .rename(columns={"year": "year", "production": "production"})
    )
    write_json(
        "forecast.json",
        {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "estimate_label": "Estimated, not guaranteed",
            "actual": actual_by_year.to_dict(orient="records"),
            "forecasts": forecast_rows,
            "metrics": metrics,
        },
    )
    return yearly


def rainfall_state_years():
    rain = pd.read_csv(DATA / "rainfall_india.csv")
    state_rules = state_rules_mapping()

    def mapped_state(subdivision):
        normalized = str(subdivision).upper()
        for pattern, state in state_rules:
            if re.search(pattern, normalized):
                return state
        return str(subdivision).strip()

    rain["state"] = rain["SUBDIVISION"].map(mapped_state)
    rain["year"] = pd.to_numeric(rain["YEAR"], errors="coerce")
    rain["rainfall_mm"] = pd.to_numeric(rain["ANNUAL"], errors="coerce")
    return rain.dropna(subset=["year", "rainfall_mm"]).groupby(["state", "year"], as_index=False)["rainfall_mm"].mean()


def state_rules_mapping():
    return [
        (r"MAHARASHTRA|MARATHWADA|VIDARBHA|KONKAN", "Maharashtra"),
        (r"ANDHRA|RAYALSEEMA", "Andhra Pradesh"),
        (r"PUNJAB", "Punjab"),
        (r"UTTAR PRADESH", "Uttar Pradesh"),
        (r"TAMIL NADU", "Tamil Nadu"),
        (r"HARYANA|DELHI", "Haryana"),
        (r"GUJARAT|SAURASHTRA", "Gujarat"),
        (r"KARNATAKA", "Karnataka"),
        (r"MADHYA PRADESH", "Madhya Pradesh"),
        (r"RAJASTHAN", "Rajasthan"),
        (r"ORISSA|ODISHA", "Odisha"),
        (r"BIHAR", "Bihar"),
        (r"JHARKHAND", "Jharkhand"),
        (r"BENGAL", "West Bengal"),
        (r"KERALA", "Kerala"),
        (r"ASSAM", "Assam"),
    ]


def rainfall_state_months():
    rain = pd.read_csv(DATA / "rainfall_india.csv")
    state_rules = state_rules_mapping()

    def mapped_state(subdivision):
        normalized = str(subdivision).upper()
        for pattern, state in state_rules:
            if re.search(pattern, normalized):
                return state
        return str(subdivision).strip()

    rain["state"] = rain["SUBDIVISION"].map(mapped_state)
    month_columns = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
    return (
        rain[["state", *month_columns]]
        .melt(id_vars=["state"], var_name="month_name", value_name="rainfall_mm")
        .assign(rainfall_mm=lambda frame: pd.to_numeric(frame["rainfall_mm"], errors="coerce"))
        .dropna(subset=["rainfall_mm"])
        .groupby(["state", "month_name"], as_index=False)["rainfall_mm"].mean()
    )


def build_production_rainfall_correlation(yearly):
    rainfall = rainfall_state_years()
    state_year_production = yearly.groupby(["state", "year"], as_index=False)["production"].sum()
    joined = state_year_production.merge(rainfall, on=["state", "year"], how="inner")
    state_results = []
    for state, group in joined.groupby("state"):
        correlation = group["rainfall_mm"].corr(group["production"]) if len(group) > 1 else float("nan")
        state_results.append({
            "state": state,
            "correlation": None if pd.isna(correlation) else float(correlation),
            "years": int(len(group)),
            "production_total": float(group["production"].sum()),
            "avg_annual_rainfall_mm": float(group["rainfall_mm"].mean()),
        })
    national_production_mean = (
        sum(row["production_total"] for row in state_results) / len(state_results)
        if state_results
        else 0
    )
    national_rainfall_mean = (
        sum(row["avg_annual_rainfall_mm"] for row in state_results) / len(state_results)
        if state_results
        else 0
    )
    results = [
        {
            **row,
            "production_gap_from_mean": row["production_total"] - national_production_mean,
            "rainfall_gap_from_mean_mm": row["avg_annual_rainfall_mm"] - national_rainfall_mean,
        }
        for row in state_results
    ]
    write_json("rainfall_production_correlation.json", results)


def build_price_analytics():
    mandi = pd.read_csv(DATA / "mandi_prices.csv")
    mandi["Modal_x0020_Price"] = pd.to_numeric(mandi["Modal_x0020_Price"], errors="coerce")
    prices = mandi.dropna(subset=["Commodity", "Modal_x0020_Price"])
    volatility = prices.groupby("Commodity")["Modal_x0020_Price"].agg(
        mean="mean",
        std=lambda values: values.std(ddof=0),
        records="count",
    ).reset_index()
    volatility["coefficient_of_variation"] = volatility.apply(
        lambda row: (
            float(row["std"] / row["mean"])
            if row["mean"] and pd.notna(row["std"])
            else None
        ),
        axis=1,
    )
    volatility = volatility.rename(
        columns={
            "Commodity": "crop",
            "mean": "mean_modal_price",
            "std": "std_modal_price",
        }
    )
    write_json("price_volatility.json", volatility.to_dict(orient="records"))

    parsed_dates = pd.to_datetime(mandi["Arrival_Date"], dayfirst=True, errors="coerce").dropna()
    date_count = int(parsed_dates.dt.date.nunique())
    month_count = int(parsed_dates.dt.to_period("M").nunique())
    price_forecast = {
        "distinct_dates": date_count,
        "distinct_months": month_count,
        "forecast": [],
        "message": "Not enough history for a price forecast" if month_count < 12 else None,
    }
    if month_count >= 12:
        dated = mandi.copy()
        dated["date"] = pd.to_datetime(dated["Arrival_Date"], dayfirst=True, errors="coerce")
        monthly = dated.dropna(subset=["date", "Modal_x0020_Price"]).assign(
            month=lambda frame: frame["date"].dt.to_period("M")
        ).groupby("month")["Modal_x0020_Price"].mean()
        month_numbers = range(len(monthly))
        model = LinearRegression().fit(pd.Series(list(month_numbers)).to_numpy().reshape(-1, 1), monthly.to_numpy())
        predictions = model.predict([[len(monthly) + offset] for offset in range(3)])
        next_period = monthly.index[-1] + 1
        price_forecast["forecast"] = [
            {"month": str(next_period + offset), "modal_price": max(0.0, float(value))}
            for offset, value in enumerate(predictions)
        ]
    write_json("price_forecast.json", price_forecast)
    rain_months = rainfall_state_months()
    price_rows = mandi.copy()
    price_rows["arrival_month"] = pd.to_datetime(
        price_rows["Arrival_Date"], dayfirst=True, errors="coerce"
    ).dt.strftime("%b").str.upper()
    price_rows["Modal_x0020_Price"] = pd.to_numeric(price_rows["Modal_x0020_Price"], errors="coerce")
    price_by_state_month = price_rows.dropna(subset=["State", "arrival_month", "Modal_x0020_Price"])
    price_by_state_month = price_by_state_month.groupby(
        ["State", "arrival_month"], as_index=False
    )["Modal_x0020_Price"].mean().rename(
        columns={"State": "state", "arrival_month": "month_name", "Modal_x0020_Price": "avg_modal_price"}
    )
    joined = price_by_state_month.merge(rain_months, on=["state", "month_name"], how="inner")
    correlation = (
        joined["rainfall_mm"].corr(joined["avg_modal_price"])
        if len(joined) > 1
        else float("nan")
    )
    write_json(
        "rainfall_price_correlation.json",
        {
            "correlation": None if pd.isna(correlation) else float(correlation),
            "matched_state_months": int(len(joined)),
            "interpretation": "Pearson correlation across matched state-month averages from available source files.",
        },
    )
    return mandi, volatility


def build_rainfall_dashboard_data():
    rain = pd.read_csv(DATA / "rainfall_india.csv")
    months = {
        "JAN": "Jan", "FEB": "Feb", "MAR": "Mar", "APR": "Apr",
        "MAY": "May", "JUN": "Jun", "JUL": "Jul", "AUG": "Aug",
        "SEP": "Sep", "OCT": "Oct", "NOV": "Nov", "DEC": "Dec",
    }
    summary = {
        "subdivisions": sorted(rain["SUBDIVISION"].dropna().astype(str).unique().tolist()),
        "monthly_avgs": {},
    }
    for subdivision, group in rain.groupby("SUBDIVISION"):
        summary["monthly_avgs"][str(subdivision)] = {
            month_name: float(pd.to_numeric(group[column], errors="coerce").mean())
            for column, month_name in months.items()
            if pd.to_numeric(group[column], errors="coerce").notna().any()
        }
    write_json("rainfall_by_subdivision.json", summary)
    return rain


def build_production_dashboard_data(yearly):
    write_json(
        "production_by_year.json",
        yearly.groupby("year", as_index=False)["production"].sum()
        .rename(columns={"production": "total_production"})
        .to_dict(orient="records"),
    )
    write_json("production_states.json", sorted(yearly["state"].dropna().unique().tolist()))
    write_json(
        "production_by_season.json",
        yearly.groupby("season", as_index=False)
        .agg(total_production=("production", "sum"), total_area=("area", "sum"),
             records=("production", "count"))
        .to_dict(orient="records"),
    )
    write_json(
        "top_crops_production.json",
        yearly.groupby("crop", as_index=False)["production"].sum()
        .sort_values("production", ascending=False)
        .head(10)
        .rename(columns={"crop": "crop", "production": "total_production"})
        .to_dict(orient="records"),
    )


def build_insights(mandi, volatility, rain, yearly, row_counts):
    if mandi.empty or yearly.empty:
        (OUTPUT / "insights.json").unlink(missing_ok=True)
        return
    modal = pd.to_numeric(mandi["Modal_x0020_Price"], errors="coerce")
    highest = mandi.loc[modal.idxmax()]
    lowest = mandi.loc[modal.idxmin()]
    valid_volatility = volatility.dropna(subset=["coefficient_of_variation"])
    if valid_volatility.empty:
        (OUTPUT / "insights.json").unlink(missing_ok=True)
        return
    volatile = valid_volatility.sort_values("coefficient_of_variation", ascending=False).iloc[0]
    annual = pd.to_numeric(rain["ANNUAL"], errors="coerce")
    rainfall_avg = rain.assign(_annual=annual).groupby("SUBDIVISION")["_annual"].mean().dropna()
    if rainfall_avg.empty:
        (OUTPUT / "insights.json").unlink(missing_ok=True)
        return
    keyword_path = OUTPUT / "keyword_frequencies.json"
    keywords = json.loads(keyword_path.read_text(encoding="utf-8")) if keyword_path.is_file() else []
    if not keywords:
        (OUTPUT / "insights.json").unlink(missing_ok=True)
        return
    top_keyword = max(keywords, key=lambda row: row["frequency"])
    crop_production = yearly.groupby("crop")["production"].sum().sort_values(ascending=False)
    top_crop = crop_production.index[0]
    years = sorted(pd.to_numeric(rain["YEAR"], errors="coerce").dropna().unique().tolist())
    write_json(
        "insights.json",
        {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "mandi": {
                "total_records": int(len(mandi)),
                "unique_markets": int(mandi["Market"].nunique()),
                "unique_commodities": int(mandi["Commodity"].nunique()),
                "states_covered": int(mandi["State"].nunique()),
                "highest_priced": {
                    "commodity": str(highest["Commodity"]),
                    "modal_price": float(modal.loc[highest.name]),
                    "market": str(highest["Market"]),
                    "district": str(highest["District"]),
                    "state": str(highest["State"]),
                },
                "most_volatile": {
                    "commodity": str(volatile["crop"]),
                    "max_spread": float(volatile["std_modal_price"]),
                    "reason": "highest coefficient of variation across available modal prices",
                },
                "lowest_priced": {
                    "commodity": str(lowest["Commodity"]),
                    "modal_price": float(modal.loc[lowest.name]),
                },
            },
            "rainfall": {
                "total_rows": int(len(rain)),
                "subdivisions": int(rain["SUBDIVISION"].nunique()),
                "year_start": int(min(years)),
                "year_end": int(max(years)),
                "years_covered": int(len(years)),
                "highest_rainfall_subdivision": {
                    "name": str(rainfall_avg.idxmax()),
                    "annual_mm": float(rainfall_avg.max()),
                },
                "lowest_rainfall_subdivision": {
                    "name": str(rainfall_avg.idxmin()),
                    "annual_mm": float(rainfall_avg.min()),
                },
            },
            "production": {
                "total_records": int(row_counts["crop_production"]),
                "states": int(yearly["state"].nunique()),
                "year_start": int(yearly["year"].min()),
                "year_end": int(yearly["year"].max()),
                "top_crop": {
                    "name": str(top_crop),
                    "total_production_tonnes": float(crop_production.iloc[0]),
                },
            },
            "farmer_queries": {
                "total_records": int(row_counts["farmer_queries"]),
                "top_keyword": top_keyword,
                "all_keywords": keywords,
            },
        },
    )


def main():
    yearly = forecast_production()
    build_production_rainfall_correlation(yearly)
    mandi, volatility = build_price_analytics()
    rain = build_rainfall_dashboard_data()
    build_production_dashboard_data(yearly)
    import csv

    row_counts = {}
    for name, filename in (
        ("mandi_prices", "mandi_prices.csv"),
        ("rainfall_india", "rainfall_india.csv"),
        ("farmer_queries", "farmer_queries.csv"),
        ("crop_production", "crop_production.csv"),
    ):
        with (DATA / filename).open(encoding="utf-8", newline="") as dataset:
            row_counts[name] = sum(1 for _ in csv.reader(dataset)) - 1
    write_json("dataset_meta.json", {"generated_at": datetime.now(timezone.utc).isoformat(), "rows": row_counts})
    build_insights(mandi, volatility, rain, yearly, row_counts)


if __name__ == "__main__":
    main()
