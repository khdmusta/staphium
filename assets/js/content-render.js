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

  // Skills lock: 9 cards in DOM order (3 categories x responsive copies).
  // Category = floor(cardIndex / 3). Titles + 5 items each, texts only.
  var SKILL_T = ["خبرات التصميم", "الفن ثلاثي الأبعاد", "السرد البصري"];
  var SKILL_I = [
    ["الهوية البصرية", "التصميم الجرافيكي", "الحملات البصرية", "تصميم الملصقات", "التصميم التحريري"],
    ["تصميم المشاهد ثلاثية الأبعاد", "النمذجة ثلاثية الأبعاد", "الخامات والإضاءة", "الإخراج البصري", "التحريك ثلاثي الأبعاد"],
    ["تطوير الفكرة والمفهوم", "بناء العوالم البصرية", "السرد بالصورة", "الإخراج الفني", "صناعة المشاهد البصرية"]
  ];

  function skillCards() {
    var scope = document.getElementById("skills");
    if (!scope) return [];
    return scope.querySelectorAll('div[data-framer-name="Title"]');
  }

  function applySkills() {
    var titles = skillCards();
    if (titles.length !== 9) return 0;
    var n = 0;
    for (var k = 0; k < 9; k++) {
      var cat = Math.floor(k / 3);
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
    if (titles.length !== 9) return false;
    for (var k = 0; k < 9; k++) {
      var cat = Math.floor(k / 3);
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
    if (nav) targets.push(nav);
    if (hero) targets.push(hero);
    if (about) targets.push(about);
    if (skills) targets.push(skills);
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
    window.addEventListener("load", function () {
      setTimeout(function () { try { applyBrand(); } catch (e) {} brandGuard(); }, 900);
    });
    brandGuard();
    if (!window.RZG_CMS || !window.RZG_CMS.configured) return; // fallback: Framer content
    Promise.all([
      window.RZG_CMS.listPublished("projects"),
      window.RZG_CMS.listPublished("testimonials"),
      window.RZG_CMS.listPublished("posts"),
      window.RZG_CMS.getSettings()
    ]).then(function (r) {
      state.projects = r[0]; state.testimonials = r[1]; state.posts = r[2]; state.settings = r[3];
      paint();
      guard();
      window.addEventListener("load", function () { setTimeout(function () { paint(); guard(); }, 900); });
    }).catch(function () { /* keep Framer fallback */ });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else { boot(); }
})();
