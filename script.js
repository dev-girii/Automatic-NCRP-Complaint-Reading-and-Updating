// Global variables
let isLoggedIn = false;
let totalComplaints = 0;
let highPriorityCount = 0;
let last24hCount = 0;
let mostCommonCrime = { type: null, count: 0 };

// Dummy credentials
const DUMMY_USERNAME = 'admin';
const DUMMY_PASSWORD = 'admin123';

// complaints/analytics-related sample data removed; dashboard keeps counters only
window.addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
    e.preventDefault();
  }
});

// Initialize the app
document.addEventListener('DOMContentLoaded', function() {
    // Load runtime config from backend (.env exposed via /api/config)
    initConfig().catch(err => console.warn('initConfig failed', err));

    document.getElementById('process-btn').addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    
    // Call your processFiles function
    processFiles();
    
    return false;
});

    // Check if already logged in
    if (localStorage.getItem('loggedIn') === 'true') {
        isLoggedIn = true;
        showPage('dashboard');
    } else {
        showPage('login');
    }

    // Login form submit
    document.getElementById('login-form').addEventListener('submit', handleLogin);

    // File input change
    document.getElementById('file-input').addEventListener('change', handleFileSelect);

    // Drag & Drop functionality
    const dropZone = document.getElementById('drop-zone');
    if (dropZone) {
        dropZone.addEventListener('click', () => document.getElementById('file-input').click());
        dropZone.addEventListener('dragover', handleDragOver);
        dropZone.addEventListener('dragleave', handleDragLeave);
        dropZone.addEventListener('drop', handleDrop);
    }

    // Process button click -> upload to backend for processing. prevent form submit refresh
    // Use capture phase and stopImmediatePropagation to prevent any other handlers or form submits from firing
    const _procBtn = document.getElementById('process-btn');
    if (_procBtn) {
        _procBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopImmediatePropagation();
            processFiles();
            return false;
        }, true); // capture
    }

    // No complaints/analytics initialization here; those pages are separate.
    // Initialize Bootstrap tooltips (for info icons etc.)
    try{
        if (typeof bootstrap !== 'undefined' && bootstrap.Tooltip) {
            var tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
            tooltipTriggerList.map(function (el) { return new bootstrap.Tooltip(el); });
        }
    }catch(e){ console.debug('Tooltip init failed', e); }

    // Load stats for dashboard
    // Ensure config loaded before requesting stats (loadStats uses window.API_BASE)
    (async () => { try { await initConfig(); } catch(_){}; loadStats(); })();
});


// Fetch runtime config from backend (/api/config) and set window.API_BASE / window.UPLOADS_ROUTE
async function initConfig() {
    try {
        const res = await fetch('/api/config');
        if (!res.ok) throw new Error('config fetch failed');
        const cfg = await res.json();
        window.API_BASE = cfg.API_BASE || cfg.api_base || window.API_BASE || 'http://localhost:5000';
        window.UPLOADS_ROUTE = cfg.UPLOADS_ROUTE || cfg.uploads_route || '/uploads';
        console.info('Loaded runtime config', { API_BASE: window.API_BASE, UPLOADS_ROUTE: window.UPLOADS_ROUTE });
        return cfg;
    } catch (e) {
        // fallback defaults
        window.API_BASE = window.API_BASE || 'http://localhost:5000';
        window.UPLOADS_ROUTE = window.UPLOADS_ROUTE || '/uploads';
        console.warn('Could not load /api/config, using defaults', e);
        return null;
    }
}

// Prevent anchor links with href="#" from navigating
document.addEventListener('click', function(e) {
    const el = e.target.closest && e.target.closest('a');
    if (el && el.getAttribute && el.getAttribute('href') === '#') {
        e.preventDefault();
    }
}, true);

// beforeunload guard for long running operations (setBusy(true) to enable)
function setBusy(on) {
    if (on) {
        window.onbeforeunload = function() { return 'Operation in progress - are you sure you want to leave?'; };
    } else {
        window.onbeforeunload = null;
    }
}

