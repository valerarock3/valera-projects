const DOMAINS = {
  AAPL: "apple.com", MSFT: "microsoft.com", GOOGL: "google.com",
  AMZN: "amazon.com", TSLA: "tesla.com", META: "meta.com",
  NVDA: "nvidia.com", JPM: "jpmorganchase.com", V: "visa.com", JNJ: "jnj.com",
};

const CRYPTO_COLORS = {
  "BTC-USD": "#f7931a", "ETH-USD": "#627eea", "BNB-USD": "#f0b90b",
  "XRP-USD": "#23292f", "SOL-USD": "#9945ff", "ADA-USD": "#0033ad",
  "DOGE-USD": "#c2a633", "AVAX-USD": "#e84142", "DOT-USD": "#e6007a",
  "LINK-USD": "#2a5ada",
};

const CRYPTO_ICONS = {
  "BTC-USD": "₿", "ETH-USD": "⟠", "BNB-USD": "◆", "XRP-USD": "✕",
  "SOL-USD": "◎", "ADA-USD": "♢", "DOGE-USD": "Ð", "AVAX-USD": "▲",
  "DOT-USD": "●", "LINK-USD": "◈",
};

const CURRENCY_INFO = {
  USDRUB: { flag: "🇺🇸→🇷🇺" }, EURUSD: { flag: "🇪🇺→🇺🇸" }, EURRUB: { flag: "🇪🇺→🇷🇺" },
};

const tabContents = {
  stocks: document.getElementById("stocks"),
  crypto: document.getElementById("crypto"),
  recs: document.getElementById("recs"),
  profile: document.getElementById("profile"),
};
const mainTabs = document.querySelectorAll(".main-tabs .tab");

let currentDetailSymbol = null;
let currentDetailName = null;
let favorites = [];
let portfolio = [];
let stocksData = [];
let cryptoData = [];

let sessionStart = Date.now();
let timeInterval = null;

mainTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    mainTabs.forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    Object.values(tabContents).forEach((c) => c.classList.remove("active"));
    tabContents[tab.dataset.tab].classList.add("active");
  });
});

document.getElementById("recs-btn").addEventListener("click", () => {
  mainTabs.forEach((t) => t.classList.remove("active"));
  Object.values(tabContents).forEach((c) => c.classList.remove("active"));
  tabContents.recs.classList.add("active");
});

document.getElementById("profile-btn").addEventListener("click", () => {
  mainTabs.forEach((t) => t.classList.remove("active"));
  Object.values(tabContents).forEach((c) => c.classList.remove("active"));
  tabContents.profile.classList.add("active");
  renderProfile();
});

function formatPrice(price) {
  if (price == null) return "—";
  if (price >= 1000) return price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 1) return price.toFixed(2);
  return price.toFixed(4);
}

function formatCap(cap) {
  if (!cap) return "";
  if (cap >= 1e12) return `💰 ${(cap / 1e12).toFixed(2)} трлн`;
  if (cap >= 1e9) return `💰 ${(cap / 1e9).toFixed(2)} млрд`;
  if (cap >= 1e6) return `💰 ${(cap / 1e6).toFixed(2)} млн`;
  return "";
}

