/* ============================================================================
 * ADMIN — dashboard logic (Supabase Auth + CRUD + imgbb uploads)
 * Pages: login → tabs (projects / testimonials / posts) → modal form
 * All content Arabic-first (RTL). Images upload to imgbb, URLs stored in
 * Supabase rows. Publish = is_published flag read by content-render.js.
 * ============================================================================ */
(function () {
  "use strict";

  /* ---------------- helpers ---------------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function toast(msg, isErr) {
    var box = $("#toasts");
    var d = document.createElement("div");
    d.className = "toast" + (isErr ? " err" : "");
    d.textContent = msg;
    box.appendChild(d);
    setTimeout(function () { d.remove(); }, 3400);
  }
  function api() { return window.RZG_CMS; }

  /* ---------------- table configs ---------------- */
  var TABLES = {
    projects: {
      title: "المشاريع",
      singular: "مشروع",
      thumbKey: "image_url",
      thumbRound: false,
      titleKey: "title",
      subKey: "caption",
      fields: [
        { key: "title", label: "اسم المشروع", type: "text", required: true },
        { key: "slug", label: "الرابط (slug)", type: "text", required: true, ltr: true,
          hint: "أحرف إنجليزية صغيرة وأرقام وشرطات فقط — يظهر في ./projects/xxx" },
        { key: "caption", label: "السطر التعريفي", type: "textarea", required: true },
        { key: "image_url", label: "صورة المشروع", type: "image", required: true },
        { key: "sort", label: "الترتيب (الأصغر أولاً)", type: "number" }
      ]
    },
    testimonials: {
      title: "آراء العملاء",
      singular: "رأي",
      thumbKey: "avatar_url",
      thumbRound: true,
      titleKey: "name",
      subKey: "quote",
      fields: [
        { key: "name", label: "اسم العميل", type: "text", required: true },
        { key: "role", label: "الصفة / الشركة", type: "text" },
        { key: "quote", label: "نص التعليق", type: "textarea", required: true },
        { key: "avatar_url", label: "صورة العميل", type: "image", required: true },
        { key: "rating", label: "التقييم (1 - 5)", type: "number", min: 1, max: 5 },
        { key: "sort", label: "الترتيب (الأصغر أولاً)", type: "number" }
      ]
    },
    posts: {
      title: "المدونة",
      singular: "مقال",
      thumbKey: "cover_url",
      thumbRound: false,
      titleKey: "title",
      subKey: "excerpt",
      fields: [
        { key: "title", label: "عنوان المقال", type: "text", required: true },
        { key: "slug", label: "الرابط (slug)", type: "text", required: true, ltr: true,
          hint: "أحرف إنجليزية صغيرة وأرقام وشرطات فقط — يظهر في ./blog/xxx" },
        { key: "excerpt", label: "الملخص (يظهر في البطاقة)", type: "textarea", required: true },
        { key: "body", label: "نص المقال الكامل", type: "tall", required: true },
        { key: "cover_url", label: "صورة الغلاف", type: "image", required: true },
        { key: "date_label", label: "التاريخ المعروض (مثال: مارس 2025)", type: "text", required: true },
        { key: "published_at", label: "تاريخ النشر (للترتيب)", type: "date" },
        { key: "sort", label: "الترتيب (الأصغر أولاً)", type: "number" }
      ]
    }
  };

  var state = { table: "projects", rows: { projects: [], testimonials: [], posts: [] }, editing: null };

  /* ---------------- auth ---------------- */
  function showLogin(msg) {
    $("#login-view").classList.remove("hidden");
    $("#app-view").classList.add("hidden");
    if (msg) { var e = $("#login-err"); e.textContent = msg; e.style.display = "block"; }
  }
  function showApp() {
    $("#login-view").classList.add("hidden");
    $("#app-view").classList.remove("hidden");
  }
  function authError(ar, raw) {
    var m = String((raw && raw.message) || raw || "");
    if (m.indexOf("Invalid login") >= 0) return "بيانات الدخول غير صحيحة";
    if (m.indexOf("Failed to fetch") >= 0 || m.indexOf("NETWORK") >= 0) return "تعذر الاتصال — تحقق من الإنترنت وإعداد Supabase";
    return ar || "حدث خطأ — حاول مجدداً";
  }

  function boot() {
    if (!api() || !api().configured) {
      showLogin("أكمل الإعداد أولاً: الصق مفاتيح Supabase في assets/js/cms-config.js — راجع docs/CMS-SETUP.md");
      $("#login-btn").disabled = true;
      var w = $("#cfg-warn");
      return;
    }
    var client = api().getClient();
    client.auth.getSession().then(function (s) {
      if (s.data.session) { showApp(); loadAll(); }
      else showLogin();
    }).catch(function () { showLogin(); });
    client.auth.onAuthStateChange(function (ev, session) {
      if (session) { showApp(); loadAll(); } else showLogin();
    });

    $("#login-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var btn = $("#login-btn");
      btn.disabled = true;
      $("#login-err").style.display = "none";
      client.auth.signInWithPassword({
        email: $("#login-email").value.trim(),
        password: $("#login-pass").value
      }).then(function (res) {
        if (res.error) throw res.error;
        showApp(); loadAll();
      }).catch(function (err) {
        var e = $("#login-err");
        e.textContent = authError(null, err);
        e.style.display = "block";
      }).finally(function () { btn.disabled = false; });
    });

    $("#logout-btn").addEventListener("click", function () {
      client.auth.signOut().finally(function () { location.reload(); });
    });

    wireSettings();
  }

  /* ---------------- tabs ---------------- */
  document.querySelectorAll(".rzg-tab").forEach(function (t) {
    t.addEventListener("click", function () {
      document.querySelectorAll(".rzg-tab").forEach(function (x) { x.classList.remove("active"); });
      t.classList.add("active");
      state.table = t.getAttribute("data-tab");
      ["projects", "testimonials", "posts", "settings"].forEach(function (k) {
        $("#panel-" + k).classList.toggle("hidden", k !== state.table);
      });
      if (state.table === "settings") loadSettings();
    });
  });
  document.querySelectorAll("[data-new]").forEach(function (b) {
    b.addEventListener("click", function () { openForm(b.getAttribute("data-new"), null); });
  });

  /* ---------------- lists ---------------- */
  function loadAll() {
    ["projects", "testimonials", "posts"].forEach(loadTable);
    loadSettings();
    var w = $("#cfg-warn");
    if (!api().configReady) { w.textContent = "ملف الإعداد غير مكتمل — راجع docs/CMS-SETUP.md"; w.style.display = "block"; }
  }

  function loadTable(table) {
    var list = $("#list-" + table);
    list.innerHTML = '<div class="loading-line">جارٍ التحميل…</div>';
    api().listAll(table).then(function (rows) {
      state.rows[table] = rows;
      renderList(table);
    }).catch(function (err) {
      list.innerHTML = '<div class="empty">تعذر التحميل: ' + esc(err.message || err) + "</div>";
    });
  }

  function renderList(table) {
    var cfg = TABLES[table];
    var list = $("#list-" + table);
    var rows = state.rows[table];
    if (!rows.length) {
      list.innerHTML = '<div class="empty">لا عناصر بعد — اضغط «' + esc("جديد") + "» للإضافة</div>";
      return;
    }
    list.innerHTML = "";
    rows.forEach(function (row) {
      var card = document.createElement("div");
      card.className = "card";
      var thumb = row[cfg.thumbKey]
        ? '<img class="thumb' + (cfg.thumbRound ? " round" : "") + '" src="' + esc(row[cfg.thumbKey]) + '" alt="">'
        : '<div class="thumb"></div>';
      card.innerHTML =
        thumb +
        '<div class="card-body">' +
          '<div class="card-title">' + esc(row[cfg.titleKey] || "—") + "</div>" +
          '<div class="card-sub">' + esc(row[cfg.subKey] || "") + "</div>" +
          (row.is_published
            ? '<span class="badge pub">منشور</span>'
            : '<span class="badge draft">مسودة</span>') +
          '<div class="card-actions">' +
            '<button class="btn btn-secondary btn-small" data-act="edit">تعديل</button>' +
            '<button class="btn btn-secondary btn-small" data-act="toggle">' +
              (row.is_published ? "إلغاء النشر" : "نشر") + "</button>" +
            '<button class="btn btn-danger btn-small" data-act="del">حذف</button>' +
          "</div>" +
        "</div>";
      card.querySelector('[data-act="edit"]').addEventListener("click", function () { openForm(table, row); });
      card.querySelector('[data-act="toggle"]').addEventListener("click", function () { quickToggle(table, row); });
      card.querySelector('[data-act="del"]').addEventListener("click", function () { openConfirm(table, row); });
      list.appendChild(card);
    });
  }

  function quickToggle(table, row) {
    var patch = { id: row.id, is_published: !row.is_published };
    api().upsertRow(table, patch).then(function () {
      toast(row.is_published ? "أُلغي النشر" : "تم النشر في الموقع");
      loadTable(table);
    }).catch(function (err) { toast("فشل: " + (err.message || err), true); });
  }

  /* ---------------- modal ---------------- */
  var overlay = $("#overlay"), modalTitle = $("#modal-title"),
      modalBody = $("#modal-body"), modalErr = $("#modal-err"),
      btnSave = $("#modal-save"), btnDraft = $("#modal-draft"), btnCancel = $("#modal-cancel");

  function openOverlay() { overlay.classList.add("open"); modalErr.style.display = "none"; }
  function closeOverlay() { overlay.classList.remove("open"); state.editing = null; }
  btnCancel.addEventListener("click", closeOverlay);
  overlay.addEventListener("click", function (ev) { if (ev.target === overlay) closeOverlay(); });

  function setFoot(mode) {
    // mode: form | confirm | behance (behance uses its own publish bar)
    var beh = (mode === "behance");
    document.querySelector(".modal").classList.toggle("wide", beh);
    document.querySelector(".modal-foot").style.display = beh ? "none" : "";
    btnSave.style.display = mode === "form" ? "" : "none";
    btnDraft.style.display = mode === "form" ? "" : "none";
  }

  function fieldHTML(f, val) {
    var v = val == null ? "" : val;
    var html = '<div class="field" data-field="' + f.key + '">';
    html += "<label>" + esc(f.label) + (f.required ? " *" : "") + "</label>";
    if (f.type === "textarea" || f.type === "tall") {
      html += '<textarea class="input' + (f.type === "tall" ? " tall" : "") + '" data-key="' + f.key + '">' + esc(v) + "</textarea>";
    } else if (f.type === "number") {
      html += '<input class="input" type="number" data-key="' + f.key + '" value="' + esc(v === "" ? "" : v) + '"'
        + (f.min != null ? ' min="' + f.min + '"' : "") + (f.max != null ? ' max="' + f.max + '"' : "") + ">";
    } else if (f.type === "date") {
      html += '<input class="input" type="date" data-key="' + f.key + '" value="' + esc(v || "") + '">';
    } else if (f.type === "image") {
      html += '<div class="uploader" data-uploader="' + f.key + '">'
        + '<img class="preview" alt="">'
        + '<input type="hidden" data-key="' + f.key + '" value="' + esc(v) + '">'
        + '<input type="file" accept="image/*" style="display:none">'
        + '<button type="button" class="btn btn-secondary btn-small browse">اختر صورة من الجهاز</button>'
        + '<div class="progress"><div></div></div>'
        + '<input class="input url" dir="ltr" placeholder="…أو الصق رابط صورة" value="' + esc(v) + '" style="margin-top:10px">'
        + '<div class="hint">الرفع يتم إلى imgbb تلقائياً — أو الصق رابطاً جاهزاً</div>'
        + "</div>";
    } else {
      html += '<input class="input" type="text" data-key="' + f.key + '" value="' + esc(v) + '"'
        + (f.ltr ? ' dir="ltr"' : "") + ">";
    }
    if (f.hint) html += '<div class="hint">' + esc(f.hint) + "</div>";
    html += "</div>";
    return html;
  }

  function openForm(table, row) {
    if (table === "projects") { openProjectForm(row); return; }
    var cfg = TABLES[table];
    state.editing = { table: table, id: row ? row.id : null };
    setFoot("form");
    modalTitle.textContent = (row ? "تعديل " : cfg.singular + " جديد");
    var html = "";
    cfg.fields.forEach(function (f) {
      var dv = "";
      if (row && row[f.key] != null) dv = row[f.key];
      else if (f.type === "number") dv = f.key === "sort" ? 0 : (f.key === "rating" ? 5 : "");
      html += fieldHTML(f, dv);
    });
    var pub = row ? !!row.is_published : true;
    html += '<div class="field"><div class="switch-row"><label style="margin:0">منشور في الموقع</label>'
      + '<label class="switch"><input type="checkbox" data-key="is_published"' + (pub ? " checked" : "")
      + '><span class="slider"></span></label></div></div>';
    modalBody.innerHTML = html;
    modalBody.querySelectorAll("[data-uploader]").forEach(wireUploader);
    openOverlay();
  }

  /* ---- Behance-style project editor: cover first, live card preview ---- */
  function openProjectForm(row) {
    state.editing = { table: "projects", id: row ? row.id : null };
    setFoot("behance");
    modalTitle.textContent = row ? "تحرير المشروع" : "انشر مشروعاً جديداً";
    var r = row || {};
    modalBody.innerHTML =
      '<div class="field bh-cover"><label>صورة الغلاف *</label>' +
        '<div class="uploader" data-uploader="image_url">' +
          '<img class="preview" alt="">' +
          '<input type="hidden" data-key="image_url" value="' + esc(r.image_url || "") + '">' +
          '<input type="file" accept="image/*" style="display:none">' +
          '<div class="bh-cover-empty"><div class="big">+</div><div>اسحب صورة الغلاف هنا أو اختر من جهازك</div>' +
          '<div style="margin-top:10px"><button type="button" class="btn btn-secondary btn-small browse">اختر صورة الغلاف</button></div></div>' +
          '<div class="progress"><div></div></div>' +
          '<div class="bh-cover-tools"><input class="input url" dir="ltr" placeholder="…أو الصق رابط صورة" value="' + esc(r.image_url || "") + '"></div>' +
          '<div class="hint">تُرفع إلى imgbb تلقائياً — الأفضل أفقية بدقة عالية</div>' +
        "</div></div>" +
      '<div class="field"><input class="input bh-title-input" data-key="title" value="' + esc(r.title || "") + '" placeholder="اسم المشروع *"></div>' +
      '<div class="bh-preview-label">معاينة البطاقة كما ستظهر في الموقع</div>' +
      '<div class="bh-preview-card"><img alt=""><div class="shade"></div>' +
        '<div class="txt"><div class="t"></div><div class="c"></div></div></div>' +
      '<div class="field" style="margin-top:16px"><label>السطر التعريفي *</label>' +
        '<textarea class="input" data-key="caption" placeholder="مثال: استراتيجية علامة وتجربة رقمية">' + esc(r.caption || "") + "</textarea></div>" +
      '<div class="bh-grid">' +
        '<div class="field"><label>الرابط (slug) *</label>' +
          '<input class="input" dir="ltr" data-key="slug" value="' + esc(r.slug || "") + '" placeholder="project-name">' +
          '<div class="hint">إنجليزية صغيرة وأرقام وشرطات — ./projects/xxx</div></div>' +
        '<div class="field"><label>الترتيب (الأصغر أولاً)</label>' +
          '<input class="input" type="number" data-key="sort" value="' + esc(r.sort != null ? r.sort : 0) + '"></div>' +
      "</div>" +
      '<div class="publish-bar">' +
        '<label class="switch"><input type="checkbox" data-key="is_published"' + (row ? (row.is_published ? " checked" : "") : " checked") + '><span class="slider"></span></label>' +
        '<span class="publish-state">منشور في الموقع</span><span class="spacer"></span>' +
        '<button type="button" class="btn btn-secondary" data-bh="draft">حفظ مسودة</button>' +
        '<button type="button" class="btn btn-secondary" data-bh="cancel">إلغاء</button>' +
        '<button type="button" class="btn btn-primary" data-bh="publish">نشر المشروع</button>' +
      "</div>";

    var box = modalBody.querySelector("[data-uploader]");
    wireUploader(box);

    function refreshPreview() {
      var title = (modalBody.querySelector('[data-key="title"]') || {}).value || "اسم المشروع";
      var cap = (modalBody.querySelector('[data-key="caption"]') || {}).value || "السطر التعريفي";
      var src = box.querySelector("img.preview").src || "";
      var card = modalBody.querySelector(".bh-preview-card");
      card.querySelector(".t").textContent = title;
      card.querySelector(".c").textContent = cap;
      var ci = card.querySelector("img");
      if (src) { ci.src = src; ci.style.display = "block"; }
      else ci.style.display = "none";
      var empty = box.querySelector(".bh-cover-empty");
      if (empty) empty.style.display = src ? "none" : "";
    }
    modalBody.querySelector('[data-key="title"]').addEventListener("input", refreshPreview);
    modalBody.querySelector('[data-key="caption"]').addEventListener("input", refreshPreview);
    box.querySelector("input.url").addEventListener("input", function () { setTimeout(refreshPreview, 0); });
    box.addEventListener("preview-update", refreshPreview);
    refreshPreview();

    modalBody.querySelector('[data-bh="publish"]').addEventListener("click", function () { saveFlow(true); });
    modalBody.querySelector('[data-bh="draft"]').addEventListener("click", function () { saveFlow(false); });
    modalBody.querySelector('[data-bh="cancel"]').addEventListener("click", closeOverlay);
    var sw = modalBody.querySelector('[data-key="is_published"]');
    var lbl = modalBody.querySelector(".publish-state");
    function syncLbl() { lbl.textContent = sw.checked ? "منشور في الموقع" : "مسودة (مخفي)"; }
    sw.addEventListener("change", syncLbl);
    syncLbl();
    // keep publish switch in sync when using the bar buttons
    var pubBtn = modalBody.querySelector('[data-bh="publish"]');
    var drfBtn = modalBody.querySelector('[data-bh="draft"]');
    pubBtn.addEventListener("click", function () { sw.checked = true; });
    drfBtn.addEventListener("click", function () { sw.checked = false; });
    openOverlay();
  }

  function collectForm(table) {
    var cfg = TABLES[table];
    var data = {};
    var firstBad = null;
    cfg.fields.forEach(function (f) {
      var input = modalBody.querySelector('[data-key="' + f.key + '"]');
      var val = input ? input.value : "";
      if (typeof val === "string") val = val.trim();
      if (f.type === "number") val = val === "" ? 0 : Number(val);
      if (f.required && (val === "" || val == null)) firstBad = firstBad || f;
      if (f.key === "slug" && val && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(val)) firstBad = firstBad || f;
      data[f.key] = val;
    });
    var pub = modalBody.querySelector('[data-key="is_published"]');
    data.is_published = pub ? !!pub.checked : true;
    return { data: data, bad: firstBad };
  }

  function saveFlow(publish) {
    var ed = state.editing;
    if (!ed) return;
    var c = collectForm(ed.table);
    if (c.bad) {
      modalErr.textContent = c.bad.key === "slug"
        ? "الرابط (slug) يجب أن يكون أحرفاً إنجليزية صغيرة وأرقاماً وشرطات فقط"
        : "أكمل الحقل المطلوب: " + c.bad.label;
      modalErr.style.display = "block";
      return;
    }
    if (publish === true) c.data.is_published = true;
    if (publish === false) c.data.is_published = false;
    if (ed.id) c.data.id = ed.id;
    btnSave.disabled = true; btnDraft.disabled = true;
    api().upsertRow(ed.table, c.data).then(function () {
      toast(publish === false ? "حُفظ كمسودة" : "تم الحفظ والنشر");
      closeOverlay();
      loadTable(ed.table);
    }).catch(function (err) {
      modalErr.textContent = "فشل الحفظ: " + (err.message || err);
      modalErr.style.display = "block";
    }).finally(function () { btnSave.disabled = false; btnDraft.disabled = false; });
  }
  btnSave.addEventListener("click", function () { saveFlow(true); });
  btnDraft.addEventListener("click", function () { saveFlow(false); });

  /* ---------------- image uploader ---------------- */
  function wireUploader(box) {
    var fileInput = box.querySelector('input[type="file"]');
    var urlInput = box.querySelector("input.url");
    var hidden = box.querySelector('input[type="hidden"]');
    var preview = box.querySelector("img.preview");
    var bar = box.querySelector(".progress");
    var fill = bar.querySelector("div");

    function showPreview(src) {
      if (src) { preview.src = src; preview.style.display = "block"; }
      else preview.style.display = "none";
    }
    showPreview(hidden.value);
    box.querySelector(".browse").addEventListener("click", function () { fileInput.click(); });
    urlInput.addEventListener("input", function () {
      hidden.value = urlInput.value.trim();
      showPreview(hidden.value);
    });
    fileInput.addEventListener("change", function () {
      var f = fileInput.files && fileInput.files[0];
      if (!f) return;
      showPreview(URL.createObjectURL(f));
      bar.style.display = "block";
      fill.style.width = "0";
      api().uploadImage(f, function (p) { fill.style.width = p + "%"; }).then(function (url) {
        hidden.value = url;
        urlInput.value = url;
        showPreview(url);
        try { box.dispatchEvent(new Event("preview-update", { bubbles: true })); } catch (e) {}
        toast("تم رفع الصورة");
      }).catch(function (err) {
        var m = err.message || String(err);
        if (m === "IMGBB_NOT_CONFIGURED") m = "مفتاح imgbb غير مُعد في cms-config.js";
        toast("فشل الرفع: " + m, true);
      }).finally(function () {
        setTimeout(function () { bar.style.display = "none"; }, 600);
        fileInput.value = "";
      });
    });
  }

  /* ---------------- site settings ---------------- */
  var SET_KEYS = ["email", "x_url", "linkedin_url", "copyright_text", "contact_title"];
  var SET_IDS = { email: "set-email", x_url: "set-x", linkedin_url: "set-linkedin", copyright_text: "set-copyright", contact_title: "set-contact" };

  function loadSettings() {
    api().getSettings().then(function (s) {
      if (!s) return;
      SET_KEYS.forEach(function (k) {
        var el = document.getElementById(SET_IDS[k]);
        if (el && s[k] != null) el.value = s[k];
      });
    }).catch(function () { /* optional section; silent */ });
  }

  function wireSettings() {
    var form = $("#settings-form");
    if (!form || form.getAttribute("data-wired")) return;
    form.setAttribute("data-wired", "1");
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var btn = $("#settings-save");
      var err = $("#settings-err");
      err.style.display = "none";
      var patch = {};
      SET_KEYS.forEach(function (k) { patch[k] = document.getElementById(SET_IDS[k]).value; });
      btn.disabled = true;
      api().saveSettings(patch).then(function () {
        toast("تم حفظ إعدادات الموقع وتطبيقها");
      }).catch(function (e) {
        var m = String((e && e.message) || e || "");
        err.textContent = (m.indexOf("site_settings") >= 0 || m.indexOf("relation") >= 0 || m.indexOf("schema cache") >= 0)
          ? "جدول الإعدادات غير موجود — نفّذ supabase/migration-002-site-settings.sql في Supabase ثم أعد المحاولة"
          : "فشل الحفظ: " + m;
        err.style.display = "block";
      }).finally(function () { btn.disabled = false; });
    });
  }

  /* ---------------- delete confirm ---------------- */
  function openConfirm(table, row) {
    var cfg = TABLES[table];
    state.editing = { table: table, id: row.id, del: true };
    setFoot("confirm");
    // reuse foot: hide save/draft, inject confirm buttons
    modalTitle.textContent = "حذف " + cfg.singular;
    modalBody.innerHTML = '<p>سيتم حذف «' + esc(row[cfg.titleKey] || "") + "» نهائياً من الموقع. هل أنت متأكد؟</p>";
    var foot = document.querySelector(".modal-foot");
    var old = $("#modal-del-yes");
    if (old) old.remove();
    var yes = document.createElement("button");
    yes.id = "modal-del-yes";
    yes.className = "btn btn-danger";
    yes.textContent = "حذف نهائي";
    yes.addEventListener("click", function () {
      yes.disabled = true;
      api().deleteRow(table, row.id).then(function () {
        toast("تم الحذف");
        closeOverlay();
        yes.remove();
        loadTable(table);
      }).catch(function (err) {
        modalErr.textContent = "فشل الحذف: " + (err.message || err);
        modalErr.style.display = "block";
        yes.disabled = false;
      });
    });
    foot.insertBefore(yes, btnCancel);
    // when closing, cleanup is handled next open; ensure removal on close:
    var obs = new MutationObserver(function () {
      if (!overlay.classList.contains("open")) { var y = $("#modal-del-yes"); if (y) y.remove(); obs.disconnect(); }
    });
    obs.observe(overlay, { attributes: true, attributeFilter: ["class"] });
    openOverlay();
  }

  /* ---------------- boot ---------------- */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else { boot(); }
})();
