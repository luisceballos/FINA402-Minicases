/* MC4 educational annual-coupon model. No live market pricing. */
(function(root){
const bonds=[{id:'A',n:1,c:.02,y:.04,q:.038},{id:'B',n:2,c:.03,y:.042,q:.041},{id:'C',n:3,c:.04,y:.044,q:.043},{id:'D',n:5,c:.045,y:.046,q:.047},{id:'E',n:10,c:.05,y:.048,q:.049}];
const initialCapital=250000;
const liabilities=[{year:2,amount:80000},{year:3,amount:120000}];
function price(b,y,n=b.n){if(!Number.isFinite(y)||y<=-1||n<0)throw Error('Invalid yield or maturity');let p=0;for(let t=1;t<=n;t++)p+=1000*b.c/(1+y)**t;return p+1000/(1+y)**n;}
function ytm(b,p){if(!(p>0))throw Error('Price must be positive');let lo=-.99,hi=1;while(price(b,hi)>p)hi*=2;for(let k=0;k<100;k++){let mid=(lo+hi)/2;if(price(b,mid)>p)lo=mid;else hi=mid;}return (lo+hi)/2;}
bonds.forEach(b=>b.quote=+price(b,b.q).toFixed(2));
function holdings(a){if(a.length!==7||a.some(x=>!Number.isFinite(x)||x<0)||Math.abs(a.reduce((s,x)=>s+x,0)-initialCapital)>.01)throw Error('Allocate exactly $250,000 with no negative amounts.');return bonds.map((b,i)=>{const n=a[i]/b.quote;return Math.abs(n-Math.round(n))<1e-8?Math.round(n):n;});}
const marketReinvestmentRate=bonds[0].q;
function policyCheck(policy){if(!['cash','market','spy'].includes(policy))throw Error('Choose cash, market-rate account or SPY for coupons.');}
function coverage(a,policy='spy'){policyCheck(policy);const units=holdings(a);let cash=a[6],account=0;return [1,2,3].map(year=>{const interest=account*marketReinvestmentRate;account+=interest;const coupons=bonds.reduce((s,b,i)=>s+(b.n>=year?units[i]*1000*b.c:0),0),principal=bonds.reduce((s,b,i)=>s+(b.n===year?units[i]*1000:0),0);cash+=principal;if(policy==='cash')cash+=coupons;if(policy==='market')account+=coupons;const due=liabilities.find(l=>l.year===year)?.amount||0,available=cash+account,gap=Math.max(0,due-available);let remaining=due;const paidCash=Math.min(cash,remaining);cash-=paidCash;remaining-=paidCash;account-=Math.min(account,remaining);return {year,coupons,interest,principal,available,due,gap,cash,account};});}
function simulate(a,count=10000,seed=402,policy='spy'){policyCheck(policy);const units0=holdings(a);let state=seed>>>0;const u=()=>{state=(1664525*state+1013904223)>>>0;return (state+.5)/4294967296;};const normal=()=>Math.sqrt(-2*Math.log(u()))*Math.cos(2*Math.PI*u());let fail=0,wealth=0,ret=0,deficit=0;
for(let k=0;k<count;k++){let units=units0.slice(),stock=a[5],cash=a[6],account=0,accountRate=marketReinvestmentRate,shift=0,factor=1,miss=0;
for(let year=1;year<=3;year++){let before=cash+account+stock+bonds.reduce((s,b,i)=>s+(b.n>=year?units[i]*price(b,Math.max(0,b.q+shift),b.n-year+1):0),0);stock*=Math.exp((.07-.5*.18**2)+.18*normal());account*=1+accountRate;shift+=.01*normal();accountRate=Math.max(0,marketReinvestmentRate+shift);
let coupons=0;let bondValues=bonds.map((b,i)=>{if(b.n<year)return 0;coupons+=units[i]*1000*b.c;if(b.n===year){cash+=units[i]*1000;units[i]=0;return 0;}return units[i]*price(b,Math.max(0,b.q+shift),b.n-year);});
if(policy==='spy')stock+=coupons;else if(policy==='market')account+=coupons;else cash+=coupons;
let value=cash+account+stock+bondValues.reduce((s,x)=>s+x,0);if(before>0)factor*=value/before;
let due=liabilities.find(l=>l.year===year)?.amount||0;const useAccount=Math.min(account,Math.max(0,due-cash));account-=useAccount;cash+=useAccount;if(cash<due){let need=due-cash,total=stock+bondValues.reduce((s,x)=>s+x,0),f=total?Math.min(1,need/total):0;cash+=total*f;stock*=1-f;units=units.map(x=>x*(1-f));}let paid=Math.min(cash,due);miss+=due-paid;cash-=paid;
}
const end=cash+account+stock+bonds.reduce((s,b,i)=>s+(b.n>3?units[i]*price(b,Math.max(0,b.q+shift),b.n-3):0),0);wealth+=end;ret+=factor**(1/3)-1;if(miss>.01){fail++;deficit+=miss;}}
return {scenarios:count,seed,couponPolicy:policy,failurePct:100*fail/count,meanAnnualReturn:ret/count,meanFinalWealth:wealth/count,meanDeficitWhenFailed:fail?deficit/fail:0};}
const api={bonds,initialCapital,liabilities,marketReinvestmentRate,price,ytm,holdings,coverage,simulate};root.MC4=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window==='undefined'?globalThis:window);
