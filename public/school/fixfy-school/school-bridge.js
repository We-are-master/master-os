/* Fixfy School — bridge to master-os progress API (embedded in dashboard iframe) */
(function () {
  var STORAGE_KEY = "fixfy_school_progress_v2";
  var QUIZ_PASS = 5;
  var params = new URLSearchParams(window.location.search);
  var embedded = params.get("embed") === "1" || window.self !== window.top;
  var pagehideBound = false;

  function emptyProgress() {
    return {
      completedLessonIds: [],
      lastLessonId: null,
      unlockedAt: { zendesk: new Date().toISOString() },
      quizStars: {},
    };
  }

  function readLocal() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyProgress();
      var p = JSON.parse(raw);
      return {
        completedLessonIds: Array.isArray(p.completedLessonIds) ? p.completedLessonIds : [],
        lastLessonId: typeof p.lastLessonId === "string" ? p.lastLessonId : null,
        unlockedAt: Object.assign({ zendesk: new Date().toISOString() }, p.unlockedAt || {}),
        quizStars: p.quizStars || {},
      };
    } catch (e) {
      return emptyProgress();
    }
  }

  function writeLocal(progress) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    } catch (e) {}
  }

  function mergeProgress(local, remote) {
    var localIds = local.completedLessonIds || [];
    var remoteIds = remote.completedLessonIds || [];
    var seen = {};
    var mergedIds = [];
    localIds.concat(remoteIds).forEach(function (id) {
      if (!seen[id]) {
        seen[id] = true;
        mergedIds.push(id);
      }
    });
    var quizStars = Object.assign({}, local.quizStars || {});
    var remoteStars = remote.quizStars || {};
    Object.keys(remoteStars).forEach(function (phase) {
      quizStars[phase] = Math.max(quizStars[phase] || 0, remoteStars[phase] || 0);
    });
    return {
      completedLessonIds: mergedIds,
      lastLessonId: remote.lastLessonId || local.lastLessonId || null,
      unlockedAt: Object.assign({}, local.unlockedAt || {}, remote.unlockedAt || {}),
      quizStars: quizStars,
    };
  }

  async function persist(progress, attempt) {
    writeLocal(progress);
    var tries = typeof attempt === "number" ? attempt : 0;
    try {
      var res = await fetch("/api/school/progress", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(progress),
        keepalive: true,
      });
      if (!res.ok && tries < 2) {
        await new Promise(function (r) {
          setTimeout(r, 400 * (tries + 1));
        });
        return persist(progress, tries + 1);
      }
      return res.ok;
    } catch (e) {
      if (tries < 2) {
        await new Promise(function (r) {
          setTimeout(r, 400 * (tries + 1));
        });
        return persist(progress, tries + 1);
      }
      return false;
    }
  }

  window.FX_SCHOOL_BRIDGE = {
    embedded: embedded,
    progress: readLocal(),
    profileSummary: null,
    isAdmin: false,

    init: async function () {
      if (embedded) document.documentElement.classList.add("fx-embed");
      try {
        var res = await fetch("/api/school/progress", { credentials: "include" });
        if (res.ok) {
          var data = await res.json();
          if (data.progress) {
            var local = readLocal();
            this.progress = mergeProgress(local, data.progress);
            writeLocal(this.progress);
            if (this.progress.completedLessonIds.length > (data.progress.completedLessonIds || []).length) {
              void persist(this.progress);
            }
          }
          this.profileSummary = data.profileSummary || null;
          this.isAdmin = Boolean(data.isAdmin || (data.profileSummary && data.profileSummary.isAdmin));
        }
      } catch (e) {}
      if (typeof window !== "undefined" && !pagehideBound) {
        pagehideBound = true;
        window.addEventListener("pagehide", function () {
          var p = readLocal();
          if (p.completedLessonIds && p.completedLessonIds.length) {
            void persist(p);
          }
        });
      }
      return this.progress;
    },

    isLessonComplete: function (id) {
      return (this.progress.completedLessonIds || []).indexOf(id) !== -1;
    },

    completeLesson: async function (id) {
      if (!this.isLessonComplete(id)) {
        this.progress.completedLessonIds = this.progress.completedLessonIds.concat([id]);
      }
      this.progress.lastLessonId = id;
      await persist(this.progress);
      return this.progress;
    },

    setLastLesson: async function (id) {
      if (this.progress.lastLessonId === id) return;
      this.progress.lastLessonId = id;
      await persist(this.progress);
    },

    quizStars: function (phaseId) {
      return (this.progress.quizStars && this.progress.quizStars[phaseId]) || 0;
    },

    isPhaseQuizPassed: function (phaseId) {
      return this.quizStars(phaseId) >= QUIZ_PASS;
    },

    navigate: function (path) {
      if (window.parent !== window) {
        window.parent.postMessage({ type: "fixfy-school-navigate", path: path }, window.location.origin);
      } else {
        window.location.href = path;
      }
    },

    backToOs: function () {
      this.navigate("/");
    },
  };
})();
