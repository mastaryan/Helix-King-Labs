(function () {
  function fileData(file) {
    return new Promise((resolve) => {
      if (!file) return resolve("");
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.readAsDataURL(file);
    });
  }

  async function mountDesk() {
    const host = document.getElementById("deskCatalog");
    if (!host || !window.HKL || !window.HKL.api) return;
    const api = window.HKL.api;
    const sec = await api("/api/ops/security");
    if (!sec.totpEnabled || !sec.totpOk) {
      host.innerHTML = `<div class="desk-lock">
        <h2>Authenticator</h2>
        <p class="lede">${sec.totpEnabled ? "Enter the 6-digit code from the authenticator app to open the catalog editor." : "Add an authenticator app before editing price, stock, photos, or certificates."}</p>
        <form id="totpForm" class="stack">
          ${sec.totpEnabled ? "" : `<button class="btn ghost" type="button" id="totpSetup">Show setup code</button><div id="totpQr"></div>`}
          <label>Code<input name="code" inputmode="numeric" autocomplete="one-time-code" required placeholder="123456" /></label>
          <button class="btn" type="submit">${sec.totpEnabled ? "Unlock desk" : "Confirm and unlock"}</button>
        </form>
        <p id="totpNote" class="hard"></p>
      </div>`;
      const note = document.getElementById("totpNote");
      const setup = document.getElementById("totpSetup");
      if (setup) setup.onclick = async () => {
        const out = await api("/api/ops/security/setup", { method: "POST", body: {} });
        document.getElementById("totpQr").innerHTML = `<img src="${out.qr}" alt="Authenticator setup code" /><p class="hard">${out.secret}</p>`;
      };
      document.getElementById("totpForm").onsubmit = async (e) => {
        e.preventDefault();
        const code = new FormData(e.target).get("code");
        const path = sec.totpEnabled ? "/api/ops/security/verify" : "/api/ops/security/confirm";
        const out = await api(path, { method: "POST", body: { code } });
        if (out.error) { note.textContent = "Code was not accepted."; return; }
        mountDesk();
      };
      return;
    }
    const data = await api("/api/ops/catalog");
    if (data.error) { host.innerHTML = `<p>Desk locked.</p>`; return; }
    const items = data.items || [];
    host.innerHTML = `<h2>Catalog editor</h2>
      <p class="lede">Edit a strength, add one to a family, upload the vial photo, or attach the laboratory file. A certificate shows on the public page only after that strength has been stocked and the file is saved.</p>
      <label>Strength<select id="deskSku">${items.map((it) => `<option value="${it.sku}">${it.name} · ${it.size} · ${it.sku}</option>`).join("")}<option value="__new">New strength</option></select></label>
      <form id="deskForm" class="stack form-grid"></form>
      <p id="deskNote" class="hard"></p>`;
    const form = document.getElementById("deskForm");
    const note = document.getElementById("deskNote");
    function fill(sku) {
      const it = items.find((x) => x.sku === sku) || { sku: "", name: "", size: "", price: "", kitPrice: "", cost: "", lot: "", stock: 0, purity: "", shopVisible: true, coa: {}, family: (data.families[0] || {}).id };
      const coa = it.coa || {};
      const creating = sku === "__new";
      form.innerHTML = `
        ${creating ? `<label>Family<select name="family">${data.families.map((f) => `<option value="${f.id}">${f.name}</option>`).join("")}</select></label><label>New SKU<input name="sku" required placeholder="RT15" /></label>` : `<input type="hidden" name="sku" value="${it.sku}" />`}
        <label>Public name<input name="name" value="${it.name || ""}" required /></label>
        <label>Strength<input name="size" value="${it.size || ""}" required /></label>
        <label>List price<input name="price" type="number" step="0.01" value="${it.price ?? ""}" required /></label>
        <label>Kit price<input name="kitPrice" type="number" step="0.01" value="${it.kitPrice ?? ""}" required /></label>
        <label>Unit cost<input name="cost" type="number" step="0.01" value="${it.cost ?? ""}" /></label>
        <label>Lot<input name="lot" value="${it.lot || ""}" required /></label>
        <label>On hand<input name="stock" type="number" min="0" value="${it.stock || 0}" required /></label>
        <label>Shop<select name="shopVisible"><option value="true" ${it.shopVisible !== false ? "selected" : ""}>On shop</option><option value="false" ${it.shopVisible === false ? "selected" : ""}>Hidden</option></select></label>
        <label>Laboratory<input name="lab" value="${coa.lab || ""}" /></label>
        <label>Report ID<input name="reportId" value="${coa.reportId || ""}" /></label>
        <label>Received<input name="received" value="${coa.received || ""}" placeholder="2026-07-31" /></label>
        <label>Reported<input name="reported" value="${coa.reported || ""}" placeholder="2026-08-05" /></label>
        <label>Purity<input name="coaPurity" value="${coa.purity || it.purity || ""}" /></label>
        <label>Net content<input name="net" value="${coa.net || ""}" /></label>
        <label>Identity<input name="identity" value="${coa.identity || ""}" /></label>
        <label>Fentanyl<input name="fentanyl" value="${coa.fentanyl || ""}" /></label>
        <label>Vial photo<input name="image" type="file" accept="image/*" /></label>
        <label>Certificate file<input name="coaFile" type="file" accept="application/pdf,image/*" /></label>
        <p class="hard">${it.certificatePublic ? "Public on Certificates." : it.certificateFile ? "File saved. Public after this strength has been stocked." : "No certificate file."}</p>
        <button class="btn" type="submit">Save strength</button>
        ${creating ? "" : `<button class="btn ghost" type="button" id="deskHide">Hide from shop</button>`}`;
      const hide = document.getElementById("deskHide");
      if (hide) hide.onclick = async () => {
        if (!confirm("Hide " + it.sku + " from the shop?")) return;
        await api("/api/ops/catalog/remove", { method: "POST", body: { sku: it.sku } });
        note.textContent = it.sku + " hidden.";
        mountDesk();
      };
    }
    document.getElementById("deskSku").onchange = (e) => fill(e.target.value);
    fill(items[0] ? items[0].sku : "__new");
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const creating = document.getElementById("deskSku").value === "__new";
      const body = {
        create: creating,
        sku: fd.get("sku"),
        family: fd.get("family"),
        name: fd.get("name"),
        size: fd.get("size"),
        price: fd.get("price"),
        kitPrice: fd.get("kitPrice"),
        cost: fd.get("cost"),
        lot: fd.get("lot"),
        stock: fd.get("stock"),
        shopVisible: fd.get("shopVisible") === "true",
        coa: {
          lab: fd.get("lab"),
          reportId: fd.get("reportId"),
          received: fd.get("received"),
          reported: fd.get("reported"),
          purity: fd.get("coaPurity"),
          net: fd.get("net"),
          identity: fd.get("identity"),
          fentanyl: fd.get("fentanyl"),
        },
        imageData: await fileData(fd.get("image") && fd.get("image").size ? fd.get("image") : null),
        coaData: await fileData(fd.get("coaFile") && fd.get("coaFile").size ? fd.get("coaFile") : null),
      };
      const out = await api("/api/ops/catalog/save", { method: "POST", body });
      note.textContent = out.item ? out.item.sku + " saved." : (out.error || "Save failed.");
      if (out.item) mountDesk();
    };
  }
  window.HKL_DESK = { mountDesk };
})();