function formatDuration(seconds) {
  const days = Math.floor(seconds / 86400);
  const hrs = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}д ${hrs}ч`;
  if (hrs > 0) return `${hrs}ч ${mins}мин`;
  return `${mins}мин`;
}

function isFav(symbol) {
  return favorites.some((f) => f.symbol === symbol);
}

let currentUserId = null;

function openDetail(symbol, name, type, showRec) {
  currentDetailSymbol = symbol;
  currentDetailName = name;
  const price = document.getElementById("detail-price");
  const change = document.getElementById("detail-change");
  const cap = document.getElementById("detail-cap");
  const title = document.getElementById("detail-title");
  const favBtn = document.getElementById("detail-fav-btn");

  title.textContent = `${name} (${symbol})`;
  document.getElementById("detail-overlay").classList.remove("hidden");
  document.body.style.overflow = "hidden";

  favBtn.textContent = isFav(symbol) ? "★ В избранном" : "☆ В избранное";
  loadPriceInfo(symbol, price, change, cap);
  loadChart(symbol, "1d");
  loadNews(symbol);
  if (showRec) loadRecInfo(symbol); else document.getElementById("detail-rec-panel").classList.add("hidden");
  loadComments(symbol);
}

document.getElementById("back-btn").addEventListener("click", closeDetail);
document.getElementById("detail-fav-btn").addEventListener("click", async () => {
  if (!currentDetailSymbol) return;
  await toggleFav(currentDetailSymbol, currentDetailName);
  document.getElementById("detail-fav-btn").textContent =
    isFav(currentDetailSymbol) ? "★ В избранном" : "☆ В избранное";
  renderCards();
});
document.getElementById("detail-buy-btn").addEventListener("click", () => {
  if (currentDetailSymbol) openBuyModal(currentDetailSymbol, currentDetailName);
});

document.querySelectorAll(".chart-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".chart-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    if (currentDetailSymbol) loadChart(currentDetailSymbol, btn.dataset.range);
  });
});

function closeDetail() {
  document.getElementById("detail-overlay").classList.add("hidden");
  document.body.style.overflow = "";
}

async function loadPriceInfo(symbol, priceEl, changeEl, capEl) {
  try {
    const res = await fetch(`/api/quote?symbol=${symbol}`);
    const item = await res.json();
    if (item.error) return;
    priceEl.textContent = `$${formatPrice(item.price)}`;
    changeEl.textContent = `${item.change >= 0 ? "+" : ""}${item.change.toFixed(2)} (${item.changePercent >= 0 ? "+" : ""}${item.changePercent.toFixed(2)}%)`;
    changeEl.className = `detail-change ${item.change >= 0 ? "positive" : "negative"}`;
    capEl.textContent = formatCap(item.marketCap);
  } catch {}
}

async function loadChart(symbol, range) {
  const canvas = document.getElementById("chart-canvas");
  const wrap = canvas.parentElement;
  const dpr = window.devicePixelRatio || 1;
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  try {
    const res = await fetch(`/api/chart?symbol=${symbol}&range=${range}`);
    const result = await res.json();
    if (result.error || !result.data.length) {
      ctx.fillStyle = "#6a7a88"; ctx.font = "14px sans-serif"; ctx.textAlign = "center";
      ctx.fillText("Нет данных для графика", w / 2, h / 2);
      return;
    }
    const prices = result.data.map((d) => d.close);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const pad = (max - min) * 0.08 || max * 0.05;
    const yMin = min - pad;
    const yMax = max + pad;
    const isUp = prices[prices.length - 1] >= prices[0];
    const color = isUp ? "#4caf50" : "#f44336";
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, color + "40");
    grad.addColorStop(1, color + "05");
    const xs = prices.map((_, i) => (i / (prices.length - 1)) * w);
    const ys = prices.map((p) => h - ((p - yMin) / (yMax - yMin)) * h);
    ctx.clearRect(0, 0, w, h);
    ctx.beginPath(); ctx.moveTo(xs[0], ys[0]);
    for (let i = 1; i < xs.length; i++) { const xc = (xs[i] + xs[i - 1]) / 2; const yc = (ys[i] + ys[i - 1]) / 2; ctx.quadraticCurveTo(xs[i - 1], ys[i - 1], xc, yc); }
    ctx.lineTo(xs[xs.length - 1], h); ctx.lineTo(xs[0], h); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();
    ctx.beginPath(); ctx.moveTo(xs[0], ys[0]);
    for (let i = 1; i < xs.length; i++) { const xc = (xs[i] + xs[i - 1]) / 2; const yc = (ys[i] + ys[i - 1]) / 2; ctx.quadraticCurveTo(xs[i - 1], ys[i - 1], xc, yc); }
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(xs[xs.length - 1], ys[ys.length - 1], 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#5a6a78"; ctx.font = "10px sans-serif"; ctx.textAlign = "left";
    ctx.fillText(formatPrice(yMax), 4, 12); ctx.fillText(formatPrice(yMin), 4, h - 4);
  } catch { ctx.fillStyle = "#6a7a88"; ctx.font = "14px sans-serif"; ctx.textAlign = "center"; ctx.fillText("Ошибка загрузки графика", w / 2, h / 2); }
}

async function loadNews(symbol) {
  const el = document.getElementById("news-list");
  el.innerHTML = '<div class="loading">Загрузка новостей...</div>';
  try {
    const res = await fetch(`/api/news?symbol=${symbol}`);
    const news = await res.json();
    if (news.error || !news.length) { el.innerHTML = '<div style="color:#6a7a88;text-align:center;padding:20px">Новостей пока нет</div>'; return; }
    el.innerHTML = news.map((n) => `<div class="news-item"><a href="${n.link}" target="_blank" rel="noopener">${n.title}</a><div class="news-meta">${n.publisher || ""}${n.summary ? ` — ${n.summary.slice(0, 120)}` : ""}</div></div>`).join("");
  } catch { el.innerHTML = '<div class="error">Ошибка загрузки новостей</div>'; }
}

async function loadRecInfo(symbol) {
  const panel = document.getElementById("detail-rec-panel");
  try {
    const res = await fetch(`/api/recommendation?symbol=${symbol}`);
    const rec = await res.json();
    if (rec.error) { panel.classList.add("hidden"); return; }
    const badge = document.getElementById("rec-panel-badge");
    const title = document.getElementById("rec-panel-title");
    const reason = document.getElementById("rec-panel-reason");
    const sigs = document.getElementById("rec-panel-signals");
    const score = document.getElementById("rec-panel-score");
    const advice = document.getElementById("rec-panel-advice");
    badge.textContent = rec.actionLabel;
    badge.className = `rec-panel-badge ${rec.action}`;
    title.textContent = `Оценка: ${rec.score}/100 · RSI: ${rec.rsi}`;
    reason.textContent = rec.reason;
    sigs.innerHTML = (rec.signals || []).map((s) => `<span class="rec-signal ${s.dir}">${s.label}</span>`).join("");
    score.textContent = `Изменение: ${rec.change >= 0 ? "+" : ""}${rec.change?.toFixed(2)}%`;
    advice.textContent = rec.shortReason;
    panel.classList.remove("hidden");
  } catch { panel.classList.add("hidden"); }
}

async function loadComments(symbol) {
  const list = document.getElementById("comments-list");
  list.innerHTML = '<div class="loading">Загрузка...</div>';
  try {
    const uid = currentUserId || "";
    const res = await fetch(`/api/comments?symbol=${symbol}&userId=${uid}`);
    const comments = await res.json();
    if (!comments.length) { list.innerHTML = '<div style="color:#5a6a78;text-align:center;padding:20px;font-size:13px">Пока нет комментариев. Будьте первым!</div>'; return; }
    list.innerHTML = comments.map((c) => {
      const uv = c.userVote;
      return `
      <div class="comment-item">
        <div class="comment-avatar" data-userid="${c.userId}" style="background:${c.avatarColor || "#555"}">
          ${c.username ? c.username[0].toUpperCase() : "?"}
        </div>
        <div class="comment-body">
          <div class="comment-header">
            <span class="comment-username">${c.username}</span>
            <span class="comment-date">${formatDate(c.date)}</span>
          </div>
          <div class="comment-text">${escapeHtml(c.text)}</div>
          <div class="comment-votes">
            <button class="vote-btn up ${uv === "up" ? "active" : ""}" data-id="${c.id}" data-vote="up">👍 ${c.likes || 0}</button>
            <button class="vote-btn down ${uv === "down" ? "active" : ""}" data-id="${c.id}" data-vote="down">👎 ${c.dislikes || 0}</button>
          </div>
        </div>
      </div>`;
    }).join("");
    list.querySelectorAll(".comment-avatar").forEach((el) => {
      el.addEventListener("click", (e) => showCommenterPopup(e, el.dataset.userid, el));
    });
    list.querySelectorAll(".vote-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => voteComment(e, btn.dataset.id, btn.dataset.vote));
    });
  } catch { list.innerHTML = '<div class="error">Ошибка загрузки</div>'; }
}

async function voteComment(event, commentId, vote) {
  event.stopPropagation();
  if (!currentUserId) {
    try {
      const res = await fetch("/api/profile");
      const p = await res.json();
      currentUserId = p.userId;
    } catch { return; }
  }
  try {
    const res = await fetch("/api/comments/vote", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commentId, userId: currentUserId, vote }),
    });
    const data = await res.json();
    if (data.error) return;
    const btn = event.currentTarget;
    const parent = btn.closest(".comment-votes");
    parent.querySelectorAll(".vote-btn").forEach((b) => b.classList.remove("active"));
    if (data.userVote) btn.classList.add("active");
    parent.querySelector(".vote-btn.up").innerHTML = `👍 ${data.likes}`;
    parent.querySelector(".vote-btn.down").innerHTML = `👎 ${data.dislikes}`;
  } catch {}
}

function escapeHtml(text) {
  const d = document.createElement("div"); d.textContent = text; return d.innerHTML;
}

function formatDate(ts) {
  const d = new Date(ts);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return "только что";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}м назад`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}ч назад`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}д назад`;
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

