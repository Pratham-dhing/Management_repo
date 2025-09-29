// server.js - Enhanced backend: supports AlphaVantage, FINNHUB or TwelveData, optional Redis caching, serves frontend
const express = require('express');
const fetch = (...args) => import('node-fetch').then(({default:fetch})=>fetch(...args));
require('dotenv').config();
const path = require('path');
const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;

// Optional Redis caching: if REDIS_URL is set, use it; otherwise use in-memory cache
let redisClient = null;
const useRedis = !!process.env.REDIS_URL;
if(useRedis){
  const Redis = require('ioredis');
  redisClient = new Redis(process.env.REDIS_URL);
  redisClient.on('error', (e)=>console.error('Redis error', e));
  console.log('Using Redis caching at', process.env.REDIS_URL);
} else {
  console.log('Using in-memory caching');
}
function setCache(key, data, ttlSec=30){
  if(useRedis){ return redisClient.setex(key, ttlSec, JSON.stringify(data)); }
  cache[key] = {expires: Date.now() + ttlSec*1000, data};
}
async function getCache(key){
  if(useRedis){
    const v = await redisClient.get(key);
    return v ? JSON.parse(v) : null;
  }
  const e = cache[key];
  if(!e) return null;
  if(Date.now() > e.expires){ delete cache[key]; return null; }
  return e.data;
}
// In-memory cache store as fallback
const cache = {};

// Serve frontend statically from current directory
app.use(express.static(path.join(__dirname)));

// Health
app.get('/api/health', (req,res)=>res.json({ok:true, time: new Date().toISOString(), provider: process.env.PRIMARY_DATA_PROVIDER || 'alphavantage'}));

// Helper for external fetch with cache (uses getCache/setCache)
async function fetchWithCache(key, url, ttl=30, opts={}){
  const cached = await getCache(key);
  if(cached) return cached;
  const r = await fetch(url, opts);
  const j = await r.json();
  await setCache(key, j, ttl);
  return j;
}

// Determine provider order: env PRIMARY_DATA_PROVIDER can be 'finnhub', 'twelvedata', or 'alphavantage'
const provider = (process.env.PRIMARY_DATA_PROVIDER || 'alphavantage').toLowerCase();

// Unified Quote endpoint - supports multiple providers
app.get('/api/quote', async (req,res)=>{
  try{
    const symbol = req.query.symbol;
    if(!symbol) return res.status(400).json({error:'symbol required'});

    if(provider === 'finnhub'){
      const key = process.env.FINNHUB_API_KEY;
      if(!key) return res.status(500).json({error:'FINNHUB_API_KEY not set'});
      const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${key}`;
      const cacheKey = `finnhub:quote:${symbol}`;
      const j = await fetchWithCache(cacheKey, url, 15);
      return res.json({provider:'finnhub', data:j});
    } else if(provider === 'twelvedata'){
      const key = process.env.TWELVEDATA_API_KEY;
      if(!key) return res.status(500).json({error:'TWELVEDATA_API_KEY not set'});
      const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}&apikey=${key}`;
      const cacheKey = `twelvedata:quote:${symbol}`;
      const j = await fetchWithCache(cacheKey, url, 15);
      return res.json({provider:'twelvedata', data:j});
    } else {
      // alphavantage fallback
      const apiKey = process.env.ALPHAVANTAGE_API_KEY;
      if(!apiKey) return res.status(500).json({error:'ALPHAVANTAGE_API_KEY not set in .env'});
      const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`;
      const key = `alphavantage:quote:${symbol}`;
      const j = await fetchWithCache(key, url, 20);
      return res.json({provider:'alphavantage', data:j});
    }
  }catch(err){ res.status(500).json({error:String(err)}); }
});

// Time series endpoint supporting providers and intervals
app.get('/api/timeseries', async (req,res)=>{
  try{
    const symbol = req.query.symbol;
    const interval = req.query.interval || '60min';
    if(!symbol) return res.status(400).json({error:'symbol required'});

    if(provider === 'finnhub'){
      // Finnhub provides candle data
      const key = process.env.FINNHUB_API_KEY;
      if(!key) return res.status(500).json({error:'FINNHUB_API_KEY not set'});
      // Map interval to resolution: 1,5,15,30,60,D
      const map = {'1min':'1','5min':'5','15min':'15','30min':'30','60min':'60'};
      const resolution = map[interval] || '60';
      const to = Math.floor(Date.now()/1000);
      const from = to - 60*60*24; // last day as default
      const url = `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=${resolution}&from=${from}&to=${to}&token=${key}`;
      const cacheKey = `finnhub:candle:${symbol}:${resolution}`;
      const j = await fetchWithCache(cacheKey, url, 30);
      return res.json({provider:'finnhub', data:j});
    } else if(provider === 'twelvedata'){
      const key = process.env.TWELVEDATA_API_KEY;
      if(!key) return res.status(500).json({error:'TWELVEDATA_API_KEY not set'});
      const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=${interval.replace('min','m')}&outputsize=500&format=json&apikey=${key}`;
      const cacheKey = `twelvedata:timeseries:${symbol}:${interval}`;
      const j = await fetchWithCache(cacheKey, url, 60);
      return res.json({provider:'twelvedata', data:j});
    } else {
      const apiKey = process.env.ALPHAVANTAGE_API_KEY;
      if(!apiKey) return res.status(500).json({error:'ALPHAVANTAGE_API_KEY not set in .env'});
      const url = `https://www.alphavantage.co/query?function=TIME_SERIES_INTRADAY&symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&outputsize=compact&apikey=${apiKey}`;
      const key = `alphavantage:timeseries:${symbol}:${interval}`;
      const j = await fetchWithCache(key, url, 60);
      return res.json({provider:'alphavantage', data:j});
    }
  }catch(err){ res.status(500).json({error:String(err)}); }
});