// Show specific page
function showPage(page) {
    // Only manage pages that exist in index.html (login and dashboard)
    const pages = ['login', 'dashboard'];
    pages.forEach(p => {
        const el = document.getElementById(p + '-page');
        if (el) el.classList.add('d-none');
    });
    const target = document.getElementById(page + '-page');
    if (target) target.classList.remove('d-none');
}

// Handle login
function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    if (username === DUMMY_USERNAME && password === DUMMY_PASSWORD) {
        isLoggedIn = true;
        localStorage.setItem('loggedIn', 'true');
        showPage('dashboard');
        Swal.fire({
            icon: 'success',
            title: 'Login Successful',
            text: 'Welcome to the dashboard',
        });
    } else {
        Swal.fire({
            icon: 'error',
            title: 'Login Failed',
            text: 'Invalid credentials',
        });
    }
}

// Logout
function logout() {
    isLoggedIn = false;
    localStorage.removeItem('loggedIn');
    totalComplaints = 0;
    highPriorityCount = 0;
    last24hCount = 0;
    mostCommonCrime = { type: null, count: 0 };
    updateCounters();
    showPage('login');
    Swal.fire({
        icon: 'info',
        title: 'Logged Out',
        text: 'You have been logged out successfully',
    });
}

// Handle file selection
function handleFileSelect(e) {
    const files = e.target.files;
    displayFiles(files);
}

// Drag & Drop handlers
function handleDragOver(e) {
    e.preventDefault();
    e.currentTarget.classList.add('dragover');
}

function handleDragLeave(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('dragover');
}

function handleDrop(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('dragover');
    const files = e.dataTransfer.files;
    displayFiles(files);
    // Update the hidden input
    document.getElementById('file-input').files = files;
}

// Display selected files
function displayFiles(files) {
    const fileList = document.getElementById('file-list');
    fileList.innerHTML = '';

    if (files.length > 0) {
        document.getElementById('process-btn').disabled = false;
        for (let file of files) {
            const fileItem = document.createElement('div');
            fileItem.className = 'file-item d-flex align-items-center justify-content-between p-2 border rounded mb-2';
            fileItem.innerHTML = `
                <div>
                    <i class="fas fa-file-${getFileIcon(file.type)} text-primary me-2"></i>
                    <span>${file.name}</span>
                    <small class="text-muted">(${formatFileSize(file.size)})</small>
                </div>
                <button type="button" class="btn btn-sm btn-outline-danger" onclick="removeFile(this, '${file.name}')">
                    <i class="fas fa-times"></i>
                </button>
            `;
            fileList.appendChild(fileItem);
        }
    } else {
        document.getElementById('process-btn').disabled = true;
    }
}

