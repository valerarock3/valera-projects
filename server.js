const express = require("express");
const path = require("path");
const fs = require("fs");
const YahooFinance = require("yahoo-finance2").default;
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });
const translate = require("google-translate-api-x");

const app = express();
const PORT = 3000;
const DATA_FILE = path.join(__dirname, "data.json");

const userId = "user_" + Date.now().toString(36);

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json({ limit: "5mb" }));

function readData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
  catch { return { favorites: [], portfolio: [], avatar: "", joinedAt: Date.now(), totalTime: 0, comments: [], commenters: {}, currencyBalance: { USD: 0, EUR: 0, RUB: 100000 } }; }
}

function writeData(d) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2));
}

const STOCK_SYMBOLS = ["AAPL", "MSFT", "GOOGL", "AMZN", "TSLA", "META", "NVDA", "JPM", "V", "JNJ"];
const CRYPTO_SYMBOLS = ["BTC-USD", "ETH-USD", "BNB-USD", "XRP-USD", "SOL-USD", "ADA-USD", "DOGE-USD", "AVAX-USD", "DOT-USD", "LINK-USD"];
const CURRENCY_SYMBOLS = ["USDRUB=X", "EURUSD=X", "EURRUB=X"];

async function fetchQuotes(symbols) {
  const results = [];
  for (const symbol of symbols) {
    try {
      const quote = await yahooFinance.quote(symbol);
      results.push({
        symbol: quote.symbol,
        name: quote.shortName || quote.longName || symbol,
        price: quote.regularMarketPrice,
        change: quote.regularMarketChange,
        changePercent: quote.regularMarketChangePercent,
        marketCap: quote.marketCap,
      });
    } catch (err) {
      console.error(`Error fetching ${symbol}:`, err.message);
    }
  }
  return results;
}

