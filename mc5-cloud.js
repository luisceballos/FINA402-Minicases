(function(root) {
  'use strict';
  const firebaseConfig={apiKey:'AIzaSyAjHL3MztreUN7J7QKW3q_nRbiNoxLwA0E',authDomain:'fina402-60e86.firebaseapp.com',projectId:'fina402-60e86',appId:'1:1058911893067:web:0ab85f8a600d4fb8d2ffce'};
  if(!firebase.apps.length)firebase.initializeApp(firebaseConfig);
  const db=firebase.firestore();
  const configRef=db.doc('minicase_hub/config');
  let config,teacher=false,testRun=null,identity=null,sessionRef,finalRef,claimToken,revision=0;
  const clone=value=>JSON.parse(JSON.stringify(value));
  async function boot(){
    const doc=await configRef.get({source:'server'});
    if(!doc.exists)throw Error('Course configuration unavailable.');
    config=doc.data();
    return config.minicases[4];
  }
  function access(current,section){
    const activity=current?.minicases?.[4];
    if(!activity?.active||!activity.sections?.[section-1]?.active)throw Error('MC5 is not open for this section.');
    if(Number(new URLSearchParams(location.search).get('seccion'))!==section)throw Error('Your section is fixed by the hub.');
    if(!MinicaseAccess.hasGrant(5,section,activity.accessPasswordHash))throw Error('Return to the hub and enter the MC5 class password.');
  }
  async function login(password){
    if(!config)await boot();
    if(!password||password!==config.password)throw Error('Incorrect instructor password.');
    teacher=true;
    testRun=sessionStorage.getItem('mc5-test-run');
    if(!testRun){testRun='mc5_'+Date.now()+'_'+crypto.randomUUID().slice(0,8);sessionStorage.setItem('mc5-test-run',testRun);}
    await db.doc('minicase5_instructor_tests/'+testRun).set({testOnly:true,createdAt:new Date().toISOString(),activity:'MC5'});
  }
  async function roster(section){
    if(![1,2,3,4].includes(section))throw Error('Choose a valid section.');
    if(teacher)return [{id:'instructor-test',name:'Instructor Test · worked example'},...Array.from({length:10},(_,i)=>({id:'test_'+String(i+1).padStart(2,'0'),name:'Test student '+String(i+1).padStart(2,'0')}))];
    access(config,section);
    const doc=await db.doc('minicase_rosters/2026-fall_sec'+section).get({source:'server'});
    if(!doc.exists)throw Error('Section roster unavailable.');
    return doc.data().students;
  }
  async function open(who,resumeExisting=false){
    const people=await roster(who.section),found=people.find(person=>person.id===who.id);
    if(!found)throw Error('Choose a student on this section roster.');
    identity={id:found.id,name:found.name,section:who.section};
    const docId='mc5_sec'+who.section+'_'+who.id;
    const prefix=teacher?'minicase5_instructor_tests/'+testRun+'/':'';
    sessionRef=db.doc(prefix+(teacher?'sessions/':'minicase5_sessions/')+docId);
    finalRef=db.doc(prefix+(teacher?'submissions/':'minicase5_submissions/')+docId);
    const key='mc5-claim-'+(teacher?testRun:'course')+'-'+docId;
    claimToken=localStorage.getItem(key)||crypto.randomUUID();localStorage.setItem(key,claimToken);
    return db.runTransaction(async tx=>{
      const [cfg,session,final]=await Promise.all([tx.get(configRef),tx.get(sessionRef),tx.get(finalRef)]);
      if(!teacher)access(cfg.data(),who.section);
      revision=session.data()?.revision||0;
      if(final.exists)return {identity,report:final.data(),submitted:true};
      if(session.exists){
        const saved=session.data();
        if(saved.claimToken!==claimToken){
          if(!resumeExisting)return {identity,resumeRequired:true,lastSavedAt:saved.updatedAt||saved.createdAt};
          // Transfer the active writer while preserving the complete saved report.
          // Advancing the revision also rejects writes from older tabs sharing a token.
          revision+=1;
          tx.update(sessionRef,{claimToken,revision,lastResumedAt:new Date().toISOString()});
        }
        return {identity,report:saved.report||null,submitted:false};
      }
      tx.set(sessionRef,{identity,claimToken,revision:0,status:'draft',createdAt:new Date().toISOString(),testOnly:teacher});
      return {identity,report:null,submitted:false};
    });
  }
  async function write(report,complete){
    if(!identity||report.identity?.id!==identity.id||report.identity?.section!==identity.section)throw Error('Student identity mismatch.');
    MC5Model.validate(report,complete);
    const expected=revision;
    const result=await db.runTransaction(async tx=>{
      const [cfg,session,final]=await Promise.all([tx.get(configRef),tx.get(sessionRef),tx.get(finalRef)]);
      if(!teacher)access(cfg.data(),identity.section);
      if(final.exists)throw Error('This student has already submitted. Reload to view the receipt.');
      const old=session.data();
      if(!old||old.claimToken!==claimToken)throw Error('This draft is now active in another window. Reload MC5, confirm your own name and resume your saved draft.');
      if(old.revision!==expected)throw Error('This draft changed in another tab. Reload before continuing.');
      const saved={...clone(report),identity:clone(identity),minicase:5,section:identity.section,studentId:identity.id,studentName:identity.name,submissionMode:'individual',testOnly:teacher};
      if(complete){saved.submittedAt=new Date().toISOString();saved.finishedAt=saved.submittedAt;tx.set(finalRef,saved);}
      tx.set(sessionRef,{...old,report:saved,revision:expected+1,status:complete?'submitted':'draft',updatedAt:new Date().toISOString()});
      return saved;
    });
    revision=expected+1;
    return result;
  }
  async function reports(section){
    if(!teacher)throw Error('Instructor access required.');
    const [rosterDoc,sessions,finals]=await Promise.all([
      db.doc('minicase_rosters/2026-fall_sec'+section).get({source:'server'}),
      db.collection('minicase5_sessions').where('identity.section','==',section).get({source:'server'}),
      db.collection('minicase5_submissions').where('section','==',section).get({source:'server'})
    ]);
    return {roster:rosterDoc.data()?.students||[],sessions:sessions.docs.map(doc=>({id:doc.id,...doc.data()})),finals:finals.docs.map(doc=>({id:doc.id,...doc.data()}))};
  }
  async function release(section,studentId){
    if(!teacher)throw Error('Instructor access required.');
    const id='mc5_sec'+section+'_'+studentId,session=db.doc('minicase5_sessions/'+id),final=db.doc('minicase5_submissions/'+id),archive=db.collection('minicase5_archives').doc();
    await db.runTransaction(async tx=>{
      const [s,f]=await Promise.all([tx.get(session),tx.get(final)]);
      if(!s.exists&&!f.exists)return;
      tx.set(archive,{identity:s.data()?.identity||{section,id:studentId},session:s.data()||null,submission:f.data()||null,archivedAt:new Date().toISOString()});
      if(s.exists)tx.delete(session);if(f.exists)tx.delete(final);
    });
  }
  root.MC5Cloud={boot,login,roster,open,save:r=>write(r,false),submit:r=>write(r,true),reports,release,isInstructor:()=>teacher,getTestRun:()=>testRun};
})(window);