function getFileIcon(type) {
    if (!type) return 'alt';
    if (type.includes('csv')) return 'csv';
    if (type.includes('image') || type.includes('jpeg') || type.includes('png')) return 'image';
    if (type.includes('spreadsheet') || type.includes('excel')) return 'excel';
    if (type.includes('pdf')) return 'pdf';
    return 'alt';
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function removeFile(button, fileName) {
    // This is a simplified removal - in a real app, you'd need to manage the FileList properly
    button.closest('.file-item').remove();
    // For demo purposes, we'll just clear all files
    document.getElementById('file-input').value = '';
    document.getElementById('file-list').innerHTML = '';
    document.getElementById('process-btn').disabled = true;
}

// Process files
async function processFiles() {
    console.debug('processFiles triggered');
    const files = document.getElementById('file-input').files;
    if (!files || files.length === 0) {
        Swal.fire({ icon: 'warning', title: 'No files', text: 'Please select files to process' });
        return;
    }

    const form = new FormData();
    for (let f of files) form.append('files', f);

    // show loader and protect from navigation
    setBusy(true);
    Swal.fire({ title: 'Uploading...', text: 'Uploading files to server for extraction', allowOutsideClick: false, didOpen: () => { Swal.showLoading(); } });

    try {
    const uploadUrl = (window.API_BASE || 'http://localhost:5000') + '/api/upload';
    console.info('Uploading to', uploadUrl);
    const res = await fetch(uploadUrl, { method: 'POST', body: form });
        const text = await res.text();
        Swal.close();
        if (!text) throw new Error('Empty response from server');
        let data;
        try {
            data = JSON.parse(text);
        } catch (err) {
            console.error('Non-JSON response from upload:', text);
            throw new Error('Invalid response from server');
        }
        if (!res.ok) throw new Error(data.error || 'Upload failed');

        const rows = data.rows || [];
        // Save extracted rows to session storage and redirect to verify page
        try {
            sessionStorage.setItem('ncrp_pending_rows', JSON.stringify({ rows: rows, files: data.files || [] }));
        } catch (e) {
            console.warn('Could not store pending rows in sessionStorage:', e);
        }
    // Redirect to verification page where user can approve/deny
    // Clear the busy/unload guard before navigating so browser doesn't show a "Leave site" prompt
    try { setBusy(false); } catch (_) {}
    window.location.href = 'verify.html';

    } catch (err) {
        Swal.fire({ icon: 'error', title: 'Upload failed', text: String(err) });
    } finally {
        setBusy(false);
    }
}


let _verificationDecisions = [];

function setDecision(idx, val) {
    _verificationDecisions[idx] = val;
    const allowBtn = document.getElementById(`allow-btn-${idx}`);
    const denyBtn = document.getElementById(`deny-btn-${idx}`);
    if (!allowBtn || !denyBtn) return;
    if (val === 'allow') {
        allowBtn.classList.remove('btn-outline-secondary');
        allowBtn.classList.add('btn-success');
        denyBtn.classList.remove('btn-danger');
        denyBtn.classList.add('btn-outline-secondary');
    } else {
        denyBtn.classList.remove('btn-outline-secondary');
        denyBtn.classList.add('btn-danger');
        allowBtn.classList.remove('btn-success');
        allowBtn.classList.add('btn-outline-secondary');
    }
}

function getRowDisplayValue(row) {
    // Try common fields for display
    return row['Complaint ID'] || row['complaint_id'] || row['id'] || row['ComplaintId'] || JSON.stringify(row);
}

function showVerificationModal(rows) {
    if (!rows || rows.length === 0) {
        Swal.fire({ icon: 'info', title: 'No data extracted', text: 'No rows were extracted from the uploaded files.' });
        return;
    }

    // Initialize decisions to 'allow' by default
    _verificationDecisions = rows.map(() => 'allow');

    // Build a compact table showing key fields and allow/deny buttons
    let html = '<div style="max-height:60vh;overflow:auto"><table class="table table-sm table-bordered">';
    html += '<thead class="table-light"><tr><th>#</th><th>Preview</th><th>Actions</th></tr></thead><tbody>';
    rows.forEach((r, i) => {
        const preview = escapeHtml(String(getRowDisplayValue(r)));
        html += `<tr><td>${i+1}</td><td style="max-width:60vw;word-break:break-word">${preview}</td><td>`;
    html += `<button type="button" id="allow-btn-${i}" class="btn btn-sm btn-success me-2" onclick="setDecision(${i}, 'allow')">ALLOW</button>`;
    html += `<button type="button" id="deny-btn-${i}" class="btn btn-sm btn-outline-secondary" onclick="setDecision(${i}, 'deny')">DENY</button>`;
        html += '</td></tr>';
    });
    html += '</tbody></table></div>';

    Swal.fire({
        title: `Extracted ${rows.length} item(s)` ,
        html: html,
        width: '80%',
        showCancelButton: true,
        confirmButtonText: 'Submit Decisions',
        cancelButtonText: 'Cancel',
        allowOutsideClick: false,
        didOpen: () => {
            // ensure initial button styles are applied (defaults already allow)
            rows.forEach((_, i) => setDecision(i, 'allow'));
        }
    }).then(async (result) => {
        if (result.isConfirmed) {
            // Collect allowed rows
            const allowedRows = rows.filter((r, i) => _verificationDecisions[i] === 'allow');
            if (!allowedRows.length) {
                Swal.fire({ icon: 'warning', title: 'No rows allowed', text: 'You did not allow any rows to be saved.' });
                return;
            }

            // Show saving loader and guard navigation
            setBusy(true);
            Swal.fire({ title: 'Saving allowed rows...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
            try {
                const verifyUrl = (window.API_BASE || 'http://localhost:5000') + '/api/verify';
                const res = await fetch(verifyUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', rows: allowedRows }) });
                let jr = {};
                try { jr = await res.json(); } catch (e) { jr = {}; }
                Swal.close();
                if (res.ok) {
                    const savedCount = jr.saved_count || 0;
                    const failedCount = jr.failed_count || 0;
                    // Refresh stats from server to reflect saved rows
                    try { await loadStats(); } catch(e) { console.warn('Could not refresh stats after save', e); }

                    if (failedCount && failedCount > 0) {
                        // Build readable failure message
                        const msgs = jr.failed.map(f => {
                            const id = f.row && (f.row['Complaint ID'] || f.row['complaint_id'] || f.row.id) ? (f.row['Complaint ID'] || f.row['complaint_id'] || f.row.id) : `index ${f.index}`;
                            return `${id}: ${f.error}`;
                        });
                        Swal.fire({ icon: 'warning', title: `${savedCount} saved, ${failedCount} failed`, html: `<pre style="text-align:left;max-height:200px;overflow:auto">${escapeHtml(msgs.join('\n'))}</pre>` });
                    } else {
                        showToast(`Saved ${savedCount} rows`, 'success');
                    }
                } else {
                    const msg = jr.error || `HTTP ${res.status}`;
                    Swal.fire({ icon: 'error', title: 'Save failed', text: String(msg) });
                }
            } catch (e) {
                Swal.close();
                Swal.fire({ icon: 'error', title: 'Save failed', text: String(e) });
            } finally {
                setBusy(false);
            }
        } else if (result.isDismissed) {
            // Cancelled by user
        }
    });
}

// small helper to escape HTML in inserted content
function escapeHtml(unsafe) {
    return unsafe.replace(/[&<"'`=\\\/]/g, function (s) {
        return ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
            '/': '&#x2F;',
            '`': '&#x60;',
            '=': '&#x3D;'
        })[s];
    });
}


function showToast(message, type = 'info') {
    // Using SweetAlert2 toast
    Swal.fire({
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 3000,
        icon: type,
        title: message
    });
}

// Read file content
function readFile(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
                if (file.type === 'text/csv' || file.name.endsWith('.csv')) {
                resolve(e.target.result);
                } else if (file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || file.name.endsWith('.xlsx')) {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const csv = XLSX.utils.sheet_to_csv(worksheet);
                resolve(csv);
            } else if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
                // For PDF, we'll extract text
                const typedarray = new Uint8Array(e.target.result);
                pdfjsLib.getDocument(typedarray).promise.then(function(pdf) {
                    let text = '';
                    const numPages = pdf.numPages;
                    let promises = [];
                    for (let i = 1; i <= numPages; i++) {
                        promises.push(pdf.getPage(i).then(function(page) {
                            return page.getTextContent();
                        }));
                    }
                    Promise.all(promises).then(function(textContents) {
                        textContents.forEach(function(textContent) {
                            textContent.items.forEach(function(item) {
                                text += item.str + ' ';
                            });
                            text += '\n';
                        });
                        resolve(text);
                    });
                });
            } else if (file.type && file.type.startsWith('image/') || file.name.match(/\.(jpg|jpeg|png)$/i)) {
                // For images, return a data URL (useful for previews or when sending inline)
                resolve(e.target.result);
            } else {
                resolve(null);
            }
        };
        if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
            reader.readAsArrayBuffer(file);
        } else if (file.type && file.type.startsWith('image/') || file.name.match(/\.(jpg|jpeg|png)$/i)) {
            reader.readAsDataURL(file);
        } else {
            reader.readAsText(file);
        }
    });
}

