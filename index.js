/****************************************************************
 *  BAYNEX – Phase 3  (Intelligent, Risk-Aware Auto-Trader)
 *  Telegram Commands:
 *   /start  /help  /balance
 *   /start_trade  /stop
 *   /profit  /status  /last_trade
 *   /set_risk <maxLoss> <maxTrades>
 *   /set_filter on|off
 ****************************************************************/
require("dotenv").config();
const express   = require("express");
const fetch     = require("node-fetch");
const WebSocket = require("ws");
const ta        = require("technicalindicators");
const Telegram  = require("node-telegram-bot-api");

/* ── ENV ───────────────────────────────────────────────────── */
const {
  TELEGRAM_TOKEN,
  DERIV_TOKEN,
  APP_ID,
  RENDER_EXTERNAL_HOSTNAME,
  PORT = 3000,
} = process.env;
if (!TELEGRAM_TOKEN || !DERIV_TOKEN || !APP_ID || !RENDER_EXTERNAL_HOSTNAME) {
  console.error("❌ Missing env vars"); process.exit(1);
}

/* ── Telegram (webhook mode) ──────────────────────────────── */
const bot = new Telegram(TELEGRAM_TOKEN);
const WEBHOOK_URL = `https://${RENDER_EXTERNAL_HOSTNAME}/webhook`;
bot.setWebHook(WEBHOOK_URL)
   .then(()=>console.log("✅ Telegram webhook set:", WEBHOOK_URL))
   .catch(e=>console.log("Webhook already set (ignored)",e.message));

/* ── Express listener ─────────────────────────────────────── */
const app = express();
app.use(express.json());
app.post("/webhook", (req,res)=>{handleUpdate(req.body);res.sendStatus(200);});
app.listen(PORT,()=>console.log(`🚀 BAYNEX listening on ${PORT}`));

/* ── Session State ────────────────────────────────────────── */
let autoTrading      = false;
let sessionProfit    = 0;
let sessionTrades    = 0;
let lastTradeInfo    = null;
let lastTradeTime    = 0;

let MAX_TRADES       = 20;
let MAX_SESSION_LOSS = -10;   // USD
let PROFIT_TARGET    = 20;    // USD
let FILTER_ENABLED   = true;  // EMA+RSI filter

/* ── Indicator helpers ────────────────────────────────────── */
const emaPeriod = 20;
let emaSeries = []; let rsiSeries = [];
function updateIndicators(price){
  emaSeries.push(price); rsiSeries.push(price);
  if(emaSeries.length>emaPeriod) emaSeries.shift();
  if(rsiSeries.length>14)       rsiSeries.shift();
  const ema = emaSeries.length>=emaPeriod
      ? ta.EMA.calculate({period:emaPeriod,values:emaSeries}).slice(-1)[0] : null;
  const rsi = rsiSeries.length>=14
      ? ta.RSI.calculate({period:14,values:rsiSeries}).slice(-1)[0]       : null;
  return { ema, rsi };
}

/* ── Telegram Command Router ──────────────────────────────── */
function handleUpdate(update){
  const msg=update.message; if(!msg||!msg.text) return;
  const chat=msg.chat.id;
  const parts=msg.text.trim().split(/\s+/);
  const cmd=parts[0].toLowerCase();
  const arg=parts.slice(1);

  switch(cmd){
    case "/start":  return sendTG(chat,"🤖 *B.A.Y.N.E.X* online. Type /help.",true);
    case "/help":   return help(chat);
    case "/balance":return balance(chat);

    case "/start_trade":
      if(autoTrading) return sendTG(chat,"⚠️ Already trading.");
      autoTrading=true; sessionProfit=0; sessionTrades=0;
      sendTG(chat,"📈 Auto-trading *STARTED*",true); startTrader(chat); return;

    case "/stop":   autoTrading=false; return sendTG(chat,"⏹ Trading *STOPPED*",true);

    case "/profit": return sendTG(chat,`💰 Session profit: *${sessionProfit.toFixed(2)} USD*`,true);

    case "/status":     return status(chat);
    case "/last_trade": return lastTrade(chat);
    case "/set_risk":   return setRisk(chat,arg);
    case "/set_filter": return toggleFilter(chat,arg);
    default:            return sendTG(chat,"❓ Unknown command. /help");
  }
}

