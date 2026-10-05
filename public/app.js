(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const app = $("#app");
  const state = {
    user: null,
    catalog: null,
    copy: null,
    cart: [],
    aff: (localStorage.getItem("hkl_aff") || "").toUpperCase(),
    gateOk: localStorage.getItem("hkl_gate") === "1",
    captureOk: localStorage.getItem("hkl_capture") === "1",
    popupDismissed: sessionStorage.getItem("hkl_popup_dismissed") === "1",
    auth: { password: true, google: false, apple: false, demo: true },
    site: { channels: { publicNote: "", checkoutLabel: "Place order", checkoutHint: "" } },
    payMethod: "crypto",
  };

  let popupShowTimer = null;
  let popupHideTimer = null;

  const money = (n) =>
    n == null
      ? null
      : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

  function cartStorageKey() {
    return state.user && state.user.id ? "hkl_cart_" + state.user.id : null;
  }

  function paintCartCount() {
    const el = $("#cartCount");
    if (!el) return;
    const n = state.user ? state.cart.reduce((a, l) => a + (Number(l.qty) || 0), 0) : 0;
    el.textContent = n ? String(n) : "";
    el.style.display = n ? "" : "none";
  }

  function loadUserCart() {
    localStorage.removeItem("hkl_cart");
    if (!state.user || !state.user.id) {
      state.cart = [];
      paintCartCount();
      return;
    }
    try {
      const raw = JSON.parse(localStorage.getItem(cartStorageKey()) || "[]");
      state.cart = Array.isArray(raw) ? raw : [];
    } catch {
      state.cart = [];
    }
    paintCartCount();
  }

  function saveCart() {
    localStorage.removeItem("hkl_cart");
    if (!state.user || !state.user.id) {
      state.cart = [];
      paintCartCount();
      return;
    }
    localStorage.setItem(cartStorageKey(), JSON.stringify(state.cart));
    paintCartCount();
  }

  function toast(msg) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    $("#toasts").appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || "request_failed");
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function pathOf() {
    return location.pathname.replace(/\/+$/, "") || "/";
  }

  function go(href) {
    history.pushState({}, "", href);
    render();
    window.scrollTo(0, 0);
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") dismissPopup();
  });

  document.addEventListener("click", (e) => {
    const a = e.target.closest("[data-link]");
    if (!a) return;
    const href = a.getAttribute("href");
    if (!href || href.startsWith("http")) return;
    e.preventDefault();
    go(href);
  });
  window.addEventListener("popstate", render);

  function ticker() {
    const lines = (state.copy && state.copy.ticker) || [
      "Certificate on every lot",
      "21+ only",
      "Not a clinic. Not a pharmacy.",
    ];
    const doubled = lines.concat(lines);
    $("#ticker").innerHTML = `<div class="ticker-track">${doubled
      .map((t) => `<span>${t} ·</span>`)
      .join("")}</div>`;
  }

  function navActive() {
    const p = pathOf();
    document.querySelectorAll(".nav a").forEach((a) => {
      const h = a.getAttribute("href");
      a.classList.toggle("active", h === p || (h !== "/" && p.startsWith(h)));
    });
    $("#acctLink").textContent = state.user ? state.user.email.split("@")[0] : "Account";
    document.querySelectorAll('[data-nav="ops"]').forEach((a) => {
      const on = !!(state.user && state.user.isOps);
      a.classList.toggle("is-hidden", !on);
      a.style.display = on ? "" : "none";
    });
    document.querySelectorAll('[data-nav="aff"]').forEach((a) => {
      const live = !!(state.user && state.user.affiliate && state.user.affiliate.status === "live");
      a.classList.toggle("is-hidden", !live);
      a.style.display = live ? "" : "none";
    });
  }

  function isPending(p) {
    return p && (p.releaseState === "pending_testing" || p.unavailableReason);
  }

  function priceBlock(p, range) {
    if (isPending(p)) {
      return `<div class="price lock">Waiting for testing to complete</div>`;
    }
    const min = range && range.min != null ? range.min : p && p.price;
    const max = range && range.max != null ? range.max : min;
    if (min == null) return `<div class="price lock">Price unavailable</div>`;
    if (max != null && max !== min) {
      return `<div class="price">From ${money(min)} – ${money(max)}</div>`;
    }
    return `<div class="price">${money(min)}</div>`;
  }

  function familyOfItem(p) {
    const fams = (state.catalog && state.catalog.families) || [];
    return fams.find((f) => f.id === p.family || f.slug === p.familySlug) || null;
  }

  function variantsOf(p) {
    return state.catalog.items.filter((x) => x.family === p.family);
  }

  function productCard(p) {
    return `<a class="card" href="/product/${p.slug}" data-link>
      <div class="ph"><img src="${p.image}" alt="${p.name} ${p.size}" /></div>
      <div class="meta">
        <div class="name">${p.name}</div>
        <div class="sub">${p.size} · ${p.form}</div>
        <div class="badges">
          <span class="badge">${p.lot}</span>
          <span class="badge">${p.purity}</span>
        </div>
        ${priceBlock(p)}
      </div>
    </a>`;
  }

  function onHand(p) {
    return p.available != null ? Number(p.available) : Number(p.stock || 0);
  }

  function stockBadge(p) {
    const n = onHand(p);
    const threshold = Number(p.stockThreshold) || 5;
    const status = n <= 0 ? "out" : n < threshold ? "low" : "ok";
    if (status === "out") return `<span class="badge stock out">Out of stock</span>`;
    if (status === "low") return `<span class="badge stock low">Low</span>`;
    return "";
  }

  function familyCard(f) {
    const vars = state.catalog.items.filter((x) => x.family === f.id);
    const lead = vars[Math.floor(vars.length / 2)] || vars[0] || {};
    const sizes = (f.sizes || vars.map((v) => v.size)).join(" · ");
    const img = (vars[0] && vars[0].image) || f.cardImage || f.image || lead.image;
    const pending = f.releaseState === "pending_testing" || vars.every(isPending);
    const priced = vars.filter((v) => v.price != null && !isPending(v));
    const lows = priced.map((v) => v.price);
    const from = pending
      ? { releaseState: "pending_testing" }
      : lows.length
        ? { price: Math.min(...lows) }
        : lead;
    const range = lows.length ? { min: Math.min(...lows), max: Math.max(...lows) } : null;
    const allOut = vars.length > 0 && vars.every((v) => onHand(v) <= 0);
    const worst = allOut ? vars[0] : null;
    return `<article class="card">
      <a href="/product/${f.slug}" data-link>
        <div class="ph"><img src="${img}" alt="${f.name}" /></div>
      </a>
      <div class="meta">
        <a href="/product/${f.slug}" data-link><div class="name">${f.name}</div></a>
        <div class="dose-row card-doses" aria-label="Strengths">
          ${vars
            .map(
              (v) =>
                `<a class="dose ${((v.available != null ? v.available : v.stock) <= 0) ? "out" : ""}" href="/product/${f.slug}?sku=${encodeURIComponent(v.sku)}" data-link>${v.size}</a>`
            )
            .join("")}
        </div>
        <div class="badges">
          ${pending ? `<span class="badge stock out">Unavailable</span>` : worst ? stockBadge(worst) : ""}
        </div>
        ${priceBlock(from, range)}
      </div>
    </article>`;
  }



  function specRows(p, about) {
    const skip = new Set(["NA", "Not published on the storefront", ""]);
    const rows = (p.specs || []).filter((row) => row && !skip.has(String(row[1] || "").trim()));
    if (!rows.some((row) => row[0] === "Use")) {
      rows.push(["Use", (about && about.use) || "Research use only. Not for diagnostic or therapeutic use."]);
    }
    const comps = ((about && about.components) || []).filter(Boolean);
    if (comps.length > 1 && !rows.some((row) => row[0] === "Components" || row[0] === "Pair")) {
      rows.push(["Components", comps.join(" · ")]);
    }
    return rows;
  }

  function categoryName(p) {
    const id = p.category || "";
    if (id === "blends") return "Documented blends";
    if (id === "serums") return "Research serums";
    return "Documented compounds";
  }

  function familyBlurb(fam) {
    const body = (fam && fam.about && fam.about.body) || (fam && fam.blurb) || "";
    return body;
  }

  function sourceLinks(fam) {
    const rows = (fam && fam.sources) || [];
    if (!rows.length) return "";
    return `<p class="sources">${rows.map((r) => `<a href="${r.href}" rel="noopener noreferrer">${r.label}</a>`).join(" · ")}</p>`;
  }


  function faqAnswer(f) {
    if (f.q === "Where are the certificates?") {
      return `Search lots on <a href="/certificates" data-link>Certificates</a>. Each vial carries its own QR. The QR opens this site’s lot page, not a third-party laboratory. The certificate file attaches when that lot is accepted.`;
    }
    return f.a;
  }

  function home() {
    const heroFam =
      (state.catalog.families || []).find((f) => f.id === state.catalog.heroFamily || f.hero) ||
      (state.catalog.families || [])[0];
    const hero =
      state.catalog.items.find((p) => p.sku === state.catalog.heroSku) ||
      state.catalog.items.find((p) => p.hero) ||
      state.catalog.items[0];
    const offerIds = state.catalog.homeOffers || ["pgl-gic1", "pgl-gi1", "bpc-tb", "tesamorelin"];
    const featured = offerIds
      .map((id) => (state.catalog.families || []).find((f) => f.id === id))
      .filter(Boolean);
    const copy = state.copy.homepage;
    return `
    <section class="hero">
      <img class="bg" src="/img/pgl-gic1-10.jpg" alt="" />
      <div class="veil"></div>
      <div class="hero-copy">
        <div class="kicker">Helix King Labs</div>
        <h1>${copy.headline}</h1>
        <p class="proof">${copy.proof}</p>
        <div class="hero-actions">
          <a class="btn" href="/shop" data-link>Open the catalog</a>
        </div>
      </div>
    </section>
    <section class="section">
      <div class="wrap">
        <h2>Favorite research products</h2>
        <p class="lede home-names desk">${featured.map((f) => f.name).join(" · ")}</p>
        <p class="lede home-names mob">${featured.slice(0, 4).map((f) => f.name).join(" · ")}</p>
        <div class="grid cards home-cards">${featured.map(familyCard).join("")}</div>
      </div>
    </section>
    <section class="section">
      <div class="wrap">
        <div class="kicker">FAQ</div>
        <h2>Questions</h2>
        <div class="faq">
          ${state.copy.faq
            .map(
              (f) => `<details><summary>${f.q}</summary><p>${faqAnswer(f)}</p></details>`
            )
            .join("")}
        </div>
      </div>
    </section>
    <section class="section">
      <div class="wrap capture">
        <div>
          <div class="kicker">Updates</div>
          <h2>New shipments</h2>
          <p class="lede">Leave an email for new shipments, new research materials, and special promotions.</p>
        </div>
        <form id="homeCapture">
          <input type="email" name="email" placeholder="Email" required />
          <button class="btn" type="submit">Get updates</button>
        </form>
      </div>
    </section>`;
  }

  function shop() {
    const cat = new URLSearchParams(location.search).get("cat");
    const families = (state.catalog.families || []).filter((f) => f.shopVisible !== false && (!cat || f.category === cat));
    const label = state.catalog.categories.find((c) => c.id === cat);
    return `<section class="page wrap">
      <div class="kicker">Catalog</div>
      <h1>${label ? label.name : "Full catalog"}</h1>
      <p class="lede">Documented research peptides with lot and COA information.</p>
      <div class="badges" style="margin-bottom:22px">
        <a class="badge" href="/shop" data-link>All</a>
        ${state.catalog.categories
          .map((c) => `<a class="badge" href="/shop?cat=${c.id}" data-link>${c.name}</a>`)
          .join("")}
      </div>
      <div class="grid cards">${families.map(familyCard).join("")}</div>
    </section>`;
  }

  function productView(p, lots, related, variants, extra = {}) {
    const current = lots.find((l) => l.lot === p.lot) || lots[0];
    const vars = variants && variants.length ? variants : variantsOf(p);
    const fam = extra.family || familyOfItem(p) || {};
    const about = fam.about || {};
    const reviews = extra.reviews || [];
    const canReview = !!extra.canReview;
    const classLabel =
      p.useClass === "cosmetic"
        ? "Cosmetic lot"
        : p.useClass === "wellness"
        ? "Documented wellness lot"
        : p.useClass === "mixed"
        ? "Kit"
        : "Research material";
    return `<section class="page wrap">
      <div class="product">
        <div class="stage"><img id="pdpImage" src="${p.image}" alt="${p.name} ${p.size}" /></div>
        <div>
          <div class="kicker">${classLabel}</div>
          <h1>${p.name}</h1>
          <p class="hard">${p.size} · ${categoryName(p)}</p>
          <div class="sku-line">Lot ${p.lot}</div>
          <div class="dose-row" aria-label="Strengths" id="pdpDoses">
            ${vars
              .map((v) => {
                const href = `/product/${v.familySlug || fam.slug || p.familySlug}?sku=${v.sku}`;
                const gone = (v.available != null ? v.available : v.stock) <= 0;
                return `<a class="dose ${v.sku === p.sku ? "on" : ""} ${gone ? "out" : ""}" href="${href}" data-sku="${v.sku}">${v.size}</a>`;
              })
              .join("")}
          </div>
          <div class="badges" style="margin-top:14px">
            <span class="badge">Lot ${p.lot}</span>
            <span class="badge">${p.purity}</span>
            <span class="badge">${p.panel}</span>
            ${stockBadge(p)}
          </div>
          ${priceBlock(p)}
          <div class="qty">
            <button type="button" id="qtyMinus">−</button>
            <input id="qty" type="number" min="1" max="9" value="1" style="width:72px;min-width:72px;text-align:center" />
            <button type="button" id="qtyPlus">+</button>
          </div>
          ${
            !state.user
              ? `<a class="btn" href="/account" data-link>Sign in to add</a>`
              : `<button class="btn" id="addBtn" ${
                  isPending(p) || onHand(p) <= 0 ? "disabled" : ""
                }>${
                  isPending(p)
                    ? "Waiting for testing to complete"
                    : onHand(p) <= 0
                    ? "Out of stock"
                    : "Add " + p.name + " · " + p.size
                }</button>`
          }
          ${state.user && onHand(p) <= 0 ? `<p class="hard">Sold out.</p>` : ""}
          ${
            state.user
              ? ""
              : `<p class="hard">Sign in to add this vial. First recorded order takes HELIX10 unless an affiliate code is already on the cart.</p>`
          }
          <div class="tiers">${familyBlurb(fam)}${sourceLinks(fam)}</div>
          <table class="spec">
            ${specRows(p, about)
              .map((row) => `<tr><th>${row[0]}</th><td>${row[1]}</td></tr>`)
              .join("")}
          </table>
          <p class="hard">All products listed on this site are for research purposes only. Not for human dosing, injection, or ingestion.</p>
          <div class="cert-box">
            <h3>Lot file</h3>
            <p>Certificate not published. The file attaches when this lot is accepted. The vial QR opens this page, not a third-party laboratory.</p>
            <p style="margin-top:10px"><a href="/certificates" data-link>Certificates</a> · <a href="/testing" data-link>Testing methods</a></p>
          </div>
        </div>
      </div>
      ${
        related.length
          ? `<div style="margin-top:56px">
              <div class="kicker">Related products</div>
              <h2>Also on the catalog</h2>
              <div class="grid cards" style="margin-top:18px">${related.map(productCard).join("")}</div>
            </div>`
          : ""
      }
    </section>`;
  }

  function certIndex() {
    const families = (state.catalog.families || []).filter((f) => f.shopVisible !== false);
    const lots = families.reduce((n, f) => n + ((f.variants || []).length || 1), 0);
    return `<section class="page wrap">
      <div class="kicker">Lot record</div>
      <h1>Certificates</h1>
      <p class="lede">Every research material on the catalog. A lot stays here after it closes. Results publish when that lot is accepted.</p>
      <div class="grid cards" style="margin:18px 0">
        <article class="card"><h3>${families.length}</h3><p>Compounds</p></article>
        <article class="card"><h3>${lots}</h3><p>Lots on file</p></article>
        <article class="card"><h3>0</h3><p>Passed</p></article>
        <article class="card"><h3>Pending</h3><p>Purity and net content</p></article>
      </div>
      <div class="grid cards">${families.map((f) => `<a class="card" href="/certificates/${encodeURIComponent(f.slug || f.id)}" data-link><h3>${f.name}</h3><p>Report pending</p></a>`).join("")}</div>
      <p class="hard">A certificate covers one lot. It is not a purity promise for the next lot. Research use only. Not for human dosing, injection, or ingestion.</p>
    </section>`;
  }

  function certDetail() {
    const slug = decodeURIComponent(pathOf().split("/")[2] || "");
    const fam = (state.catalog.families || []).find((f) => (f.slug || f.id) === slug);
    if (!fam) return `<section class="page wrap"><h1>Not found</h1><a href="/certificates" data-link>Certificates</a></section>`;
    const variants = fam.variants || [];
    return `<section class="page wrap">
      <div class="kicker">Lot record</div>
      <h1>${fam.name}</h1>
      <p class="lede">Select a fill. Prior lots stay on this page.</p>
      ${variants.map((v) => `<article class="card" style="margin-bottom:12px"><h3>${v.size} · ${v.sku}</h3><p>Lot ${v.lot || "pending"}</p><p>Purity — · Net content — · Identity —</p><p><a href="/docs/report-pending.pdf">Report pending PDF</a></p></article>`).join("") || "<p>Report pending.</p>"}
      <p class="hard">Verify a finished report on the laboratory named on that PDF. Research use only.</p>
      <p><a href="/certificates" data-link>All certificates</a></p>
    </section>`;
  }

  function libraryView() {
    return `<section class="page wrap prose">
      <div class="kicker">Library</div>
      <h1>Documentation library</h1>
      <p>Lot files, use terms, and cart rules. Certificates publish when a lot clears the panel.</p>
      <h2>On file</h2>
      <ul>
        <li><a href="/use" data-link>Permitted use</a> — 21+, research vs cosmetic, not a clinic.</li>
        <li><a href="/testing" data-link>Testing methods</a> — intended 12-point panel.</li>
        <li><a href="/certificates" data-link>Certificates</a> — lot PDFs when a lot clears.</li>
        <li><a href="/terms" data-link>Terms</a> — use, purchase, and payment rails.</li>
        <li><a href="/shipping" data-link>Shipping</a> — $9.95, free at $199 after discounts.</li>
        <li><a href="/refunds" data-link>Refunds</a> — all sales final. 7-day damage window.</li>
        <li><a href="/chargebacks" data-link>Chargebacks</a> — contact before a payment dispute.</li>
        <li><a href="/tracking" data-link>Tracking</a> — lookup by tracking number from the ship email.</li>
      </ul>
      <h2>Catalog rules</h2>
      <p>Research names on the card. Volume at 2 / 4 / 10+ units. One 10% on the cart: an affiliate code replaces HELIX10.</p>
      <h2>Lot alerts</h2>
      <p>Subscribe from the footer. The address is stored for lot alerts and the library link.</p>
    </section>`;
  }

  function affiliatesLocked(data) {
    if (!state.user) {
      return `<section class="page wrap prose">
        <div class="kicker">Affiliates</div>
        <h1>Account first. Then an order. Then a desk.</h1>
        <p>This page is not public. Sign in, place an order, then apply from your account.</p>
        <p><a class="btn" href="/account" data-link>Sign in</a></p>
      </section>`;
    }
    if (!data || !data.hasOrdered) {
      return `<section class="page wrap prose">
        <div class="kicker">Affiliates</div>
        <h1>Order first</h1>
        <p>The desk opens after this account has a recorded order.</p>
        <p><a class="btn" href="/shop" data-link>Open catalog</a></p>
      </section>`;
    }
    return `<section class="page wrap prose">
      <div class="kicker">Affiliates</div>
      <h1>Open a desk</h1>
      <p>10% cash on merchandise after discounts. Shipping is not commissioned. Payout on request at $50. Year-end sweep 31 Dec. No store credit. An affiliate code replaces HELIX10.</p>
      <form id="affApply">
        <label class="check"><input type="checkbox" name="agree" required /> I want a Helix affiliate code. I accept the settlement rules.</label>
        <button class="btn" type="submit" style="margin-top:16px">Open the desk</button>
      </form>
    </section>`;
  }

  function affiliatesDesk(data) {
    const rows = (data.orders || [])
      .map(
        (o) => `<tr><td>${o.id}</td><td>${(o.created || "").slice(0, 10)}</td><td>${(o.lines || []).join(", ")}</td><td>${money(o.merchandise)}</td><td>${money(o.payout)}</td></tr>`
      )
      .join("");
    return `<section class="page wrap">
      <div class="kicker">Affiliate desk</div>
      <h1>${data.affiliate.code}</h1>
      <p class="lede">Share <span class="sku-line">${location.origin}${data.link}</span>. Commission is 10% of merchandise after discounts. Shipping is not paid.</p>
      <div class="totals">
        <div><span>Earned</span><span>${money(data.earned)}</span></div>
        <div><span>Paid</span><span>${money(data.paid)}</span></div>
        <div class="grand"><span>Available</span><span>${money(data.available)}</span></div>
      </div>
      <p class="lede">Cash out at $${data.payoutFloor}+. Leftover sweeps 31 Dec.</p>
      <h2>Referred orders</h2>
      ${
        rows
          ? `<table class="table"><thead><tr><th>Order</th><th>Date</th><th>Lines</th><th>Merch</th><th>10%</th></tr></thead><tbody>${rows}</tbody></table>`
          : `<p class="lede">No referred orders yet.</p>`
      }
    </section>`;
  }

  const ORIGIN = (window.HKL_PUBLIC_ORIGIN || "https://helixkinglabs.com").replace(/\/$/, "");

  function setProductSchema(item, variants, canon) {
    const offers = (variants || []).filter((v) => v.price != null).map((v) => ({
      "@type": "Offer",
      sku: v.sku,
      price: v.price,
      priceCurrency: "USD",
      availability: Number(v.available != null ? v.available : v.stock || 0) > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      url: ORIGIN + canon,
    }));
    let el = document.getElementById("hkl-schema");
    if (!el) {
      el = document.createElement("script");
      el.id = "hkl-schema";
      el.type = "application/ld+json";
      document.head.appendChild(el);
    }
    el.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Product",
      name: item.name,
      brand: { "@type": "Brand", name: "Helix King Labs" },
      description: item.name + " research material. Research use only.",
      offers,
    });
  }

  function setPageMeta(title, description, path) {

    document.title = title;
    const url = ORIGIN + (path || "/");
    const pairs = [
      ['meta[name="description"]', description],
      ['meta[property="og:title"]', title],
      ['meta[property="og:description"]', description],
      ['meta[property="og:url"]', url],
      ['meta[name="twitter:title"]', title],
      ['meta[name="twitter:description"]', description],
    ];
    pairs.forEach(([sel, val]) => {
      const el = document.querySelector(sel);
      if (el) el.setAttribute("content", val);
    });
    let canon = document.querySelector('link[rel="canonical"]');
    if (canon) canon.setAttribute("href", url);
  }

  function about() {
    return `<section class="page wrap prose">
      <div class="kicker">About</div>
      <h1>A research catalog with a lot and COA on every vial.</h1>
      <p>Helix King Labs supplies premium research peptides for laboratory work. Each vial on this catalog is labeled with the compound name, fill, and lot. We ship dried research material only. Mixed solutions, pens, and research water are not available.</p>
      <p>Quality is the point. Lots are held to a written testing panel. Certificates publish on this domain when a lot is accepted. The QR on the vial opens here — not a third-party lab page.</p>
      <p>We are proud to support U.S. research buyers. Helix King Labs is not a clinic and not a pharmacy. Nothing on this site is a treatment, a protocol, or a claim to diagnose, cure, or prevent disease.</p>
      <div class="social-row" aria-label="Contact">
        <a href="mailto:info@helixkinglabs.com" aria-label="Email"><span class="soc" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 6h16v12H4z"/><path d="m4 7 8 6 8-6"/></svg></span>Email</a>
        <a href="tel:+12026424575" aria-label="Phone"><span class="soc" aria-hidden="true">Tel</span>202-642-4575</a>
        <a href="https://t.me/+gk0d_zGjGORkNDc5" rel="noopener noreferrer" aria-label="Telegram"><span class="soc" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M21 5 3 12l6 2 2 6 3-4 5 4z"/></svg></span>Telegram</a>
        <a href="https://www.instagram.com/HelixKingLabs/" rel="noopener noreferrer" aria-label="Instagram"><span class="soc" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="12" cy="12" r="3.5"/><circle cx="17.5" cy="6.5" r="0.8" fill="currentColor" stroke="none"/></svg></span>Instagram</a>
        <a href="https://x.com/HelixKingLabs" rel="noopener noreferrer" aria-label="X"><span class="soc" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 5l14 14M19 5 5 19"/></svg></span>X</a>
      </div>
    </section>`;
  }

  function testing() {
    const t = state.catalog.testing || { methods: [], releaseThreshold: "pending" };
    const lot = new URLSearchParams(location.search).get("lot") || "";
    const lotBlock = lot
      ? `<div class="calc-out"><div class="kicker">Lot ${lot}</div>
          <p>No public certificate is attached to this lot yet. Incoming files stay in operations until a lot is accepted for the shop. Scan targets this page so the URL never depends on a third-party laboratory.</p></div>`
      : "";
    return `<section class="page wrap prose">
      <div class="kicker">Methods</div>
      <h1>Peptide testing methods</h1>
      <p>Helix King Labs publishes the intended panel here. Lot PDFs publish on Certificates when a lot is accepted for sale. Nothing on this page is a protocol.</p>
      ${lotBlock}
      <ul>${(t.methods || []).map((m) => `<li>${m}</li>`).join("")}</ul>
      <p>Release threshold on chromatographic lots: ${t.releaseThreshold || "pending"}. Public certificates are off until operations clears a lot for resale.</p>
      <p><a href="/certificates" data-link>Certificates</a> · <a href="/tools/calculator" data-link>Research calculator</a></p>
    </section>`;
  }

  function toolsHome() {
    return `<section class="page wrap prose">
      <div class="kicker">Research tools</div>
      <h1>Research calculator</h1>
      <p>Concentration math for a vial you already hold. Not a protocol. Not an offer to mix a vial for you.</p>
      <div class="tool-grid">
        <a class="tool-card" href="/tools/calculator" data-link>
          <h2>Research calculator</h2>
          <p>Vial milligrams divided by diluent milliliters. Concentration only.</p>
        </a>
      </div>
    </section>`;
  }

  function labelTool() {
    const items = ((state.catalog && state.catalog.items) || []).filter((it) => it.shopVisible !== false);
    const options = items
      .map((it) => `<option value="${it.sku}" data-name="${it.name}" data-size="${it.size}" data-lot="${it.lot || ""}">${it.name} · ${it.size} · ${it.sku}</option>`)
      .join("");
    const first = items[0] || { name: "PGL-GIC1", size: "10 mg", sku: "", lot: "" };
    return `<section class="page wrap prose">
      <div class="kicker">Label</div>
      <h1>Vial label</h1>
      <p>Pick the fill. The QR opens helixkinglabs.com/testing for that lot, not the laboratory. Preview is 20 × 40 mm until the sheet spec arrives. The target does not change when the sheet does.</p>
      <form class="tool-form" id="labelForm" onsubmit="return false">
        <label>Fill<select id="lbSku">${options}</select></label>
        <label>Public name<input id="lbName" value="${first.name}" /></label>
        <label>SKU<input id="lbSkuText" value="${first.sku}" readonly /></label>
        <label>Amount<input id="lbSize" value="${first.size}" /></label>
        <label>Lot<input id="lbLot" value="${first.lot || ""}" placeholder="Lot on the vial" /></label>
        <button class="btn" id="lbGo" type="button">Generate label</button>
      </form>
      <div class="label-stage">
        <canvas id="lbCanvas" width="320" height="160" aria-label="Label preview"></canvas>
        <button class="btn ghost" id="lbDl" type="button">Download JPEG</button>
      </div>
      <p id="lbUrl" class="hard"></p>
    </section>`;
  }

  function calcTool() {
    return `<section class="page wrap prose">
      <div class="kicker">Calculator</div>
      <h1>Research concentration calculator</h1>
      <p>Laboratory arithmetic only. Enter the milligrams on the vial and the milliliters of diluent. The page returns concentration. It does not recommend an amount, a schedule, or use on a person or an animal. Helix King Labs does not sell mixed product.</p>
      <form class="tool-form" id="calcForm" onsubmit="return false">
        <label>Vial contents (mg)<input id="cMg" type="number" step="0.01" min="0" value="20" /></label>
        <label>Diluent volume (mL)<input id="cMl" type="number" step="0.01" min="0" value="2" /></label>
        <label>Amount to draw (mg)<input id="cDose" type="number" step="0.01" min="0" value="2" /></label>
      </form>
      <div class="calc-out" id="calcOut"></div>
      <p>Concentration = mg ÷ mL. Prefer the tested milligram figure from the lot certificate when one exists.</p>
    </section>`;
  }

  function bindTools() {
    const canvas = $("#lbCanvas");
    if (canvas) {
      const paint = (modules, sizeN) => {
        const ctx = canvas.getContext("2d");
        const name = ($("#lbName") && $("#lbName").value.trim()) || "RESEARCH";
        const size = ($("#lbSize") && $("#lbSize").value.trim()) || "";
        const sku = ($("#lbSkuText") && $("#lbSkuText").value.trim()) || "";
        const lot = ($("#lbLot") && $("#lbLot").value.trim()) || "PENDING";
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, 320, 160);
        ctx.fillStyle = "#111111";
        ctx.fillRect(0, 0, 320, 18);
        ctx.fillStyle = "#ffffff";
        ctx.font = "700 9px 'IBM Plex Sans', sans-serif";
        ctx.fillText("HELIX KING LABS", 8, 13);
        ctx.fillStyle = "#111111";
        ctx.font = "700 16px 'IBM Plex Sans', sans-serif";
        ctx.fillText(name.slice(0, 16), 8, 46);
        ctx.font = "11px 'IBM Plex Mono', monospace";
        ctx.fillText(size, 8, 68);
        ctx.fillText(sku, 8, 86);
        ctx.fillText("LOT " + lot, 8, 104);
        ctx.font = "8px 'IBM Plex Mono', monospace";
        ctx.fillText("Research use only", 8, 150);
        if (!modules || !sizeN) return;
        const cell = 90 / sizeN;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(214, 28, 92, 92);
        ctx.fillStyle = "#111111";
        for (let r = 0; r < sizeN; r++) {
          for (let c = 0; c < sizeN; c++) {
            if (modules[r * sizeN + c]) ctx.fillRect(216 + c * cell, 30 + r * cell, cell, cell);
          }
        }
      };
      const draw = async () => {
        const lot = ($("#lbLot") && $("#lbLot").value.trim()) || "";
        const urlBox = $("#lbUrl");
        if (!lot) {
          paint(null, 0);
          if (urlBox) urlBox.textContent = "Enter a lot to build the QR.";
          return;
        }
        const data = await api("/api/ops/label-qr?lot=" + encodeURIComponent(lot));
        if (urlBox) urlBox.textContent = data.url;
        paint(data.modules, data.size);
      };
      const skuSel = $("#lbSku");
      if (skuSel) {
        skuSel.addEventListener("change", () => {
          const opt = skuSel.selectedOptions[0];
          if (!opt) return;
          if ($("#lbName")) $("#lbName").value = opt.getAttribute("data-name") || "";
          if ($("#lbSize")) $("#lbSize").value = opt.getAttribute("data-size") || "";
          if ($("#lbSkuText")) $("#lbSkuText").value = opt.value;
          if ($("#lbLot")) $("#lbLot").value = opt.getAttribute("data-lot") || "";
          draw();
        });
      }
      draw();
      ["lbName", "lbSize", "lbLot"].forEach((id) => {
        const el = $("#" + id);
        if (el) el.addEventListener("change", draw);
      });
      if ($("#lbGo")) $("#lbGo").onclick = draw;
      if ($("#lbDl")) {
        $("#lbDl").onclick = () => {
          const a = document.createElement("a");
          a.download = "helix-king-labs-label.jpg";
          a.href = canvas.toDataURL("image/jpeg", 0.95);
          a.click();
        };
      }
    }
    const out = $("#calcOut");
    if (out) {
      const run = () => {
        const mg = Number($("#cMg") && $("#cMg").value);
        const ml = Number($("#cMl") && $("#cMl").value);
        const dose = Number($("#cDose") && $("#cDose").value);
        if (!mg || !ml) {
          out.innerHTML = "<p>Enter vial milligrams and diluent milliliters.</p>";
          return;
        }
        const conc = mg / ml;
        let draw = "";
        if (dose > 0 && conc > 0) {
          const mlDraw = dose / conc;
          const units = mlDraw * 100;
          draw = `<p>Draw</p><strong>${mlDraw.toFixed(2)} mL · ${units.toFixed(0)} units</strong><p>Units assume a U-100 syringe, 100 units per 1 mL.</p>`;
        }
        out.innerHTML = `<p>Material strength</p><strong>${conc.toFixed(2)} mg/mL</strong>${draw}
          <p>Research arithmetic only. Nothing on this page is a use instruction.</p>`;
      };
      ["cMg", "cMl", "cDose"].forEach((id) => {
        const el = $("#" + id);
        if (el) el.addEventListener("input", run);
      });
      run();
    }
  }

  function policy(kind) {
    if (window.HKL_LEGAL) return window.HKL_LEGAL.render(kind);
    return `<section class="page wrap"><h1>Policy</h1><p>Legal text failed to load.</p></section>`;
  }

  function account() {
    if (state.user) {
      const u = state.user;
      const addr = u.address || {};
      return `<section class="page wrap">
        <div class="kicker">Account</div>
        <h1>${u.email}</h1>
        <p class="lede">First-order code ${u.firstOrderOpen ? "HELIX10 is open on this account." : "has already been applied."}</p>
        <form id="profileForm" class="tool-form">
          <input name="name" value="${u.name || ""}" placeholder="Name" />
          <input name="email" type="email" value="${u.email}" required />
          <input name="company" value="${u.company || ""}" placeholder="Company name" />
          <select name="researchField">
            ${["Independent researcher","Molecular Biology","Biochemistry","Peptide Chemistry","Chemical Biology","Biotechnology Research","Academic Research","Pharmacology"].map((f) => `<option ${u.researchField === f ? "selected" : ""}>${f}</option>`).join("")}
          </select>
          <input name="phone" value="${u.phone || ""}" placeholder="Phone, optional" />
          <input name="line1" value="${addr.line1 || ""}" placeholder="Ship-to address" />
          <input name="city" value="${addr.city || ""}" placeholder="City" />
          <input name="region" value="${addr.region || ""}" placeholder="State" />
          <input name="postal" value="${addr.postal || ""}" placeholder="Postal code" />
          <label class="check"><input type="checkbox" name="emailOptIn" ${u.emailOptIn ? "checked" : ""} /> Lot alerts and promotions. Order mail is separate.</label>
          <button class="btn" type="submit">Save profile</button>
        </form>
        <p style="margin-top:16px"><button class="btn ghost" type="button" id="passkeyAdd">Add passkey</button> <button class="btn ghost" id="logoutBtn" type="button">Sign out</button></p>
        <div id="orderList" style="margin-top:28px"></div>
      </section>`;
    }
    return `<section class="page wrap account-grid">
      <div>
        <div class="kicker">Create account</div>
        <h1>Open the catalog.</h1>
        <p class="lede">List prices are on the catalog. An account is required to purchase. HELIX10 attaches here.</p>
        <form id="regForm">
          <div class="row-form" style="flex-direction:column;align-items:stretch">
            <input name="name" type="text" placeholder="Name" />
            <input name="email" type="email" placeholder="Email" required />
            <input name="password" type="password" placeholder="Password (8+)" required minlength="8" />
            <input name="company" type="text" placeholder="Company name" />
            <select name="researchField" required aria-label="Research field">
              <option value="">Research field</option>
              <option>Molecular Biology</option>
              <option>Biochemistry</option>
              <option>Peptide Chemistry</option>
              <option>Chemical Biology</option>
              <option>Biotechnology Research</option>
              <option>Academic Research</option>
              <option>Pharmacology</option>
            </select>
            <label class="check"><input type="checkbox" name="age" required /> I am 21 or older.</label>
            <label class="check"><input type="checkbox" name="terms" required /> I accept the permitted-use terms and the refund policy. All sales are final. Documented compounds are research-only. This is not a clinic or pharmacy.</label>
            <label class="check"><input type="checkbox" name="researchAck" required /> Chemicals purchased shall not be used for human therapeutic purposes, and are for research purposes only.</label>
            <button class="btn" type="submit">Create account</button>
            ${state.auth.google || state.auth.demo ? `<button class="btn ghost" type="button" id="googleBtn">Continue with Google</button>` : ""}
            ${state.auth.apple ? `<button class="btn ghost" type="button" id="appleBtn">Continue with Apple</button>` : ""}
          </div>
          <div class="err" id="regErr"></div>
        </form>
      </div>
      <div>
        <div class="kicker">Returning</div>
        <h1>Sign in.</h1>
        <form id="loginForm">
          <div class="row-form" style="flex-direction:column;align-items:stretch">
            <input name="email" type="email" placeholder="Email" required />
            <input name="password" type="password" placeholder="Password" required />
            <button class="btn" type="submit">Sign in</button>
            <button class="btn ghost" type="button" id="magicBtn">Email me a link</button>
            <button class="btn ghost" type="button" id="passkeyBtn">Passkey</button>
            ${state.auth.google || state.auth.demo ? `<button class="btn ghost" type="button" id="googleLoginBtn">Continue with Google</button>` : ""}
            ${state.auth.apple ? `<button class="btn ghost" type="button" id="appleLoginBtn">Continue with Apple</button>` : ""}
          </div>
          <div class="err" id="loginErr"></div>
        </form>
      </div>
    </section>`;
  }

  function cartView(quote) {
    if (!state.user) {
      return `<section class="page wrap">
        <h1>Cart</h1>
        <p class="lede">Sign in to quote HELIX10, an affiliate code, and shipping.</p>
        <a class="btn" href="/account" data-link>Sign in</a>
      </section>`;
    }
    if (!state.cart.length) {
      return `<section class="page wrap"><h1>Cart</h1><p class="lede">Empty. Start with PGL-GIC1.</p><a class="btn" href="/shop" data-link>Open catalog</a></section>`;
    }
    const lines = quote
      ? quote.lines
          .map((l) => {
            const p = state.catalog.items.find((x) => x.id === l.id);
            return `<div class="cart-line">
              <img src="${p ? p.image : ""}" alt="" />
              <div>
                <div>${l.name} · ${l.size}</div>
                <div class="sub">Lot ${l.lot}${
                  ""
                }</div>
                <div class="qty cart-qty">
                  <button type="button" data-qty-delta="${l.id}" data-delta="-1">−</button>
                  <span class="qty-n">${l.qty}</span>
                  <button type="button" data-qty-delta="${l.id}" data-delta="1">+</button>
                </div>
              </div>
              <div>${money(l.line)}</div>
            </div>`;
          })
          .join("")
      : "";
    return `<section class="page wrap">
      <div class="kicker">Cart rules</div>
      <h1>Review</h1>
      <div class="cart-lines">${lines}</div>
      <div class="totals">
        <div><span>Subtotal</span><span>${money(quote.subtotal)}</span></div>
        <div><span>${
          quote.discountKind === "affiliate"
            ? "Affiliate " + quote.coupon
            : quote.coupon || "HELIX10"
        }</span><span>${quote.couponOff ? "−" + money(quote.couponOff) : "—"}</span></div>
        <div><span>Merchandise</span><span>${money(quote.merchandise != null ? quote.merchandise : quote.total)}</span></div>
        <div><span>Shipping${quote.shippingLabel === "Free" ? " · free over $199" : ""}</span><span>${
          quote.shipping === 0 ? "Free" : money(quote.shipping)
        }</span></div>
        ${quote.surcharge ? `<div><span>Venmo surcharge</span><span>${money(quote.surcharge)}</span></div>` : ""}
        <div class="grand"><span>Total</span><span>${money(quote.total)}</span></div>
      </div>
      <label class="aff-field">Affiliate code
        <input id="affCode" type="text" maxlength="16" value="${state.aff || ""}" placeholder="Leave blank for HELIX10 on a first order" />
      </label>
      ${
        quote.shipping > 0
          ? `<p class="lede ship-nudge">Free shipping at $199. Add ${money(
              Math.max(0, (quote.freeShippingAt || 199) - (quote.merchandise || 0))
            )} more in merchandise.</p>`
          : `<p class="lede">Free shipping is on this order.</p>`
      }
      <p class="lede">One 10% on the cart. An affiliate code replaces HELIX10. Free shipping over $199 after discounts.</p>
      <form id="payForm" class="tool-form">
        <input name="company" type="text" value="${(state.user && state.user.company) || ""}" placeholder="Company name" />
        <select name="researchField" required aria-label="Research field">
          ${["Independent researcher","Molecular Biology","Biochemistry","Peptide Chemistry","Chemical Biology","Biotechnology Research","Academic Research","Pharmacology"].map((f) => `<option ${state.user && state.user.researchField === f ? "selected" : ""}>${f}</option>`).join("")}
        </select>
        <label class="check"><input type="radio" name="paymentMethod" value="crypto" ${state.payMethod !== "venmo" ? "checked" : ""} /> Crypto via NOWPayments</label>
        <label class="check"><input type="radio" name="paymentMethod" value="venmo" ${state.payMethod === "venmo" ? "checked" : ""} /> Venmo @fibkingpeps</label>
        <label class="check"><input type="radio" name="paymentMethod" value="cashapp" ${state.payMethod === "cashapp" ? "checked" : ""} /> Cash App — no surcharge</label>
        <label class="check"><input type="checkbox" name="researchAck" required /> Chemicals purchased shall not be used for human therapeutic purposes, and are for research purposes only.</label>
        <button class="btn" type="submit">Place order</button>
      </form>
      <p class="hard">The order does not ship until crypto is finished or Venmo is confirmed.</p>
      <div id="orderDone"></div>
    </section>`;
  }

  function renderGate() {
    const el = $("#gate");
    if (state.gateOk) {
      el.classList.add("hidden");
      el.innerHTML = "";
      return;
    }
    el.classList.remove("hidden");
    el.innerHTML = `
      <div class="gate-card">
        <img src="/img/logo.jpg" alt="Helix King Labs" />
        <div class="kicker">Door</div>
        <p class="gate-title" id="gateTitle">Confirm before the catalog.</p>
        <p>21+ and permitted use. Email optional. List prices are shown after this gate. An account is required to purchase.</p>
        <form id="gateForm">
          <label class="check"><input type="checkbox" name="age" required /> I am 21 or older.</label>
          <label class="check"><input type="checkbox" name="terms" required /> I accept the permitted-use terms. Research materials stay in the lab. This is not a clinic or a pharmacy.</label>
          <input type="email" name="email" placeholder="Email (optional)" />
          <div style="margin-top:16px;display:grid;gap:8px">
            <button class="btn" type="submit">Enter Helix King Labs</button>
            ${state.auth.google || state.auth.demo ? `<button class="btn ghost" type="button" id="gateGoogle">Continue with Google</button>` : ""}
            ${state.auth.apple ? `<button class="btn ghost" type="button" id="gateApple">Continue with Apple</button>` : ""}
          </div>
          <div class="err" id="gateErr"></div>
        </form>
      </div>`;
  }

  function dismissPopup() {
    const el = $("#popup");
    if (el) {
      el.classList.add("hidden");
      el.innerHTML = "";
    }
    state.popupDismissed = true;
    sessionStorage.setItem("hkl_popup_dismissed", "1");
    if (popupHideTimer) {
      clearTimeout(popupHideTimer);
      popupHideTimer = null;
    }
    if (popupShowTimer) {
      clearTimeout(popupShowTimer);
      popupShowTimer = null;
    }
  }

  function wirePopupOnce() {
    const el = $("#popup");
    if (!el || el.dataset.wired === "1") return;
    el.dataset.wired = "1";
    el.addEventListener("click", (e) => {
      if (e.target.closest("#popDismiss") || e.target.id === "popDismiss") {
        e.preventDefault();
        e.stopPropagation();
        dismissPopup();
        return;
      }
      if (e.target === el) dismissPopup();
    });
    el.addEventListener("submit", async (e) => {
      if (!e.target.closest("#popCapture")) return;
      e.preventDefault();
      try {
        await capture(new FormData(e.target).get("email"), "popup");
      } catch {
        toast("Use a valid email.");
      }
    });
  }

  function maybePopup() {
    // Capture popup parked until final build. Footer email still live.
    const el = $("#popup");
    if (el) {
      el.classList.add("hidden");
      el.innerHTML = "";
    }
    return;
    wirePopupOnce();
    if (!state.gateOk || state.captureOk || state.popupDismissed) return;
    if (pathOf() === "/account") return;
    if (popupShowTimer) return;
    if ($("#popup") && !$("#popup").classList.contains("hidden") && $("#popup").innerHTML.trim()) return;
    popupShowTimer = setTimeout(() => {
      popupShowTimer = null;
      if (state.captureOk || state.popupDismissed) return;
      const el = $("#popup");
      if (!el) return;
      el.classList.remove("hidden");
      el.innerHTML = `<div class="popup-card">
        <div class="kicker">Gift</div>
        <h2>Certificate library + new-lot alerts.</h2>
        <p>Same offer as the footer. Documentation access — not a homepage sale.</p>
        <form id="popCapture">
          <input type="email" name="email" placeholder="Email" required />
          <button class="btn" type="submit">Send access</button>
        </form>
        <button class="dismiss" id="popDismiss" type="button">Not now</button>
      </div>`;
    }, 8000);
  }

  async function capture(email, source) {
    await api("/api/capture", { method: "POST", body: { email, source } });
    state.captureOk = true;
    localStorage.setItem("hkl_capture", "1");
    toast("You are on the list. Opening the library.");
    dismissPopup();
    go("/library");
  }

  function captureAffFromUrl() {
    const ref = new URLSearchParams(location.search).get("ref") || new URLSearchParams(location.search).get("aff");
    if (!ref) return;
    const code = String(ref).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 16);
    if (code.length < 3 || code === "HELIX10") return;
    state.aff = code;
    localStorage.setItem("hkl_aff", code);
  }

  async function loadBase() {
    captureAffFromUrl();
    const [sess, copy, catalog, site] = await Promise.all([
      api("/api/session"),
      api("/api/copy"),
      api("/api/catalog"),
      api("/api/site").catch(() => ({ channels: state.site.channels })),
    ]);
    state.user = sess.user;
    loadUserCart();
    state.auth = sess.auth || state.auth;
    state.copy = copy;
    state.catalog = catalog;
    state.site = site || state.site;
  }

  function loadScript(src, id) {
    return new Promise((resolve, reject) => {
      if (id && document.getElementById(id)) return resolve();
      const s = document.createElement("script");
      if (id) s.id = id;
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("script"));
      document.head.appendChild(s);
    });
  }

  async function signInGoogle(age, terms) {
    if (!state.auth.google || !state.auth.googleClientId) {
      if (!state.auth.demo) throw new Error("google_not_configured");
      return api("/api/auth/google", { method: "POST", body: { age: !!age, terms: !!terms } });
    }
    await loadScript("https://accounts.google.com/gsi/client", "hkl-gsi");
    const credential = await new Promise((resolve, reject) => {
      window.google.accounts.id.initialize({
        client_id: state.auth.googleClientId,
        callback: (res) => (res && res.credential ? resolve(res.credential) : reject(new Error("google_token"))),
        ux_mode: "popup",
        auto_select: false,
      });
      window.google.accounts.id.prompt((n) => {
        if (n && (n.isNotDisplayed && n.isNotDisplayed() || n.isSkippedMoment && n.isSkippedMoment())) {
          reject(new Error("google_cancelled"));
        }
      });
    });
    return api("/api/auth/google", {
      method: "POST",
      body: { credential, age: !!age, terms: !!terms },
    });
  }

  async function signInApple(age, terms) {
    if (!state.auth.apple || !state.auth.appleClientId) throw new Error("apple_not_configured");
    await loadScript(
      "https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js",
      "hkl-apple"
    );
    window.AppleID.auth.init({
      clientId: state.auth.appleClientId,
      scope: "name email",
      redirectURI: state.auth.appleRedirect || window.location.origin + "/account",
      usePopup: true,
    });
    const res = await window.AppleID.auth.signIn();
    const credential = res && res.authorization && res.authorization.id_token;
    if (!credential) throw new Error("apple_token");
    return api("/api/auth/apple", {
      method: "POST",
      body: {
        credential,
        age: !!age,
        terms: !!terms,
        fullName: res.user && res.user.name ? res.user.name : null,
      },
    });
  }

  function showAdded(item) {
    const box = $("#added");
    if (!box) {
      toast("Added " + item.name + " · " + item.size);
      return;
    }
    box.classList.remove("hidden");
    box.innerHTML = `<div class="popup-card">
      <div class="kicker">Cart</div>
      <h2>Added ${item.name} · ${item.size}</h2>
      <p>The vial is in your cart. Stay on this page or review the order.</p>
      <div class="consent-actions">
        <button class="btn" type="button" id="addedCart">Go to cart</button>
        <button class="btn ghost" type="button" id="addedStay">Keep shopping</button>
      </div>
    </div>`;
    const close = () => {
      box.classList.add("hidden");
      box.innerHTML = "";
    };
    $("#addedCart").onclick = () => {
      close();
      go("/cart");
    };
    $("#addedStay").onclick = close;
    box.onclick = (e) => {
      if (e.target === box) close();
    };
  }

  function showNeedAccount() {
    const box = $("#added");
    if (!box) return go("/account");
    box.classList.remove("hidden");
    box.innerHTML = `<div class="popup-card">
      <div class="kicker">Account</div>
      <h2>Sign in to add a vial</h2>
      <p>An account is required to purchase so the lot is tied to the order. Create one, then add this fill.</p>
      <div class="consent-actions">
        <button class="btn" type="button" id="needAcct">Open account</button>
        <button class="btn ghost" type="button" id="needStay">Stay here</button>
      </div>
    </div>`;
    const close = () => {
      box.classList.add("hidden");
      box.innerHTML = "";
    };
    $("#needAcct").onclick = () => {
      close();
      go("/account");
    };
    $("#needStay").onclick = close;
    box.onclick = (e) => {
      if (e.target === box) close();
    };
  }

  function bindPdp(picked, variants, mountPdp) {
    const available = picked.available != null ? Number(picked.available) : Number(picked.stock || 0);
    const qty = $("#qty");
    const cap = Math.max(1, Math.min(20, available || 1));
    if ($("#qtyMinus")) {
      $("#qtyMinus").onclick = () => {
        qty.value = Math.max(1, Number(qty.value) - 1);
      };
    }
    if ($("#qtyPlus")) {
      $("#qtyPlus").onclick = () => {
        qty.value = Math.min(cap, Number(qty.value) + 1);
      };
    }
    document.querySelectorAll("#pdpDoses .dose").forEach((a) => {
      a.onclick = (e) => {
        e.preventDefault();
        const next = variants.find((v) => v.sku === a.getAttribute("data-sku"));
        if (!next || next.sku === picked.sku) return;
        const keepQty = qty ? qty.value : "1";
        mountPdp(next, true);
        const q2 = $("#qty");
        if (q2) q2.value = keepQty;
      };
    });
    if ($("#addBtn")) {
      $("#addBtn").onclick = () => {
        if (isPending(picked)) {
          toast("Waiting for testing to complete.");
          return;
        }
        if (!state.user) {
          showNeedAccount();
          return;
        }
        if (available <= 0) {
          toast("Out of stock · " + picked.name + " · " + picked.size);
          return;
        }
        const id = picked.id;
        const q = Math.max(1, Number(qty.value) || 1);
        const line = state.cart.find((l) => l.id === id);
        const next = Math.min(available, 9, line ? line.qty + q : q);
        if (line) line.qty = next;
        else state.cart.push({ id, qty: next });
        saveCart();
        showAdded(picked);
      };
    }
  }


  function wholesalePage() {
    return `<section class="page wrap prose">
      <div class="kicker">Wholesale desk</div>
      <h1>Request access.</h1>
      <p class="lede">Retail stays on the shop. Wholesale kits sit behind the password. Access is approved by hand.</p>
      <ol>
        <li>Send the request. It is queued for wholesale@helixkinglabs.com.</li>
        <li>The desk replies with how to gain access.</li>
        <li>Approved accounts open the group buy in progress.</li>
      </ol>
      <p>Review is not automatic. A fee may apply. Shop volume can also be invited.</p>
      <form id="wholesaleForm" class="stack">
        <input name="name" required placeholder="Name" />
        <input name="email" type="email" required placeholder="Email" />
        <input name="organization" placeholder="Organization, if any" />
        <input name="volume" placeholder="Approximate monthly kits" />
        <textarea name="interest" placeholder="Materials of interest"></textarea>
        <button class="btn" type="submit">Request access</button>
      </form>
      <p id="wholesaleNote" class="hard"></p>
    </section>`;
  }

  function groupBuyPage(gb) {
    if (sessionStorage.getItem("hkl-gb") !== "1") {
      return `<section class="page wrap prose">
        <div class="kicker">Wholesale</div>
        <h1>Group buy</h1>
        <p>This page is for the Telegram room. Enter the password.</p>
        <form id="gbGate"><input name="password" type="password" placeholder="Password" required /> <button class="btn" type="submit">Enter</button></form>
      </section>`;
    }
    return `<section class="page wrap">
      <div class="kicker">Wholesale · kits of 10</div>
      <h1>${gb.title}</h1>
      <p class="lede">Window closes 11 Oct 2026, 10:00 pm EDT.</p>
      <p>${gb.note}</p>
      <div class="grid cards">${(gb.items || []).map((item) => {
        const pct = Math.min(100, Math.round(((item.kitsSold || 0) / gb.minKits) * 100));
        return `<article class="card"><h3>${item.name}</h3><p>${item.size} · kit of 10 · ${money(item.price)}</p><div style="height:8px;background:#222;border-radius:99px"><div style="height:8px;width:${pct}%;background:#c8c8c8;border-radius:99px"></div></div><p class="hard">${item.kitsSold || 0} / ${gb.minKits} kits</p><button class="btn" type="button" data-gb="${item.sku}">Add kit</button></article>`;
      }).join("")}</div>
      <form id="gbOrder" class="stack" style="margin-top:22px">
        <input name="telegram" placeholder="Telegram username" />
        <label class="check"><input type="radio" name="paymentMethod" value="crypto" checked /> USDC · Solana or Ethereum</label>
        <label class="check"><input type="radio" name="paymentMethod" value="venmo" /> Venmo @fibkingpeps</label>
        <label class="check"><input type="radio" name="paymentMethod" value="cashapp" /> Cash App</label>
        <button class="btn" type="submit">Place group-buy order</button>
      </form>
      <p id="gbNote" class="hard"></p>
      <h2>Past windows</h2>
      ${(gb.archive || []).map((a) => `<p>${a.date} · ${a.title} · ${a.status} · certificate ${a.coa}</p>`).join("")}
    </section>`;
  }

  async function render() {
    if (!state.catalog) await loadBase();
    ticker();
    navActive();
    saveCart();
    renderGate();

    const p = pathOf();
    try {
      if (p === "/") {
        app.innerHTML = home();
      } else if (p === "/shop") {
        app.innerHTML = shop();
      } else if (p.startsWith("/product/")) {
        const slug = p.split("/")[2];
        const skuQ = new URLSearchParams(location.search).get("sku");
        const data = await api("/api/products/" + encodeURIComponent(skuQ || slug));
        const variants = data.variants || [];
        const extras = {
          family: data.family && data.family.family ? data.family.family : data.family,
          reviews: data.reviews || [],
          canReview: data.canReview,
        };
        const pickFrom = (sku) =>
          (sku && variants.find((v) => v.sku === sku)) ||
          variants.find((v) => v.sku === slug) ||
          data.product;
        let picked = pickFrom(skuQ);
        const mountPdp = (item, push) => {
          picked = item;
          const fam = extras.family || {};
          const canon = "/product/" + (item.familySlug || fam.slug || slug);
          const path = canon + "?sku=" + encodeURIComponent(item.sku);
          if (push) history.pushState({}, "", path);
          app.innerHTML = productView(item, data.lots, data.related, variants, extras);
          setPageMeta(
            (item.name || "Research peptide") + " | Helix King Labs",
            (item.name || "Research peptide") + " research material. Research use only. Not for human dosing, injection, or ingestion.",
            canon
          );
          setProductSchema(item, variants, canon);
          bindPdp(item, variants, mountPdp);
        };
        mountPdp(picked, false);
      } else if (p === "/certificates") {
        const q = new URLSearchParams(location.search).get("q") || "";
        const data = await api("/api/certificates" + (q ? `?q=${encodeURIComponent(q)}` : ""));
        app.innerHTML = certIndex();
      } else if (p.startsWith("/certificates/")) {
        const lot = p.split("/")[2];
        const data = await api("/api/certificates/" + encodeURIComponent(lot));
        app.innerHTML = certDetail();
      } else if (p === "/wholesale") {
        app.innerHTML = wholesalePage();
      } else if (p === "/group-buy" || p === "/group-buys") {
        state.groupBuy = await api("/api/group-buy");
        app.innerHTML = groupBuyPage(state.groupBuy);
      } else if (p === "/about") {
        app.innerHTML = about();
      } else if (p === "/library") {
        if (!state.user || !state.user.isOps) {
          app.innerHTML = `<section class="page wrap"><h1>Not found</h1><a href="/" data-link>Home</a></section>`;
        } else {
          app.innerHTML = libraryView();
        }
      } else if (p === "/affiliates") {
        if (!state.user) {
          app.innerHTML = affiliatesLocked(null);
        } else {
          const desk = await api("/api/affiliate");
          app.innerHTML = desk.locked ? affiliatesLocked(desk) : affiliatesDesk(desk);
        }
      } else if (p === "/tracking") {
        app.innerHTML = `<section class="page wrap prose">
          <div class="kicker">Tracking</div>
          <h1>Track a shipment</h1>
          <p>When fulfillment is live, the ship email carries a tracking number. Enter it here.</p>
          <form id="trackForm" class="capture" onsubmit="return false">
            <input id="trackNo" type="text" placeholder="Tracking number" />
            <button class="btn" type="submit">Look up</button>
          </form>
          <p class="lede" id="trackOut">Labels post when ops marks an order shipped and stores the tracking number. No carrier feed is attached yet.</p>
        </section>`;
      } else if (p === "/testing") {
        app.innerHTML = testing();
      } else if (p === "/tools") {
        go("/tools/calculator");
        return;
      } else if (p === "/tools/label") {
        if (!state.user || !state.user.isOps) {
          app.innerHTML = `<section class="page wrap"><h1>Not found</h1><a href="/" data-link>Home</a></section>`;
        } else {
          app.innerHTML = labelTool();
        }
      } else if (p === "/tools/calculator") {
        app.innerHTML = calcTool();
      } else if (p === "/terms") {
        app.innerHTML = policy("terms");
      } else if (p === "/shipping") {
        app.innerHTML = policy("shipping");
      } else if (p === "/privacy") {
        app.innerHTML = policy("privacy");
      } else if (p === "/do-not-sell" || p === "/do-not-sell-or-share") {
        app.innerHTML = policy("dns");
      } else if (p === "/use") {
        app.innerHTML = policy("use");
      } else if (p === "/refunds" || p === "/returns") {
        app.innerHTML = policy("refunds");
      } else if (p === "/chargebacks" || p === "/chargeback") {
        app.innerHTML = policy("chargebacks");
      } else if (p === "/magic") {
        const token = new URLSearchParams(location.search).get("token") || "";
        app.innerHTML = `<section class="page wrap"><h1>Signing in</h1><p class="lede" id="magicMsg">Checking the link.</p></section>`;
        if (!token) {
          $("#magicMsg").textContent = "This link is missing a token.";
        } else {
          api("/api/auth/magic/consume", { method: "POST", body: { token } })
            .then(async (out) => {
              state.user = out.user;
              state.gateOk = true;
              localStorage.setItem("hkl_gate", "1");
              await loadBase();
              go("/account");
            })
            .catch(() => {
              const msg = $("#magicMsg");
              if (msg) msg.textContent = "This link is expired or already used.";
            });
        }
      } else if (p.startsWith("/account/receipt/")) {
        const id = decodeURIComponent(p.split("/")[3] || "");
        const d = await api("/api/orders");
        const order = (d.orders || []).find((o) => o.id === id);
        app.innerHTML = order
          ? `<section class="page wrap prose"><div class="kicker">Receipt</div><h1>${order.id}</h1><p>${(order.created || "").slice(0, 10)} · ${order.paymentMethod || "payment"} · ${order.status} · ${order.fulfillment || "hold"}</p><p>${(order.quote.lines || []).map((l) => l.name + " " + l.size + " × " + l.qty).join("<br>")}</p><p>Total ${money(order.quote.total)}</p><p>${order.tracking ? "Tracking " + order.tracking : "Tracking posts when the label is booked."}</p><p><a href="/account" data-link>Account</a></p></section>`
          : `<section class="page wrap"><h1>Not found</h1><a href="/account" data-link>Account</a></section>`;
      } else if (p === "/account") {
        app.innerHTML = account();
        if (state.user) {
          api("/api/orders")
            .then((d) => {
              const box = $("#orderList");
              if (!box) return;
              if (!d.orders.length) {
                box.innerHTML = `<p class="muted">No recorded orders yet.</p>`;
                return;
              }
              box.innerHTML = `<h2>Orders</h2>` + d.orders.map((o) =>
                `<p class="hard"><a href="/account/receipt/${o.id}" data-link>${o.id}</a> · ${(o.created || "").slice(0, 10)} · ${money(o.quote && o.quote.total)} · ${o.paymentMethod || "payment"} · ${o.status} · ${o.fulfillment || "hold"}${o.tracking ? " · " + o.tracking : ""}</p>`
              ).join("");
            })
            .catch(() => {});
        }
      } else if (p === "/ops") {
        if (!state.user || !state.user.isOps) {
          app.innerHTML = `<section class="page wrap"><h1>Not found</h1><a href="/" data-link>Home</a></section>`;
        } else {
          const ops = await api("/api/ops/pricing");
          const board = await api("/api/ops/board").catch(() => ({ totals: {}, orders: [], affiliates: [] }));
          const t = board.totals || {};
          app.innerHTML = `<section class="page wrap">
            <div class="kicker">Seller desk</div>
            <h1>Orders, lots, and payment hold.</h1>
            <p class="lede">Customers do not see this page. ${t.orders || 0} orders · ${money(t.merchandise || 0)} merch · ${t.accounts || 0} accounts · ${t.list || 0} on the list. Nothing ships until you mark the order settled.</p>
            <p class="desk-links"><a href="/api/ops/export?kind=orders">Export orders</a> · <a href="/api/ops/export?kind=inventory">Export inventory</a> · <a href="/tools/label" data-link>Label maker</a></p>
            <h2>Orders</h2>
            <p class="lede">Settled means you confirmed Venmo or crypto finished. Shipped is refused until then. Void restores stock.</p>
            ${
              (board.orders || []).length
                ? `<table class="table"><thead><tr><th>Order</th><th>Buyer</th><th>Rail</th><th>Total</th><th>Hold</th><th>Track</th><th></th></tr></thead><tbody>${(board.orders || [])
                    .map((o) => `<tr data-oid="${o.id}">
                      <td>${o.id}<div class="sub">${(o.created || "").slice(0, 10)}</div></td>
                      <td>${o.email || ""}<div class="sub">${o.company || "—"} · ${o.researchField || "—"} · ${o.researchAck ? "ack" : "no ack"}</div></td>
                      <td>${o.paymentMethod || "—"}${o.dispute ? " · dispute" : ""}</td>
                      <td>${money((o.quote && o.quote.total) || 0)}</td>
                      <td>${o.fulfillment || o.status || ""}</td>
                      <td><input class="op-track" type="text" value="${o.tracking || ""}" placeholder="Tracking" /></td>
                      <td>
                        <button type="button" class="btn ghost op-status" data-status="settled">Settled</button>
                        <button type="button" class="btn ghost op-status" data-status="shipped">Shipped</button>
                        <button type="button" class="btn ghost op-status" data-status="voided">Void</button>
                        <button type="button" class="btn ghost op-dispute">Dispute</button>
                      </td>
                    </tr>`)
                    .join("")}</tbody></table>`
                : `<p class="lede">No recorded orders yet.</p>`
            }
            <div id="invDesk" style="margin-top:36px"></div>
            <div id="custDesk" style="margin-top:36px"></div>
            <div id="channelDesk" style="margin-top:28px"></div>
            <h2>Affiliates</h2>
            ${
              (board.affiliates || []).length
                ? `<table class="table"><thead><tr><th>Code</th><th>Email</th><th>Status</th></tr></thead><tbody>${(board.affiliates || [])
                    .map((a) => `<tr><td>${a.code}</td><td>${a.email || ""}</td><td>${a.status}</td></tr>`)
                    .join("")}</tbody></table>`
                : `<p class="lede">No desks open.</p>`
            }
            <h2>Pricing and margin</h2>
            <p class="lede">Customers see customer_price only. Unit cost stays here. Saving writes data/catalog-pricing.csv.</p>
            <div style="overflow:auto">
              <table class="table" id="opsTable">
                <thead><tr><th>SKU</th><th>Name</th><th>Size</th><th>Customer price</th><th>Unit cost</th><th>Margin</th></tr></thead>
                <tbody>
                  ${ops.rows
                    .map(
                      (r) => `<tr data-sku="${r.sku}">
                        <td>${r.sku}</td><td>${r.name}</td><td>${r.size}</td>
                        <td><input class="op-price" type="number" step="0.01" value="${r.customer_price ?? ""}" /></td>
                        <td><input class="op-cost" type="number" step="0.01" value="${r.unit_cost ?? ""}" /></td>
                        <td>${r.margin_dollars == null ? "—" : money(r.margin_dollars) + " (" + r.margin_percent + "%)"}</td>
                      </tr>`
                    )
                    .join("")}
                </tbody>
              </table>
            </div>
            <button class="btn" id="opsSave" style="margin-top:16px">Save prices</button>
            <div id="incomingList" style="margin-top:40px"></div>
            <div id="subList" style="margin-top:40px"></div>
          </section>`;
          api("/api/ops/channels").then((ch) => {
            const box = $("#channelDesk");
            if (!box) return;
            const tg = (ch.ops && ch.ops.telegram) || {};
            const cr = (ch.ops && ch.ops.crypto) || {};
            box.innerHTML = `<h2>Off-site settlement</h2>
              <p class="lede">Telegram group and Exodus stay off the shop. Paste the handle and receive address here only. Domain SMTP waits until helixkinglabs.com is live.</p>
              <div class="row-form" style="flex-direction:column;align-items:stretch;max-width:520px">
                <label>Public checkout note<textarea id="chNote" rows="3">${ch.publicNote || ""}</textarea></label>
                <label>Telegram handle (ops only)<input id="chTg" type="text" value="${tg.handle || ""}" placeholder="@group or invite — not published" /></label>
                <label>Exodus asset<input id="chAsset" type="text" value="${cr.asset || ""}" placeholder="USDT / BTC" /></label>
                <label>Exodus receive address (ops only)<input id="chAddr" type="text" value="${cr.address || ""}" placeholder="Paste when the wallet exists" /></label>
                <button class="btn" type="button" id="chSave">Save channels</button>
              </div>`;
            const save = $("#chSave");
            if (save) {
              save.onclick = async () => {
                try {
                  await api("/api/ops/channels", {
                    method: "POST",
                    body: {
                      publicNote: ($("#chNote") && $("#chNote").value) || "",
                      telegram: { handle: ($("#chTg") && $("#chTg").value) || "" },
                      crypto: {
                        asset: ($("#chAsset") && $("#chAsset").value) || "",
                        address: ($("#chAddr") && $("#chAddr").value) || "",
                      },
                    },
                  });
                  toast("Channels saved. Nothing from this form prints on the shop except the public note.");
                } catch {
                  toast("Could not save channels.");
                }
              };
            }
          }).catch(() => {});
          app.querySelectorAll(".op-status").forEach((btn) => {
            btn.onclick = async () => {
              const row = btn.closest("tr");
              if (!row) return;
              try {
                await api("/api/ops/orders", {
                  method: "POST",
                  body: {
                    id: row.getAttribute("data-oid"),
                    status: btn.getAttribute("data-status"),
                    tracking: (row.querySelector(".op-track") && row.querySelector(".op-track").value) || "",
                  },
                });
                toast("Order updated.");
                render();
              } catch (err) {
                toast(err.message === "settle_first" ? "Mark settled before shipped." : "Order update failed.");
              }
            };
          });
          app.querySelectorAll(".op-dispute").forEach((btn) => {
            btn.onclick = async () => {
              const row = btn.closest("tr");
              const note = window.prompt("Dispute note") || "";
              if (!note.trim()) return;
              try {
                await api("/api/ops/disputes", { method: "POST", body: { orderId: row.getAttribute("data-oid"), note } });
                toast("Dispute logged.");
                render();
              } catch {
                toast("Could not log dispute.");
              }
            };
          });
          api("/api/ops/desk").then((d) => {
            const inv = $("#invDesk");
            if (inv) {
              const rows = d.inventory || [];
              inv.innerHTML = `<h2>Inventory and lots</h2>
                <p class="lede">${(d.summary && d.summary.low) || 0} fills under 3 on hand. Cost can move up or down. Save writes that row. Certificate pending does not publish a file.</p>
                <div style="overflow:auto"><table class="table" id="invTable"><thead><tr><th>SKU</th><th>Name</th><th>Lot</th><th>On hand</th><th>Cost</th><th>Certificate</th><th></th></tr></thead><tbody>
                ${rows.map((r) => `<tr data-sku="${r.sku}">
                  <td>${r.sku}</td><td>${r.name} ${r.size}${r.low ? " · low" : ""}</td>
                  <td><input class="inv-lot" value="${r.lot || ""}" /></td>
                  <td><input class="inv-hand" type="number" min="0" value="${r.on_hand}" /></td>
                  <td><input class="inv-cost" type="number" step="0.01" value="${r.unit_cost ?? ""}" /></td>
                  <td><select class="inv-cert"><option ${r.certificate !== "accepted" ? "selected" : ""}>pending</option><option ${r.certificate === "accepted" ? "selected" : ""}>accepted</option></select></td>
                  <td><button type="button" class="btn ghost inv-save">Save</button></td>
                </tr>`).join("")}
                </tbody></table></div>`;
              inv.querySelectorAll(".inv-save").forEach((btn) => {
                btn.onclick = async () => {
                  const row = btn.closest("tr");
                  try {
                    await api("/api/ops/inventory", { method: "POST", body: {
                      sku: row.getAttribute("data-sku"),
                      lot: row.querySelector(".inv-lot").value,
                      on_hand: row.querySelector(".inv-hand").value,
                      unit_cost: row.querySelector(".inv-cost").value,
                      certificate: row.querySelector(".inv-cert").value,
                    }});
                    toast("Lot saved.");
                  } catch {
                    toast("Could not save lot.");
                  }
                };
              });
            }
            const cust = $("#custDesk");
            if (cust) {
              const rows = d.customers || [];
              cust.innerHTML = `<h2>Accounts</h2>` + (rows.length
                ? `<table class="table"><thead><tr><th>Email</th><th>Company</th><th>Field</th><th>Orders</th></tr></thead><tbody>${rows.map((c) => `<tr><td>${c.email}</td><td>${c.company || "—"}</td><td>${c.researchField || "—"}</td><td>${c.orders}</td></tr>`).join("")}</tbody></table>`
                : `<p class="lede">No accounts yet.</p>`);
            }
          }).catch(() => {});
          api("/api/ops/incoming-coas").then((d) => {
            const box = $("#incomingList");
            if (!box) return;
            const rows = d.records || [];
            box.innerHTML = `<h2>Incoming supplier COAs</h2>
              <p class="lede">${d.lab || "Bioviridian"} · ${rows.length} files in data/coas/incoming. Not published on /testing. DSIP 5mg is non-conforming. TSM20 certificate is filed even though TSM20 is off the catalog. Glutathione 1500 and DSIP stay off the shop.</p>` +
              (rows.length
                ? `<table class="table"><thead><tr><th>Code</th><th>Sample</th><th>Lot</th><th>Purity</th><th>Status</th><th>Hint</th><th>File</th></tr></thead><tbody>${rows.map((r)=>`<tr><td>${r.webCode||""}</td><td>${r.sample||""}</td><td>${r.lot||""}</td><td>${r.purity==null?"—":r.purity+"%"}</td><td>${r.status||""}</td><td>${r.helixSkuHint||"—"}</td><td><a href="/api/ops/incoming-coas/${r.webCode}" target="_blank" rel="noopener">PDF</a></td></tr>`).join("")}</tbody></table>`
                : `<p class="muted">No incoming files indexed.</p>`);
          }).catch(()=>{});
          api("/api/ops/subscribers").then((d) => {
            const box = $("#subList");
            if (!box) return;
            const rows = d.captures || [];
            box.innerHTML = `<h2>Email list</h2><p class="lede">${rows.length} addresses. Written to data/subscribers.csv. Outbox queued in data/outbox.json.</p>` +
              (rows.length
                ? `<table class="table"><thead><tr><th>Email</th><th>Source</th><th>When</th></tr></thead><tbody>${rows.map((c)=>`<tr><td>${c.email}</td><td>${c.source||""}</td><td>${(c.created||"").slice(0,19)}</td></tr>`).join("")}</tbody></table>`
                : `<p class="muted">No subscribers yet.</p>`);
          }).catch(()=>{});
        }
      } else if (p === "/cart") {
        let quote = null;
        if (state.user && state.cart.length) {
          quote = await api("/api/cart/quote", { method: "POST", body: { items: state.cart, affiliateCode: state.aff, paymentMethod: state.payMethod } });
        }
        app.innerHTML = cartView(quote);
      } else {
        app.innerHTML = `<section class="page wrap"><h1>Not found</h1><a href="/" data-link>Home</a></section>`;
      }
    } catch (err) {
      app.innerHTML = `<section class="page wrap"><h1>Unavailable</h1><p class="lede">${err.message}</p></section>`;
    }

    bindGlobal();
    bindTools();
    applyPageMeta(p);
    renderConsent();
    maybePopup();
  }

  function applyPageMeta(p) {
    if (p && p.startsWith("/product/")) return;
    const map = {
      "/": ["Helix King Labs — Premium research peptides", "Premium research peptides with a lot on the vial. Research use only. Not a clinic. Not a pharmacy."],
      "/shop": ["Research peptide catalog — Helix King Labs", "Premium research peptides. List prices after the age gate. Account required to purchase."],
      "/about": ["About Helix King Labs", "U.S. research catalog. Documented peptides, lot QR on the vial. Not a clinic. Not a pharmacy."],
      "/certificates": ["Certificates of analysis — Helix King Labs", "Lot certificates publish when a research lot is accepted. Search by lot or compound."],
      "/testing": ["Peptide testing methods — Helix King Labs", "Intended testing panel for research peptides. Lot files attach when a lot clears."],
      "/tools": ["Research calculator — Helix King Labs", "Concentration arithmetic for research vials. Not a protocol."],
      "/tools/calculator": ["Research calculator — Helix King Labs", "Concentration arithmetic for research vials. Not a protocol. Not mixed product."],
      "/terms": ["Terms and conditions — Helix King Labs", "Use and purchase terms for helixkinglabs.com. Research materials only. Kentucky law."],
      "/privacy": ["Privacy notice — Helix King Labs", "What Helix King Labs collects on the account, the order, and measurement tags."],
      "/do-not-sell": ["Do not sell or share — Helix King Labs", "Helix King Labs does not sell personal information. Opt out of measurement here."],
      "/refunds": ["Refund and returns — Helix King Labs", "All sales final. Seven-day window for missing, incorrect, or damaged shipments."],
      "/chargebacks": ["Chargeback policy — Helix King Labs", "Contact Helix King Labs before a payment dispute. Crypto and Venmo rails."],
      "/shipping": ["Shipping policy — Helix King Labs", "Shipping $9.95. Free at $199 merchandise after discounts. Dried research vials only."],
      "/use": ["Permitted use — Helix King Labs", "21+. Research materials only. Not for human or animal consumption."],
    };
    const row = map[p] || ["Helix King Labs", "Premium research peptides. Research use only."];
    setPageMeta(row[0], row[1], p === "/" ? "/" : p);
  }

  function consentState() {
    try {
      return JSON.parse(localStorage.getItem("hkl_consent") || "null");
    } catch {
      return null;
    }
  }

  function gpcRefused() {
    return typeof navigator !== "undefined" && navigator.globalPrivacyControl === true;
  }

  function loadMeasurement() {
    const ga = window.HKL_GA_MEASUREMENT_ID || "";
    const pixel = window.HKL_META_PIXEL_ID || "";
    if (ga && !document.getElementById("hkl-ga")) {
      const s = document.createElement("script");
      s.id = "hkl-ga";
      s.async = true;
      s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(ga);
      document.head.appendChild(s);
      window.dataLayer = window.dataLayer || [];
      window.gtag = function () { window.dataLayer.push(arguments); };
      window.gtag("js", new Date());
      window.gtag("config", ga, { anonymize_ip: true });
    }
    if (pixel && !document.getElementById("hkl-meta")) {
      const s = document.createElement("script");
      s.id = "hkl-meta";
      s.text = "!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','" + pixel + "');fbq('track','PageView');";
      document.head.appendChild(s);
    }
  }

  function renderConsent() {
    const box = $("#consent");
    if (!box) return;
    let pref = consentState();
    if (gpcRefused()) {
      pref = { analytics: false, at: new Date().toISOString(), gpc: true };
      localStorage.setItem("hkl_consent", JSON.stringify(pref));
    }
    if (pref && pref.analytics) loadMeasurement();
    if (pref) {
      box.classList.add("hidden");
      box.innerHTML = "";
      return;
    }
    box.classList.remove("hidden");
    box.innerHTML = `<p>A necessary cookie keeps the gate, the cart, and the account. Optional measurement is off until you allow it. <a href="/privacy" data-link>Privacy notice</a>.</p>
      <div class="consent-actions">
        <button class="btn" type="button" id="cAccept">Accept analytics</button>
        <button class="btn ghost" type="button" id="cReject">Necessary only</button>
      </div>`;
    if ($("#cAccept")) {
      $("#cAccept").onclick = () => {
        localStorage.setItem("hkl_consent", JSON.stringify({ analytics: true, at: new Date().toISOString() }));
        loadMeasurement();
        box.classList.add("hidden");
      };
    }
    if ($("#cReject")) {
      $("#cReject").onclick = () => {
        localStorage.setItem("hkl_consent", JSON.stringify({ analytics: false, at: new Date().toISOString() }));
        box.classList.add("hidden");
      };
    }
  }

  function bindGlobal() {
    const footer = $("#footerCapture");
    if (footer && !footer.dataset.bound) {
      footer.dataset.bound = "1";
      footer.addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
          await capture(new FormData(footer).get("email"), "footer");
          footer.reset();
        } catch {
          toast("Use a valid email.");
        }
      });
    }

    const homeCap = $("#homeCapture");
    if (homeCap) {
      homeCap.addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
          await capture(new FormData(homeCap).get("email"), "home");
          homeCap.reset();
        } catch {
          toast("Use a valid email.");
        }
      });
    }

    const certSearch = $("#certSearch");
    if (certSearch) {
      certSearch.addEventListener("submit", (e) => {
        e.preventDefault();
        const q = new FormData(certSearch).get("q");
        go("/certificates?q=" + encodeURIComponent(q));
      });
    }

    const gateForm = $("#gateForm");
    if (gateForm) {
      gateForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(gateForm);
        if (!fd.get("age") || !fd.get("terms")) {
          $("#gateErr").textContent = "Both confirmations are required.";
          return;
        }
        const email = fd.get("email");
        if (email) {
          try {
            await capture(email, "gate");
          } catch {}
        }
        state.gateOk = true;
        localStorage.setItem("hkl_gate", "1");
        renderGate();
      });
    }
    const gateGoogle = $("#gateGoogle");
    if (gateGoogle) {
      gateGoogle.onclick = async () => {
        const form = $("#gateForm");
        const fd = new FormData(form);
        if (!fd.get("age") || !fd.get("terms")) {
          $("#gateErr").textContent = "Both confirmations are required.";
          return;
        }
        try {
          const out = await signInGoogle(true, true);
          state.user = out.user;
          state.gateOk = true;
          localStorage.setItem("hkl_gate", "1");
          toast(out.demo ? "Google is demo on this host. Email/password is live." : "Signed in with Google.");
          await loadBase();
          render();
        } catch (err) {
          $("#gateErr").textContent =
            err.message === "google_not_configured"
              ? "Add GOOGLE_CLIENT_ID on the server to finish Google."
              : err.message === "google_cancelled"
                ? "Google window closed."
                : "Google sign-in failed.";
        }
      };
    }
    const gateApple = $("#gateApple");
    if (gateApple) {
      gateApple.onclick = async () => {
        const form = $("#gateForm");
        const fd = new FormData(form);
        if (!fd.get("age") || !fd.get("terms")) {
          $("#gateErr").textContent = "Both confirmations are required.";
          return;
        }
        try {
          const out = await signInApple(true, true);
          state.user = out.user;
          state.gateOk = true;
          localStorage.setItem("hkl_gate", "1");
          toast("Signed in with Apple.");
          await loadBase();
          render();
        } catch (err) {
          $("#gateErr").textContent =
            err.message === "apple_not_configured" ? "Apple is not configured on this host." : "Apple sign-in failed.";
        }
      };
    }

    const pop = $("#popCapture");
    if (pop) {
      pop.addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
          await capture(new FormData(pop).get("email"), "popup");
        } catch {
          toast("Use a valid email.");
        }
      });
    }
    const dismiss = $("#popDismiss");
    if (dismiss) dismiss.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      dismissPopup();
    };
    const reviewForm = $("#reviewForm");
    if (reviewForm) {
      reviewForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(reviewForm);
        try {
          await api("/api/reviews", {
            method: "POST",
            body: {
              sku: reviewForm.dataset.sku,
              rating: fd.get("rating"),
            },
          });
          toast("Rating saved.");
          render();
        } catch (err) {
          toast(err.message === "verified_purchase_required" ? "Order this fill first." : err.message);
        }
      });
    }
    const opsSave = $("#opsSave");
    if (opsSave) {
      opsSave.onclick = async () => {
        const rows = [...document.querySelectorAll("#opsTable tbody tr")].map((tr) => ({
          sku: tr.dataset.sku,
          customer_price: tr.querySelector(".op-price").value,
          unit_cost: tr.querySelector(".op-cost").value,
        }));
        try {
          await api("/api/ops/pricing", { method: "POST", body: { rows } });
          toast("Prices saved to catalog-pricing.csv");
          await loadBase();
          render();
        } catch (err) {
          toast(err.message);
        }
      };
    }
    const popupEl = $("#popup");
    if (popupEl && !popupEl.dataset.bound) {
      popupEl.dataset.bound = "1";
      popupEl.addEventListener("click", (e) => {
        if (e.target.closest(".popup-card")) return;
        dismissPopup();
      });
    }

    const reg = $("#regForm");
    if (reg) {
      reg.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(reg);
        try {
          const out = await api("/api/auth/register", {
            method: "POST",
            body: {
              name: fd.get("name"),
              email: fd.get("email"),
              password: fd.get("password"),
              age: !!fd.get("age"),
              terms: !!fd.get("terms"),
              company: fd.get("company"),
              researchField: fd.get("researchField"),
              researchAck: !!fd.get("researchAck"),
            },
          });
          state.user = out.user;
          state.gateOk = true;
          localStorage.setItem("hkl_gate", "1");
          toast("Account open. HELIX10 is attached.");
          await loadBase();
          go("/shop");
        } catch (err) {
          $("#regErr").textContent =
            err.message === "exists" ? "That email already has an account." : err.message;
        }
      });
    }
    async function finishSocial(out, errBox) {
      if (!out) return;
      state.user = out.user;
      state.gateOk = true;
      localStorage.setItem("hkl_gate", "1");
      toast(out.demo ? "Google is demo on this host. Email/password is live." : "Signed in.");
      await loadBase();
      go("/shop");
      if (errBox) errBox.textContent = "";
    }
    const googleBtn = $("#googleBtn");
    if (googleBtn) {
      googleBtn.onclick = async () => {
        const form = $("#regForm");
        const fd = form ? new FormData(form) : null;
        if (!fd || !fd.get("age") || !fd.get("terms")) {
          $("#regErr").textContent = "Confirm age and terms before Google.";
          return;
        }
        try {
          await finishSocial(await signInGoogle(true, true));
        } catch (err) {
          $("#regErr").textContent =
            err.message === "google_cancelled" ? "Google window closed." : "Google sign-in failed.";
        }
      };
    }
    const appleBtn = $("#appleBtn");
    if (appleBtn) {
      appleBtn.onclick = async () => {
        const form = $("#regForm");
        const fd = form ? new FormData(form) : null;
        if (!fd || !fd.get("age") || !fd.get("terms")) {
          $("#regErr").textContent = "Confirm age and terms before Apple.";
          return;
        }
        try {
          await finishSocial(await signInApple(true, true));
        } catch {
          $("#regErr").textContent = "Apple sign-in failed.";
        }
      };
    }
    const googleLoginBtn = $("#googleLoginBtn");
    if (googleLoginBtn) {
      googleLoginBtn.onclick = async () => {
        try {
          await finishSocial(await signInGoogle(false, false));
        } catch (err) {
          $("#loginErr").textContent =
            err.message === "confirmations_required"
              ? "First Google login: use Create account and accept terms."
              : "Google sign-in failed.";
        }
      };
    }
    const appleLoginBtn = $("#appleLoginBtn");
    if (appleLoginBtn) {
      appleLoginBtn.onclick = async () => {
        try {
          await finishSocial(await signInApple(false, false));
        } catch (err) {
          $("#loginErr").textContent =
            err.message === "confirmations_required"
              ? "First Apple login: use Create account and accept terms."
              : "Apple sign-in failed.";
        }
      };
    }
    const login = $("#loginForm");
    if (login) {
      login.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(login);
        try {
          const out = await api("/api/auth/login", {
            method: "POST",
            body: { email: fd.get("email"), password: fd.get("password") },
          });
          state.user = out.user;
          await loadBase();
          go("/shop");
        } catch (err) {
          $("#loginErr").textContent = "Check the email and password.";
        }
      });
    }
    const logoutBtn = $("#logoutBtn");
    if (logoutBtn) {
      logoutBtn.onclick = async () => {
        await api("/api/auth/logout", { method: "POST", body: {} });
        state.user = null;
        state.cart = [];
        paintCartCount();
        toast("Signed out.");
        render();
      };
    }
    const profile = $("#profileForm");
    if (profile) {
      profile.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(profile);
        try {
          const out = await api("/api/account", { method: "POST", body: {
            name: fd.get("name"),
            email: fd.get("email"),
            company: fd.get("company"),
            researchField: fd.get("researchField"),
            phone: fd.get("phone"),
            address: { line1: fd.get("line1"), city: fd.get("city"), region: fd.get("region"), postal: fd.get("postal") },
            emailOptIn: !!fd.get("emailOptIn"),
          }});
          state.user = out.user;
          toast("Profile saved.");
          render();
        } catch (err) {
          toast(err.message === "exists" ? "That email is already an account." : "Could not save profile.");
        }
      });
    }
    const magicBtn = $("#magicBtn");
    if (magicBtn) {
      magicBtn.onclick = async () => {
        const email = (document.querySelector("#loginForm input[name=email]") || {}).value || "";
        if (!email) return toast("Enter the email first.");
        try {
          const out = await api("/api/auth/magic", { method: "POST", body: { email } });
          toast(out.sent ? "Sign-in link sent." : "Link queued. Mail sends when orders@ is connected on the server.");
        } catch {
          toast("Could not send the link.");
        }
      };
    }
    async function passkeyLogin() {
      if (!window.PublicKeyCredential) return toast("This browser has no passkey.");
      const opts = await api("/api/auth/passkey/login/options", { method: "POST", body: {} });
      const cred = await navigator.credentials.get({ publicKey: {
        challenge: Uint8Array.from(atob(opts.challenge.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)),
        timeout: opts.timeout,
        rpId: opts.rpId,
        userVerification: opts.userVerification,
      }});
      const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
      const out = await api("/api/auth/passkey/login", { method: "POST", body: {
        id: cred.id,
        clientDataJSON: b64(cred.response.clientDataJSON),
        authenticatorData: b64(cred.response.authenticatorData),
        signature: b64(cred.response.signature),
      }});
      state.user = out.user;
      state.gateOk = true;
      localStorage.setItem("hkl_gate", "1");
      await loadBase();
      go("/account");
    }
    const passkeyBtn = $("#passkeyBtn");
    if (passkeyBtn) passkeyBtn.onclick = () => passkeyLogin().catch(() => toast("Passkey was not accepted."));
    const passkeyAdd = $("#passkeyAdd");
    if (passkeyAdd) {
      passkeyAdd.onclick = async () => {
        if (!window.PublicKeyCredential) return toast("This browser has no passkey.");
        try {
          const opts = await api("/api/auth/passkey/register/options", { method: "POST", body: {} });
          const toBuf = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
          const cred = await navigator.credentials.create({ publicKey: {
            challenge: toBuf(opts.challenge),
            rp: opts.rp,
            user: { id: toBuf(btoa(opts.user.id)), name: opts.user.name, displayName: opts.user.displayName },
            pubKeyCredParams: opts.pubKeyCredParams,
            timeout: opts.timeout,
            authenticatorSelection: opts.authenticatorSelection,
          }});
          const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
          const key = cred.response.getPublicKey && cred.response.getPublicKey();
          if (!key) return toast("This browser did not return a passkey.");
          const out = await api("/api/auth/passkey/register", { method: "POST", body: { id: cred.id, clientDataJSON: b64(cred.response.clientDataJSON), publicKey: b64(key) } });
          state.user = out.user;
          toast("Passkey saved on this account.");
        } catch {
          toast("Passkey was not saved.");
        }
      };
    }

    document.querySelectorAll("[data-remove]").forEach((btn) => {
      btn.onclick = () => {
        state.cart = state.cart.filter((l) => l.id !== btn.dataset.remove);
        saveCart();
        render();
      };
    });
    document.querySelectorAll("[data-qty-delta]").forEach((btn) => {
      btn.onclick = () => {
        const id = btn.getAttribute("data-qty-delta");
        const delta = Number(btn.getAttribute("data-delta") || 0);
        const line = state.cart.find((l) => l.id === id);
        if (!line) return;
        const item = state.catalog.items.find((x) => x.id === id);
        const cap = item && (item.available != null ? Number(item.available) : Number(item.stock || 0));
        const next = line.qty + delta;
        if (next < 1) {
          state.cart = state.cart.filter((l) => l.id !== id);
        } else if (cap != null && cap >= 0 && next > cap) {
          line.qty = cap;
          toast("That is the on-hand quantity.");
        } else {
          line.qty = next;
        }
        saveCart();
        render();
      };
    });

    const affApply = $("#affApply");
    if (affApply) {
      affApply.addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
          await api("/api/affiliate/apply", { method: "POST", body: { agree: true } });
          await loadBase();
          toast("Desk open.");
          go("/affiliates");
        } catch (err) {
          toast(err.message === "order_required" ? "Record an order first." : err.message);
        }
      });
    }

    const trackForm = $("#trackForm");
    if (trackForm) {
      trackForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const n = ($("#trackNo") && $("#trackNo").value) || "";
        const out = $("#trackOut");
        if (!out) return;
        if (!n.trim()) {
          out.textContent = "Enter the number from the ship note.";
          return;
        }
        api("/api/tracking?q=" + encodeURIComponent(n.trim()))
          .then((d) => {
            out.textContent = d.found
              ? `${d.orderId} · ${d.status}${d.shippedAt ? " · booked " + d.shippedAt.slice(0, 10) : ""}`
              : d.message || "No shipment under that number yet.";
          })
          .catch(() => {
            out.textContent = "Lookup unavailable.";
          });
      });
    }

    const affInput = $("#affCode");
    if (affInput) {
      affInput.onchange = affInput.onkeydown = (e) => {
        if (e.type === "keydown" && e.key !== "Enter") return;
        e.preventDefault();
        const code = String(affInput.value || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 16);
        state.aff = code.length >= 3 ? code : "";
        if (state.aff) localStorage.setItem("hkl_aff", state.aff);
        else localStorage.removeItem("hkl_aff");
        render();
      };
    }

    const payForm = $("#payForm");
    if (payForm) {
      payForm.addEventListener("change", (e) => {
        if (e.target && e.target.name === "paymentMethod") {
          state.payMethod = e.target.value;
          render();
        }
      });
      payForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(payForm);
        try {
          const out = await api("/api/checkout", {
            method: "POST",
            body: {
              items: state.cart,
              affiliateCode: state.aff,
              company: fd.get("company"),
              researchField: fd.get("researchField"),
              researchAck: !!fd.get("researchAck"),
              paymentMethod: fd.get("paymentMethod"),
            },
          });
          const order = out.order || {};
          const pay = order.payment || {};
          state.cart = [];
          saveCart();
          const box = $("#orderDone");
          if (box) {
            box.innerHTML = pay.invoiceUrl
              ? `<p class="lede">${order.id} recorded. <a href="${pay.invoiceUrl}">Pay with crypto</a>. The order ships when the payment is finished.</p>`
              : pay.provider === "venmo"
                ? `<p class="lede">${order.id} recorded. Venmo @fibkingpeps the total ${money(order.quote && order.quote.total)}. Put ${order.id} in the note. We confirm before anything ships.</p>`
                : `<p class="lede">${order.id} recorded. Crypto invoice is pending the processor key. Nothing ships until payment is finished.</p>`;
          }
          toast("Order recorded. Payment still open.");
        } catch (err) {
          toast(err.message || "Checkout failed");
        }
      });
    }
    const navToggle = $("#navToggle");
    if (navToggle && !navToggle.dataset.bound) {
      navToggle.dataset.bound = "1";
      navToggle.addEventListener("click", () => {
        const nav = document.querySelector(".nav");
        if (!nav) return;
        const open = nav.classList.toggle("open");
        navToggle.setAttribute("aria-expanded", open ? "true" : "false");
      });
    }
  }

  loadBase()
    .then(render)
    .catch((err) => {
      app.innerHTML = `<section class="page wrap"><h1>Shell unavailable</h1><p class="lede">${err.message}</p></section>`;
    });
})();