// Parse data into complaints
function parseData(data, type) {
    const complaints = [];
    if (type === 'text/csv' || type.includes('spreadsheet') || type === 'application/pdf') {
        // Simple parsing: assume CSV-like format or extract from PDF text
        const lines = data.split('\n');
        for (let i = 1; i < lines.length; i++) { // Skip header
            const parts = lines[i].split(',');
            if (parts.length >= 5) {
                complaints.push({
                    id: parts[0].trim(),
                    type: parts[1].trim(),
                    platform: parts[2].trim(),
                    description: parts[3].trim(),
                    date: parts[4].trim()
                });
            }
        }
    }
    return complaints;
}

// Update dashboard counters
function updateCounters() {
    // Animate numeric counters
    animateCounter('total-complaints', totalComplaints);
    animateCounter('high-priority', highPriorityCount);
    animateCounter('last-24h', last24hCount);
    // Most common is a string label + optional count
    const mcEl = document.getElementById('most-common');
    const mcCountEl = document.getElementById('most-common-count');
    if (mcEl) mcEl.textContent = mostCommonCrime.type || '-';
    if (mcCountEl) mcCountEl.textContent = mostCommonCrime.count ? `${mostCommonCrime.count} case(s)` : '';
}

// Animate counter updates
function animateCounter(elementId, targetValue) {
    const element = document.getElementById(elementId);
    if (!element) return;
    const currentValue = parseInt(element.textContent) || 0;
    const target = Number(targetValue) || 0;
    const diff = target - currentValue;
    if (diff === 0) {
        element.textContent = target;
        return;
    }
    const duration = 800; // ms
    const steps = Math.min(Math.abs(diff), 60);
    const stepDuration = Math.max(10, Math.floor(duration / steps));
    const increment = diff / steps;
    let current = currentValue;
    let i = 0;
    const timer = setInterval(() => {
        i++;
        current = current + increment;
        element.textContent = Math.round(current);
        if (i >= steps) {
            element.textContent = target;
            clearInterval(timer);
        }
    }, stepDuration);
}

