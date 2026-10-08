// Account page HTML for logged-in users: collapsible Update Account + Security.
(function () {
  function accountHtml(u) {
    const addr = u.address || {};
    return `<section class="page wrap">
      <div class="kicker">Account</div>
      <h1>${u.email}</h1>
      <p class="lede">First-order code ${u.firstOrderOpen ? "HELIX10 is open on this account." : "has already been applied."}</p>
      <details class="card" style="margin-top:16px;padding:0">
        <summary style="padding:20px 24px;cursor:pointer;font-weight:700;font-size:17px">Update Account</summary>
        <div style="padding:0 24px 24px">
          <form id="profileForm" class="tool-form">
            <input name="name" value="${u.name || ""}" placeholder="Name" />
            <input name="email" type="email" value="${u.email}" required />
            <input name="company" value="${u.company || ""}" placeholder="Company / lab, optional" />
            <select name="researchField">
              ${["Independent Researcher","Molecular Biology","Biochemistry","Peptide Chemistry","Chemical Biology","Biotechnology Research","Academic Research","Pharmacology"].map((f) => `<option ${u.researchField === f ? "selected" : ""}>${f}</option>`).join("")}
            </select>
            <input name="phone" value="${u.phone || ""}" placeholder="Phone, optional" />
            <input name="line1" value="${addr.line1 || ""}" placeholder="Ship-to address" />
            <input name="city" value="${addr.city || ""}" placeholder="City" />
            <input name="region" value="${addr.region || ""}" placeholder="State" />
            <input name="postal" value="${addr.postal || ""}" placeholder="Postal code" />
            <label class="check"><input type="checkbox" name="emailOptIn" ${u.emailOptIn ? "checked" : ""} /> Lot alerts and promotions. Order mail is separate.</label>
            <button class="btn" type="submit">Save profile</button>
          </form>
        </div>
      </details>
      <details class="card" style="margin-top:12px;padding:0" id="securityDetails">
        <summary style="padding:20px 24px;cursor:pointer;font-weight:700;font-size:17px">Security</summary>
        <div style="padding:0 24px 24px" id="securityBody">
          <div id="pwSlot"></div>
          <div style="margin-top:16px;display:flex;gap:12px;flex-wrap:wrap">
            <button class="btn ghost" type="button" id="passkeyAdd">Add passkey</button>
            <button class="btn ghost" type="button" id="tfaBtn">Set up 2FA</button>
          </div>
          <div id="tfaBox" style="margin-top:16px"></div>
        </div>
      </details>
      <p style="margin-top:16px"><button class="btn ghost" id="logoutBtn" type="button">Sign out</button></p>
      <div id="orderList" style="margin-top:28px"></div>
    </section>`;
  }
  window.HKL_ACCOUNT = { accountHtml };
})();