// News endpoint (same as before)
app.get('/api/news', async (req,res)=>{
  try{
    const q = req.query.q || 'finance';
    const providerNews = (process.env.NEWS_PROVIDER || 'newsapi').toLowerCase();
    if(providerNews === 'newsapi'){
      const apiKey = process.env.NEWSAPI_KEY;
      if(!apiKey) return res.status(500).json({error:'NEWSAPI_KEY not set in .env'});
      const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&pageSize=10&sortBy=publishedAt&language=en&apiKey=${apiKey}`;
      const key = `news:newsapi:${q}`;
      const j = await fetchWithCache(key, url, 120);
      return res.json(j);
    } else if(providerNews === 'gnews'){
      const apiKey = process.env.GNEWS_API_KEY;
      if(!apiKey) return res.status(500).json({error:'GNEWS_API_KEY not set in .env'});
      const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(q)}&max=10&token=${apiKey}&lang=en`;
      const key = `news:gnews:${q}`;
      const j = await fetchWithCache(key, url, 120);
      return res.json(j);
    } else {
      return res.status(400).json({error:'unknown news provider configured'});
    }
  }catch(err){ res.status(500).json({error:String(err)}); }
});

// Sentiment endpoint unchanged (HuggingFace or sentiment npm)
app.post('/api/sentiment', async (req,res)=>{
  try{
    const text = req.body.text || '';
    if(!text) return res.json({model:'none',result:{label:'neutral',score:0.0}});
    const hfKey = process.env.HUGGINGFACE_API_KEY;
    if(hfKey){
      const cacheKey = `sentiment:hf:${Buffer.from(text).toString('base64').slice(0,100)}`;
      const cached = await getCache(cacheKey);
      if(cached) return res.json({model:'huggingface',result:cached});
      const r = await fetch('https://api-inference.huggingface.co/models/cardiffnlp/twitter-roberta-base-sentiment-latest', {
        method:'POST',
        headers: {'Authorization': `Bearer ${hfKey}`, 'Content-Type':'application/json'},
        body: JSON.stringify({inputs:text})
      });
      const j = await r.json();
      await setCache(cacheKey, j, 3600);
      return res.json({model:'huggingface',result:j});
    } else {
      const Sentiment = require('sentiment');
      const s = new Sentiment();
      const out = s.analyze(text);
      return res.json({model:'sentiment-js',result:out});
    }
  }catch(err){ res.status(500).json({error:String(err)}); }
});

// Serve SPA fallback
app.get('*', (req,res)=>{
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, ()=>console.log(`Server running on port ${PORT} (provider=${provider})`));