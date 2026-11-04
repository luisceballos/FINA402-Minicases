/* Stable individual CCC variants. Frozen index assignments are stored in Firebase. */
(function(root){
'use strict';
function variant(index=0){if(!Number.isSafeInteger(index)||index<0||index>999)throw Error('Invalid variant index');const couponRate=index?(.06+index*.0001):.08,ytm=index?(.135+index*.0001):.15,coupon=Math.round(1000*couponRate*100)/100;let price=0;for(let t=1;t<=3;t++)price+=coupon/(1+ytm)**t;price+=1000/(1+ytm)**3;return {index,couponRate,ytm,coupon,purchasePrice:price,prices:[price,700,600,1000]};}
function annual(v,i){return {income:v.coupon/v.prices[i]*100,capital:(v.prices[i+1]-v.prices[i])/v.prices[i]*100};}
const api={version:'mc4-2026-fall-v1',variant,annual};root.MC4Case=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window==='undefined'?globalThis:window);
