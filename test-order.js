/**
 * Test all signatureType + interceptor combinations to find what works.
 */
require("dotenv").config();
const { ClobClient, Side, OrderType } = require("@polymarket/clob-client");
const { Wallet } = require("ethers");
const axios = require("axios");

const HOST = "https://clob.polymarket.com";
const CHAIN_ID = 137;

async function test() {
  const pk = process.env.PRIVATE_KEY;
  const funder = process.env.FUNDER_ADDRESS;
  const signer = new Wallet(pk);

  console.log("Signer (EOA):", signer.address);
  console.log("Funder (proxy):", funder);

  // Find a real token
  const nowSec = Math.floor(Date.now() / 1000);
  const windowStart = nowSec - (nowSec % 300) + 300; // next 5m window
  const slug = `btc-updown-5m-${windowStart}`;
  console.log("Looking for:", slug);

  const resp = await axios.get(`${HOST.replace("clob", "gamma-api")}/events`, { params: { slug } });
  if (!resp.data?.length) {
    console.log("No market. Try again when a market is active."); return;
  }
  const market = resp.data[0].markets[0];
  const tokens = JSON.parse(market.clobTokenIds);
  const tokenID = tokens[0];
  console.log("Market:", market.question);
  console.log("Token:", tokenID.slice(0, 20) + "...\n");

  // Derive API creds once
  const tempClient = new ClobClient(HOST, CHAIN_ID, signer);
  const creds = await tempClient.createOrDeriveApiKey();
  console.log("API Key:", creds.key.slice(0, 8) + "...\n");

  const tests = [
    { sigType: 0, interceptor: false, label: "sigType=0, no interceptor" },
    { sigType: 0, interceptor: true,  label: "sigType=0, interceptor (POLY_ADDRESS=funder)" },
    { sigType: 1, interceptor: false, label: "sigType=1, no interceptor" },
    { sigType: 1, interceptor: true,  label: "sigType=1, interceptor (POLY_ADDRESS=funder)" },
    { sigType: 2, interceptor: false, label: "sigType=2, no interceptor" },
    { sigType: 2, interceptor: true,  label: "sigType=2, interceptor (POLY_ADDRESS=funder)" },
  ];

  for (const t of tests) {
    console.log(`--- ${t.label} ---`);
    
    // Clear any old interceptors
    axios.interceptors.request.handlers = [];
    
    if (t.interceptor) {
      axios.interceptors.request.use((config) => {
        if (config.headers?.['POLY_ADDRESS'] && config.headers?.['POLY_API_KEY']) {
          config.headers['POLY_ADDRESS'] = funder;
        }
        return config;
      });
    }

    try {
      const client = new ClobClient(HOST, CHAIN_ID, signer, creds, t.sigType, funder);

      const result = await client.createAndPostMarketOrder(
        { tokenID, price: 0.99, amount: 1, side: Side.BUY },
        undefined,
        OrderType.FOK
      );

      if (result && result.orderID) {
        console.log("*** ORDER PLACED! ***", result.orderID);
      } else if (result && result.error) {
        console.log("REJECTED:", result.error);
      } else {
        console.log("Response:", JSON.stringify(result));
      }
    } catch (err) {
      console.log("ERROR:", err.response?.data?.error || err.message);
    }
    console.log("");
  }

  // Clean up
  axios.interceptors.request.handlers = [];
}

test().catch(console.error);
