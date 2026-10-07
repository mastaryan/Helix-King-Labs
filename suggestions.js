// Product suggestion box: customers request products, ops sees ranked demand.
function createSuggestions({ store, saveStore, send, readBody, isOpsUser }) {
  function getSuggestions() {
    if (!Array.isArray(store.suggestions)) store.suggestions = [];
    return store.suggestions;
  }

  async function handle(req, res, url, user) {
    const route = url.pathname;
    const method = req.method;

    // Public: submit a product suggestion. No account required.
    if (method === "POST" && route === "/api/suggest") {
      const body = await readBody(req).catch(() => ({}));
      const name = String(body.name || "").trim().slice(0, 120);
      const email = String(body.email || "").trim().slice(0, 120);
      const note = String(body.note || "").trim().slice(0, 500);
      if (!name) return send(res, 400, { error: "name_required" });
      const suggestions = getSuggestions();
      // Dedupe: same email + same product (case-insensitive) = already requested
      const key = name.toLowerCase();
      const dup = email && suggestions.some(
        (s) => s.name.toLowerCase() === key && (s.email || "").toLowerCase() === email.toLowerCase()
      );
      if (!dup) {
        suggestions.push({ name, email: email || null, note: note || null, at: new Date().toISOString() });
        saveStore(store);
      }
      return send(res, 200, { ok: true, duplicate: !!dup });
    }

    // Ops: ranked suggestion list
    if (method === "GET" && route === "/api/ops/suggestions") {
      if (!user || !isOpsUser(user)) return send(res, 403, { error: "forbidden" });
      const suggestions = getSuggestions();
      const ranked = {};
      for (const s of suggestions) {
        const key = s.name.toLowerCase();
        if (!ranked[key]) ranked[key] = { name: s.name, count: 0, emails: [], notes: [], latest: s.at };
        ranked[key].count++;
        if (s.email && !ranked[key].emails.includes(s.email)) ranked[key].emails.push(s.email);
        if (s.note) ranked[key].notes.push(s.note);
        if (s.at > ranked[key].latest) ranked[key].latest = s.at;
      }
      const list = Object.values(ranked).sort((a, b) => b.count - a.count || (b.latest < a.latest ? -1 : 1));
      return send(res, 200, { ok: true, total: suggestions.length, suggestions: list });
    }

    // Ops: dismiss a suggestion group
    if (method === "POST" && route === "/api/ops/suggestions/dismiss") {
      if (!user || !isOpsUser(user)) return send(res, 403, { error: "forbidden" });
      const body = await readBody(req).catch(() => ({}));
      const key = String(body.name || "").toLowerCase();
      if (!key) return send(res, 400, { error: "name_required" });
      store.suggestions = getSuggestions().filter((s) => s.name.toLowerCase() !== key);
      saveStore(store);
      return send(res, 200, { ok: true });
    }

    return null;
  }

  return { handle };
}

module.exports = { createSuggestions };