// Fetch complaints and compute dashboard stats
async function loadStats(){
    try{
        const base = window.API_BASE || 'http://localhost:5000';
        const res = await fetch(base + '/api/complaints');
        if(!res.ok){
            console.warn('Could not load complaints for stats', res.status);
            return;
        }
        const body = await res.json();
        const rows = body.rows || [];

        // Total
        totalComplaints = rows.length;

        // High priority: amount > 50000 OR crime type contains keywords
        const keywords = ['kidnap','kidnapping','threat','extortion','emergency'];
        highPriorityCount = rows.reduce((acc, r) => {
            let amt = 0;
            try{
                const s = r.totalAmountLoss || r.total_amount_lost || r.totalAmount || r.totalAmountLoss;
                if(s!=null){
                    amt = parseFloat(String(s).replace(/[^0-9.-]+/g, '')) || 0;
                }
            }catch(e){ amt = 0; }
            const type = (r.cybercrimeType || r.cybercrime_type || '') + '';
            const t = type.toLowerCase();
            const hasKeyword = keywords.some(k => t.includes(k));
            if (amt > 50000 || hasKeyword) return acc + 1;
            return acc;
        }, 0);

        // Last 24 hours
        const now = Date.now();
        last24hCount = rows.reduce((acc, r) => {
            const dtStr = r.processedDateTime || r.created_at || r.complaintDate || r.incidentDateTime;
            if(!dtStr) return acc;
            const d = new Date(dtStr);
            if(isNaN(d.getTime())) return acc;
            if ((now - d.getTime()) <= 24 * 3600 * 1000) return acc + 1;
            return acc;
        }, 0);

        // Most common crime type
        const counts = {};
        rows.forEach(r => {
            const key = (r.cybercrimeType || r.cybercrime_type || 'Unknown') || 'Unknown';
            const k = String(key).trim() || 'Unknown';
            counts[k] = (counts[k] || 0) + 1;
        });
        let mc = { type: null, count: 0 };
        Object.keys(counts).forEach(k => {
            if(counts[k] > mc.count){ mc = { type: k, count: counts[k] }; }
        });
        mostCommonCrime = mc;

        // Update dashboard
        updateCounters();

        // Render crime awareness list dynamically from DB results
        try{
            renderCrimeAwareness(rows);
        }catch(e){ console.warn('renderCrimeAwareness failed', e); }
    }catch(e){
        console.error('loadStats failed', e);
    }
}

