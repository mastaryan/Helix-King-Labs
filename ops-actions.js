// Helix King Labs — ops action endpoints (extracted to keep server.js under the push limit).
// Factory pattern: createOpsActions({deps}) -> handler(req, res, method, route, url, ip, user).
// Returns true when the request was handled.
"use strict";

function createOpsActions(deps) {
  const { store, saveStore, send, readBody, isOpsUser, restoreStock, audit, secHandle } = deps;

  async function handle(req, res, method, route, url, ip, user) {
    // Ops 2FA self-enrollment: signed-in ops user starts TOTP setup.
    if (method === "POST" && route === "/api/ops/2fa/setup") {
      if (!isOpsUser(user)) return send(res, 403, { error: "ops_only" }), true;
      return send(res, 200, { setupToken: secHandle.issueOpsTotpSetup(user.id), hasTotp: !!user.totpSecret }), true;
    }

    // Delete an order (ops only). Restores stock, audit-logs. Delivered
    // orders keep their paper trail — void those instead.
    if (method === "DELETE" && route === "/api/ops/orders") {
      if (!isOpsUser(user)) return send(res, 403, { error: "ops_only" }), true;
      const id = String(url.searchParams.get("id") || "").slice(0, 40);
      const idx = (store.orders || []).findIndex((o) => o.id === id);
      if (idx < 0) return send(res, 404, { error: "not_found" }), true;
      const order = store.orders[idx];
      if (order.status !== "voided") return send(res, 400, { error: "only_voided", message: "Only voided orders can be deleted. Void it first." }), true;
      restoreStock(order);
      store.orders.splice(idx, 1);
      audit(user, "order", id + " deleted (was voided)");
      saveStore(store);
      return send(res, 200, { ok: true }), true;
    }

    return false;
  }

  return { handle };
}

module.exports = { createOpsActions };
