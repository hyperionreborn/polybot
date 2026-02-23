const axios = require("axios");

async function checkMarket() {
  try {
    console.log("Fetching active BTC markets...");
    // Fetch a known active BTC market directly from Gamma
    const { data } = await axios.get("https://gamma-api.polymarket.com/events", {
      params: { 
        limit: 1, 
        active: true, 
        closed: false,
        slug_contains: "btc-updown-5m"
      }
    });

    if (!data || data.length === 0) {
      console.log("No markets found");
      return;
    }

    const event = data[0];
    const market = event.markets[0];

    console.log("\n--- EVENT ---");
    console.log("ID:", event.id);
    console.log("Slug:", event.slug);
    console.log("Title:", event.title);

    console.log("\n--- MARKET ---");
    console.log("ID:", market.id);
    console.log("Question:", market.question);
    console.log("Condition ID:", market.conditionId);
    console.log("CLOB Token IDs (raw):", market.clobTokenIds);
    
    // Parse them manually to verify
    const tokens = JSON.parse(market.clobTokenIds);
    console.log("Parsed Tokens:", tokens);
    console.log("Token 0 (UP?):", tokens[0]);
    console.log("Token 1 (DOWN?):", tokens[1]);

    console.log("\n--- OUTCOMES ---");
    console.log("Outcomes:", market.outcomes);
    
  } catch (err) {
    console.error("Error:", err.message);
  }
}

checkMarket();
