// verify.js - handles the verify.html page
(function(){
  // resolve verify endpoint dynamically from backend config (exposed at /api/config)
  let API_VERIFY = null;

  function escapeHtml(s){
    return String(s).replace(/[&<"'`=\\/]/g, function(c){
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;','/':'&#x2F;','`':'&#x60;','=':'&#x3D;'})[c];
    });
  }

  function loadPending(){
    try{
      const raw = sessionStorage.getItem('ncrp_pending_rows');
      if(!raw) return null;
      return JSON.parse(raw);
    }catch(e){
      console.error('Failed to read pending rows', e);
      return null;
    }
  }

  function renderTable(pending){
    const tbody = document.querySelector('#verify-table tbody');
    tbody.innerHTML = '';
    pending.rows.forEach((r,i)=>{
      const id = escapeHtml(r['Complaint ID'] || r['complaint_id'] || r.id || `row-${i}`);
      const preview = escapeHtml(JSON.stringify(r));
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${i+1}</td>
        <td style="max-width:70vw;word-break:break-word">${preview}</td>
        <td>
          <button type="button" class="btn btn-sm btn-success me-2" data-idx="${i}" data-decision="allow">ALLOW</button>
          <button type="button" class="btn btn-sm btn-outline-secondary" data-idx="${i}" data-decision="deny">DENY</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    // wire buttons
    document.querySelectorAll('#verify-table button[data-idx]').forEach(btn=>{
      btn.addEventListener('click', (e)=>{
        const idx = Number(btn.dataset.idx);
        const dec = btn.dataset.decision;
        setDecision(idx, dec);
      });
    });

    // init DataTable
    if($.fn.DataTable && $.fn.DataTable.isDataTable('#verify-table')){
      $('#verify-table').DataTable().destroy();
    }
    $('#verify-table').DataTable({pageLength:10, lengthMenu:[5,10,25]});
  }

  let decisions = [];
  function setDecision(i, val){
    decisions[i] = val;
    // style buttons
    const allow = document.querySelector(`#verify-table button[data-idx='${i}'][data-decision='allow']`);
    const deny = document.querySelector(`#verify-table button[data-idx='${i}'][data-decision='deny']`);
    if(!allow||!deny) return;
    if(val==='allow'){
      allow.classList.remove('btn-outline-secondary'); allow.classList.add('btn-success');
      deny.classList.remove('btn-danger'); deny.classList.add('btn-outline-secondary');
    } else {
      deny.classList.remove('btn-outline-secondary'); deny.classList.add('btn-danger');
      allow.classList.remove('btn-success'); allow.classList.add('btn-outline-secondary');
    }
  }

  document.addEventListener('DOMContentLoaded', ()=>{
    const pending = loadPending();
    if(!pending || !pending.rows || !pending.rows.length){
      document.getElementById('pending-info').textContent = 'No pending extracted data found. Please upload files from dashboard first.';
      return;
    }
    document.getElementById('pending-info').textContent = `Files: ${pending.files && pending.files.join(', ')}`;
    decisions = pending.rows.map(()=> 'allow');
    renderTable(pending);

    document.getElementById('approve-all').addEventListener('click', ()=>{
      decisions = decisions.map(()=> 'allow');
      // re-style
      pending.rows.forEach((_,i)=>setDecision(i,'allow'));
    });
    document.getElementById('reject-all').addEventListener('click', ()=>{
      decisions = decisions.map(()=> 'deny');
      pending.rows.forEach((_,i)=>setDecision(i,'deny'));
    });

    document.getElementById('submit-decisions').addEventListener('click', async ()=>{
      const allowed = pending.rows.filter((r,i)=> decisions[i]==='allow');
      if(!allowed.length){
        Swal.fire({icon:'warning', title:'No rows allowed', text:'Select at least one row to save.'});
        return;
      }
      Swal.fire({title:'Saving...', allowOutsideClick:false, didOpen:()=>Swal.showLoading()});
      try{
  // ensure API_VERIFY resolved
  const base = window.API_BASE || (await (async function(){ try{ const r=await fetch('/api/config'); if(r.ok){ const j=await r.json(); return j.API_BASE || j.api_base; } }catch(e){} return null; })()) || 'http://localhost:5000';
  const res = await fetch(base + '/api/verify', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action:'save', rows: allowed})});
        const jr = await res.json().catch(()=>({}));
        Swal.close();
        if(res.ok){
          const saved = jr.saved_count||0; const failed = jr.failed_count||0; const skipped = jr.skipped_count||0;
          const excelInfo = jr.excel || jr.excel_info || null;
          let excelHtml = '';
          if(excelInfo){
            const p = escapeHtml(excelInfo.path || excelInfo.filename || JSON.stringify(excelInfo));
            excelHtml = `<div style="margin-top:.5rem;font-size:.9rem">Excel: <code>${p}</code></div>`;
          }
          let summaryHtml = '';
          if(failed>0){
            const msgs = (jr.failed||[]).map(f=>`${f.index}: ${f.error}`);
            summaryHtml += `<div style="text-align:left;max-height:240px;overflow:auto"><strong>Failures:</strong><pre>${escapeHtml(msgs.join('\n'))}</pre></div>`;
          }
          if(skipped>0){
            const smsgs = (jr.skipped||[]).map(s=>`${s.index}: ${s.reason || 'duplicate'}`);
            summaryHtml += `<div style="text-align:left;max-height:240px;overflow:auto"><strong>Skipped (${skipped}):</strong><pre>${escapeHtml(smsgs.join('\n'))}</pre></div>`;
          }
          if(summaryHtml){
            Swal.fire({icon: (failed>0? 'warning':'info'), title:`Saved ${saved} rows`, html: `${summaryHtml}${excelHtml}`});
          } else {
            Swal.fire({icon:'success', title:`Saved ${saved} rows`, html: excelHtml});
          }
          // clear pending
          sessionStorage.removeItem('ncrp_pending_rows');
        } else {
          Swal.fire({icon:'error', title:'Save failed', text: jr.error||`HTTP ${res.status}`});
        }
      }catch(e){
        Swal.close();
        Swal.fire({icon:'error', title:'Save failed', text: String(e)});
      }
    });
  });
})();