app.get("/api/stocks", async (_req, res) => {
  try {
    const data = await fetchQuotes(STOCK_SYMBOLS);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/crypto", async (_req, res) => {
  try {
    const data = await fetchQuotes(CRYPTO_SYMBOLS);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/currency", async (_req, res) => {
  try {
    const raw = await fetchQuotes(CURRENCY_SYMBOLS);
    const map = {};
    for (const r of raw) { const sym = r.symbol.replace("=X", ""); map[sym] = { price: r.price, change: r.change, changePercent: r.changePercent }; }
    res.json(map);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/quote", async (req, res) => {
  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: "symbol required" });
  try {
    const quote = await yahooFinance.quote(symbol);
    res.json({
      symbol: quote.symbol,
      name: quote.shortName || quote.longName || symbol,
      price: quote.regularMarketPrice,
      change: quote.regularMarketChange,
      changePercent: quote.regularMarketChangePercent,
      marketCap: quote.marketCap,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/chart", async (req, res) => {
  const { symbol, range } = req.query;
  if (!symbol) return res.status(400).json({ error: "symbol required" });
  const now = Math.floor(Date.now() / 1000);
  const ranges = { "1d": 86400, "5d": 432000, "1mo": 2592000, "6mo": 15552000, "1y": 31536000 };
  const intervals = { "1d": "5m", "5d": "15m", "1mo": "1d", "6mo": "1d", "1y": "1wk" };
  const period = ranges[range] || 2592000;
  const interval = intervals[range] || "1d";
  try {
    const result = await yahooFinance.chart(symbol, { period1: now - period, period2: now, interval });
    const quotes = result.quotes || [];
    const data = quotes.filter((q) => q.close != null).map((q) => ({ date: q.date, close: q.close }));
    res.json({ symbol, range, data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/news", async (req, res) => {
  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: "symbol required" });
  try {
    const result = await yahooFinance.search(symbol, { newsCount: 10 });
    const news = (result.news || []).map((n) => ({ title: n.title, link: n.link, publisher: n.publisher, summary: n.summary?.slice(0, 200) || "" }));
    for (const item of news) {
      try {
        const t = await translate(item.title, { from: "en", to: "ru" });
        if (t && t.text) item.title = t.text;
      } catch {}
    }
    res.json(news);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

function calcRSI(closes) {
  if (closes.length < 15) return 50;
  const gains = []; const losses = [];
  for (let i = 1; i < closes.length; i++) { const diff = closes[i] - closes[i - 1]; gains.push(diff > 0 ? diff : 0); losses.push(diff < 0 ? -diff : 0); }
  const avgGain = gains.slice(-14).reduce((a, b) => a + b, 0) / 14;
  const avgLoss = losses.slice(-14).reduce((a, b) => a + b, 0) / 14;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function calcSMA(closes, period) {
  if (closes.length < period) return null;
  return closes.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calcMACD(closes) {
  if (closes.length < 26) return null;
  const ema12 = calcEMA(closes.slice(-12));
  const ema26 = calcEMA(closes.slice(-26));
  if (ema12 == null || ema26 == null) return null;
  return ema12 - ema26;
}

function calcEMA(closes) {
  if (closes.length < 2) return null;
  const k = 2 / (closes.length + 1);
  let ema = closes[0];
  for (let i = 1; i < closes.length; i++) { ema = closes[i] * k + ema * (1 - k); }
  return ema;
}

async function buildRecommendation(symbol) {
  const quote = await yahooFinance.quote(symbol);
  const now = Math.floor(Date.now() / 1000);
  const hist = await yahooFinance.chart(symbol, { period1: now - 60 * 86400, period2: now, interval: "1d" });
  const quotes = (hist.quotes || []).filter((h) => h.close != null);
  const closes = quotes.map((h) => h.close);
  const volumes = quotes.map((h) => h.volume || 0);

  const rsi = calcRSI(closes);
  const sma20 = calcSMA(closes, 20);
  const sma5 = calcSMA(closes, 5);
  const macd = calcMACD(closes);
  const currentPrice = quote.regularMarketPrice;
  const change = quote.regularMarketChangePercent;

  const signals = [];
  let score = 50;
  const reasons = [];

  if (rsi < 30) { score += 20; signals.push({ label: "RSI перепродан", dir: "up" }); reasons.push("RSI указывает на перепроданность"); }
  else if (rsi < 40) { score += 10; signals.push({ label: "RSI низкий", dir: "up" }); reasons.push("RSI ниже нормы — потенциал роста"); }
  else if (rsi > 70) { score -= 20; signals.push({ label: "RSI перекуплен", dir: "down" }); reasons.push("RSI указывает на перекупленность"); }
  else if (rsi > 60) { score -= 10; signals.push({ label: "RSI высокий", dir: "down" }); reasons.push("RSI выше нормы — риск коррекции"); }
  else { signals.push({ label: "RSI нейтрален", dir: "neutral" }); }

  if (sma5 != null && sma20 != null) {
    if (sma5 > sma20) { score += 10; signals.push({ label: "SMA5 > SMA20", dir: "up" }); reasons.push("Краткосрочный тренд выше долгосрочного"); }
    else { score -= 10; signals.push({ label: "SMA5 < SMA20", dir: "down" }); reasons.push("Краткосрочный тренд ниже долгосрочного"); }
  }

  if (currentPrice != null && sma20 != null) {
    const pctFromSMA = ((currentPrice - sma20) / sma20) * 100;
    if (pctFromSMA < -5) { score += 15; signals.push({ label: "Цена ниже SMA20", dir: "up" }); reasons.push("Цена значительно ниже среднего — возможно дно"); }
    else if (pctFromSMA > 8) { score -= 15; signals.push({ label: "Цена выше SMA20", dir: "down" }); reasons.push("Цена значительно выше среднего — возможен откат"); }
  }

  if (macd != null) {
    if (macd > 0) { score += 5; signals.push({ label: "MACD > 0", dir: "up" }); }
    else { score -= 5; signals.push({ label: "MACD < 0", dir: "down" }); }
  }

  if (volumes.length > 10) {
    const avgVol = volumes.slice(-10).reduce((a, b) => a + b, 0) / 10;
    const lastVol = volumes[volumes.length - 1] || 0;
    if (lastVol > avgVol * 1.5 && change > 0) { score += 5; signals.push({ label: "Рост с объёмом", dir: "up" }); reasons.push("Рост подтверждается высоким объёмом"); }
    else if (lastVol > avgVol * 1.5 && change < 0) { score -= 5; signals.push({ label: "Падение с объёмом", dir: "down" }); reasons.push("Падение подтверждается высоким объёмом"); }
  }

  if (change > 5) { score += 5; signals.push({ label: "Сильный рост", dir: "up" }); }
  else if (change < -5) { score -= 5; signals.push({ label: "Сильное падение", dir: "down" }); }

  score = Math.max(0, Math.min(100, score));

  let action, reason;
  if (score >= 75) { action = "strong-buy"; reason = "Мощные сигналы к покупке — несколько индикаторов указывают на рост"; }
  else if (score >= 55) { action = "buy"; reason = reasons.length > 0 ? reasons[0] : "Больше позитивных сигналов, чем негативных"; }
  else if (score <= 25) { action = "strong-sell"; reason = "Мощные сигналы к продаже — рекомендуется фиксация прибыли"; }
  else if (score <= 45) { action = "sell"; reason = reasons.length > 0 ? reasons[0] : "Больше негативных сигналов, чем позитивных"; }
  else { action = "hold"; reason = "Сигналы противоречивы — лучше выждать"; }

  return {
    symbol: quote.symbol,
    name: quote.shortName || quote.longName || symbol,
    price: currentPrice,
    change,
    rsi: Math.round(rsi),
    score,
    action,
    reason,
    signals,
  };
}

app.get("/api/recommendations", async (_req, res) => {
  try {
    const allSymbols = [...STOCK_SYMBOLS, ...CRYPTO_SYMBOLS];
    // Параллельные запросы к Yahoo Finance
    const results = await Promise.allSettled(allSymbols.map((symbol) => buildRecommendation(symbol)));
    const recs = results
      .filter((r) => r.status === "fulfilled")
      .map((r) => r.value);
    for (let i = 0; i < results.length; i++) {
      if (results[i].status === "rejected") console.error(`Rec error ${allSymbols[i]}:`, results[i].reason?.message);
    }
    const order = { "strong-buy": 0, buy: 1, hold: 2, sell: 3, "strong-sell": 4 };
    recs.sort((a, b) => order[a.action] - order[b.action]);
    res.json(recs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/recommendation", async (req, res) => {
  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: "symbol required" });
  try {
    const quote = await yahooFinance.quote(symbol);
    const now = Math.floor(Date.now() / 1000);
    const hist = await yahooFinance.chart(symbol, { period1: now - 60 * 86400, period2: now, interval: "1d" });
    const quotes = (hist.quotes || []).filter((h) => h.close != null);
    const closes = quotes.map((h) => h.close);
    const volumes = quotes.map((h) => h.volume || 0);

    const rsi = calcRSI(closes);
    const sma20 = calcSMA(closes, 20);
    const sma5 = calcSMA(closes, 5);
    const macd = calcMACD(closes);
    const currentPrice = quote.regularMarketPrice;
    const change = quote.regularMarketChangePercent;

    const signals = [];
    let score = 50;
    const reasons = [];

    if (rsi < 30) { score += 20; signals.push({ label: "RSI перепродан", dir: "up" }); reasons.push("RSI указывает на перепроданность"); }
    else if (rsi < 40) { score += 10; signals.push({ label: "RSI низкий", dir: "up" }); reasons.push("RSI ниже нормы — потенциал роста"); }
    else if (rsi > 70) { score -= 20; signals.push({ label: "RSI перекуплен", dir: "down" }); reasons.push("RSI указывает на перекупленность"); }
    else if (rsi > 60) { score -= 10; signals.push({ label: "RSI высокий", dir: "down" }); reasons.push("RSI выше нормы — риск коррекции"); }

    if (sma5 != null && sma20 != null) {
      if (sma5 > sma20) { score += 10; signals.push({ label: "SMA5 > SMA20", dir: "up" }); reasons.push("Краткосрочный тренд выше долгосрочного"); }
      else { score -= 10; signals.push({ label: "SMA5 < SMA20", dir: "down" }); reasons.push("Краткосрочный тренд ниже долгосрочного"); }
    }
    if (currentPrice != null && sma20 != null) {
      const pctFromSMA = ((currentPrice - sma20) / sma20) * 100;
      if (pctFromSMA < -5) { score += 15; signals.push({ label: "Цена ниже SMA20", dir: "up" }); reasons.push("Цена значительно ниже среднего"); }
      else if (pctFromSMA > 8) { score -= 15; signals.push({ label: "Цена выше SMA20", dir: "down" }); reasons.push("Цена значительно выше среднего"); }
    }
    if (macd != null) { if (macd > 0) { score += 5; signals.push({ label: "MACD > 0", dir: "up" }); } else { score -= 5; signals.push({ label: "MACD < 0", dir: "down" }); } }

    score = Math.max(0, Math.min(100, score));

    let action, reason;
    if (score >= 75) { action = "strong-buy"; reason = "Мощные сигналы к покупке"; }
    else if (score >= 55) { action = "buy"; reason = reasons.length > 0 ? reasons[0] : "Позитивный настрой"; }
    else if (score <= 25) { action = "strong-sell"; reason = "Мощные сигналы к продаже"; }
    else if (score <= 45) { action = "sell"; reason = reasons.length > 0 ? reasons[0] : "Негативный настрой"; }
    else { action = "hold"; reason = "Сигналы противоречивы — лучше выждать"; }

    const actionLabels = { "strong-buy": "🔥 Покупать", buy: "✅ Покупать", hold: "⚪ Держать", sell: "⛔ Продавать", "strong-sell": "🚨 Продавать" };
    const shortReason = score >= 60 ? "Рекомендуем купить сейчас и продать через месяц для фиксации прибыли" :
      score >= 45 ? "Рекомендуем держать и следить за рынком" :
      "Рекомендуем продать сейчас, цена может снизиться";

    res.json({
      symbol: quote.symbol, name: quote.shortName || quote.longName || symbol,
      price: currentPrice, change, rsi: Math.round(rsi), score, action, reason, signals,
      actionLabel: actionLabels[action] || "Держать", shortReason,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/currency/buy", async (req, res) => {
  const { currency, amount } = req.body;
  if (!currency || !amount || amount <= 0) return res.status(400).json({ error: "currency and positive amount required" });
  if (!["USD", "EUR"].includes(currency)) return res.status(400).json({ error: "only USD or EUR" });
  try {
    const quote = await yahooFinance.quote(currency === "USD" ? "USDRUB=X" : "EURRUB=X");
    const rate = quote.regularMarketPrice;
    const costRUB = amount * rate;
    const data = readData();
    if (!data.currencyBalance) data.currencyBalance = { USD: 0, EUR: 0, RUB: 100000 };
    if ((data.currencyBalance.RUB || 0) < costRUB) return res.status(400).json({ error: "Недостаточно RUB" });
    data.currencyBalance.RUB -= costRUB;
    data.currencyBalance[currency] = (data.currencyBalance[currency] || 0) + amount;
    writeData(data);
    res.json({ currencyBalance: data.currencyBalance, rate, cost: costRUB });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/currency/sell", async (req, res) => {
  const { currency, amount } = req.body;
  if (!currency || !amount || amount <= 0) return res.status(400).json({ error: "currency and positive amount required" });
  if (!["USD", "EUR"].includes(currency)) return res.status(400).json({ error: "only USD or EUR" });
  try {
    const quote = await yahooFinance.quote(currency === "USD" ? "USDRUB=X" : "EURRUB=X");
    const rate = quote.regularMarketPrice;
    const revenueRUB = amount * rate;
    const data = readData();
    if (!data.currencyBalance) data.currencyBalance = { USD: 0, EUR: 0, RUB: 100000 };
    if ((data.currencyBalance[currency] || 0) < amount) return res.status(400).json({ error: `Недостаточно ${currency}` });
    data.currencyBalance[currency] -= amount;
    data.currencyBalance.RUB = (data.currencyBalance.RUB || 0) + revenueRUB;
    writeData(data);
    res.json({ currencyBalance: data.currencyBalance, rate, revenue: revenueRUB });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/profile", (req, res) => {
  const data = readData();
  if (!data._userId) { data._userId = userId; writeData(data); }
  if (!data.currencyBalance) data.currencyBalance = { USD: 0, EUR: 0, RUB: 100000 };
  res.json({
    userId: data._userId,
    avatar: data.avatar || "",
    joinedAt: data.joinedAt,
    totalTime: data.totalTime || 0,
    favorites: data.favorites || [],
    portfolio: data.portfolio || [],
    currencyBalance: data.currencyBalance,
  });
});

app.post("/api/profile/time", (req, res) => {
  const { seconds } = req.body;
  if (typeof seconds !== "number") return res.status(400).json({ error: "seconds required" });
  const data = readData();
  data.totalTime = (data.totalTime || 0) + seconds;
  writeData(data);
  res.json({ totalTime: data.totalTime });
});

app.post("/api/avatar", (req, res) => {
  const { image } = req.body;
  if (!image) return res.status(400).json({ error: "image required" });
  const data = readData();
  data.avatar = image;
  writeData(data);
  res.json({ avatar: image });
});

app.post("/api/favorites/toggle", (req, res) => {
  const { symbol, name } = req.body;
  if (!symbol) return res.status(400).json({ error: "symbol required" });
  const data = readData();
  const idx = data.favorites.findIndex((f) => f.symbol === symbol);
  if (idx >= 0) { data.favorites.splice(idx, 1); }
  else { data.favorites.push({ symbol, name: name || symbol, addedAt: Date.now() }); }
  writeData(data);
  res.json({ favorites: data.favorites });
});

app.post("/api/portfolio/buy", async (req, res) => {
  const { symbol, name, quantity, price } = req.body;
  if (!symbol || !quantity || !price) return res.status(400).json({ error: "symbol, quantity, price required" });
  const qty = Number(quantity);
  const pr = Number(price);
  if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(pr) || pr < 0) {
    return res.status(400).json({ error: "invalid quantity or price" });
  }
  const data = readData();
  const existing = data.portfolio.find((p) => p.symbol === symbol);
  if (existing) {
    const totalCost = existing.quantity * existing.avgPrice + qty * pr;
    existing.quantity = Number(existing.quantity) + qty;
    existing.avgPrice = totalCost / existing.quantity;
  } else {
    data.portfolio.push({ symbol, name: name || symbol, quantity: qty, avgPrice: pr, boughtAt: Date.now() });
  }
  writeData(data);
  res.json({ portfolio: data.portfolio });
});

app.post("/api/portfolio/sell", (req, res) => {
  const { symbol, quantity } = req.body;
  if (!symbol || !quantity) return res.status(400).json({ error: "symbol, quantity required" });
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ error: "invalid quantity" });
  const data = readData();
  const idx = data.portfolio.findIndex((p) => p.symbol === symbol);
  if (idx < 0) return res.status(400).json({ error: "not in portfolio" });
  const item = data.portfolio[idx];
  if (qty >= Number(item.quantity)) { data.portfolio.splice(idx, 1); }
  else { item.quantity = Number(item.quantity) - qty; }
  writeData(data);
  res.json({ portfolio: data.portfolio });
});

const NAMES = ["Алексей", "Мария", "Дмитрий", "Елена", "Сергей", "Анна", "Иван", "Ольга", "Павел", "Татьяна",
  "Максим", "Юлия", "Артём", "Наталья", "Кирилл", "Светлана", "Роман", "Екатерина", "Никита", "Ксения"];
const COLORS = ["#f44336","#e91e63","#9c27b0","#673ab7","#3f51b5","#2196f3","#009688","#4caf50","#ff9800","#795548"];

const POSITIVE_COMMENTS = [
  "Отличные показатели в этом квартале, рекомендую к покупке",
  "Фундаментально сильная позиция на рынке, долгосрочный потенциал",
  "Хороший момент для входа, цена справедливая",
  "Стабильный рост и хорошие перспективы развития",
  "Один из лучших активов в своём секторе",
];
const NEGATIVE_COMMENTS = [
  "Слабый отчёт за последний период, лучше воздержаться",
  "Высокая волатильность и неопределённость, риски велики",
  "Снижение ключевых показателей, рекомендую продавать",
  "Переоценена относительно конкурентов, лучше присмотреться к другим",
  "Технические индикаторы указывают на коррекцию в ближайшее время",
];

function getOrCreateCommenter(data, userId) {
  if (!data.commenters) data.commenters = {};
  if (!data.commenters[userId]) {
    const name = NAMES[Math.floor(Math.random() * NAMES.length)];
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    const joined = Date.now() - Math.floor(Math.random() * 30 * 86400000);
    data.commenters[userId] = {
      username: name,
      avatarColor: color,
      joinedAt: joined,
      totalTime: Math.floor(Math.random() * 36000),
      totalEarnings: (Math.random() * 5000 - 500).toFixed(2),
    };
    writeData(data);
  }
  return data.commenters[userId];
}

function seedComments(data, symbol) {
  if (!data.comments) data.comments = [];
  const existing = data.comments.filter((c) => c.symbol === symbol);
  if (existing.length >= 5) return;
  const needed = 5 - existing.length;
  for (let i = 0; i < needed; i++) {
    const isPos = i < Math.ceil(needed / 2);
    const texts = isPos ? POSITIVE_COMMENTS : NEGATIVE_COMMENTS;
    const text = texts[i % texts.length];
    const seedUserId = "seed_" + symbol + "_" + i;
    getOrCreateCommenter(data, seedUserId);
    data.comments.push({
      id: "seed_" + symbol + "_" + i + "_" + Date.now().toString(36),
      symbol,
      userId: seedUserId,
      text,
      date: Date.now() - (needed - i) * 3600000,
      likes: Math.floor(Math.random() * 8) + 1,
      dislikes: Math.floor(Math.random() * 3),
      voters: {},
    });
  }
  writeData(data);
}

app.get("/api/comments", (req, res) => {
  const { symbol, userId } = req.query;
  if (!symbol) return res.status(400).json({ error: "symbol required" });
  const data = readData();
  seedComments(data, symbol);
  const comments = (data.comments || []).filter((c) => c.symbol === symbol).sort((a, b) => b.date - a.date);
  const enriched = comments.map((c) => {
    const commenter = data.commenters?.[c.userId] || {};
    const userVote = userId && c.voters ? (c.voters[userId] || null) : null;
    return {
      ...c,
      username: commenter.username || "Аноним",
      avatarColor: commenter.avatarColor || "#666",
      userVote,
    };
  });
  res.json(enriched);
});

app.post("/api/comments", (req, res) => {
  const { symbol, text, userId } = req.body;
  if (!symbol || !text || !userId) return res.status(400).json({ error: "symbol, text, userId required" });
  const data = readData();
  const commenter = getOrCreateCommenter(data, userId);
  if (!data.comments) data.comments = [];
  data.comments.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    symbol,
    userId,
    text: text.slice(0, 500),
    date: Date.now(),
    likes: 0,
    dislikes: 0,
    voters: {},
  });
  writeData(data);
  res.json({ success: true, commenter });
});

app.post("/api/comments/vote", (req, res) => {
  const { commentId, userId, vote } = req.body;
  if (!commentId || !userId || !vote) return res.status(400).json({ error: "commentId, userId, vote required" });
  if (!["up", "down"].includes(vote)) return res.status(400).json({ error: "vote must be up or down" });
  const data = readData();
  const comment = (data.comments || []).find((c) => c.id === commentId);
  if (!comment) return res.status(404).json({ error: "comment not found" });
  if (!comment.voters) comment.voters = {};
  const prevVote = comment.voters[userId];
  if (prevVote === vote) {
    comment.voters[userId] = null;
    if (vote === "up") comment.likes = Math.max(0, (comment.likes || 0) - 1);
    else comment.dislikes = Math.max(0, (comment.dislikes || 0) - 1);
  } else {
    if (prevVote === "up") comment.likes = Math.max(0, (comment.likes || 0) - 1);
    else if (prevVote === "down") comment.dislikes = Math.max(0, (comment.dislikes || 0) - 1);
    comment.voters[userId] = vote;
    if (vote === "up") comment.likes = (comment.likes || 0) + 1;
    else comment.dislikes = (comment.dislikes || 0) + 1;
  }
  writeData(data);
  res.json({ likes: comment.likes, dislikes: comment.dislikes, userVote: comment.voters[userId] });
});

app.get("/api/commenter/:userId", (req, res) => {
  const data = readData();
  const c = data.commenters?.[req.params.userId];
  if (!c) return res.status(404).json({ error: "not found" });
  const portfolio = data.portfolio || [];
  const totalValue = portfolio.reduce((sum, p) => sum + p.quantity * (p.currentPrice || p.avgPrice), 0);
  const totalInvested = portfolio.reduce((sum, p) => sum + p.quantity * p.avgPrice, 0);
  const earnings = totalValue - totalInvested;
  res.json({
    username: c.username,
    avatarColor: c.avatarColor,
    totalTime: c.totalTime,
    totalEarnings: c.userId === userId ? earnings : parseFloat(c.totalEarnings),
    joinedAt: c.joinedAt,
  });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Your user ID: ${userId}`);
});
