/* Live Services & Pricing Board — synced with Fixfy OS Services tab */
window.FX_SCHOOL_CATALOG = (function () {
  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function opt(k, label) {
    return (
      '<button class="sc-opt" data-opt><span class="sc-opt__key">' +
      k +
      '</span><span>' +
      label +
      '</span><span class="sc-opt__mark"><i data-lucide="check-circle-2"></i></span></button>'
    );
  }

  var lesson = {
    id: "products-services-board",
    phaseId: "fixfy-products",
    title: "Services & Pricing Board",
    phase: "Foundation · Fixfy Products & Vision",
    xp: 80,
    scenes: [
      {
        type: "cover",
        xp: 0,
        html:
          '<div class="sc-scene__inner">' +
          '<div class="sc-cover__badge sc-anim"><i data-lucide="layout-grid"></i></div>' +
          '<div class="sc-scene__eyebrow sc-anim d1">Foundation · Lesson 6</div>' +
          "<h2 class=\"sc-anim d1\">Services &amp; Pricing Board</h2>" +
          '<p class="sc-lead sc-anim d2" style="margin-left:auto;margin-right:auto;text-align:center">Live rate card by category — pulled from <strong>Services</strong> in Fixfy OS. Update the catalog there and this board updates automatically.</p>' +
          '<div class="sc-cover__meta sc-anim d3">' +
          '<span class="fx-pill fx-pill--coral"><i data-lucide="clock" style="width:12px;height:12px"></i>10 min</span>' +
          '<span class="fx-pill"><i data-lucide="zap" style="width:12px;height:12px"></i>+80 XP</span>' +
          '<span class="fx-pill">3 scenes</span></div></div>' +
          '<div class="sc-scrollhint"><span>Scroll to begin</span><i data-lucide="chevrons-down"></i></div>',
      },
      {
        type: "read",
        xp: 15,
        html:
          '<div class="sc-scene__inner">' +
          '<div class="sc-scene__num sc-anim">01</div>' +
          '<div class="sc-scene__eyebrow sc-anim">Single source of truth</div>' +
          "<h2 class=\"sc-anim d1\">Same data as the Services tab</h2>" +
          '<p class="sc-lead sc-anim d2">When ops updates a price in <span class="fx-mono">Services → Manage</span> or copies rates from <span class="fx-mono">Services → Overview</span>, operators see the change here immediately.</p>' +
          '<div class="sc-callout sc-anim d3"><div class="sc-callout__k">Categories</div><div class="sc-callout__t"><b>Trades</b> · <b>Certificates</b> · <b>Cleaning</b> · <b>Other</b> — resolved automatically from each service name, same rules as the OS board.</div></div>' +
          "</div>",
      },
      {
        type: "catalog",
        xp: 40,
        dark: true,
        html:
          '<div class="sc-scene__inner sc-catalog-board-wrap">' +
          '<div class="sc-scene__num sc-anim">02</div>' +
          '<div class="sc-scene__eyebrow sc-anim">Live from OS</div>' +
          "<h2 class=\"sc-anim d1\">Standard prices by category</h2>" +
          '<p class="sc-lead sc-anim d2">Active services only. Base packages and add-ons are listed separately for easier reading.</p>' +
          '<div class="sc-catalog-board sc-anim d3" data-catalog-board><div class="sc-catalog-board__loading"><i data-lucide="loader-2"></i> Loading catalog…</div></div>' +
          '<p class="sc-catalog-board__meta sc-anim d3" data-catalog-meta hidden></p>' +
          "</div>",
      },
      {
        type: "check",
        xp: 25,
        dark: true,
        correct: 1,
        html:
          '<div class="sc-check sc-check--light">' +
          '<div class="sc-check__k"><i data-lucide="help-circle"></i>Checkpoint</div>' +
          '<div class="sc-check__q">A client asks for the current (GSC) price. Where is the authoritative answer?</div>' +
          '<div class="sc-check__opts">' +
          opt("A", "Last email thread from 2024") +
          opt("B", "Services in Fixfy OS — this board and Overview tab") +
          opt("C", "Partner’s personal rate card") +
          "</div>" +
          '<div class="sc-check__fb"><b>Correct.</b> The OS catalog is the single source. Copy from Overview or quote from the synced price here.</div></div>',
      },
    ],
  };

  function modelBadgeClass(model) {
    var m = (model || "").toLowerCase();
    if (m.indexOf("hourly") >= 0) return "sc-catalog-svc__model is-hourly";
    if (m.indexOf("fixed") >= 0) return "sc-catalog-svc__model is-fixed";
    if (m.indexOf("band") >= 0 || m.indexOf("stack") >= 0 || m.indexOf("add-on") >= 0) {
      return "sc-catalog-svc__model is-bands";
    }
    return "sc-catalog-svc__model";
  }

  function renderPriceRow(item, isAddon) {
    var cls = isAddon ? "sc-catalog-price sc-catalog-price--addon" : "sc-catalog-price";
    return (
      '<li class="' +
      cls +
      '"><span class="sc-catalog-price__label">' +
      esc(item.label) +
      '</span><span class="sc-catalog-price__amount">' +
      esc(item.price) +
      "</span>" +
      (item.detail ? '<span class="sc-catalog-price__detail">' + esc(item.detail) + "</span>" : "") +
      "</li>"
    );
  }

  function renderSimple(simple) {
    return (
      '<div class="sc-catalog-svc__block">' +
      '<div class="sc-catalog-svc__block-title">Standard rate</div>' +
      '<ul class="sc-catalog-svc__price-list">' +
      renderPriceRow(simple, false) +
      "</ul></div>"
    );
  }

  function renderBaseBands(bands) {
    if (!bands.length) return "";
    var html =
      '<div class="sc-catalog-svc__block"><div class="sc-catalog-svc__block-title">Base packages</div><ul class="sc-catalog-svc__price-list">';
    bands.forEach(function (b) {
      html += renderPriceRow(b, false);
    });
    return html + "</ul></div>";
  }

  function renderAddons(addons) {
    if (!addons.length) return "";
    var html =
      '<div class="sc-catalog-svc__block sc-catalog-svc__block--addons">' +
      '<div class="sc-catalog-svc__block-title">Add-ons <span class="sc-catalog-svc__count">' +
      addons.length +
      "</span></div>" +
      '<ul class="sc-catalog-svc__addon-grid">';
    addons.forEach(function (a) {
      html += renderPriceRow(a, true);
    });
    return html + "</ul></div>";
  }

  function renderServicePricing(svc) {
    if (svc.missing) {
      return '<p class="sc-catalog-svc__price is-mute">Price on request</p>';
    }
    var html = "";
    if (svc.simple) html += renderSimple(svc.simple);
    if (svc.baseBands && svc.baseBands.length) html += renderBaseBands(svc.baseBands);
    if (svc.addons && svc.addons.length) html += renderAddons(svc.addons);
    if (!html) return '<p class="sc-catalog-svc__price is-mute">Price on request</p>';
    return html;
  }

  function renderBoard(payload) {
    if (!payload || !payload.categories || !payload.categories.length) {
      return '<p class="sc-catalog-board__empty">No active services in the catalog yet. Add services under <strong>Services</strong> in Fixfy OS.</p>';
    }
    var html = "";
    payload.categories.forEach(function (cat) {
      html += '<section class="sc-catalog-cat"><h3 class="sc-catalog-cat__title">' + esc(cat.label) + "</h3>";
      html += '<div class="sc-catalog-cat__grid">';
      cat.services.forEach(function (svc) {
        var addonCount = (svc.addons && svc.addons.length) || 0;
        var wide = addonCount > 3 || ((svc.baseBands && svc.baseBands.length) || 0) > 2;
        html += '<article class="sc-catalog-svc' + (wide ? " is-wide" : "") + '">';
        html += '<div class="sc-catalog-svc__head"><strong>' + esc(svc.name) + "</strong>";
        html += '<span class="' + modelBadgeClass(svc.model) + '">' + esc(svc.model) + "</span></div>";
        if (svc.description) {
          html += '<p class="sc-catalog-svc__desc">' + esc(svc.description) + "</p>";
        }
        html += renderServicePricing(svc);
        html += "</article>";
      });
      html += "</div></section>";
    });
    return html;
  }

  function hydrateCatalogBoards() {
    var boards = document.querySelectorAll("[data-catalog-board]");
    if (!boards.length) return;

    fetch("/api/school/service-catalog", { credentials: "include" })
      .then(function (res) {
        if (!res.ok) throw new Error("fetch failed");
        return res.json();
      })
      .then(function (payload) {
        boards.forEach(function (el) {
          el.innerHTML = renderBoard(payload);
          var meta = el.parentElement && el.parentElement.querySelector("[data-catalog-meta]");
          if (meta && payload.generatedAt) {
            meta.hidden = false;
            meta.textContent =
              payload.totalActive +
              " active services · synced " +
              new Date(payload.generatedAt).toLocaleString("en-GB", {
                dateStyle: "medium",
                timeStyle: "short",
              });
          }
        });
        if (window.lucide) lucide.createIcons();
      })
      .catch(function () {
        boards.forEach(function (el) {
          el.innerHTML =
            '<p class="sc-catalog-board__empty">Could not load catalog. Open School from the dashboard while logged in, or check Services in Fixfy OS directly.</p>';
        });
      });
  }

  return { lessons: { "products-services-board": lesson }, hydrateCatalogBoards: hydrateCatalogBoards };
})();
