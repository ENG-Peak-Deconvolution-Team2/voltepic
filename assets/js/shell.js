/* Site shell — a classic (blocking) script in <head>: theme before first paint, and the
   <pd-nav> / <pd-footer> elements, which render as the parser reaches them (no layout shift). */
(function () {
  try {
    var stored = localStorage.getItem("pd-theme");
    var dark = stored ? stored === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  } catch (e) {
    document.documentElement.dataset.theme = "light";
  }

  var PAGES = [
    ["app.html", "Analyzer"],
    ["method.html", "Method"],
    ["explainability.html", "Explainability"],
    ["data.html", "Dataset"],
    ["model.html", "Model card"],
    ["about.html", "About"],
  ];
  var here = location.pathname.split("/").pop() || "index.html";
  var REPO = "https://github.com/ENG-Peak-Deconvolution-Team2/analysis-dashboard";
  var TEAM = "https://eng-peak-deconvolution-team2.github.io/project-dashboard/";

  var LOGO = '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="1" y="1" width="30" height="30" rx="9" fill="currentColor" opacity=".07"/>'
    + '<path d="M5 22.5c3 0 3.6-12 6.6-12 2.8 0 2.8 8.5 5 8.5 2 0 2-5.6 4.4-5.6 2.5 0 3 9.1 6 9.1" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'
    + '<path d="M9.5 25.5h4M18 25.5h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="1.6 2.4" opacity=".55"/></svg>';
  var ICON = {
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5" stroke-linecap="round"/></svg>',
    sun: '<svg class="i-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></svg>',
    moon: '<svg class="i-moon" viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>',
    menu: '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    arrow: '<svg class="arrow" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  };

  function nav() {
    var links = PAGES.map(function (p) {
      return '<a href="' + p[0] + '"' + (p[0] === here ? ' aria-current="page"' : "") + ">" + p[1] + "</a>";
    }).join("");
    return '<nav class="site-nav" aria-label="Main"><div class="container nav-inner">'
      + '<a class="logo" href="index.html" aria-label="Peak Deconvolution, home">' + LOGO + "<span>Peak Deconvolution</span><small>TEAM 2</small></a>"
      + '<div class="nav-links" id="navLinks">' + links + "</div>"
      + '<div class="nav-tools">'
      + '<button class="kbd-btn" data-palette aria-label="Search pages and samples">' + ICON.search + '<span class="kbd-label">Search</span><kbd>Ctrl K</kbd></button>'
      + '<button class="icon-btn" data-theme-toggle aria-label="Toggle colour theme">' + ICON.sun + ICON.moon + "</button>"
      + (here === "app.html" ? "" : '<a class="btn btn-primary btn-sm nav-cta" href="app.html">Open analyzer' + ICON.arrow + "</a>")
      + '<button class="icon-btn nav-burger" data-burger aria-label="Open menu" aria-expanded="false" aria-controls="navLinks">' + ICON.menu + "</button>"
      + "</div></div></nav>";
  }

  function footer() {
    var col = function (title, items) {
      return "<div><h4>" + title + "</h4><ul>" + items.map(function (i) {
        var ext = /^https?:/.test(i[0]);
        return '<li><a href="' + i[0] + '"' + (ext ? ' target="_blank" rel="noopener"' : "") + ">" + i[1] + (ext ? " ↗" : "") + "</a></li>";
      }).join("") + "</ul></div>";
    };
    return '<footer class="site-footer"><div class="container">'
      + '<div class="foot-grid">'
      + '<div><a class="logo" href="index.html">' + LOGO + "<span>Peak Deconvolution</span></a>"
      + '<p class="foot-blurb">Detection of four biomarkers from square-wave voltammograms, with explanations that were tested before they were trusted. ENG project, Team 2.</p></div>'
      + col("Product", [["app.html", "Analyzer"], ["method.html", "Method"], ["explainability.html", "Explainability"]])
      + col("Evidence", [["data.html", "Dataset"], ["model.html", "Model card"], ["model.html#parity", "Reference check"]])
      + col("Project", [["about.html", "About &amp; team"], [TEAM, "Team dashboard"], [REPO, "Source code"]])
      + "</div>"
      + '<div class="foot-base"><span>Data: ML-Biomarker-Sensing, Duesselberg et al., <i>ACS Electrochem.</i> 2 (2026) 1444–1452 · MIT licence</span>'
      + "<span>Everything runs in your browser — no measurement leaves this page.</span></div>"
      + "</div></footer>";
  }

  function element(name, render) {
    customElements.define(name, class extends HTMLElement {
      connectedCallback() {
        var tpl = document.createElement("template");
        tpl.innerHTML = render();
        this.replaceWith(tpl.content);
      }
    });
  }
  element("pd-nav", nav);
  element("pd-footer", footer);
})();
