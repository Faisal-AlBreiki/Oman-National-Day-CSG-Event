(() => {
  const $ = (id) => document.getElementById(id);
  let soundEnabled = false;
  let revealStarted = false;
  let activeRoundId = null;
  let revealRunToken = 0;
  let lastState = null;
  let lastPublicActivityKey = "";
  let revealPlaybackToken = 0;

  // Audio levels can be adjusted here if the venue speakers are too loud/quiet.
  const LIVE_MUSIC_VOLUME = 0.22;
  const WIN_MUSIC_VOLUME = 0.55;

  function makeQr() {
    const url = new URL("index.html", window.location.href).href;
    $("screenQr").innerHTML = "";
    if (window.QRCode) new QRCode($("screenQr"), {text:url,width:122,height:122,colorDark:"#17120d",colorLight:"#ffffff",correctLevel:QRCode.CorrectLevel.M});
    else $("screenQr").textContent = "QR";
  }
  function setScreenStatus(status) {
    const labels = {registration:"التسجيل مفتوح",live:"المسابقة مباشرة",paused:"توقف مؤقت",revealing:"إعلان الفائزين",closed:"انتهت المسابقة"};
    $("screenLivePill").innerHTML = `<span class="status-dot"></span>${labels[status] || "في انتظار المسابقة"}`;
    $("screenLivePill").classList.toggle("live", status === "live");
  }
  function formatActivityTime(value) {
    if (!value) return "الآن";
    return new Intl.DateTimeFormat("ar-OM", {hour:"2-digit", minute:"2-digit"}).format(new Date(value));
  }
  function questionName(id) {
    const names = ["الأول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس", "السابع", "الثامن", "التاسع"];
    return names[Number(id) - 1] || String(id || "");
  }
  function publicActivityMessage(item) {
    const name = item.participant_name || "أحد المشاركين";
    if (item.event_type === "incorrect_answer") {
      return {icon:"😅", kind:"wrong", text:`${name} جاب العيد في السؤال ${questionName(item.question_id)} 😅`};
    }
    if (item.event_type === "completed") {
      return {icon:"🏁", kind:"complete", text:`${name} خلّص التحدي بنجاح! 🎉`};
    }
    return {icon:"✓", kind:"correct", text:`${name} جاوب السؤال ${questionName(item.question_id)} صح! 👏`};
  }
  function renderPublicActivity(items, status) {
    const safeItems = (items || []).slice(0,6);
    const activityKey = JSON.stringify({mode:status === "live" ? "live" : "idle", items:safeItems});
    $("screenActivityStatus").classList.toggle("active", status === "live");
    $("screenActivityStatus").innerHTML = status === "live" ? "<i></i> LIVE" : "<i></i> مباشر";
    if (activityKey === lastPublicActivityKey) return;
    lastPublicActivityKey = activityKey;

    const list = $("screenActivityList");
    list.innerHTML = "";
    if (!safeItems.length) {
      const empty = document.createElement("div");
      empty.className = "screen-activity-empty";
      empty.textContent = status === "live" ? "بانتظار أول إجابة... شدّوا حيلكم!" : "ستظهر التفاعلات هنا مع بدء المنافسة.";
      list.appendChild(empty);
      return;
    }

    safeItems.forEach(item => {
      const activity = publicActivityMessage(item);
      const row = document.createElement("div");
      row.className = `screen-activity-item is-${activity.kind}`;
      const icon = document.createElement("span");
      icon.className = `screen-activity-icon is-${activity.kind}`;
      icon.textContent = activity.icon;
      const message = document.createElement("p");
      message.textContent = activity.text;
      const time = document.createElement("time");
      time.textContent = formatActivityTime(item.created_at);
      row.append(icon, message, time);
      list.appendChild(row);
    });
  }

  function pauseAndReset(audio) {
    if (!audio) return;
    audio.pause();
    try { audio.currentTime = 0; } catch (_) { /* Ignore if media metadata is not ready yet. */ }
  }
  function stopLiveMusic() {
    pauseAndReset($("liveMusic"));
  }
  function stopRevealMusic() {
    // Only stop the winner track when sound is explicitly muted or a new round begins.
    revealPlaybackToken += 1;
    pauseAndReset($("revealMusic"));
  }
  async function primeAudioForPlayback(audio) {
    if (!audio) return;
    const wasMuted = audio.muted;
    const previousVolume = audio.volume;
    audio.muted = true;
    try {
      // Run from the sound-button gesture so browsers allow later event-driven playback.
      const playRequest = audio.play();
      if (playRequest && typeof playRequest.then === "function") await playRequest;
      audio.pause();
      try { audio.currentTime = 0; } catch (_) { /* Metadata may still be loading. */ }
    } catch (error) {
      console.debug("Audio pre-authorization was unavailable; playback will be attempted at reveal time.", error);
    } finally {
      audio.muted = wasMuted;
      audio.volume = previousVolume;
    }
  }
  async function playLiveMusic() {
    const audio = $("liveMusic");
    if (!audio || !soundEnabled || !["registration", "live", "paused"].includes(lastState?.status) || revealStarted || !audio.paused) return;
    audio.loop = true;
    audio.volume = LIVE_MUSIC_VOLUME;
    try {
      await audio.play();
    } catch (error) {
      console.warn("Live background music could not start. Press the sound button again after checking the audio file.", error);
    }
  }
  async function playRevealMusic() {
    stopLiveMusic();
    const audio = $("revealMusic");
    if (!audio || !soundEnabled) return;
    const playbackToken = ++revealPlaybackToken;
    audio.loop = false;
    audio.volume = WIN_MUSIC_VOLUME;
    audio.preload = "auto";
    try {
      if (audio.ended || audio.currentTime > 0) audio.currentTime = 0;
      await audio.play();
      // If the organizer muted sound while play() was pending, do not leave it running.
      if (playbackToken !== revealPlaybackToken || !soundEnabled) audio.pause();
    } catch (error) {
      console.warn("Winner reveal music could not start. Check public/assets/audio/win.mp3 and press the sound button.", error);
    }
  }
  function syncLiveMusic(status) {
    if (["registration", "live", "paused"].includes(status) && !revealStarted) {
      if (soundEnabled && $("liveMusic")?.paused) playLiveMusic();
    } else {
      stopLiveMusic();
    }
  }

  function showLobby() {
    $("publicLobby").classList.remove("hidden");
    $("countdownView").classList.remove("active");
    $("winnersView").classList.remove("active");
  }
  function showCountdown(number) {
    $("publicLobby").classList.add("hidden");
    $("winnersView").classList.remove("active");
    $("countdownView").classList.add("active");
    $("countdownNumber").textContent = String(number);
    $("countdownNumber").style.animation = "none";
    void $("countdownNumber").offsetWidth;
    $("countdownNumber").style.animation = "";
  }
  function renderWinners(winners) {
    const stage = $("winnersStage");
    stage.innerHTML = "";
    const sorted = winners.slice().sort((a,b)=>a.place-b.place);
    const byPlace = new Map(sorted.map(w => [Number(w.place), w]));
    const display = [byPlace.get(2), byPlace.get(1), byPlace.get(3)];
    display.forEach((winner, index) => {
      const place = index === 0 ? 2 : index === 1 ? 1 : 3;
      const slot = document.createElement("div");
      slot.className = `winner-slot${place === 1 ? " first" : ""}`;
      const cup = document.createElement("div"); cup.className="cup"; cup.textContent=place===1?"🏆":place===2?"🥈":"🥉";
      const label = document.createElement("div"); label.className="place"; label.textContent=place===1?"المركز الأول":place===2?"المركز الثاني":"المركز الثالث";
      const name = document.createElement("div"); name.className="name"; name.textContent=winner?.display_name || "الفائز";
      slot.append(cup,label,name); stage.appendChild(slot);
    });
  }
  async function startReveal(winners, roundId) {
    if (revealStarted) return;
    revealStarted = true;
    const runToken = ++revealRunToken;
    stopLiveMusic();
    showCountdown(3);
    if (soundEnabled) await playRevealMusic();
    await new Promise(resolve => setTimeout(resolve, 950));
    if (runToken !== revealRunToken) return;
    showCountdown(2);
    await new Promise(resolve => setTimeout(resolve, 950));
    if (runToken !== revealRunToken) return;
    showCountdown(1);
    await new Promise(resolve => setTimeout(resolve, 850));
    if (runToken !== revealRunToken) return;
    renderWinners(winners);
    $("publicLobby").classList.add("hidden");
    $("countdownView").classList.remove("active");
    $("winnersView").classList.add("active");
    const slots = [...$("winnersStage").children];
    [2,0,1].forEach((slotIndex,sequence) => setTimeout(()=>slots[slotIndex]?.classList.add("show"), sequence*700));
  }
  async function refresh() {
    try {
      const state = await QuizBackend.getPublicState();
      if (lastState?.status === "revealing" && state.status === "live" && state.round_id === activeRoundId) {
        revealRunToken += 1;
        revealStarted = false;
        stopRevealMusic();
      }
      if (activeRoundId && state.round_id !== activeRoundId) {
        revealRunToken += 1;
        revealStarted = false;
        stopLiveMusic();
        stopRevealMusic();
      }
      activeRoundId = state.round_id;
      lastState = state;
      $("screenParticipantCount").textContent = state.participant_count ?? 0;
      $("screenStartedCount").textContent = state.started_count ?? 0;
      setScreenStatus(state.status);
      renderPublicActivity(state.public_activity || [], state.status);
      syncLiveMusic(state.status);
      if (state.status === "registration") {
        $("screenStatusText").textContent = "المسابقة على وشك البدء. يمكنكم التسجيل الآن.";
        $("screenPrompt").textContent = "امسحوا رمز QR وكونوا مستعدين للتحدي!";
        showLobby();
      } else if (state.status === "live") {
        $("screenStatusText").textContent = "المنافسة مستمرة... من سيكون ضمن أوائل الفائزين؟";
        $("screenPrompt").textContent = "تابعوا التحدي، فالمراكز الثلاثة لم تُعلن بعد.";
        showLobby();
      } else if (state.status === "paused") {
        $("screenStatusText").textContent = "المسابقة متوقفة مؤقتاً.";
        $("screenPrompt").textContent = "سنعود إليكم بعد قليل.";
        showLobby();
      } else if (["closed", "revealing"].includes(state.status) && state.winners && state.winners.length === 3) {
        if (revealStarted) return;
        await startReveal(state.winners, state.round_id);
      } else {
        $("screenStatusText").textContent = "انتهت المسابقة. شكراً لجميع المشاركين.";
        $("screenPrompt").textContent = "نهنئ المشاركين ونتمنى لكم وقتاً ممتعاً.";
        showLobby();
      }
    } catch (error) { console.error(error); }
  }

  $("soundBtn").addEventListener("click", async () => {
    soundEnabled = !soundEnabled;
    $("soundBtn").textContent = soundEnabled ? "🔊 الصوت مفعّل" : "🔇 تفعيل الصوت";
    if (soundEnabled) {
      if (["closed", "revealing"].includes(lastState?.status) && lastState?.winners?.length === 3 && revealStarted) {
        await playRevealMusic();
      } else if (["registration", "live", "paused"].includes(lastState?.status)) {
        const revealUnlock = primeAudioForPlayback($("revealMusic"));
        await playLiveMusic();
        await revealUnlock;
      } else {
        await Promise.all([primeAudioForPlayback($("liveMusic")), primeAudioForPlayback($("revealMusic"))]);
      }
    } else {
      stopLiveMusic();
      stopRevealMusic();
    }
  });

  if (QuizBackend.isDemo()) $("screenDemoNotice").classList.remove("hidden");
  makeQr();
  refresh();
  window.setInterval(refresh, window.APP_CONFIG?.POLL_INTERVAL_MS || 2500);
  QuizBackend.subscribe(refresh);
})();
