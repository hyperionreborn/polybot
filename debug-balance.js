require("dotenv").config();
const { ClobClient, AssetType } = require("@polymarket/clob-client");
const { Wallet } = require("ethers");

async function diagnose() {
  const privateKey = process.env.PRIVATE_KEY;
  const funderAddress = process.env.FUNDER_ADDRESS;
  const chainId = 137;
  const host = "https://clob.polymarket.com";

  if (!privateKey) {
    console.error("No PRIVATE_KEY in .env");
    return;
  }

  console.log("--- DIAGNOSTICS ---");
  const signer = new Wallet(privateKey);
  console.log("Signer (MetaMask) Address:", signer.address);
  console.log("Configured Funder Address:", funderAddress);

  const client = new ClobClient(host, chainId, signer);

  try {
    // 1. Check Derived API Key
    console.log("\n1. Checking API Credentials...");
    const creds = await client.createOrDeriveApiKey();
    console.log("   API Key derived successfully:", creds.key.slice(0, 8) + "...");

    const authClient = new ClobClient(host, chainId, signer, creds);

    // 2. Check Balances (Collateral = USDC)
    console.log("\n2. Checking Balances...");
    try {
        const bal = await authClient.getBalanceAllowance({ asset_type: AssetType.COLLATERAL });
        console.log("   Raw Response:", JSON.stringify(bal));
        console.log("   USDC Balance:", (parseFloat(bal.balance) / 1e6).toFixed(2));
        console.log("   Allowance:", bal.allowance);
    } catch (e) {
        console.error("   Failed to fetch balance:", e.message);
    }

    // 3. Check Account State (if possible) or recent activity
    console.log("\n3. Checking Open Orders...");
    const orders = await authClient.getOpenOrders();
    console.log("   Open Orders:", orders.length);
    
    // 4. Check Trades
    console.log("\n4. Checking Recent Trades...");
    const trades = await authClient.getTrades({ limit: 5 });
    console.log("   Recent Trades:", trades.length);
    if (trades.length > 0) {
        console.log("   Last Trade:", JSON.stringify(trades[0], null, 2));
    }

  } catch (err) {
    console.error("\nFATAL ERROR:", err);
  }
}

diagnose();
