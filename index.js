/*  ─────────────────────────────
    BAYNEX BOT – index.js
    (only change = single log line)
   ───────────────────────────── */

const express = require("express");
const fetch    = require("node-fetch");
const WebSocket = require("ws");
require("dotenv").config();

const app  = express();
app.use(express.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const DERIV_TOKEN    = process.env.DERIV_TOKEN;
const APP_ID         = process.env.APP_ID;
const PORT           = process.env.PORT || 3000;

/* ── 1. Set Telegram webhook (runs once at boot) ───────────────── */
fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/setWebhook`, {
  method : "POST",
  headers: { "Content-Type": "application/json" },
  body   : JSON.stringify({ url: `https://${process.env.RENDER_EXTERNAL_HOSTNAME}/webhook` })
})
  .then(r => r.json())
  .then(j => console.log("Webhook set:", j))
  .catch(err => console.error("Webhook error", err));

/* ── 2. Telegram → webhook ─────────────────────────────────────── */
app.post("/webhook", async (req, res) => {
  const chat_id = req.body.message?.chat?.id;
  const message = (req.body.message?.text || "").trim();

  switch (message.split(" ")[0]) {
    case "/start":
      await sendTG(chat_id,"🤖 B.A.Y.N.E.X online. Type /help.");
      break;

    case "/help":
      await sendTG(chat_id,
`B.A.Y.N.E.X Commands
/start          – boot
/balance        – Deriv balance
/starttrade     – begin auto trading
/stop           – halt trading
/profit         – session P/L
/status         – bot status
/lasttrade      – last trade info
/setrisk <maxLoss> <maxTrades>
/setfilter on|off`);
      break;

    case "/balance":
      await sendTG(chat_id,"📡 Fetching your Deriv balance…");
      getDerivBalance(chat_id);
      break;

    /* future commands handled here … */

    default:
      await sendTG(chat_id,"❓ Unknown command. /help");
  }
  res.sendStatus(200);
});

/* ── 3. Telegram helper ─────────────────────────────────────────── */
async function sendTG(chat, text, md = false) {
  return fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method : "POST",
    headers: { "Content-Type": "application/json" },
    body   : JSON.stringify({ chat_id: chat, text, parse_mode: md ? "Markdown" : undefined })
  });
}

/* ── 4. Deriv balance RPC ───────────────────────────────────────── */
function getDerivBalance(chat) {
  const ws = new WebSocket(`wss://ws.deriv.com/websockets/v3?app_id=${APP_ID}`);

  ws.onopen = () => ws.send(JSON.stringify({ authorize: DERIV_TOKEN }));

  ws.onmessage = async (event) => {
    const data = JSON.parse(event.data);

    /* 🆕  LOG LINE  */
    console.log("🧾 Deriv raw data:", data);  // <-- Only addition

    if (data.msg_type === "authorize") {
      ws.send(JSON.stringify({ balance: 1, account: "current" }));
    } else if (data.msg_type === "balance") {
      const { balance, currency } = data.balance;
      await sendTG(chat, `💰 Balance: ${balance} ${currency}`);
      ws.close();
    } else if (data.error) {
      await sendTG(chat, `❌ Deriv error: ${data.error.message}`);
      ws.close();
    }
  };

  ws.onerror = async (err) => {
    await sendTG(chat, `❌ Deriv connection error: ${err.message}`);
  };
}

/* ── 5. Boot server ─────────────────────────────────────────────── */
app.listen(PORT, () => {
  console.log(`✅ BAYNEX Webhook live on ${PORT}`);
});
