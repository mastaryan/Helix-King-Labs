// Exit beacon tracking for funnel analysis.
function createTracking({ store, saveStore, send, readBody }) {
  async function handle(req, res, url) {
    if (req.method === "POST" && url.pathname === "/api/track/exit") {
      const body = await readBody(req).catch(() => ({}));
      if (!Array.isArray(store.exitBeacons)) store.exitBeacons = [];
      store.exitBeacons.push({
        page: String(body.page || "").slice(0, 200),
        time_spent: Number(body.time_spent) || 0,
        cart_items: Number(body.cart_items) || 0,
        at: new Date().toISOString(),
      });
      if (store.exitBeacons.length > 1000) store.exitBeacons = store.exitBeacons.slice(-1000);
      if (store.exitBeacons.length % 10 === 0) saveStore(store);
      return send(res, 200, { ok: true });
    }
    return null;
  }
  return handle;
}
module.exports = { createTracking };
