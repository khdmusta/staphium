/* ============================================================================
 * CMS CLIENT — Supabase + imgbb wrapper (shared by site & dashboard)
 * - Reads keys from window.RZG_CMS_CONFIG (assets/js/cms-config.js)
 * - Requires supabase-js UMD global `supabase` (CDN). If CDN/config missing,
 *   reads fail CLOSED (return null) so the site keeps its original Framer
 *   content — zero regression by design.
 * ============================================================================ */
(function () {
  "use strict";

  var cfg = (window.RZG_CMS_CONFIG || {});
  var hasCfg = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
    String(cfg.SUPABASE_URL).indexOf("PASTE_") !== 0);

  var client = null;
  if (hasCfg && typeof window.supabase !== "undefined" && window.supabase.createClient) {
    try { client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY); }
    catch (e) { client = null; }
  }

  function ordered(q) {
    return q.order("sort", { ascending: true }).order("created_at", { ascending: false });
  }

  // Public read (site): published rows only. null = not configured/offline.
  function listPublished(table) {
    if (!client) return Promise.resolve(null);
    return ordered(client.from(table).select("*").eq("is_published", true))
      .then(function (res) {
        if (res.error) throw res.error;
        return res.data || [];
      })
      .catch(function () { return null; });
  }

  function requireSession() {
    if (!client) return Promise.reject(new Error("Supabase NOT_CONFIGURED"));
    return client.auth.getSession().then(function (s) {
      if (!s.data.session) throw new Error("NOT_LOGGED_IN");
      return s.data.session;
    });
  }

  function listAll(table) {
    return requireSession().then(function () {
      return ordered(client.from(table).select("*"));
    }).then(function (res) {
      if (res.error) throw res.error;
      return res.data || [];
    });
  }

  function upsertRow(table, row) {
    return requireSession().then(function () {
      var payload = {};
      Object.keys(row).forEach(function (k) { payload[k] = row[k]; });
      if (!payload.id) delete payload.id;
      return client.from(table).upsert(payload, { onConflict: "id" }).select().single();
    }).then(function (res) {
      if (res.error) throw res.error;
      return res.data;
    });
  }

  function deleteRow(table, id) {
    return requireSession().then(function () {
      return client.from(table).delete().eq("id", id);
    }).then(function (res) {
      if (res.error) throw res.error;
    });
  }

  function getBySlug(table, slug) {
    return requireSession().then(function () {
      return client.from(table).select("*").eq("slug", slug).maybeSingle();
    }).then(function (res) {
      if (res.error) throw res.error;
      return res.data || null;
    });
  }

  // ---- project gallery (project_images) ----
  function listImages(projectId) {
    return requireSession().then(function () {
      return client.from("project_images").select("*").eq("project_id", projectId).order("sort", { ascending: true });
    }).then(function (res) {
      if (res.error) throw res.error;
      return res.data || [];
    });
  }

  function listPublishedImages() {
    if (!client) return Promise.resolve(null);
    return client.from("project_images").select("*").order("sort", { ascending: true })
      .then(function (res) {
        if (res.error) throw res.error;
        return res.data || [];
      })
      .catch(function () { return null; });
  }

  function replaceImages(projectId, urls) {
    return requireSession().then(function () {
      return client.from("project_images").delete().eq("project_id", projectId);
    }).then(function (res) {
      if (res.error) throw res.error;
      if (!urls || !urls.length) return [];
      var rows = urls.map(function (u, i) {
        return { project_id: projectId, image_url: u, sort: i };
      });
      return client.from("project_images").insert(rows).select();
    }).then(function (res) {
      if (res.error) throw res.error;
      return res.data || [];
    });
  }

  function countAllImages() {
    return requireSession().then(function () {
      return client.from("project_images").select("id", { count: "exact", head: true });
    }).then(function (res) {
      if (res.error) throw res.error;
      return res.count || 0;
    }).catch(function () { return 0; });
  }
  function imgbbKey() {
    var k = cfg.IMGBB_API_KEY || "";
    if (!k || String(k).indexOf("PASTE_") === 0) throw new Error("IMGBB_NOT_CONFIGURED");
    return k;
  }

  // Downscale image to max 1600px JPEG dataURL (keeps uploads fast)
  function fileToDataURL(file, maxDim) {
    maxDim = maxDim || 1600;
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var w = img.naturalWidth, h = img.naturalHeight;
          var s = Math.min(1, maxDim / Math.max(w, h));
          var cw = Math.max(1, Math.round(w * s)), ch = Math.max(1, Math.round(h * s));
          var c = document.createElement("canvas");
          c.width = cw; c.height = ch;
          c.getContext("2d").drawImage(img, 0, 0, cw, ch);
          URL.revokeObjectURL(url);
          resolve(c.toDataURL("image/jpeg", 0.84));
        } catch (e) { URL.revokeObjectURL(url); reject(e); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("BAD_IMAGE")); };
      img.src = url;
    });
  }

  // Upload dataURL to imgbb with progress (XHR). Resolves display URL.
  function uploadImage(file, onProgress) {
    var key = imgbbKey();
    if (typeof onProgress !== "function") onProgress = function () {};
    return fileToDataURL(file).then(function (dataUrl) {
      var base64 = dataUrl.split(",")[1];
      return new Promise(function (resolve, reject) {
        var fd = new FormData();
        fd.append("image", base64);
        try { fd.append("name", (file.name || "upload").replace(/\.[^.]+$/, "").slice(0, 60)); } catch (e) {}
        var xhr = new XMLHttpRequest();
        xhr.open("POST", "https://api.imgbb.com/1/upload?key=" + encodeURIComponent(key));
        xhr.upload.onprogress = function (ev) {
          if (ev.lengthComputable) onProgress(Math.round(ev.loaded / ev.total * 100));
        };
        xhr.onload = function () {
          try {
            var j = JSON.parse(xhr.responseText);
            if (xhr.status >= 200 && xhr.status < 300 && j && j.data) {
              onProgress(100);
              resolve(j.data.display_url || j.data.url);
            } else {
              reject(new Error(((j && j.error && j.error.message) || ("HTTP " + xhr.status))));
            }
          } catch (e) { reject(e); }
        };
        xhr.onerror = function () { reject(new Error("NETWORK")); };
        onProgress(5);
        xhr.send(fd);
      });
    });
  }

  // ---- site settings (single row id=1; public read, auth write) ----
  function getSettings() {
    if (!client) return Promise.resolve(null);
    return client.from("site_settings").select("*").eq("id", 1).maybeSingle()
      .then(function (res) {
        if (res.error) throw res.error;
        return res.data || null;
      })
      .catch(function () { return null; });
  }

  function saveSettings(patch) {
    return requireSession().then(function () {
      var payload = { id: 1 };
      ["email", "x_url", "linkedin_url", "copyright_text", "contact_title"].forEach(function (k) {
        if (patch[k] != null) payload[k] = String(patch[k]).trim();
      });
      return client.from("site_settings").upsert(payload, { onConflict: "id" }).select().single();
    }).then(function (res) {
      if (res.error) throw res.error;
      return res.data;
    });
  }

  window.RZG_CMS = {
    configured: hasCfg && !!client,
    configReady: hasCfg,
    cdnReady: (typeof window.supabase !== "undefined"),
    getClient: function () { return client; },
    listPublished: listPublished,
    listAll: listAll,
    upsertRow: upsertRow,
    deleteRow: deleteRow,
    getBySlug: getBySlug,
    getSettings: getSettings,
    saveSettings: saveSettings,
    listImages: listImages,
    listPublishedImages: listPublishedImages,
    replaceImages: replaceImages,
    countAllImages: countAllImages,
    uploadImage: uploadImage
  };
})();
