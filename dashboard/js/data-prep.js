/**
 * data-prep.js — Aggregation and transform utilities
 * Runs once on load. Pure functions, no DOM side-effects.
 */

window.DataPrep = (() => {

  /* ---- Moving Average ---- */
  function movingAverage(arr, n = 3) {
    return arr.map((_, i) => {
      if (i < n - 1) return null;
      const slice = arr.slice(i - n + 1, i + 1).filter(v => v !== null);
      return slice.length ? +(slice.reduce((a, b) => a + b, 0) / slice.length).toFixed(2) : null;
    });
  }

  /* ---- Filter mandi records ---- */
  function filterMandi(records, { state = 'all', district = 'all', commodity = 'all' } = {}) {
    return records.filter(r => {
      if (state !== 'all' && r.state !== state) return false;
      if (district !== 'all' && r.district !== district) return false;
      if (commodity !== 'all' && r.commodity !== commodity) return false;
      return true;
    });
  }

  /* ---- Aggregate crop prices from filtered records ---- */
  function aggregateCropPrices(records) {
    const map = {};
    records.forEach(r => {
      if (!map[r.commodity]) map[r.commodity] = { min: r.min_price, max: r.max_price, modals: [], spreads: [] };
      map[r.commodity].min = Math.min(map[r.commodity].min, r.min_price);
      map[r.commodity].max = Math.max(map[r.commodity].max, r.max_price);
      map[r.commodity].modals.push(r.modal_price);
      map[r.commodity].spreads.push(r.max_price - r.min_price);
    });
    return Object.entries(map).map(([commodity, v]) => ({
      commodity,
      min_price: v.min,
      modal_price: +(v.modals.reduce((a, b) => a + b, 0) / v.modals.length).toFixed(2),
      max_price: v.max,
      spread: +(v.spreads.reduce((a, b) => a + b, 0) / v.spreads.length).toFixed(2),
      records: v.modals.length
    })).sort((a, b) => b.modal_price - a.modal_price);
  }

  /* ---- Aggregate by district from filtered records ---- */
  function aggregateByDistrict(records) {
    const map = {};
    records.forEach(r => {
      const key = `${r.district}|${r.commodity}`;
      if (!map[key]) map[key] = { district: r.district, commodity: r.commodity, prices: [] };
      map[key].prices.push(r.modal_price);
    });
    return Object.values(map).map(v => ({
      district: v.district,
      commodity: v.commodity,
      avg_modal: +(v.prices.reduce((a, b) => a + b, 0) / v.prices.length).toFixed(2)
    }));
  }

  /* ---- Build heatmap cell color ---- */
  function heatmapColor(value, min, max, isDark) {
    if (value === null || value === undefined) return isDark ? '#1B2E21' : '#f5f5f5';
    const t = max === min ? 0.5 : (value - min) / (max - min);
    if (isDark) {
      // Dark: low = #1B2E21, high = #66BB6A
      const r = Math.round(27 + t * (102 - 27));
      const g = Math.round(46 + t * (187 - 46));
      const b = Math.round(33 + t * (106 - 33));
      return `rgb(${r},${g},${b})`;
    } else {
      // Light: low = #F1F8E9, high = #2E7D32
      const r = Math.round(241 - t * (241 - 46));
      const g = Math.round(248 - t * (248 - 125));
      const b = Math.round(233 - t * (233 - 50));
      return `rgb(${r},${g},${b})`;
    }
  }

  function heatmapTextColor(value, min, max) {
    if (value === null) return 'inherit';
    const t = max === min ? 0.5 : (value - min) / (max - min);
    return t > 0.55 ? '#fff' : 'inherit';
  }

  /* ---- Format numbers ---- */
  function fmtINR(v) { return '₹' + Number(v).toLocaleString('en-IN'); }
  function fmtNum(v, decimals = 0) { return Number(v).toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }); }
  function fmtMillions(v) {
    if (v >= 1e9) return (v / 1e9).toFixed(2) + ' B';
    if (v >= 1e6) return (v / 1e6).toFixed(2) + ' M';
    if (v >= 1e3) return (v / 1e3).toFixed(1) + ' K';
    return v.toFixed(1);
  }

  /* ---- Production: filter by state ---- */
  function filterProductionByState(records, stateName) {
    if (!stateName || stateName === 'all') return records;
    return records.filter(r => (r.state || '').toLowerCase() === stateName.toLowerCase());
  }

  /* ---- Build year trend from production records ---- */
  function buildYearTrend(productionByYear) {
    return productionByYear.map(d => ({ year: d.year, production: d.total_production }));
  }

  /* ---- Auto-generate insight sentences from insights.json ---- */
  function generateInsightSentences(ins) {
    if (!ins) return [];
    return [
      {
        icon: 'fa-indian-rupee-sign',
        label: 'Highest-Priced Commodity',
        text: `<strong>${ins.mandi.highest_priced.commodity}</strong> tops the price chart at <strong>${fmtINR(ins.mandi.highest_priced.modal_price)}/Qtl</strong> — recorded at ${ins.mandi.highest_priced.market}, ${ins.mandi.highest_priced.district} (${ins.mandi.highest_priced.state}).`
      },
      {
        icon: 'fa-chart-simple',
        label: 'Most Price-Volatile Crop',
        text: `<strong>${ins.mandi.most_volatile.commodity}</strong> shows the highest price spread across mandis — ${ins.mandi.most_volatile.reason}.`
      },
      {
        icon: 'fa-cloud-showers-heavy',
        label: 'Highest Annual Rainfall',
        text: `<strong>${ins.rainfall.highest_rainfall_subdivision.name}</strong> subdivision receives the most rainfall on average — <strong>${fmtNum(ins.rainfall.highest_rainfall_subdivision.annual_mm, 0)} mm/year</strong> over ${ins.rainfall.years_covered} years.`
      },
      {
        icon: 'fa-comments',
        label: 'Most-Discussed Farm Concern',
        text: `<strong>${ins.farmer_queries.top_keyword.keyword.charAt(0).toUpperCase() + ins.farmer_queries.top_keyword.keyword.slice(1)}</strong> is the most frequently raised concern — mentioned in <strong>${fmtNum(ins.farmer_queries.top_keyword.frequency)}</strong> out of ${fmtNum(ins.farmer_queries.total_records)} farmer queries.`
      },
      {
        icon: 'fa-seedling',
        label: 'Top Crop by Total Production',
        text: `<strong>${ins.production.top_crop.name}</strong> leads all crops in cumulative production at <strong>${fmtMillions(ins.production.top_crop.total_production_tonnes)} tonnes</strong> across ${ins.production.states} states in the available production years.`
      }
    ];
  }

  return { movingAverage, filterMandi, aggregateCropPrices, aggregateByDistrict, heatmapColor, heatmapTextColor, fmtINR, fmtNum, fmtMillions, generateInsightSentences, buildYearTrend };
})();
