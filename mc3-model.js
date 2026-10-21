(function(root) {
  'use strict';
  function valuation(packet, growth, margin, overrides = {}) {
    const b = packet.base, a = {...packet.assumptions, ...overrides};
    if (![growth, margin, a.wacc, a.terminalGrowth].every(Number.isFinite)) throw Error('Enter valid numeric assumptions.');
    if (growth < 0 || growth > .6 || margin < .2 || margin > .8) throw Error('Use growth 0–60% and operating margin 20–80%.');
    if (a.wacc <= a.terminalGrowth || a.terminalROIC <= a.terminalGrowth) throw Error('WACC and terminal ROIC must exceed terminal growth.');
    let revenue = b.revenue, pv = 0;
    const years = [];
    for (let y = 1; y <= 5; y++) {
      const priorRevenue = revenue;
      revenue *= 1 + growth;
      const ebit = revenue * margin, nopat = ebit * (1 - a.tax);
      const da = revenue * a.daRate, capex = revenue * a.capexRate;
      const changeNwc = (revenue - priorRevenue) * a.nwcRate;
      const fcff = nopat + da - capex - changeNwc, discounted = fcff / (1 + a.wacc) ** y;
      pv += discounted;
      years.push({year: y, revenue, ebit, nopat, da, capex, changeNwc, fcff, pv: discounted});
    }
    const terminalNopat = revenue * (1 + a.terminalGrowth) * a.terminalMargin * (1 - a.tax);
    const terminalFcff = terminalNopat * (1 - a.terminalGrowth / a.terminalROIC);
    const terminalValue = terminalFcff / (a.wacc - a.terminalGrowth);
    const terminalPV = terminalValue / (1 + a.wacc) ** 5;
    const ev = pv + terminalPV, bridge = b.cash + b.investments - b.debt;
    const equity = ev + bridge, perShare = equity / b.shares;
    const price = packet.prices.at(-1).close;
    const multipleValue = (b.ebitda * a.benchmarkMultiple + bridge) / b.shares;
    const salesMultipleValue = (b.revenue * a.benchmarkSalesMultiple + bridge) / b.shares;
    return {years, terminalNopat, terminalFcff, terminalValue, terminalPV, ev, equity, perShare,
      terminalShare: terminalPV / ev, upside: perShare / price - 1, multipleValue, price,
      salesMultipleValue, observedSalesMultiple:(price * b.shares - bridge) / b.revenue,
      observedMultiple: (price * b.shares - bridge) / b.ebitda};
  }
  function indicators(rows) {
    const closes = rows.map(r => r.close);
    const sma = n => closes.map((_, i) => i + 1 < n ? null : closes.slice(i + 1 - n, i + 1).reduce((s, p) => s + p, 0) / n);
    let gain = 0, loss = 0;
    const rsiSeries=closes.map(()=>null);
    const rsiValue=()=>gain===0&&loss===0?50:loss===0?100:100-100/(1+gain/loss);
    for (let i = 1; i <= 14; i++) {const d = closes[i] - closes[i - 1]; gain += Math.max(d, 0) / 14; loss += Math.max(-d, 0) / 14;}
    rsiSeries[14]=rsiValue();
    for (let i = 15; i < closes.length; i++) {const d = closes[i] - closes[i - 1]; gain = (gain * 13 + Math.max(d, 0)) / 14; loss = (loss * 13 + Math.max(-d, 0)) / 14;rsiSeries[i]=rsiValue();}
    const rsi = gain === 0 && loss === 0 ? 50 : loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    // EMA starts with an n-session simple average; signal starts with nine valid MACD points.
    function ema(values,n){
      let seed=[],value=null;
      return values.map(x=>{
        if(x===null)return null;
        if(value===null){seed.push(x);if(seed.length<n)return null;value=seed.reduce((a,b)=>a+b,0)/n;}
        else value=x*2/(n+1)+value*(1-2/(n+1));
        return value;
      });
    }
    const fast=ema(closes,12),slow=ema(closes,26);
    const macdLine=closes.map((_,i)=>slow[i]===null?null:fast[i]-slow[i]);
    const signalLine=ema(macdLine,9);
    const histogram=macdLine.map((x,i)=>signalLine[i]===null?null:x-signalLine[i]);
    return {sma50: sma(50), sma200: sma(200), rsi,rsiSeries,macd:macdLine.at(-1),signal:signalLine.at(-1),
      histogram:histogram.at(-1),histogramSeries:histogram,previousHistogram:histogram.at(-2),macdLine,signalLine,
      change: closes.at(-1) / closes[0] - 1};
  }
  function validateAnswers(a, stage = 'final') {
    const textFields = ['fundamentals', 'assumptionsReason', 'multipleReason', 'technicalReason'];
    if (stage === 'final') textFields.push('committeeA', 'committeeB', 'defense', 'recommendationReason', 'risk');
    for (const key of textFields) {
      const v = (a[key] || '').trim();
      if (v.length < 50 || v.length > 1500) throw Error('Complete ' + key.replace(/([A-Z])/g, ' $1').toLowerCase() + ' (50–1,500 characters).');
    }
    if (!['Enter now', 'Wait', 'Reduce / avoid'].includes(a.technical)) throw Error('Select your technical decision.');
    if (stage === 'final' && !['Buy', 'Hold', 'Sell'].includes(a.recommendation)) throw Error('Select Buy, Hold or Sell.');
  }
  function fallbackChallenge(a, v, packet) {
    const margin = packet.base.ebit / packet.base.revenue * 100;
    if (Number(a.margin) > margin)
      return `Your ${Number(a.margin).toFixed(1)}% operating margin exceeds the reported TTM margin of ${margin.toFixed(1)}%. What evidence supports expanding profitability while competitors and customers develop alternatives, and would your recommendation survive a five-percentage-point lower margin?`;
    if (v.terminalShare > .65)
      return `${(v.terminalShare * 100).toFixed(0)}% of your enterprise value comes from the terminal period. Which assumption is doing most of the work, and would you defend your recommendation with a WACC one percentage point higher?`;
    return `Your DCF is $${v.perShare.toFixed(2)} per share against a $${v.price.toFixed(2)} market price. Explain why your growth and margin assumptions are more credible than the expectations embedded in that price, and identify one observation that would invalidate your recommendation.`;
  }
  function committeeQuestion(round,a,v) {
    const quote=x=>'“'+String(x||'').trim().slice(0,220)+'”';
    if(round===0)return `You selected ${a.growth}% annual revenue growth and ${a.margin}% operating margin. What evidence from NVIDIA and its peers makes those assumptions economically plausible over five years?`;
    if(round===1)return `In A you explained ${quote(a.committeeA)}. For your investment horizon, would you give more weight to DCF fair value or RSI/MACD timing signals, and why if they disagree?`;
    return `In A you said ${quote(a.committeeA)}; in B you said ${quote(a.committeeB)}. How do these views together support Buy, Hold or Sell when your DCF is $${v.perShare.toFixed(2)} and the market price is $${v.price.toFixed(2)}?`;
  }
  root.MC3Model = {valuation, indicators, validateAnswers, fallbackChallenge, committeeQuestion};
  if (typeof module !== 'undefined') module.exports = root.MC3Model;
})(typeof window !== 'undefined' ? window : globalThis);
