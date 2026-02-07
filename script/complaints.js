// Complaints page script
let complaintsData = [];

document.addEventListener('DOMContentLoaded', async () => {
    // Hardcoded backend base and uploads route per user request
    window.HARDCODED_API_BASE = 'http://127.0.0.1:5000';
    window.HARDCODED_UPLOADS_ROUTE = '/uploads';
    // fetch and render complaints
    fetchComplaintsFromServer();

    // Delegated click for Preliminary Action links
    document.getElementById('complaints-tbody').addEventListener('click', async (e) => {
        const link = e.target.closest('.preliminary-action-link');
        if (!link) return;
        e.preventDefault();
        const tr = link.closest('tr');
        const idx = parseInt(tr.dataset.rowIndex, 10);
        if (isNaN(idx) || !complaintsData[idx]) return;
        await handlePreliminaryAction(complaintsData[idx]);
    });
});

async function fetchComplaintsFromServer() {
    try {
    const base = window.HARDCODED_API_BASE || 'http://127.0.0.1:5000';
    const res = await fetch(base + '/api/complaints');
        if (!res.ok) {
            const txt = await res.text();
            throw new Error(txt || `HTTP ${res.status}`);
        }
        const data = await res.json();
        let complaints = data.rows || [];

        // If a category query param is present, filter results
        try{
            const params = new URLSearchParams(window.location.search);
            const category = params.get('category');
            if(category){
                const cat = decodeURIComponent(category).toLowerCase();
                complaints = complaints.filter(r => {
                    const t = (r.cybercrimeType || r.cybercrime_type || '').toString().toLowerCase();
                    return t === cat;
                });
                // Update header to show active filter and provide a clear link
                const h5 = document.querySelector('.card-header h5');
                if(h5){
                    h5.innerHTML = '<i class="fas fa-list"></i> Complaint Records ';
                    const badge = document.createElement('small');
                    badge.className = 'badge bg-light text-dark ms-2';
                    badge.textContent = `Category: ${decodeURIComponent(category)}`;
                    h5.appendChild(badge);
                    const clr = document.createElement('a');
                    clr.href = 'complaints.html';
                    clr.className = 'btn btn-sm btn-outline-light ms-2';
                    clr.textContent = 'Show All';
                    h5.appendChild(clr);
                }
            }
        }catch(e){ console.warn('Category filter parse failed', e); }

        complaintsData = complaints;
        appendRowsToTable(complaints);
    } catch (e) {
        console.error('Could not load complaints:', e);
        // leave table empty
    }
}

function appendRowsToTable(rows) {
    const tbody = document.getElementById('complaints-tbody');
    tbody.innerHTML = '';
    rows.forEach((complaint, i) => {
        const row = document.createElement('tr');
        row.dataset.rowIndex = i;
        const base = window.HARDCODED_API_BASE || 'http://127.0.0.1:5000';
        const saved = complaint.savedFilename || complaint.savedFilename || null;
        const fileLink = saved ? (base + '/uploads/' + encodeURIComponent(saved)) : null;

        row.innerHTML = `
            <td>${complaint.id || ''}</td>
            <td>${complaint.complaintDate || ''}</td>
            <td>${complaint.incidentDateTime || ''}</td>
            <td>${complaint.mobileNumber || ''}</td>
            <td>${complaint.emailId || ''}</td>
            <td>${complaint.fullAddress || ''}</td>
            <td>${complaint.districtState || ''}</td>
            <td>${complaint.cybercrimeType || ''}</td>
            <td>${complaint.platformInvolved || ''}</td>
            <td>${complaint.totalAmountLoss || ''}</td>
            <td>${complaint.currentStatus || ''}</td>
            <td>${complaint.processedDateTime || ''}</td>
            <td>${fileLink ? `<a href="${fileLink}" target="_blank" rel="noopener" class="view-details-link">Open File</a>` : '<span class="text-muted">N/A</span>'}</td>
            <td><a href="#" class="preliminary-action-link">Click Here</a></td>
        `;
        tbody.appendChild(row);
    });

    // initialize datatable
    if ($.fn.DataTable && $.fn.DataTable.isDataTable && $.fn.DataTable.isDataTable('#complaints-table')) {
        $('#complaints-table').DataTable().clear().destroy();
    }
    $('#complaints-table').DataTable({ pageLength: 10, lengthMenu: [5,10,25,50], responsive: true, order: [[0,'desc']] });
}

function complaintToMitigationPayload(complaint) {
    const ds = (complaint.districtState || '').split(', ');
    return {
        'Cybercrime Type': complaint.cybercrimeType || complaint.cybercrime_type || '',
        'Platform': complaint.platformInvolved || complaint.platform || '',
        'Total Amount Lost': complaint.totalAmountLoss || complaint.total_amount_lost || '',
        'State': ds[1] || ds[0] || '',
        'District': ds[0] || ''
    };
}

async function handlePreliminaryAction(complaint) {
    const base = window.HARDCODED_API_BASE || 'http://127.0.0.1:5000';
    const payload = complaintToMitigationPayload(complaint);
    Swal.fire({ title: 'Loading...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    try {
        const res = await fetch(base + '/api/mitigation', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        Swal.close();
        if (res.ok && data.mitigation_measures) {
            Swal.fire({
                title: 'Preliminary Action',
                html: `<div class="text-start" style="white-space: pre-wrap;">${escapeHtml(data.mitigation_measures)}</div>`,
                width: '560px',
                confirmButtonText: 'Close'
            });
        } else {
            Swal.fire({ icon: 'error', title: 'Error', text: data.error || 'Failed to get mitigation suggestions' });
        }
    } catch (e) {
        Swal.close();
        Swal.fire({ icon: 'error', title: 'Error', text: String(e) });
    }
}

function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function showToast(message, type='info'){
    Swal.fire({ toast:true, position:'top-end', showConfirmButton:false, timer:3000, icon:type, title:message });
}