function renderCrimeAwareness(rows){
    const container = document.getElementById('crime-awareness-list');
    if(!container) return;
    // Build counts by type
    const counts = {};
    rows.forEach(r => {
        const key = (r.cybercrimeType || r.cybercrime_type || r.type || r.cybercrime || 'Unknown') || 'Unknown';
        const k = String(key).trim() || 'Unknown';
        counts[k] = (counts[k] || 0) + 1;
    });
    // Sort by count desc
    const items = Object.keys(counts).map(k => ({type: k, count: counts[k]})).sort((a,b)=> b.count - a.count);

    // Build HTML
    if(items.length === 0){
        container.innerHTML = '<div class="text-muted">No crime categories found in database.</div>';
        return;
    }
    const frag = document.createDocumentFragment();
        items.forEach(it => {
        const div = document.createElement('div');
        div.className = 'crime-item mb-3 d-flex align-items-center';
        // pick an icon by heuristics
        let icon = 'fa-shield-alt text-secondary';
        const t = it.type.toLowerCase();
        if(t.includes('fraud') || t.includes('payment') || t.includes('financial')) icon = 'fa-credit-card text-success';
        else if(t.includes('phish')) icon = 'fa-fish text-warning';
        else if(t.includes('identity')) icon = 'fa-id-card text-info';
        else if(t.includes('stalk') || t.includes('stalking')) icon = 'fa-eye text-secondary';
        else if(t.includes('kidnap')) icon = 'fa-user-secret text-danger';

        // create link to complaints page filtered by category
        const link = document.createElement('a');
        link.href = `complaints.html?category=${encodeURIComponent(it.type)}`;
        link.className = 'd-flex align-items-center w-100 text-decoration-none text-body';
        link.innerHTML = `<i class="fas ${icon} me-2"></i><span class="ms-2">${escapeHtml(it.type)}</span>`;

        const badge = document.createElement('span');
        badge.className = 'badge bg-secondary ms-auto';
        badge.textContent = it.count;

        div.appendChild(link);
        div.appendChild(badge);
        frag.appendChild(div);
    });
    // Append a final small explanation line
    const info = document.createElement('div');
    info.className = 'alert alert-info mt-3';
    info.innerHTML = '<small><i class="fas fa-info-circle"></i> The counts above are pulled from the database (most recent 1000 records).</small>';
    container.innerHTML = '';
    container.appendChild(frag);
    container.appendChild(info);
}

// Complaints table rendering removed from index; handled in complaints.html script

// Preliminary action handling removed from index (belongs to complaints page)

// Charts rendering removed from index (handled in analytics.html script)

// Load sample data for demo
// Complaints/analytics fetching and table/chart rendering removed from index. Those features are implemented
// in their respective page scripts (complaints.js / analytics.js).