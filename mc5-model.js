(function(root) {
  'use strict';
  const positions = [
    {id:'longCall',label:'Buy 1 call contract',stock:210,payoff:3000,profit:2200},
    {id:'shortCall',label:'Sell 1 call contract',stock:210,payoff:-3000,profit:-2200},
    {id:'longPut',label:'Buy 1 put contract',stock:150,payoff:3000,profit:2400},
    {id:'shortPut',label:'Sell 1 put contract',stock:150,payoff:-3000,profit:-2400}
  ];
  const basicChecks = [
    ['right','callBuyer','Call buyer has the right to buy.'],
    ['obligation','buy','An assigned put seller buys 100 shares at the strike.'],
    ['loss','premium','A standalone option buyer can lose the premium paid.'],
    ['callCost',1600,'Total call premium uses quote × 100 × 2 contracts.'],
    ['putReceipt',600,'Total put premium received uses quote × 100 × 1 contract.'],
    ...positions.flatMap(row=>[
      [row.id+'Payoff',row.payoff,row.label+': check the signed payoff for all 100 shares.'],
      [row.id+'Profit',row.profit,row.label+': include the total premium in P&L.']
    ])
  ];
  const protectionChecks = [
    ['hedge','longPut','Buying one put protects the 100 shares.'],
    ['floorValue',18000,'Add the value of 100 shares and the payoff of one put.'],
    ['maxLoss',600,'Compare the terminal floor with the $18,600 initial outlay.'],
    ['breakEven',186,'Find the stock price where the total position covers its $18,600 outlay.']
  ];
  const marketInputs = {underlying:'NVDA',stock:180,strike:180,callPremiumPerShare:8,putPremiumPerShare:6,sharesPerContract:100,maturityMonths:3,quotes:'illustrative teaching inputs'};
  function correct(raw,expected) {
    if(typeof expected==='string') return raw===expected;
    return typeof raw==='string'&&raw.trim()!==''&&Number.isFinite(Number(raw))&&Math.abs(Number(raw)-expected)<=.01;
  }
  function validate(report,complete) {
    if(!report||report.activity!=='MC5'||!report.answers||JSON.stringify(report.marketInputs)!==JSON.stringify(marketInputs)) throw Error('Invalid case data. Reload the activity.');
    for(const answer of Object.values(report.answers)) if(typeof answer!=='string'||answer.length>1200) throw Error('Invalid answer format.');
    if(!complete)return;
    for(const [id,expected,message] of [...basicChecks,...protectionChecks]) if(!correct(report.answers[id],expected))throw Error(message);
    if(!report.basicsUnlocked||!report.scenariosUnlocked)throw Error('Verify both calculation sections.');
    for(const id of ['scenarioA','scenarioB'])if(!report.answers[id]?.trim())throw Error('Answer both client scenarios.');
  }
  root.MC5Model={positions,basicChecks,protectionChecks,marketInputs,correct,validate};
})(window);
