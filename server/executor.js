const { Side, OrderType } = require("@polymarket/clob-client");

/**
 * Order executor — wraps CLOB client to place FOK market orders.
 * In dry-run mode, simulates success without hitting the API.
 *
 * IMPORTANT: For FOK orders, use createAndPostMarketOrder (not createAndPostOrder).
 *   - createAndPostOrder => GTC limit orders
 *   - createAndPostMarketOrder => FOK/FAK market orders
 *
 * UserMarketOrder uses `amount` (USDC to spend), not `size` (shares).
 */
class Executor {
  constructor(clobClient, store, io) {
    this.clob = clobClient;
    this.store = store;
    this.io = io;
  }

  async placeOrder({ tokenId, side, price, size, dryRun, strategy, market }) {
    // Calculate the USDC amount to spend (size * price)
    const amount = parseFloat((size * price).toFixed(2));

    if (dryRun) {
      const entry = this.store.addLog({
        strategy,
        action: "DRY_RUN",
        side,
        price,
        size,
        amount,
        market: market.question,
      });
      this.io.emit("log", entry);
      this.io.emit("trade", { strategy, side, price, size, amount, dryRun: true, market: market.question });
      return { success: true, dryRun: true };
    }

    if (!this.clob) {
      const msg = "CLOB client not initialized — cannot place live orders";
      console.error(`[EXECUTOR] ${msg}`);
      this.store.addLog({ strategy, action: "FAILED", reason: msg, market: market.question });
      return { success: false, error: msg };
    }

    try {
      console.log(`[EXECUTOR] FOK BUY ${side}: token=${tokenId.slice(0, 16)}... price=${price} amount=$${amount}`);

      // Use createAndPostMarketOrder for FOK orders
      // UserMarketOrder: { tokenID, price, amount, side }
      const response = await this.clob.createAndPostMarketOrder(
        {
          tokenID: tokenId,
          price,
          amount,
          side: Side.BUY,
        },
        undefined,          // options (tick size, negRisk)
        OrderType.FOK       // 3rd arg: order type
      );

      console.log(`[EXECUTOR] CLOB response:`, JSON.stringify(response));

      // Check for success
      if (response && response.orderID) {
        console.log(`[EXECUTOR] FILLED: ${response.orderID}`);

        const entry = this.store.addLog({
          strategy,
          action: "FILLED",
          side,
          price,
          size,
          amount,
          orderId: response.orderID,
          market: market.question,
        });
        this.io.emit("log", entry);
        this.io.emit("trade", { strategy, side, price, size, amount, orderId: response.orderID, market: market.question });
        return { success: true, orderId: response.orderID };
      }

      // If no orderID, check for error in response
      const errorMsg = (response && (response.error || response.message)) || JSON.stringify(response);
      console.error(`[EXECUTOR] No orderID. Response:`, errorMsg);

      this.store.addLog({
        strategy,
        action: "FAILED",
        side,
        price,
        amount,
        reason: errorMsg,
        market: market.question,
      });
      this.io.emit("log", { strategy, action: "FAILED", reason: errorMsg });
      return { success: false, error: errorMsg };

    } catch (err) {
      const errMsg = err.response?.data?.error || err.message;
      console.error(`[EXECUTOR] Order failed:`, errMsg);
      if (err.response?.data) {
        console.error(`[EXECUTOR] Full error:`, JSON.stringify(err.response.data));
      }

      this.store.addLog({
        strategy,
        action: "FAILED",
        side,
        price,
        amount,
        reason: errMsg,
        market: market.question,
      });
      this.io.emit("log", { strategy, action: "FAILED", reason: errMsg });
      return { success: false, error: errMsg };
    }
  }

  async cancelAll() {
    if (!this.clob) return 0;
    try {
      await this.clob.cancelAll();
      return 1;
    } catch {
      return 0;
    }
  }
}

module.exports = Executor;
