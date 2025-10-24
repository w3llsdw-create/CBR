const $ = s => document.querySelector(s);
let CASES = [];

function esc(s){ return (s??'').toString().replace(/[&<>"]/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m])); }
function escAttr(s){ return esc(s).replace(/"/g,'&quot;'); }
function fmtDate(d){ if(!d) return "—"; const x=new Date(d); return x.toLocaleDateString(); }
function badge(s){ return `<span class="badge ${s}">${s.toUpperCase()}</span>`; }

async function load(){
  const r = await fetch('/api/cases',{cache:'no-store'}); const data = await r.json();
  CASES = data.cases || []; renderList();
}

function renderList(){
  console.log("Rendering cases:", CASES);
  const list = $('#list'); list.innerHTML='';
  const frag = document.createDocumentFragment();
  CASES.forEach(c=>{
    const row = document.createElement('div');
    row.className = 'trow';
    row.innerHTML = `
      <div class="cell col-name"><strong>${esc(c.client_name)}</strong> • ${esc(c.case_name)}</div>
      <div class="cell col-type">${esc(c.case_type||"—")}</div>
      <div class="cell col-stage">${esc(c.stage||"—")}</div>
      <div class="cell col-status">${badge(c.status)}</div>
      <div class="cell col-para">${esc(c.paralegal||"—")}</div>
      <div class="cell col-due">${c.next_due?fmtDate(c.next_due):"—"}</div>`;
    row.onclick = ()=> edit(c.id);
    frag.appendChild(row);
  });
  list.appendChild(frag);
}

function edit(id){
  const c = CASES.find(x=>x.id===id); if(!c) return;
  $('#id').value = c.id;
  // Render focus log
  const fl = $('#focus_list'); fl.innerHTML='';
  (c.focus_log||[]).slice().reverse().forEach(f=>{
    const li = document.createElement('li');
    const t = new Date(f.at).toLocaleString();
    li.textContent = `[${t}] ${f.author}: ${f.text}`;
    fl.appendChild(li);
  });
  // Render deadlines
  renderDeadlines(c.deadlines||[]);
  // Enable Edit Details button
  const editBtn = document.getElementById('edit_details');
  if (editBtn) {
    editBtn.disabled = false;
    editBtn.onclick = () => {
      if (c.id) window.open(`/edit?id=${encodeURIComponent(c.id)}`, '_blank');
    };
  }
}

function renderDeadlines(dls){
  const host = $('#deadlines'); host.innerHTML='';
  dls.forEach((d,i)=>{
    const row = document.createElement('div');
    row.style.display='grid'; row.style.gridTemplateColumns='1fr 2fr auto';
    row.style.gap='6px'; row.style.marginBottom='6px';
    row.innerHTML = `
      <input type="date" value="${d.due_date}">
      <input placeholder="Description" value="${escAttr(d.description)}">
      <label class="small"><input type="checkbox" ${d.resolved?'checked':''}> resolved</label>`;
    host.appendChild(row);
  });
  host.dataset.json = JSON.stringify(dls);
}

$('#add_deadline').onclick = ()=>{
  const dls = JSON.parse($('#deadlines').dataset.json||'[]');
  dls.push({due_date:new Date().toISOString().slice(0,10), description:'', resolved:false});
  renderDeadlines(dls);
};

$('#add_focus').onclick = async ()=>{
  const id = $('#id').value; if(!id) return alert('Select a case first.');
  const text = $('#focus_text').value.trim(); if(!text) return;
  const author = $('#focus_author').value.trim() || 'DW';
  await fetch(`/api/cases/${id}/focus`, {method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({at:new Date().toISOString(), author, text})});
  $('#focus_text').value=''; await load(); edit(id);
};

$('#save').onclick = async ()=>{
  const id = $('#id').value || null;
  const attn = document.querySelector("input[name='attn']:checked")?.value ?? "";
  const base = {
    id: id || undefined,
    client_name: $('#client_name').value, case_name: $('#case_name').value,
    case_type: $('#case_type').value, paralegal: $('#paralegal').value,
    stage: $('#stage').value, status: $('#status').value,
    case_number: $('#case_number').value || null, county: $('#county').value || null,
    division: $('#division').value || null, judge: $('#judge').value || null,
    opposing_counsel: $('#opposing_counsel').value || null, opposing_firm: $('#opposing_firm').value || null,
    attention: attn
  };
  const dlNodes = Array.from($('#deadlines').children);
  const dls = dlNodes.map(n=>{
    const [dEl, tEl, rEl] = n.querySelectorAll('input');
    return { due_date: dEl.value, description: tEl.value, resolved: rEl.checked };
  });

  if(id){
    const old = CASES.find(x=>x.id===id);
    const payload = {...old, ...base, deadlines:dls};
    const r = await fetch(`/api/cases/${id}`, {method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)});
    if(!r.ok) return alert('Save failed');
  }else{
    const payload = {...base, deadlines:dls, focus_log:[]};
    const r = await fetch(`/api/cases`, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)});
    if(!r.ok) return alert('Create failed');
  }
  await load();
};

// Remove new case logic from main page
if ($('#new')) $('#new').remove();
if ($('#save')) $('#save').remove();

load();
