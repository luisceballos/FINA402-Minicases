'use strict';
const adminEsc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function renderRosterAdmin() {
  const host=document.getElementById('roster-admin');
  host.innerHTML='<h4>👥 Student rosters & team reservations</h4><p style="font-size:.8rem">Names are reserved per minicase and section. Clear a group to release its names and remove its draft/submission. Names on submitted roster-based reports cannot be edited as free text.</p>'+
    '<p><a href="minicase3.html?instructor=1" target="_blank" rel="noopener">Test NVIDIA Minicase 3 as instructor — choose section / virtual TEST group</a></p>'+
    '<p><a href="minicase4.html?instructor=1" target="_blank" rel="noopener">Test MC4 — isolated individual Firebase records</a> · <a href="mc4-instructor.html" target="_blank" rel="noopener">MC4 individual submissions, grading and simulation ranking</a></p>'+
    '<div class="sub-picker"><select id="roster-mc"><option value="1">Minicase 1</option><option value="2">Minicase 2</option><option value="3" selected>Minicase 3</option></select>'+
    '<select id="roster-sec">'+[1,2,3,4].map(n=>'<option value="'+n+'">Section '+n+'</option>').join('')+'</select>'+
    '<button onclick="loadRosterAssignments()">Load teams</button></div><div id="roster-assignments"></div>';
}
async function loadRosterAssignments() {
  const mc=Number(document.getElementById('roster-mc').value),sec=Number(document.getElementById('roster-sec').value);
  const host=document.getElementById('roster-assignments');
  host.textContent='Loading…';
  try {
    const svc=MinicaseTeam.createService(db),[r,t]=await Promise.all([svc.rosterRef(sec).get(),svc.teamsRef(mc,sec).get()]);
    const roster=r.data()?.students || [],groups=t.data()?.groups || {};
    host.innerHTML='<p style="font-size:.8rem">'+roster.length+' students on the Fall 2026 section roster.</p>'+
      Object.entries(groups).map(([g,v])=>'<div style="padding:8px;border-bottom:1px solid #ddd"><b>Group '+adminEsc(g)+'</b> · '+
        adminEsc((v.slots || []).filter(Boolean).map(id=>roster.find(s=>s.id===id)?.name || '[not on current roster]').join(', '))+
        (v.frozen?' · '+Object.keys(v.individualSubmitted||{}).length+'/'+v.slots.filter(Boolean).length+' confirmed':v.submitted?' · Submitted':' · Reserved')+
        ' <button onclick="clearTeam('+mc+','+sec+','+Number(g)+')">Clear group</button></div>').join('');
    if(!Object.keys(groups).length)host.innerHTML+='<p>No names reserved yet.</p>';
  }catch(e){host.textContent=e.message;}
}
async function clearTeam(mc,sec,grp) {
  if(!confirm(`Clear MC${mc}, Section ${sec}, Group ${grp}? This removes its draft/submission and releases all its names.`))return;
  try {await MinicaseTeam.createService(db).reset(mc,sec,grp);await loadRosterAssignments();}
  catch(e){alert(e.message);}
}
function renderSubmissionMC3(d,docId,sec,grp) {
  window._mc3Submission=d;
  const a=d.answers || {}, v=d.valuation || {};
  const row=(label,value)=>'<tr><th style="text-align:left;vertical-align:top;padding:10px;width:28%">'+adminEsc(label)+'</th><td style="white-space:pre-wrap;padding:10px">'+adminEsc(value)+'</td></tr>';
  const sections=[
    ['Team',(d.team || []).join(', ')],
    ['Submission','One final report per group'],
    ...(d.submissionMode==='group-confirmations'?[
      ['Previous-format version',d.versionId],
      ['Previous-format confirmations',`${d.confirmationCount}/${d.totalMembers}`],
      ['Previous-format contributions',Object.values(d.contributors||{}).map(c=>c.name+': '+c.fields.join(', ')).join('\n')]
    ]:[]),
    ['Recommendation',a.recommendation],
    ['DCF / share',Number(v.perShare).toFixed(2)],['Upside / downside',(Number(v.upside)*100).toFixed(1)+'%'],
    ['Growth / margin',a.growth+'% / '+a.margin+'%'],['Fundamentals',a.fundamentals],
    ['DCF assumptions',a.assumptionsReason],['EV/EBITDA value / share',a.multipleAnswer],
    ['EV/Sales value / share',a.salesMultipleAnswer],
    ['Relative valuation reasoning',a.multipleReason],['Technical decision',a.technical],
    ['Technical interpretation',a.technicalReason],
    ['RSI / MACD / Signal / Histogram',[d.technicals?.rsi,d.technicals?.macd,d.technicals?.signal,d.technicals?.histogram].map(v=>v==null?'—':Number(v).toFixed(2)).join(' / ')],
    ['Committee source',d.agent?.source],['Latest committee question',d.agent?.challenge],
    ['Initial assumptions',d.agent?.initial?.answers?.growth+'% growth / '+d.agent?.initial?.answers?.margin+'% margin'],
    ['Initial DCF / share',d.agent?.initial?.valuation?.perShare?.toFixed(2)],
    ['Committee questions',d.agent?.turns?.map((t,i)=>String.fromCharCode(65+i)+'. '+t.question).join('\n')],['Committee A: assumptions',a.committeeA],['Committee B: DCF versus TA',a.committeeB],['Committee C: recommendation',a.defense],['Final recommendation reasoning',a.recommendationReason],['Invalidating risk',a.risk]
  ];
  document.getElementById('sub-data').innerHTML='<div class="sub-card"><h4>NVIDIA · MC3 · Section '+adminEsc(sec)+' · Group '+adminEsc(grp)+'</h4>'+
    '<p>'+adminEsc(d.submittedAt)+' · Data '+adminEsc(d.dataVersion)+'</p><table style="width:100%;font-size:.82rem">'+sections.map(x=>row(...x)).join('')+'</table>'+
    '<p style="font-size:.8rem">Written answers require instructor review. No automatic length-based grade.</p>'+
    '<label>Instructor grade (0–10)<input type="number" min="0" max="10" step=".1" id="mc3-grade" value="'+adminEsc(d.review?.grade ?? '')+'"></label>'+
    '<label>Feedback<textarea id="mc3-feedback" style="width:100%" maxlength="4000">'+adminEsc(d.review?.feedback || '')+'</textarea></label>'+
    '<button id="mc3-save-review">Save review</button> <button id="mc3-reset">Clear submission & release names</button><p id="mc3-review-status" role="status"></p></div>';
  document.getElementById('mc3-save-review').onclick=async()=>{
    const raw=document.getElementById('mc3-grade').value,grade=Number(raw);
    if(raw==='' || !Number.isFinite(grade)||grade<0||grade>10){document.getElementById('mc3-review-status').textContent='Enter a grade from 0 to 10.';return;}
    try{await db.collection('minicase_submissions').doc(docId).update({review:{grade,feedback:document.getElementById('mc3-feedback').value,reviewedAt:new Date().toISOString()}});
      document.getElementById('mc3-review-status').textContent='Review saved to Firebase.';}
    catch(e){document.getElementById('mc3-review-status').textContent=e.message;}
  };
  document.getElementById('mc3-reset').onclick=async()=>{
    if(!confirm('Clear this report and release its team names?'))return;
    try{await MinicaseTeam.createService(db).reset(3,Number(sec),Number(grp));document.getElementById('sub-data').textContent='Report cleared; names released.';}
    catch(e){document.getElementById('mc3-review-status').textContent=e.message;}
  };
}
async function renderMC3Guide() {
  const host=document.getElementById('ak-data');host.textContent='Loading guide…';
  try {
    const p=window.MC3_DATA;
    if(!p?.prices?.length)throw Error('Company data is missing. Keep the MC3 folder next to the hub.');
    const v=MC3Model.valuation(p,.20,.60);
    host.innerHTML='<h4>MC3 — Instructor guide</h4><p>All groups analyze NVIDIA with the same packet. There is no single correct DCF or recommendation.</p>'+
      '<p>Example only: 20% annual growth, 60% operating margin → DCF $'+v.perShare.toFixed(2)+'/share. 25× TTM EV/EBITDA: $'+v.multipleValue.toFixed(2)+'/share. 15× TTM EV/Sales: $'+v.salesMultipleValue.toFixed(2)+'/share. Both multiples are teaching benchmarks.</p>'+
      '<p>Rubric: fundamentals 1.5; DCF and assumptions 3; multiples 1.5; technical interpretation 1; recommendation and risk 2; committee reasoning 1.</p>'+
      '<p>Check that the argument connects evidence to assumptions. The technical signal informs timing; it does not establish intrinsic value. Upside is not a guaranteed future return.</p>'+
      '<p><a href="minicase3.html?instructor=1" target="_blank" rel="noopener">Open instructor test — section / virtual TEST group</a></p>';
  }catch(e){host.textContent=e.message;}
}
