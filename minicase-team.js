/* Shared roster selection. Transactions serialize concurrent group claims.
   Claims are scoped to one minicase + section. No student university IDs. */
(function (root) {
  'use strict';
  const clone = x => JSON.parse(JSON.stringify(x));
  function createService(db, paths = {}) {
    const config = db.doc(paths.config || 'minicase_hub/config');
    const rosterRef = sec => db.doc((paths.rosters || 'minicase_rosters') + '/2026-fall_sec' + sec);
    const teamsRef = (mc, sec) => db.doc((paths.teams || 'minicase_teams') + '/mc' + mc + '_sec' + sec);
    const subRef = (mc, sec, grp) => db.doc((paths.submissions || 'minicase_submissions') + '/mc' + mc + '_sec' + sec + '_grp' + grp);
    const draftRef = (mc, sec, grp) => db.doc((paths.drafts || 'minicase_drafts') + '/mc' + mc + '_sec' + sec + '_grp' + grp);
    function checkConfig(cfg, mc, sec, grp) {
      const c = cfg?.minicases?.[mc - 1], s = c?.sections?.[sec - 1];
      if (!Number.isInteger(mc) || !Number.isInteger(sec) || !Number.isInteger(grp) ||
          !c?.active || !s?.active || grp < 1 || grp > Number(s.groups))
        throw Error('This minicase, section or group is closed. Return to the hub.');
    }
    function selectedIds(group) { return (group?.slots || []).filter(Boolean); }
    function resolveNames(roster, ids) {
      if (!ids.length) throw Error('Select at least one team member before submitting.');
      if (new Set(ids).size !== ids.length) throw Error('A student cannot appear twice.');
      return ids.map(id => {
        const s = roster.students.find(s => s.id === id);
        if (!s) throw Error('A selected student is no longer on this section roster.');
        return s.name;
      });
    }
    return {
      config, rosterRef, teamsRef, subRef, draftRef, checkConfig, selectedIds,
      async select(mc, sec, grp, slot, studentId, expectedOld) {
        if (!Number.isInteger(slot) || slot < 0 || slot >= 5) throw Error('Invalid member slot.');
        return db.runTransaction(async tx => {
          const [c, r, t, sub] = await Promise.all([
            tx.get(config), tx.get(rosterRef(sec)), tx.get(teamsRef(mc, sec)), tx.get(subRef(mc, sec, grp))
          ]);
          checkConfig(c.data(), mc, sec, grp);
          if (!r.exists) throw Error('Roster not configured. Contact your instructor.');
          if (sub.exists) throw Error('The team roster is locked because a report has been submitted. Contact your instructor to change it.');
          const groups = clone(t.data()?.groups || {});
          const g = groups[grp] || {slots: ['', '', '', '', '']};
          if ((g.slots[slot] || '') !== expectedOld) throw Error('Your group changed this slot in another tab. Please select again.');
          if (studentId && !r.data().students.some(s => s.id === studentId)) throw Error('Student is not in this section.');
          for (const [otherGrp, other] of Object.entries(groups)) {
            if (studentId && (other.slots || []).some((id, i) => id === studentId && (Number(otherGrp) !== grp || i !== slot)))
              throw Error('This student has already been selected. Choose another name.');
          }
          g.slots[slot] = studentId;
          groups[grp] = g;
          tx.set(teamsRef(mc, sec), {mc, section: sec, groups, updatedAt: new Date().toISOString()});
          return groups;
        });
      },
      async submit(mc, sec, grp, payload, expectedIds) {
        return db.runTransaction(async tx => {
          const [c, r, t, s] = await Promise.all([
            tx.get(config), tx.get(rosterRef(sec)), tx.get(teamsRef(mc, sec)), tx.get(subRef(mc, sec, grp))
          ]);
          checkConfig(c.data(), mc, sec, grp);
          if (s.exists) throw Error('This group has already submitted. Contact your instructor.');
          if (!r.exists) throw Error('Roster unavailable.');
          const groups = clone(t.data()?.groups || {}), group = groups[grp];
          const ids = selectedIds(group), names = resolveNames(r.data(), ids);
          if (JSON.stringify(ids) !== JSON.stringify(expectedIds)) throw Error('Team changed in another tab. Review the names before submitting.');
          for (const [key, other] of Object.entries(groups))
            if (Number(key) !== grp && selectedIds(other).some(id => ids.includes(id))) throw Error('A student is assigned to another group.');
          const result = {...payload, minicase: mc, section: sec, group: grp,
            team: names, teamIds: ids, submittedAt: new Date().toISOString(), schemaVersion: 2};
          group.submitted = true; groups[grp] = group;
          tx.set(teamsRef(mc, sec), {mc, section: sec, groups, updatedAt: result.submittedAt});
          tx.set(subRef(mc, sec, grp), result);
          tx.delete(draftRef(mc, sec, grp));
          return result;
        });
      },
      async saveDraft(mc, sec, grp, payload, expectedIds) {
        return db.runTransaction(async tx => {
          const [c, t, s] = await Promise.all([tx.get(config), tx.get(teamsRef(mc, sec)), tx.get(subRef(mc, sec, grp))]);
          checkConfig(c.data(), mc, sec, grp);
          if (s.exists) throw Error('Already submitted. Draft is locked.');
          const ids = selectedIds(t.data()?.groups?.[grp]);
          if (!ids.length || JSON.stringify(ids) !== JSON.stringify(expectedIds)) throw Error('Select and confirm your team first.');
          tx.set(draftRef(mc, sec, grp), {...payload, updatedAt: new Date().toISOString()});
        });
      },
      async patchGroupDraft(mc,sec,grp,id,changes,expected,dataVersion) {
        return db.runTransaction(async tx => {
          const [c,r,t,s,d]=await Promise.all([tx.get(config),tx.get(rosterRef(sec)),tx.get(teamsRef(mc,sec)),tx.get(subRef(mc,sec,grp)),tx.get(draftRef(mc,sec,grp))]);
          checkConfig(c.data(),mc,sec,grp);
          if(!selectedIds(t.data()?.groups?.[grp]).includes(id))throw Error('Choose your name from the registered team.');
          if(s.exists)throw Error('The common report is frozen. Review it and confirm your participation.');
          const draft=clone(d.data() || {answers:{growth:'20',margin:'60'},revision:0,contributors:{},history:[]});
          if(draft.dataVersion && draft.dataVersion!==dataVersion)throw Error('Case data changed. Ask your instructor to reset this draft.');
          const allowed=['growth','margin','fundamentals','assumptionsReason','multipleAnswer','multipleReason','technical','technicalReason','defense','recommendation','recommendationReason','risk'];
          const changed=[];
          for(const [key,value] of Object.entries(changes)) {
            if(!allowed.includes(key)||typeof value!=='string'||value.length>1500)throw Error('Invalid report field.');
            if((draft.answers[key] || '')!==(expected[key] || '')) {
              if(draft.answers[key]===value)continue;
              throw Error('Another member changed '+key+'. Load the latest group draft before editing this field again.');
            }
            if((draft.answers[key] || '')!==value){draft.answers[key]=value;changed.push(key);}
          }
          if(!changed.length)return draft;
          const stamp=new Date().toISOString(),student=r.data().students.find(s=>s.id===id);
          // A changed analytical text with evidence, not a dropdown click, establishes participation.
          const meaningful=changed.some(k=>!['growth','margin','multipleAnswer','technical','recommendation'].includes(k) && draft.answers[k].trim().length>=20);
          const prior=draft.contributors[id] || {name:student.name,fields:[],meaningful:false};
          draft.contributors[id]={...prior,fields:[...new Set([...prior.fields,...changed])],meaningful:prior.meaningful||meaningful,lastEditedAt:stamp};
          draft.history=[...(draft.history || []),{studentId:id,name:student.name,fields:changed,at:stamp}].slice(-150);
          draft.revision=(draft.revision || 0)+1;draft.dataVersion=dataVersion;draft.updatedAt=stamp;
          tx.set(draftRef(mc,sec,grp),draft);
          return draft;
        });
      },
      async claimAgent(mc,sec,grp,id) {
        return db.runTransaction(async tx => {
          const [c,t,s,d]=await Promise.all([tx.get(config),tx.get(teamsRef(mc,sec)),tx.get(subRef(mc,sec,grp)),tx.get(draftRef(mc,sec,grp))]);
          checkConfig(c.data(),mc,sec,grp);
          if(!selectedIds(t.data()?.groups?.[grp]).includes(id))throw Error('Choose your name.');
          if(s.exists)throw Error('Report is frozen.');
          const draft=clone(d.data());
          if(!draft)throw Error('Save your group analysis first.');
          if(draft.agent)return {existing:draft.agent};
          if(draft.agentLease && Date.now()-draft.agentLease.startedAt<45000)throw Error('Another member is requesting the group challenge. Wait for it to appear.');
          const lease={owner:id,startedAt:Date.now(),token:Math.random().toString(36).slice(2)};
          draft.agentLease=lease;tx.set(draftRef(mc,sec,grp),draft);
          return {lease,draft};
        });
      },
      async finishAgent(mc,sec,grp,lease,agent) {
        return db.runTransaction(async tx=>{
          const [d,s]=await Promise.all([tx.get(draftRef(mc,sec,grp)),tx.get(subRef(mc,sec,grp))]);
          if(s.exists)throw Error('Report already frozen.');
          const draft=clone(d.data());
          if(draft?.agent)return draft.agent;
          if(draft?.agentLease?.token!==lease.token)throw Error('The group challenge was restarted. Reload the latest draft.');
          draft.agent=agent;delete draft.agentLease;draft.revision=(draft.revision || 0)+1;
          tx.set(draftRef(mc,sec,grp),draft);return agent;
        });
      },
      async confirmReport(mc,sec,grp,id,reflection,payload,expectedIds,expectedRevision) {
        if(typeof reflection!=='string'||reflection.trim().length<20||reflection.length>1000)throw Error('Write your personal sentence about the key assumption (20–1,000 characters).');
        return db.runTransaction(async tx => {
          const [c,r,t,s,d]=await Promise.all([tx.get(config),tx.get(rosterRef(sec)),tx.get(teamsRef(mc,sec)),tx.get(subRef(mc,sec,grp)),tx.get(draftRef(mc,sec,grp))]);
          checkConfig(c.data(),mc,sec,grp);
          if(!r.exists)throw Error('Roster unavailable.');
          const groups=clone(t.data()?.groups || {}),g=groups[grp],ids=selectedIds(g);
          const team=resolveNames(r.data(),ids);
          if(!ids.includes(id))throw Error('Choose your name from the registered team.');
          if(JSON.stringify(ids)!==JSON.stringify(expectedIds))throw Error('Your team changed. Confirm the complete team before submitting.');
          for(const [key,other] of Object.entries(groups))
            if(Number(key)!==grp && selectedIds(other).some(sid=>ids.includes(sid)))throw Error('A member is assigned to another group.');
          const draft=d.data();
          let report=s.data();
          if(report && report.submissionMode!=='group-confirmations')throw Error('An incompatible submission already exists.');
          if(report?.confirmations?.[id])throw Error('You already confirmed this group report.');
          if(!report) {
            if(!draft || draft.revision!==expectedRevision)throw Error('The group report changed. Read the latest version before confirming.');
            const missing=ids.filter(sid=>!draft.contributors?.[sid]?.meaningful);
            if(missing.length)throw Error('Every team member must save an analytical contribution before the report can be frozen.');
            if(!draft.agent)throw Error('Complete the group analyst challenge first.');
            // The submitted fields must exactly match the shared draft everyone can read.
            if(Object.keys(payload.answers || {}).some(k=>(payload.answers[k] || '')!==(draft.answers[k] || '')))throw Error('Save all changes to the common report before confirming.');
            report={...payload,answers:clone(draft.answers),agent:clone(draft.agent),
              contributors:clone(draft.contributors),history:clone(draft.history || []),
              minicase:mc,section:sec,group:grp,team,teamIds:ids,submissionMode:'group-confirmations',
              versionId:'r'+draft.revision,revision:draft.revision,confirmations:{},schemaVersion:4};
          } else if(report.revision!==expectedRevision)throw Error('Review the frozen report version before confirming it.');
          const studentName=r.data().students.find(s=>s.id===id).name,stamp=new Date().toISOString();
          report.confirmations[id]={studentId:id,studentName,reflection:reflection.trim(),versionId:report.versionId,confirmedAt:stamp};
          report.confirmationCount=Object.keys(report.confirmations).length;report.totalMembers=ids.length;
          report.complete=ids.every(sid=>!!report.confirmations[sid]);
          report.submittedAt=report.submittedAt || stamp;report.updatedAt=stamp;
          g.frozen=true;g.individualSubmitted=Object.fromEntries(Object.keys(report.confirmations).map(sid=>[sid,true]));g.submitted=report.complete;
          tx.set(teamsRef(mc,sec),{mc,section:sec,groups,updatedAt:stamp});
          tx.set(subRef(mc,sec,grp),report);
          return report;
        });
      },
      async reset(mc, sec, grp) {
        return db.runTransaction(async tx => {
          const t = await tx.get(teamsRef(mc, sec));
          const groups = clone(t.data()?.groups || {});
          delete groups[grp];
          tx.set(teamsRef(mc, sec), {mc, section: sec, groups, updatedAt: new Date().toISOString()});
          tx.delete(subRef(mc, sec, grp)); tx.delete(draftRef(mc, sec, grp));
        });
      }
    };
  }
  let state = null;
  async function mount({db, mc, sec, grp, container = 'teamGrid', paths}) {
    state?.unsubscribe?.();
    const service = createService(db, paths);
    const host = document.getElementById(container);
    host.replaceChildren();
    const status = document.createElement('p'); status.id = 'team-status'; status.setAttribute('role', 'status');
    status.style.cssText = 'grid-column:1/-1;font-size:13px;line-height:1.5';
    status.textContent = 'Loading section roster…';
    host.append(status);
    const button = document.getElementById('submitBtn');
    if (button) button.disabled = true;
    state = {service, mc, sec, grp, groups: {}, roster: null, ready: false, pending: false, status, selects: []};
    const [c, r, t] = await Promise.all([service.config.get(), service.rosterRef(sec).get(), service.teamsRef(mc, sec).get()]);
    service.checkConfig(c.data(), mc, sec, grp);
    if (!r.exists || !r.data().students?.length) throw Error('No roster for this section. Contact your instructor.');
    state.roster = r.data(); state.groups = t.data()?.groups || {};
    for (let i = 0; i < 5; i++) {
      const label = document.createElement('label');
      label.textContent = 'Student ' + (i + 1) + (i ? ' (optional)' : '');
      const select = document.createElement('select');
      select.id = 'tm' + (i + 1); select.className = 'team-input';
      select.style.cssText = 'display:block;width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:6px;background:white;font-size:14px';
      label.append(select); host.insertBefore(label, status); state.selects.push(select);
      select.addEventListener('change', async () => {
        const old = state.groups[grp]?.slots?.[i] || '';
        const id = state.roster.students.find(s => s.name === select.value)?.id || '';
        state.pending = true; render();
        try {
          state.groups = await service.select(mc, sec, grp, i, id, old);
          state.error = '';
        } catch (e) { state.error = e.message; }
        finally { state.pending = false; render(); }
      });
    }
    state.ready = true; render();
    state.unsubscribe = service.teamsRef(mc, sec).onSnapshot(snap => {
      state.groups = snap.data()?.groups || {}; state.ready = true; render();
    }, err => {state.ready = false; state.error = 'Cannot verify team availability: ' + err.message; render();});
    return state;
  }
  function render() {
    if (!state) return;
    const {grp, groups, roster, selects, status} = state;
    const slots = groups[grp]?.slots || [];
    selects.forEach((select, i) => {
      select.replaceChildren(new Option('— Select a student —', ''));
      for (const student of roster.students) {
        const opt = new Option(student.name, student.name);
        const occupied = Object.entries(groups).some(([g, data]) =>
          (data.slots || []).some((id, slot) => id === student.id && (Number(g) !== grp || slot !== i)));
        opt.disabled = occupied;
        if (occupied) opt.textContent += ' — already selected';
        if (slots[i] === student.id) opt.selected = true;
        select.append(opt);
      }
      select.disabled = state.pending || !state.ready || !!groups[grp]?.submitted || !!groups[grp]?.frozen;
    });
    const count = slots.filter(Boolean).length;
    status.textContent = state.error || (state.pending ? 'Saving team selection…' :
      `${count} member${count === 1 ? '' : 's'} selected. ${groups[grp]?.frozen ? 'Team locked after the first confirmation. Contact your instructor for changes.' :
        'Names are reserved across groups in this section and minicase. Select only students present.'} Use one device per group.`);
    status.style.color = state.error ? '#b91c1c' : '#475569';
    const button = document.getElementById('submitBtn');
    if (button) button.disabled = !count || !state.ready || state.pending || !!groups[grp]?.submitted;
    document.dispatchEvent(new CustomEvent('minicase-team-change',{detail:{ids:slots.filter(Boolean),members:slots.filter(Boolean).map(id=>roster.students.find(s=>s.id===id)),
      pending:state.pending,ready:state.ready,frozen:!!groups[grp]?.frozen,submitted:groups[grp]?.individualSubmitted || {}}}));
  }
  function selection() {
    if (!state?.ready || state.pending) throw Error('Wait for the roster to finish saving.');
    const ids = state.service.selectedIds(state.groups[state.grp]);
    if (!ids.length) throw Error('Select at least one team member before submitting.');
    return {ids, names: ids.map(id => state.roster.students.find(s => s.id === id).name)};
  }
  root.MinicaseTeam = {
    createService, mount, refresh: render,
    selection,
    async submit(data) {const s = selection(); return state.service.submit(state.mc, state.sec, state.grp, data, s.ids);},
    async saveDraft(data) {const s = selection(); return state.service.saveDraft(state.mc, state.sec, state.grp, data, s.ids);},
    async loadDraft() {return (await state.service.draftRef(state.mc, state.sec, state.grp).get()).data();},
    service(){if(!state?.ready)throw Error('Wait for the roster.');return state.service;},
    showError(err) {
      if (state) {state.error = err.message || String(err); state.ready = false; render();}
    }
  };
  if (typeof module !== 'undefined') module.exports = {createService};
})(typeof window !== 'undefined' ? window : globalThis);