document.addEventListener("submit", async (e) => {
  if (e.target && e.target.id === "gbGate") {
    e.preventDefault();
    if (new FormData(e.target).get("password") === "HELIXGB") {
      sessionStorage.setItem("hkl-gb", "1");
      render();
    }
  }
  if (e.target && e.target.id === "wholesaleForm") {
    e.preventDefault();
    const fd = new FormData(e.target);
    const res = await api("/api/wholesale", { method: "POST", body: Object.fromEntries(fd.entries()) });
    const note = document.getElementById("wholesaleNote");
    if (note) note.textContent = res.request ? "Request " + res.request.id + " saved. Email wholesale@helixkinglabs.com to finish it." : "Request failed.";
  }
  if (e.target && e.target.id === "gbOrder") {
    e.preventDefault();
    const fd = new FormData(e.target);
    const items = (state.gbCart || []).map((l) => ({ sku: l.sku, qty: l.qty }));
    const res = await api("/api/group-buy/order", { method: "POST", body: { password: "HELIXGB", items, telegram: fd.get("telegram"), paymentMethod: fd.get("paymentMethod") } });
    const note = document.getElementById("gbNote");
    if (note) note.textContent = res.order ? res.order.id + " recorded. Shipping $20. A line holds until it hits 5 kits and payment is confirmed." : (res.error || "Order failed.");
  }
});
document.addEventListener("click", (e) => {
  const btn = e.target && e.target.closest && e.target.closest("[data-gb]");
  if (!btn) return;
  state.gbCart = state.gbCart || [];
  const sku = btn.getAttribute("data-gb");
  const line = state.gbCart.find((l) => l.sku === sku);
  if (line) line.qty += 1;
  else state.gbCart.push({ sku, qty: 1 });
  const note = document.getElementById("gbNote");
  if (note) note.textContent = state.gbCart.map((l) => l.sku + " x " + l.qty).join(", ");
});