let popupUserId = null;

async function showCommenterPopup(event, userId, el) {
  const popup = document.getElementById("commenter-popup");
  const rect = el.getBoundingClientRect();
  try {
    const res = await fetch(`/api/commenter/${userId}`);
    const data = await res.json();
    if (data.error) return;
    const avatar = document.getElementById("popup-avatar");
    avatar.textContent = data.username[0].toUpperCase();
    avatar.style.background = data.avatarColor || "#555";
    document.getElementById("popup-name").textContent = data.username;
    const days = Math.floor((data.totalTime || 0) / 86400);
    const hrs = Math.floor(((data.totalTime || 0) % 86400) / 3600);
    document.getElementById("popup-time").textContent = days > 0 ? `${days}д ${hrs}ч` : `${hrs}ч`;
    const earnings = parseFloat(data.totalEarnings) || 0;
    const earningsEl = document.getElementById("popup-earnings");
    earningsEl.textContent = `${earnings >= 0 ? "+" : ""}$${earnings.toFixed(2)}`;
    earningsEl.style.color = earnings >= 0 ? "#4caf50" : "#f44336";
    popup.classList.remove("hidden");
    popupUserId = userId;

    let top = rect.bottom + 8;
    let left = rect.left + rect.width / 2 - 110;
    if (top + popup.offsetHeight > window.innerHeight) top = rect.top - popup.offsetHeight - 8;
    if (left < 8) left = 8;
    if (left + 220 > window.innerWidth) left = window.innerWidth - 228;
    popup.style.top = top + "px";
    popup.style.left = left + "px";
  } catch {}
}

