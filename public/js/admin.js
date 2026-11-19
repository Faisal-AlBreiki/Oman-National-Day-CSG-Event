
(() => {
  const $ = (id) => document.getElementById(id);
  let refreshTimer = null;
  let unsubscribe = null;
  let currentCompletedCount = 0;
  let currentCompetitionStatus = "registration";
  let currentParticipants = [];

  const statusNames = {
    registration: "التسجيل مفتوح",
    live: "المسابقة مباشرة",
    paused: "متوقفة مؤقتاً",
    revealing: "تم اكتمال الفائزين",
    closed: "المسابقة منتهية"
  };

  const placeNames = {
    1: "المركز الأول",
    2: "المركز الثاني",
    3: "المركز الثالث"
  };

  function showError(message) {
    $("loginError").textContent = message || "";
    $("loginError").classList.toggle("hidden", !message);
  }

  function formatTime(value) {
    if (!value) return "";
    return new Intl.DateTimeFormat("ar-OM", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).format(new Date(value));
  }

  function questionName(id) {
    const n = Number(id);
    const names = [
      "الأول", "الثاني", "الثالث",
      "الرابع", "الخامس", "السادس",
      "السابع", "الثامن", "التاسع"
    ];
    return names[n - 1] || String(id);
  }

  function buildParticipantLink() {
    const url = new URL("index.html", window.location.href).href;
    $("participantUrl").textContent = url;
    $("openParticipantLink").href = url;
    $("adminQr").innerHTML = "";

    if (window.QRCode) {
      new QRCode($("adminQr"), {
        text: url,
        width: 128,
        height: 128,
        colorDark: "#17120d",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.M
      });
    } else {
      $("adminQr").textContent = "QR";
    }
  }

  function renderActivity(items) {
    const list = $("activityList");
    list.innerHTML = "";

    if (!items || !items.length) {
      list.innerHTML =
        '<div class="hint">لا توجد أنشطة بعد. ستظهر هنا الإجابات الصحيحة فور تسجيلها.</div>';
      return;
    }

    items.slice(0, 30).forEach(item => {
      const row = document.createElement("div");
      row.className = "activity-item";

      const isCompleted = item.event_type === "completed";
      const isIncorrect = item.event_type === "incorrect_answer";

      const icon = document.createElement("div");
      icon.className = `activity-icon${isIncorrect ? " is-wrong" : ""}`;
      icon.textContent = isCompleted ? "🏆" : isIncorrect ? "😅" : "✓";

      const copy = document.createElement("div");
      copy.className = "activity-copy";

      const strong = document.createElement("strong");
      strong.textContent = item.participant_name || "مشارك";

      const text = document.createElement("p");
      text.textContent = isCompleted
        ? "أكمل 3 أسئلة بنجاح. بانتظار إعلان النتائج."
        : isIncorrect
          ? `أجاب عن السؤال ${questionName(item.question_id)} بشكل غير صحيح.`
          : `أجاب عن السؤال ${questionName(item.question_id)} بشكل صحيح.`;

      const time = document.createElement("time");
      time.textContent = formatTime(item.created_at);

      copy.append(strong, text, time);
      row.append(icon, copy);
      list.appendChild(row);
    });
  }

  function renderParticipants(participants) {
    currentParticipants = Array.isArray(participants) ? participants : [];

    const list = $("participantsList");
    const query = ($("participantSearch")?.value || "")
      .trim()
      .toLocaleLowerCase();

    const filtered = currentParticipants.filter(p =>
      (p.display_name || "").toLocaleLowerCase().includes(query)
    );

    $("participantListCount").textContent =
      `${currentParticipants.length} مشارك`;

    const canDeleteParticipants =
      currentCompetitionStatus === "registration";

    const participantHint = $("participantManagementHint");

    if (participantHint) {
      participantHint.textContent = canDeleteParticipants
        ? "يمكن حذف المشاركين خلال فترة التسجيل فقط. سيُقفل الحذف فور بدء المسابقة."
        : "بدأت المسابقة أو انتهت؛ تم إيقاف حذف المشاركين لحماية نزاهة النتائج.";
    }

    list.innerHTML = "";

    if (!currentParticipants.length) {
      list.innerHTML =
        '<div class="hint participant-list-empty">لا يوجد مشاركون مسجلون حالياً.</div>';
      return;
    }

    if (!filtered.length) {
      list.innerHTML =
        '<div class="hint participant-list-empty">لا توجد أسماء تطابق البحث.</div>';
      return;
    }

    filtered.forEach(participant => {
      const row = document.createElement("div");
      row.className = "participant-admin-row";

      const details = document.createElement("div");
      details.className = "participant-admin-details";

      const name = document.createElement("strong");
      name.className = "participant-admin-name";
      name.textContent = participant.display_name || "مشارك";

      const meta = document.createElement("div");
      meta.className = "participant-admin-meta";

      const joined = participant.joined_at
        ? formatTime(participant.joined_at)
        : "وقت التسجيل غير متاح";

      const correctCount = Number(participant.correct_count || 0);

      const progress = correctCount >= 3
        ? "أكمل 3/3 إجابات صحيحة"
        : `${correctCount}/3 إجابات صحيحة`;

      meta.textContent = `${progress} · ${joined}`;

      details.append(name, meta);

      if (participant.winner_place) {
        const winner = document.createElement("span");
        winner.className = "participant-winner-tag";
        winner.textContent =
          placeNames[participant.winner_place] || "ضمن الفائزين";
        details.appendChild(winner);
      }

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn btn-danger btn-small participant-delete-btn";
      remove.dataset.deleteParticipant = participant.participant_id;
      remove.textContent = "حذف";
      remove.setAttribute(
        "aria-label",
        `حذف المشارك ${participant.display_name || ""}`
      );

      remove.disabled = !canDeleteParticipants;
      remove.hidden = !canDeleteParticipants;

      row.append(details, remove);
      list.appendChild(row);
    });
  }

  function renderWinners(winners) {
    const isReady = winners && winners.length === 3;

    $("adminWinnersPanel").classList.toggle("hidden", !isReady);
    $("winnersWaitingPanel").classList.toggle("hidden", isReady);

    if (!isReady) return;

    const list = $("adminWinnersList");
    list.innerHTML = "";

    winners.slice().sort((a, b) => a.place - b.place).forEach(w => {
      const row = document.createElement("div");
      row.className = "winner-admin-row";

      const medal = document.createElement("div");
      medal.className = "winner-medal";
      medal.textContent =
        w.place === 1 ? "🥇" : w.place === 2 ? "🥈" : "🥉";

      const copy = document.createElement("div");
      copy.style.flex = "1";

      const name = document.createElement("strong");
      name.textContent = w.display_name;

      const place = document.createElement("div");
      place.className = "hint";
      place.textContent = placeNames[w.place] || `المركز ${w.place}`;

      copy.append(name, place);
      row.append(medal, copy);
      list.appendChild(row);
    });
  }

  function updateControls(status, completedCount = 0) {
    currentCompetitionStatus = status;
    currentCompletedCount = Number(completedCount) || 0;

    const winnersReady = currentCompletedCount >= 3;

    $("competitionStatus").innerHTML =
      `<span class="status-dot"></span>${statusNames[status] || status}`;

    $("competitionStatus").classList.toggle("live", status === "live");

    $("startBtn").classList.toggle("hidden", status !== "registration");
    $("pauseBtn").classList.toggle("hidden", status !== "live");
    $("resumeBtn").classList.toggle("hidden", status !== "paused");

    $("endBtn").classList.toggle(
      "hidden",
      !["live", "paused", "registration"].includes(status)
    );

    $("endBtn").textContent = winnersReady
      ? "🏁 إنهاء المسابقة وإعلان الفائزين"
      : "⏹ إنهاء المسابقة";

    $("resetBtn").classList.toggle(
      "hidden",
      !["closed", "revealing"].includes(status)
    );

    if (status === "registration") {
      $("controlHint").textContent =
        "يمكن للجمهور التسجيل الآن. ابدأ المسابقة عندما تكون مستعداً.";
    } else if (status === "live" && winnersReady) {
      $("controlHint").textContent =
        "اكتملت المراكز الثلاثة مبدئياً. ستبقى المسابقة مفتوحة حتى تضغط «إنهاء المسابقة وإعلان الفائزين».";
    } else if (status === "live") {
      $("controlHint").textContent =
        "المسابقة مفتوحة. تُسجل الإجابات الصحيحة، ولن يظهر إعلان الفائزين حتى تنهي المسابقة يدوياً.";
    } else if (status === "paused" && winnersReady) {
      $("controlHint").textContent =
        "اكتملت المراكز الثلاثة مبدئياً. يمكنك استئناف المسابقة أو إنهاؤها وإعلان النتائج.";
    } else if (status === "paused") {
      $("controlHint").textContent =
        "المسابقة متوقفة مؤقتاً. يمكنك استئنافها أو إنهاؤها.";
    } else if (status === "revealing") {
      $("controlHint").textContent =
        "هذه حالة قديمة من جولة سابقة. شاشة العرض في مرحلة الكشف.";
    } else if (status === "closed" && winnersReady) {
      $("controlHint").textContent =
        "تم إيقاف المسابقة. شاشة العرض تكشف الآن أسماء الفائزين الثلاثة.";
    } else {
      $("controlHint").textContent =
        "انتهت هذه الجولة قبل اكتمال ثلاثة فائزين. يمكنك إعادة ضبطها لبدء جولة جديدة.";
    }
  }

  async function refreshDashboard() {
    try {
      const data = await QuizBackend.getAdminDashboard();

      $("participantCount").textContent = data.participant_count ?? 0;
      $("startedCount").textContent = data.started_count ?? 0;

      $("completedCount").textContent =
        `${data.completed_count ?? data.winners_count ?? 0} / 3`;

      updateControls(
        data.status || "registration",
        data.completed_count ?? data.winners_count ?? 0
      );

      renderActivity(data.activity || []);
      renderParticipants(data.participants || []);
      renderWinners(data.winners || []);

    } catch (error) {
      console.error(error);
      showError(error.message || "تعذر تحميل لوحة الإدارة.");
    }
  }

  async function showDashboard() {
    $("loginView").classList.add("hidden");
    $("dashboardView").classList.remove("hidden");

    await refreshDashboard();
    buildParticipantLink();

    refreshTimer = window.setInterval(
      refreshDashboard,
      window.APP_CONFIG?.POLL_INTERVAL_MS || 2500
    );

    unsubscribe = QuizBackend.subscribe(refreshDashboard);
  }

  async function login() {
    showError("");

    const button = $("loginButton");
    button.disabled = true;
    button.textContent = "جارٍ التحقق...";

    try {
      const credentials = QuizBackend.isDemo()
        ? { pin: $("demoPin").value }
        : {
            email: $("adminEmail").value.trim(),
            password: $("adminPassword").value
          };

      await QuizBackend.adminLogin(credentials);
      await showDashboard();

    } catch (error) {
      showError(error.message || "تعذر تسجيل الدخول.");
    } finally {
      button.disabled = false;
      button.textContent = "دخول لوحة الإدارة";
    }
  }

  $("loginForm").addEventListener("submit", event => {
    event.preventDefault();
    login();
  });

  $("startBtn").addEventListener("click", async () => {
    if (confirm("هل تريد بدء المسابقة الآن؟ سيتمكن المشاركون من الإجابة.")) {
      try {
        await QuizBackend.setCompetitionStatus("live");
        await refreshDashboard();
      } catch (error) {
        showError(error.message || "تعذر بدء المسابقة.");
      }
    }
  });

  $("pauseBtn").addEventListener("click", async () => {
    try {
      await QuizBackend.setCompetitionStatus("paused");
      await refreshDashboard();
    } catch (error) {
      showError(error.message || "تعذر إيقاف المسابقة مؤقتاً.");
    }
  });

  $("resumeBtn").addEventListener("click", async () => {
    try {
      await QuizBackend.setCompetitionStatus("live");
      await refreshDashboard();
    } catch (error) {
      showError(error.message || "تعذر استئناف المسابقة.");
    }
  });

  $("endBtn").addEventListener("click", async () => {
    const hasThreeWinners = currentCompletedCount >= 3;

    const message = hasThreeWinners
      ? "سيتم إيقاف استقبال الإجابات الآن، ثم تبدأ شاشة العرض العد التنازلي وتكشف أسماء الفائزين الثلاثة. هل تريد المتابعة؟"
      : `اكتمل ${currentCompletedCount} من أصل 3 مراكز فقط. سيتم إيقاف المسابقة دون كشف منصة فائزين مكتملة. هل تريد المتابعة؟`;

    if (confirm(message)) {
      try {
        await QuizBackend.setCompetitionStatus("closed");
        await refreshDashboard();
      } catch (error) {
        showError(error.message || "تعذر إنهاء المسابقة.");
      }
    }
  });

  // V10.2: Improved reset handling with visible Supabase error details.
  $("resetBtn").addEventListener("click", async () => {
    const typed = prompt(
      "سيتم حذف المشاركين والإجابات والفائزين في هذه الجولة. اكتب RESET للتأكيد:"
    );

    if (typed === null || typed.trim().toUpperCase() !== "RESET") {
      return;
    }

    const button = $("resetBtn");
    const originalText = button.textContent;

    button.disabled = true;
    button.textContent = "جارٍ إنشاء جولة جديدة...";
    showError("");

    try {
      const result = await QuizBackend.resetCompetition();

      console.log("Competition reset result:", result);

      await refreshDashboard();

      alert("تمت إعادة الجولة بنجاح. التسجيل مفتوح الآن.");

    } catch (error) {
      console.error("Competition reset failed:", error);

      const details = [
        error?.message,
        error?.details,
        error?.hint,
        error?.code
      ].filter(Boolean).join(" | ");

      showError(
        details || "تعذرت إعادة الجولة. افتح Console لمراجعة تفاصيل الخطأ."
      );

      await refreshDashboard();

    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  });

  $("participantSearch").addEventListener("input", () => {
    renderParticipants(currentParticipants);
  });

  $("participantsList").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-delete-participant]");
    if (!button) return;

    if (currentCompetitionStatus !== "registration") {
      showError(
        "لا يمكن حذف المشاركين بعد بدء المسابقة. الحذف متاح أثناء التسجيل فقط."
      );
      return;
    }

    const participantId = button.dataset.deleteParticipant;

    const participant = currentParticipants.find(
      p => p.participant_id === participantId
    );

    if (!participant) return;

    const name = participant.display_name || "هذا المشارك";

    const confirmed = confirm(
      `هل تريد حذف "${name}" نهائياً؟\n\nالحذف متاح أثناء التسجيل فقط. سيتم حذف بياناته من الجولة، ويمكنه التسجيل من جديد بعد تحديث صفحة هاتفه.`
    );

    if (!confirmed) return;

    button.disabled = true;
    button.textContent = "جارٍ الحذف...";

    try {
      await QuizBackend.deleteParticipant(participantId);
      await refreshDashboard();
    } catch (error) {
      button.disabled = false;
      button.textContent = "حذف";
      showError(error.message || "تعذر حذف المشارك.");
    }
  });

  $("exportBtn").addEventListener("click", async () => {
    try {
      const rows = await QuizBackend.getAdminExport();

      const headers = [
        "الاسم",
        "وقت التسجيل",
        "الإجابات الصحيحة",
        "المركز"
      ];

      const quote = (value) =>
        `"${String(value ?? "").replace(/"/g, '""')}"`;

      const lines = [
        headers,
        ...(rows || []).map(row => [
          row.display_name,
          row.joined_at ? formatTime(row.joined_at) : "",
          row.correct_count ?? 0,
          row.winner_place
            ? placeNames[row.winner_place]
            : "-"
        ])
      ];

      const csv = "\uFEFF" +
        lines.map(line => line.map(quote).join(",")).join("\r\n");

      const blob = new Blob([csv], {
        type: "text/csv;charset=utf-8"
      });

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = "oman-national-day-quiz-results.csv";

      document.body.appendChild(link);
      link.click();
      link.remove();

      URL.revokeObjectURL(url);

    } catch (error) {
      showError(error.message || "تعذر تصدير النتائج.");
    }
  });

  $("copyLinkBtn").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(
        $("participantUrl").textContent
      );

      $("copyLinkBtn").textContent = "تم النسخ ✓";

      setTimeout(() => {
        $("copyLinkBtn").textContent = "نسخ الرابط";
      }, 1500);

    } catch (_) {
      showError(
        "تعذر النسخ تلقائياً. انسخ الرابط الظاهر بجانب QR Code."
      );
    }
  });

  $("logoutBtn").addEventListener("click", async () => {
    if (refreshTimer) clearInterval(refreshTimer);
    if (unsubscribe) unsubscribe();

    await QuizBackend.adminLogout();

    $("dashboardView").classList.add("hidden");
    $("loginView").classList.remove("hidden");
  });

  async function init() {
    if (QuizBackend.isDemo()) {
      $("demoNotice").classList.remove("hidden");
      $("demoPinField").classList.remove("hidden");
    } else {
      $("emailField").classList.remove("hidden");
      $("passwordField").classList.remove("hidden");
      $("demoPinField").classList.add("hidden");
    }

    if (await QuizBackend.adminSession()) {
      await showDashboard();
    }
  }

  init();
})();
