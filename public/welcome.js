/* Helix King Labs — /welcome landing page. Loaded before app.js; uses window.HKL at runtime. */
(function () {
  var ORIGIN = (window.HKL_PUBLIC_ORIGIN || "https://helixkinglabs.com").replace(/\/$/, "");

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function featuredFamilies() {
    var HKL = window.HKL || {};
    var catalog = (HKL.state && HKL.state.catalog) || {};
    var fams = (catalog.families || []).filter(function (f) {
      return f.featured && f.shopVisible !== false;
    });
    return fams.slice(0, 6);
  }

  function familyPrice(f) {
    var HKL = window.HKL || {};
    var catalog = (HKL.state && HKL.state.catalog) || {};
    var items = catalog.skuIndex || catalog.items || {};
    var prices = [];
    (f.variantIds || []).forEach(function (vid) {
      var it = items[vid];
      if (it && it.shopVisible !== false && it.price != null) prices.push(Number(it.price));
    });
    if (!prices.length && Array.isArray(items)) {
      items.forEach(function (it) {
        if (it && it.shopVisible !== false && it.price != null && (it.familyId === f.id || (f.variantIds || []).indexOf(it.id) >= 0)) prices.push(Number(it.price));
      });
    }
    return prices.length ? Math.min.apply(null, prices) : null;
  }

  function productCards() {
    var fams = featuredFamilies();
    if (!fams.length) return "";
    return fams.map(function (f) {
      var price = familyPrice(f);
      var slug = f.slug || f.id;
      var img = f.cardImage || f.image || "/img/logo.jpg";
      return `<a class="welcome-card" href="/product/${esc(slug)}" data-link>
        <img src="${esc(img)}" alt="${esc(f.name)} research peptide" loading="lazy" />
        <div class="welcome-card-body">
          <h3>${esc(f.name)}</h3>
          <p class="welcome-price">${price != null ? "from $" + price : "See price"}</p>
          <span class="welcome-card-cta">View lot &amp; COA</span>
        </div>
      </a>`;
    }).join("");
  }

  function setSchema(fams) {
    var items = fams.map(function (f, i) {
      var price = familyPrice(f);
      return {
        "@type": "ListItem",
        position: i + 1,
        item: {
          "@type": "Product",
          name: f.name + " — research peptide",
          brand: { "@type": "Brand", name: "Helix King Labs" },
          url: ORIGIN + "/product/" + (f.slug || f.id),
          description: (f.blurb || f.name + " research material.").slice(0, 200),
          offers: price != null ? { "@type": "Offer", priceCurrency: "USD", price: price, availability: "https://schema.org/InStock" } : undefined,
        },
      };
    });
    var schema = {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "WebPage",
          name: "Welcome — Lab-Tested Research Peptides | Helix King Labs",
          url: ORIGIN + "/welcome",
          description: "New to Helix King Labs? Browse lab-tested research peptides with lot QR codes and certificates of analysis.",
        },
        { "@type": "ItemList", name: "Featured research peptides", itemListElement: items },
      ],
    };
    var el = document.getElementById("hkl-schema");
    if (!el) {
      el = document.createElement("script");
      el.id = "hkl-schema";
      el.type = "application/ld+json";
      document.head.appendChild(el);
    }
    el.textContent = JSON.stringify(schema);
  }

  function page() {
    var fams = featuredFamilies();
    setSchema(fams);
    return `<section class="page welcome">
      <div class="wrap">
        <div class="welcome-hero">
          <div class="kicker">Welcome to Helix King Labs</div>
          <h1>Lab-tested research peptides, with the lot on the vial.</h1>
          <p class="lede">Every vial on this catalog is labeled with the compound name, fill, and lot. Lots clear a written testing panel before they ship, and certificates of analysis publish on this domain. Scan the QR on the vial — it opens here, not a third-party lab page.</p>
          <div class="welcome-ctas">
            <a class="btn" href="/shop" data-link>Browse the catalog</a>
            <a class="btn ghost" href="/account" data-link>Create an account</a>
          </div>
          <p class="welcome-note">21+. Research use only. An account is required to purchase. First orders over $99 take HELIX10.</p>
        </div>

        <h2>Featured research compounds</h2>
        <p class="lede">A starting point from the current catalog. Every compound below ships with lot documentation.</p>
        <div class="welcome-grid">${productCards()}</div>

        <h2>Why researchers choose Helix King Labs</h2>
        <div class="welcome-points">
          <div><h3>Lot QR on every vial</h3><p>Scan the vial and land on its lot record — compound, fill, and certificate. No guessing which lot you received.</p></div>
          <div><h3>Certificates publish here</h3><p>COAs go live on helixkinglabs.com when a lot is accepted. Searchable by lot or compound on /testing.</p></div>
          <div><h3>Written testing panel</h3><p>Lots are held to a documented panel before release. Non-conforming lots never reach the catalog.</p></div>
          <div><h3>Documentation library</h3><p>Reference materials for laboratory planning. The email list gets lot alerts and restock notices.</p></div>
        </div>

        <h2>How ordering works</h2>
        <ol class="welcome-steps">
          <li><strong>Browse the catalog.</strong> List prices show after the age gate. Filter by category or search a compound.</li>
          <li><strong>Create an account.</strong> Email sign-in, magic link, or passkey. 21+ and permitted-use terms required.</li>
          <li><strong>Check out.</strong> Crypto via NOWPayments, or manual Venmo / Cash App. Tracking posts to your account.</li>
        </ol>

        <h2>Common questions</h2>
        <div class="welcome-faq">
          <div><h3>Are your peptides lab-tested?</h3><p>Yes. Every lot clears a written testing panel and its certificate of analysis publishes on this site before the lot ships.</p></div>
          <div><h3>How do I verify my vial?</h3><p>Scan the QR code on the vial. It opens the lot record on helixkinglabs.com with the compound, fill, and COA.</p></div>
          <div><h3>Do I need an account to see prices?</h3><p>List prices show after the 21+ age gate. An account is required to purchase.</p></div>
          <div><h3>How fast is shipping?</h3><p>Orders ship dried research vials only. Tracking posts to your account when the label is created.</p></div>
          <div><h3>What is the email list for?</h3><p>Lot alerts, restocks, and group buys. One-click unsubscribe in every email. We do not sell the list.</p></div>
        </div>

        <div class="welcome-final">
          <h2>Ready when you are.</h2>
          <p class="lede">The catalog is open. The library is open. Come see the lots.</p>
          <div class="welcome-ctas">
            <a class="btn" href="/shop" data-link>Open the catalog</a>
            <a class="btn ghost" href="/library" data-link>Documentation library</a>
          </div>
        </div>

        <p class="welcome-fine">All products sold on this website are intended for research and identification purposes only. These products are not intended for human dosing, injection, or ingestion. 21+ only. Helix King Labs is not a clinic and not a pharmacy.</p>
      </div>
    </section>`;
  }

  window.HKL_WELCOME = { page: page };
})();