document.addEventListener("click", (e) => {
  const popup = document.getElementById("commenter-popup");
  if (!popup.classList.contains("hidden") && !e.target.closest(".comment-avatar") && !e.target.closest("#commenter-popup")) {
    popup.classList.add("hidden");
  }
});

document.getElementById("comment-send-btn").addEventListener("click", postComment);
document.getElementById("comment-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") postComment();
});

async function postComment() {
  const input = document.getElementById("comment-input");
  const text = input.value.trim();
  if (!text || !currentDetailSymbol) return;
  if (!currentUserId) {
    try {
      const res = await fetch("/api/profile");
      const p = await res.json();
      currentUserId = p.userId;
    } catch { alert("Ошибка профиля"); return; }
  }
  try {
    const res = await fetch("/api/comments", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: currentDetailSymbol, text, userId: currentUserId }),
    });
    const data = await res.json();
    if (data.success) {
      input.value = "";
      loadComments(currentDetailSymbol);
    }
  } catch { alert("Ошибка отправки"); }
}

async function toggleFav(symbol, name) {
  try {
    const res = await fetch("/api/favorites/toggle", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol, name }),
    });
    const data = await res.json();
    favorites = data.favorites;
    updateTopbarAvatar();
  } catch {}
}

function renderCards() {
  document.querySelectorAll(".card-fav").forEach((el) => {
    const sym = el.dataset.symbol;
    el.textContent = isFav(sym) ? "★" : "☆";
  });
  if (stocksData.length) renderTab("stocks");
  if (cryptoData.length) renderTab("crypto");
}

function buildCard(item, type) {
  const isStock = type === "stock";
  const iconHtml = isStock
    ? `<img src="https://logo.clearbit.com/${DOMAINS[item.symbol] || ""}" alt="" loading="lazy" onerror="this.parentElement.textContent='${item.symbol[0]}';this.parentElement.style.background='#253545'">`
    : `${CRYPTO_ICONS[item.symbol] || item.symbol[0]}`;
  const iconStyle = isStock ? "" : `style="background:${CRYPTO_COLORS[item.symbol] || '#253545'}"`;
  const desc = isStock ? "Акция — вы владеете кусочком компании" : "Криптовалюта — цифровые деньги без банков";

  const priceVal = item.price || 0;
  return `
    <div class="card" data-symbol="${item.symbol}" data-name="${isStock ? item.name : item.name.replace(" USD", "")}" data-type="${type}" data-price="${priceVal}">
      <span class="card-fav ${isFav(item.symbol) ? "active" : ""}" data-symbol="${item.symbol}">${isFav(item.symbol) ? "★" : "☆"}</span>
      <div class="card-icon" ${iconStyle}>${iconHtml}</div>
      <div class="card-body">
        <div class="card-title">${isStock ? item.name : item.name.replace(" USD", "")} <span class="card-ticker">${item.symbol}</span></div>
        <div class="card-desc">${desc}</div>
      </div>
      <div class="card-right">
        <div class="card-price">$${formatPrice(item.price)}</div>
        <div class="card-change ${item.change >= 0 ? "positive" : "negative"}">
          <span class="arrow">${item.change >= 0 ? "▲" : "▼"}</span>
          ${item.change >= 0 ? "+" : ""}${item.change.toFixed(2)} (${item.changePercent >= 0 ? "+" : ""}${item.changePercent.toFixed(2)}%)
        </div>
        <div class="card-cap">${formatCap(item.marketCap)}</div>
      </div>
    </div>`;
}

