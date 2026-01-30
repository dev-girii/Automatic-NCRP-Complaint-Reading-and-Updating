// verify.js - handles the verify.html page with editable table
(function () {
  const API_BASE = 'http://127.0.0.1:5000';
  const COLUMNS = [
    'Source', 'Complaint ID', 'Complaint Date', 'Incident Date & Time', 'Mobile', 'Email',
    'Full Address', 'District', 'State', 'Cybercrime Type', 'Platform', 'Total Amount Lost', 'Current Status'
  ];

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<"'`=\\/]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '/': '&#x2F;', '`': '&#x60;', '=': '&#x3D;' })[c];
    });
  }

  function loadPending() {
    try {
      const raw = sessionStorage.getItem('ncrp_pending_rows');
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      console.error('Failed to read pending rows', e);
      return null;
    }
  }

  function getRowValue(row, col) {
    const key = col;
    const snake = col.replace(/\s+/g, '_').replace(/&/g, '').toLowerCase();
    const aliases = {
      'Complaint ID': ['complaint_id', 'id', 'ComplaintId'],
      'Complaint Date': ['complaint_date'],
      'Incident Date & Time': ['incident_datetime', 'incident_date'],
      'Mobile': ['mobile'],
      'Email': ['email'],
      'Full Address': ['full_address'],
      'District': ['district'],
      'State': ['state'],
      'Cybercrime Type': ['cybercrime_type'],
      'Platform': ['platform'],
      'Total Amount Lost': ['total_amount_lost'],
      'Current Status': ['current_status']
    };
    if (row[key] != null && row[key] !== '') return row[key];
    const list = aliases[col];
    if (list) for (const a of list) if (row[a] != null && row[a] !== '') return row[a];
    return '';
  }

  function renderTable(pending) {
    const tbody = document.querySelector('#verify-table tbody');
    tbody.innerHTML = '';

    pending.rows.forEach((r, i) => {
      const tr = document.createElement('tr');
      tr.dataset.idx = i;
      let cells = '';
      cells += `<td class="text-center align-middle">${i + 1}</td>`;
      COLUMNS.forEach(col => {
        const val = getRowValue(r, col);
        const rawVal = String(val == null ? '' : val);
        const safeVal = escapeHtml(rawVal);
        cells += `<td><input type="text" class="form-control form-control-sm editable-cell" data-col="${escapeHtml(col)}" data-idx="${i}" value="${safeVal}" placeholder="${escapeHtml(col)}"></td>`;
      });
      cells += `<td class="text-nowrap align-middle">
        <button type="button" class="btn btn-sm btn-success me-1" data-idx="${i}" data-decision="allow">Allow</button>
        <button type="button" class="btn btn-sm btn-outline-secondary" data-idx="${i}" data-decision="deny">Deny</button>
      </td>`;
      tr.innerHTML = cells;
      tbody.appendChild(tr);
    });

    document.querySelectorAll('#verify-table button[data-idx]').forEach(btn => {
      btn.addEventListener('click', function () {
        const idx = Number(this.dataset.idx);
        const dec = this.dataset.decision;
        setDecision(idx, dec);
      });
    });

    if ($.fn.DataTable && $.fn.DataTable.isDataTable('#verify-table')) {
      $('#verify-table').DataTable().destroy();
    }
    $('#verify-table').DataTable({ pageLength: 10, lengthMenu: [5, 10, 25], scrollX: true });
  }

  let decisions = [];
  function setDecision(i, val) {
    decisions[i] = val;
    const row = document.querySelector(`#verify-table tr[data-idx="${i}"]`);
    if (!row) return;
    const allow = row.querySelector('button[data-decision="allow"]');
    const deny = row.querySelector('button[data-decision="deny"]');
    if (!allow || !deny) return;
    if (val === 'allow') {
      allow.classList.remove('btn-outline-secondary');
      allow.classList.add('btn-success');
      deny.classList.remove('btn-danger');
      deny.classList.add('btn-outline-secondary');
    } else {
      deny.classList.remove('btn-outline-secondary');
      deny.classList.add('btn-danger');
      allow.classList.remove('btn-success');
      allow.classList.add('btn-outline-secondary');
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const pending = loadPending();
    if (!pending || !pending.rows || !pending.rows.length) {
      document.getElementById('pending-info').textContent = 'No pending extracted data found. Please upload files from dashboard first.';
      return;
    }
    document.getElementById('pending-info').textContent = `Files: ${pending.files && pending.files.join(', ')}`;
    decisions = pending.rows.map(() => 'allow');
    renderTable(pending);

    document.getElementById('approve-all').addEventListener('click', () => {
      decisions = decisions.map(() => 'allow');
      pending.rows.forEach((_, i) => setDecision(i, 'allow'));
    });
    document.getElementById('reject-all').addEventListener('click', () => {
      decisions = decisions.map(() => 'deny');
      pending.rows.forEach((_, i) => setDecision(i, 'deny'));
    });

    document.getElementById('submit-decisions').addEventListener('click', async () => {
      const allowedIndices = pending.rows.map((_, i) => i).filter(i => decisions[i] === 'allow');
      const deniedIndices = pending.rows.map((_, i) => i).filter(i => decisions[i] !== 'allow');

      if (!allowedIndices.length) {
        Swal.fire({ icon: 'warning', title: 'No rows allowed', text: 'Select at least one row to save.' });
        return;
      }

      // Build rows to save with edited values and pending_file reference
      const rowsToSave = allowedIndices.map(actualIdx => {
        const orig = pending.rows[actualIdx];
        const row = {};
        COLUMNS.forEach(col => {
          const inp = document.querySelector(`input.editable-cell[data-col="${col}"][data-idx="${actualIdx}"]`);
          row[col] = inp ? inp.value.trim() : getRowValue(orig, col);
        });
        // Include pending_file so backend can move it to uploads
        row.pending_file = orig.pending_file || null;
        return row;
      });

      // Build denied rows (for cleanup of pending files)
      const rowsToReject = deniedIndices.map(actualIdx => {
        const orig = pending.rows[actualIdx];
        return { pending_file: orig.pending_file || null };
      });

      Swal.fire({ title: 'Saving...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
      try {
        // First, save allowed rows
        const res = await fetch(API_BASE + '/api/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'save', rows: rowsToSave })
        });
        const jr = await res.json().catch(() => ({}));

        // Then, reject denied rows to clean up pending files
        if (rowsToReject.length > 0) {
          try {
            await fetch(API_BASE + '/api/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'reject', rows: rowsToReject })
            });
          } catch (e) {
            console.warn('Failed to clean up rejected pending files:', e);
          }
        }

        Swal.close();
        if (res.ok) {
          const saved = jr.saved_count || 0;
          const failed = jr.failed_count || 0;
          const skipped = jr.skipped_count || 0;
          const excelInfo = jr.excel || jr.excel_info || null;
          let excelHtml = '';
          if (excelInfo) {
            const p = escapeHtml(excelInfo.path || excelInfo.filename || JSON.stringify(excelInfo));
            excelHtml = `<div style="margin-top:.5rem;font-size:.9rem">Excel: <code>${p}</code></div>`;
          }
          let summaryHtml = '';
          if (failed > 0) {
            const msgs = (jr.failed || []).map(f => `${f.index}: ${f.error}`);
            summaryHtml += `<div style="text-align:left;max-height:240px;overflow:auto"><strong>Failures:</strong><pre>${escapeHtml(msgs.join('\n'))}</pre></div>`;
          }
          if (skipped > 0) {
            const smsgs = (jr.skipped || []).map(s => `${s.index}: ${s.reason || 'duplicate'}`);
            summaryHtml += `<div style="text-align:left;max-height:240px;overflow:auto"><strong>Skipped (${skipped}):</strong><pre>${escapeHtml(smsgs.join('\n'))}</pre></div>`;
          }
          if (summaryHtml) {
            Swal.fire({ icon: failed > 0 ? 'warning' : 'info', title: `Saved ${saved} rows`, html: `${summaryHtml}${excelHtml}` });
          } else {
            Swal.fire({ icon: 'success', title: `Saved ${saved} rows`, html: excelHtml });
          }
          sessionStorage.removeItem('ncrp_pending_rows');
        } else {
          Swal.fire({ icon: 'error', title: 'Save failed', text: jr.error || `HTTP ${res.status}` });
        }
      } catch (e) {
        Swal.close();
        Swal.fire({ icon: 'error', title: 'Save failed', text: String(e) });
      }
    });
  });
})();