/* ── Command bodies ───────────────────────────────────────── */
function help(id){
  sendTG(id,
`*B.A.Y.N.E.X Commands*
/start – boot
/balance – Deriv balance
/start_trade – begin auto trading
/stop – halt trading
/profit – session P/L
/status – bot status
/last_trade – last trade info
/set_risk <maxLoss> <maxTrades>
/set_filter on|off`,true);
}
function status(id){
  sendTG(id,
`Status: *${autoTrading?"Trading":"Idle"}*
Trades: ${sessionTrades}/${MAX_TRADES}
Profit: ${sessionProfit.toFixed(2)} USD
Risk filter: ${FILTER_ENABLED?"ON":"OFF"}`,true);
}
function lastTrade(id){
  if(!lastTradeInfo) return sendTG(id,"No trade taken yet.");
  const {type,entry,exit,profit}=lastTradeInfo;
  sendTG(id,
`Last trade
Type: ${type}
Entry: ${entry}
Exit : ${exit}
P/L : ${profit.toFixed(2)} USD`);
}
function setRisk(id,arg){
  if(arg.length<2) return sendTG(id,"Usage: /set_risk <maxLoss> <maxTrades>");
  MAX_SESSION_LOSS=Number(arg[0]); MAX_TRADES=Number(arg[1]);
  sendTG(id,`Risk set → Max loss ${MAX_SESSION_LOSS} USD, Max trades ${MAX_TRADES}`);
}
function toggleFilter(id,arg){
  if(!arg[0]||!/(on|off)/i.test(arg[0])) return sendTG(id,"Usage: /set_filter on|off");
  FILTER_ENABLED=arg[0].toLowerCase()==="on";
  sendTG(id,`Strategy filter is now *${FILTER_ENABLED?"ON":"OFF"}*`,true);
}
async function balance(chat){
  try{
    const bal=await derivRequest({balance:1,account:"current"});
    sendTG(chat,`💵 Balance: *${bal.balance} ${bal.currency}*`,true);
  }catch(e){sendTG(chat,`❌ ${e}`);}
}

/* ── Auto-Trader Core ─────────────────────────────────────── */
function startTrader(chat){
  const ws=derivSocket(); let authorized=false;
  ws.onmessage=async(ev)=>{
    const d=JSON.parse(ev.data);
    if(d.msg_type==="authorize"){ authorized=true; ws.send(JSON.stringify({ticks:"R_100"})); return;}
    if(d.msg_type==="tick"&&authorized&&autoTrading){
      const price=Number(d.tick.quote);
      const {ema,rsi}=updateIndicators(price);

      let shouldTrade=false; let contract_type="CALL";
      if(!ema||!rsi) return;
      if(FILTER_ENABLED){
        if(price>ema && rsi<70){shouldTrade=true;contract_type="CALL";}
        if(price<ema && rsi>30){shouldTrade=true;contract_type="PUT";}
      }else shouldTrade=true;

      const now=Date.now();
      if(!shouldTrade) return;
      if(now-lastTradeTime<5000) return;
      if(sessionTrades>=MAX_TRADES){autoTrading=false;return sendTG(chat,"🚫 Max trades hit. Auto-trading halted.");}
      if(sessionProfit<=MAX_SESSION_LOSS){autoTrading=false;return sendTG(chat,"🚫 Max loss hit. Trading halted.");}
      if(sessionProfit>=PROFIT_TARGET){autoTrading=false;return sendTG(chat,"🎉 Profit target reached!");}

      lastTradeTime=now; sessionTrades++;
      try{
        const order=await derivRequest({
          buy:1, price:1,
          parameters:{amount:1,basis:"stake",contract_type,currency:"USD",duration:1,duration_unit:"t",symbol:"R_100"}
        });
        const entry=order.buy_price;
        const profit=order.balance_after - order.balance_before;
        sessionProfit+=profit;
        lastTradeInfo={type:contract_type,entry,exit:entry+profit,profit};
        sendTG(chat,`✅ ${contract_type} trade result: ${profit.toFixed(2)} USD\\nSession: ${sessionProfit.toFixed(2)} USD`);
      }catch(e){sendTG(chat,`❌ Trade error: ${e}`);}
    }
  };
  ws.onerror = () => { sendTG(chat,"📡 Deriv connection error."); };
  ws.onclose = () => { if(autoTrading) setTimeout(()=>startTrader(chat),5000); };
}

/* ── Low-level Deriv helpers ───────────────────────────────── */
function derivSocket(){
  return new WebSocket(`wss://ws.binaryws.com/websockets/v3?app_id=${APP_ID}`);
}
function derivRequest(payload){
  return new Promise((resolve,reject)=>{
    const ws=derivSocket(); let authorized=false;
    ws.onopen = ()=> ws.send(JSON.stringify({authorize:DERIV_TOKEN}));
    ws.onmessage = (ev)=>{
      const d=JSON.parse(ev.data);
      if(d.error){ws.close();return reject(d.error.message);}
      if(d.msg_type==="authorize"){authorized=true; ws.send(JSON.stringify(payload)); return;}
      if(authorized && d.msg_type!=="authorize"){ws.close(); return resolve(d);}
    };
    ws.onerror = err=>{ws.close(); reject(err.message);};
  });
}

/* ── Telegram helper ───────────────────────────────────────── */
function sendTG(chat_id,text,markdown=false){
  return fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({chat_id,text,parse_mode:markdown?"Markdown":undefined})
  });
}