function attachCardEvents(container) {
  container.querySelectorAll(".card").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest(".card-fav")) return;
      openDetail(el.dataset.symbol, el.dataset.name, el.dataset.type, false);
    });
  });
  container.querySelectorAll(".card-fav").forEach((el) => {
    el.addEventListener("click", async (e) => {
      e.stopPropagation();
      const sym = el.dataset.symbol;
      const card = el.closest(".card");
      await toggleFav(sym, card.dataset.name);
      renderCards();
    });
  });
}

async function fetchData() {
  document.getElementById("stocks-grid").innerHTML = '<div class="loading">Загружаем акции...</div>';
  document.getElementById("crypto-grid").innerHTML = '<div class="loading">Загружаем криптовалюты...</div>';
  try {
    const [stocks, crypto] = await Promise.all([
      fetch("/api/stocks").then((r) => r.json()),
      fetch("/api/crypto").then((r) => r.json()),
    ]);
    if (stocks.error) throw new Error(stocks.error);
    if (crypto.error) throw new Error(crypto.error);
    stocksData = stocks;
    cryptoData = crypto;
    renderTab("stocks");
    renderTab("crypto");
  } catch (err) {
    document.getElementById("stocks-grid").innerHTML = `<div class="error">Ошибка: ${err.message}</div>`;
    document.getElementById("crypto-grid").innerHTML = `<div class="error">Ошибка: ${err.message}</div>`;
  }
}

let sortState = { stocks: "default", crypto: "default" };

function renderTab(tab) {
  const data = tab === "stocks" ? stocksData : cryptoData;
  const type = tab === "stocks" ? "stock" : "crypto";
  const grid = document.getElementById(tab + "-grid");
  const sort = sortState[tab];
  let sorted = [...data];
  if (sort === "asc") sorted.sort((a, b) => (a.price || 0) - (b.price || 0));
  else if (sort === "desc") sorted.sort((a, b) => (b.price || 0) - (a.price || 0));
  grid.innerHTML = sorted.map((item) => buildCard(item, type)).join("");
  attachCardEvents(grid);
  document.querySelectorAll(`.sort-bar .sort-btn[data-tab="${tab}"]`).forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.sort === sort);
  });
}

document.querySelectorAll(".sort-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    sortState[tab] = btn.dataset.sort;
    renderTab(tab);
  });
});

async function fetchCurrency() {
  const el = document.getElementById("currency-items");
  try {
    const res = await fetch("/api/currency");
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    el.innerHTML = Object.entries(CURRENCY_INFO).map(([key, info]) => {
      const d = data[key];
      if (!d) return "";
      return `<div class="currency-item"><span class="currency-flag">${info.flag}</span><span class="currency-rate">${d.price.toFixed(2)}</span><span class="currency-change ${d.change >= 0 ? "positive" : "negative"}">${d.change >= 0 ? "▲" : "▼"} ${d.changePercent >= 0 ? "+" : ""}${d.changePercent.toFixed(2)}%</span></div>`;
    }).join("");
  } catch { el.innerHTML = '<div class="error" style="padding:4px;font-size:12px">Ошибка загрузки курсов</div>'; }
}

async function fetchRecs() {
  tabContents.recs.innerHTML = '<div class="loading">Анализируем рынок...</div>';
  try {
    const res = await fetch("/api/recommendations");
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    const labels = { "strong-buy": "🔥 Покупать", buy: "✅ Покупать", hold: "⚪ Держать", sell: "⛔ Продавать", "strong-sell": "🚨 Продавать" };
    const isCrypto = (s) => s.endsWith("-USD") || CRYPTO_COLORS[s];
    tabContents.recs.innerHTML = data.map((item) => {
      const signalsHtml = (item.signals || []).map((s) =>
        `<span class="rec-signal ${s.dir}">${s.label}</span>`
      ).join("");
      const crypto = isCrypto(item.symbol);
      const iconHtml = crypto
        ? `<span style="display:inline-block;width:18px;text-align:center;color:${CRYPTO_COLORS[item.symbol] || '#8a9ba8'}">${CRYPTO_ICONS[item.symbol] || '₿'}</span>`
        : "";
      return `<div class="rec-card" data-symbol="${item.symbol}" data-name="${item.name}" data-type="${crypto ? "crypto" : "stock"}">
        <div class="rec-badge ${item.action}">${labels[item.action] || "Держать"}</div>
        <div class="rec-info">
          <div class="rec-name">${iconHtml} ${item.name} <span class="rec-ticker">${item.symbol}</span></div>
          <div class="rec-reason">${item.reason}</div>
          ${signalsHtml ? `<div class="rec-signals">${signalsHtml}</div>` : ""}
        </div>
        <div class="rec-right">
          <div class="rec-price">$${formatPrice(item.price)}</div>
          <div class="rec-score">RSI: ${item.rsi} · Оценка: ${item.score}/100</div>
        </div>
      </div>`;
    }).join("");
    tabContents.recs.querySelectorAll(".rec-card").forEach((el) => {
      el.addEventListener("click", () => openDetail(el.dataset.symbol, el.dataset.name, el.dataset.type || "stock", true));
    });
  } catch (err) { tabContents.recs.innerHTML = `<div class="error">Ошибка: ${err.message}</div>`; }
}

