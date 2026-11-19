(() => {
  const $ = (id) => document.getElementById(id);
  const views = ["welcomeView","registerView","registrationClosedView","waitingView","pausedView","gameView","finishedView"];
  let participantId = null;
  let participantState = null;
  let questions = [];
  let currentQuestion = null;
  let busy = false;
  let pollHandle = null;
  let unsubscribe = null;
  let publicStatus = null;

  const answeredMap = () => new Map((participantState?.answered_questions || []).map(a => [Number(a.question_id), !!a.is_correct]));
  const showView = (id) => views.forEach(view => $(view).classList.toggle("hidden", view !== id));
  const setError = (message) => { $("globalError").textContent = message; $("globalError").classList.toggle("hidden", !message); };

  function updatePublicStatus(state) {
    const pill = $("participantLivePill");
    if (!pill || !state) return;
    const labels = {
      registration: "التسجيل مفتوح",
      live: "LIVE · المسابقة مباشرة",
      paused: "المسابقة متوقفة مؤقتاً",
      revealing: "انتظروا إعلان النتائج",
      closed: "انتهت المسابقة"
    };
    publicStatus = state.status;
    pill.innerHTML = `<span class="status-dot"></span>${labels[state.status] || "مسابقة اليوم الوطني"}`;
    pill.classList.toggle("live", state.status === "live");
    const registerButton = $("showRegisterBtn");
    if (registerButton) registerButton.classList.toggle("hidden", state.status !== "registration");
  }

  function updateProgress() {
    const count = Number(participantState?.correct_count || 0);
    $("progressNumber").textContent = `${count} / 3`;
    $("progressFill").style.width = `${Math.min(100, count / 3 * 100)}%`;
  }

  function renderCards() {
    const answered = answeredMap();
    const grid = $("cardsGrid");
    grid.innerHTML = "";
    questions.forEach((question, index) => {
      const isAnswered = answered.has(Number(question.id));
      const isCorrect = answered.get(Number(question.id));
      const button = document.createElement("button");
      button.type = "button";
      button.className = `question-card${isAnswered ? (isCorrect ? " answered-correct" : " answered-wrong") : ""}`;
      button.disabled = isAnswered || busy;
      button.setAttribute("aria-label", `السؤال ${index + 1}${isAnswered ? " تمت الإجابة" : ""}`);
      const img = document.createElement("img");
      // All nine cards use the configured Oman emblem image.
      img.src = question.card_image || "assets/images/card-oman-emblem.png";
      img.alt = "";
      img.loading = "lazy";
      const number = document.createElement("span");
      number.className = "card-number";
      number.textContent = String(index + 1);
      const state = document.createElement("span");
      state.className = "card-state";
      state.textContent = isAnswered ? (isCorrect ? "✓" : "×") : "؟";
      const label = document.createElement("span");
      label.className = "card-label";
      label.textContent = isAnswered ? (isCorrect ? "إجابة صحيحة" : "تمت المحاولة") : `السؤال ${index + 1}`;
      button.append(img, number, state, label);
      button.addEventListener("click", () => openQuestion(question));
      grid.appendChild(button);
    });
    updateProgress();
  }

  function openQuestion(question) {
    if (busy || Number(participantState?.correct_count || 0) >= 3 || answeredMap().has(Number(question.id))) return;
    currentQuestion = question;
    $("questionTitle").textContent = question.prompt;
    $("answerFeedback").className = "feedback";
    $("answerFeedback").textContent = "";
    $("closeQuestionBtn").classList.add("hidden");
    const optionsGrid = $("optionsGrid");
    optionsGrid.innerHTML = "";
    const options = (question.options || []).map((option, originalIndex) => ({...option, originalIndex}));
    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [options[i], options[j]] = [options[j], options[i]];
    }
    options.forEach(option => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "option-btn";
      const text = document.createElement("span");
      text.textContent = option.text || `الخيار ${option.originalIndex + 1}`;
      button.appendChild(text);
      button.addEventListener("click", () => submitAnswer(option.originalIndex));
      optionsGrid.appendChild(button);
    });
    $("questionBackdrop").classList.add("open");
  }

  function renderFinalParticipantResult(ownState) {
    const name = ownState?.display_name || participantState?.display_name || "مشارك";
    const rank = Number(ownState?.completion_rank || ownState?.winner_place || 0);
    const correctCount = Number(ownState?.correct_count || 0);
    const ordinalLabels = {
      1: "المركز الأول",
      2: "المركز الثاني",
      3: "المركز الثالث",
      4: "المركز الرابع",
      5: "المركز الخامس",
      6: "المركز السادس",
      7: "المركز السابع",
      8: "المركز الثامن",
      9: "المركز التاسع",
      10: "المركز العاشر"
    };
    const medals = {1: "🥇", 2: "🥈", 3: "🥉"};
    const rankLabel = ordinalLabels[rank] ||
      (rank > 10 ? `المركز رقم ${rank.toLocaleString("ar-OM")}` : "");

    $("questionBackdrop").classList.remove("open");
    busy = false;

    if (rank > 0 && rankLabel) {
      if (rank <= 3) {
        $("finishedIcon").textContent = medals[rank];
        $("finishedBadge").textContent = "النتيجة النهائية";
        $("finishedTitle").textContent = `مبارك يا ${name}!`;
      } else {
        $("finishedIcon").textContent = "🏅";
        $("finishedBadge").textContent = "ترتيبك النهائي";
        $("finishedTitle").textContent = `أحسنت يا ${name}!`;
      }

      $("finishedMessage").textContent =
        `حصلت على ${rankLabel} في مسابقة «من يعرف عُمان أكثر؟». أكملت ثلاثة أسئلة صحيحة.`;
    } else {
      $("finishedIcon").textContent = "🇴🇲";
      $("finishedBadge").textContent = "انتهت المسابقة";
      $("finishedTitle").textContent = `شكراً لمشاركتك يا ${name}!`;
      $("finishedMessage").textContent = correctCount >= 3
        ? "أكملت ثلاثة أسئلة صحيحة، لكن تعذر تحديد ترتيبك في هذه الجولة. يرجى مراجعة المنظم."
        : `سجلت ${correctCount} من 3 إجابات صحيحة. شكراً لمشاركتك في مسابقة «من يعرف عُمان أكثر؟».`;
    }

    showView("finishedView");
  }

  function renderWaitingForAnnouncement(competitionStatus = participantState?.competition_status) {
    $("questionBackdrop").classList.remove("open");
    busy = false;

    if (["closed", "revealing"].includes(competitionStatus)) {
      renderFinalParticipantResult(participantState);
      return;
    }

    // Keep the existing waiting experience unchanged until the organizer announces results.
    $("finishedIcon").textContent = "⏳";
    $("finishedBadge").textContent = "تم استلام إجاباتك";
    const participantName = participantState?.display_name || "مشارك";
    $("finishedTitle").textContent = `أكملت 3 إجابات صحيحة يا ${participantName}!`;
    $("finishedMessage").textContent =
      "أحسنت! تم تسجيل إجاباتك بنجاح. يرجى الانتظار حتى إعلان النتائج على الشاشة الكبيرة.";
    showView("finishedView");
  }

  function closeQuestion() {
    $("questionBackdrop").classList.remove("open");
    currentQuestion = null;
    busy = false;
    if (Number(participantState?.correct_count || 0) >= 3) renderWaitingForAnnouncement(participantState?.competition_status);
    else renderCards();
  }

  async function submitAnswer(selectedOption) {
    if (!currentQuestion || busy) return;
    busy = true;
    const buttons = [...$("optionsGrid").querySelectorAll("button")];
    buttons.forEach(button => button.disabled = true);
    try {
      const result = await QuizBackend.answerQuestion(participantId, currentQuestion.id, selectedOption);
      participantState = await QuizBackend.getParticipantState(participantId);
      updateProgress();
      if (Number(participantState?.correct_count || result.correct_count || 0) >= 3) {
        $("answerFeedback").textContent = "أحسنت! أكملت ثلاثة أسئلة بشكل صحيح. يرجى الانتظار حتى إعلان النتائج.";
        $("answerFeedback").className = "feedback show correct";
        $("closeQuestionBtn").textContent = "متابعة";
        $("closeQuestionBtn").onclick = closeQuestion;
      } else {
        const message = result.is_correct ? "إجابة صحيحة! أحسنت." : "إجابة غير صحيحة. هذه البطاقة انتهت محاولتها.";
        $("answerFeedback").textContent = message;
        $("answerFeedback").className = `feedback show ${result.is_correct ? "correct" : "wrong"}`;
        $("closeQuestionBtn").textContent = "العودة إلى البطاقات";
        $("closeQuestionBtn").onclick = closeQuestion;
      }
      $("closeQuestionBtn").classList.remove("hidden");
      busy = false;
    } catch (error) {
      busy = false;
      $("answerFeedback").textContent = error.message || "تعذر إرسال الإجابة. حاول مرة أخرى.";
      $("answerFeedback").className = "feedback show wrong";
      $("closeQuestionBtn").classList.remove("hidden");
      $("closeQuestionBtn").textContent = "إغلاق";
      $("closeQuestionBtn").onclick = closeQuestion;
    }
  }

  function renderFinished(ownState, publicState) {
    $("questionBackdrop").classList.remove("open");
    busy = false;

    const status = publicState?.status || ownState?.competition_status;
    if (["closed", "revealing"].includes(status)) {
      renderFinalParticipantResult(ownState);
      return;
    }

    if (Number(ownState?.correct_count || 0) >= 3) {
      renderWaitingForAnnouncement(status);
      return;
    }

    $("finishedIcon").textContent = "🇴🇲";
    $("finishedBadge").textContent = "انتهت المشاركة";
    $("finishedTitle").textContent = "شكراً لمشاركتك!";
    $("finishedMessage").textContent =
      "اكتملت المسابقة. شكراً لمشاركتك واحتفالك معنا.";
    showView("finishedView");
  }

  async function refreshState() {
    let publicState = null;
    try {
      publicState = await QuizBackend.getPublicState();
      updatePublicStatus(publicState);
    } catch (error) {
      console.error(error);
      setError("تعذر الاتصال بالخادم. تحقق من اتصال الإنترنت ثم أعد تحميل الصفحة.");
      return;
    }

    if (!participantId) {
      // Do not force the welcome screen while a visitor is entering their name.
      // refreshState runs on a timer; before registration is submitted there is
      // intentionally no participantId yet. Keep the current view during the
      // registration phase, but close the form if the organizer starts the quiz.
      if (publicState.status !== "registration") {
        showView("registrationClosedView");
      }
      return;
    }
    try {
      const ownState = await QuizBackend.getParticipantState(participantId);
      if (!ownState) {
        participantId = null;
        participantState = null;
        QuizBackend.clearParticipant();
        showView(publicState.status === "registration" ? "welcomeView" : "registrationClosedView");
        return;
      }
      participantState = ownState;
      $("participantDisplayName").textContent = ownState.display_name || "مشارك";

      // Keep each participant's result private. Never display winner place on this device.
      if (Number(ownState.correct_count || 0) >= 3) {
        renderWaitingForAnnouncement(publicState.status);
      } else if (publicState.status === "registration") {
        $("waitingText").textContent = "تم تسجيل اسمك بنجاح. ستبدأ الأسئلة تلقائياً عندما يفتح المنظم المسابقة.";
        showView("waitingView");
      } else if (publicState.status === "live") {
        showView("gameView");
        renderCards();
      } else if (publicState.status === "paused") {
        showView("pausedView");
      } else {
        renderFinished(ownState, publicState);
      }
    } catch (error) {
      console.error(error);
      setError("تعذر تحميل مشاركتك. تحقق من اتصال الإنترنت ثم أعد تحميل الصفحة.");
    }
  }

  async function startRegistration() {
    setError("");
    if (publicStatus !== "registration") {
      await refreshState();
      if (publicStatus !== "registration") {
        showView("registrationClosedView");
        return;
      }
    }
    showView("registerView");
    setTimeout(() => $("participantName").focus(), 80);
  }

  $("showRegisterBtn").addEventListener("click", startRegistration);
  $("backToWelcome").addEventListener("click", () => showView("welcomeView"));
  $("registerForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    setError("");
    const name = $("participantName").value.trim();
    if (name.length < 2) { setError("يرجى إدخال اسم مكوّن من حرفين على الأقل."); return; }
    const submit = $("registerSubmit");
    submit.disabled = true;
    submit.textContent = "جارٍ التسجيل...";
    try {
      const result = await QuizBackend.registerParticipant(name);
      participantId = result.participant_id;
      await refreshState();
    } catch (error) {
      if (publicStatus !== "registration") {
        await refreshState();
        if (!participantId) showView("registrationClosedView");
      } else {
        setError(error.message || "تعذر إكمال التسجيل.");
      }
    } finally {
      submit.disabled = false;
      submit.textContent = "تأكيد التسجيل";
    }
  });
  $("closeQuestionBtn").addEventListener("click", closeQuestion);
  $("questionBackdrop").addEventListener("click", (event) => { if (event.target === $("questionBackdrop") && !busy) closeQuestion(); });

  async function init() {
    if (QuizBackend.isDemo()) $("demoNotice").classList.remove("hidden");
    try {
      questions = await QuizBackend.getQuestions();
      const storedId = QuizBackend.getStoredParticipantId();
      if (storedId) participantId = storedId;
    } catch (error) {
      setError(error.message || "تعذر تحميل المسابقة.");
    }
    await refreshState();
    pollHandle = window.setInterval(refreshState, (window.APP_CONFIG?.POLL_INTERVAL_MS || 2500));
    unsubscribe = QuizBackend.subscribe(() => refreshState());
  }
  init();
})();
