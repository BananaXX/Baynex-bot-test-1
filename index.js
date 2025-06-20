const express = require("express");
const fetch = require("node-fetch");
const WebSocket = require("ws");
require("dotenv").config();

const app = express();
app.use(express.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const DERIV_TOKEN = process.env.DERIV_TOKEN;
const APP_ID = process.env.APP_ID;
const PORT = process.env.PORT || 3000;

// Set Telegram webhook (Run once, optional but helpful)
fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/setWebhook`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ url: `https://${process.env.RENDER_EXTERNAL_HOSTNAME}/webhook` })
});

app.post("/webhook", async (req, res) => {
  const chat_id = req.body.message?.chat?.id;
  const message = req.body.message?.text || "";

  if (message === "/start") {
    await sendTelegram(chat_id, "🤖 B.A.Y.N.E.X is online and smarter than ever. Ready for commands.");
  } else if (message === "/balance") {
    await sendTelegram(chat_id, "📡 Fetching your Deriv balance...");
    getDerivBalance(chat_id);
  } else {
    await sendTelegram(chat_id, "⚠️ Unrecognized command. Try /balance or /start");
  }

  res.sendStatus(200);
});

async function sendTelegram(chat_id, text) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id, text })
  });
}

function getDerivBalance(chat_id) {
  const ws = new WebSocket(`wss://ws.deriv.com/websockets/v3?app_id=${APP_ID}`);

  ws.onopen = () => {
    ws.send(JSON.stringify({ authorize: DERIV_TOKEN }));
  };

  ws.onmessage = async (event) => {
    const data = JSON.parse(event.data);
    if (data.msg_type === "authorize") {
      ws.send(JSON.stringify({ balance: 1, account: "current" }));
    } else if (data.msg_type === "balance") {
      const balance = data.balance.balance;
      const currency = data.balance.currency;
      await sendTelegram(chat_id, `💰 Your Deriv balance is: ${balance} ${currency}`);
      ws.close();
    } else if (data.error) {
      await sendTelegram(chat_id, `❌ Deriv error: ${data.error.message}`);
      ws.close();
    }
  };

  ws.onerror = async (err) => {
    await sendTelegram(chat_id, `❌ Deriv connection error: ${err.message}`);
  };
}

app.listen(PORT, () => {
  console.log(`✅ BAYNEX Webhook is live on port ${PORT}`);
}); 