function openBuyModal(symbol, name) {
  document.getElementById("buy-modal-title").textContent = `Покупка ${name}`;
  document.getElementById("buy-price-display").textContent = "...";
  document.getElementById("buy-total").textContent = "0";
  document.getElementById("buy-quantity").value = 1;
  document.getElementById("buy-modal").classList.remove("hidden");

  fetch(`/api/quote?symbol=${symbol}`).then((r) => r.json()).then((q) => {
    const price = q.price || 0;
    document.getElementById("buy-price-display").textContent = formatPrice(price);
    document.getElementById("buy-price-display").dataset.price = price;
    updateBuyTotal();
  });
}

document.getElementById("buy-cancel").addEventListener("click", () => {
  document.getElementById("buy-modal").classList.add("hidden");
});
document.getElementById("buy-modal-overlay").addEventListener("click", () => {
  document.getElementById("buy-modal").classList.add("hidden");
});
document.getElementById("buy-quantity").addEventListener("input", updateBuyTotal);

function updateBuyTotal() {
  const price = parseFloat(document.getElementById("buy-price-display").dataset.price) || 0;
  const qty = parseInt(document.getElementById("buy-quantity").value) || 1;
  document.getElementById("buy-total").textContent = formatPrice(price * qty);
}

document.getElementById("buy-confirm").addEventListener("click", async () => {
  const symbol = currentDetailSymbol;
  const name = currentDetailName;
  const price = parseFloat(document.getElementById("buy-price-display").dataset.price) || 0;
  const quantity = parseInt(document.getElementById("buy-quantity").value) || 1;
  if (!symbol || quantity < 1 || price <= 0) return;

  try {
    const res = await fetch("/api/portfolio/buy", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol, name, quantity, price }),
    });
    const data = await res.json();
    if (data.error) { alert(data.error); return; }
    portfolio = data.portfolio;
    document.getElementById("buy-modal").classList.add("hidden");
    updateTopbarAvatar();
  } catch { alert("Ошибка покупки"); }
});

async function fetchProfile() {
  try {
    const res = await fetch("/api/profile");
    const data = await res.json();
    if (data.error) return;
    currentUserId = data.userId;
    favorites = data.favorites || [];
    portfolio = data.portfolio || [];
    updateTopbarAvatar();
    renderCards();
  } catch {}
}

function updateTopbarAvatar() {
  const el = document.getElementById("topbar-avatar");
  if (favorites.length || portfolio.length) {
    el.textContent = `👤${favorites.length + portfolio.length > 0 ? "•" : ""}`;
  }
}

let currencyBalance = null;

function renderProfile() {
  const el = tabContents.profile;
  const totalValue = portfolio.reduce((sum, p) => sum + p.quantity * (p.currentPrice || p.avgPrice), 0);
  const totalInvested = portfolio.reduce((sum, p) => sum + p.quantity * p.avgPrice, 0);
  const pl = totalValue - totalInvested;
  const plPercent = totalInvested > 0 ? (pl / totalInvested) * 100 : 0;

  el.innerHTML = `
    <div class="profile-header">
      <div class="avatar-wrap" id="avatar-wrap">
        <div id="avatar-content"></div>
        <input type="file" id="avatar-input" accept="image/*">
      </div>
      <div class="profile-info">
        <div class="profile-name">Инвестор</div>
        <div class="profile-time" id="profile-time">Загрузка...</div>
        <div class="profile-stat">
          <div class="profile-stat-item"><div class="profile-stat-num">${portfolio.length}</div><div class="profile-stat-label">Активов</div></div>
          <div class="profile-stat-item"><div class="profile-stat-num">${favorites.length}</div><div class="profile-stat-label">В избранном</div></div>
        </div>
      </div>
    </div>

    <div class="port-summary">
      <div class="port-summary-item">
        <div class="val">$${formatPrice(totalValue)}</div>
        <div class="lbl">Стоимость портфеля</div>
      </div>
      <div class="port-summary-item">
        <div class="val ${pl >= 0 ? "positive" : "negative"}">${pl >= 0 ? "+" : ""}$${formatPrice(pl)} (${plPercent >= 0 ? "+" : ""}${plPercent.toFixed(1)}%)</div>
        <div class="lbl">Прибыль / Убыток</div>
      </div>
    </div>

    <div class="section-title">💱 Валюта</div>
    <div id="currency-section" class="currency-profile-section"><div class="loading">Загрузка курсов...</div></div>

    <div class="section-title">📂 Мой портфель</div>
    <div id="portfolio-list"></div>

    <div class="section-title">⭐ Избранное</div>
    <div id="fav-list"></div>
  `;

  renderAvatar();
  renderCurrencySection();
  renderPortfolioList();
  renderFavList();
  loadTimeData();
  setupAvatarUpload();
}

