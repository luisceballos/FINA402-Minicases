'use strict';
const byId = id => document.getElementById(id);
let storageKey = null;
let identity = null;
let rosterRequest = 0;
let instructor = false;
const positions = MC5Model.positions;
byId('basicRows').innerHTML = positions.map(row => `<tr><td>${row.label}</td><td>$${row.stock}</td><td><input id="${row.id}Payoff" aria-label="${row.label} total payoff" type="number" step="0.01"></td><td><input id="${row.id}Profit" aria-label="${row.label} total profit or loss" type="number" step="0.01"></td></tr>`).join('');
const fields = [...byId('work').querySelectorAll('input, select, textarea')];
const basicChecks = MC5Model.basicChecks;
const protectionChecks = MC5Model.protectionChecks;
let cloudReady = false;
let cloudBusy = false;
let saveTimer = null;
let saveChain = Promise.resolve();
let basicsUnlocked = false;
let scenariosUnlocked = false;
let finishedAt = null;
function isCorrect([id, expected]) {
  const raw = byId(id).value.trim();
  if (typeof expected === 'string') return raw === expected;
  return raw !== '' && Number.isFinite(Number(raw)) && Math.abs(Number(raw) - expected) <= 0.01;
}
function verify(checks, statusId) {
  for (const [id] of checks) byId(id).removeAttribute('aria-invalid');
  const errors = checks.filter(check => !isCorrect(check));
  for (const [id] of errors) byId(id).setAttribute('aria-invalid', 'true');
  byId(statusId).textContent = errors.length ? errors.map(check => check[2]).join('\n') : 'Correct. Continue to the next section.';
  if (errors.length) byId(errors[0][0]).focus();
  return errors.length === 0;
}
function update() {
  const basicsReady = basicsUnlocked && basicChecks.every(isCorrect);
  const protectionReady = basicsReady && scenariosUnlocked && protectionChecks.every(isCorrect);
  byId('protection').hidden = !basicsReady;
  byId('lockProtection').hidden = basicsReady;
  byId('scenarios').hidden = !protectionReady;
  byId('lockScenarios').hidden = protectionReady;
  byId('submitLocal').disabled = !protectionReady || !identity || !byId('scenarioA').value.trim() || !byId('scenarioB').value.trim() || !!finishedAt || cloudBusy;
  byId('progress').textContent = finishedAt ? 'Individual report submitted to Firebase.' : protectionReady ? 'Final step · advise both clients.' : basicsReady ? 'Next · protect 100 shares with one contract.' : 'Start with the option basics.';
  if (finishedAt) {
    for (const field of fields) field.disabled = true;
    byId('checkBasics').disabled = true;
    byId('checkProtection').disabled = true;
    byId('submitStatus').textContent = 'Submitted to Firebase. Your individual report is final.';
  }
}
function snapshot() {
  return {
    activity: 'MC5', version: 'firebase-v1', mode: 'firebase-individual',
    identity,
    marketInputs: MC5Model.marketInputs,
    answers: Object.fromEntries(fields.map(field => [field.id, field.value])),
    basicsUnlocked, scenariosUnlocked, finishedAt
  };
}
function showSaveError(error) {
  byId('save-error').hidden = false;
  byId('save-error').textContent = 'Firebase connection problem: ' + error.message + ' Keep this page open and retry Submit when connected.';
}
function backup() {
  if (identity) { try { localStorage.setItem(storageKey, JSON.stringify(snapshot())); } catch {} }
}
function persistNow() {
  clearTimeout(saveTimer);
  if (!identity || finishedAt) return saveChain;
  const report = snapshot();
  saveChain = saveChain.catch(() => {}).then(() => MC5Cloud.save(report));
  return saveChain.then(() => { byId('save-error').hidden = true; });
}
function save() {
  if (!identity || finishedAt || cloudBusy) return;
  backup(); clearTimeout(saveTimer);
  saveTimer = setTimeout(() => persistNow().catch(showSaveError), 500);
}
for (const field of fields) field.addEventListener('input', () => { update(); save(); });
byId('checkBasics').onclick = () => {
  basicsUnlocked = verify(basicChecks, 'basicStatus');
  update(); save();
  if (basicsUnlocked) byId('protection').scrollIntoView({behavior: 'smooth', block: 'start'});
};
byId('checkProtection').onclick = () => {
  scenariosUnlocked = verify(protectionChecks, 'protectionStatus');
  update(); save();
  if (scenariosUnlocked) byId('scenarios').scrollIntoView({behavior: 'smooth', block: 'start'});
};
byId('submitLocal').onclick = async () => {
  if (byId('submitLocal').disabled) return;
  if (!confirm('Submit your individual MC5 report? Your answers will become final and cannot be edited after submission.')) return;
  cloudBusy = true; update();
  try {
    await persistNow();
    const final = await MC5Cloud.submit(snapshot());
    finishedAt = final.submittedAt; backup();
    byId('save-error').hidden = true;
  } catch (error) { showSaveError(error); }
  finally { cloudBusy = false; update(); }
};
function drawChart() {
  const x = stock => 65 + (stock - 100) / 160 * 600;
  const y = profit => 235 - profit / 80;
  const stockLine = [100, 260].map(stock => x(stock) + ',' + y(100 * (stock - 180))).join(' ');
  const protectedLine = [100, 180, 260].map(stock => x(stock) + ',' + y(100 * Math.max(stock, 180) - 18600)).join(' ');
  byId('payoffChart').innerHTML = `<svg viewBox="0 0 720 390" role="img" aria-label="Total expiration P and L: stock alone and stock plus put"><rect width="720" height="390" fill="white"/>${[-8000,-4000,0,4000,8000].map(value => `<line x1="65" x2="665" y1="${y(value)}" y2="${y(value)}" stroke="#dbe2eb"/><text x="58" y="${y(value)+4}" text-anchor="end" font-size="11">${value.toLocaleString('en-US')}</text>`).join('')}${[100,140,180,220,260].map(value => `<text x="${x(value)}" y="355" text-anchor="middle" font-size="12">$${value}</text>`).join('')}<polyline points="${stockLine}" fill="none" stroke="#64748b" stroke-width="3"/><polyline points="${protectedLine}" fill="none" stroke="#174e86" stroke-width="4"/><text x="65" y="24" font-size="14" fill="#64748b">100 shares alone</text><text x="280" y="24" font-size="14" fill="#174e86">100 shares + 1 put</text><text x="65" y="51" font-size="12">Total portfolio P&amp;L ($)</text><text x="365" y="382" text-anchor="middle" font-size="12">NVDA price at expiration ($ per share)</text><text x="75" y="${y(-600)-9}" font-size="12" fill="#174e86">Protected loss floor −$600</text></svg>`;
}
function restoreReport(stored) {
  if (!stored) return;
  for (const field of fields) field.value = stored.answers?.[field.id] ?? '';
  basicsUnlocked = stored.basicsUnlocked === true;
  scenariosUnlocked = stored.scenariosUnlocked === true;
  finishedAt = stored.submittedAt || null;
}
function clearConfirmation() {
  byId('confirm-name').checked = false;
  byId('confirm-name').disabled = !byId('student').value;
  byId('start').disabled = true;
  byId('confirm-name-detail').textContent = byId('student').value ? byId('student').selectedOptions[0].textContent + ' · Section ' + byId('section').value : '';
}
async function loadRoster() {
  const request = ++rosterRequest;
  const section = Number(byId('section').value);
  clearConfirmation();
  byId('student').disabled = true;
  byId('student').replaceChildren(new Option('Choose student', ''));
  byId('confirm-name').disabled = true;
  byId('confirm-name-detail').textContent = '';
  if (![1,2,3,4].includes(section)) {
    byId('identity-status').textContent = 'Choose your section to load its roster.';
    return;
  }
  byId('identity-status').textContent = 'Loading section roster…';
  try {
    const students = await MC5Cloud.roster(section);
    if (request !== rosterRequest) return;
    for (const student of students) byId('student').append(new Option(student.name, student.id));
    byId('student').disabled = false;
    byId('identity-status').textContent = 'Choose your own name, then confirm your identity.';
    byId('cloud-status').textContent = instructor ? 'Instructor test mode · Firebase test records.' : 'MC5 connected to Firebase · individual report.';
  } catch (error) {
    if (request !== rosterRequest) return;
    byId('identity-status').textContent = error.message + ' Select the section again to retry.';
  }
}
byId('section').onchange = loadRoster;
byId('student').onchange = clearConfirmation;
byId('confirm-name').onchange = () => {
  byId('start').disabled = !byId('student').value || !byId('confirm-name').checked;
};
byId('start').onclick = async () => {
  if (!cloudReady || !byId('student').value || !byId('confirm-name').checked) return;
  byId('start').disabled = true;
  try {
    const opened = await MC5Cloud.open({section:Number(byId('section').value),id:byId('student').value});
    identity = opened.identity;
    storageKey = 'fina402-mc5-firebase-backup-' + identity.section + '-' + identity.id;
    restoreReport(opened.report);
    for (const id of ['section','student','confirm-name','start']) byId(id).disabled = true;
    byId('student-identity').textContent = identity.name + ' · Section ' + identity.section + ' · Individual report';
    byId('identity-status').textContent = 'Identity confirmed. Your report is connected to Firebase.';
    byId('work').hidden = false;
    update();
    byId('work').scrollIntoView({behavior:'smooth',block:'start'});
  } catch (error) { byId('identity-status').textContent = error.message; byId('start').disabled = false; }
};
const sampleResponses = {
  scenarioA: 'I would buy one put contract to protect all 100 shares, paying $6 per share or $600 upfront. At expiration the stock plus put is worth at least $18,000, which covers the $17,400 payment, and the maximum portfolio loss relative to the $18,600 outlay is $600. The hedge fits the payment date while preserving upside, although selling the shares and holding cash is another defensible choice for a near-term obligation.',
  scenarioB: 'I would generally avoid renewing this hedge every three months for this client because repeated premiums can reduce ten-year wealth growth and the client has liquidity elsewhere. One current contract costs $600 and protects only through this expiration, so future protection requires new trades at premiums that may change. I would reconsider if a substantial payment became due soon or the client could no longer tolerate a large decline.'
};
function renderInstructorGuide() {
  const table = document.createElement('table');
  for (const [label, result] of [
    ['Buy 2 calls · total premium paid', '$1,600'],
    ['Sell 1 put · total premium received', '$600'],
    ...positions.map(row => [row.label + ' at stock $' + row.stock, 'Payoff $' + row.payoff.toLocaleString('en-US') + ' · P&L $' + row.profit.toLocaleString('en-US')]),
    ['Protective put hedge', '100 shares + buy 1 put contract'],
    ['Combined terminal value at NVDA $150', '$18,000'],
    ['Maximum total portfolio loss', '$600'],
    ['Break-even stock price', '$186 per share']
  ]) {
    const tr = document.createElement('tr');
    for (const value of [label, result]) { const td = document.createElement('td'); td.textContent = value; tr.append(td); }
    table.append(tr);
  }
  byId('answer-key').replaceChildren(table);
  byId('sample-responses').replaceChildren();
  for (const [label, answer] of Object.entries(sampleResponses)) {
    const heading = document.createElement('h3'); heading.textContent = label === 'scenarioA' ? 'Scenario A · near-term payment' : 'Scenario B · long-term investor';
    const p = document.createElement('p'); p.textContent = answer;
    byId('sample-responses').append(heading, p);
  }
  renderLocalResults();
}
async function renderLocalResults() {
  if (!instructor) return;
  const section = Number(byId('results-section').value);
  byId('local-results').textContent = 'Loading Firebase reports…';
  try {
    const data = await MC5Cloud.reports(section);
    const finals = new Map(data.finals.map(report => [report.studentId, report]));
    const sessions = new Map(data.sessions.map(session => [session.identity.id, session]));
    byId('local-results').replaceChildren();
    const count = document.createElement('p');
    count.textContent = data.finals.length + ' submitted · ' + data.sessions.filter(s => !finals.has(s.identity.id)).length + ' in progress · ' + data.roster.filter(s => !sessions.has(s.id) && !finals.has(s.id)).length + ' not opened';
    byId('local-results').append(count);
    for (const student of data.roster) {
      const report = finals.get(student.id) || sessions.get(student.id)?.report;
      const details = document.createElement('details'), summary = document.createElement('summary');
      summary.textContent = student.name + ' · ' + (finals.has(student.id) ? 'Submitted' : sessions.has(student.id) ? 'In progress' : 'Not opened');
      details.append(summary);
      if (report) {
        for (const [id, answer] of Object.entries(report.answers)) {
          const p = document.createElement('p'); p.style.whiteSpace = 'pre-wrap'; p.textContent = id + ': ' + answer; details.append(p);
        }
      }
      if (sessions.has(student.id) || finals.has(student.id)) {
        const reset = document.createElement('button'); reset.textContent = 'Release / reset student';
        reset.onclick = async () => {
          if (!confirm('Release ' + student.name + '? Existing work will be archived and this student will start again.')) return;
          reset.disabled = true;
          try { await MC5Cloud.release(section, student.id); await renderLocalResults(); }
          catch (error) { reset.disabled = false; alert(error.message); }
        };
        details.append(reset);
      }
      byId('local-results').append(details);
    }
  } catch (error) { byId('local-results').textContent = error.message; }
}
byId('refresh-local-results').onclick = renderLocalResults;
byId('instructor-enter').onclick = async () => {
  byId('instructor-enter').disabled = true;
  try {
    await MC5Cloud.login(byId('instructor-password').value);
    cloudReady = true;
    instructor = true;
    byId('instructor-password').value = '';
    byId('instructor-login').hidden = true;
    byId('instructor-panel').hidden = false;
    byId('identity-card').hidden = false;
    byId('section').value = '1';
    byId('cloud-status').textContent = 'Instructor test mode · isolated Firebase test identities · answer guide available.';
    renderInstructorGuide();
    await loadRoster();
  } catch (error) { byId('instructor-login-status').textContent = error.message; }
  finally { byId('instructor-enter').disabled = false; }
};
byId('instructor-password').onkeydown = event => { if (event.key === 'Enter') byId('instructor-enter').click(); };
byId('fill-example').onclick = async () => {
  if (!instructor) return;
  if (!identity) {
    byId('student').value = 'instructor-test';
    byId('confirm-name').checked = true;
    await byId('start').onclick();
  }
  if (!identity || identity.id !== 'instructor-test') return;
  finishedAt = null;
  for (const field of fields) field.disabled = false;
  byId('checkBasics').disabled = false;
  byId('checkProtection').disabled = false;
  for (const [id, expected] of [...basicChecks, ...protectionChecks]) byId(id).value = expected;
  byId('scenarioA').value = sampleResponses.scenarioA;
  byId('scenarioB').value = sampleResponses.scenarioB;
  basicsUnlocked = true; scenariosUnlocked = true;
  byId('submitStatus').textContent = 'Instructor worked example loaded. All sections are open for review.';
  update(); save(); renderLocalResults();
};
async function boot() {
  try {
    const activity = await MC5Cloud.boot();
    cloudReady = true;
    const params = new URLSearchParams(location.search);
    if (params.has('instructor')) {
      byId('identity-card').hidden = true;
      byId('instructor-login').hidden = false;
      byId('cloud-status').textContent = 'Instructor access · use your course hub password.';
      return;
    }
    const section = params.get('seccion');
    if (!['1','2','3','4'].includes(section) || !activity.active) {
      byId('identity-card').hidden = true;
      byId('cloud-status').textContent = 'Open MC5 from the course hub when your instructor activates it.';
      return;
    }
    byId('section').replaceChildren(new Option('Section ' + section, section));
    byId('section').disabled = true;
    await loadRoster();
  } catch (error) { byId('cloud-status').textContent = 'Connection unavailable: ' + error.message; }
}
window.addEventListener('pagehide', backup);
drawChart(); update(); boot();
