// Full analytics page script: creates six demo charts and modal enlargement. Falls back to demo static data if /api/complaints fails.

(function () {
    if (typeof Chart === 'undefined') {
        console.warn('Chart.js not found. Include Chart.js to render analytics.');
        return;
    }

    const charts = {};
    // default demo data used if API fetch fails
    const demoData = {
        crimeType: { labels: ['Phishing', 'Fraud', 'Cyberstalking', 'Ransomware', 'Others'], values: [120, 90, 45, 15, 30] },
        monthlyTrend: { labels: ['Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan'], values: [40, 55, 70, 65, 85, 95] },
        platformUsage: { labels: ['WhatsApp', 'Facebook', 'Instagram', 'Email', 'SMS'], values: [80, 60, 45, 30, 20] },
        caseStatus: { labels: ['Open', 'In Progress', 'Closed', 'Referred'], values: [150, 60, 90, 10] },
        amountDistribution: { labels: ['<1k', '1k-10k', '10k-50k', '>50k'], values: [100, 80, 40, 20] },
        topDistricts: { labels: ['Coimbatore', 'Nilgiris', 'Erode', 'Tiruppur', 'Salem'], values: [45, 35, 30, 20, 18] }
    };

    const colors = ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc949', '#b07aa1', '#ff9da7'];

    function summarizeRows(rows) {
        const res = JSON.parse(JSON.stringify(demoData));
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
        if (!res.crimeType.labels.length) res.crimeType = demoData.crimeType;

        res.platformUsage = { labels: Object.keys(pcounts).slice(0,10), values: Object.values(pcounts).slice(0,10) };
        if (!res.platformUsage.labels.length) res.platformUsage = demoData.platformUsage;

        res.caseStatus = { labels: Object.keys(statusCounts), values: Object.values(statusCounts) };
        if (!res.caseStatus.labels.length) res.caseStatus = demoData.caseStatus;

        const sortedDistricts = Object.entries(districtCounts).sort((a,b)=>b[1]-a[1]).slice(0,6);
        res.topDistricts = { labels: sortedDistricts.map(s=>s[0]), values: sortedDistricts.map(s=>s[1]) };
        if (!res.topDistricts.labels.length) res.topDistricts = demoData.topDistricts;

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

        charts.crimeType = createPie(document.getElementById('chartCrimeType').getContext('2d'), data.crimeType.labels, data.crimeType.values);
        charts.monthlyTrend = createLine(document.getElementById('chartMonthlyTrend').getContext('2d'), data.monthlyTrend.labels, data.monthlyTrend.values || demoData.monthlyTrend.values);
        charts.platformUsage = createBar(document.getElementById('chartPlatform').getContext('2d'), data.platformUsage.labels, data.platformUsage.values);
        charts.caseStatus = new Chart(document.getElementById('chartStatus').getContext('2d'), { type: 'doughnut', data:{ labels: data.caseStatus.labels, datasets:[{ data: data.caseStatus.values, backgroundColor: colors }] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{position:'bottom'}} } });
        charts.amountDistribution = createBar(document.getElementById('chartAmount').getContext('2d'), data.amountDistribution.labels, data.amountDistribution.values);
        charts.topDistricts = createBar(document.getElementById('chartDistricts').getContext('2d'), data.topDistricts.labels, data.topDistricts.values, true);
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
            console.warn('Could not fetch complaints for analytics, using demo data', e);
        }

        const summary = rows.length ? summarizeRows(rows) : demoData;
        renderAll(summary);
        wireUI();
    }

    window.addEventListener('load', loadAndRender);

})();
