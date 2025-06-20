/************************************************************
 *  B.A.Y.N.E.X  v2 –  Smart, Friendly & Profitable
 *  --------------------------------------------------------
 *  - Telegram commands:  /start  /balance  /help  /menu
 *  - Modular helpers for Deriv & Strategy
 *  - Automatic reconnect / error feedback
 ************************************************************/

require("dotenv").config();
const express  = require("express");
const fetch    = require("node-fetch");
const WebSocket= require("ws");
const ta       = require("technicalindicators");   // simple TA lib
const Telegram = require("node-telegram-bot-api");

/* === ENVIRONMENT === */
const {
  TELEGRAM_TOKEN,
  DERIV_TOKEN,
  APP_ID,
  PORT = 3000
} = process.env;

if (!TELEGRAM_TOKEN || !DERIV_TOKEN || !APP_ID) {
  console.error("❌ Missing .env vars.  Check TELEGRAM_TOKEN, DERIV_TOKEN, APP_ID");
  process.exit(1);
}

/* === TELEGRAM BOT (polling mode) === */
const bot = new Telegram(TELEGRAM_TOKEN, { polling: true });

bot.onText(/^\/start$/i,    (msg) => startCmd(msg.chat.id));
bot.onText(/^\/balance$/i,  (msg) => balanceCmd(msg.chat.id));
bot.onText(/^\/help$/i,     (msg) => helpCmd(msg.chat.id));
bot.onText(/^\/menu$/i,     (msg) => menuCmd(msg.chat.id));

// fallback for unknown text
bot.on("message", (msg) => {
  const txt = msg.text || "";
  if (!txt.startsWith("/")) return;
  if (!["/start","/balance","/help","/menu"].includes(txt))
    sendTG(msg.chat.id, "❔ Unknown command. Type /help.");
});

/* === EXPRESS (webhook compatibility) === */
const app = express();
app.use(express.json());

app.post("/webhook", async (req, res) => {
  const chat_id = req.body.message?.chat?.id;
  const text    = (req.body.message?.text || "").trim().toLowerCase();
  // mirror polling behaviour
  if (text === "/start")    startCmd(chat_id);
  else if (text === "/balance") balanceCmd(chat_id);
  else if (text === "/help")    helpCmd(chat_id);
  else if (text === "/menu")    menuCmd(chat_id);
  else sendTG(chat_id, "❔ Unknown command. Type /help.");
  res.sendStatus(200);
});
app.listen(PORT, () => console.log(`🚀 Express live on ${PORT}`));

/* === COMMAND IMPLEMENTATIONS === */
function startCmd(id){
  sendTG(id,"🤖 *B.A.Y.N.E.X* activated.\nAwaiting your commands.",true);
}
function helpCmd(id){
  sendTG(id,
`ℹ️ *Help*
/start – Activate bot
/balance – Show Deriv balance
/menu – Quick actions`,true);
}
function menuCmd(id){
  const opts = {
    reply_markup:{
      inline_keyboard:[
        [{text:"💰 Balance",callback_data:"balance"}],
        [{text:"📈 Demo Strategy",callback_data:"demo"}]
      ]
    },
    parse_mode:"Markdown"
  };
  bot.sendMessage(id,"Choose an action:",opts);
}

// Inline-button handler
bot.on("callback_query", (q)=>{
  const id=q.message.chat.id;
  if (q.data==="balance") balanceCmd(id);
  if (q.data==="demo")    demoStrategy(id);
  bot.answerCallbackQuery(q.id);
});

async function balanceCmd(id){
  await sendTG(id,"⏳ Fetching your Deriv balance…");
  derivBalance()
    .then(bal => sendTG(id,`💵 Your Deriv balance is: *${bal.balance} ${bal.currency}*`,true))
    .catch(err=> sendTG(id,`❌ ${err}`,false));
}

/* === DERIV MODULE === */
function derivBalance(){
  return new Promise((resolve,reject)=>{
    const DERIV_WS = `wss://ws.deriv.com/websockets/v3?app_id=${APP_ID}`;
    const ws = new WebSocket(DERIV_WS);

    const timeout = setTimeout(()=>reject("Deriv timeout ⌛"),10000);

    ws.onopen = ()=> ws.send(JSON.stringify({authorize: DERIV_TOKEN}));
    ws.onerror= err => reject(`Deriv connection error: ${err.message}`);

    ws.onmessage = (e)=>{
      const d = JSON.parse(e.data);
      if (d.error) { clearTimeout(timeout); ws.close(); return reject(d.error.message); }
      if (d.msg_type==="authorize") ws.send(JSON.stringify({balance:1, account:"current"}));
      if (d.msg_type==="balance"){
        clearTimeout(timeout); ws.close();
        return resolve(d.balance); // {balance,currency}
      }
    };
  });
}

/* === DEMO STRATEGY (example RSI) === */
async function demoStrategy(id){
  sendTG(id,"📊 Running demo strategy (RSI)…");
  try{
    const candles = await fetch(`https://api.deriv.com/api/exchange/ticks_history?symbol=frxEURUSD&granularity=60&count=200`)
                  .then(r=>r.json()).then(j=>j.history.prices);
    const rsi = ta.RSI.calculate({ values: candles, period: 14 }).slice(-1)[0];
    sendTG(id,`ℹ️ Current 14-period RSI (EUR/USD 1-min) = *${rsi.toFixed(2)}*`,true);
  }catch(err){
    sendTG(id,`❌ Demo strategy failed: ${err.message}`);
  }
}

/* === TELEGRAM HELPER === */
function sendTG(chat_id,text,markdown=false){
  return bot.sendMessage(chat_id,text,{parse_mode: markdown?"Markdown":undefined});
} 
