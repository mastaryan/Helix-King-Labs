"use strict";

// Static file serving + SEO (sitemap, page models, document injection).
// Factory pattern matches email-list.js — dependencies are injected so
// server.js stays under the GitHub push size limit.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const COMPOUND_NAMES = {
  "pgl-gic1": "Retatrutide",
  "pgl-gi1": "Tirzepatide",
  "pgl-g1": "Semaglutide",
  "pgl-el1": "Eloralintide",
  "cgl-1": "Cagrilintide",
  "pgl-el1-pair": "Eloralintide + Tirzepatide",
  "pgl-sr1": "Semaglutide",
};

function createStaticServe({ PUBLIC, MIME, products, copyDeck, familyVisibleOf, shopVisibleOf, secHandle, sessionUser, isOpsUser }) {
  function escHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "\u0026amp;")
      .replace(/</g, "\u0026lt;")
      .replace(/>/g, "\u0026gt;")
      .replace(/"/g, "\u0026quot;");
  }

  function shopFamilies() {
    return (products.families || []).filter((f) => familyVisibleOf(f));
  }

  function familyItems(f) {
    return products.items.filter((it) => it.family === f.id && shopVisibleOf(it));
  }

  function knownPaths() {
    const paths = new Set([
      "/",
      "/shop",
      "/about",
      "/certificates",
      "/testing",
      "/tools",
      "/tools/calculator",
      "/reset-2fa",
      "/terms",
      "/privacy",
      "/do-not-sell",
      "/do-not-sell-or-share",
      "/shipping",
      "/refunds",
      "/returns",
      "/chargebacks",
      "/chargeback",
      "/use",
      "/wholesale",
      "/group-buy",
      "/group-buys",
      "/account",
      "/cart",
      "/ops",
      "/ops/catalog",
      "/unsubscribe",
      "/welcome",
      "/library",
    ]);
    for (const f of shopFamilies()) paths.add("/product/" + (f.slug || f.id));
    return paths;
  }

  function pageModel(pathname) {
    const origin = "https://helixkinglabs.com";
    if (pathname === "/") {
      return {
        title: "Helix King Labs — Premium research peptides",
        description: "Premium research peptides with a lot on the vial. Research use only. Not a clinic. Not a pharmacy.",
        canonical: origin + "/",
        h1: "Premium research peptides.",
        body: "<p>Research-use materials only. Not for human or animal consumption.</p>",
        schema: {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: (copyDeck.faq || []).map((f) => ({
            "@type": "Question",
            name: f.q,
            acceptedAnswer: { "@type": "Answer", text: f.a },
          })),
        },
      };
    }
    if (pathname === "/shop") {
      const GLP_ORDER = ["pgl-gic1", "pgl-gi1", "pgl-g1", "pgl-el1", "cgl-1", "pgl-el1-pair", "pgl-sr1"];
      const glpRank = (f) => {
        const i = GLP_ORDER.indexOf(f.id);
        return i < 0 ? 999 : i;
      };
      const cards = shopFamilies()
        .sort((a, b) => glpRank(a) - glpRank(b))
        .map((f) => {
          const items = familyItems(f).filter((it) => it.price != null && it.releaseState !== "pending_testing");
          const from = items.length ? Math.min(...items.map((it) => Number(it.price))) : null;
          const price = from != null ? "From $" + from : "Certificate pending";
          return `<li><a href="/product/${escHtml(f.slug || f.id)}">${escHtml(f.name)}</a> — ${escHtml(price)}</li>`;
        })
        .join("");
      return {
        title: "Research peptide catalog — Helix King Labs",
        description: "Premium research peptides. List prices after the age gate. Account required to purchase. Research use only.",
        canonical: origin + "/shop",
        h1: "Research catalog",
        body: `<ul>${cards}</ul>`,
      };
    }
    if (pathname.startsWith("/product/")) {
      const slug = pathname.split("/")[2];
      const fam = shopFamilies().find((f) => f.slug === slug || f.id === slug);
      if (!fam) return null;
      const items = familyItems(fam);
      const live = items.filter((it) => it.price != null && it.releaseState !== "pending_testing");
      const offers = live.map((it) => ({
        "@type": "Offer",
        sku: it.sku,
        price: Number(it.price),
        priceCurrency: "USD",
        availability: Number(it.available || it.stock || 0) > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
        url: origin + "/product/" + (fam.slug || fam.id),
      }));
      const sizes = items.map((it) => `${escHtml(it.size)} · $${escHtml(it.price)}`).join("</li><li>");
      const desc = String(fam.blurb || fam.name + " research material.").replace(/\s+/g, " ").trim();
      return {
        title: fam.name + " | Helix King Labs",
        description: desc.slice(0, 160),
        canonical: origin + "/product/" + (fam.slug || fam.id),
        h1: fam.name,
        body: `<p>${escHtml(desc)}</p><p>All products listed on this site are for research purposes only.</p><ul><li>${sizes}</li></ul>`,
        schema: {
          "@context": "https://schema.org",
          "@type": "Product",
          name: fam.name,
          ...(COMPOUND_NAMES[fam.id] ? { alternateName: COMPOUND_NAMES[fam.id] } : {}),
          brand: { "@type": "Brand", name: "Helix King Labs" },
          description: desc,
          offers: offers,
        },
      };
    }
    const legal = {
      "/terms": ["Terms and conditions — Helix King Labs", "Terms and Conditions of Use and Purchase"],
      "/privacy": ["Privacy notice — Helix King Labs", "Privacy Notice"],
      "/do-not-sell": ["Do not sell or share — Helix King Labs", "Do Not Sell or Share My Personal Information"],
      "/do-not-sell-or-share": ["Do not sell or share — Helix King Labs", "Do Not Sell or Share My Personal Information"],
      "/shipping": ["Shipping policy — Helix King Labs", "Shipping Policy"],
      "/refunds": ["Refund and returns — Helix King Labs", "Refund and Returns Policy"],
      "/returns": ["Refund and returns — Helix King Labs", "Refund and Returns Policy"],
      "/chargebacks": ["Chargeback policy — Helix King Labs", "Chargeback and Payment Dispute Policy"],
      "/chargeback": ["Chargeback policy — Helix King Labs", "Chargeback and Payment Dispute Policy"],
      "/use": ["Permitted use — Helix King Labs", "Permitted Use"],
      "/about": ["About Helix King Labs", "A research catalog with a lot on the vial."],
      "/certificates": ["Certificates of analysis — Helix King Labs", "Certificates"],
      "/testing": ["Peptide testing methods — Helix King Labs", "Testing methods"],
      "/tools": ["Research calculator — Helix King Labs", "Research calculator"],
      "/tools/calculator": ["Research calculator — Helix King Labs", "Research calculator"],
    };
    if (legal[pathname]) {
      return {
        title: legal[pathname][0],
        description: legal[pathname][1] + ". Helix King Labs. Research use only.",
        canonical: origin + pathname.replace("/returns", "/refunds").replace("/chargeback", "/chargebacks").replace("/do-not-sell-or-share", "/do-not-sell"),
        h1: legal[pathname][1],
        body: "<p>All products listed on this site are for research purposes only. Not for human dosing, injection, or ingestion.</p>",
      };
    }
    return {
      title: "Helix King Labs",
      description: "Premium research peptides. Research use only.",
      canonical: origin + pathname,
      h1: "Helix King Labs",
      body: "",
    };
  }

  function injectDocument(buf, pathname, status) {
    const model = pageModel(pathname) || {
      title: "Not found — Helix King Labs",
      description: "This page is not on the Helix King Labs catalog.",
      canonical: "https://helixkinglabs.com" + pathname,
      h1: "Not found",
      body: "<p>This address is not a catalog page.</p>",
    };
    let html = buf.toString("utf8");
    html = html.replace(/<title>[^<]*<\/title>/, "<title>" + escHtml(model.title) + "</title>");
    html = html.replace(
      /(<meta name="description" content=")[^"]*(")/,
      "$1" + escHtml(model.description) + "$2"
    );
    html = html.replace(
      /(<link rel="canonical" href=")[^"]*(")/,
      "$1" + escHtml(model.canonical) + "$2"
    );
    const schema = model.schema
      ? `<script type="application/ld+json" id="hkl-schema">${JSON.stringify(model.schema).replace(/</g, "\\u003c")}</script>`
      : "";
    const block = `${schema}<main id="app"><article class="page wrap"><h1>${escHtml(model.h1)}</h1>${model.body}</article></main>`;
    html = html.replace('<main id="app"></main>', block);
    if (status === 404 || pathname === "/group-buy" || pathname === "/group-buys") html = html.replace('content="index,follow', 'content="noindex,follow');
    return html;
  }

  function sitemapXml() {
    const origin = "https://helixkinglabs.com";
    const guidesDir = path.join(PUBLIC, "guides");
    const guides = fs.existsSync(guidesDir)
      ? fs.readdirSync(guidesDir).filter(f => f.endsWith(".html") && f !== "label-mockups.html").sort().map(f => "/guides/" + f)
      : [];
    const urls = ["/", "/shop", "/about", "/certificates", "/testing", "/tools/calculator", "/terms", "/privacy", "/do-not-sell", "/shipping", "/refunds", "/chargebacks", "/use"]
      .concat(guides)
      .concat(shopFamilies().map((f) => "/product/" + (f.slug || f.id)));
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
      .map((u) => `  <url><loc>${origin}${u}</loc></url>`)
      .join("\n")}\n</urlset>\n`;
  }

  function safePublic(rel) {
    const resolved = path.resolve(PUBLIC, rel);
    if (!resolved.startsWith(PUBLIC)) return null;
    return resolved;
  }

  function serveStatic(req, res, urlPath) {
    const pathname = decodeURIComponent(urlPath.split("?")[0] || "/");
    // Directory index: /guides and /guides/ redirect to the guides index page.
    if (pathname === "/guides" || pathname === "/guides/") {
      res.writeHead(301, { Location: "/guides/index.html", "Cache-Control": "public, max-age=86400" });
      return res.end();
    }
    const rel = pathname === "/" ? "/index.html" : pathname;
    const file = safePublic(rel.replace(/^\/+/, ""));
    const fileExists = file && fs.existsSync(file) && fs.statSync(file).isFile();
    // Serve real .html files on disk (e.g. /guides/*.html); /index.html stays the SPA shell.
    const isStaticHtml = rel.endsWith(".html") && rel !== "/index.html" && fileExists;
    const isAsset = fileExists && (!rel.endsWith(".html") || isStaticHtml);
    if (isAsset) {
      const ext = path.extname(file).toLowerCase();
      // Ops-only scripts: the API calls 403 for non-ops, but the route map
      // and logic should not ship to every visitor's browser either.
      if (ext === ".js" && secHandle.OPS_ONLY_SCRIPTS.has(path.basename(file)) && !isOpsUser(sessionUser(req))) {
        res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
        return res.end(JSON.stringify({ error: "ops_only" }));
      }
      const headers = ext === ".html"
        ? { ...secHandle.htmlHeaders(200), "Cache-Control": "public, max-age=86400" }
        : {
            "Content-Type": MIME[ext] || "application/octet-stream",
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "public, max-age=86400",
          };
      res.writeHead(200, headers);
      return fs.createReadStream(file).pipe(res);
    }
    if (!file && pathname.includes("..")) {
      res.writeHead(403);
      return res.end();
    }
    const status = knownPaths().has(pathname) || pathname.startsWith("/account") || pathname.startsWith("/ops/orders/") || pathname === "/magic" ? 200 : 404;
    const opsDesk = pathname === "/ops";
    const index = path.join(PUBLIC, opsDesk ? "ops.html" : "index.html");
    fs.readFile(index, (e2, buf) => {
      if (e2) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      // Ops desk shell has no inline scripts; a nonce-less policy is enough.
      if (opsDesk) {
        res.writeHead(status, secHandle.htmlHeaders(status));
        return res.end(buf);
      }
      // Storefront shell: per-request nonce on every <script> so the CSP can
      // forbid 'unsafe-inline' without breaking our own scripts or GTM.
      // Non-ops visitors don't get the ops <script> tags at all (they'd 403
      // anyway); this keeps the admin route map out of public browsers.
      const nonce = crypto.randomBytes(16).toString("base64");
      let html = injectDocument(buf, pathname, status);
      html = html.replace(/<script(?=[\s>])/g, '<script nonce="' + nonce + '"');
      if (!isOpsUser(sessionUser(req))) {
        html = html.replace(
          /<script nonce="[^"]*" src="\/(?:desk\.js|ops-email\.js|ops-fulfill\.js|ops-inventory\.js|ops-coupons\.js)[^"]*"><\/script>/g,
          ""
        );
      }
      res.writeHead(status, secHandle.htmlHeaders(status, nonce));
      res.end(html);
    });
  }

  return { serveStatic, sitemapXml };
}

module.exports = { createStaticServe };
