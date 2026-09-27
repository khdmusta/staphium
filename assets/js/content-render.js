/* ============================================================================
 * CONTENT RENDER — paints Supabase CMS content into the Framer site
 * ----------------------------------------------------------------------------
 * Strategy (zero-risk to UI/UX):
 *  - The site keeps its original Framer SSR content as fallback.
 *  - If CMS is not configured / offline / table empty → do NOTHING.
 *  - Else: fill the EXISTING card DOM (same classes, same CSS) by cloning
 *    the site's own templates. Design is 100% preserved — only text/images
 *    and links change.
 *  - Framer's client bundle may re-render grids after hydration → a
 *    MutationObserver re-applies our content (capped) when that happens.
 * Sections:
 *  - Projects:     grid [Projects Grid] / slot article[Project Card CMS Item]
 *  - Testimonials: grid [Testimonial Grid] / slot div[Testimonial Card]
 *  - Articles:     section [Articles] / slots a[Featured] + a[Default]
 * ============================================================================ */
(function () {
  "use strict";

  var MAX_REAPPLY = 6;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  function setText(container, text) {
    if (!container) return;
    var t = container.querySelector("h1,h2,h3,h4,h5,h6,p");
    if (t) t.textContent = text;
  }

  function setImg(img, url, alt) {
    if (!img || !url) return;
    img.removeAttribute("srcset");
    img.removeAttribute("sizes");
    img.setAttribute("src", url);
    if (alt) img.setAttribute("alt", alt);
  }

  /* ---------- slot fillers (update ALL responsive copies inside slot) ----- */
  function fillProject(slot, row) {
    $all('a[href*="./projects/"]', slot).forEach(function (a) {
      a.setAttribute("href", "./projects/" + row.slug);
    });
    $all('[data-framer-name="H4"]', slot).forEach(function (c) { setText(c, row.title); });
    $all('[data-framer-name="Caption"]', slot).forEach(function (c) { setText(c, row.caption || ""); });
    $all("img", slot).forEach(function (img) { setImg(img, row.image_url, row.title); });
  }

  function fillTestimonial(slot, row) {
    $all('[data-framer-name="Quote"] p', slot).forEach(function (p) { p.textContent = row.quote; });
    var box = slot.querySelector('[data-framer-name="Name & Role"]');
    if (box) {
      var ps = box.querySelectorAll("p");
      if (ps[0]) ps[0].textContent = row.name;
      if (ps[1]) ps[1].textContent = row.role || "";
    }
    $all('[data-framer-name="Avatar"] img', slot).forEach(function (img) { setImg(img, row.avatar_url, row.name); });
  }

  function fillPost(slot, row) {
    var links = [];
    if (slot.tagName === "A") links.push(slot);
    $all('a[href*="./blog/"]', slot).forEach(function (a) { links.push(a); });
    links.forEach(function (a) { a.setAttribute("href", "./blog/" + row.slug); });
    $all("img", slot).forEach(function (img) { setImg(img, row.cover_url, row.title); });
    $all('[data-framer-name="H3"]', slot).forEach(function (c) { setText(c, row.title); });
    $all('[data-framer-name="Date"]', slot).forEach(function (c) {
      var time = c.querySelector("time");
      if (time) {
        time.textContent = row.date_label || "";
        if (row.published_at) time.setAttribute("datetime", row.published_at);
      } else { setText(c, row.date_label || ""); }
    });
    $all('[data-framer-name="Description"]', slot).forEach(function (c) { setText(c, row.excerpt || ""); });
  }

  /* ---------- variant-aware grouping --------------------------------------
   * Cards are duplicated per breakpoint (ssr-variant wrappers). Slots sharing
   * the same wrapper signature are the same variant; the signature sequence
   * repeats per content item. We detect the period and fill whole groups so
   * desktop/phone copies always stay consistent.
   */
  function slotSig(slot) {
    var w = slot.closest(".ssr-variant");
    var wc = w ? w.className : "";
    return (slot.getAttribute("data-framer-name") || "") + "||" + wc;
  }

  function detectPeriod(sigs) {
    if (sigs.length < 2) return 1;
    for (var p = 1; p <= Math.floor(sigs.length / 2); p++) {
      var ok = true;
      for (var i = 0; i < sigs.length; i++) {
        if (sigs[i] !== sigs[i % p]) { ok = false; break; }
      }
      if (ok) return p;
    }
    return 1;
  }

  // Top-level unit = the direct child of the grid wrapping this slot.
  // Cloning/hiding the top keeps breakpoint variants consistent.
  function topUnit(slot, grid) {
    var top = slot;
    while (top.parentElement && top.parentElement !== grid) top = top.parentElement;
    return (top === grid) ? slot : top;
  }

  function cloneTop(slot, grid) {
    var c = topUnit(slot, grid).cloneNode(true);
    c.querySelectorAll("[data-cms]").forEach(function (n) { n.removeAttribute("data-cms"); n.removeAttribute("data-cms-id"); });
    c.style.display = "";
    return c;
  }

  // Fill slots with rows. Returns true if applied.
  // - Fewer groups than rows → clone last group's tops until enough (capped).
  // - More groups than rows → extra groups hidden (their tops get display:none).
  function applyToSlots(grid, slotSel, rows, fill) {
    if (!grid || !rows || !rows.length) return false;
    var slots = $all(slotSel, grid).filter(function (s) { return grid.contains(s); });
    if (!slots.length) return false;
    var period = detectPeriod(slots.map(slotSig));
    var groups = [];
    for (var i = 0; i < slots.length; i += period) groups.push(slots.slice(i, i + period));

    // grow: clone last group until we have enough (safety cap 40 rounds)
    var guardN = 0;
    while (groups.length < rows.length && guardN < 40) {
      var last = groups[groups.length - 1];
      last.forEach(function (s) { grid.appendChild(cloneTop(s, grid)); });
      slots = $all(slotSel, grid);
      groups = [];
      for (var k = 0; k < slots.length; k += period) groups.push(slots.slice(k, k + period));
      guardN++;
    }

    for (var r = 0; r < groups.length; r++) {
      var group = groups[r];
      if (r < rows.length) {
        group.forEach(function (s) {
          topUnit(s, grid).style.display = "";
          fill(s, rows[r]);
          s.setAttribute("data-cms", "1");
          s.setAttribute("data-cms-id", String(rows[r].id));
        });
      } else {
        group.forEach(function (s) { topUnit(s, grid).style.display = "none"; });
      }
    }
    return true;
  }

  // Mirror mode: every slot shows the SAME row (for the Featured card whose
  // desktop/phone copies share one post). Nothing hidden, nothing cloned.
  function applyMirror(grid, slotSel, row, fill) {
    if (!grid || !row) return false;
    var slots = $all(slotSel, grid).filter(function (s) { return grid.contains(s); });
    if (!slots.length) return false;
    slots.forEach(function (s) {
      topUnit(s, grid).style.display = "";
      fill(s, row);
      s.setAttribute("data-cms", "1");
      s.setAttribute("data-cms-id", String(row.id));
    });
    return true;
  }

  /* ---------- sections ---------------------------------------------------- */
  function applyProjects(rows) {
    var grid = $('[data-framer-name="Projects Grid"]');
    if (!grid) return false;
    return applyToSlots(grid, 'article[data-framer-name="Project Card CMS Item"]', rows, fillProject);
  }

  function applyTestimonials(rows) {
    var grid = $('[data-framer-name="Testimonial Grid"]');
    if (!grid) return false;
    return applyToSlots(grid, '[data-framer-name="Testimonial Card"]', rows, fillTestimonial);
  }

  function applyPosts(rows) {
    var scope = document.querySelector('section[data-framer-name="Articles"]') || document;
    var featured = $all('a[data-framer-name="Featured"]', scope);
    var defaults = $all('a[data-framer-name="Default"]', scope);
    if (!featured.length && !defaults.length) return false;
    var ok = false;
    if (featured.length && rows.length) {
      // first post is the featured one → mirror into all Featured copies
      ok = applyMirror(scope, 'a[data-framer-name="Featured"]', rows[0], fillPost) || ok;
    }
    if (defaults.length && rows.length > 1) {
      ok = applyToSlots(scope, 'a[data-framer-name="Default"]', rows.slice(1), fillPost) || ok;
    } else if (defaults.length && rows.length === 1) {
      // single post → hide default cards, keep featured
      defaults.forEach(function (s) { topUnit(s, scope).style.display = "none"; });
      ok = true;
    }
    return ok;
  }

  /* ---------- site settings → footer --------------------------------------
   * Single public row (site_settings id=1) paints contact/social/copyright.
   * Same zero-risk rule: missing values leave the original Framer content.
   */
  function applySettings(s) {
    if (!s) return false;
    var f = document.querySelector('footer[data-framer-name="Footer"]') ||
      document.querySelector('[data-framer-name="Footer"]');
    if (!f) return false;
    var touched = false;
    if (s.email) {
      $all('a[data-framer-name="Email"]', f).forEach(function (a) { a.setAttribute("href", "mailto:" + s.email); });
      $all('a[href^="mailto:"]', f).forEach(function (a) { a.setAttribute("href", "mailto:" + s.email); });
      touched = true;
    }
    if (s.x_url) {
      $all('a[data-framer-name="X"]', f).forEach(function (a) { a.setAttribute("href", s.x_url); });
      $all('a[href*="x.com"]', f).forEach(function (a) { a.setAttribute("href", s.x_url); });
      touched = true;
    }
    if (s.linkedin_url) {
      $all('a[data-framer-name="LinkedIn"]', f).forEach(function (a) { a.setAttribute("href", s.linkedin_url); });
      $all('a[href*="linkedin.com"]', f).forEach(function (a) { a.setAttribute("href", s.linkedin_url); });
      touched = true;
    }
    if (s.copyright_text) {
      var ps = f.querySelectorAll('[data-framer-name="Copyright"] p');
      if (ps.length > 1) { ps[ps.length - 1].textContent = s.copyright_text; touched = true; }
      else if (ps.length === 1) { ps[0].textContent = s.copyright_text; touched = true; }
    }
    if (s.contact_title) {
      $all('[data-framer-name="Contact Panel"] h3', f).forEach(function (h) { h.textContent = s.contact_title; });
      touched = true;
    }
    if (touched) f.setAttribute("data-cms-settings", "1");
    return touched;
  }

  /* ---------- static brand lock -------------------------------------------
   * Framer's client bundle re-renders static texts from its own payload
   * during hydration, wiping HTML-only edits. This layer re-applies the
   * brand texts after load and guards them with a capped observer.
   * ONLY these texts are touched: nav logo, hero title (2 responsive
   * copies), hero roles paragraph. Nothing else on the page, ever.
   */
  var BRAND_NAME = "Staphium (مصطفى)";
  var ROLE_L1 = ["فنان", "بصري", "|", "مصمم", "جرافيك", "|", "فنان", "ثلاثي", "الأبعاد"];
  var ROLE_L2 = ["سرد", "بصري", "بدقة", "متناهية."];

  /* ---------- about lock (same hydration-proofing, texts only) ------------
   * Heading (animated word spans, 6 words) + first Philosophy paragraph.
   * Runtime-created spans get visible styles (see rebuildWasf note).
   */
  var ABOUT_H = ["أصنع", "عوالم", "بصرية", "تروي", "أفكارًا", "حقيقية"];
  var ABOUT_S1 = "أحوّل الأفكار إلى عوالم بصرية لها قصة.";
  var ABOUT_REST = "أعمل بين التصميم الجرافيكي والفن البصري وثلاثي الأبعاد، حيث أبحث عن الطريقة التي يمكن للفكرة أن تتحول بها إلى مشهد، إحساس، وتجربة تُرى قبل أن تُشرح. من الهوية البصرية إلى المشاهد ثلاثية الأبعاد، أبني كل عمل انطلاقًا من مفهوم واضح، ثم أطوّره عبر التكوين، الإضاءة، اللون والتفاصيل لصناعة لغة بصرية متكاملة. بالنسبة لي، الصورة ليست مجرد شكل جميل؛ إنها وسيلة للسرد، وبناء الإحساس، وإيصال فكرة تبقى في الذاكرة.";

  function sanitizeAnimStyle(st) {
    return String(st || "")
      .replace(/-webkit-filter\s*:[^;]+;?/g, "")
      .replace(/(^|;)\s*filter\s*:[^;]+;?/g, "$1")
      .replace(/(^|;)\s*opacity\s*:[^;]+;?/g, "$1")
      .replace(/(^|;)\s*transform\s*:[^;]+;?/g, "$1")
      .replace(/;{2,}/g, ";");
  }

  function aboutWordSpans(h2) {
    var all = h2.querySelectorAll("span");
    var words = [];
    for (var i = 0; i < all.length; i++) {
      if (!all[i].querySelector("span") && all[i].textContent !== "") words.push(all[i]);
    }
    return words;
  }

  function applyAboutHeading() {
    var h2 = document.querySelector('#about h2[data-styles-preset="s9_2EumJG"]');
    if (!h2) return 0;
    var ws = aboutWordSpans(h2);
    if (!ws.length) return 0;
    var changed = 0;
    for (var i = 0; i < ABOUT_H.length; i++) {
      var slot = ws[i];
      if (!slot) {
        var c = ws[ws.length - 1].cloneNode(false);
        c.setAttribute("style", sanitizeAnimStyle(c.getAttribute("style")));
        c.textContent = ABOUT_H[i];
        var lastTop = ws[ws.length - 1];
        lastTop.parentNode.insertBefore(document.createTextNode(" "), lastTop.nextSibling);
        lastTop.parentNode.insertBefore(c, lastTop.nextSibling.nextSibling);
        ws.push(c);
        changed++;
      } else if (slot.textContent !== ABOUT_H[i]) { slot.textContent = ABOUT_H[i]; changed++; }
    }
    while (ws.length > ABOUT_H.length) {
      var extra = ws.pop();
      if (extra.parentNode) extra.parentNode.removeChild(extra);
      changed++;
    }
    return changed ? 1 : 0;
  }

  function applyAboutP1() {
    var box = document.querySelector("#about div.framer-279i20");
    if (!box) return 0;
    var ps = box.querySelectorAll("p");
    if (!ps.length) return 0;
    var first = ps[0];
    var cur = first.textContent || "";
    if (cur.indexOf(ABOUT_S1) === 0 && cur.indexOf("تبقى في الذاكرة") >= 0) return 0;
    var lead = first.querySelector("span");
    var color = lead ? (lead.getAttribute("style") || "") : "";
    first.innerHTML = '<span style="' + color + '" class="framer-text"><strong class="framer-text">' +
      escHtml(ABOUT_S1) + "</strong></span> " + escHtml(ABOUT_REST);
    return 1;
  }

  // Skills lock: category comes from the outer card wrapper name
  // (Card - EN 1 / AR 2 / AR 3), so it works with any number of
  // responsive copies (React prunes inactive breakpoint variants).
  // Titles + 5 items each, texts only.
  var SKILL_T = ["الأدوات والمنصات", "الفن ثلاثي الأبعاد", "التصميم الجرافيكي"];
  var SKILL_I = [
    ["Adobe Photoshop", "Adobe Illustrator", "Blender", "After effect", "Premier Pro"],
    ["النمذجة ثلاثية الأبعاد", "تصميم المشاهد", "الخامات والإضاءة", "الإخراج ثلاثي الأبعاد", "التحريك البصري"],
    ["الهوية البصرية", "الحملات البصرية", "الملصقات", "التصميم التحريري", "التكوين البصري"]
  ];

  function skillCat(titleEl) {
    var el = titleEl;
    while (el && el !== document.body) {
      var nm = el.getAttribute ? el.getAttribute("data-framer-name") : null;
      if (nm === "Card - EN 1") return 0;
      if (nm === "Card - AR 2") return 1;
      if (nm === "Card - AR 3") return 2;
      el = el.parentElement;
    }
    return -1;
  }

  function skillCards() {
    var scope = document.getElementById("skills");
    if (!scope) return [];
    return scope.querySelectorAll('div[data-framer-name="Title"]');
  }

  function applySkills() {
    var titles = skillCards();
    if (!titles.length) return 0;
    var n = 0;
    for (var k = 0; k < titles.length; k++) {
      var cat = skillCat(titles[k]);
      if (cat < 0) continue;
      var h = titles[k].querySelector("h6");
      if (h && h.textContent !== SKILL_T[cat]) { h.textContent = SKILL_T[cat]; n++; }
      var card = titles[k].closest('div[data-framer-name="Container"]');
      var scope2 = card || titles[k].parentNode;
      var ps = scope2.querySelectorAll('div[data-framer-name="Item"] p');
      for (var j = 0; j < Math.min(5, ps.length); j++) {
        if (ps[j].textContent !== SKILL_I[cat][j]) { ps[j].textContent = SKILL_I[cat][j]; n++; }
      }
    }
    return n;
  }

  function skillsNeedApply() {
    var titles = skillCards();
    if (!titles.length) return false;
    for (var k = 0; k < titles.length; k++) {
      var cat = skillCat(titles[k]);
      if (cat < 0) continue;
      var h = titles[k].querySelector("h6");
      if (h && h.textContent !== SKILL_T[cat]) return true;
      var card = titles[k].closest('div[data-framer-name="Container"]');
      var scope2 = card || titles[k].parentNode;
      var ps = scope2.querySelectorAll('div[data-framer-name="Item"] p');
      for (var j = 0; j < Math.min(5, ps.length); j++) {
        if (ps[j].textContent !== SKILL_I[cat][j]) return true;
      }
    }
    return false;
  }
  // Services lock: 3 categories in DOM order. Title words + service
  // pills (Big/Sm variants grouped separately so pruned copies still map
  // correctly). Texts only; runtime clones get visible styles.
  var SVC_T = [
    ["التصميم", "البصري"],
    ["الفن", "ثلاثي", "الأبعاد"],
    ["السرد", "والإخراج", "الفني"]
  ];
  var SVC_I = [
    ["التصميم الجرافيكي", "الهوية البصرية", "التصميم الإعلاني", "تصميم الملصقات", "التكوين والإخراج البصري"],
    ["النمذجة ثلاثية الأبعاد", "تصميم المشاهد", "الإضاءة والخامات", "الإخراج ثلاثي الأبعاد", "التحريك ثلاثي الأبعاد"],
    ["تطوير الأفكار والمفاهيم", "السرد البصري", "بناء العوالم البصرية", "الإخراج الفني", "التوجيه البصري"]
  ];

  function svcCats() {
    var all = document.querySelectorAll('div[data-framer-name="Category & Service Blocks"]');
    var out = [];
    for (var i = 0; i < all.length && i < 3; i++) out.push(all[i]);
    return out;
  }

  function pillVariant(h5) {
    var el = h5;
    while (el && el !== document.body) {
      var nm = el.getAttribute ? el.getAttribute("data-framer-name") : null;
      if (nm === "Big" || nm === "Sm") return nm;
      el = el.parentElement;
    }
    return "";
  }

  function variantWrapper(h5) {
    var el = h5;
    while (el && el !== document.body) {
      var cl = el.getAttribute ? (el.getAttribute("class") || "") : "";
      if ((" " + cl + " ").indexOf(" ssr-variant ") >= 0) return el;
      el = el.parentElement;
    }
    return null;
  }

  function sanitizeDeep(root) {
    var els = root.querySelectorAll("*");
    for (var i = 0; i < els.length; i++) {
      var st = els[i].getAttribute("style");
      if (st) els[i].setAttribute("style", sanitizeAnimStyle(st));
    }
    var rs = root.getAttribute ? root.getAttribute("style") : null;
    if (rs) root.setAttribute("style", sanitizeAnimStyle(rs));
  }

  function applyServices() {
    var cats = svcCats();
    if (!cats.length) return 0;
    var n = 0;
    for (var k = 0; k < cats.length; k++) {
      var h5s = cats[k].querySelectorAll('h5[data-styles-preset="rDMpVgWRC"]');
      var th = null, hi;
      for (hi = 0; hi < h5s.length; hi++) {
        if (h5s[hi].querySelector("span")) { th = h5s[hi]; break; }
      }
      if (th) {
        var spans = [];
        var all2 = th.querySelectorAll("span");
        for (var s = 0; s < all2.length; s++) {
          if (!all2[s].querySelector("span")) spans.push(all2[s]);
        }
        var want = SVC_T[k];
        for (var w = 0; w < want.length; w++) {
          if (spans[w]) {
            if (spans[w].textContent !== want[w]) { spans[w].textContent = want[w]; n++; }
          } else if (spans.length) {
            var c = document.createElement("span");
            c.setAttribute("style", sanitizeAnimStyle(spans[spans.length - 1].getAttribute("style")));
            c.textContent = want[w];
            th.appendChild(document.createTextNode(" "));
            th.appendChild(c);
            spans.push(c);
            n++;
          }
        }
        while (spans.length > want.length) {
          var ex = spans.pop();
          var prev = ex.previousSibling;
          if (prev && prev.nodeType === 3) prev.parentNode.removeChild(prev);
          if (ex.parentNode) ex.parentNode.removeChild(ex);
          n++;
        }
      }
      var bigs = [], sms = [];
      var pills = cats[k].querySelectorAll('div[data-framer-name="App Design"] h5');
      for (var q = 0; q < pills.length; q++) {
        var v = pillVariant(pills[q]);
        if (v === "Sm") sms.push(pills[q]);
        else bigs.push(pills[q]);
      }
      if (bigs.length < 5 || sms.length < 5) return true;
      for (var b = 0; b < bigs.length && b < SVC_I[k].length; b++) {
        if (bigs[b].textContent !== SVC_I[k][b]) { bigs[b].textContent = SVC_I[k][b]; n++; }
      }
      for (var m = 0; m < sms.length && m < SVC_I[k].length; m++) {
        if (sms[m].textContent !== SVC_I[k][m]) { sms[m].textContent = SVC_I[k][m]; n++; }
      }
    }
    return n;
  }

  function servicesNeedApply() {
    var cats = svcCats();
    if (!cats.length) return false;
    for (var k = 0; k < cats.length; k++) {
      var h5s = cats[k].querySelectorAll('h5[data-styles-preset="rDMpVgWRC"]');
      var th = null, hi;
      for (hi = 0; hi < h5s.length; hi++) {
        if (h5s[hi].querySelector("span")) { th = h5s[hi]; break; }
      }
      if (th) {
        var spans = [];
        var all2 = th.querySelectorAll("span");
        for (var s = 0; s < all2.length; s++) {
          if (!all2[s].querySelector("span")) spans.push(all2[s]);
        }
        if (spans.length !== SVC_T[k].length) return true;
        for (var w = 0; w < SVC_T[k].length; w++) {
          if (spans[w].textContent !== SVC_T[k][w]) return true;
        }
      }
      var bigs = [], sms = [];
      var pills = cats[k].querySelectorAll('div[data-framer-name="App Design"] h5');
      for (var q = 0; q < pills.length; q++) {
        var v = pillVariant(pills[q]);
        if (v === "Sm") sms.push(pills[q]);
        else bigs.push(pills[q]);
      }
      // grow pruned/dropped variants back to 5 (clone last wrapper, visible styles)
      var grow = 0;
      while ((bigs.length < 5 || sms.length < 5) && grow < 3) {
        grow++;
        if (bigs.length < 5 && bigs.length) {
          var wb = variantWrapper(bigs[bigs.length - 1]);
          if (wb && wb.parentNode) {
            var cb = wb.cloneNode(true);
            sanitizeDeep(cb);
            wb.parentNode.appendChild(cb);
          }
        }
        if (sms.length < 5 && sms.length) {
          var ws2 = variantWrapper(sms[sms.length - 1]);
          if (ws2 && ws2.parentNode) {
            var cs = ws2.cloneNode(true);
            sanitizeDeep(cs);
            ws2.parentNode.appendChild(cs);
          }
        }
        bigs = []; sms = [];
        var pills2 = cats[k].querySelectorAll('div[data-framer-name="App Design"] h5');
        for (var q2 = 0; q2 < pills2.length; q2++) {
          var v2 = pillVariant(pills2[q2]);
          if (v2 === "Sm") sms.push(pills2[q2]);
          else bigs.push(pills2[q2]);
        }
      }
      for (var b = 0; b < bigs.length && b < SVC_I[k].length; b++) {
        if (bigs[b].textContent !== SVC_I[k][b]) return true;
      }
      for (var m2 = 0; m2 < sms.length && m2 < SVC_I[k].length; m2++) {
        if (sms[m2].textContent !== SVC_I[k][m2]) return true;
      }
    }
    return false;
  }
  // Deleted paragraph guard: the "designing interfaces" paragraph was
  // removed by request. If hydration restores it, drop it again.
  // Scoped strictly to the Philosophy box; matches by its unique phrase.
  var ABOUT_DROP_MARK = "تصميم واجهات";

  // Portrait lock: personal photo replaced by request (assets/img/photo.jpg).
  // If hydration restores the old Framer URL, swap it back.
  var PORTRAIT_OLD = "4p9mLKoeZ1tiXrKIhn4h9kLajI";
  var PORTRAIT_OLD2 = "9AKT1fZbDSvRjKLD6qnAdbpHEJw";
  var PORTRAIT_SRC = "assets/img/photo.jpg";

  function applyPortrait() {
    var marks = [PORTRAIT_OLD, PORTRAIT_OLD2];
    var n = 0;
    for (var k = 0; k < marks.length; k++) {
      var imgs = document.querySelectorAll('img[src*="' + marks[k] + '"]');
      for (var i = 0; i < imgs.length; i++) {
        imgs[i].removeAttribute("srcset");
        imgs[i].removeAttribute("sizes");
        imgs[i].setAttribute("src", PORTRAIT_SRC);
        n++;
      }
    }
    var nav = document.querySelector('img[src="' + PORTRAIT_SRC + '"][width="160"]');
    if (nav && nav.style.objectFit !== "cover") { nav.style.objectFit = "cover"; n++; }
    return n;
  }

  function portraitNeedsApply() {
    if (document.querySelectorAll('img[src*="' + PORTRAIT_OLD + '"],img[src*="' + PORTRAIT_OLD2 + '"]').length > 0) return true;
    // nav avatar must stay cover (not fill) or the portrait looks squished
    var nav = document.querySelector('img[src="' + PORTRAIT_SRC + '"][width="160"]');
    if (nav && nav.style.objectFit !== "cover") return true;
    return false;
  }

  // Name / Title card lock (About details).
  var CARD_NAME = "مصطفى";
  var CARD_ROLE = "مصمم بصري ومصمم جرافيك و فنان ثلاثي الابعاد";

  function applyNameTitle() {
    var box = document.querySelector('div[data-framer-name="Name / Title"]');
    if (!box) return 0;
    var n = 0;
    var h = box.querySelector("h4");
    if (h && h.textContent !== CARD_NAME) { h.textContent = CARD_NAME; n++; }
    var p = box.querySelector("p");
    if (p && p.textContent !== CARD_ROLE) { p.textContent = CARD_ROLE; n++; }
    return n;
  }

  function nameTitleNeedsApply() {
    var box = document.querySelector('div[data-framer-name="Name / Title"]');
    if (!box) return false;
    var h = box.querySelector("h4");
    if (h && h.textContent !== CARD_NAME) return true;
    var p = box.querySelector("p");
    if (p && p.textContent !== CARD_ROLE) return true;
    return false;
  }

  function applyAboutDrop() {
    var box = document.querySelector("#about div.framer-279i20");
    if (!box) return 0;
    var ps = box.querySelectorAll("p");
    var n = 0;
    for (var i = ps.length - 1; i >= 0; i--) {
      var tx = ps[i].textContent || "";
      if (tx.indexOf(ABOUT_DROP_MARK) >= 0) {
        if (ps[i].parentNode) ps[i].parentNode.removeChild(ps[i]);
        n++;
      }
    }
    return n;
  }

  function aboutNeedsApply() {
    var h2 = document.querySelector('#about h2[data-styles-preset="s9_2EumJG"]');
    if (h2) {
      var ws = aboutWordSpans(h2);
      if (ws.length !== ABOUT_H.length) return true;
      for (var i = 0; i < ABOUT_H.length; i++) if (ws[i].textContent !== ABOUT_H[i]) return true;
    }
    var box = document.querySelector("#about div.framer-279i20");
    if (box && box.querySelector("p")) {
      var ft = box.querySelector("p").textContent || "";
      if (ft.indexOf(ABOUT_S1) !== 0) return true;
      var all = box.querySelectorAll("p");
      for (var j = 0; j < all.length; j++) {
        if ((all[j].textContent || "").indexOf(ABOUT_DROP_MARK) >= 0) return true;
      }
    }
    if (portraitNeedsApply()) return true;
    if (nameTitleNeedsApply()) return true;
    if (skillsNeedApply()) return true;
    if (servicesNeedApply()) return true;
    return false;
  }

  function escHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function wasfSequence(p) {
    var seq = [];
    for (var i = 0; i < p.childNodes.length; i++) {
      var n = p.childNodes[i];
      if (n.nodeType === 1 && n.tagName === "SPAN") seq.push(n.textContent);
      else if (n.nodeType === 1 && n.tagName === "BR") seq.push("BR");
    }
    return seq;
  }

  function wasfDesired() { return ROLE_L1.concat(["BR"], ROLE_L2); }

  function sameSeq(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function rebuildWasf(p) {
    var first = p.querySelector("span");
    if (!first) return false;
    // Use the original span style BUT strip the appear-animation initial
    // state (opacity/filter/transform): runtime-injected nodes are created
    // after Framer's animator has already run, so keeping the hidden
    // initial state would leave them invisible forever. Fresh page loads
    // keep the static HTML untouched, so the native animation still plays.
    var st = (first.getAttribute("style") || "")
      .replace(/-webkit-filter\s*:[^;]+;?/g, "")
      .replace(/(^|;)\s*filter\s*:[^;]+;?/g, "$1")
      .replace(/(^|;)\s*opacity\s*:[^;]+;?/g, "$1")
      .replace(/(^|;)\s*transform\s*:[^;]+;?/g, "$1")
      .replace(/;{2,}/g, ";");
    var html = "";
    var toks = wasfDesired();
    for (var i = 0; i < toks.length; i++) {
      if (toks[i] === "BR") html += ' <br class="framer-text"> ';
      else html += '<span style="' + st + '">' + escHtml(toks[i]) + "</span> ";
    }
    p.innerHTML = html.replace(/ $/, "");
    return true;
  }

  function brandNeedsApply() {
    var navP = document.querySelector('a[data-framer-name="Logo Content"] p');
    if (navP && navP.textContent !== BRAND_NAME) return true;
    var hs = document.querySelectorAll('h1[data-styles-preset="fxFFIrFXJ"] span');
    for (var i = 0; i < hs.length; i++) if (hs[i].textContent !== BRAND_NAME) return true;
    var wp = document.querySelector('p[data-styles-preset="ys31T7g4J"]');
    if (wp && !sameSeq(wasfSequence(wp), wasfDesired())) return true;
    if (aboutNeedsApply()) return true;
    return false;
  }

  function applyBrand() {
    var n = 0;
    var navP = document.querySelector('a[data-framer-name="Logo Content"] p');
    if (navP && navP.textContent !== BRAND_NAME) { navP.textContent = BRAND_NAME; n++; }
    var hs = document.querySelectorAll('h1[data-styles-preset="fxFFIrFXJ"] span');
    for (var i = 0; i < hs.length; i++) {
      if (hs[i].textContent !== BRAND_NAME) { hs[i].textContent = BRAND_NAME; n++; }
    }
    var wp = document.querySelector('p[data-styles-preset="ys31T7g4J"]');
    if (wp && !sameSeq(wasfSequence(wp), wasfDesired())) { rebuildWasf(wp); n++; }
    n += applyAboutHeading();
    n += applyAboutP1();
    n += applyAboutDrop();
    n += applyPortrait();
    n += applyNameTitle();
    n += applySkills();
    n += applyServices();
    if (n) state.brandApplies = (state.brandApplies || 0) + 1;
    return n;
  }

  var brandObserver = null, brandTimer = 0;
  function brandGuard() {
    if (brandObserver) brandObserver.disconnect();
    if ((state.brandApplies || 0) >= 8) return;
    var targets = [];
    var nav = document.querySelector('nav[data-framer-name="Header"]');
    var hero = document.getElementById("hero");
    var about = document.getElementById("about");
    var skills = document.getElementById("skills");
    var services = document.getElementById("services");
    if (nav) targets.push(nav);
    if (hero) targets.push(hero);
    if (about) targets.push(about);
    if (skills) targets.push(skills);
    if (services) targets.push(services);
    if (!targets.length) return;
    brandObserver = new MutationObserver(function () {
      clearTimeout(brandTimer);
      brandTimer = setTimeout(function () {
        if (brandNeedsApply()) { applyBrand(); brandGuard(); }
      }, 500);
    });
    targets.forEach(function (el) {
      brandObserver.observe(el, { childList: true, characterData: true, subtree: true });
    });
  }

  /* ---------- project gallery lightbox ------------------------------------
   * Cards keep their exact look and links. If a project has gallery
   * images (cover + extras from Supabase), clicking its card opens a
   * lightbox instead of navigating. Delegated on the grid so it
   * survives re-renders.
   */
  var galData = {}; // slug -> { title, urls[] }

  function buildGalleryMap(projects, images) {
    galData = {};
    var byId = {};
    (projects || []).forEach(function (p) { byId[p.id] = p; });
    (images || []).forEach(function (im) {
      var p = byId[im.project_id];
      if (!p || !p.slug) return;
      if (!galData[p.slug]) {
        galData[p.slug] = {
          title: p.title || "",
          caption: p.caption || "",
          urls: p.image_url ? [p.image_url] : []
        };
      }
      if (im.image_url && galData[p.slug].urls.indexOf(im.image_url) < 0) {
        galData[p.slug].urls.push(im.image_url);
      }
    });
  }

  var lbEl = null, lbUrls = [], lbIdx = 0, lbTitle = "";

  function lbShow(i) {
    if (!lbUrls.length || !lbEl) return;
    lbIdx = ((i % lbUrls.length) + lbUrls.length) % lbUrls.length;
    var img = lbEl.querySelector(".rzg-lb-fig img");
    if (img) { img.src = lbUrls[lbIdx]; img.alt = lbTitle; }
    var cap = lbEl.querySelector(".rzg-lb-fig figcaption");
    if (cap) cap.textContent = lbTitle;
    var cnt = lbEl.querySelector(".rzg-lb-count");
    if (cnt) cnt.textContent = (lbIdx + 1) + " / " + lbUrls.length;
    var ths = lbEl.querySelectorAll(".rzg-lb-thumbs img");
    for (var t = 0; t < ths.length; t++) {
      if (ths[t].classList) ths[t].classList.toggle("on", t === lbIdx);
    }
  }

  function lbKeys(e) {
    if (!lbEl) return;
    if (e.key === "Escape") closeLightbox();
    else if (e.key === "ArrowLeft") lbShow(lbIdx + 1);
    else if (e.key === "ArrowRight") lbShow(lbIdx - 1);
  }

  function closeLightbox() {
    if (lbEl && lbEl.parentNode) lbEl.parentNode.removeChild(lbEl);
    lbEl = null;
    document.removeEventListener("keydown", lbKeys);
  }

  function openLightbox(entry) {
    closeLightbox();
    lbUrls = entry.urls;
    lbTitle = entry.title || "";
    lbEl = document.createElement("div");
    lbEl.className = "rzg-lightbox";
    var thumbs = "";
    if (lbUrls.length > 1) {
      thumbs = '<div class="rzg-lb-thumbs">';
      for (var i = 0; i < lbUrls.length; i++) {
        thumbs += '<img src="' + lbUrls[i] + '" alt="" data-ti="' + i + '">';
      }
      thumbs += "</div>";
    }
    lbEl.innerHTML = '<div class="rzg-lb-backdrop"></div>' +
      '<button type="button" class="rzg-lb-x" aria-label="close">×</button>' +
      '<button type="button" class="rzg-lb-prev" aria-label="prev">‹</button>' +
      '<figure class="rzg-lb-fig"><img alt=""><figcaption></figcaption></figure>' +
      '<button type="button" class="rzg-lb-next" aria-label="next">›</button>' +
      '<div class="rzg-lb-count"></div>' + thumbs;
    document.body.appendChild(lbEl);
    lbEl.querySelector(".rzg-lb-backdrop").addEventListener("click", closeLightbox);
    lbEl.querySelector(".rzg-lb-x").addEventListener("click", closeLightbox);
    lbEl.querySelector(".rzg-lb-prev").addEventListener("click", function () { lbShow(lbIdx - 1); });
    lbEl.querySelector(".rzg-lb-next").addEventListener("click", function () { lbShow(lbIdx + 1); });
    var timgs = lbEl.querySelectorAll(".rzg-lb-thumbs img");
    for (var k = 0; k < timgs.length; k++) {
      (function (idx) {
        timgs[idx].addEventListener("click", function () { lbShow(idx); });
      })(k);
    }
    document.addEventListener("keydown", lbKeys);
    lbShow(0);
  }

  function wireGallery() {
    // Card clicks for OUR published projects navigate to our detail view
    // (rendered below from Supabase). Other cards keep Framer behavior.
    // Delegated on document: survives grid re-renders. Capture phase wins
    // over Framer's own handlers.
    if (document.documentElement.getAttribute("data-cms-gal")) return;
    document.documentElement.setAttribute("data-cms-gal", "1");
    document.addEventListener("click", function (ev) {
      var tgt = ev.target;
      // gallery images inside our detail view -> lightbox
      var gimg = (tgt && tgt.closest) ? tgt.closest(".rzg-project .rzg-pg-grid img") : null;
      if (gimg) {
        var all = Array.prototype.slice.call(
          (gimg.closest(".rzg-project") || document).querySelectorAll(".rzg-pg-grid img"));
        var urls = all.map(function (im) { return im.src; });
        var idx = all.indexOf(gimg);
        var cap = document.querySelector(".rzg-project h1");
        ev.preventDefault();
        ev.stopPropagation();
        openLightbox({ title: cap ? cap.textContent : "", urls: urls.length ? urls : [gimg.src] });
        if (idx > 0) lbShow(idx);
        return;
      }
      var a = (tgt && tgt.closest) ? tgt.closest('a[href*="./projects/"]') : null;
      if (!a) return;
      var grid = document.querySelector('[data-framer-name="Projects Grid"]');
      if (!grid || !grid.contains(a)) return;
      var m = /\.\/projects\/([A-Za-z0-9-]+)/.exec(a.getAttribute("href") || "");
      if (!m) return;
      var entry = galData[m[1]];
      if (!entry) return; // unknown slug -> Framer handles it
      ev.preventDefault();
      ev.stopPropagation();
      goProject(m[1]);
    }, true);
  }

  /* ---------- project detail pages (Supabase) -----------------------------
   * Cards of OUR published projects open a detail view built from Supabase
   * (cover, title, caption, gallery). Original Framer projects are untouched.
   * Works with Framer's SPA navigation (history patch) and with direct
   * loads via 404.html fallback on static hosts.
   */
  var detailSlug = null;
  var homeTitle = document.title;

  function projectSlugFromPath() {
    var m = /\/projects\/([A-Za-z0-9-]+)\/?$/.exec(window.location.pathname);
    return m ? m[1] : null;
  }

  function hideDetail() {
    var d = document.querySelector(".rzg-project");
    if (d && d.parentNode) d.parentNode.removeChild(d);
    var main = document.getElementById("main");
    if (main) main.style.display = "";
    if (detailSlug !== null) {
      detailSlug = null;
      document.title = homeTitle;
    }
  }

  function renderDetail(slug) {
    var entry = galData[slug];
    if (!entry) { hideDetail(); return; }
    hideDetail();
    detailSlug = slug;
    var main = document.getElementById("main");
    if (main) main.style.display = "none";
    var d = document.createElement("div");
    d.className = "rzg-project";
    var gal = "";
    if (entry.urls.length > 1) {
      gal = '<div class="rzg-pg-grid">';
      for (var i = 1; i < entry.urls.length; i++) {
        gal += '<img src="' + entry.urls[i] + '" alt="" loading="lazy">';
      }
      gal += "</div>";
    }
    d.innerHTML =
      '<div class="rzg-pg-inner">' +
        '<button type="button" class="rzg-pg-back">→ عودة للمشاريع</button>' +
        "<h1>" + escHtmlAttr(entry.title) + "</h1>" +
        '<p class="rzg-pg-cap">' + escHtmlAttr(entry.caption || "") + "</p>" +
        (entry.urls.length
          ? '<img class="rzg-pg-hero" src="' + entry.urls[0] + '" alt="">'
          : "") +
        gal +
      "</div>";
    document.body.appendChild(d);
    d.querySelector(".rzg-pg-back").addEventListener("click", function () {
      window.location.assign("../");
    });
    document.title = entry.title + " | Staphium";
    try { window.scrollTo(0, 0); } catch (e) {}
  }

  function escHtmlAttr(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function checkRoute() {
    var slug = projectSlugFromPath();
    if (slug && galData[slug]) {
      if (detailSlug !== slug) renderDetail(slug);
    } else {
      if (detailSlug !== null) hideDetail();
    }
  }

  function goProject(slug) {
    try {
      window.history.pushState({}, "", "./projects/" + slug);
    } catch (e) {
      window.location.assign("./projects/" + slug);
      return;
    }
    setTimeout(checkRoute, 60);
  }

  var _pushState = window.history.pushState;
  var _replaceState = window.history.replaceState;
  window.history.pushState = function () {
    var r = _pushState.apply(this, arguments);
    setTimeout(checkRoute, 60);
    return r;
  };
  window.history.replaceState = function () {
    var r = _replaceState.apply(this, arguments);
    setTimeout(checkRoute, 60);
    return r;
  };
  window.addEventListener("popstate", function () { setTimeout(checkRoute, 60); });

  /* ---------- orchestration ---------------------------------------------- */
  var state = { projects: null, testimonials: null, posts: null, settings: null, applies: 0 };

  function paint() {
    var n = 0;
    if (state.projects && state.projects.length) { if (applyProjects(state.projects)) n++; }
    if (state.testimonials && state.testimonials.length) { if (applyTestimonials(state.testimonials)) n++; }
    if (state.posts && state.posts.length) { if (applyPosts(state.posts)) n++; }
    if (state.settings) { if (applySettings(state.settings)) n++; }
    if (n) state.applies++;
    return n;
  }

  function footerEl() {
    return document.querySelector('footer[data-framer-name="Footer"]') ||
      document.querySelector('[data-framer-name="Footer"]');
  }

  function grids() {
    var list = [
      $('[data-framer-name="Projects Grid"]'),
      $('[data-framer-name="Testimonial Grid"]'),
      document.querySelector('section[data-framer-name="Articles"]')
    ].filter(Boolean);
    var f = footerEl();
    if (f) {
      f.setAttribute("data-cms-scope-settings", "1");
      list.push(f);
    }
    return list;
  }

  var observer = null, reTimer = 0;
  function guard() {
    if (observer) observer.disconnect();
    if (state.applies >= MAX_REAPPLY) return;
    observer = new MutationObserver(function () {
      clearTimeout(reTimer);
      reTimer = setTimeout(function () {
        // re-apply only if Framer wiped our markers
        var wiped = grids().some(function (gr) {
          if (gr.hasAttribute("data-cms-scope-settings")) {
            return !gr.hasAttribute("data-cms-settings");
          }
          var slots = gr.querySelectorAll(
            'article[data-framer-name="Project Card CMS Item"],' +
            '[data-framer-name="Testimonial Card"],' +
            'a[data-framer-name="Featured"],a[data-framer-name="Default"]');
          for (var i = 0; i < slots.length; i++) {
            if (!slots[i].hasAttribute("data-cms") && slots[i].style.display !== "none") return true;
          }
          return false;
        });
        if (wiped) { paint(); guard(); }
      }, 400);
    });
    grids().forEach(function (gr) { observer.observe(gr, { childList: true }); });
  }

  function boot() {
    // Brand lock runs immediately and does NOT wait for the network.
    try { applyBrand(); } catch (e) {}
    wireGallery();
    checkRoute();
    window.addEventListener("load", function () {
      setTimeout(function () { try { applyBrand(); } catch (e) {} brandGuard(); checkRoute(); }, 900);
    });
    brandGuard();
    if (!window.RZG_CMS || !window.RZG_CMS.configured) return; // fallback: Framer content
    Promise.all([
      window.RZG_CMS.listPublished("projects"),
      window.RZG_CMS.listPublished("testimonials"),
      window.RZG_CMS.listPublished("posts"),
      window.RZG_CMS.getSettings(),
      window.RZG_CMS.listPublishedImages()
    ]).then(function (r) {
      state.projects = r[0]; state.testimonials = r[1]; state.posts = r[2]; state.settings = r[3];
      buildGalleryMap(r[0], r[4]);
      paint();
      guard();
      checkRoute();
      window.addEventListener("load", function () { setTimeout(function () { paint(); guard(); checkRoute(); }, 900); });
    }).catch(function () { /* keep Framer fallback */ });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else { boot(); }
})();
