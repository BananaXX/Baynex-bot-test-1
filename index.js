// index.js const express = require("express"); const fetch = require("node-fetch"); const WebSocket = require("ws"); require("dotenv").config();

const app = express(); app.use(express.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN; const DERIV_TOKEN = process.env.DERIV_TOKEN; const APP_ID = process.env.APP_ID; const PORT = process.env.PORT || 10000;

// ── Telegram Webhook Setup ── fetch(https://api.telegram.org/bot${TELEGRAM_TOKEN}/setWebhook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: https://${process.env.RENDER_EXTERNAL_HOSTNAME}/webhook }) }) .then(res => res.json()) .then(data => console.log("Webhook set:", data)) .catch(err => console.error("Webhook error:", err));

// ── Telegram Handler ── app.post("/webhook", async (req, res) => { const chat = req.body.message?.chat?.id; const msg = req.body.message?.text || ""; const [cmd, ...args] = msg.trim().split(" ");

log("Telegram →", msg);

switch (cmd) { case "/start": return sendTG(chat, "🤖 B.A.Y.N.E.X online. Type /help."); case "/help": return sendTG(chat, B.A.Y.N.E.X Commands\n/start – boot\n/balance – Deriv balance); case "/balance": sendTG(chat, "📡 Fetching your Deriv balance..."); return getDerivBalance(chat); default: return sendTG(chat, "❓ Unknown command. /help"); } });

// ── Telegram Send Wrapper ── async function sendTG(chat, text) { if (!chat) return; log("Telegram ←", text); await fetch(https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chat, text }) }); }

// ── Balance Handler with Host Fallback ── function getDerivBalance(chat) { const HOSTS = [ wss://ws.deriv.com/websockets/v3?app_id=${APP_ID}, wss://ws.binaryws.com/websockets/v3?app_id=${APP_ID}, wss://green.binaryws.com/websockets/v3?app_id=${APP_ID} ];

let attempt = 0; connectNextHost();

function connectNextHost() { if (attempt >= HOSTS.length) { sendTG(chat, "❌ All Deriv endpoints unreachable."); log("All hosts failed"); return; }

const url = HOSTS[attempt++];
log("WS connect →", url);

const ws = new WebSocket(url);

ws.onopen = () => {
  log("WS open, authorised with", url);
  ws.send(JSON.stringify({ authorize: DERIV_TOKEN }));
};

ws.onmessage = async (evt) => {
  const data = JSON.parse(evt.data);
  log("WS msg_type:", data.msg_type, "via", url);

  if (data.msg_type === "authorize") {
    ws.send(JSON.stringify({ balance: 1, account: "current" }));
  } else if (data.msg_type === "balance") {
    const { balance, currency } = data.balance;
    await sendTG(chat, `💰 Balance: ${balance} ${currency}`);
    ws.close();
  } else if (data.error) {
    await sendTG(chat, `⚠️ Deriv error: ${data.error.message}`);
    ws.close();
  }
};

ws.onerror = (err) => {
  log("WS error on", url, err.message);
  ws.close();
};

ws.onclose = () => {
  if (!ws._balanceDelivered) {
    log("Trying next host...");
    connectNextHost();
  }
};

} }

// ── Logger ── function log(...args) { console.log(new Date().toISOString(), ...args); }

// ── Start Server ── app.listen(PORT, () => { log(✅ BAYNEX Webhook live on ${PORT}); });

