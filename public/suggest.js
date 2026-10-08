// Product suggestion box: customer-facing form + ops ranked view.
(function () {
  function api(path, opts) {
    return window.HKL.api(path, opts);
  }
  function toast(msg) {
    return window.HKL.toast(msg);
  }

  // Customer-facing suggestion form HTML (rendered at bottom of /shop)
  function suggestForm() {
    return `<section class="wrap" style="margin-top:48px;margin-bottom:48px">
      <div class="card" style="max-width:560px;margin:0 auto;padding:28px">
        <h2 style="margin-top:0">Can't find what you're looking for?</h2>
        <p class="lede">Tell us which research compound you'd like us to stock. The most requested products get priority.</p>
        <form id="suggestForm" class="stack" style="display:grid;gap:16px">
          <label style="display:block"><span style="display:block;margin-bottom:6px;font-weight:600">Product name</span><input name="sname" required placeholder="e.g. Epitalon" maxlength="120" style="width:100%" /></label>
          <label style="display:block"><span style="display:block;margin-bottom:6px;font-weight:600">Email <span class="muted" style="font-weight:400">(optional — we'll notify you if we stock it)</span></span><input name="semail" type="email" placeholder="you@example.com" maxlength="120" style="width:100%" /></label>
          <label style="display:block"><span style="display:block;margin-bottom:6px;font-weight:600">Note <span class="muted" style="font-weight:400">(optional)</span></span><input name="snote" placeholder="Strength, size, anything else" maxlength="500" style="width:100%" /></label>
          <button class="btn" type="submit">Request product</button>
          <p id="suggestNote" class="hard"></p>
        </form>
      </div>
    </section>`;
  }

  function mount(slotId) {
    const slot = document.getElementById(slotId);
    if (!slot) return;
    slot.innerHTML = suggestForm();
    wireForm();
  }

  function mountShop() {
    const section = document.querySelector('section.page.wrap');
    if (!section || document.getElementById("suggestForm")) return;
    const div = document.createElement("div");
    div.innerHTML = suggestForm();
    section.after(div.firstElementChild);
    wireForm();
  }

  function wireForm() {
    const form = document.getElementById("suggestForm");
    if (!form) return;
    const note = document.getElementById("suggestNote");
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const body = { name: fd.get("sname"), email: fd.get("semail"), note: fd.get("snote") };
      try {
        const r = await api("/api/suggest", { method: "POST", body });
        if (r.duplicate) {
          note.textContent = "You've already requested this one — we've got it counted.";
        } else {
          note.textContent = "Thanks — your request is counted.";
          form.reset();
        }
      } catch (err) {
        note.textContent = "Couldn't submit — try again.";
      }
      toast(note.textContent);
    };
  }

  // Ops: ranked suggestions view
  async function renderOpsSuggestions(host) {
    let data;
    try {
      data = await api("/api/ops/suggestions");
    } catch (err) {
      host.innerHTML = `<p class="hard">Couldn't load suggestions.</p>`;
      return;
    }
    const list = data.suggestions || [];
    host.innerHTML = `
      <h2>Product requests ${data.total ? `<span class="muted">(${data.total} total)</span>` : ""}</h2>
      ${list.length ? `<table class="tbl"><thead><tr><th>Product</th><th>Requests</th><th>Emails</th><th></th></tr></thead><tbody>
        ${list.map((s) => `<tr>
          <td><b>${escapeHtml(s.name)}</b>${s.notes.length ? `<div class="muted" style="font-size:12px">${escapeHtml(s.notes.slice(0, 2).join(" · "))}</div>` : ""}</td>
          <td>${s.count}</td>
          <td>${s.emails.length ? `<span title="${escapeHtml(s.emails.join(", "))}">${s.emails.length}</span>` : "—"}</td>
          <td><button class="btn ghost" data-dismiss="${escapeHtml(s.name)}">Dismiss</button></td>
        </tr>`).join("")}
      </tbody></table>` : `<p class="muted">No product requests yet.</p>`}
    `;
    host.querySelectorAll("[data-dismiss]").forEach((btn) => {
      btn.onclick = async () => {
        if (!confirm("Dismiss all requests for " + btn.dataset.dismiss + "?")) return;
        await api("/api/ops/suggestions/dismiss", { method: "POST", body: { name: btn.dataset.dismiss } });
        renderOpsSuggestions(host);
      };
    });
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  window.HKL_SUGGEST = { suggestForm, mount, mountShop, renderOpsSuggestions };
})();
