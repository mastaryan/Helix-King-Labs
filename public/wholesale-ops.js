// Ops: wholesale requests, approvals, window config, per-SKU pricing.
(function () {
  function api(path, opts) { return window.HKL.api(path, opts); }
  function toast(m) { return window.HKL.toast(m); }
  function money(n) { return window.HKL.money(n); }
  function esc(s) { return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

  async function render(el) {
    let data;
    try { data = await api("/api/ops/wholesale/requests"); }
    catch (e) { el.innerHTML = `<p class="hard">Couldn't load wholesale data.</p>`; return; }
    const requests = data.requests || [];
    const cfg = data.config || {};
    const pending = requests.filter((r) => r.status === "pending");
    const decided = requests.filter((r) => r.status !== "pending");

    el.innerHTML = `
      <h2>Wholesale</h2>

      <div class="card" style="padding:20px;margin-bottom:24px">
        <h3>Order window</h3>
        <form id="wsCfgForm">
          <div style="display:flex;gap:12px;flex-wrap:wrap">
            <label>Opens <input type="datetime-local" name="wstart" value="${cfg.windowStart ? toLocal(cfg.windowStart) : ""}" /></label>
            <label>Closes <input type="datetime-local" name="wend" value="${cfg.windowEnd ? toLocal(cfg.windowEnd) : ""}" /></label>
            <label>Order minimum ($) <input type="number" name="wmin" min="0" step="1" value="${cfg.orderMinimum || 0}" style="width:100px" /></label>
          </div>
          <label>Announcement <span class="muted">(shown on the wholesale page)</span>
            <input name="wannounce" value="${esc(cfg.announce || "")}" maxlength="500" style="width:100%" /></label>
          <button class="btn" type="submit">Save window</button>
          <p id="wsCfgNote" class="hard"></p>
        </form>
      </div>

      <div class="card" style="padding:20px;margin-bottom:24px">
        <h3>Manual wholesale access</h3>
        <p class="muted">Grant or revoke wholesale access for any account (e.g. Telegram members).</p>
        <form id="wsToggleForm" style="display:flex;gap:8px">
          <input name="wemail" type="email" placeholder="user@email.com" required style="flex:1" />
          <select name="wgrant"><option value="1">Grant</option><option value="0">Revoke</option></select>
          <button class="btn" type="submit">Apply</button>
        </form>
        <p id="wsToggleNote" class="hard"></p>
      </div>

      <div class="card" style="padding:20px;margin-bottom:24px">
        <h3>Access requests (${pending.length} pending)</h3>
        ${pending.length ? `<table class="tbl"><thead><tr><th>Name</th><th>Email</th><th>Business</th><th>Telegram</th><th>Note</th><th>At</th><th></th></tr></thead><tbody>
          ${pending.map((r) => `<tr>
            <td>${esc(r.name)}</td><td>${esc(r.email)}</td><td>${esc(r.business || "—")}</td>
            <td>${esc(r.telegram || "—")}</td><td>${esc(r.note || "—")}</td>
            <td>${new Date(r.at).toLocaleDateString()}</td>
            <td><button class="btn" data-approve="${esc(r.email)}">Approve</button>
                <button class="btn ghost" data-deny="${esc(r.email)}">Deny</button></td>
          </tr>`).join("")}
        </tbody></table>` : `<p class="muted">No pending requests.</p>`}
      </div>

      ${decided.length ? `<div class="card" style="padding:20px;margin-bottom:24px">
        <h3>Decided (${decided.length})</h3>
        <table class="tbl"><thead><tr><th>Name</th><th>Email</th><th>Status</th><th>Reviewed</th></tr></thead><tbody>
          ${decided.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.email)}</td>
            <td>${r.status}</td><td>${r.reviewedAt ? new Date(r.reviewedAt).toLocaleDateString() : "—"}</td></tr>`).join("")}
        </tbody></table>
      </div>` : ""}

      <div class="card" style="padding:20px">
        <h3>Per-SKU wholesale pricing</h3>
        <p class="muted">Leave price blank to use 60% of retail. Leave minimum blank for the default (10).</p>
        <div id="wsPricing"><p class="muted">Loading products…</p></div>
      </div>`;

    // Config form
    document.getElementById("wsCfgForm").onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const note = document.getElementById("wsCfgNote");
      try {
        await api("/api/ops/wholesale/config", { method: "POST", body: {
          windowStart: fd.get("wstart") ? new Date(fd.get("wstart")).toISOString() : null,
          windowEnd: fd.get("wend") ? new Date(fd.get("wend")).toISOString() : null,
          orderMinimum: Number(fd.get("wmin")) || 0,
          announce: fd.get("wannounce"),
        }});
        note.textContent = "Saved.";
      } catch (err) { note.textContent = "Save failed."; }
      toast(note.textContent);
    };

    // Toggle form
    document.getElementById("wsToggleForm").onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const note = document.getElementById("wsToggleNote");
      try {
        const r = await api("/api/ops/wholesale/toggle", { method: "POST", body: {
          email: fd.get("wemail"), wholesale: fd.get("wgrant") === "1",
        }});
        note.textContent = r.wholesale ? "Wholesale access granted." : "Wholesale access revoked.";
      } catch (err) { note.textContent = err.error === "user_not_found" ? "No account with that email." : "Failed."; }
      toast(note.textContent);
    };

    // Approve/deny buttons
    el.querySelectorAll("[data-approve]").forEach((b) => {
      b.onclick = () => review(b.dataset.approve, true);
    });
    el.querySelectorAll("[data-deny]").forEach((b) => {
      b.onclick = () => review(b.dataset.deny, false);
    });
    async function review(email, approve) {
      try {
        await api("/api/ops/wholesale/review", { method: "POST", body: { email, approve } });
        toast(approve ? "Approved." : "Denied.");
        render(el);
      } catch (err) { toast("Failed."); }
    }

    // Per-SKU pricing
    try {
      const prods = await api("/api/ops/wholesale/products");
      const items = prods.items || prods.products || [];
      document.getElementById("wsPricing").innerHTML = `<table class="tbl"><thead><tr><th>SKU</th><th>Name</th><th>Retail</th><th>Wholesale $</th><th>Min qty</th><th></th></tr></thead><tbody>
        ${items.map((p) => `<tr>
          <td>${esc(p.sku)}</td><td>${esc(p.name)}</td><td>${money(p.price)}</td>
          <td><input type="number" min="0" step="0.01" placeholder="${(p.price * 0.6).toFixed(2)}" value="${p.wholesalePrice != null ? p.wholesalePrice : ""}" data-wp="${esc(p.sku)}" style="width:90px" /></td>
          <td><input type="number" min="1" step="1" placeholder="10" value="${p.wholesaleMin != null ? p.wholesaleMin : ""}" data-wm="${esc(p.sku)}" style="width:70px" /></td>
          <td><button class="btn" data-wsave="${esc(p.sku)}">Save</button></td>
        </tr>`).join("")}
      </tbody></table>`;
      document.getElementById("wsPricing").querySelectorAll("[data-wsave]").forEach((b) => {
        b.onclick = async () => {
          const sku = b.dataset.wsave;
          const wp = document.querySelector(`[data-wp="${sku}"]`).value;
          const wm = document.querySelector(`[data-wm="${sku}"]`).value;
          try {
            await api("/api/ops/wholesale/pricing", { method: "POST", body: {
              sku,
              wholesalePrice: wp === "" ? null : Number(wp),
              wholesaleMin: wm === "" ? null : Math.floor(Number(wm)),
            }});
            toast("Saved.");
          } catch (err) { toast("Failed."); }
        };
      });
    } catch (e) {
      document.getElementById("wsPricing").innerHTML = `<p class="hard">Couldn't load products.</p>`;
    }
  }

  function toLocal(iso) {
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  window.HKL_WHOLESALE_OPS = { render };
})();
