// Frontend app.js - fetches data from backend and plots with Chart.js including buy/sell markers
async function fetchQuote(symbol) {
  const res = await fetch(`/api/quote?symbol=${encodeURIComponent(symbol)}`);
  if (!res.ok) throw new Error('Quote fetch failed');
  return res.json();
}

async function fetchTimeSeries(symbol, interval='60min') {
  const res = await fetch(`/api/timeseries?symbol=${encodeURIComponent(symbol)}&interval=${interval}`);
  if (!res.ok) throw new Error('Time series fetch failed');
  return res.json();
}

async function fetchNews(query) {
  const res = await fetch(`/api/news?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error('News fetch failed');
  return res.json();
}

async function analyzeSentiment(text) {
  const res = await fetch(`/api/sentiment`, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({text})
  });
  if (!res.ok) throw new Error('Sentiment API failed');
  return res.json();
}

// Chart instance holder
let chart = null;

function renderChart(labels, prices, markers=[]){
  const ctx = document.getElementById('chart').getContext('2d');
  if(chart) chart.destroy();
  const datasets = [{
    label: 'Price',
    data: prices,
    tension: 0.1,
    pointRadius: 0,
    borderWidth: 1.5,
    fill: false
  }];
  // Add marker dataset
  if(markers && markers.length){
    datasets.push({
      label: 'Buy/Sell',
      data: markers.map(m=>({x:m.x, y:m.y, r:6, markerType:m.type})),
      showLine: false,
      pointStyle: markers.map(m=> m.type === 'buy' ? 'triangle' : 'rectRot'),
      pointRadius: markers.map(()=>6)
    });
  }
  chart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      parsing: false,
      normalized: true,
      scales: {
        x: { display: true },
        y: { display: true }
      },
      plugins: {
        tooltip: {
          callbacks: {
            label: function(context){
              if(context.raw && context.raw.y !== undefined) return 'Price: ' + context.raw.y;
              return context.formattedValue;
            }
          }
        }
      }
    }
  });
}

// Simple demo marker generator: mark local minima as buy and maxima as sell (very naive)
function generateMarkersFromPrices(labels, prices){
  const markers = [];
  for(let i=1;i<prices.length-1;i++){
    const prev = prices[i-1], cur = prices[i], next = prices[i+1];
    if(cur < prev && cur < next){
      markers.push({x: labels[i], y: cur, type: 'buy'});
    } else if(cur > prev && cur > next){
      markers.push({x: labels[i], y: cur, type: 'sell'});
    }
  }
  return markers.slice(0,10);
}


// ---- Strategy: SMA crossover and simple portfolio simulator ----
// compute simple moving average over window (window in number of points)
function sma(prices, window){
  const out = [];
  let sum = 0;
  for(let i=0;i<prices.length;i++){
    sum += prices[i];
    if(i >= window) sum -= prices[i-window];
    if(i >= window-1) out.push(sum / window);
    else out.push(null);
  }
  return out;
}

// Generate signals from fast/slow SMA crossover: buy when fast crosses above slow, sell when fast crosses below slow
function generateSmaSignals(labels, prices, fast=5, slow=20){
  const fastS = sma(prices, fast);
  const slowS = sma(prices, slow);
  const signals = []; // {type:'buy'|'sell', idx, price, date}
  for(let i=1;i<prices.length;i++){
    if(fastS[i-1] && slowS[i-1] && fastS[i] && slowS[i]){
      if(fastS[i-1] <= slowS[i-1] && fastS[i] > slowS[i]){
        signals.push({type:'buy', idx:i, price:prices[i], date:labels[i]});
      } else if(fastS[i-1] >= slowS[i-1] && fastS[i] < slowS[i]){
        signals.push({type:'sell', idx:i, price:prices[i], date:labels[i]});
      }
    }
  }
  return signals;
}

// Portfolio simulator: simple cash + position simulation using signals
function simulatePortfolio(signals, prices, labels, startingCash=100000, slippagePct=0.001, feePct=0.0005){
  let cash = startingCash;
  let position = 0; // number of shares
  let lastPrice = null;
  const trades = [];
  for(const s of signals){
    const price = s.price * (1 + (s.type === 'buy' ? slippagePct : -slippagePct)); // slippage
    const fee = price * feePct;
    if(s.type === 'buy' && cash > price){
      // buy as many shares as possible with 50% of cash or one lot
      const spend = Math.min(cash * 0.5, cash); // conservative: use 50% per buy
      const qty = Math.floor((spend - fee) / price);
      if(qty <= 0) continue;
      const cost = qty * price + fee;
      cash -= cost;
      position += qty;
      trades.push({type:'buy', date:s.date, price, qty, fee, cash, position});
    } else if(s.type === 'sell' && position > 0){
      const qty = position; // sell all
      const proceeds = qty * price - fee;
      cash += proceeds;
      position -= qty;
      trades.push({type:'sell', date:s.date, price, qty, fee, cash, position});
    }
    lastPrice = price;
  }
  // compute final value (mark-to-market using last available price)
  const finalPrice = prices[prices.length-1] || lastPrice || 0;
  const portfolioValue = cash + position * finalPrice;
  return {startingCash, finalCash:cash, position, finalPrice, portfolioValue, trades};
}



// ---- Backtest metrics: equity curve, returns, CAGR, Sharpe ----
function computeEquityCurve(trades, prices, labels, startingCash=100000){
  // trades: array with buy/sell events recorded during simulation with cash & position after each trade.
  // We'll reconstruct daily/point-by-point equity by walking through labels and updating position when trade occurs.
  const equity = [];
  let cash = startingCash;
  let position = 0;
  let tradeIndex = 0;
  for(let i=0;i<labels.length;i++){
    const date = labels[i];
    // apply trades that occur at this index
    while(tradeIndex < trades.length && trades[tradeIndex].date === date){
      const t = trades[tradeIndex];
      if(t.type === 'buy'){
        cash = t.cash; position = t.position;
      } else if(t.type === 'sell'){
        cash = t.cash; position = t.position;
      }
      tradeIndex++;
    }
    const price = prices[i] || prices[prices.length-1] || 0;
    const total = cash + position * price;
    equity.push({date, total});
  }
  return equity;
}

function pctReturns(equity){
  const returns = [];
  for(let i=1;i<equity.length;i++){
    const r = (equity[i].total / equity[i-1].total) - 1;
    returns.push(r);
  }
  return returns;
}

function cagr(equity){
  if(equity.length < 2) return 0;
  const start = equity[0].total;
  const end = equity[equity.length-1].total;
  // approximate years by dividing days by 252 if daily, but here we approximate by length/252
  const periods = equity.length;
  const years = Math.max( (periods/252), 1/252 ); // avoid zero
  return Math.pow(end/start, 1/years) - 1;
}

function sharpe(returns, rf=0){
  if(returns.length === 0) return 0;
  const avg = returns.reduce((a,b)=>a+b,0)/returns.length;
  const std = Math.sqrt(returns.map(r=>Math.pow(r-avg,2)).reduce((a,b)=>a+b,0) / returns.length);
  if(std === 0) return 0;
  // Annualize assuming returns are per period; approximate periods per year as 252
  const annFactor = Math.sqrt(252);
  return (avg - rf) / std * annFactor;
}

function renderEquityChart(equity){
  const ctx = document.getElementById('equityChart').getContext('2d');
  const labels = equity.map(e=>e.date);
  const data = equity.map(e=>e.total);
  // destroy existing chart if present
  if(window.equityChartInstance) window.equityChartInstance.destroy();
  window.equityChartInstance = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [{ label: 'Equity Curve', data, fill:false, tension:0.1, pointRadius:0 }] },
    options: { scales:{ x:{display:false}, y:{display:true} } }
  });
}


// UI bindings
document.addEventListener('DOMContentLoaded', () => {
  const symbolInput = document.getElementById('symbol');
  const fetchBtn = document.getElementById('fetch');
  const output = document.getElementById('output');

  fetchBtn.onclick = async () => {
    const symbol = symbolInput.value.trim() || 'AAPL';
    output.textContent = 'Loading...';
    try {
      const quote = await fetchQuote(symbol);
      const ts = await fetchTimeSeries(symbol, '60min');
      const news = await fetchNews(symbol);
      const sentiment = await analyzeSentiment(news.articles?.slice(0,3).map(a=>a.title+' '+(a.description||'')).join('\\n') || '');

      // Try to extract timeseries points (supports alphavantage, twelvedata, finnhub)
      let labels = [], prices = [];
      try {
        if(ts.provider === 'finnhub' && ts.data && ts.data.t){
          // timestamps in ts.data.t (epoch seconds) and close prices in ts.data.c
          labels = ts.data.t.map(t=> new Date(t*1000).toLocaleString());
          prices = ts.data.c;
        } else if(ts.provider === 'twelvedata' && ts.data && ts.data.values){
          const vals = ts.data.values.slice().reverse();
          labels = vals.map(v=>v.datetime);
          prices = vals.map(v=>parseFloat(v.close));
        } else if(ts.provider === 'alphavantage' && ts.data){
          // alphavantage returns an object with "Time Series (60min)"
          const key = Object.keys(ts.data).find(k=>k.toLowerCase().includes('time_series'));
          if(key){
            const items = Object.entries(ts.data[key]).slice(0,200).reverse();
            labels = items.map(i=>i[0]);
            prices = items.map(i=>parseFloat(i[1]['4. close']));
          }
        }
      } catch(e){ console.warn('TS parse error', e); }

      // Chart render
      const markers = generateMarkersFromPrices(labels, prices);
      renderChart(labels, prices, markers);

      // Strategy: SMA crossover + portfolio simulation
      const fast = 5, slow = 20;
      const smaSignals = generateSmaSignals(labels, prices, fast, slow);
      const portfolio = simulatePortfolio(smaSignals, prices, labels, 100000);

      // Show results
      let tradesHtml = '<h4>Trades</h4><pre>' + JSON.stringify(portfolio.trades, null, 2) + '</pre>';
      let statsHtml = `<h4>Portfolio</h4><pre>Starting cash: ${portfolio.startingCash}\nFinal cash: ${portfolio.finalCash}\nPosition: ${portfolio.position}\nFinal price: ${portfolio.finalPrice}\nPortfolio value: ${portfolio.portfolioValue}</pre>`;

      // Compute equity curve and metrics
      const equity = computeEquityCurve(portfolio.trades, prices, labels, portfolio.startingCash);
      const returns = pctReturns(equity);
      const portfolioCAGR = cagr(equity);
      const portfolioSharpe = sharpe(returns);

      const metricsHtml = `<h4>Backtest Metrics</h4><pre>CAGR: ${(portfolioCAGR*100).toFixed(2)}%\\nSharpe: ${portfolioSharpe.toFixed(2)}\\nTotal trades: ${portfolio.trades.length}</pre>`;

      output.innerHTML = `<h3>${symbol} — Quote</h3><pre>${JSON.stringify(quote,null,2)}</pre>
        <h3>Top News (3)</h3><pre>${JSON.stringify(news.articles?.slice(0,3),null,2)}</pre>
        <h3>Sentiment</h3><pre>${JSON.stringify(sentiment,null,2)}</pre>
        ${statsHtml}
        ${metricsHtml}
        ${tradesHtml}`;

      // Render equity chart if we have data
      if(equity && equity.length > 1){
        renderEquityChart(equity);
      }
    } catch (e) {
      output.textContent = 'Error: ' + e.message;
    }
  };
});