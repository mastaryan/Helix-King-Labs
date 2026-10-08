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

  window.HKL_ACCT = function () {
    const HKL = window.HKL || {};
    const link = document.getElementById("acctLink");
    if (!link || !HKL.state || !HKL.state.user || link.dataset.dd) return;
    link.dataset.dd = "1";
    const wrap = document.createElement("span");
    wrap.className = "acct-dd";
    link.parentNode.insertBefore(wrap, link);
    wrap.appendChild(link);
    const menu = document.createElement("div");
    menu.className = "acct-menu hide";
    menu.innerHTML = `<a href="/account">My account</a><button id="signOutBtn" type="button">Sign out</button>`;
    wrap.appendChild(menu);
    link.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); menu.classList.toggle("hide"); });
    document.addEventListener("click", (e) => { if (!wrap.contains(e.target)) menu.classList.add("hide"); });
    menu.querySelector("#signOutBtn").onclick = async () => {
      try { await HKL.api("/api/auth/logout", { method: "POST" }); } catch (x) {}
      location.href = "/";
    };
    menu.querySelector("a").addEventListener("click", (e) => { e.preventDefault(); menu.classList.add("hide"); location.href = "/account"; });
  };
})();
