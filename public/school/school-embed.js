(function () {
  var embedded = window.self !== window.top;
  if (embedded) {
    document.documentElement.classList.add("school-embedded");
    var style = document.createElement("style");
    style.textContent =
      "html.school-embedded .school-nav," +
      "html.school-embedded .school-progress-top { display: none !important; }" +
      "html.school-embedded .school-main { margin-left: 0 !important; padding-top: 0 !important; }";
    document.head.appendChild(style);
    return;
  }
  var link = document.createElement("a");
  link.href = "/school";
  link.textContent = "← Back to Fixfy School";
  link.setAttribute(
    "style",
    "position:fixed;top:12px;right:12px;z-index:9999;padding:8px 14px;" +
      "background:#020040;color:#fff;font:600 13px -apple-system,sans-serif;border-radius:8px;" +
      "text-decoration:none;box-shadow:0 4px 16px rgba(0,0,0,.25)",
  );
  document.body.appendChild(link);
})();
