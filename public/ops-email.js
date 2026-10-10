const hxOpsEmail = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (ch) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
/* Helix King Labs — ops email list + broadcast UI. Loaded before app.js; uses window.HKL at runtime. */
(function () {
  function render(box, d) {
    const HKL = window.HKL || {};
    const api = HKL.api;
    const toast = HKL.toast || ((m) => alert(m));
    const rows = (d && d.captures) || [];
    const ob = (d && d.outbox) || [];
    box.innerHTML = `<h2>Email list</h2><p class="lede">${rows.length} addresses. Written to data/subscribers.csv. Outbox queued in data/outbox.json.</p>` +
      (rows.length
        ? `<table class="table"><thead><tr><th>Email</th><th>Source</th><th>When</th></tr></thead><tbody>${rows.map((c)=>`<tr><td>${hxOpsEmail(c.email)}</td><td>${hxOpsEmail(c.source||"")}</td><td>${(c.created||"").slice(0,19)}</td></tr>`).join("")}</tbody></table>`
        : `<p class="muted">No subscribers yet.</p>`) +
      `<h2>Broadcast</h2><p class="lede">Send one message to all ${rows.length} subscribers. Each gets its own unsubscribe link. Queued through the outbox.</p>
      <form id="broadcastForm" class="tool-form">
        <input name="subject" placeholder="Subject" maxlength="120" required />
        <textarea name="text" placeholder="Message — plain text" rows="6" maxlength="5000" required></textarea>
        <button class="btn" type="submit">Send to ${rows.length} subscribers</button>
      </form>` +
      `<h2>Outbox</h2><p class="lede">Last ${ob.length} emails. Failed ones retry on the 5-minute drain, 3 attempts max.</p>` +
      (ob.length
        ? `<div style="overflow:auto"><table class="table"><thead><tr><th>To</th><th>Subject</th><th>Status</th><th>When</th><th>Error</th></tr></thead><tbody>${ob.slice().reverse().map((m)=>`<tr><td>${m.to||""}</td><td>${(m.subject||"").slice(0,48)}</td><td>${m.status||"queued"}</td><td>${((m.sentAt||m.created||"")+"").slice(0,19)}</td><td>${m.error||"—"}</td></tr>`).join("")}</tbody></table></div>`
        : `<p class="muted">Outbox empty.</p>`);
    const bf = box.querySelector("#broadcastForm");
    if (bf) {
      bf.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(bf);
        const subject = String(fd.get("subject") || "").trim();
        if (!confirm(`Send "${subject}" to ${rows.length} subscribers?`)) return;
        try {
          const out = await api("/api/ops/broadcast", { method: "POST", body: { subject, text: String(fd.get("text") || "") } });
          toast(`Broadcast queued to ${out.queued} subscribers.`);
          bf.reset();
        } catch (err) {
          toast("Broadcast failed: " + (err.message || "error"));
        }
      });
    }
  }

  async function load(box) {
    const HKL = window.HKL || {};
    if (!HKL.api) return;
    try {
      const d = await HKL.api("/api/ops/subscribers");
      render(box, d);
    } catch {}
  }

  function unsubscribePage() {
    const HKL = window.HKL || {};
    const app = document.getElementById("app");
    const token = new URLSearchParams(location.search).get("token") || "";
    if (app) app.innerHTML = `<section class="page wrap"><div class="kicker">Email list</div><h1>Unsubscribe</h1><p class="lede" id="unsubMsg">Working on it.</p></section>`;
    (async () => {
      const msg = document.getElementById("unsubMsg");
      try {
        const out = await HKL.api("/api/unsubscribe", { method: "POST", body: { token } });
        if (msg) msg.textContent = out && out.removed
          ? "Done — you are off the list. No more lot alerts or promotions."
          : "This link is not valid or you are already off the list.";
      } catch {
        if (msg) msg.textContent = "Something went wrong. Try again, or write info@helixkinglabs.com and we will remove you.";
      }
    })();
  }

  window.HKL_EMAIL = { render, load, unsubscribePage };
})();
