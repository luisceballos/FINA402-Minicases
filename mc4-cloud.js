/* MC4 uses the course's existing roster-based Firebase access model. */
(function(root){
'use strict';
const firebaseConfig={apiKey:'AIzaSyAjHL3MztreUN7J7QKW3q_nRbiNoxLwA0E',authDomain:'fina402-60e86.firebaseapp.com',projectId:'fina402-60e86',appId:'1:1058911893067:web:0ab85f8a600d4fb8d2ffce'};
if(!firebase.apps.length)firebase.initializeApp(firebaseConfig);
const db=firebase.firestore(),configRef=db.doc('minicase_hub/config'),packetRef=db.doc('minicase_data/mc4_fixed_income_v1');
const clone=v=>JSON.parse(JSON.stringify(v)),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
let config,packet,instructor=false,testRun=null,identity=null,revision=0,sessionRef,submissionRef,claimToken=null;
function access(c,section){const mc=c?.minicases?.[3];if(!mc?.active||!mc.sections?.[section-1]?.active)throw Error('Minicase 4 is not open for this section. Return to the course hub.');}
function scope(){return instructor?db.collection('minicase4_instructor_tests').doc(testRun):null;}
function checkImmutable(old,next){
 if(old?.portfolioConfirmed){
  if(!next.portfolioConfirmed||!same(old.confirmedPortfolio,next.confirmedPortfolio))throw Error('Your confirmed strategy cannot be changed. Reload your saved report.');
  for(const key of ['priceA','priceB','priceC','priceD','priceE','cccPurchasePrice','flow1','flow2','flow3'])if(old.answers[key]!==next.answers[key])throw Error('Confirmed calculations are locked.');
 }
 for(const client of ['A','B']){
  const prev=old?.conversations?.[client]||[],now=next.conversations?.[client]||[];
  if(now.length<prev.length||prev.some((t,i)=>!same(t,now[i])))throw Error('A sent client reply cannot be modified.');
 }
 for(let i=0;i<(old?.conversations?.B?.length||0);i++)if(!same(old.clientB.annualAnswers[i],next.clientB.annualAnswers[i]))throw Error('A completed annual calculation cannot be modified.');
}
function verifyReport(r,complete=false){
 if(!identity||r.identity.id!==identity.id||r.identity.section!==identity.section)throw Error('Student identity mismatch.');
 if(r.clientB.variantIndex!==identity.variantIndex)throw Error('Individual case variant mismatch.');
 const assigned=MC4Case.variant(identity.variantIndex);
 if(Math.abs(r.clientB.coupon-assigned.coupon)>1e-8||Math.abs(r.clientB.initialYtm-assigned.ytm)>1e-10||Math.abs(r.clientB.purchasePrice-assigned.purchasePrice)>1e-8)throw Error('The assigned CCC data cannot be changed.');
 if(r.initialCapital!==MC4.initialCapital||!same(r.liabilities,MC4.liabilities))throw Error('Case assumptions changed. Reload the case.');
 if(r.portfolioConfirmed){
  MC4.holdings(r.allocation);const p=r.confirmedPortfolio;
  if(!p||!same(p.allocation,r.allocation)||!same(p.quantities,r.bondQuantities)||p.cashReserve!==r.cashReserve||p.couponPolicy!==r.couponReinvestmentPolicy)throw Error('Confirmed strategy does not match your report.');
  if(!['cash','market','spy'].includes(r.couponReinvestmentPolicy)||r.bondQuantities.some((n,i)=>!Number.isSafeInteger(n)||n<0||Math.abs(n*MC4.bonds[i].quote-r.allocation[i])>.01)||Math.abs(r.cashReserve-r.allocation[6])>.01)throw Error('Invalid bond quantities or cash reserve.');
 }
 if(complete){
  if(!r.portfolioConfirmed||!r.confirmedPortfolio)throw Error('Confirm your portfolio.');
  for(const c of ['A','B'])if(r.conversations[c].length!==3||r.conversations[c].some(t=>t.answer.trim().length<50))throw Error('Complete all six client replies.');
  if(r.answers.finalRecommendation.trim().length<50)throw Error('Complete your final recommendation.');
  const packet=MC4Case.variant(identity.variantIndex);
  const close=(raw,value,tolerance)=>raw!==''&&raw!==null&&Number.isFinite(Number(raw))&&Math.abs(Number(raw)-value)<=tolerance;
  for(const b of MC4.bonds)if(!close(r.answers['price'+b.id],b.quote,.05))throw Error('Check Treasury prices.');
  if(!close(r.answers.cccPurchasePrice,packet.purchasePrice,.05))throw Error('Check the CCC price.');
  for(let y=1;y<=3;y++)if(!close(r.answers['flow'+y],packet.coupon+(y===3?1000:0),.05))throw Error('Check the payment schedule.');
  for(let i=0;i<3;i++){const e=MC4Case.annual(packet,i),a=r.clientB.annualAnswers[i];if(!a||!close(a.income,e.income,.03)||!close(a.capital,e.capital,.03))throw Error('Check year '+(i+1)+' returns.');}
 }
}
async function boot(){
 const [c,p]=await Promise.all([configRef.get(),packetRef.get()]);
 if(!c.exists||!p.exists)throw Error('MC4 configuration is unavailable. Contact your instructor.');
 config=c.data();packet=p.data();
 return {open:!!config.minicases?.[3]?.active,sections:config.minicases?.[3]?.sections||[],version:packet.version};
}
async function login(password){
 if(!config)await boot();
 if(!password||password!==config.password)throw Error('Incorrect instructor password.');
 instructor=true;testRun=sessionStorage.getItem('mc4-test-run')||('mc4_'+Date.now()+'_'+Math.random().toString(36).slice(2,8));sessionStorage.setItem('mc4-test-run',testRun);
 await scope().set({testOnly:true,createdAt:new Date().toISOString(),caseVersion:packet.version});
 return {testRun};
}
async function roster(section){
 if(instructor){
  const source=packet.sections[String(section)]?.students||[],cacheKey=testRun+'_roster_'+section;let random=JSON.parse(sessionStorage.getItem(cacheKey)||'null');if(!random){random=source.slice().sort(()=>Math.random()-.5).slice(0,6);sessionStorage.setItem(cacheKey,JSON.stringify(random));}
  return [{id:'instructor-test',name:'Instructor Test · base example',variantIndex:0},...random.map((s,i)=>({id:'test_'+s.id,name:'Test student '+(i+1)+' · variant '+s.variantIndex,variantIndex:s.variantIndex}))];
 }
 access(config,section);
 const r=await db.doc('minicase_rosters/2026-fall_sec'+section).get();
 if(!r.exists)throw Error('Section roster unavailable.');
 return r.data().students.map(s=>{const variant=packet.sections[String(section)]?.students.find(v=>v.id===s.id);if(!variant)throw Error('Roster changed. Ask your instructor to refresh the case assignments.');return {...s,variantIndex:variant.variantIndex};});
}
async function open(who){
 const id=who.id.replace(/[^a-zA-Z0-9_-]/g,'_'),docId='mc4_sec'+who.section+'_'+id;
 identity=clone(who);identity.variantIndex=Number(who.variantIndex);
 const tokenKey='mc4-claim-'+(instructor?testRun:'course')+'-'+docId;
 claimToken=localStorage.getItem(tokenKey);if(!claimToken){claimToken=crypto.randomUUID();localStorage.setItem(tokenKey,claimToken);}
 if(!Number.isSafeInteger(identity.variantIndex))throw Error('Invalid case variant.');
 sessionRef=instructor?scope().collection('sessions').doc(docId):db.doc('minicase4_sessions/'+docId);
 submissionRef=instructor?scope().collection('submissions').doc(docId):db.doc('minicase4_submissions/'+docId);
 return db.runTransaction(async tx=>{
  const [cfg,session,sub]=await Promise.all([tx.get(configRef),tx.get(sessionRef),tx.get(submissionRef)]);
  if(!instructor){access(cfg.data(),who.section);const r=await tx.get(db.doc('minicase_rosters/2026-fall_sec'+who.section));const found=r.data()?.students.find(s=>s.id===who.id);if(!found)throw Error('Student is not on this roster.');identity.name=found.name;const assigned=packet.sections[String(who.section)]?.students.find(s=>s.id===who.id);if(assigned?.variantIndex!==identity.variantIndex)throw Error('Individual variant mismatch.');}
  if(session.exists&&session.data().claimToken&&session.data().claimToken!==claimToken)throw Error('This name is already in use in another browser. Ask your instructor to release your name if someone else selected it.');
  if(session.exists&&!session.data().claimToken)tx.update(sessionRef,{claimToken});
  if(sub.exists){revision=session.data()?.revision||0;return {identity,report:sub.data(),submitted:true,revision,variantIndex:identity.variantIndex};}
  if(session.exists){const d=session.data();revision=d.revision;return {identity,report:d.report||null,submitted:false,revision,variantIndex:identity.variantIndex};}
  revision=0;tx.set(sessionRef,{identity,claimToken,caseVersion:packet.version,revision:0,status:'draft',createdAt:new Date().toISOString(),testOnly:instructor});
  return {identity,report:null,submitted:false,revision:0,variantIndex:identity.variantIndex};
 });
}
async function save(report){
 verifyReport(report);const expected=revision;
 const next=await db.runTransaction(async tx=>{
  const [cfg,s,sub]=await Promise.all([tx.get(configRef),tx.get(sessionRef),tx.get(submissionRef)]);
  if(!instructor)access(cfg.data(),identity.section);
  if(sub.exists||s.data()?.status==='submitted')throw Error('This individual report has already been submitted.');
  const old=s.data();if(!old||old.claimToken!==claimToken)throw Error('Your name was released or opened elsewhere. Contact your instructor before continuing.');if(old.revision!==expected)throw Error('This report changed in another tab or device. Reload to continue with the saved version.');
  checkImmutable(old.report,report);
  tx.set(sessionRef,{...old,report:clone(report),revision:expected+1,updatedAt:new Date().toISOString()});return expected+1;
 });revision=next;return {revision};
}
async function submit(report){
 verifyReport(report,true);const expected=revision;
 return db.runTransaction(async tx=>{
  const [cfg,s,sub]=await Promise.all([tx.get(configRef),tx.get(sessionRef),tx.get(submissionRef)]);
  if(!instructor)access(cfg.data(),identity.section);
  if(sub.exists)throw Error('This student has already submitted.');
  const old=s.data();if(!old||old.claimToken!==claimToken)throw Error('Your name was released or opened elsewhere. Contact your instructor.');if(old.revision!==expected)throw Error('Report changed. Reload before submitting.');checkImmutable(old.report,report);
  const final={...clone(report),minicase:4,section:identity.section,studentId:identity.id,studentName:identity.name,submissionMode:'individual',testOnly:instructor,caseVersion:packet.version,submittedAt:new Date().toISOString()};
  tx.set(submissionRef,final);tx.set(sessionRef,{...old,report:final,status:'submitted',revision:expected+1,updatedAt:final.submittedAt});return final;
 });
}
function agentEndpoint(){const value=config?.mc4AiEndpoint;if(!value)return null;const url=new URL(value);if(url.protocol!=='https:'||!/^[-a-z0-9]+-fina402-60e86\.cloudfunctions\.net$/.test(url.hostname))throw Error('The secure MC4 agent endpoint must belong to the course Firebase project.');return url.href;}
async function question(context,fallback){
 try{const endpoint=agentEndpoint();if(!endpoint)return {question:fallback,source:'guided-fallback',reason:'secure-agent-not-configured'};const res=await fetch(endpoint,{method:'POST',signal:AbortSignal.timeout(8000),headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'question',identity:{section:identity.section,id:identity.id,variantIndex:identity.variantIndex},context,requiredQuestion:fallback})});if(!res.ok)throw Error('Agent unavailable');const data=await res.json();if(typeof data.question!=='string'||!data.question.trim()||data.question.length>1600)throw Error('Invalid agent response');return {question:data.question.trim(),source:'ai'};}catch{return {question:fallback,source:'guided-fallback',reason:'agent-unavailable'};}
}
async function submissions(section){if(!instructor)throw Error('Instructor login required.');const q=await db.collection('minicase4_submissions').where('section','==',section).get();return q.docs.map(d=>({id:d.id,...d.data()}));}
async function studentSessions(section){if(!instructor)throw Error('Instructor login required.');const [roster,sessions,finals]=await Promise.all([db.doc('minicase_rosters/2026-fall_sec'+section).get(),db.collection('minicase4_sessions').where('identity.section','==',section).get(),db.collection('minicase4_submissions').where('section','==',section).get()]);const started=new Map(sessions.docs.map(d=>[d.data().identity.id,d.data()])),submitted=new Set(finals.docs.map(d=>d.data().studentId));return (roster.data()?.students||[]).map(s=>({...s,status:submitted.has(s.id)?'Submitted':started.has(s.id)?'In progress / name reserved':'Available',claimed:started.has(s.id)||submitted.has(s.id)}));}
async function releaseStudent(section,studentId,reason,testOnly=false){
 if(!instructor)throw Error('Instructor login required.');if(!reason||reason.trim().length<3)throw Error('Enter a brief reason for releasing the student.');
 const docId='mc4_sec'+section+'_'+studentId.replace(/[^a-zA-Z0-9_-]/g,'_'),session=testOnly?scope().collection('sessions').doc(docId):db.doc('minicase4_sessions/'+docId),final=testOnly?scope().collection('submissions').doc(docId):db.doc('minicase4_submissions/'+docId),archive=(testOnly?scope().collection('archives'):db.collection('minicase4_archives')).doc();
 return db.runTransaction(async tx=>{const [s,f]=await Promise.all([tx.get(session),tx.get(final)]);if(!s.exists&&!f.exists)throw Error('This student is already available.');tx.set(archive,{section,studentId,reason:reason.trim(),releasedAt:new Date().toISOString(),session:s.data()||null,submission:f.data()||null,testOnly});tx.delete(session);tx.delete(final);return {archiveId:archive.id};});
}
async function review(id,grade,feedback,criteria){if(!instructor)throw Error('Instructor login required.');if(!Number.isFinite(grade)||grade<0||grade>10||!Number.isInteger(grade*2))throw Error('Use grades from 0 to 10 in 0.5 steps.');await db.doc('minicase4_submissions/'+id).update({review:{grade,feedback:String(feedback).slice(0,4000),criteria:criteria||null,reviewedAt:new Date().toISOString()}});}
async function assess(report){
 if(!instructor)throw Error('Instructor login required.');const endpoint=agentEndpoint();if(!endpoint)throw Error('Secure AI evaluation is not configured. Review and grade manually.');
 const res=await fetch(endpoint,{method:'POST',signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'assessment',report})});if(!res.ok)throw Error('AI service unavailable; review manually.');let result;try{result=await res.json();}catch{throw Error('AI evaluation could not be validated; review manually.');}
 for(const [k,max] of [['clientA',3.5],['clientB',3.5],['final',1]])if(!result[k]||!Number.isFinite(result[k].score)||result[k].score<0||result[k].score>max||!Number.isInteger(result[k].score*2))throw Error('AI score validation failed; review manually.');return result;
}
root.MC4Cloud={boot,login,roster,open,save,submit,question,submissions,studentSessions,releaseStudent,review,assess,isInstructor:()=>instructor,getTestRun:()=>testRun};
})(window);
