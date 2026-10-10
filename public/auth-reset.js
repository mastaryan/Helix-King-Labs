(function () {
  window.HKL_RESET = function () {
    const HKL = window.HKL || {};
    const api = HKL.api;
    const app = document.getElementById("app");
    const t = new URLSearchParams(location.search).get("token") || "";
    app.innerHTML = `<section class="page wrap"><div class="kicker">Account</div><h1>Reset password</h1>
      ${t
        ? `<form id="rstF"><input name="pw" type="password" required minlength="8" placeholder="New password (8+ characters)"/><button class="btn" type="submit">Set new password</button><div class="err" id="rstE"></div></form>`
        : `<form id="rstF"><input name="em" type="email" required placeholder="Email"/><button class="btn" type="submit">Send reset link</button><p class="muted" id="rstM"></p></form>`}
      </section>`;
    document.getElementById("rstF").onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      if (t) {
        try {
          const o = await api("/api/auth/password/reset", { method: "POST", body: { token: t, password: fd.get("pw") } });
          if (HKL.state) HKL.state.user = o.user;
          location.href = "/account";
        } catch (x) {
          document.getElementById("rstE").textContent = "This link expired. Request a new one.";
        }
      } else {
        await api("/api/auth/password/forgot", { method: "POST", body: { email: fd.get("em") } });
        document.getElementById("rstM").textContent = "Check your email for the reset link.";
      }
    };
  };

  // Account dropdown: single delegated wiring (runs once, survives re-renders).
  // HKL_ACCT is called on every nav; the actual listeners are attached only once.
  window.HKL_ACCT = function () {
    const HKL = window.HKL || {};
    if (!HKL.state || !HKL.state.user) return;
    if (document.__hklAcctWired) return;
    document.__hklAcctWired = true;

    const closeAll = () => {
      document.querySelectorAll(".acct-menu").forEach((m) => m.classList.add("hide"));
    };

    // Toggle on account link click (delegated — works after header re-renders).
    document.addEventListener("click", (e) => {
      const link = e.target && e.target.closest ? e.target.closest("#acctLink") : null;
      if (link) {
        e.preventDefault();
        e.stopPropagation();
        const wrap = link.closest(".acct-dd");
        const menu = wrap ? wrap.querySelector(".acct-menu") : document.querySelector(".acct-menu");
        if (!menu) return;
        const willOpen = menu.classList.contains("hide");
        closeAll();
        if (willOpen) menu.classList.remove("hide");
        return;
      }
      // Click anywhere else closes the menu (unless inside it).
      const inMenu = e.target && e.target.closest ? e.target.closest(".acct-menu") : null;
      if (!inMenu) closeAll();
    });

    // Sign out (delegated).
    document.addEventListener("click", async (e) => {
      const btn = e.target && e.target.closest ? e.target.closest("#signOutBtn") : null;
      if (!btn) return;
      e.preventDefault();
      closeAll();
      try { await HKL.api("/api/auth/logout", { method: "POST" }); } catch (x) {}
      location.href = "/";
    });

    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAll(); });
    let lastY = window.scrollY;
    window.addEventListener("scroll", () => {
      if (Math.abs(window.scrollY - lastY) > 8) closeAll();
      lastY = window.scrollY;
    }, { passive: true });
    window.addEventListener("hkl:route", closeAll);
  };

  // Build the dropdown shell around #acctLink (idempotent).
  window.HKL_ACCT_BUILD = function () {
    const link = document.getElementById("acctLink");
    if (!link || link.closest(".acct-dd")) return;
    const wrap = document.createElement("span");
    wrap.className = "acct-dd";
    wrap.style.position = "relative";
    link.parentNode.insertBefore(wrap, link);
    wrap.appendChild(link);
    const menu = document.createElement("div");
    menu.className = "acct-menu hide";
    menu.innerHTML = `<a href="/account">My account</a><button id="signOutBtn" type="button">Sign out</button>`;
    wrap.appendChild(menu);
  };
})();
