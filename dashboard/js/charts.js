/**
 * charts.js — Chart factory with dark-mode awareness, PNG download
 * All chart rendering lives here. Called from app.js.
 */

window.Charts = (() => {
  const registry = {};  // name → Chart instance

  /* ---- Theme colors ---- */
  function themeColors() {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    return {
      primary:    dark ? '#66BB6A' : '#2E7D32',
      primaryDk:  dark ? '#81C784' : '#1B5E20',
      primaryLt:  dark ? '#2E4535' : '#A5D6A7',
      accent:     '#F9A825',
      blue:       dark ? '#42A5F5' : '#1976D2',
      blueLt:     dark ? 'rgba(66,165,245,.18)' : 'rgba(25,118,210,.12)',
      text:       dark ? '#E8F5E9' : '#2C3E50',
      textMuted:  dark ? '#8BAF91' : '#607274',
      grid:       dark ? '#2E4535' : '#E8F5E9',
      card:       dark ? '#1B2E21' : '#FFFFFF',
      bg:         dark ? '#0F1F14' : '#F1F8E9',
      red:        dark ? '#EF5350' : '#D32F2F',
      brown:      dark ? '#BCAAA4' : '#6D4C41',
    };
  }

  function commonScales(c) {
    return {
      x: {
        ticks: { color: c.textMuted, font: { family: 'Poppins', size: 11 } },
        grid: { color: c.grid, drawBorder: false }
      },
      y: {
        ticks: { color: c.textMuted, font: { family: 'Poppins', size: 11 } },
        grid: { color: c.grid, drawBorder: false }
      }
    };
  }

  function commonPlugins(c) {
    return {
      legend: {
        labels: { color: c.text, font: { family: 'Poppins', size: 12 }, boxWidth: 14 }
      },
      tooltip: {
        backgroundColor: c.card,
        titleColor: c.text,
        bodyColor: c.textMuted,
        borderColor: c.grid,
        borderWidth: 1,
        cornerRadius: 8,
        padding: 10
      }
    };
  }

  /* ---- Destroy & re-create ---- */
  function make(name, ctxId, config) {
    if (registry[name]) { registry[name].destroy(); }
    const canvas = document.getElementById(ctxId);
    if (!canvas) return null;
    const chart = new Chart(canvas, config);
    registry[name] = chart;
    return chart;
  }

  /* ---- Re-color all charts on theme toggle ---- */
  function recolorAll() {
    Object.keys(registry).forEach(name => {
      const ch = registry[name];
      if (!ch) return;
      // Just destroy and signal app to redraw
      ch.destroy();
      delete registry[name];
    });
    // App re-renders by calling renderAll()
    window.dispatchEvent(new CustomEvent('chartsNeedRedraw'));
  }

  function resizeAll() {
    Object.values(registry).forEach(chart => chart?.resize());
  }

  /* ---- PNG download ---- */
  function downloadPNG(chartName, filename) {
    const ch = registry[chartName];
    if (!ch) return;
    const a = document.createElement('a');
    a.href = ch.canvas.toDataURL('image/png');
    a.download = (filename || chartName) + '.png';
    a.click();
  }

  /* ==================================================================
     CHART FACTORY METHODS
     ================================================================== */

  /* ---- Crop Price Spectrum (grouped bar + MA trend) ---- */
  function cropPriceSpectrum(cropData) {
    const c = themeColors();
    const labels = cropData.map(d => d.commodity);
    const minData = cropData.map(d => d.min_price);
    const modalData = cropData.map(d => d.modal_price);
    const maxData  = cropData.map(d => d.max_price);
    const maModal  = DataPrep.movingAverage(modalData, 3);

    return make('cropSpectrum', 'cropSpectrumCanvas', {
      data: {
        labels,
        datasets: [
          { type:'bar', label:'Min Price (₹)', data:minData, backgroundColor:c.primaryLt, borderColor:c.primaryLt, borderWidth:0, borderRadius:4, order:2 },
          { type:'bar', label:'Modal Price (₹)', data:modalData, backgroundColor:c.primary, borderColor:c.primary, borderWidth:0, borderRadius:4, order:2 },
          { type:'bar', label:'Max Price (₹)', data:maxData, backgroundColor:c.accent, borderColor:c.accent, borderWidth:0, borderRadius:4, order:2 },
          { type:'line', label:'Trend (moving avg.)', data:maModal, borderColor:c.red, backgroundColor:'transparent', borderWidth:2, borderDash:[5,3], pointRadius:4, pointHoverRadius:6, tension:.35, order:1, spanGaps:true }
        ]
      },
      options: {
        responsive:true, maintainAspectRatio:false,
        plugins: { ...commonPlugins(c), tooltip: { ...commonPlugins(c).tooltip, mode:'index', intersect:false } },
        scales: {
          x: { ...commonScales(c).x, ticks:{ ...commonScales(c).x.ticks, maxRotation:30 } },
          y: { ...commonScales(c).y, ticks:{ ...commonScales(c).y.ticks, callback: v => '₹'+v.toLocaleString('en-IN') } }
        }
      }
    });
  }

  /* ---- Price Spread / Volatility (horizontal bar) ---- */
  function priceSpread(cropData) {
    const c = themeColors();
    const sorted = [...cropData].sort((a, b) => b.spread - a.spread);
    return make('priceSpread', 'priceSpreadCanvas', {
      type: 'bar',
      data: {
        labels: sorted.map(d => d.commodity),
        datasets: [{
          label: 'Price Spread ₹ (Max − Min)',
          data: sorted.map(d => d.spread),
          backgroundColor: sorted.map((_, i) => i === 0 ? c.red : c.accent),
          borderRadius: 5
        }]
      },
      options: {
        indexAxis:'y', responsive:true, maintainAspectRatio:false,
        plugins: { ...commonPlugins(c), legend:{display:false},
          tooltip:{ ...commonPlugins(c).tooltip, callbacks:{ label: ctx => ' Spread: ₹'+ctx.raw.toLocaleString('en-IN') } }
        },
        scales: {
          x: { ...commonScales(c).x, ticks:{ ...commonScales(c).x.ticks, callback: v => '₹'+v } },
          y: { ...commonScales(c).y, grid:{display:false} }
        }
      }
    });
  }

  /* ---- Top/Bottom 10 Crops ---- */
  function topBottomCrops(cropData, mode='top') {
    const c = themeColors();
    const sorted = [...cropData].sort((a, b) => mode==='top' ? b.modal_price - a.modal_price : a.modal_price - b.modal_price);
    const shown = sorted.slice(0, Math.min(10, sorted.length));
    return make('topBottom', 'topBottomCanvas', {
      type:'bar',
      data: {
        labels: shown.map(d => d.commodity),
        datasets:[{
          label: (mode==='top' ? 'Top' : 'Bottom')+' Crops — Avg Modal Price (₹)',
          data: shown.map(d => d.modal_price),
          backgroundColor: mode==='top' ? c.primary : c.red,
          borderRadius:5
        }]
      },
      options:{
        indexAxis:'y', responsive:true, maintainAspectRatio:false,
        plugins:{ ...commonPlugins(c), legend:{display:false},
          tooltip:{ ...commonPlugins(c).tooltip, callbacks:{ label: ctx=>' ₹'+ctx.raw.toLocaleString('en-IN')+'/Qtl' } }
        },
        scales:{
          x:{ ...commonScales(c).x, ticks:{ ...commonScales(c).x.ticks, callback: v=>'₹'+v } },
          y:{ ...commonScales(c).y, grid:{display:false} }
        }
      }
    });
  }

  /* ---- Rainfall by Month (bar with JJAS bands) ---- */
  function rainfallMonthly(labels, data, title) {
    const c = themeColors();
    const isMonsoon = (label) => ['Jun','Jul','Aug','Sep'].includes(label);
    return make('rainfallMonthly', 'rainfallMonthlyCanvas', {
      type:'bar',
      data:{
        labels,
        datasets:[{
          label:'Avg Rainfall (mm)',
          data,
          backgroundColor: labels.map(l => isMonsoon(l) ? c.blue : c.primaryLt),
          borderColor: labels.map(l => isMonsoon(l) ? c.blue : c.primary),
          borderWidth:1, borderRadius:4
        }]
      },
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{
          ...commonPlugins(c),
          legend:{display:false},
          tooltip:{
            ...commonPlugins(c).tooltip,
            callbacks:{
              label: ctx => ctx.raw === null || ctx.raw === undefined ? ' No rainfall measurement' : ' '+ctx.raw.toFixed(1)+' mm',
              afterLabel: ctx => isMonsoon(ctx.label) ? '🌧 Monsoon (JJAS)' : ''
            }
          },
          annotation: undefined // no plugin needed, colored bars suffice
        },
        scales:{
          x:{ ...commonScales(c).x },
          y:{ ...commonScales(c).y, ticks:{ ...commonScales(c).y.ticks, callback: v=>v+' mm' } }
        }
      }
    });
  }

  /* ---- Rainfall vs Price (dual-axis) ---- */
  function rainfallVsPrice(data) {
    const c = themeColors();
    return make('rainfallPrice', 'rainfallPriceCanvas', {
      data:{
        labels: data.map(d => d.month),
        datasets:[
          { type:'bar', label:'Rainfall (mm)', data:data.map(d=>d.rainfall_mm), backgroundColor:c.blueLt, borderColor:c.blue, borderWidth:1.5, borderRadius:4, yAxisID:'yRain', order:2 },
          { type:'line', label:'Avg Modal Price (₹)', data:data.map(d=>d.avg_modal_price), borderColor:c.primary, backgroundColor:c.primary, borderWidth:2.5, tension:.35, pointRadius:4, yAxisID:'yPrice', order:1 }
        ]
      },
      options:{
        responsive:true, maintainAspectRatio:false,
        interaction:{ mode:'index', intersect:false },
        plugins:commonPlugins(c),
        scales:{
          x:commonScales(c).x,
          yRain:{ type:'linear', position:'left', ticks:{ ...commonScales(c).y.ticks, callback: v=>v+' mm', color:c.blue }, grid:commonScales(c).y.grid, title:{ display:true, text:'Rainfall (mm)', color:c.blue, font:{family:'Poppins',size:11,weight:'600'} } },
          yPrice:{ type:'linear', position:'right', ticks:{ ...commonScales(c).y.ticks, callback: v=>'₹'+v, color:c.primary }, grid:{display:false}, title:{ display:true, text:'Modal Price (₹)', color:c.primary, font:{family:'Poppins',size:11,weight:'600'} } }
        }
      }
    });
  }

  /* ---- Keyword Frequency (horizontal bar) ---- */
  function keywordBar(data) {
    const c = themeColors();
    const colors = ['#D32F2F','#1976D2','#388E3C','#0288D1','#F57F17'];
    return make('keywords', 'keywordCanvas', {
      type:'bar',
      data:{
        labels: data.map(d => d.keyword.toUpperCase()),
        datasets:[{
          label:'Farmer Inquiry Mentions',
          data: data.map(d=>d.frequency),
          backgroundColor: data.map((_,i)=>colors[i]||c.primary),
          borderRadius:5
        }]
      },
      options:{
        indexAxis:'y', responsive:true, maintainAspectRatio:false,
        plugins:{ ...commonPlugins(c), legend:{display:false},
          tooltip:{ ...commonPlugins(c).tooltip, callbacks:{ label: ctx=>' '+ctx.raw.toLocaleString('en-IN')+' mentions' } }
        },
        scales:{
          x:{ ...commonScales(c).x },
          y:{ ...commonScales(c).y, grid:{display:false}, ticks:{ ...commonScales(c).y.ticks, font:{family:'Poppins',size:12,weight:'600'} } }
        }
      }
    });
  }

  /* ---- Top Crops by Production (horizontal bar) ---- */
  function topCropsProduction(data) {
    const c = themeColors();
    const top10 = data.slice(0, 10);
    return make('topCropsProd', 'topCropsProdCanvas', {
      type:'bar',
      data:{
        labels: top10.map(d=>d.crop),
        datasets:[{
          label:'Total Production (Tonnes)',
          data: top10.map(d=>d.total_production),
          backgroundColor: top10.map((_,i)=>i===0?c.accent:c.primary),
          borderRadius:5
        }]
      },
      options:{
        indexAxis:'y', responsive:true, maintainAspectRatio:false,
        plugins:{ ...commonPlugins(c), legend:{display:false},
          tooltip:{ ...commonPlugins(c).tooltip, callbacks:{ label: ctx=>' '+DataPrep.fmtMillions(ctx.raw)+' tonnes' } }
        },
        scales:{
          x:{ ...commonScales(c).x, ticks:{ ...commonScales(c).x.ticks, callback: v=>DataPrep.fmtMillions(v) } },
          y:{ ...commonScales(c).y, grid:{display:false} }
        }
      }
    });
  }

  /* ---- Production by Season (grouped bar) ---- */
  function productionBySeason(data) {
    const c = themeColors();
    const filtered = data.filter(d=>d.season.toLowerCase()!=='whole year');
    return make('prodSeason', 'prodSeasonCanvas', {
      type:'bar',
      data:{
        labels: filtered.map(d=>d.season),
        datasets:[
          { label:'Production (M Tonnes)', data:filtered.map(d=>+(d.total_production/1e6).toFixed(1)), backgroundColor:c.primary, borderRadius:4 },
          { label:'Area (M Hectares)', data:filtered.map(d=>+(d.total_area/1e6).toFixed(1)), backgroundColor:c.primaryLt, borderRadius:4 }
        ]
      },
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{ ...commonPlugins(c), tooltip:{ ...commonPlugins(c).tooltip, callbacks:{ label: ctx=>' '+ctx.raw.toLocaleString('en-IN')+' M '+( ctx.datasetIndex===0?'T':'Ha') } } },
        scales:{
          x:commonScales(c).x,
          y:{ ...commonScales(c).y, ticks:{ ...commonScales(c).y.ticks, callback: v=>v+' M' } }
        }
      }
    });
  }

  /* ---- Production Trend by Year (line) ---- */
  function productionTrend(data) {
    const c = themeColors();
    const vals = data.map(d=>d.total_production);
    const ma = DataPrep.movingAverage(vals, 3);
    return make('prodTrend', 'prodTrendCanvas', {
      data:{
        labels: data.map(d=>d.year),
        datasets:[
          { type:'line', label:'Total Production (Tonnes)', data:vals, borderColor:c.primary, backgroundColor:c.primaryLt+'55', borderWidth:2, tension:.35, pointRadius:3, fill:true },
          { type:'line', label:'Trend (moving avg.)', data:ma, borderColor:c.red, backgroundColor:'transparent', borderWidth:1.5, borderDash:[5,3], pointRadius:0, tension:.35, spanGaps:true }
        ]
      },
      options:{
        responsive:true, maintainAspectRatio:false,
        interaction:{ mode:'index', intersect:false },
        plugins:{ ...commonPlugins(c), tooltip:{ ...commonPlugins(c).tooltip, callbacks:{ label: ctx=>' '+DataPrep.fmtMillions(ctx.raw)+' tonnes' } } },
        scales:{
          x:commonScales(c).x,
          y:{ ...commonScales(c).y, ticks:{ ...commonScales(c).y.ticks, callback: v=>DataPrep.fmtMillions(v) } }
        }
      }
    });
  }

  function productionForecast(data) {
    const c = themeColors();
    const models = ['linear_regression', 'random_forest', 'last_year_repeated'];
    const actual = data.actual || [];
    const forecasts = data.forecasts || [];
    const years = [...new Set([
      ...actual.map(row => Number(row.year)),
      ...forecasts.map(row => Number(row.year))
    ])].sort((a, b) => a - b);
    const colors = [c.blue, c.red, c.accent];
    const datasets = [
      {
        label: 'Actual',
        data: years.map(year => actual.find(row => Number(row.year) === year)?.production ?? null),
        borderColor: c.primary,
        backgroundColor: c.primaryLt + '55',
        borderWidth: 2.5,
        tension: .25,
        pointRadius: 3,
        fill: false
      },
      ...models.map((model, index) => ({
        label: model.replaceAll('_', ' '),
        data: years.map(year => forecasts.find(row =>
          Number(row.year) === year && row.model === model
        )?.production ?? null),
        borderColor: colors[index],
        backgroundColor: 'transparent',
        borderWidth: 2,
        borderDash: [6, 4],
        tension: .25,
        pointRadius: 3,
        spanGaps: false
      }))
    ];
    return make('forecastActual', 'forecastActualCanvas', {
      type: 'line',
      data: { labels: years, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: commonPlugins(c),
        scales: {
          x: commonScales(c).x,
          y: {
            ...commonScales(c).y,
            ticks: { ...commonScales(c).y.ticks, callback: value => DataPrep.fmtMillions(value) }
          }
        }
      }
    });
  }

  function forecastModelComparison(metrics) {
    const c = themeColors();
    const entries = Object.entries(metrics || {}).filter(([, value]) => Number.isFinite(value.mae));
    return make('forecastCompare', 'forecastCompareCanvas', {
      type: 'bar',
      data: {
        labels: entries.map(([model]) => model.replaceAll('_', ' ')),
        datasets: [{
          label: 'MAE',
          data: entries.map(([, value]) => value.mae),
          backgroundColor: entries.map(([model]) =>
            model === 'last_year_repeated' ? c.accent : c.primary
          ),
          borderRadius: 5
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { ...commonPlugins(c), legend: { display: false } },
        scales: {
          x: commonScales(c).x,
          y: { ...commonScales(c).y, beginAtZero: true }
        }
      }
    });
  }

  return {
    recolorAll, resizeAll, downloadPNG,
    cropPriceSpectrum, priceSpread, topBottomCrops,
    rainfallMonthly, rainfallVsPrice,
    keywordBar,
    topCropsProduction, productionBySeason, productionTrend,
    productionForecast, forecastModelComparison
  };
})();
