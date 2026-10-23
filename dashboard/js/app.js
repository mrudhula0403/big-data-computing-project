/**
 * app.js — Main application logic
 * Navigation, data loading, filter wiring, table, heatmap, and counters
 */

document.addEventListener('DOMContentLoaded', () => {

  /* ================================================================
     THEME SYSTEM
     ================================================================ */
  const root = document.documentElement;
  const themeBtn = document.getElementById('themeToggle');

  function getPreferredTheme() {
    const stored = localStorage.getItem('agri.theme');
    if (stored) return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[character]);
  }

  function applyTheme(t) {
    root.setAttribute('data-theme', t);
    localStorage.setItem('agri.theme', t);
    if (themeBtn) {
      themeBtn.innerHTML = t === 'dark'
        ? '<i class="fa-solid fa-sun"></i>'
        : '<i class="fa-solid fa-moon"></i>';
      themeBtn.setAttribute('data-tip', t === 'dark' ? 'Switch to Light mode' : 'Switch to Dark mode');
    }
  }

  applyTheme(getPreferredTheme());
  themeBtn?.addEventListener('click', () => {
    const cur = root.getAttribute('data-theme');
    applyTheme(cur === 'dark' ? 'light' : 'dark');
    // Charts re-render on custom event fired by Charts.recolorAll()
    Charts.recolorAll();
  });

  window.addEventListener('chartsNeedRedraw', () => renderAllCharts());

  /* ================================================================
     NAVIGATION
     ================================================================ */
  const navLinks = document.querySelectorAll('.nav-link[data-page]');
  const sections = document.querySelectorAll('.dashboard-section');
  const mobileToggle = document.getElementById('mobileToggle');
  const navMenu = document.getElementById('navMenu');

  function showPage(pageId) {
    navLinks.forEach(l => l.classList.toggle('active', l.dataset.page === pageId));
    sections.forEach(s => s.classList.toggle('active', s.id === 'section-' + pageId));
    if (navMenu) navMenu.classList.remove('open');
    // Re-resize charts when switching tabs
    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
      Charts.resizeAll();
    }, 80);
  }

  navLinks.forEach(l => l.addEventListener('click', () => showPage(l.dataset.page)));
  mobileToggle?.addEventListener('click', () => navMenu?.classList.toggle('open'));
  document.getElementById('printBtn')?.addEventListener('click', () => window.print());

  // Default page
  showPage('overview');

  /* ================================================================
     DATA STORE
     ================================================================ */
  const D = {
    mandi: [], cropPrices: [], districtComp: [], keywords: [],
    rainfallVsPrice: [], seasonProd: [], topCropsProd: [],
    prodByYear: [], prodStates: [], rainfallBySub: {},
    insights: null, heatmapData: null, cropsRanked: [],
    pipelineMeta: null, datasetMeta: null, forecast: null, priceForecast: null,
    rainfallProduction: [], topDistricts: [], priceVolatility: [], productionSeries: [],
    rainfallPriceCorrelation: null
  };

  let activeFilters = { state:'all', district:'all', commodity:'all' };
  let tableState = { page:1, pageSize:10, sortCol:'modal_price', sortDir:'desc', search:'' };
  let topBottomMode = 'top';
  let rainfallSubdivision = 'all';
  let activeRole = 'farmer';
  let productionFilters = { state: 'all', district: 'all', crop: 'all' };

  const LABELS = {
    en: {
      overview:'Overview', priceAnalysis:'Price Analysis', weatherProduction:'Weather & Production',
      forecast:'Forecast', insights:'Insights', farmer:'Farmer',
      policymaker:'Policymaker', marketingBoard:'Marketing Board', lastUpdated:'Last updated',
      noData:'No exported data is available yet.',
      dashboardTitle:'Indian Agricultural Market Prices',
      marketPriceTitle:'Mandi Market Price Intelligence', weatherTitle:'Precipitation Trends, NLP Mining & Crop Yield Analysis',
      forecastTitle:'Production Forecast',
      estimateLabel:'Estimated, not guaranteed', state:'State', district:'District', crop:'Crop',
      reset:'Reset', stateFilter:'State Filter', districtFilter:'District Filter', cropFilter:'Crop Filter',
      priceLeaders:'Price leaders from available mandi records', bestCrop:'Best crop by average modal price',
      bestMarket:'Best market by average modal price', stateProductionRainfall:'State production and rainfall gaps',
      topDistrictProduction:'Top districts by production', production:'Production', productionTotal:'Production total',
      productionGap:'Production gap vs. mean', annualRainfall:'Avg annual rainfall (mm)',
      rainfallGap:'Rainfall gap vs. mean (mm)', rainfallProductionCorrelation:'Rainfall / production correlation',
      volatilitySpread:'Price volatility and market spread by crop', coefficientVariation:'Coefficient of variation',
      averageSpread:'Average min–max spread (₹)', priceRecords:'Price records', model:'Model',
      testPoints:'Test points', linearRegression:'Linear regression', randomForest:'Random forest',
      repeatedBaseline:'Last year repeated baseline', forecastUnavailable:'Forecast results are not available yet.',
      forecastMetricsUnavailable:'Forecast metrics are unavailable.',
      insufficientForecastHistory:'Insufficient historical observations to build a validated production forecast.',
      noForecastEstimates:'No forecast estimates or validation metrics were produced.',
      notEnoughForecastData:'Not enough data to plot a forecast.',
      notEnoughValidationData:'Not enough validation data to compare models.',
      forecastSubtitle:'Models use yearly production grouped by state, crop, and season from crop_production.csv.',
      actualForecastProduction:'Actual and Forecast Production',
      nationalForecastSum:'National sum of state, crop, and season estimates',
      modelErrorComparison:'Model Error Comparison',
      holdoutMae:'Holdout MAE; lower values indicate smaller absolute error',
      holdoutMetrics:'Holdout Error Metrics',
      holdoutDescription:'Models are trained on earlier years and tested on the latest available years.',
      priceCoverage:'Price forecast coverage',
      priceHistoryUnavailable:'Price history coverage is not available.'
    },
    hi: {
      overview:'अवलोकन', priceAnalysis:'मूल्य विश्लेषण', weatherProduction:'मौसम और उत्पादन',
      forecast:'पूर्वानुमान', insights:'मुख्य जानकारी', farmer:'किसान',
      policymaker:'नीति निर्माता', marketingBoard:'विपणन मंडल', lastUpdated:'अंतिम अपडेट',
      noData:'निर्यात किया गया डेटा अभी उपलब्ध नहीं है।',
      dashboardTitle:'भारतीय कृषि बाजार मूल्य',
      marketPriceTitle:'मंडी बाजार मूल्य जानकारी', weatherTitle:'वर्षा, प्रश्न विश्लेषण और फसल उपज',
      forecastTitle:'उत्पादन पूर्वानुमान',
      estimateLabel:'अनुमानित, सुनिश्चित नहीं', state:'राज्य', district:'जिला', crop:'फसल',
      reset:'रीसेट', stateFilter:'राज्य फ़िल्टर', districtFilter:'जिला फ़िल्टर', cropFilter:'फसल फ़िल्टर',
      priceLeaders:'उपलब्ध मंडी रिकॉर्ड के मूल्य अग्रणी', bestCrop:'औसत मॉडल मूल्य के अनुसार सर्वोत्तम फसल',
      bestMarket:'औसत मॉडल मूल्य के अनुसार सर्वोत्तम बाजार', stateProductionRainfall:'राज्य उत्पादन और वर्षा अंतर',
      topDistrictProduction:'उत्पादन के शीर्ष जिले', production:'उत्पादन', productionTotal:'कुल उत्पादन',
      productionGap:'औसत से उत्पादन अंतर', annualRainfall:'औसत वार्षिक वर्षा (मिमी)',
      rainfallGap:'औसत से वर्षा अंतर (मिमी)', rainfallProductionCorrelation:'वर्षा / उत्पादन सहसंबंध',
      volatilitySpread:'फसल के अनुसार मूल्य अस्थिरता और बाजार अंतर', coefficientVariation:'परिवर्तन गुणांक',
      averageSpread:'औसत न्यूनतम–अधिकतम अंतर (₹)', priceRecords:'मूल्य रिकॉर्ड', model:'मॉडल',
      testPoints:'परीक्षण बिंदु', linearRegression:'रैखिक प्रतिगमन', randomForest:'रैंडम फ़ॉरेस्ट',
      repeatedBaseline:'पिछले वर्ष का दोहराया आधार', forecastUnavailable:'पूर्वानुमान परिणाम अभी उपलब्ध नहीं हैं।',
      forecastMetricsUnavailable:'पूर्वानुमान मेट्रिक्स उपलब्ध नहीं हैं।',
      insufficientForecastHistory:'सत्यापित उत्पादन पूर्वानुमान के लिए पर्याप्त ऐतिहासिक अवलोकन नहीं हैं।',
      noForecastEstimates:'कोई पूर्वानुमान या सत्यापन मेट्रिक्स उपलब्ध नहीं हैं।',
      notEnoughForecastData:'पूर्वानुमान चार्ट के लिए पर्याप्त डेटा नहीं है.',
      notEnoughValidationData:'मॉडल तुलना के लिए पर्याप्त सत्यापन डेटा नहीं है।',
      forecastSubtitle:'मॉडल crop_production.csv से राज्य, फसल और मौसम के अनुसार वार्षिक उत्पादन का उपयोग करते हैं।',
      actualForecastProduction:'वास्तविक और पूर्वानुमानित उत्पादन',
      nationalForecastSum:'राज्य, फसल और मौसम के अनुमानों का राष्ट्रीय योग',
      modelErrorComparison:'मॉडल त्रुटि तुलना',
      holdoutMae:'परीक्षण MAE; कम मान का अर्थ कम निरपेक्ष त्रुटि है',
      holdoutMetrics:'परीक्षण त्रुटि मेट्रिक्स',
      holdoutDescription:'मॉडल पुराने वर्षों पर प्रशिक्षित और नवीनतम उपलब्ध वर्षों पर परीक्षित हैं।',
      priceCoverage:'मूल्य पूर्वानुमान डेटा कवरेज',
      priceHistoryUnavailable:'मूल्य इतिहास कवरेज उपलब्ध नहीं है।'
    },
    ta: {
      overview:'கண்ணோட்டம்', priceAnalysis:'விலை பகுப்பாய்வு', weatherProduction:'வானிலை மற்றும் உற்பத்தி',
      forecast:'முன்கணிப்பு', insights:'நுண்ணறிவுகள்', farmer:'விவசாயி',
      policymaker:'கொள்கை வகுப்பாளர்', marketingBoard:'சந்தைப்படுத்தல் வாரியம்',
      lastUpdated:'கடைசியாக புதுப்பிக்கப்பட்டது',
      noData:'ஏற்றுமதி செய்யப்பட்ட தரவு இன்னும் கிடைக்கவில்லை.',
      dashboardTitle:'இந்திய வேளாண் சந்தை விலைகள்',
      marketPriceTitle:'மண்டி சந்தை விலை நுண்ணறிவு', weatherTitle:'மழைப்பொழிவு, உரை பகுப்பாய்வு மற்றும் பயிர் விளைச்சல்',
      forecastTitle:'உற்பத்தி முன்கணிப்பு',
      estimateLabel:'மதிப்பீடு; உறுதி அளிக்கப்படவில்லை', state:'மாநிலம்', district:'மாவட்டம்', crop:'பயிர்',
      reset:'மீட்டமை', stateFilter:'மாநில வடிகட்டி', districtFilter:'மாவட்ட வடிகட்டி', cropFilter:'பயிர் வடிகட்டி',
      priceLeaders:'கிடைக்கும் மண்டி பதிவுகளின் விலை முன்னிலைகள்', bestCrop:'சராசரி மண்டி விலையின்படி சிறந்த பயிர்',
      bestMarket:'சராசரி மண்டி விலையின்படி சிறந்த சந்தை', stateProductionRainfall:'மாநில உற்பத்தி மற்றும் மழை இடைவெளிகள்',
      topDistrictProduction:'உற்பத்தியில் முன்னணி மாவட்டங்கள்', production:'உற்பத்தி', productionTotal:'மொத்த உற்பத்தி',
      productionGap:'சராசரியிலிருந்து உற்பத்தி இடைவெளி', annualRainfall:'சராசரி ஆண்டு மழை (மிமீ)',
      rainfallGap:'சராசரியிலிருந்து மழை இடைவெளி (மிமீ)', rainfallProductionCorrelation:'மழை / உற்பத்தி தொடர்பு',
      volatilitySpread:'பயிர் வாரியான விலை மாறுபாடு மற்றும் சந்தை விலை வித்தியாசம்',
      coefficientVariation:'மாறுபாட்டு குணகம்', averageSpread:'சராசரி குறைந்தபட்ச–அதிகபட்ச வித்தியாசம் (₹)',
      priceRecords:'விலை பதிவுகள்', model:'மாதிரி', testPoints:'சோதனைப் புள்ளிகள்',
      linearRegression:'நேரியல் பின்னடைவு', randomForest:'ரேண்டம் ஃபாரஸ்ட்',
      repeatedBaseline:'கடந்த ஆண்டை மீண்டும் பயன்படுத்தும் அடிப்படை',
      forecastUnavailable:'முன்கணிப்பு முடிவுகள் இன்னும் கிடைக்கவில்லை.',
      forecastMetricsUnavailable:'முன்கணிப்பு அளவீடுகள் கிடைக்கவில்லை.',
      insufficientForecastHistory:'சரிபார்க்கப்பட்ட உற்பத்தி முன்கணிப்புக்கு போதுமான வரலாற்றுத் தரவு இல்லை.',
      noForecastEstimates:'முன்கணிப்பு அல்லது சரிபார்ப்பு அளவீடுகள் உருவாக்கப்படவில்லை.',
      notEnoughForecastData:'முன்கணிப்பு வரைபடத்திற்கு போதுமான தரவு இல்லை.',
      notEnoughValidationData:'மாதிரிகளை ஒப்பிட போதுமான சரிபார்ப்பு தரவு இல்லை.',
      forecastSubtitle:'crop_production.csv-இல் உள்ள மாநிலம், பயிர் மற்றும் பருவ வாரியான ஆண்டு உற்பத்தியை மாதிரிகள் பயன்படுத்துகின்றன.',
      actualForecastProduction:'உண்மையான மற்றும் முன்கணிக்கப்பட்ட உற்பத்தி',
      nationalForecastSum:'மாநிலம், பயிர் மற்றும் பருவ மதிப்பீடுகளின் தேசிய மொத்தம்',
      modelErrorComparison:'மாதிரி பிழை ஒப்பீடு',
      holdoutMae:'சோதனை MAE; குறைந்த மதிப்பு குறைந்த முழுப் பிழையைக் குறிக்கும்',
      holdoutMetrics:'சோதனை பிழை அளவீடுகள்',
      holdoutDescription:'முந்தைய ஆண்டுகளில் பயிற்சி செய்து, சமீபத்திய ஆண்டுகளில் மாதிரிகள் சோதிக்கப்படுகின்றன.',
      priceCoverage:'விலை முன்கணிப்பு தரவு வரம்பு',
      priceHistoryUnavailable:'விலை வரலாற்றுத் தரவு வரம்பு கிடைக்கவில்லை.'
    }
  };

  function setLanguage(language) {
    const words = LABELS[language] || LABELS.en;
    document.documentElement.lang = language;
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const translated = words[el.dataset.i18n];
      if (translated) el.textContent = translated;
    });
    document.querySelectorAll('[data-language]').forEach(button => {
      button.classList.toggle('active', button.dataset.language === language);
    });
    renderLastUpdated();
    renderRoleDashboard();
    renderForecastPage();
    renderPriceForecastStatus();
  }

  function label(key) {
    const words = LABELS[document.documentElement.lang] || LABELS.en;
    return words[key] || LABELS.en[key] || key;
  }

  document.querySelectorAll('[data-language]').forEach(button => {
    button.addEventListener('click', () => setLanguage(button.dataset.language));
  });

  /* ================================================================
     FETCH ALL DATA
     ================================================================ */
  async function fetchAll() {
    showSkeletons();
    try {
      const fetches = await Promise.allSettled([
        fetch('data/mandi_records.json').then(r=>r.ok?r.json():[]),
        fetch('data/keyword_frequencies.json').then(r=>r.ok?r.json():[]),
        fetch('data/rainfall_vs_price.json').then(r=>r.ok?r.json():[]),
        fetch('data/production_by_season.json').then(r=>r.ok?r.json():[]),
        fetch('data/top_crops_production.json').then(r=>r.ok?r.json():[]),
        fetch('data/production_by_year.json').then(r=>r.ok?r.json():[]),
        fetch('data/production_states.json').then(r=>r.ok?r.json():[]),
        fetch('data/rainfall_by_subdivision.json').then(r=>r.ok?r.json():{}),
        fetch('data/insights.json').then(r=>r.ok?r.json():null),
        fetch('data/state_commodity_heatmap.json').then(r=>r.ok?r.json():null),
        fetch('data/crops_ranked.json').then(r=>r.ok?r.json():[]),
        fetch('data/dataset_meta.json').then(r=>r.ok?r.json():null),
        fetch('data/forecast.json').then(r=>r.ok?r.json():null),
        fetch('data/price_forecast.json').then(r=>r.ok?r.json():null),
        fetch('data/rainfall_production_correlation.json').then(r=>r.ok?r.json():[]),
        fetch('data/top_districts_production.json').then(r=>r.ok?r.json():[]),
        fetch('data/price_volatility.json').then(r=>r.ok?r.json():[]),
        fetch('data/production_yearly_state_crop_season.json').then(r=>r.ok?r.json():[]),
        fetch('data/rainfall_price_correlation.json').then(r=>r.ok?r.json():null)
      ]);

      D.mandi = fetches[0].status === 'fulfilled' ? fetches[0].value : [];
      D.keywords = fetches[1].status === 'fulfilled' ? fetches[1].value : [];
      D.rainfallVsPrice = fetches[2].status === 'fulfilled' ? fetches[2].value : [];
      D.seasonProd = fetches[3].status === 'fulfilled' ? fetches[3].value : [];
      D.topCropsProd = fetches[4].status === 'fulfilled' ? fetches[4].value : [];
      D.prodByYear = fetches[5].status === 'fulfilled' ? fetches[5].value : [];
      D.prodStates = fetches[6].status === 'fulfilled' ? fetches[6].value : [];
      D.rainfallBySub = fetches[7].status === 'fulfilled' ? fetches[7].value : {};
      D.insights = fetches[8].status === 'fulfilled' ? fetches[8].value : null;
      D.heatmapData = fetches[9].status === 'fulfilled' ? fetches[9].value : null;
      D.cropsRanked = fetches[10].status === 'fulfilled' ? fetches[10].value : [];
      D.datasetMeta = fetches[11].status === 'fulfilled' ? fetches[11].value : null;
      D.forecast = fetches[12].status === 'fulfilled' ? fetches[12].value : null;
      D.priceForecast = fetches[13].status === 'fulfilled' ? fetches[13].value : null;
      D.rainfallProduction = fetches[14].status === 'fulfilled' ? fetches[14].value : [];
      D.topDistricts = fetches[15].status === 'fulfilled' ? fetches[15].value : [];
      D.priceVolatility = fetches[16].status === 'fulfilled' ? fetches[16].value : [];
      D.productionSeries = fetches[17].status === 'fulfilled' ? fetches[17].value : [];
      D.rainfallPriceCorrelation = fetches[18].status === 'fulfilled' ? fetches[18].value : null;

      initFilters();
      renderOverview();
      renderAllCharts();
      renderLastUpdated();
      renderPriceForecastStatus();
      renderForecastPage();
      renderInsightsPage();
      initRoleSwitcher();
      renderRoleDashboard();
    } catch(e) {
      console.error('Data load error:', e);
    }
  }

  /* ================================================================
     SKELETONS
     ================================================================ */
  function showSkeletons() {
    const grid = document.getElementById('overviewKpiGrid');
    if (grid) grid.innerHTML = Array(7).fill('<div class="skeleton skeleton-kpi"></div>').join('');
  }

  /* ================================================================
     OVERVIEW PAGE
     ================================================================ */
  function renderOverview() {
    renderKPICards();
    renderInsightBoxes();
    renderStateCoverage();
  }

  function renderStateCoverage() {
    const list = document.getElementById('productionStateList');
    const note = document.getElementById('stateCoverageNote');
    if (!list) return;
    if (!D.prodStates.length) {
      list.innerHTML = '<p class="empty-state-message">Crop-production state coverage is not available yet.</p>';
      if (note) note.textContent = 'Mandi state coverage is counted separately from crop-production coverage.';
      return;
    }
    const mandiStates = new Set(D.mandi.map(record => record.state).filter(Boolean));
    if (note) {
      note.textContent = `${mandiStates.size} states have mandi price records; ${D.prodStates.length} states and territories appear in the crop-production data.`;
    }
    list.innerHTML = [...mandiStates].sort()
      .map(state => `<button type="button" class="state-chip${mandiStates.has(state) ? ' has-mandi' : ''}" data-state="${escapeHTML(state)}" aria-label="View mandi prices for ${escapeHTML(state)}${mandiStates.has(state) ? '' : '; no mandi records available'}">${escapeHTML(state)}${mandiStates.has(state) ? ' · mandi prices' : ' · no mandi records'}</button>`)
      .join('');
    list.addEventListener('click', event => {
      const chip = event.target.closest('button.state-chip[data-state]');
      if (!chip) return;
      const stateFilter = document.getElementById('priceStateFilter');
      if (!stateFilter) return;
      showPage('prices');
      stateFilter.value = chip.dataset.state;
      stateFilter.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  function renderKPICards() {
    const rows = D.datasetMeta?.rows || {};
    const hasMandiRecords = D.mandi.length > 0;
    const countUnique = key => new Set(
      D.mandi.map(record => record[key]).filter(value => value !== null && value !== undefined && String(value).trim())
    ).size;
    const kpis = [
      { icon:'fa-table-list', cls:'green', label:'Mandi Records', value: hasMandiRecords ? D.mandi.length : null, suffix:'', tip:'Rows in the exported mandi records JSON' },
      { icon:'fa-store', cls:'yellow', label:'Unique Markets', value: hasMandiRecords ? countUnique('market') : null, suffix:'', tip:'Distinct APMC mandi market names in the exported records' },
      { icon:'fa-wheat-awn', cls:'green', label:'Commodities', value: hasMandiRecords ? countUnique('commodity') : null, suffix:'', tip:'Distinct crop/commodity types in the exported records' },
      { icon:'fa-map-location-dot', cls:'blue', label:'Mandi States', value: hasMandiRecords ? countUnique('state') : null, suffix:'', tip:'States represented in the exported mandi price records' },
      { icon:'fa-map', cls:'blue', label:'Production States', value: D.prodStates.length || null, suffix:'', tip:'States and territories in the exported crop-production dataset' },
      { icon:'fa-seedling', cls:'green', label:'Crop Production Records', value: rows.crop_production ?? null, suffix:'', tip:'Rows counted in crop_production.csv' },
      { icon:'fa-comments', cls:'brown', label:'Farmer Queries', value: rows.farmer_queries ?? null, suffix:'', tip:'Rows counted in farmer_queries.csv' },
      { icon:'fa-cloud-showers-heavy', cls:'blue', label:'Rainfall Records', value: rows.rainfall_india ?? null, suffix:'', tip:'Rows counted in rainfall_india.csv' },
    ];

    const grid = document.getElementById('overviewKpiGrid');
    if (!grid) return;
    grid.innerHTML = kpis.map(k => `
      <div class="kpi-card" data-tip="${k.tip}">
        <div class="kpi-icon ${k.cls}"><i class="fa-solid ${k.icon}"></i></div>
        <div>
          <div class="kpi-value" ${Number.isFinite(k.value) ? `data-target="${k.value}"` : ''} data-format="${k.format||''}" data-suffix="${k.suffix}">${Number.isFinite(k.value) ? '0' : '—'}</div>
          <div class="kpi-label">${k.label}</div>
        </div>
      </div>
    `).join('');

    // Render counters immediately so background tabs never leave a visible zero.
    document.querySelectorAll('.kpi-value[data-target]').forEach(el => {
      const target = Number(el.dataset.target);
      if (!Number.isFinite(target)) return;
      const suffix = el.dataset.suffix || '';
      el.textContent = target.toLocaleString('en-IN') + suffix;
    });
  }

  function renderLastUpdated() {
    const target = document.getElementById('lastUpdated');
    if (!target) return;
    const language = document.documentElement.lang || 'en';
    const label = LABELS[language]?.lastUpdated || LABELS.en.lastUpdated;
    const timestamp = D.pipelineMeta?.generated_at || D.datasetMeta?.generated_at;
    const parsed = timestamp ? new Date(timestamp) : null;
    target.textContent = `${label}: ${parsed && !Number.isNaN(parsed.getTime()) ? parsed.toLocaleString(language) : '—'}`;
  }

  function renderPriceForecastStatus() {
    const forecastData = D.priceForecast;
    const status = document.getElementById('priceForecastStatus');
    const detail = document.getElementById('priceForecastDetail');
    if (!forecastData) {
      if (status) status.innerHTML = `<i class="fa-solid fa-circle-info" aria-hidden="true"></i><div><h4>${LABELS[document.documentElement.lang]?.priceCoverage || LABELS.en.priceCoverage}</h4><p>${LABELS[document.documentElement.lang]?.noData || LABELS.en.noData}</p></div>`;
      if (detail) detail.textContent = LABELS[document.documentElement.lang]?.noData || LABELS.en.noData;
      return;
    }
    const dates = Number(forecastData.distinct_dates);
    const months = Number(forecastData.distinct_months);
    const countText = `Mandi history: ${dates} distinct dates across ${months} months.`;
    const message = forecastData.message || (months < 12
      ? 'Not enough history for a price forecast'
      : 'A price forecast is available from the exported monthly history.');
    const forecastRows = Array.isArray(forecastData.forecast) ? forecastData.forecast : [];
    if (status) {
      status.innerHTML = `<i class="fa-solid ${months < 12 ? 'fa-circle-info' : 'fa-chart-line'}" aria-hidden="true"></i><div><h4>${message}</h4><p>${countText}</p>${
        months < 12
          ? '<p>A price forecast is withheld until at least 12 months of mandi history are available.</p>'
          : forecastRows.length
            ? `<p>${forecastRows.map(row => `${row.month}: ₹${Number(row.modal_price).toLocaleString('en-IN')}`).join(' · ')}</p>`
            : `<p>${LABELS[document.documentElement.lang]?.noData || LABELS.en.noData}</p>`
      }</div>`;
    }
    if (detail) detail.innerHTML = `<p>${message}</p><p>${countText}</p>${
      months < 12 ? '<p>A price forecast is withheld until at least 12 months of mandi history are available.</p>' : ''
    }`;
  }

  function initRoleSwitcher() {
    document.querySelectorAll('[data-role]').forEach(button => {
      button.addEventListener('click', () => {
        activeRole = button.dataset.role;
        document.querySelectorAll('[data-role]').forEach(item =>
          item.classList.toggle('active', item === button)
        );
        renderRoleDashboard();
      });
    });
  }

  function renderRoleDashboard() {
    const target = document.getElementById('roleDashboard');
    if (!target) return;
    const noData = label('noData');
    if (activeRole === 'farmer') {
      const crops = DataPrep.aggregateCropPrices(D.mandi);
      const markets = Object.values(D.mandi.reduce((result, row) => {
        const market = row.market || '';
        if (!result[market]) result[market] = { market, prices: [] };
        result[market].prices.push(Number(row.modal_price));
        return result;
      }, {})).map(item => ({
        market: item.market,
        average: item.prices.reduce((sum, value) => sum + value, 0) / item.prices.length
      })).sort((a, b) => b.average - a.average);
      if (!crops.length || !markets.length) {
        target.innerHTML = `<p class="empty-state-message">${noData}</p>`;
        return;
      }
      target.innerHTML = `<h3>${label('priceLeaders')}</h3><div class="role-results">
        <div><strong>${label('bestCrop')}</strong><span>${escapeHTML(crops[0].commodity)} — ₹${crops[0].modal_price.toLocaleString('en-IN')}/Qtl</span></div>
        <div><strong>${label('bestMarket')}</strong><span>${escapeHTML(markets[0].market)} — ₹${markets[0].average.toLocaleString('en-IN')}/Qtl</span></div>
      </div>`;
      return;
    }
    if (activeRole === 'policymaker') {
      if (!D.rainfallProduction.length) {
        target.innerHTML = `<p class="empty-state-message">${noData}</p>`;
        return;
      }
      const rows = [...D.rainfallProduction].sort((a, b) => b.production_total - a.production_total);
      const districtRows = D.topDistricts.length
        ? `<h3 style="margin-top:1rem">${label('topDistrictProduction')}</h3><div class="table-scroll"><table class="data-table"><thead><tr><th>${label('district')}</th><th>${label('production')}</th></tr></thead><tbody>${D.topDistricts.map(row => `<tr><td>${escapeHTML(row.district)}</td><td>${formatValue(row.production)}</td></tr>`).join('')}</tbody></table></div>`
        : `<p class="empty-state-message">${noData}</p>`;
      target.innerHTML = `<h3>${label('stateProductionRainfall')}</h3><div class="table-scroll"><table class="data-table">
        <thead><tr><th>${label('state')}</th><th>${label('productionTotal')}</th><th>${label('productionGap')}</th><th>${label('annualRainfall')}</th><th>${label('rainfallGap')}</th><th>${label('rainfallProductionCorrelation')}</th></tr></thead>
        <tbody>${rows.map(row => `<tr><td>${escapeHTML(row.state)}</td><td>${formatValue(row.production_total)}</td><td>${formatValue(row.production_gap_from_mean)}</td><td>${formatValue(row.avg_annual_rainfall_mm, 1)}</td><td>${formatValue(row.rainfall_gap_from_mean_mm, 1)}</td><td>${row.correlation === null ? '—' : formatValue(row.correlation, 3)}</td></tr>`).join('')}</tbody>
      </table></div>${districtRows}`;
      return;
    }
    const volatility = D.priceVolatility;
    const spreads = DataPrep.aggregateCropPrices(D.mandi);
    if (!volatility.length || !spreads.length) {
      target.innerHTML = `<p class="empty-state-message">${noData}</p>`;
      return;
    }
    const records = volatility.map(row => ({
      ...row,
      spread: spreads.find(item => item.commodity === row.crop)?.spread
    })).sort((a, b) => (b.coefficient_of_variation ?? -1) - (a.coefficient_of_variation ?? -1));
    target.innerHTML = `<h3>${label('volatilitySpread')}</h3><div class="table-scroll"><table class="data-table">
      <thead><tr><th>${label('crop')}</th><th>${label('coefficientVariation')}</th><th>${label('averageSpread')}</th><th>${label('priceRecords')}</th></tr></thead>
      <tbody>${records.map(row => `<tr><td>${escapeHTML(row.crop)}</td><td>${row.coefficient_of_variation === null ? '—' : `${formatValue(row.coefficient_of_variation * 100, 2)}%`}</td><td>${row.spread === undefined ? '—' : `₹${formatValue(row.spread, 2)}`}</td><td>${formatValue(row.records)}</td></tr>`).join('')}</tbody>
    </table></div>`;
  }

  function formatValue(value, decimals = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric)
      ? numeric.toLocaleString('en-IN', { maximumFractionDigits: decimals, minimumFractionDigits: decimals })
      : '—';
  }

  function renderInsightBoxes() {
    const container = document.getElementById('insightStripOverview');
    if (!container) return;
    if (!D.insights) {
      container.innerHTML = '<p class="empty-state-message">No exported insights are available yet.</p>';
      return;
    }
    const sentences = DataPrep.generateInsightSentences(D.insights);
    container.innerHTML = sentences.map(item => `
      <div class="insight-box">
        <h4><i class="fa-solid ${item.icon}"></i> ${item.label}</h4>
        <p>${item.text}</p>
      </div>
    `).join('');
  }

  /* ================================================================
     FILTERS — Price Analysis page
     ================================================================ */
  function initFilters() {
    const stateEl   = document.getElementById('priceStateFilter');
    const distEl    = document.getElementById('priceDistrictFilter');
    const commEl    = document.getElementById('priceCommodityFilter');

    const states = [...new Set(D.mandi.map(record => record.state).filter(Boolean))].sort();
    const mandiStates = new Set(states);
    const allDistricts = [...new Set(D.mandi.map(r=>r.district))].sort();
    const allComms = [...new Set(D.mandi.map(r=>r.commodity))].sort();

    function populateSelect(el, options, label) {
      if (!el) return;
      el.innerHTML = `<option value="all">${label}</option>` +
        options.map(o=>`<option value="${escapeHTML(o)}">${escapeHTML(o)}</option>`).join('');
    }

    if (stateEl) {
      stateEl.innerHTML = '<option value="all">All States</option>' +
        states.map(state => `<option value="${escapeHTML(state)}">${escapeHTML(state)}</option>`).join('');
    }
    populateSelect(distEl, allDistricts, 'All Districts');
    populateSelect(commEl, allComms, 'All Commodities');

    stateEl?.addEventListener('change', () => {
      activeFilters.state = stateEl.value;
      // Update district options dynamically
      const filtered = D.mandi.filter(r => activeFilters.state==='all' || r.state===activeFilters.state);
      const dists = [...new Set(filtered.map(r=>r.district))].sort();
      populateSelect(distEl, dists, 'All Districts');
      activeFilters.district = 'all';
      onFiltersChanged();
    });
    distEl?.addEventListener('change', () => { activeFilters.district = distEl.value; onFiltersChanged(); });
    commEl?.addEventListener('change', () => { activeFilters.commodity = commEl.value; onFiltersChanged(); });

    document.getElementById('resetPriceFilters')?.addEventListener('click', () => {
      activeFilters = { state:'all', district:'all', commodity:'all' };
      if (stateEl) stateEl.value = 'all';
      populateSelect(distEl, allDistricts, 'All Districts');
      if (commEl) commEl.value = 'all';
      onFiltersChanged();
    });

    // Top/Bottom toggle
    document.getElementById('topBtn')?.addEventListener('click', () => {
      topBottomMode = 'top';
      document.getElementById('topBtn').classList.add('active');
      document.getElementById('bottomBtn').classList.remove('active');
      Charts.topBottomCrops(getFilteredCropAgg(), 'top');
    });
    document.getElementById('bottomBtn')?.addEventListener('click', () => {
      topBottomMode = 'bottom';
      document.getElementById('bottomBtn').classList.add('active');
      document.getElementById('topBtn').classList.remove('active');
      Charts.topBottomCrops(getFilteredCropAgg(), 'bottom');
    });

    // Production state filter
    const prodStateEl = document.getElementById('prodStateFilter');
    const prodDistrictEl = document.getElementById('prodDistrictFilter');
    const prodCropEl = document.getElementById('prodCropFilter');
    const productionRows = D.productionSeries;
    const productionStates = [...new Set(productionRows.map(row => row.state).filter(Boolean))].sort();
    const refreshProductionFilters = () => {
      const stateRows = productionRows.filter(row =>
        productionFilters.state === 'all' || row.state === productionFilters.state
      );
      const districtRows = stateRows.filter(row =>
        productionFilters.district === 'all' || row.district === productionFilters.district
      );
      const districts = [...new Set(stateRows.map(row => row.district).filter(Boolean))].sort();
      const crops = [...new Set(districtRows.map(row => row.crop).filter(Boolean))].sort();
      populateSelect(prodDistrictEl, districts, 'All Districts');
      populateSelect(prodCropEl, crops, 'All Crops');
      if (prodDistrictEl) prodDistrictEl.value = productionFilters.district;
      if (prodCropEl) prodCropEl.value = productionFilters.crop;
    };
    if (prodStateEl) {
      populateSelect(prodStateEl, productionStates, 'All States');
      prodStateEl.addEventListener('change', () => {
        productionFilters.state = prodStateEl.value;
        productionFilters.district = 'all';
        productionFilters.crop = 'all';
        refreshProductionFilters();
        renderProductionCharts();
      });
      refreshProductionFilters();
    }
    prodDistrictEl?.addEventListener('change', () => {
      productionFilters.district = prodDistrictEl.value;
      productionFilters.crop = 'all';
      refreshProductionFilters();
      renderProductionCharts();
    });
    prodCropEl?.addEventListener('change', () => {
      productionFilters.crop = prodCropEl.value;
      renderProductionCharts();
    });

    // Rainfall subdivision filter
    const rainSubEl = document.getElementById('rainSubFilter');
    if (rainSubEl && D.rainfallBySub.subdivisions?.length) {
      populateSelect(rainSubEl, D.rainfallBySub.subdivisions, 'All Subdivisions (National Avg)');
      rainSubEl.addEventListener('change', () => {
        rainfallSubdivision = rainSubEl.value;
        renderRainfallCharts();
      });
    }

    // CSV download
    document.getElementById('csvDownloadBtn')?.addEventListener('click', downloadCSV);

    // Table search
    const searchEl = document.getElementById('tableSearch');
    searchEl?.addEventListener('input', () => {
      tableState.search = searchEl.value.toLowerCase().trim();
      tableState.page = 1;
      renderTable();
    });

    // Table sort headers
    document.querySelectorAll('.data-table th[data-col]').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.col;
        if (tableState.sortCol === col) {
          tableState.sortDir = tableState.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          tableState.sortCol = col;
          tableState.sortDir = 'desc';
        }
        document.querySelectorAll('.data-table th[data-col]').forEach(h => h.classList.remove('asc','desc'));
        th.classList.add(tableState.sortDir);
        tableState.page = 1;
        renderTable();
      });
    });
  }

  function getFilteredRecords() {
    return DataPrep.filterMandi(D.mandi, activeFilters);
  }

  function getFilteredCropAgg() {
    return DataPrep.aggregateCropPrices(getFilteredRecords());
  }

  function onFiltersChanged() {
    const filtered = getFilteredRecords();
    updateStatusStrip(filtered.length);
    const cropAgg = DataPrep.aggregateCropPrices(filtered);

    Charts.cropPriceSpectrum(cropAgg);
    Charts.priceSpread(cropAgg);
    Charts.topBottomCrops(cropAgg, topBottomMode);
    updateChartState('cropSpectrumCanvas', cropAgg.length > 0, 'No mandi price data is available.');
    updateChartState('priceSpreadCanvas', cropAgg.length > 0, 'No mandi price data is available.');
    updateChartState('topBottomCanvas', cropAgg.length > 0, 'No mandi price data is available.');

    renderHeatmap();
    tableState.page = 1;
    renderTable();
  }

  function updateStatusStrip(count) {
    const el = document.getElementById('priceStatusText');
    const badge = document.getElementById('priceMatchedBadge');
    if (!el) return;
    if (!D.mandi.length) {
      el.textContent = 'No exported mandi output is available yet.';
      if (badge) badge.textContent = '— Records';
      return;
    }
    const parts = [];
    if (activeFilters.state !== 'all') parts.push('State: ' + activeFilters.state);
    if (activeFilters.district !== 'all') parts.push('District: ' + activeFilters.district);
    if (activeFilters.commodity !== 'all') parts.push('Commodity: ' + activeFilters.commodity);
    el.textContent = parts.length ? 'Filtered by: ' + parts.join(' · ') : 'Showing all available mandi records';
    if (badge) badge.textContent = count + ' Records Matched';
  }

  /* ================================================================
     HEATMAP
     ================================================================ */
  function renderHeatmap() {
    const container = document.getElementById('heatmapWrap');
    if (!container) return;
    const records = getFilteredRecords();
    if (!records.length) {
      container.innerHTML = '<p class="empty-state-message">No state-by-commodity price data is available for these filters.</p>';
      return;
    }
    const data = {};
    records.forEach(record => {
      data[record.state] ||= {};
      const cell = data[record.state][record.commodity] ||= { total: 0, count: 0 };
      cell.total += record.modal_price;
      cell.count += 1;
    });
    const states = Object.keys(data).sort();
    const commodities = [...new Set(records.map(record => record.commodity))].sort();
    const dark = root.getAttribute('data-theme') === 'dark';

    // Collect all values to find global min/max
    let allVals = [];
    states.forEach(s => commodities.forEach(c => {
      const cell = data[s]?.[c];
      if (cell) allVals.push(cell.total / cell.count);
    }));
    const min = Math.min(...allVals);
    const max = Math.max(...allVals);

    const thead = `<tr><th>State / Commodity</th>${commodities.map(c=>`<th>${c.split('(')[0].trim()}</th>`).join('')}</tr>`;
    const tbody = states.map(s => {
      const cells = commodities.map(c => {
        const cell = data[s]?.[c];
        if (!cell) return `<td class="empty-cell">—</td>`;
        const v = cell.total / cell.count;
        const bg = DataPrep.heatmapColor(v, min, max, dark);
        const color = DataPrep.heatmapTextColor(v, min, max);
        return `<td style="background:${bg};color:${color}" data-tip="₹${v.toLocaleString('en-IN')}/Qtl">₹${v.toLocaleString('en-IN')}</td>`;
      }).join('');
      return `<tr><th>${s}</th>${cells}</tr>`;
    }).join('');

    container.innerHTML = `<table class="heatmap-table"><thead>${thead}</thead><tbody>${tbody}</tbody></table>`;
  }

  /* ================================================================
     MANDI TABLE (sortable, searchable, paginated)
     ================================================================ */
  function renderTable() {
    const tbody = document.getElementById('mandiTableBody');
    const pagDiv = document.getElementById('tablePagination');
    if (!tbody) return;

    let records = getFilteredRecords();

    // Search
    if (tableState.search) {
      const q = tableState.search;
      records = records.filter(r =>
        r.commodity.toLowerCase().includes(q) ||
        r.district.toLowerCase().includes(q) ||
        r.market.toLowerCase().includes(q) ||
        r.variety.toLowerCase().includes(q) ||
        r.state.toLowerCase().includes(q)
      );
    }

    // Sort
    const col = tableState.sortCol;
    records = [...records].sort((a, b) => {
      const av = a[col], bv = b[col];
      const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return tableState.sortDir === 'asc' ? cmp : -cmp;
    });

    const total = records.length;
    const totalPages = Math.max(1, Math.ceil(total / tableState.pageSize));
    tableState.page = Math.min(tableState.page, totalPages);
    const start = (tableState.page - 1) * tableState.pageSize;
    const page = records.slice(start, start + tableState.pageSize);

    if (page.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:2rem;color:var(--text-muted)">
        <i class="fa-solid fa-wheat-awn-circle-exclamation" style="font-size:1.4rem;display:block;margin-bottom:.5rem;color:var(--primary-lt)"></i>
        No records match the current filters.
      </td></tr>`;
    } else {
      tbody.innerHTML = page.map(r => `
        <tr>
          <td><strong>${r.commodity}</strong></td>
          <td>${r.district} <span style="font-size:.72rem;color:var(--text-muted)">(${r.state})</span></td>
          <td>${r.market}</td>
          <td>${r.variety}</td>
          <td>₹${r.min_price.toLocaleString('en-IN')}</td>
          <td class="price-tag">₹${r.modal_price.toLocaleString('en-IN')}</td>
          <td>₹${r.max_price.toLocaleString('en-IN')}</td>
          <td><span class="spread-tag">₹${r.spread.toFixed(0)}</span></td>
          <td>${r.arrival_date}</td>
        </tr>
      `).join('');
    }

    // Pagination
    if (pagDiv) {
      const prev = `<button class="page-btn" id="pagPrev" ${tableState.page<=1?'disabled':''}><i class="fa-solid fa-chevron-left"></i></button>`;
      const next = `<button class="page-btn" id="pagNext" ${tableState.page>=totalPages?'disabled':''}><i class="fa-solid fa-chevron-right"></i></button>`;
      const info = `<span style="font-size:.8rem;color:var(--text-muted);padding:0 .5rem">Page ${tableState.page} of ${totalPages} (${total} records)</span>`;

      let pageNums = '';
      for (let p = Math.max(1, tableState.page-2); p <= Math.min(totalPages, tableState.page+2); p++) {
        pageNums += `<button class="page-btn ${p===tableState.page?'active':''}" data-page="${p}">${p}</button>`;
      }
      pagDiv.innerHTML = prev + pageNums + info + next;

      pagDiv.querySelector('#pagPrev')?.addEventListener('click', () => { tableState.page--; renderTable(); });
      pagDiv.querySelector('#pagNext')?.addEventListener('click', () => { tableState.page++; renderTable(); });
      pagDiv.querySelectorAll('[data-page]').forEach(btn => {
        btn.addEventListener('click', () => { tableState.page = parseInt(btn.dataset.page); renderTable(); });
      });
    }
  }

  /* ================================================================
     CSV DOWNLOAD
     ================================================================ */
  function downloadCSV() {
    const records = getFilteredRecords();
    const headers = ['Commodity','State','District','Market','Variety','Grade','Min Price','Modal Price','Max Price','Spread','Arrival Date'];
    const rows = records.map(r =>
      [r.commodity, r.state, r.district, r.market, r.variety, r.grade,
       r.min_price, r.modal_price, r.max_price, r.spread, r.arrival_date]
      .map(v => `"${String(v).replace(/"/g,'""')}"`)
      .join(',')
    );
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'mandi_filtered.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* ================================================================
     RAINFALL CHARTS
     ================================================================ */
  function renderRainfallCharts() {
    const monthLabels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const subData = D.rainfallBySub?.monthly_avgs || {};

    let monthData;
    if (rainfallSubdivision === 'all') {
      // Average across all subdivisions
      monthData = monthLabels.map(m => {
        const vals = Object.values(subData).map(sd => sd[m]).filter(v=>v!==undefined);
        return vals.length ? +(vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(1) : null;
      });
    } else {
      monthData = monthLabels.map(m => subData[rainfallSubdivision]?.[m] ?? null);
    }

    const subLabel = rainfallSubdivision === 'all' ? 'All Subdivisions (National Avg)' : rainfallSubdivision;
    Charts.rainfallMonthly(monthLabels, monthData, subLabel);
    Charts.rainfallVsPrice(D.rainfallVsPrice);
    updateChartState('rainfallMonthlyCanvas', monthData.some(Number.isFinite), 'No rainfall output is available.');
    updateChartState('rainfallPriceCanvas', D.rainfallVsPrice.length > 0, 'No rainfall-vs-price output is available.');
  }

  /* ================================================================
     PRODUCTION CHARTS
     ================================================================ */
  function renderProductionCharts() {
    const rows = D.productionSeries.length
      ? D.productionSeries.filter(row =>
        (productionFilters.state === 'all' || row.state === productionFilters.state) &&
        (productionFilters.district === 'all' || row.district === productionFilters.district) &&
        (productionFilters.crop === 'all' || row.crop === productionFilters.crop)
      )
      : [];
    const crops = Object.values(rows.reduce((result, row) => {
      if (!result[row.crop]) result[row.crop] = { crop: row.crop, total_production: 0 };
      result[row.crop].total_production += Number(row.production) || 0;
      return result;
    }, {})).sort((a, b) => b.total_production - a.total_production);
    const seasons = Object.values(rows.reduce((result, row) => {
      if (!result[row.season]) result[row.season] = { season: row.season, total_production: 0, total_area: 0 };
      result[row.season].total_production += Number(row.production) || 0;
      result[row.season].total_area += Number(row.area) || 0;
      return result;
    }, {}));
    const years = Object.values(rows.reduce((result, row) => {
      const year = Number(row.year);
      if (!result[year]) result[year] = { year, total_production: 0 };
      result[year].total_production += Number(row.production) || 0;
      return result;
    }, {})).sort((a, b) => a.year - b.year);
    Charts.topCropsProduction(crops);
    Charts.productionBySeason(seasons);
    Charts.productionTrend(years);
    updateChartState('topCropsProdCanvas', crops.length > 0, 'No crop production output is available for these filters.');
    updateChartState('prodSeasonCanvas', seasons.length > 0, 'No season production output is available for these filters.');
    updateChartState('prodTrendCanvas', years.length > 0, 'No yearly production output is available for these filters.');
  }

  function renderForecastPage() {
    const notice = document.getElementById('forecastNotice');
    const metricsTable = document.getElementById('forecastMetrics');
    if (!D.forecast || !Array.isArray(D.forecast.actual) || !Array.isArray(D.forecast.forecasts)) {
      if (notice) notice.textContent = label('forecastUnavailable');
      if (metricsTable) metricsTable.innerHTML = `<p class="empty-state-message">${label('forecastMetricsUnavailable')}</p>`;
      setChartEmptyState('forecastActualCanvas', label('forecastMetricsUnavailable'));
      setChartEmptyState('forecastCompareCanvas', label('forecastMetricsUnavailable'));
      return;
    }
    const rows = Object.entries(D.forecast.metrics || {});
    if (!D.forecast.actual.length || !D.forecast.forecasts.length || !rows.length) {
      if (notice) notice.textContent = label('insufficientForecastHistory');
      if (metricsTable) metricsTable.innerHTML = `<p class="empty-state-message">${label('noForecastEstimates')}</p>`;
      setChartEmptyState('forecastActualCanvas', label('notEnoughForecastData'));
      setChartEmptyState('forecastCompareCanvas', label('notEnoughValidationData'));
      return;
    }
    updateChartState('forecastActualCanvas', true, '');
    updateChartState('forecastCompareCanvas', true, '');
    if (notice) notice.textContent = D.forecast.estimate_label || 'Estimated, not guaranteed';
    if (metricsTable) {
      const labels = {
        linear_regression: label('linearRegression'),
        random_forest: label('randomForest'),
        last_year_repeated: label('repeatedBaseline')
      };
      metricsTable.innerHTML = `<div class="table-scroll"><table class="data-table"><thead><tr><th>${label('model')}</th><th>MAE</th><th>RMSE</th><th>MAPE</th><th>${label('testPoints')}</th></tr></thead><tbody>
        ${rows.map(([model, metric]) => `<tr><td>${labels[model] || model}</td><td>${formatValue(metric.mae, 2)}</td><td>${formatValue(metric.rmse, 2)}</td><td>${metric.mape === null ? '—' : `${formatValue(metric.mape, 2)}%`}</td><td>${formatValue(metric.test_points)}</td></tr>`).join('')}
      </tbody></table></div>`;
    }
    Charts.productionForecast(D.forecast);
    Charts.forecastModelComparison(D.forecast.metrics);
  }

  function setChartEmptyState(canvasId, message) {
    const canvas = document.getElementById(canvasId);
    const wrapper = canvas?.parentElement;
    if (!canvas || !wrapper) return;
    canvas.hidden = true;
    let placeholder = wrapper.querySelector('.chart-empty-state');
    if (!placeholder) {
      placeholder = document.createElement('p');
      placeholder.className = 'chart-empty-state';
      wrapper.appendChild(placeholder);
    }
    placeholder.textContent = message;
  }

  function updateChartState(canvasId, hasData, message) {
    const canvas = document.getElementById(canvasId);
    const wrapper = canvas?.parentElement;
    if (!canvas || !wrapper) return;
    let placeholder = wrapper.querySelector('.chart-empty-state');
    if (hasData) {
      canvas.hidden = false;
      placeholder?.remove();
      return;
    }
    setChartEmptyState(canvasId, message);
  }

  /* ================================================================
     KEYWORD WORD-CLOUD
     ================================================================ */
  function renderWordCloud() {
    const container = document.getElementById('wordCloud');
    if (!container) return;
    if (!D.keywords.length) {
      container.innerHTML = '<p class="empty-state-message">Keyword results are not available.</p>';
      return;
    }
    const colors = ['#D32F2F','#1976D2','#388E3C','#0288D1','#F57F17'];
    const max = Math.max(...D.keywords.map(k=>k.frequency));
    container.innerHTML = D.keywords.map((k, i) => {
      const size = 0.85 + (k.frequency/max)*1.4;
      return `<span class="word-bubble" style="font-size:${size}rem;background:${colors[i]}22;color:${colors[i]};border:1.5px solid ${colors[i]}55" data-tip="${k.frequency.toLocaleString('en-IN')} mentions">
        ${k.keyword.toUpperCase()}
      </span>`;
    }).join('');
  }

  /* ================================================================
     INSIGHTS PAGE
     ================================================================ */
  function renderInsightsPage() {
    const hiveInsights = [
      {
        title:'Crop-wise Price Analysis',
        icon:'fa-chart-column',
        sql:`SELECT commodity,\n  MIN(min_price)      AS min_price,\n  AVG(modal_price)    AS avg_modal,\n  MAX(max_price)      AS max_price\nFROM hive_mandi_prices\nGROUP BY commodity;`,
        plain:'For each commodity traded at APMCs, what is the typical minimum, average, and maximum market price per quintal?',
        dataKey:'cropPriceTable'
      },
      {
        title:'District-wise Price Comparison',
        icon:'fa-map-pin',
        sql:`SELECT district, commodity,\n  AVG(modal_price) AS avg_modal\nFROM hive_mandi_prices\nGROUP BY district, commodity\nORDER BY avg_modal DESC;`,
        plain:'Which districts command the highest average prices for each commodity, helping identify premium markets?',
        dataKey:'districtTable'
      },
      {
        title:'Season-wise Price Trends (Kharif / Rabi / Zaid)',
        icon:'fa-calendar-days',
        sql:`SELECT\n  CASE WHEN MONTH(arrival_date) IN (6,7,8,9,10) THEN 'Kharif'\n       WHEN MONTH(arrival_date) IN (11,12,1,2,3) THEN 'Rabi'\n       ELSE 'Zaid' END AS season,\n  commodity, AVG(modal_price)\nFROM hive_mandi_prices\nGROUP BY season, commodity;`,
        plain:'Do prices vary significantly between Kharif (monsoon) and Rabi (winter) seasons for the same crop?',
        dataKey:'seasonTable'
      },
      {
        title:'Rainfall vs. Market Price Join',
        icon:'fa-cloud-rain',
        sql:`SELECT r.month_name, r.avg_rainfall,\n  AVG(m.modal_price) AS avg_price\nFROM hive_mandi_prices m\nJOIN hive_monthly_rainfall r\n  ON LOWER(m.state) = LOWER(r.state)\n  AND MONTH(m.arrival_date) = r.month_num\nGROUP BY r.month_name, r.avg_rainfall\nORDER BY r.month_num;`,
        plain:'Does higher monthly rainfall in a state correlate with lower or higher mandi modal prices? Rainfall SUBDIVISION is mapped to canonical state names via a lookup table in rainfall.pig.',
        dataKey:'rainfallJoinTable'
      },
      {
        title:'Keyword Mining (Apache Pig)',
        icon:'fa-comments',
        sql:`-- keywords.pig (Pig Latin)\nqueries = LOAD '/agri/farmer_queries'\n  USING PigStorage(',')\n  AS (question:chararray, answer:chararray);\ntokens = FOREACH queries GENERATE\n  FLATTEN(TOKENIZE(LOWER(CONCAT(question,' ',answer))));\nfiltered = FILTER tokens BY\n  $0 MATCHES '(rainfall|drought|flood|pest|yield)';\nkw_count = FOREACH (GROUP filtered BY $0)\n  GENERATE group, COUNT(filtered);`,
        plain:'Which agricultural stress terms occur most frequently in the farmer query dataset? Frequencies are taken from the exported Pig keyword results.',
        dataKey:'keywordTable'
      }
    ];

    const container = document.getElementById('hiveInsightsContainer');
    if (!container) return;
    container.innerHTML = hiveInsights.map((ins, idx) => `
      <div class="hive-card">
        <div class="hive-card-header">
          <h3><i class="fa-solid ${ins.icon}" style="color:var(--primary)"></i> ${ins.title}</h3>
          <span class="chart-badge">Query ${idx+1} of ${hiveInsights.length}</span>
        </div>
        <div class="hive-card-body">
          <div class="plain-english">${ins.plain}</div>
          <details style="margin-bottom:.9rem">
            <summary style="cursor:pointer;font-size:.84rem;font-weight:600;color:var(--text-muted);padding:.4rem 0">
              <i class="fa-solid fa-code" style="margin-right:.3rem;color:var(--primary)"></i>View HiveQL / Pig Latin
            </summary>
            <div class="code-block" style="margin-top:.5rem">${ins.sql}</div>
          </details>
          ${renderInsightResultTable(ins.dataKey)}
        </div>
      </div>
    `).join('');
  }

  function renderInsightResultTable(key) {
    const map = {
      cropPriceTable: () => {
        if (!D.mandi.length) return '<p class="empty-state-message">Mandi price output is unavailable.</p>';
        const rows = DataPrep.aggregateCropPrices(D.mandi);
        return `<table class="result-table"><thead><tr><th>Commodity</th><th>Min (₹)</th><th>Avg Modal (₹)</th><th>Max (₹)</th><th>Records</th></tr></thead><tbody>
          ${rows.map(r=>`<tr><td><strong>${r.commodity}</strong></td><td>${DataPrep.fmtINR(r.min_price)}</td><td class="price-tag">${DataPrep.fmtINR(r.modal_price)}</td><td>${DataPrep.fmtINR(r.max_price)}</td><td>${r.records}</td></tr>`).join('')}
        </tbody></table>`;
      },
      districtTable: () => {
        if (!D.mandi.length) return '<p class="empty-state-message">Mandi district output is unavailable.</p>';
        const rows = DataPrep.aggregateByDistrict(D.mandi);
        return `<table class="result-table"><thead><tr><th>District</th><th>Commodity</th><th>Avg Modal (₹)</th></tr></thead><tbody>
          ${rows.sort((a,b)=>b.avg_modal-a.avg_modal).map(r=>`<tr><td>${r.district}</td><td>${r.commodity}</td><td class="price-tag">${DataPrep.fmtINR(r.avg_modal)}</td></tr>`).join('')}
        </tbody></table>`;
      },
      seasonTable: () => {
        if (!D.seasonProd.length) return '<p class="text-muted" style="font-size:.84rem">Run export_results.sh to populate.</p>';
        return `<table class="result-table"><thead><tr><th>Season</th><th>Total Production</th><th>Cultivated Area</th><th>Records</th></tr></thead><tbody>
          ${D.seasonProd.map(s=>`<tr><td><strong>${s.season}</strong></td><td>${DataPrep.fmtMillions(s.total_production)} T</td><td>${DataPrep.fmtMillions(s.total_area)} Ha</td><td>${s.records.toLocaleString('en-IN')}</td></tr>`).join('')}
        </tbody></table>`;
      },
      rainfallJoinTable: () => {
        if (!D.rainfallVsPrice.length) return '<p class="text-muted" style="font-size:.84rem">Run export_results.sh to populate.</p>';
        return `<table class="result-table"><thead><tr><th>Month</th><th>Avg Rainfall (mm)</th><th>Avg Modal Price (₹)</th></tr></thead><tbody>
          ${D.rainfallVsPrice.map(r=>`<tr><td>${r.month}</td><td>${r.rainfall_mm} mm</td><td class="price-tag">₹${r.avg_modal_price.toLocaleString('en-IN')}</td></tr>`).join('')}
        </tbody></table>`;
      },
      keywordTable: () => {
        if (!D.keywords.length) return '<p class="text-muted" style="font-size:.84rem">Run keywords.pig to populate.</p>';
        return `<table class="result-table"><thead><tr><th>Keyword</th><th>Frequency</th><th>% of Total</th></tr></thead><tbody>
          ${D.keywords.map(k=>{ const total=D.keywords.reduce((a,b)=>a+b.frequency,0); return `<tr><td><strong>${k.keyword.toUpperCase()}</strong></td><td>${k.frequency.toLocaleString('en-IN')}</td><td>${((k.frequency/total)*100).toFixed(1)}%</td></tr>`;}).join('')}
        </tbody></table>`;
      }
    };
    const fn = map[key];
    return fn ? `<div class="result-table-wrap">${fn()}</div>` : '';
  }

  /* ================================================================
     RENDER ALL CHARTS
     ================================================================ */
  function renderAllCharts() {
    // Price page
    const cropAgg = DataPrep.aggregateCropPrices(D.mandi);
    Charts.cropPriceSpectrum(cropAgg);
    Charts.priceSpread(cropAgg);
    Charts.topBottomCrops(cropAgg, topBottomMode);
    updateChartState('cropSpectrumCanvas', cropAgg.length > 0, 'No mandi price data is available.');
    updateChartState('priceSpreadCanvas', cropAgg.length > 0, 'No mandi price data is available.');
    updateChartState('topBottomCanvas', cropAgg.length > 0, 'No mandi price data is available.');
    renderHeatmap();
    renderTable();
    updateStatusStrip(D.mandi.length);

    renderRainfallCharts();
    Charts.keywordBar(D.keywords);
    renderWordCloud();
    updateChartState('keywordCanvas', D.keywords.length > 0, 'Farmer-query keyword results are not available.');
    renderProductionCharts();
  }

  /* ================================================================
     CHART PNG DOWNLOADS — wire buttons
     ================================================================ */
  document.querySelectorAll('[data-download-chart]').forEach(btn => {
    btn.addEventListener('click', () => {
      Charts.downloadPNG(btn.dataset.downloadChart, btn.dataset.filename);
    });
  });

  /* ================================================================
     INIT
     ================================================================ */
  fetchAll();
});
