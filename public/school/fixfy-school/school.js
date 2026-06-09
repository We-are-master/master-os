/* Fixfy School — cinematic engine + curriculum from school-curriculum.json */
(function () {
  var bridge = window.FX_SCHOOL_BRIDGE;
  var cinematic = (window.FX_SCHOOL && window.FX_SCHOOL.cinematicLessons) || {};
  var curriculum = null;
  var lessons = {};
  var currentPhaseId = "zendesk";

  var ARTS = [
    "linear-gradient(135deg,#ED4B00,#F58A3C)",
    "linear-gradient(135deg,#0B5FFF,#5B9BFF)",
    "linear-gradient(135deg,#6D28D9,#A06BF0)",
    "linear-gradient(135deg,#0E8A5F,#46C58C)",
    "linear-gradient(135deg,#C47A00,#F0B429)",
    "linear-gradient(135deg,#15153D,#3A3A7E)",
    "linear-gradient(135deg,#0891B2,#43C9E0)",
    "linear-gradient(135deg,#C8102E,#F0617A)",
    "linear-gradient(135deg,#3A3A55,#7C7C92)",
  ];
  var ICONS = [
    "rocket",
    "layout-grid",
    "circle-dot",
    "clipboard-list",
    "zap",
    "git-branch",
    "link",
    "wrench",
    "book-open",
    "monitor",
    "users",
    "briefcase",
    "calendar",
    "file-text",
    "hard-hat",
  ];
  var PHASE_TONE = {
    "fixfy-products": "var(--fx-purple, #7C3AED)",
    zendesk: "var(--fx-blue)",
    "fixfy-os": "var(--fx-coral)",
    "trade-portal": "var(--fx-green)",
    "ops-playbook": "var(--fx-coral)",
  };
  var PHASE_NEED = {
    zendesk: "Score 5/5 on Fixfy Products & Vision quiz",
    "fixfy-os": "Score 5/5 on Zendesk Complete quiz",
    "ops-playbook": "Score 5/5 on Fixfy Operating System quiz",
    "trade-portal": "Score 5/5 on Ops Playbook quiz",
  };

  function adminBypass() {
    return Boolean(bridge.isAdmin);
  }

  function icons() {
    if (window.lucide) lucide.createIcons();
  }

  function phasesSorted() {
    return (curriculum.phases || []).slice().sort(function (a, b) {
      return a.order - b.order;
    });
  }

  function findPhase(id) {
    return phasesSorted().find(function (p) {
      return p.id === id;
    });
  }

  function lessonsSorted(phaseId) {
    var p = findPhase(phaseId);
    if (!p) return [];
    return p.lessons.slice().sort(function (a, b) {
      return a.order - b.order;
    });
  }

  function totalXpAvailable() {
    var n = 0;
    phasesSorted().forEach(function (p) {
      p.lessons.forEach(function (l) {
        n += l.xp;
      });
    });
    return n;
  }

  function earnedXp() {
    var n = 0;
    phasesSorted().forEach(function (p) {
      p.lessons.forEach(function (l) {
        if (bridge.isLessonComplete(l.id)) n += l.xp;
      });
    });
    return n;
  }

  function isPhaseUnlocked(phaseId) {
    if (adminBypass()) return true;
    var sorted = phasesSorted();
    var idx = sorted.findIndex(function (p) {
      return p.id === phaseId;
    });
    if (idx <= 0) return true;
    return bridge.isPhaseQuizPassed(sorted[idx - 1].id);
  }

  function isLessonUnlocked(lesson) {
    if (adminBypass()) return true;
    if (!isPhaseUnlocked(lesson.phaseId)) return false;
    var sorted = lessonsSorted(lesson.phaseId);
    var idx = sorted.findIndex(function (l) {
      return l.id === lesson.id;
    });
    if (idx <= 0) return true;
    return bridge.isLessonComplete(sorted[idx - 1].id);
  }

  function phaseStats(phaseId) {
    var list = lessonsSorted(phaseId);
    var done = list.filter(function (l) {
      return bridge.isLessonComplete(l.id);
    }).length;
    var xpTotal = list.reduce(function (s, l) {
      return s + l.xp;
    }, 0);
    var xpEarned = list
      .filter(function (l) {
        return bridge.isLessonComplete(l.id);
      })
      .reduce(function (s, l) {
        return s + l.xp;
      }, 0);
    return {
      done: done,
      total: list.length,
      pct: list.length ? Math.round((done / list.length) * 100) : 0,
      xpTotal: xpTotal,
      xpEarned: xpEarned,
    };
  }

  function levelLabel(xp) {
    var level = Math.floor(xp / 400) + 1;
    var labels = ["Rookie", "Operator", "Specialist", "Pro", "Expert", "Master"];
    return { level: level, label: labels[Math.min(level - 1, labels.length - 1)] || "Master" };
  }

  function buildLessons() {
    lessons = {};
    var generated = window.FX_SCHOOL_LESSONS || {};
    Object.keys(generated).forEach(function (id) {
      lessons[id] = attachNext(generated[id], generated[id].phaseId);
    });
    Object.keys(cinematic).forEach(function (id) {
      var l = cinematic[id];
      lessons[id] = attachNext(l, l.phaseId || "zendesk");
    });
    if (window.FX_SCHOOL_CATALOG && window.FX_SCHOOL_CATALOG.lessons) {
      Object.keys(window.FX_SCHOOL_CATALOG.lessons).forEach(function (id) {
        var l = window.FX_SCHOOL_CATALOG.lessons[id];
        lessons[id] = attachNext(l, l.phaseId || "fixfy-products");
      });
    }
    phasesSorted().forEach(function (phase) {
      var sorted = lessonsSorted(phase.id);
      sorted.forEach(function (lesson, i) {
        if (lessons[lesson.id]) return;
        lessons[lesson.id] = buildIframeLesson(lesson, phase, sorted[i + 1]);
      });
    });
  }

  function attachNext(lesson, phaseId) {
    var sorted = lessonsSorted(phaseId);
    var idx = sorted.findIndex(function (l) {
      return l.id === lesson.id;
    });
    var next = sorted[idx + 1];
    lesson.next = next
      ? { id: next.id, n: next.order, title: next.title, desc: next.description }
      : null;
    lesson.phaseId = phaseId;
    return lesson;
  }

  function buildIframeLesson(lesson, phase, nextLesson) {
    var phaseLabel = phase.subtitle + " · " + phase.title;
    return {
      id: lesson.id,
      title: lesson.title,
      phase: phaseLabel,
      phaseId: phase.id,
      xp: lesson.xp,
      iframe: true,
      scenes: [
        {
          type: "doc-cover",
          xp: 0,
          html:
            '<div class="sc-doc-cover sc-scene__inner">' +
            '<div class="sc-scene__eyebrow sc-anim">' +
            esc(phaseLabel) +
            " · Lesson " +
            lesson.order +
            "</div>" +
            "<h2 class=\"sc-anim d1\">" +
            esc(lesson.title) +
            "</h2>" +
            '<p class="sc-anim d2">' +
            esc(lesson.description) +
            "</p>" +
            '<div class="sc-doc-cover__meta sc-anim d3">' +
            '<span class="fx-pill fx-pill--coral"><i data-lucide="clock" style="width:12px;height:12px"></i>' +
            lesson.durationMin +
            " min</span>" +
            '<span class="fx-pill"><i data-lucide="zap" style="width:12px;height:12px"></i>+' +
            lesson.xp +
            " XP</span>" +
            "</div>" +
            '<div class="sc-scrollhint"><span>Scroll for content</span><i data-lucide="chevrons-down"></i></div>' +
            "</div>",
        },
        {
          type: "iframe",
          xp: lesson.xp,
          src: lesson.assetPath,
        },
      ],
      next: nextLesson
        ? {
            id: nextLesson.id,
            n: nextLesson.order,
            title: nextLesson.title,
            desc: nextLesson.description,
          }
        : null,
    };
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function episodeMeta(lesson, index) {
    return {
      id: lesson.id,
      n: lesson.order,
      icon: ICONS[index % ICONS.length],
      art: ARTS[index % ARTS.length],
      title: lesson.title,
      desc: lesson.description,
      min: lesson.durationMin,
      xp: lesson.xp,
      lesson: true,
      phaseId: lesson.phaseId,
    };
  }

  function resumeLesson() {
    var last = bridge.progress.lastLessonId;
    if (last && lessons[last] && isLessonUnlocked(findLessonMeta(last))) return last;
    var cont = nextIncompleteLesson();
    return cont;
  }

  function findLessonMeta(id) {
    var found = null;
    phasesSorted().some(function (p) {
      return p.lessons.some(function (l) {
        if (l.id === id) {
          found = l;
          return true;
        }
        return false;
      });
    });
    return found;
  }

  function nextIncompleteLesson() {
    var sortedPhases = phasesSorted();
    for (var pi = 0; pi < sortedPhases.length; pi++) {
      var phase = sortedPhases[pi];
      if (!isPhaseUnlocked(phase.id)) continue;
      var list = lessonsSorted(phase.id);
      for (var li = 0; li < list.length; li++) {
        var l = list[li];
        if (!bridge.isLessonComplete(l.id) && isLessonUnlocked(l)) return l.id;
      }
    }
    return null;
  }

  function badgeCount() {
    var n = 0;
    if (bridge.isPhaseQuizPassed("fixfy-products")) n++;
    if (bridge.isPhaseQuizPassed("zendesk")) n++;
    if (bridge.isPhaseQuizPassed("fixfy-os")) n++;
    if (bridge.isPhaseQuizPassed("ops-playbook")) n++;
    if (bridge.isPhaseQuizPassed("trade-portal")) n++;
    return n;
  }

  // ============================================================ HOME
  function renderHome() {
    var earned = earnedXp();
    var total = totalXpAvailable();
    var pct = total ? Math.round((earned / total) * 100) : 0;
    var lvl = levelLabel(earned);
    var h = "";

    h +=
      '<section class="sc-hero">' +
      '<div class="sc-hero__main">' +
      '<div class="sc-hero__eyebrow">Fixfy School</div>' +
      "<h1 class=\"sc-hero__title\">Learn Fixfy, one episode at a time</h1>" +
      '<p class="sc-hero__sub">Start with Zendesk, then the Operating System and Trade Portal. Earn XP as you scroll, pass each checkpoint, and clear the phase quiz with 5/5 to unlock the next level.</p>' +
      "</div>" +
      '<div class="sc-hero__stats">' +
      '<div class="sc-hero__stat"><div class="sc-hero__stat-k"><i data-lucide="zap"></i>Level ' +
      lvl.level +
      '</div><div class="sc-hero__stat-v">' +
      lvl.label +
      '</div><div class="sc-hero__stat-bar"><div class="sc-hero__stat-fill" style="width:' +
      Math.min(100, (earned % 400) / 4) +
      '%"></div></div><div class="sc-hero__stat-sub">' +
      earned +
      " XP earned</div></div>" +
      '<div class="sc-hero__stat"><div class="sc-hero__stat-k"><i data-lucide="trophy"></i>Progress</div><div class="sc-hero__stat-v">' +
      pct +
      '%</div><div class="sc-hero__stat-bar"><div class="sc-hero__stat-fill" style="width:' +
      pct +
      '%"></div></div><div class="sc-hero__stat-sub">' +
      badgeCount() +
      " badges earned</div></div>" +
      "</div></section>";

    var resumeId = resumeLesson();
    if (resumeId) {
      var rm = findLessonMeta(resumeId);
      var rPhase = findPhase(rm.phaseId);
      var rIdx = lessonsSorted(rm.phaseId).findIndex(function (l) {
        return l.id === rm.id;
      });
      var art = ARTS[rIdx % ARTS.length];
      h +=
        '<div class="sc-resume" data-open-lesson="' +
        esc(resumeId) +
        '">' +
        '<div class="sc-resume__thumb" style="background:' +
        art +
        '"><i data-lucide="play" style="color:#fff;width:22px;height:22px"></i></div>' +
        '<div class="sc-resume__txt"><div class="sc-resume__k">Continue where you left off</div><div class="sc-resume__t">' +
        esc(rm.title) +
        "</div><div class=\"sc-resume__s\">" +
        esc(rPhase.subtitle + " · " + rPhase.title) +
        " · Lesson " +
        rm.order +
        " of " +
        rPhase.lessons.length +
        '</div><div class="sc-resume__bar"><i style="width:' +
        (bridge.isLessonComplete(resumeId) ? 100 : 35) +
        '%"></i></div></div>' +
        '<button class="fx-btn fx-btn--p" style="padding:11px 20px"><i data-lucide="play"></i>' +
        (bridge.isLessonComplete(resumeId) ? "Replay" : "Resume") +
        "</button></div>";
    }

    phasesSorted().forEach(function (phase) {
      if (!isPhaseUnlocked(phase.id)) return;
      var list = lessonsSorted(phase.id);
      var stats = phaseStats(phase.id);
      h += rail(
        phase.subtitle + " · " + phase.title,
        stats.total + " episodes · " + stats.xpTotal + " XP",
        list.map(function (l, i) {
          return epCard(episodeMeta(l, i));
        }).join(""),
      );
    });

    h +=
      '<div class="sc-rail"><div class="sc-rail__head"><div class="sc-rail__title"><h2>Your learning path</h2><span class="sc-rail__meta">3 phases</span></div></div>' +
      '<div class="sc-rail__track">' +
      phasesSorted()
        .map(function (p) {
          return phaseCard(p);
        })
        .join("") +
      "</div></div>";

    h +=
      '<div class="sc-rail" style="margin-top:30px"><div class="sc-rail__head"><div class="sc-rail__title"><h2>Badges</h2><span class="sc-rail__meta">Finish all three phases to unlock Fixfy Scholar</span></div></div>' +
      '<div class="sc-badges">' +
      badge("award", "Products Graduate", "Foundation", bridge.isPhaseQuizPassed("fixfy-products")) +
      badge("award", "Zendesk Pro", "Phase 1", bridge.isPhaseQuizPassed("zendesk")) +
      badge("award", "OS Operator", "Phase 2", bridge.isPhaseQuizPassed("fixfy-os")) +
      badge("award", "Ops Commander", "Phase 3", bridge.isPhaseQuizPassed("ops-playbook")) +
      badge("award", "Portal Expert", "Phase 4", bridge.isPhaseQuizPassed("trade-portal")) +
      badge("graduation-cap", "Fixfy Scholar", "All phases", badgeCount() >= 5) +
      "</div></div>";

    document.getElementById("homeWrap").innerHTML = h;
    icons();
  }

  function rail(title, meta, cards) {
    return (
      '<div class="sc-rail"><div class="sc-rail__head"><div class="sc-rail__title"><h2>' +
      esc(title) +
      '</h2><span class="sc-rail__meta">' +
      esc(meta) +
      '</span></div><div class="sc-rail__nav"><button class="fx-btn fx-btn--g fx-btn--icon" data-rail="-1"><i data-lucide="chevron-left"></i></button><button class="fx-btn fx-btn--g fx-btn--icon" data-rail="1"><i data-lucide="chevron-right"></i></button></div></div><div class="sc-rail__track">' +
      cards +
      "</div></div>"
    );
  }

  function epCard(e) {
    var done = bridge.isLessonComplete(e.id);
    var meta = findLessonMeta(e.id);
    var locked = !isLessonUnlocked(meta);
    return (
      '<article class="sc-ep' +
      (locked ? " is-locked" : "") +
      (done ? " is-done" : "") +
      '" data-open-lesson="' +
      esc(e.id) +
      '">' +
      '<div class="sc-ep__art" style="background:' +
      e.art +
      '">' +
      '<div class="sc-ep__art-ic"><i data-lucide="' +
      e.icon +
      '"></i></div>' +
      '<div class="sc-ep__num">' +
      (e.n < 10 ? "0" : "") +
      e.n +
      '</div><div class="sc-ep__play"><i data-lucide="play"></i></div><div class="sc-ep__done"><i data-lucide="check"></i></div>' +
      '<div class="sc-ep__lock"><i data-lucide="lock"></i><span>Locked</span></div></div>' +
      '<div class="sc-ep__body"><div class="sc-ep__title">' +
      esc(e.title) +
      '</div><div class="sc-ep__desc">' +
      esc(e.desc) +
      '</div><div class="sc-ep__meta"><span class="m"><i data-lucide="file-text"></i>Lesson</span><span class="m"><i data-lucide="clock"></i>' +
      e.min +
      ' min</span><span class="m sc-ep__xp"><i data-lucide="zap"></i>+' +
      e.xp +
      ' XP</span></div><div class="sc-ep__bar"><i style="width:' +
      (done ? 100 : 0) +
      '%"></i></div></div></article>'
    );
  }

  function phaseCard(p) {
    var stats = phaseStats(p.id);
    var locked = !isPhaseUnlocked(p.id);
    var tone = PHASE_TONE[p.id] || "var(--fx-coral)";
    return (
      '<article class="sc-phasecard' +
      (locked ? " is-locked" : "") +
      '" ' +
      (locked ? "" : 'data-open-phase="' + p.id + '"') +
      ">" +
      '<svg class="sc-phasecard__ring" viewBox="0 0 52 52"><circle cx="26" cy="26" r="22" fill="none" stroke="var(--fx-line)" stroke-width="4"/><circle cx="26" cy="26" r="22" fill="none" stroke="' +
      tone +
      '" stroke-width="4" stroke-linecap="round" stroke-dasharray="' +
      2 * Math.PI * 22 +
      '" stroke-dashoffset="' +
      2 * Math.PI * 22 * (1 - stats.pct / 100) +
      '" transform="rotate(-90 26 26)"/><text x="26" y="30" text-anchor="middle" font-size="11" font-weight="600" font-family="var(--fx-mono)" fill="var(--fx-ink)">' +
      stats.pct +
      '%</text></svg><div class="sc-phasecard__k" style="color:' +
      tone +
      '">' +
      esc(p.subtitle) +
      '</div><div class="sc-phasecard__t">' +
      esc(p.title) +
      '</div><div class="sc-phasecard__d">' +
      esc(p.description) +
      "</div>" +
      (locked
        ? '<div class="sc-phasecard__foot"><span style="display:flex;align-items:center;gap:6px"><i data-lucide="lock" style="width:13px;height:13px"></i>' +
          esc(PHASE_NEED[p.id] || "Complete previous phase") +
          "</span></div>"
        : '<div class="sc-phasecard__foot"><span>' +
          p.lessons.length +
          " lessons · " +
          stats.xpTotal +
          ' XP</span><span class="sc-phasecard__cta">Open<i data-lucide="arrow-right" style="width:14px;height:14px"></i></span></div>') +
      "</article>"
    );
  }

  function badge(ic, name, sub, earned) {
    return (
      '<div class="sc-badge' +
      (earned ? " is-earned" : "") +
      '"><div class="sc-badge__medal"><i data-lucide="' +
      (earned ? ic : "lock") +
      '"></i></div><div class="sc-badge__name">' +
      esc(name) +
      '</div><div class="sc-badge__sub">' +
      esc(sub) +
      "</div></div>"
    );
  }

  // ============================================================ PHASE
  function renderPhase(pid) {
    currentPhaseId = pid;
    var p = findPhase(pid);
    if (!p) return;
    var stats = phaseStats(pid);
    var tone = PHASE_TONE[pid] || "var(--fx-coral)";
    var list = lessonsSorted(pid);
    var h =
      '<section class="sc-season" style="background:linear-gradient(115deg,#15153D,#020040)">' +
      '<div class="sc-season__k" style="color:var(--fx-coral-h)">' +
      esc(p.subtitle) +
      '</div><h1 class="sc-season__t">' +
      esc(p.title) +
      '</h1><p class="sc-season__d">' +
      esc(p.description) +
      '</p><div class="sc-season__meta"><div class="m"><span class="mv">' +
      stats.done +
      "/" +
      stats.total +
      '</span><span class="mk">Lessons done</span></div><div class="m"><span class="mv">' +
      stats.xpEarned +
      '</span><span class="mk">XP earned</span></div><div class="m"><span class="mv">' +
      stats.xpTotal +
      '</span><span class="mk">XP available</span></div></div></section>';

    h += '<div class="sc-list">' + list.map(epRow).join("") + "</div>";

    if (stats.done === stats.total && stats.total > 0) {
      h +=
        '<div class="sc-quiz-cta"><p>All lessons complete — take the phase quiz and score 5/5 to unlock the next phase.</p>' +
        '<button type="button" class="fx-btn fx-btn--p" data-quiz="' +
        esc(pid) +
        '"><i data-lucide="star"></i>Take quiz</button></div>';
    }

    document.getElementById("phaseWrap").innerHTML = h;
    icons();
  }

  function epRow(lesson, index) {
    var e = episodeMeta(lesson, index);
    var done = bridge.isLessonComplete(e.id);
    var locked = !isLessonUnlocked(lesson);
    var numBg = locked ? "var(--fx-paper-2)" : e.art;
    var numColor = locked ? "color:var(--fx-mute)" : "color:#fff";
    return (
      '<article class="sc-row' +
      (locked ? " is-locked" : "") +
      '" data-open-lesson="' +
      esc(e.id) +
      '">' +
      '<div class="sc-row__num" style="background:' +
      numBg +
      ";" +
      numColor +
      '">' +
      (locked
        ? '<i data-lucide="lock" style="width:18px;height:18px"></i>'
        : (e.n < 10 ? "0" : "") + e.n) +
      (done ? '<span class="ck"><i data-lucide="check"></i></span>' : "") +
      '</div><div class="sc-row__main"><div class="sc-row__t">' +
      esc(e.title) +
      '</div><div class="sc-row__d">' +
      esc(e.desc) +
      '</div></div><div class="sc-row__meta"><span class="m"><i data-lucide="file-text"></i>Lesson</span><span class="m"><i data-lucide="clock"></i>' +
      e.min +
      ' min</span><span class="m sc-row__xp"><i data-lucide="zap"></i>+' +
      e.xp +
      ' XP</span></div><div class="sc-row__go"><i data-lucide="' +
      (locked ? "lock" : "play") +
      '"></i></div></article>'
    );
  }

  // ============================================================ LESSON PLAYER
  var player = { lesson: null, scenes: [], active: 0, awarded: [], total: 0, completed: false };

  function totalLessonXp(l) {
    return l.scenes.reduce(function (a, s) {
      return a + (s.xp || 0);
    }, 0);
  }

  function hideCompleteDock() {
    var dock = document.getElementById("scCompleteDock");
    var screen = document.getElementById("scCompleteScreen");
    var stage = document.getElementById("stage");
    if (dock) {
      dock.hidden = true;
      dock.setAttribute("aria-hidden", "true");
      dock.classList.remove("is-visible");
    }
    if (screen) {
      screen.hidden = true;
      screen.setAttribute("aria-hidden", "true");
      screen.innerHTML = "";
    }
    if (stage) stage.hidden = false;
    document.getElementById("player").classList.remove("is-complete");
  }

  function resolveNextTarget(lesson) {
    if (lesson.next) {
      return {
        kind: "lesson",
        id: lesson.next.id,
        k: "Next · Lesson " + lesson.next.n,
        title: lesson.next.title,
      };
    }
    var phase = findPhase(lesson.phaseId || currentPhaseId);
    return {
      kind: "phase",
      id: lesson.phaseId || currentPhaseId,
      k: "Phase complete",
      title: phase ? "Back to " + phase.title : "Back to phase",
    };
  }

  function syncCompleteDock(lesson) {
    var dock = document.getElementById("scCompleteDock");
    if (!dock || !lesson) return;
    var target = resolveNextTarget(lesson);
    dock.hidden = false;
    dock.setAttribute("aria-hidden", "false");
    dock.classList.add("is-visible");
    var btn = dock.querySelector("[data-go-next]");
    if (btn) {
      btn.dataset.nextKind = target.kind;
      btn.dataset.nextId = target.id;
    }
    var kEl = document.getElementById("scCompleteDockK");
    var tEl = document.getElementById("scCompleteDockTitle");
    if (kEl) kEl.textContent = target.k;
    if (tEl) tEl.textContent = target.title;
    icons();
  }

  function showCompleteScreen() {
    if (!player.lesson) return;
    if (!player.completed) {
      player.completed = true;
      void bridge.completeLesson(player.lesson.id);
      confetti();
    }

    var stage = document.getElementById("stage");
    if (stage) stage.removeEventListener("scroll", onStageScroll);
    var screen = document.getElementById("scCompleteScreen");
    stage.hidden = true;
    screen.hidden = false;
    screen.setAttribute("aria-hidden", "false");
    screen.innerHTML = completionHtml(player.lesson);
    document.getElementById("player").classList.add("is-complete");
    document.getElementById("hudScene").textContent = "Complete";
    document.getElementById("hudProg").style.width = "100%";
    syncCompleteDock(player.lesson);
    icons();
  }

  function reviewLessonFromComplete() {
    if (!player.lesson || !player.completed) return;
    var stage = document.getElementById("stage");
    var screen = document.getElementById("scCompleteScreen");
    if (!stage || !screen) return;
    screen.hidden = true;
    screen.setAttribute("aria-hidden", "true");
    stage.hidden = false;
    document.getElementById("player").classList.remove("is-complete");
    stage.scrollTop = 0;
    stage.querySelectorAll("[data-scene]").forEach(function (s) {
      s.classList.remove("in");
    });
    player.active = 0;
    updateHud(0);
    document.getElementById("hudProg").style.width = "0%";
    stage.removeEventListener("scroll", onStageScroll);
    stage.addEventListener("scroll", onStageScroll, { passive: true });
    requestAnimationFrame(function () {
      requestAnimationFrame(onStageScroll);
    });
    icons();
  }

  function openLesson(id) {
    var meta = findLessonMeta(id);
    if (!meta || !isLessonUnlocked(meta)) {
      toast("Complete the previous lesson first");
      return;
    }
    var l = lessons[id];
    if (!l) {
      toast("Lesson not available yet");
      return;
    }
    void bridge.setLastLesson(id);
    player.lesson = l;
    player.awarded = [];
    player.active = 0;
    player.completed = false;
    player.total = totalLessonXp(l);
    document.getElementById("hudTitle").textContent = l.title;

    hideCompleteDock();

    var stage = document.getElementById("stage");
    var html = "";
    l.scenes.forEach(function (s, i) {
      if (s.type === "iframe") {
        html +=
          '<section class="sc-scene sc-scene--iframe" data-scene="' +
          i +
          '" data-type="iframe" data-xp="' +
          (s.xp || 0) +
          '"><iframe class="sc-iframe" title="' +
          esc(l.title) +
          '" src="' +
          esc(s.src) +
          '"></iframe></section>';
        return;
      }
      var cls = "sc-scene";
      if (s.type === "cover" || s.type === "doc-cover") cls += " sc-cover sc-scene--dark";
      else if (s.type === "check") cls += " sc-scene--dark";
      else if (s.dark) cls += " sc-scene--dark";
      if (s.type === "doc-cover") cls += " sc-scene--doc";
      html +=
        '<section class="' +
        cls +
        '" data-scene="' +
        i +
        '" data-type="' +
        s.type +
        '" data-xp="' +
        (s.xp || 0) +
        '"' +
        (s.type === "check" ? ' data-correct="' + s.correct + '"' : "") +
        ">" +
        s.html +
        "</section>";
    });
    stage.innerHTML = html;
    stage.scrollTop = 0;

    document.getElementById("player").classList.add("is-active");
    document.body.classList.add("sc-reading");
    setHudXp(0);
    icons();
    bindChecks();
    bindIframes();
    if (window.FX_SCHOOL_CATALOG && window.FX_SCHOOL_CATALOG.hydrateCatalogBoards) {
      window.FX_SCHOOL_CATALOG.hydrateCatalogBoards();
    }

    stage.removeEventListener("scroll", onStageScroll);
    stage.addEventListener("scroll", onStageScroll, { passive: true });
    requestAnimationFrame(function () {
      requestAnimationFrame(onStageScroll);
    });
  }

  function bindIframes() {
    document.querySelectorAll("#stage .sc-iframe").forEach(function (frame) {
      frame.addEventListener("load", function () {
        try {
          frame.contentWindow.postMessage({ type: "fixfy-school-study", active: true }, window.location.origin);
        } catch (e) {}
      });
    });
  }

  function closeLesson() {
    var stage = document.getElementById("stage");
    if (stage) stage.removeEventListener("scroll", onStageScroll);
    hideCompleteDock();
    document.getElementById("player").classList.remove("is-active", "is-complete");
    document.body.classList.remove("sc-reading");
    player.lesson = null;
    player.completed = false;
  }

  function onStageScroll() {
    var stage = document.getElementById("stage");
    if (!stage || stage.hidden || !player.lesson) return;
    var max = stage.scrollHeight - stage.clientHeight;
    var pct = max > 0 ? Math.min(100, (stage.scrollTop / max) * 100) : 0;
    document.getElementById("hudProg").style.width = pct + "%";

    var ch = stage.clientHeight;
    var scenes = [].slice.call(stage.querySelectorAll("[data-scene]"));
    var active = 0;
    scenes.forEach(function (s) {
      var r = s.getBoundingClientRect();
      var stageR = stage.getBoundingClientRect();
      var relTop = r.top - stageR.top;
      if (relTop < ch * 0.84) s.classList.add("in");
      if (relTop <= ch * 0.5 && relTop + r.height > ch * 0.5) active = +s.dataset.scene;
    });
    player.active = active;
    updateHud(active);
    var cur = scenes[active];
    if (cur && cur.dataset.type !== "check") awardScene(active, +cur.dataset.xp);

    if (stage.scrollTop + stage.clientHeight >= stage.scrollHeight - 32) {
      if (max > 32 || active >= player.lesson.scenes.length - 1) {
        showCompleteScreen();
      }
    }
  }

  function updateHud(idx) {
    var n = player.lesson.scenes.length;
    document.getElementById("hudScene").textContent = "Scene " + Math.min(idx + 1, n) + " of " + n;
  }

  function awardScene(idx, xp) {
    if (player.awarded.indexOf(idx) !== -1) return;
    player.awarded.push(idx);
    if (xp > 0) addXp(xp);
  }

  var hudXpShown = 0;
  function setHudXp(v) {
    hudXpShown = v;
    document.querySelector("#hudXp .n").textContent = v;
  }
  function addXp(amount) {
    var el = document.getElementById("hudXp");
    var target = hudXpShown + amount;
    var start = hudXpShown,
      t0 = performance.now(),
      dur = 500;
    function tick(t) {
      var k = Math.min(1, (t - t0) / dur);
      setHudXp(Math.round(start + (target - start) * k));
      if (k < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    el.classList.remove("pop");
    void el.offsetWidth;
    el.classList.add("pop");
    toast("+" + amount + " XP");
  }

  var toastTimer;
  function toast(msg) {
    var t = document.getElementById("scToast");
    t.querySelector("span").textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      t.classList.remove("show");
    }, 1400);
  }

  function bindChecks() {
    document.querySelectorAll("#stage .sc-check").forEach(function (card) {
      var scene = card.closest("[data-scene]");
      var correct = +scene.dataset.correct;
      var opts = [].slice.call(card.querySelectorAll(".sc-opt"));
      opts.forEach(function (o, i) {
        o.addEventListener("click", function () {
          if (card.classList.contains("answered")) return;
          card.classList.add("answered");
          if (i === correct) {
            o.classList.add("is-correct");
            awardScene(+scene.dataset.scene, +scene.dataset.xp);
            burst(o);
          } else {
            o.classList.add("is-wrong");
            opts[correct].classList.add("is-correct");
            awardScene(+scene.dataset.scene, +scene.dataset.xp);
          }
        });
      });
    });
  }

  function burst(el) {
    /* visual feedback placeholder */
    void el;
  }

  function completionHtml(l) {
    var lessonXp = totalLessonXp(l);
    var checks = l.scenes.filter(function (s) {
      return s.type === "check";
    }).length;
    var phase = findPhase(l.phaseId || currentPhaseId);
    var stats = phaseStats(l.phaseId || currentPhaseId);
    return (
      '<div class="sc-complete__inner">' +
      '<div class="sc-complete__ring"><i data-lucide="check"></i></div>' +
      '<div class="sc-complete__k">Lesson complete</div>' +
      '<div class="sc-complete__t">Nice work.</div>' +
      '<p class="sc-complete__s">You finished <b style="color:#fff">' +
      esc(l.title) +
      "</b>. Every lesson you clear gets you closer to your next badge.</p>" +
      '<div class="sc-complete__stats">' +
      '<div class="sc-complete__stat"><div class="sc-complete__stat-v">+' +
      lessonXp +
      '</div><div class="sc-complete__stat-k">XP earned</div></div>' +
      (checks
        ? '<div class="sc-complete__stat"><div class="sc-complete__stat-v">' +
          checks +
          "/" +
          checks +
          '</div><div class="sc-complete__stat-k">Checkpoints</div></div>'
        : "") +
      '<div class="sc-complete__stat"><div class="sc-complete__stat-v">' +
      stats.done +
      "/" +
      stats.total +
      '</div><div class="sc-complete__stat-k">' +
      esc(phase ? phase.subtitle : "Phase") +
      "</div></div></div></div>"
    );
  }

  async function goNextFromLesson(lesson) {
    if (!lesson) return;
    if (!player.completed) {
      player.completed = true;
      await bridge.completeLesson(lesson.id);
    }
    var target = resolveNextTarget(lesson);
    if (target.kind === "lesson") {
      openLesson(target.id);
      return;
    }
    closeLesson();
    renderPhase(target.id);
    showView("phase");
    bridge.navigate("/school/" + target.id);
  }

  function confetti() {
    var cv = document.getElementById("scConfetti");
    cv.style.display = "block";
    var ctx = cv.getContext("2d");
    var W = (cv.width = window.innerWidth),
      H = (cv.height = window.innerHeight);
    var cols = ["#ED4B00", "#F0B429", "#0B5FFF", "#0E8A5F", "#F26527", "#fff"];
    var parts = [];
    for (var i = 0; i < 160; i++)
      parts.push({
        x: W / 2 + (Math.random() - 0.5) * 200,
        y: H * 0.36,
        r: 4 + Math.random() * 6,
        vx: (Math.random() - 0.5) * 13,
        vy: -6 - Math.random() * 11,
        c: cols[(Math.random() * cols.length) | 0],
        a: 1,
        rot: Math.random() * 6,
        vr: (Math.random() - 0.5) * 0.4,
      });
    var t0 = performance.now();
    (function loop(t) {
      ctx.clearRect(0, 0, W, H);
      var done = true;
      parts.forEach(function (p) {
        p.vy += 0.32;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        p.a -= 0.006;
        if (p.a > 0 && p.y < H + 20) {
          done = false;
          ctx.save();
          ctx.globalAlpha = Math.max(0, p.a);
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.c;
          ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 0.6);
          ctx.restore();
        }
      });
      if (!done && t - t0 < 4200) requestAnimationFrame(loop);
      else {
        ctx.clearRect(0, 0, W, H);
        cv.style.display = "none";
      }
    })(t0);
  }

  // ============================================================ ROUTER
  function showView(v) {
    document.querySelectorAll(".sc-view").forEach(function (s) {
      s.classList.toggle("is-active", s.dataset.view === v);
    });
    window.scrollTo(0, 0);
  }

  function goHome() {
    renderHome();
    showView("home");
  }

  function routeFromQuery() {
    var params = new URLSearchParams(window.location.search);
    var lesson = params.get("lesson");
    var phase = params.get("phase");
    if (lesson && lessons[lesson]) {
      openLesson(lesson);
      return;
    }
    if (phase && findPhase(phase)) {
      renderPhase(phase);
      showView("phase");
      return;
    }
    goHome();
  }

  document.addEventListener("click", function (e) {
    var ol = e.target.closest("[data-open-lesson]");
    if (ol) {
      openLesson(ol.dataset.openLesson);
      return;
    }
    var op = e.target.closest("[data-open-phase]");
    if (op) {
      renderPhase(op.dataset.openPhase);
      showView("phase");
      bridge.navigate("/school/" + op.dataset.openPhase);
      return;
    }
    if (e.target.closest("#scHome") || e.target.closest("[data-home]")) {
      goHome();
      bridge.navigate("/school");
      return;
    }
    if (e.target.closest("#scBackOs")) {
      bridge.backToOs();
      return;
    }
    if (e.target.closest("#hudBack")) {
      closeLesson();
      return;
    }
    if (e.target.closest("[data-finish]")) {
      closeLesson();
      goHome();
      return;
    }
    if (e.target.closest("[data-review-lesson]")) {
      reviewLessonFromComplete();
      return;
    }
    var goNext = e.target.closest("[data-go-next]");
    if (goNext && player.lesson) {
      e.preventDefault();
      void goNextFromLesson(player.lesson);
      return;
    }
    var quiz = e.target.closest("[data-quiz]");
    if (quiz) {
      bridge.navigate("/school/" + quiz.dataset.quiz + "/quiz");
      return;
    }
    var ra = e.target.closest("[data-rail]");
    if (ra) {
      var tr = ra.closest(".sc-rail").querySelector(".sc-rail__track");
      tr.scrollBy({ left: +ra.dataset.rail * 340, behavior: "smooth" });
    }
  });

  fetch("/school/fixfy-school/school-curriculum.json")
    .then(function (r) {
      return r.json();
    })
    .then(function (data) {
      curriculum = data;
      return bridge.init();
    })
    .then(function () {
      buildLessons();
      routeFromQuery();
      icons();
    })
    .catch(function () {
      document.getElementById("homeWrap").innerHTML =
        '<p style="padding:40px;color:var(--fx-mute)">Could not load Fixfy School. Refresh to try again.</p>';
    });
})();
