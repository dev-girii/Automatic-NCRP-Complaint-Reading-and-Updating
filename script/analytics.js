// Full analytics page script: creates six charts and modal enlargement. Renders only real data fetched from the backend.

(function () {
    if (typeof Chart === 'undefined') {
        console.warn('Chart.js not found. Include Chart.js to render analytics.');
        return;
    }

    const charts = {};
    // No demo/sample data: analytics will render only real data from the backend.

    const colors = ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc949', '#b07aa1', '#ff9da7'];

    function summarizeRows(rows) {
        // Build empty shapes as defaults; populate from rows when available
        const res = {
            crimeType: { labels: [], values: [] },
            monthlyTrend: { labels: [], values: [] },
            platformUsage: { labels: [], values: [] },
            caseStatus: { labels: [], values: [] },
            amountDistribution: { labels: [], values: [] },
            topDistricts: { labels: [], values: [] }
        };
        // crime types
        const tcounts = {};
        const pcounts = {};
        const statusCounts = {};
        const districtCounts = {};
        const amountBuckets = {'<1k':0, '1k-10k':0, '10k-50k':0, '>50k':0};

        rows.forEach(r => {
            const type = (r.cybercrimeType || 'Others').trim() || 'Others';
            tcounts[type] = (tcounts[type]||0) + 1;

            const platform = (r.platformInvolved || 'Unknown').trim() || 'Unknown';
            pcounts[platform] = (pcounts[platform]||0) + 1;

            const st = (r.currentStatus || 'Open').trim() || 'Open';
            statusCounts[st] = (statusCounts[st]||0) + 1;

            const d = (r.districtState || r.district || 'Unknown').trim() || 'Unknown';
            districtCounts[d] = (districtCounts[d]||0) + 1;

            const amt = Number(r.totalAmountLoss) || 0;
            if (amt <= 1000) amountBuckets['<1k']++;
            else if (amt <= 10000) amountBuckets['1k-10k']++;
            else if (amt <= 50000) amountBuckets['10k-50k']++;
            else amountBuckets['>50k']++;
        });

        // map into res shapes (take top N where appropriate)
        res.crimeType = { labels: Object.keys(tcounts).slice(0,10), values: Object.values(tcounts).slice(0,10) };

        const sortedDistricts = Object.entries(districtCounts).sort((a,b)=>b[1]-a[1]).slice(0,6);
        res.topDistricts = { labels: sortedDistricts.map(s=>s[0]), values: sortedDistricts.map(s=>s[1]) };
    // leave empty shapes if we couldn't derive values from rows

    res.amountDistribution = { labels: Object.keys(amountBuckets), values: Object.values(amountBuckets) };

        return res;
    }

    function createPie(ctx, labels, values) {
        return new Chart(ctx, { type: 'pie', data: { labels, datasets:[{ data: values, backgroundColor: colors }] }, options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{position:'bottom'}} } });
    }

    function createBar(ctx, labels, values, horizontal=false) {
        return new Chart(ctx, { type: horizontal ? 'bar' : 'bar', data: { labels, datasets:[{ label:'Count', data: values, backgroundColor: colors.slice(0, labels.length) }] }, options: { indexAxis: horizontal?'y':'x', responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}} } });
    }

    function createLine(ctx, labels, values) {
        return new Chart(ctx, { type: 'line', data: { labels, datasets:[{ label:'Incidents', data: values, borderColor: colors[0], backgroundColor: 'rgba(78,121,167,0.15)', fill:true }] }, options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}} } });
    }

    function renderAll(data) {
        // Destroy existing charts if present
        Object.values(charts).forEach(c=>{ try{ c.destroy(); }catch(e){} });
        // If there is no data for a chart, draw a simple "No data" message on its canvas
        function drawNoDataOnCanvas(id, message) {
            const canvas = document.getElementById(id);
            if (!canvas) return;
            try {
                const ctx = canvas.getContext('2d');
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.save();
                ctx.fillStyle = '#666';
                ctx.font = '14px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(message || 'No data available', canvas.width / 2, canvas.height / 2);
                ctx.restore();
            } catch (e) { /* ignore drawing errors */ }
        }

        if (data.crimeType && data.crimeType.labels && data.crimeType.labels.length) {
            charts.crimeType = createPie(document.getElementById('chartCrimeType').getContext('2d'), data.crimeType.labels, data.crimeType.values);
        } else {
            drawNoDataOnCanvas('chartCrimeType', 'No crime type data');
        }

        if (data.monthlyTrend && data.monthlyTrend.labels && data.monthlyTrend.labels.length) {
            charts.monthlyTrend = createLine(document.getElementById('chartMonthlyTrend').getContext('2d'), data.monthlyTrend.labels, data.monthlyTrend.values);
        } else {
            drawNoDataOnCanvas('chartMonthlyTrend', 'No trend data');
        }

        if (data.platformUsage && data.platformUsage.labels && data.platformUsage.labels.length) {
            charts.platformUsage = createBar(document.getElementById('chartPlatform').getContext('2d'), data.platformUsage.labels, data.platformUsage.values);
        } else {
            drawNoDataOnCanvas('chartPlatform', 'No platform data');
        }

        if (data.caseStatus && data.caseStatus.labels && data.caseStatus.labels.length) {
            charts.caseStatus = new Chart(document.getElementById('chartStatus').getContext('2d'), { type: 'doughnut', data:{ labels: data.caseStatus.labels, datasets:[{ data: data.caseStatus.values, backgroundColor: colors }] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{position:'bottom'}} } });
        } else {
            drawNoDataOnCanvas('chartStatus', 'No status data');
        }

        if (data.amountDistribution && data.amountDistribution.labels && data.amountDistribution.labels.length) {
            charts.amountDistribution = createBar(document.getElementById('chartAmount').getContext('2d'), data.amountDistribution.labels, data.amountDistribution.values);
        } else {
            drawNoDataOnCanvas('chartAmount', 'No amount data');
        }

        if (data.topDistricts && data.topDistricts.labels && data.topDistricts.labels.length) {
            charts.topDistricts = createBar(document.getElementById('chartDistricts').getContext('2d'), data.topDistricts.labels, data.topDistricts.values, true);
        } else {
            drawNoDataOnCanvas('chartDistricts', 'No district data');
        }
    }

    // modal handling
    let modalChart = null;
    const modalEl = document.getElementById('chartModal');
    const modal = modalEl ? new bootstrap.Modal(modalEl) : null;
    const modalCanvas = document.getElementById('modalChartCanvas');

    function openModalFor(key, title) {
        if (!charts[key]) return;
        if (modalChart) { try{ modalChart.destroy(); }catch(e){} modalChart = null; }
        const cfg = JSON.parse(JSON.stringify(charts[key].config));
        cfg.options = cfg.options || {};
        cfg.options.maintainAspectRatio = false;
        modalChart = new Chart(modalCanvas.getContext('2d'), cfg);
        document.getElementById('chartModalTitle').textContent = title || 'Chart';
        if (modal) modal.show();
    }

    function wireUI() {
        document.querySelectorAll('.view-larger').forEach(btn=>{
            btn.addEventListener('click', e=>{
                e.stopPropagation();
                const key = btn.getAttribute('data-chart');
                const title = btn.closest('.card').querySelector('.card-header h6').textContent;
                openModalFor(key, title);
            });
        });
        document.querySelectorAll('.chart-card').forEach(card=>{
            card.addEventListener('click', ()=>{
                const btn = card.querySelector('.view-larger');
                if (btn) btn.click();
            });
        });
    }

    async function loadAndRender() {
        // use hardcoded backend base URL
        let rows = [];
        try {
            const base = 'https://automatic-ncrp-complaint-reading-and.onrender.com';
            const r = await fetch(base + '/api/complaints');
            if (r.ok) {
                const js = await r.json();
                rows = js.rows || [];
            }
        } catch (e) {
            console.warn('Could not fetch complaints for analytics; no data will be shown', e);
        }

        if (rows.length) {
            const summary = summarizeRows(rows);
            renderAll(summary);
        } else {
            // no rows -> render empty/no-data state for all charts
            renderAll({ crimeType:{labels:[],values:[]}, monthlyTrend:{labels:[],values:[]}, platformUsage:{labels:[],values:[]}, caseStatus:{labels:[],values:[]}, amountDistribution:{labels:[],values:[]}, topDistricts:{labels:[],values:[]} });
        }
        wireUI();
    }

    window.addEventListener('load', loadAndRender);

})();
