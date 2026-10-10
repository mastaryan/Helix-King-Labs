/* Helix King Labs — customer order deletion.
   Injects "Delete" buttons on cancelled/voided/delivered order cards
   in /account order history. Standalone (app.js is at the push limit). */
(function () {
  const DELETABLE = { cancelled: 1, voided: 1, delivered: 1 };

  async function api(path, opts) {
    const res = await fetch(path, {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: (opts && opts.method) || "GET",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "request_failed");
    return data;
  }

  function inject() {
    const box = document.getElementById("orderList");
    if (!box) return;
    box.querySelectorAll(".order-card").forEach((card) => {
      if (card.querySelector("[data-del-order]")) return;
      const pill = card.querySelector(".status-pill");
      if (!pill) return;
      const st = (pill.textContent || "").trim().toLowerCase();
      if (!DELETABLE[st]) return;
      const link = card.querySelector("a[href*='/account/receipt/']");
      const id = link ? decodeURIComponent(link.getAttribute("href").split("/").pop()) : "";
      if (!id) return;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn-link danger";
      btn.setAttribute("data-del-order", id);
      btn.textContent = "Delete";
      btn.style.cssText = "margin-top:8px;font-size:.85em;color:#c66;background:none;border:none;cursor:pointer;padding:0";
      card.appendChild(btn);
    });
  }

  document.addEventListener("click", async (e) => {
    const btn = e.target && e.target.closest ? e.target.closest("[data-del-order]") : null;
    if (!btn) return;
    e.preventDefault();
    const id = btn.getAttribute("data-del-order");
    if (!window.confirm(`Delete order ${id}? This removes it from your history permanently.`)) return;
    btn.disabled = true;
    btn.textContent = "Deleting…";
    try {
      await api("/api/orders/" + encodeURIComponent(id), { method: "DELETE" });
      const card = btn.closest(".order-card");
      if (card) card.remove();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = "Delete";
      alert("Could not delete: " + (err.message || "error"));
    }
  });

  // Re-inject after SPA renders the order list (it loads async).
  const obs = new MutationObserver(() => inject());
  obs.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("DOMContentLoaded", inject);
  window.addEventListener("hkl:route", () => setTimeout(inject, 500));
})();
