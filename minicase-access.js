/* Per-minicase class-entry codes. This is a classroom gate, not university SSO. */
(function(root){
'use strict';
const script=document.currentScript,caseNumber=Number(script?.dataset.case||0);
async function hash(value){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');}
function key(mc,section){return 'fina402-entry-mc'+mc+'-sec'+section;}
function hasGrant(mc,section,expected){try{const saved=JSON.parse(sessionStorage.getItem(key(mc,section))||'null');return !!expected&&saved?.hash===expected&&saved.section===section&&saved.mc===mc&&Date.now()-saved.at<12*60*60*1000;}catch{return false;}}
async function grant(mc,section,password,expected){if(!expected)throw Error('The instructor has not configured this minicase password.');const entered=await hash(password);if(entered!==expected)throw Error('Incorrect minicase password.');sessionStorage.setItem(key(mc,section),JSON.stringify({mc,section,hash:expected,at:Date.now()}));}
function decode(v){if(v.mapValue)return Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,x])=>[k,decode(x)]));if(v.arrayValue)return (v.arrayValue.values||[]).map(decode);for(const k of ['stringValue','booleanValue','nullValue'])if(k in v)return v[k];if('integerValue' in v)return Number(v.integerValue);return v.doubleValue;}
async function configuration(){const r=await fetch('https://firestore.googleapis.com/v1/projects/fina402-60e86/databases/(default)/documents/minicase_hub/config',{signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('Course connection unavailable.');return decode({mapValue:{fields:(await r.json()).fields}});}
function block(message){document.getElementById('minicase-entry-mask')?.remove();const style=document.createElement('style');style.id='minicase-entry-mask';style.textContent='body > :not(#minicase-entry-screen){display:none!important}body{visibility:visible!important;background:#f1f5f9;font-family:Arial,sans-serif}';document.head.append(style);const panel=document.createElement('main');panel.id='minicase-entry-screen';panel.style.cssText='max-width:650px;margin:80px auto;padding:30px;background:white;border-radius:12px;color:#002147';const title=document.createElement('h1');title.textContent='Minicase '+caseNumber+' · Class access';const text=document.createElement('p');text.textContent=message;const link=document.createElement('a');link.href='minicase-hub.html?entry=1';link.textContent='Return to the hub, choose your section and enter the minicase password';panel.append(title,text,link);document.body.append(panel);}
async function enforce(){
 if(!caseNumber)return true;const query=new URLSearchParams(location.search);
 if(query.has('instructor')&&caseNumber>=3){document.getElementById('minicase-entry-mask')?.remove();return true;}
 const section=Number(query.get('seccion'));try{const cfg=await configuration(),mc=cfg.minicases?.[caseNumber-1];if(!mc?.active||!mc.sections?.[section-1]?.active){block('This minicase or section is not open.');return false;}if(!hasGrant(caseNumber,section,mc.accessPasswordHash)){block('Select your section and enter the class password in the hub before opening this minicase.');return false;}document.getElementById('minicase-entry-mask')?.remove();return true;}catch(e){block(e.message+' Please reload or contact your instructor.');return false;}
}
root.MinicaseAccess={hash,grant,hasGrant,ready:Promise.resolve(true)};
if(caseNumber)root.MinicaseAccess.ready=enforce();
})(window);