async function renderCurrencySection() {
  const el = document.getElementById("currency-section");
  if (!el) return;
  try {
    const [ratesRes, profileRes] = await Promise.all([
      fetch("/api/currency"),
      fetch("/api/profile"),
    ]);
    const rates = await ratesRes.json();
    const profile = await profileRes.json();
    currencyBalance = profile.currencyBalance || { USD: 0, EUR: 0, RUB: 100000 };
    const usdRate = rates.USDRUB?.price || 0;
    const eurRate = rates.EURRUB?.price || 0;

    el.innerHTML = `
      <div class="currency-balance">
        <div class="cur-bal-item"><span class="cur-bal-flag">🇷🇺</span><span class="cur-bal-amt">${Math.floor(currencyBalance.RUB).toLocaleString()}</span><span class="cur-bal-code">RUB</span></div>
        <div class="cur-bal-item"><span class="cur-bal-flag">🇺🇸</span><span class="cur-bal-amt">${currencyBalance.USD.toFixed(2)}</span><span class="cur-bal-code">USD</span></div>
        <div class="cur-bal-item"><span class="cur-bal-flag">🇪🇺</span><span class="cur-bal-amt">${currencyBalance.EUR.toFixed(2)}</span><span class="cur-bal-code">EUR</span></div>
      </div>
      ${usdRate ? `
      <div class="currency-trade">
        <div class="cur-trade-row">
          <span class="cur-trade-label">🇺🇸 USD/RUB: <strong>${usdRate.toFixed(2)}</strong></span>
          <div class="cur-trade-controls">
            <input type="number" id="cur-buy-usd" class="cur-input" placeholder="Кол-во USD" min="1" step="1">
            <button class="cur-btn buy" id="cur-buy-usd-btn">Купить</button>
            <button class="cur-btn sell" id="cur-sell-usd-btn">Продать</button>
          </div>
        </div>
      </div>` : ""}
      ${eurRate ? `
      <div class="currency-trade">
        <div class="cur-trade-row">
          <span class="cur-trade-label">🇪🇺 EUR/RUB: <strong>${eurRate.toFixed(2)}</strong></span>
          <div class="cur-trade-controls">
            <input type="number" id="cur-buy-eur" class="cur-input" placeholder="Кол-во EUR" min="1" step="1">
            <button class="cur-btn buy" id="cur-buy-eur-btn">Купить</button>
            <button class="cur-btn sell" id="cur-sell-eur-btn">Продать</button>
          </div>
        </div>
      </div>` : ""}
    `;

    document.getElementById("cur-buy-usd-btn")?.addEventListener("click", () => currencyTrade("USD", "buy"));
    document.getElementById("cur-sell-usd-btn")?.addEventListener("click", () => currencyTrade("USD", "sell"));
    document.getElementById("cur-buy-eur-btn")?.addEventListener("click", () => currencyTrade("EUR", "buy"));
    document.getElementById("cur-sell-eur-btn")?.addEventListener("click", () => currencyTrade("EUR", "sell"));
  } catch { if (el) el.innerHTML = '<div class="error">Ошибка загрузки</div>'; }
}

