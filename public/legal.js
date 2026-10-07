/* Helix King Labs legal instruments. Rendered by policy() in app.js. */
(function () {
  const UPDATED = "1 October 2026";
  const MAIL = "info@helixkinglabs.com";
  const ORDERS = "orders@helixkinglabs.com";
  const PHONE = "202-642-4575";
  const FIELDS = [
    "Molecular Biology",
    "Biochemistry",
    "Peptide Chemistry",
    "Chemical Biology",
    "Biotechnology Research",
    "Academic Research",
    "Pharmacology",
  ];

  const related = [
    ["Terms", "/terms"],
    ["Privacy", "/privacy"],
    ["Do not sell or share", "/do-not-sell"],
    ["Shipping", "/shipping"],
    ["Refunds", "/refunds"],
    ["Chargebacks", "/chargebacks"],
    ["Permitted use", "/use"],
    ["Affiliate terms", "/affiliate-terms"],
  ];

  function mail() {
    return `<a href="mailto:${MAIL}">${MAIL}</a>`;
  }

  function contactBlock() {
    return `<p>Helix King Labs<br>Kentucky, USA<br>Support: ${mail()}<br>Orders and receipts: <a href="mailto:${ORDERS}">${ORDERS}</a><br>Telephone: ${PHONE}</p>`;
  }

  const pages = {
    terms: {
      code: "HKL-LEG-001",
      title: "Terms and Conditions of Use and Purchase",
      kicker: "Web site and order terms",
      lede: "These terms govern use of helixkinglabs.com and every order placed with Helix King Labs. Passing the age gate, creating an account, or placing an order is acceptance.",
      sections: [
        {
          id: "parties",
          title: "Parties and acceptance",
          body: `<p>These Terms and Conditions of Use and Purchase are between you and Helix King Labs (“Helix,” “we,” “us”). They cover the public site at helixkinglabs.com, the account system, and the research materials offered there.</p>
            <p>The <a href="/privacy" data-link>Privacy Notice</a>, <a href="/do-not-sell" data-link>Do Not Sell or Share</a> page, <a href="/use" data-link>Permitted Use</a> terms, <a href="/shipping" data-link>Shipping Policy</a>, <a href="/refunds" data-link>Refund and Returns Policy</a>, and <a href="/chargebacks" data-link>Chargeback Policy</a> are incorporated by reference. If a page conflicts with these terms on a purchase, the purchase terms control.</p>
            <p>By clicking the age-gate acceptance, creating an account, or placing an order, you agree to all of these instruments. If you do not agree, do not use the site and do not order.</p>`,
        },
        {
          id: "use",
          title: "Use of the web site",
          body: `<p>You may view, download, or print a copy of material on this site for your own laboratory or institutional reference, provided you do not modify it or remove a proprietary notice. You may not copy the catalog, photography, or marks to operate a competing storefront, a public price index, or a scraped resale list.</p>
            <p>You may not modify, distribute, transmit, republish, license, or sell information or product listings from this site except as these terms allow. Any other use requires prior written consent from Helix King Labs.</p>`,
        },
        {
          id: "eligibility",
          title: "Eligibility",
          body: `<p>You must be 21 or older. The age gate is required before the catalog is shown. We may refuse or close an account that fails that standard, that is used by a minor, or that refuses the research-use acknowledgment.</p>
            <p>You represent that you are requesting documented research materials for laboratory, academic, or institutional research. You are not requesting a treatment, a clinic service, or a product for human or animal consumption.</p>`,
        },
        {
          id: "account",
          title: "Account required to purchase",
          body: `<p>Guest checkout is not available. An order requires an account. List prices may be shown after the age gate. Adding an item to the cart and placing an order require a signed-in account.</p>
            <p>At account creation or checkout you will give a company name. “Independent research” is an accepted company name for a sole researcher. You will also select a research field from the list we publish: ${FIELDS.join("; ")}.</p>
            <p>You are responsible for the email and credentials on the account. Sign-in links and receipts are sent from ${ORDERS}. Support mail is ${MAIL}. We may close an account used to publish outcome claims in our name, to misstate the research purpose of an order, or to abuse the payment rails.</p>`,
        },
        {
          id: "products",
          title: "Product and sale limitations",
          body: `<p>All products listed on this site are for research purposes only. They are sold for laboratory, academic, or institutional research and identification. They are not intended for human dosing, injection, or ingestion, and not for animal consumption.</p>
            <p>Research materials ship as dried material in a sealed, labeled vial. We do not ship mixed solutions, reconstituted product, filled syringes, or pens. Bacteriostatic water and cosmetic goods are not on this catalog.</p>
            <p>Nothing on this site is medical advice, a diagnosis, a protocol, a dose, a cycle, or a stack. We do not claim that a material treats, cures, prevents, or mitigates any disease or condition. A product description is a technical note, not a direction for use on a person or an animal.</p>
            <p>A lot certificate is published when that lot is accepted for resale. Until then the lot page may say certificate pending. We do not invent a certificate. The vial QR, when present, opens the lot page on this site, not a third-party laboratory.</p>
            <p>Before an order is placed you must acknowledge that the materials will not be used for human therapeutic purposes and are for research purposes only.</p>`,
        },
        {
          id: "prices",
          title: "Prices, payment, and settlement",
          body: `<p>Prices are in United States dollars and are the prices shown at the time we accept the order. Prices and availability may change without notice. A quoted cart is an offer. We may refuse an order.</p>
            <p>One discount of 10% may apply to merchandise: the first-order code HELIX10, or an affiliate code, not both. Shipping is $9.95 and is free when merchandise after discounts is $199 or more. Shipping is not discounted and is not commissionable.</p>
            <p>Payment methods currently offered:</p>
            <ul>
              <li>Crypto, processed by NOWPayments. The order stays unpaid until NOWPayments reports the payment finished. Partial payment, wrong-asset payment, and expiry are not completed orders. Network fees may apply. A finished crypto payment is not reversible by us.</li>
              <li>Venmo, to the business account @fibkingpeps. A 10% surcharge is added to merchandise after discounts. Shipping is unchanged. Venmo is manual. We do not mark the order paid, and we do not ship, until we confirm the payment. The surcharge is disclosed before you commit.</li>
            </ul>
            <p>Card and ACH are not offered. We do not store bank account numbers. A crypto invoice address is generated for that order by the processor. You authorize only the payment method you select.</p>`,
        },
        {
          id: "ip",
          title: "Marks and intellectual property",
          body: `<p>Helix King Labs, the crowned ape mark, vial photography, layout, and site copy are owned or licensed by Helix King Labs and are protected by applicable intellectual-property law. Except as these terms allow, no part of the site may be copied, mirrored, or republished for a commercial purpose without prior written consent.</p>`,
        },
        {
          id: "your-info",
          title: "Information you provide",
          body: `<p>Collection and use of information you submit is governed by the Privacy Notice and these terms. You may not upload or send material that is unlawful, defamatory, or an invasion of privacy.</p>
            <p>Except for personal information handled under the Privacy Notice, comments or suggestions you send may be used by Helix King Labs without obligation to compensate you.</p>`,
        },
        {
          id: "warranty",
          title: "Disclaimer of warranties",
          body: `<p>THE SITE, THE CATALOG, AND THE RESEARCH MATERIALS ARE PROVIDED “AS IS” AND “AS AVAILABLE.” TO THE FULL EXTENT ALLOWED BY LAW, HELIX KING LABS DISCLAIMS WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT, AND DISCLAIMS ANY WARRANTY THAT THE SITE WILL BE UNINTERRUPTED OR ERROR-FREE.</p>
            <p>We do not warrant that a research material is fit for any particular experiment. You are responsible for confirming identity, storage, and handling against the lot record and your own protocol. Use of the site and of any material is at your sole risk.</p>`,
        },
        {
          id: "liability",
          title: "Limitation of liability",
          body: `<p>To the fullest extent not prohibited by law, Helix King Labs and its suppliers are not liable for indirect, incidental, special, consequential, or punitive damages, or for decisions you make in reliance on the catalog. Aggregate liability arising from an order is limited to the amount you paid Helix King Labs for that order.</p>
            <p>Some jurisdictions do not allow certain limitations. Those limits apply only to the extent allowed. If you are dissatisfied with the site, your remedy is to stop using it.</p>`,
        },
        {
          id: "indemnity",
          title: "Indemnity",
          body: `<p>You will indemnify and hold harmless Helix King Labs and its officers, agents, and vendors from a third-party claim arising out of your use of the site, your use of a research material outside the permitted-use terms, content you submit, or your violation of these terms or of another party’s rights, including reasonable attorney’s fees.</p>`,
        },
        {
          id: "law",
          title: "Governing law",
          body: `<p>These terms and the site are governed by the laws of the Commonwealth of Kentucky, without regard to conflict-of-law rules. You agree that courts located in the Commonwealth of Kentucky are the venue for a dispute that is not resolved by direct contact, except where a mandatory statute in your place of residence says otherwise. You remain responsible for the laws of the place where you are located.</p>
            <p>You and Helix King Labs are independent contractors. No agency, partnership, or employment is created by use of the site.</p>`,
        },
        {
          id: "misc",
          title: "General",
          body: `<p>We may suspend or terminate access if you violate these terms. We are not liable for delay caused by events beyond reasonable control, including carrier delay, customs delay, or a supplier backorder.</p>
            <p>If a provision is unenforceable, it is limited to the minimum extent required and the remainder stays in force. Headings are for reference. These terms, and the instruments incorporated here, are the entire agreement on this subject and replace prior understandings on the same subject. We may update this page by posting a new date. Continued use after the new date is acceptance of the update.</p>
            <p>Placing an order and clicking the acceptance control is agreement to these terms, the permitted-use acknowledgment, the shipping policy, the refund policy, and the chargeback policy.</p>`,
        },
      ],
    },
    privacy: {
      code: "HKL-LEG-002",
      title: "Privacy Notice",
      kicker: "Personal information",
      lede: "This notice describes what Helix King Labs collects on helixkinglabs.com, why, and the choices you have. It is the operative notice for the site. It is not a substitute for advice on your own compliance program.",
      sections: [
        {
          id: "who",
          title: "Who we are",
          body: `<p>Helix King Labs operates helixkinglabs.com from Kentucky, USA. Support: ${mail()}. Transactional mail, including sign-in links and receipts, is sent from ${ORDERS}. Telephone: ${PHONE}.</p>`,
        },
        {
          id: "collect",
          title: "Information we collect",
          body: `<ul>
              <li>Account: email, name, company name, research field, password hash (scrypt), age and terms flags, optional telephone if you add one.</li>
              <li>Order: lines, lot, quantities, ship-to details you submit, payment rail, processor reference, and the research-use acknowledgment.</li>
              <li>List: email, source page, and time, if you subscribe.</li>
              <li>Session: an httpOnly cookie for a signed-in account. Cart contents may sit in local storage. We do not store a Google password.</li>
              <li>Google Sign-In, when configured: verified email and subject from the ID token.</li>
              <li>Technical: IP address used for rate limits, user agent, and pages requested.</li>
              <li>Measurement, only as described below: Google Analytics 4 identifiers via Google Tag Manager.</li>
            </ul>
            <p>We do not ask you to send a government ID, a bank login, or a card number to a mailbox. Crypto invoices are created by NOWPayments. Venmo payments are made to @fibkingpeps. We store the reference needed to match an order, not your Venmo password.</p>`,
        },
        {
          id: "cookies",
          title: "Cookies and measurement",
          body: `<ul>
              <li>Strictly necessary: session cookie, age-gate confirmation, cart. These run without an analytics opt-in.</li>
              <li>Measurement: Google Tag Manager container GTM-KZDZHCKC loads on pages and fires Google Analytics 4 (G-6HZJNLG29P) for page views. The Meta Pixel is not installed. TikTok Pixel is not installed. A tag added later in Tag Manager will be named on this page.</li>
            </ul>
            <p>A Global Privacy Control signal is treated as a refusal of analytics cookies.</p>`,
        },
        {
          id: "why",
          title: "Why we use it",
          body: `<p>To run the catalog and accounts, to tie a lot to an order, to send mail you requested or that an order requires, to prevent abuse, and to measure which public pages are read. We do not sell the email list. We do not build a marketing profile from the research-field field.</p>
            <p>If you write from the EEA or UK, the bases we rely on are contract (account and order), legitimate interests (security), and consent (analytics cookies and the optional email list).</p>`,
        },
        {
          id: "share",
          title: "Sharing",
          body: `<p>We share information with processors that run infrastructure we select: hosting, email delivery, Google (Sign-In and Analytics), and NOWPayments when you choose crypto. We do not sell personal information for money.</p>
            <p>Under California law, some analytics tags can be treated as “sharing” for cross-context advertising. Our current measurement is page-view analytics. The advertising pixel is off. You can refuse measurement. See <a href="/do-not-sell" data-link>Do not sell or share</a>.</p>`,
        },
        {
          id: "retention",
          title: "Retention and security",
          body: `<p>Account and order records are kept while the account is open and for a limited period after, so a payment dispute can be answered. Subscribe records stay until you ask to be removed. Server logs rotate. Certificates that are not accepted for resale stay in operations and are not published.</p>
            <p>Passwords are scrypt-hashed. Sessions are httpOnly cookies. No method of transmission is perfectly secure.</p>`,
        },
        {
          id: "choices",
          title: "Your choices",
          body: `<p>Request access, correction, or deletion of account and list data at ${mail()}. You may close an account. You may refuse analytics cookies. You may opt out of promotional mail. Order and receipt mail for a placed order is transactional and is not the promotional list.</p>
            <p>We do not knowingly collect information from anyone under 21. This site is 21+.</p>`,
        },
      ],
    },
    dns: {
      code: "HKL-LEG-003",
      title: "Do Not Sell or Share My Personal Information",
      kicker: "California and state privacy choice",
      lede: "Helix King Labs does not sell personal information for money. This page is the request path if you want measurement limited, and the record of that choice.",
      sections: [
        {
          id: "statement",
          title: "Statement",
          body: `<p>We do not sell personal information as that word is commonly used. We do not share personal information with a data broker. We do not run a cross-context advertising pixel.</p>
            <p>Google Analytics 4, loaded through Google Tag Manager, measures page views if measurement cookies are allowed. Some state laws treat certain analytics disclosures as a “share.” You may refuse that measurement.</p>`,
        },
        {
          id: "how",
          title: "How to opt out",
          body: `<ul>
              <li>Use the cookie bar and refuse analytics cookies.</li>
              <li>A browser Global Privacy Control signal is treated as a refusal of analytics cookies.</li>
              <li>Write ${mail()} with the subject line “Do not sell or share.” Include the account email. We will keep records required for an order and stop measurement tags on later visits from browsers where you refuse cookies.</li>
            </ul>
            <p>We do not offer a financial incentive that requires you to accept a sale or share of personal information.</p>`,
        },
        {
          id: "categories",
          title: "Categories this choice covers",
          body: `<p>Identifiers (email, name, company, telephone if provided), commercial information (order history), internet activity (pages read, if measurement is on), and the research field you select. We do not collect precise geolocation. Payment credentials for crypto stay with NOWPayments.</p>`,
        },
      ],
    },
    shipping: {
      code: "HKL-LEG-004",
      title: "Shipping Policy",
      kicker: "Fulfillment",
      lede: "Research vials ship as dried, sealed material. This policy states the charge, the free-shipping line, and what we do not ship.",
      sections: [
        {
          id: "rates",
          title: "Rates",
          body: `<p>Standard shipping is $9.95. Shipping is free when merchandise after discounts is $199 or more. HELIX10 and affiliate codes do not reduce shipping. Shipping is not commissionable.</p>
            <p>A Venmo order adds 10% to merchandise after discounts. That surcharge does not change the shipping line.</p>`,
        },
        {
          id: "what",
          title: "What ships",
          body: `<p>We ship dried research material in a sealed vial. We do not ship mixed solutions, reconstituted product, filled pens, or research water. A cold pack is used when the lot record requires it. Selank and Semax, when listed, ship under the storage note on that product page.</p>
            <p>Tracking is posted on the order when a label is booked. Carrier delay, customs delay, and a lost parcel are outside our control. Write ${mail()} with the order number if a tracking event stops.</p>`,
        },
        {
          id: "hold",
          title: "When we ship",
          body: `<p>An order is not released because a button was clicked. Crypto releases when NOWPayments reports the payment finished. Venmo releases when we confirm the payment on @fibkingpeps. An unpaid or partially paid order does not ship.</p>`,
        },
      ],
    },
    refunds: {
      code: "HKL-LEG-005",
      title: "Refund and Returns Policy",
      kicker: "All sales final",
      lede: "No returns. No refunds, except the narrow window below for a missing, incorrect, or damaged shipment. Read this before you place an order.",
      sections: [
        {
          id: "final",
          title: "All sales final",
          body: `<p>We do not accept returns. Research lots leave as sealed vials. Once a vial is out of that chain we cannot restock it. Review the name, fill, and quantity on the product page before you pay.</p>
            <p>Once an order is placed and the payment is confirmed, it cannot be cancelled for convenience and it is not refunded for convenience. A finished crypto payment cannot be reversed by us.</p>`,
        },
        {
          id: "window",
          title: "Missing, incorrect, or damaged",
          body: `<p>If the shipment arrives missing a line, with the wrong item, or with a broken seal or broken vial, write within seven days of delivery to ${mail()}. Include the order number and photographs of the outer carton, the inner pack, and the item. We will replace the affected line or close the ticket under this policy.</p>
            <p>Opened lots, and any lot reconstituted after delivery, are not eligible. A certificate-pending lot is not a defect if the page said certificate pending at purchase.</p>`,
        },
        {
          id: "contact",
          title: "Contact",
          body: `<p>Support: ${mail()}. Placing an order is agreement to this policy and to the <a href="/chargebacks" data-link>Chargeback Policy</a>.</p>`,
        },
      ],
    },
    chargebacks: {
      code: "HKL-LEG-006",
      title: "Chargeback and Payment Dispute Policy",
      kicker: "Disputes",
      lede: "Contact us before you open a payment dispute. The order record, the research-use acknowledgment, and the shipping record are what we submit in response.",
      sections: [
        {
          id: "first",
          title: "Contact first",
          body: `<p>If a payment posts and the order is wrong, missing, or not recognized, write ${mail()} with the order number before you file a dispute with Venmo, a bank, or a crypto service. Most fulfillment errors are handled under the seven-day window in the refund policy.</p>`,
        },
        {
          id: "rails",
          title: "By payment rail",
          body: `<ul>
              <li>Crypto via NOWPayments. A finished payment is not a chargeback. Underpayment, wrong asset, and expiry leave the order unpaid. We do not ship those orders. We do not reverse a finished network payment.</li>
              <li>Venmo. A dispute or reversal after we have shipped may be contested with the order, the research-use acknowledgment, the age-gate record, and delivery evidence. The 10% merchandise surcharge is part of the amount you authorized.</li>
            </ul>
            <p>Card and ACH are not offered. This policy will cover those rails if they are added later.</p>`,
        },
        {
          id: "result",
          title: "Account result",
          body: `<p>A dispute filed without a prior message to us, or a dispute that contradicts the research-use acknowledgment, may result in a closed account and a refusal of later orders. You remain responsible for a shipped order that you later reverse without a basis under the refund policy.</p>`,
        },
      ],
    },
    use: {
      code: "HKL-LEG-007",
      title: "Permitted Use",
      kicker: "Research use only",
      lede: "All products listed on this site are for research purposes only.",
      sections: [
        {
          id: "standard",
          title: "Standard",
          body: `<p>You must be 21 or older. Materials are for laboratory, academic, or institutional research and identification. They are not for human dosing, injection, or ingestion. They are not for animal consumption. They are not a drug, not a dietary supplement, and not a clinic service.</p>
            <p>Helix King Labs is not a clinic, not a med spa, not a pharmacy, and not a 503A or 503B facility. We do not publish protocols, doses, cycles, or stacks.</p>`,
        },
        {
          id: "ack",
          title: "Acknowledgment",
          body: `<p>An order requires this acknowledgment: chemicals purchased shall not be used for human therapeutic purposes, and are for research purposes only.</p>
            <p>The research field on the account is one of: ${FIELDS.join("; ")}. Company name may be Independent research.</p>`,
        },
      ],
    },
    affiliates: {
      code: "HKL-LEG-008",
      title: "Affiliate Program Terms",
      kicker: "Referral commissions",
      lede: "These terms govern the Helix King Labs affiliate program: who may hold a code, how commission is earned, how tax information is handled, and how payouts work.",
      sections: [
        {
          id: "eligibility",
          title: "Eligibility",
          body: `<p>An affiliate account opens after the account holder places at least one recorded order. Helix King Labs may also issue codes directly. You must be 18 or older.</p>
            <p>Before a code is issued you must submit complete tax information: legal name, mailing address, and a Social Security number or Employer Identification Number, with a signed certification that it is correct. A code is not issued until that information is on file. If your tax information changes, you must update it before your next payout.</p>`,
        },
        {
          id: "commission",
          title: "Commission",
          body: `<p>Commission is 10% of merchandise after discounts. Shipping, taxes, and fees are not commissionable. One discount applies per order: an affiliate code replaces the first-order code and any coupon.</p>
            <p>No commission is earned on your own orders. A code used on the affiliate's own account earns the buyer discount but $0 commission.</p>`,
        },
        {
          id: "payouts",
          title: "Payouts",
          body: `<p>Cash out at $50 or more, any time, from the affiliate desk. Payouts are sent in crypto or by Cash App to the destination you provide — keep that information current. You may leave your balance in as long as you like.</p>
            <p>On December 31 of each year, every balance of $50 or more is automatically queued for payout to your saved payout destination, and your available balance resets toward the new year. Balances under $50 carry forward.</p>
            <p>Payouts are reported as required by law. If you earn $600 or more in a calendar year we will issue a Form 1099-NEC to the legal name, address, and Tax ID you provided. It is your responsibility to report affiliate income.</p>`,
        },
        {
          id: "expiry",
          title: "Code expiry and removal",
          body: `<p>A code that generates no referred order for 2 consecutive years expires automatically. Helix King Labs may also remove a code at any time, for any reason, including suspected abuse, self-dealing, or misleading promotion.</p>
            <p>An expired or removed code stops giving discounts and stops earning commission immediately. Any earned balance remains yours and may still be cashed out at the $50 floor.</p>`,
        },
        {
          id: "conduct",
          title: "Conduct",
          body: `<p>Promote honestly. Do not claim products are for human use, do not publish doses or protocols, and do not present yourself as Helix King Labs. Spam, misleading claims, or coupon-code scraping ends the code.</p>`,
        },
      ],
    },
  };

  function toc(sections) {
    return sections
      .map((s, i) => `<a href="#${s.id}">${i + 1}. ${s.title}</a>`)
      .join("");
  }

  function sheet(kind) {
    const page = pages[kind];
    if (!page) return "";
    const body = page.sections
      .map(
        (s, i) => `<section class="legal-sec" id="${s.id}">
          <h2><span>${String(i + 1).padStart(2, "0")}</span> ${s.title}</h2>
          ${s.body}
        </section>`
      )
      .join("");
    const links = related
      .map(([label, href]) => `<a href="${href}" data-link>${label}</a>`)
      .join("");
    return `<article class="legal-sheet">
      <header class="legal-mast">
        <div>
          <p class="legal-brand">Helix King Labs</p>
          <p class="legal-code">${page.code} · Effective ${UPDATED}</p>
        </div>
        <button type="button" class="legal-print" onclick="window.print()">Print</button>
      </header>
      <p class="legal-kicker">${page.kicker}</p>
      <h1>${page.title}</h1>
      <p class="legal-lede">${page.lede}</p>
      <p class="legal-meta">Effective date ${UPDATED}. Domain helixkinglabs.com. Governing law: Commonwealth of Kentucky.</p>
      ${body}
      <footer class="legal-end">
        <p class="legal-end-label">Notices</p>
        ${contactBlock()}
        <p class="legal-accept">Acceptance of an order is acceptance of this instrument and of the instruments incorporated into the Terms.</p>
      </footer>
    </article>`;
  }

  function render(kind) {
    const page = pages[kind];
    if (!page) {
      return `<section class="page wrap"><h1>Not found</h1></section>`;
    }
    return `<section class="legal-doc wrap">
      <aside class="legal-toc">
        <p>Contents</p>
        ${toc(page.sections)}
      </aside>
      ${sheet(kind)}
    </section>`;
  }

  window.HKL_LEGAL = { render, pages };
})();
