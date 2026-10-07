// Google Places address autocomplete for checkout.
// API key is domain-restricted in Google Cloud Console.
(function () {
  const PLACES_KEY = "AIzaSyBlBqGrzpekpXEv65NBDS-vtJQ61Ep7fT0";
  let loaded = false;

  function loadScript() {
    return new Promise((resolve, reject) => {
      if (window.google && window.google.maps && window.google.maps.places) return resolve();
      if (loaded) {
        const check = setInterval(() => {
          if (window.google && window.google.maps && window.google.maps.places) { clearInterval(check); resolve(); }
        }, 200);
        setTimeout(() => { clearInterval(check); reject(new Error("timeout")); }, 10000);
        return;
      }
      loaded = true;
      const s = document.createElement("script");
      s.src = "https://maps.googleapis.com/maps/api/js?key=" + PLACES_KEY + "&libraries=places";
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("load failed"));
      document.head.appendChild(s);
    });
  }

  function wireAutocomplete(input) {
    if (!input || input.dataset.places) return;
    input.dataset.places = "1";
    input.setAttribute("autocomplete", "off");
    loadScript().then(() => {
      const session = new google.maps.places.AutocompleteSessionToken();
      const ac = new google.maps.places.Autocomplete(input, {
        types: ["address"],
        componentRestrictions: { country: "us" },
      });
      // Use session token via the new API if available
      ac.addListener("place_changed", () => {
        const place = ac.getPlace();
        if (!place || !place.address_components) return;
        const form = input.closest("form");
        if (!form) return;
        const get = (type) => {
          const c = place.address_components.find((x) => x.types.includes(type));
          return c ? c.long_name : "";
        };
        const getShort = (type) => {
          const c = place.address_components.find((x) => x.types.includes(type));
          return c ? c.short_name : "";
        };
        const street = [get("street_number"), get("route")].filter(Boolean).join(" ");
        const set = (name, val) => {
          const el = form.querySelector(`[name="${name}"]`);
          if (el && val) el.value = val;
        };
        if (street) input.value = street;
        set("city", get("locality") || get("sublocality") || get("administrative_area_level_2"));
        set("region", getShort("administrative_area_level_1"));
        set("postal", get("postal_code"));
      });
    }).catch(() => {});
  }

  // Wire up any street address field on the page
  window.HKL_PLACES = function () {
    document.querySelectorAll('input[name="line1"]').forEach(wireAutocomplete);
  };

  // Auto-wire on load and after SPA renders
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => window.HKL_PLACES());
  } else {
    window.HKL_PLACES();
  }
})();