async function currencyTrade(currency, action) {
  const input = document.getElementById(`cur-buy-${currency.toLowerCase()}`);
  const amount = parseFloat(input?.value);
  if (!amount || amount <= 0) { alert("Введите количество"); return; }
  try {
    const res = await fetch(`/api/currency/${action}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currency, amount }),
    });
    const data = await res.json();
    if (data.error) { alert(data.error); return; }
    currencyBalance = data.currencyBalance;
    renderCurrencySection();
  } catch { alert("Ошибка операции"); }
}

function renderAvatar() {
  const el = document.getElementById("avatar-content");
  Promise.resolve().then(async () => {
    const res = await fetch("/api/profile");
    const data = await res.json();
    if (data.avatar) {
      el.innerHTML = `<img src="${data.avatar}" alt="avatar">`;
    } else {
      el.innerHTML = '<span class="avatar-placeholder">👤</span>';
    }
  });
}

function setupAvatarUpload() {
  const wrap = document.getElementById("avatar-wrap");
  const input = document.getElementById("avatar-input");
  if (!wrap || !input) return;
  wrap.addEventListener("click", () => input.click());
  input.addEventListener("change", async () => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      const image = e.target.result;
      await fetch("/api/avatar", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image }),
      });
      renderAvatar();
    };
    reader.readAsDataURL(file);
  });
}

async function renderPortfolioList() {
  const el = document.getElementById("portfolio-list");
  if (!el) return;
  if (!portfolio.length) {
    el.innerHTML = '<div class="empty-state">У вас пока нет активов. Купите что-нибудь!</div>';
    return;
  }

  const rows = [];
  for (const p of portfolio) {
    let currentPrice = p.avgPrice;
    try {
      const res = await fetch(`/api/quote?symbol=${p.symbol}`);
      const q = await res.json();
      if (q.price) currentPrice = q.price;
    } catch {}
    p.currentPrice = currentPrice;
    const value = currentPrice * p.quantity;
    const cost = p.avgPrice * p.quantity;
    const profit = value - cost;
    const profitPct = cost > 0 ? (profit / cost) * 100 : 0;

    rows.push(`
      <div class="port-card" data-symbol="${p.symbol}" data-name="${p.name}">
        <div class="port-info">
          <div class="port-name">${p.name} <span class="port-ticker">${p.symbol}</span></div>
          <div class="port-detail">${p.quantity} шт × $${formatPrice(p.avgPrice)}</div>
        </div>
        <div class="port-right">
          <div class="port-value">$${formatPrice(value)}</div>
          <div class="port-pl ${profit >= 0 ? "positive" : "negative"}">${profit >= 0 ? "+" : ""}$${formatPrice(profit)} (${profitPct >= 0 ? "+" : ""}${profitPct.toFixed(1)}%)
            <button class="sell-btn" data-symbol="${p.symbol}">Продать</button>
          </div>
        </div>
      </div>
    `);
  }

  el.innerHTML = rows.join("");

  el.querySelectorAll(".port-card").forEach((card) => {
      card.addEventListener("click", (e) => {
        if (e.target.closest(".sell-btn")) return;
        openDetail(card.dataset.symbol, card.dataset.name, "stock", false);
      });
  });

  el.querySelectorAll(".sell-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const sym = btn.dataset.symbol;
      if (!confirm(`Продать все ${sym}?`)) return;
      try {
        const res = await fetch("/api/portfolio/sell", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol: sym, quantity: 999999 }),
        });
        const data = await res.json();
        if (data.error) { alert(data.error); return; }
        portfolio = data.portfolio;
        renderProfile();
        updateTopbarAvatar();
      } catch { alert("Ошибка"); }
    });
  });
}

function renderFavList() {
  const el = document.getElementById("fav-list");
  if (!el) return;
  if (!favorites.length) {
    el.innerHTML = '<div class="empty-state">Нет избранных. Нажмите ☆ на карточке!</div>';
    return;
  }
  el.innerHTML = favorites.map((f) =>
    `<div class="port-card" data-symbol="${f.symbol}" data-name="${f.name || f.symbol}">
      <div class="port-info">
        <div class="port-name">${f.name || f.symbol} <span class="port-ticker">${f.symbol}</span></div>
      </div>
    </div>`
  ).join("");
  el.querySelectorAll(".port-card").forEach((card) => {
    card.addEventListener("click", () => {
      const sym = card.dataset.symbol;
      const name = card.dataset.name;
      openDetail(sym, name, "stock", false);
    });
  });
}

async function loadTimeData() {
  try {
    const res = await fetch("/api/profile");
    const data = await res.json();
    if (data.error) return;
    const elapsed = Math.floor((Date.now() - sessionStart) / 1000);
    const total = (data.totalTime || 0) + elapsed;
    const el = document.getElementById("profile-time");
    if (el) el.textContent = `На платформе: ${formatDuration(total)}`;
  } catch {}
}

function startTimeTracking() {
  if (timeInterval) clearInterval(timeInterval);
  timeInterval = setInterval(async () => {
    const elapsed = Math.floor((Date.now() - sessionStart) / 1000);
    sessionStart = Date.now();
    try {
      await fetch("/api/profile/time", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seconds: elapsed }),
      });
      loadTimeData();
    } catch {}
  }, 30000);
}

fetchData();
fetchCurrency();
fetchRecs();
fetchProfile();
startTimeTracking();
