(function () {
  const cfg = window.APP_CONFIG || {};
  const DEMO_KEY = "omanNationalDayQuizDemoState";
  const TOKEN_KEY = "omanNationalDayQuizClientToken";
  const PARTICIPANT_KEY = "omanNationalDayQuizParticipantId";
  const DEMO_VERSION = "registration-lock-v4";
  let supabaseClient = null;
  let demoChannel = null;

  const clone = (value) => JSON.parse(JSON.stringify(value));
  const makeId = () => (crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const clientStorage = () => cfg.DEMO_MODE ? sessionStorage : localStorage;
  const getToken = () => {
    const store = clientStorage();
    let token = store.getItem(TOKEN_KEY);
    if (!token) { token = makeId(); store.setItem(TOKEN_KEY, token); }
    return token;
  };

  function initialDemoState() {
    return {
      demo_version: DEMO_VERSION,
      round_id: makeId(),
      status: "registration",
      started_at: null,
      closed_at: null,
      participants: [],
      answers: [],
      winners: [],
      activity: [],
      questions: clone(window.DEMO_QUESTIONS || [])
    };
  }

  function readDemo() {
    try {
      const raw = localStorage.getItem(DEMO_KEY);
      if (!raw) return initialDemoState();
      const state = JSON.parse(raw);
      if (state.demo_version !== DEMO_VERSION) return initialDemoState();
      state.questions = clone(window.DEMO_QUESTIONS || []);
      return state;
    } catch (_) { return initialDemoState(); }
  }

  function writeDemo(state) {
    localStorage.setItem(DEMO_KEY, JSON.stringify(state));
    window.dispatchEvent(new CustomEvent("quiz-demo-update", { detail: state }));
    if (demoChannel) demoChannel.postMessage({ type: "update" });
    return state;
  }

  function getDemoParticipant(state, participantId, token) {
    return state.participants.find(p => p.id === participantId && p.client_token === token) || null;
  }

  function demoPublicState() {
    const state = readDemo();
    const startedIds = new Set(state.answers.map(a => a.participant_id));
    const revealed = state.winners.length === 3 && ["closed", "revealing"].includes(state.status);
    return {
      round_id: state.round_id,
      status: state.status,
      participant_count: state.participants.length,
      started_count: startedIds.size,
      // Public feed shows participant names and question outcomes, but never winner places or rankings.
      public_activity: state.activity.filter(item => item.event_type !== "completed").slice(0,6).map(item => ({
        event_type:item.event_type,
        participant_name:item.participant_name,
        question_id:item.question_id,
        created_at:item.created_at
      })),
      winners: revealed ? state.winners.slice().sort((a,b) => a.place-b.place).map(w => ({place:w.place, display_name:w.display_name, achieved_at:w.achieved_at})) : []
    };
  }

  function demoParticipantState(participantId, token) {
    const state = readDemo();
    const participant = getDemoParticipant(state, participantId, token);
    if (!participant) return null;
    const answers = state.answers.filter(a => a.participant_id === participantId);
    const resultsRevealed = ["closed", "revealing"].includes(state.status);
    const ownWinner = resultsRevealed
      ? state.winners.find(w => w.participant_id === participantId)
      : null;
    const completionOrder = resultsRevealed
      ? state.participants
          .filter(p => p.completed_at)
          .slice()
          .sort((a, b) => {
            const timeDiff = new Date(a.completed_at) - new Date(b.completed_at);
            return timeDiff || String(a.id).localeCompare(String(b.id));
          })
      : [];
    const completionRank = resultsRevealed && participant.completed_at
      ? completionOrder.findIndex(p => p.id === participantId) + 1
      : null;
    return {
      participant_id: participant.id,
      display_name: participant.display_name,
      correct_count: participant.correct_count,
      answered_questions: answers.map(a => ({question_id:a.question_id, is_correct:a.is_correct})),
      competition_status: state.status,
      results_revealed: resultsRevealed,
      winner_place: ownWinner ? ownWinner.place : null,
      completion_rank: completionRank || null
    };
  }

  async function callRpc(name, params) {
    if (!supabaseClient) throw new Error("Supabase is not configured. Check js/config.js.");
    const { data, error } = await supabaseClient.rpc(name, params || {});
    if (error) throw error;
    return data;
  }

  function initSupabase() {
    if (cfg.DEMO_MODE) return;
    const publicKey = cfg.SUPABASE_PUBLISHABLE_KEY || cfg.SUPABASE_ANON_KEY;
    if (!window.supabase || !cfg.SUPABASE_URL || !publicKey ||
        cfg.SUPABASE_URL.includes("YOUR-PROJECT") || publicKey.includes("YOUR_SUPABASE")) {
      console.error("Supabase configuration is missing. Set DEMO_MODE=true or configure Supabase in js/config.js.");
      return;
    }
    supabaseClient = window.supabase.createClient(cfg.SUPABASE_URL, publicKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
  }
  initSupabase();

  if (typeof BroadcastChannel !== "undefined") demoChannel = new BroadcastChannel("oman-national-day-quiz-demo");

  const api = {
    isDemo: () => !!cfg.DEMO_MODE,
    getToken,
    getStoredParticipantId: () => clientStorage().getItem(PARTICIPANT_KEY),
    storeParticipantId: (id) => clientStorage().setItem(PARTICIPANT_KEY, id),
    clearParticipant: () => clientStorage().removeItem(PARTICIPANT_KEY),
    getQuestions: async () => {
      if (cfg.DEMO_MODE) return clone(readDemo().questions).sort((a,b) => a.display_order-b.display_order);
      if (!supabaseClient) throw new Error("إعدادات Supabase غير مكتملة.");
      const { data, error } = await supabaseClient.from("public_questions").select("id,prompt,card_image,options,display_order").order("display_order");
      if (error) throw error;
      return data || [];
    },
    getPublicState: async () => {
      if (cfg.DEMO_MODE) return demoPublicState();
      return await callRpc("get_public_state");
    },
    registerParticipant: async (displayName) => {
      const token = getToken();
      if (cfg.DEMO_MODE) {
        const state = readDemo();
        const existing = state.participants.find(p => p.client_token === token);
        if (existing) { clientStorage().setItem(PARTICIPANT_KEY, existing.id); return {participant_id: existing.id, status: state.status, display_name: existing.display_name}; }
        if (state.status !== "registration") throw new Error("انتهى التسجيل. لا يمكن تسجيل مشاركين جدد بعد بدء المسابقة.");
        const participant = {id: makeId(), client_token: token, display_name: displayName.trim(), joined_at: new Date().toISOString(), correct_count: 0};
        state.participants.push(participant);
        writeDemo(state);
        clientStorage().setItem(PARTICIPANT_KEY, participant.id);
        return {participant_id: participant.id, status: state.status, display_name: participant.display_name};
      }
      const result = await callRpc("register_participant", {p_name: displayName.trim(), p_client_token: token});
      if (result && result.participant_id) clientStorage().setItem(PARTICIPANT_KEY, result.participant_id);
      return result;
    },
    getParticipantState: async (participantId) => {
      const token = getToken();
      if (cfg.DEMO_MODE) return demoParticipantState(participantId, token);
      return await callRpc("get_participant_state", {p_participant_id: participantId, p_client_token: token});
    },
    answerQuestion: async (participantId, questionId, selectedOption) => {
      const token = getToken();
      if (cfg.DEMO_MODE) {
        const state = readDemo();
        if (state.status !== "live") throw new Error("المسابقة غير متاحة للإجابة حالياً.");
        const participant = getDemoParticipant(state, participantId, token);
        if (!participant) throw new Error("تعذر العثور على المشاركة. أعد التسجيل.");
        if (participant.correct_count >= 3) throw new Error("أكملت ثلاثة أسئلة صحيحة بالفعل. يرجى انتظار إعلان النتائج.");
        if (state.winners.some(w => w.participant_id === participantId)) throw new Error("تم تسجيلك كأحد الفائزين بالفعل.");
        if (state.answers.some(a => a.participant_id === participantId && a.question_id === questionId)) throw new Error("لقد أجبت عن هذه البطاقة مسبقاً.");
        const question = state.questions.find(q => q.id === questionId);
        if (!question) throw new Error("السؤال غير موجود.");
        const isCorrect = Number(selectedOption) === Number(question.correct_option);
        const answer = {participant_id: participantId, question_id: questionId, is_correct: isCorrect, selected_option: selectedOption, submitted_at: new Date().toISOString()};
        state.answers.push(answer);
        if (isCorrect) participant.correct_count += 1;
        state.activity.unshift({
          event_type:isCorrect ? "correct_answer" : "incorrect_answer",
          participant_id:participantId,
          participant_name:participant.display_name,
          question_id:questionId,
          created_at:answer.submitted_at
        });
        if (participant.correct_count >= 3 && !participant.completed_at) {
          const completedAt = new Date().toISOString();
          participant.completed_at = completedAt;
          if (state.winners.length < 3 && state.status === "live") {
            const place = state.winners.length + 1;
            state.winners.push({place, participant_id:participantId, display_name:participant.display_name, achieved_at:completedAt});
          }
          state.activity.unshift({event_type:"completed", participant_id:participantId, participant_name:participant.display_name, question_id:null, created_at:completedAt});
        }
        writeDemo(state);
        return {is_correct:isCorrect, correct_count:participant.correct_count, competition_status:state.status, already_answered:false};
      }
      return await callRpc("answer_question", {p_participant_id:participantId, p_client_token:token, p_question_id:questionId, p_selected_option:selectedOption});
    },
    adminLogin: async (credentials) => {
      if (cfg.DEMO_MODE) {
        if (credentials.pin !== cfg.DEMO_ADMIN_PIN) throw new Error("رمز الإدارة غير صحيح.");
        sessionStorage.setItem("omanQuizDemoAdmin", "1");
        return {demo:true};
      }
      if (!supabaseClient) throw new Error("إعدادات Supabase غير مكتملة.");
      const {data, error} = await supabaseClient.auth.signInWithPassword({email:credentials.email, password:credentials.password});
      if (error) throw error;
      const isAdmin = await callRpc("is_admin");
      if (!isAdmin) { await supabaseClient.auth.signOut(); throw new Error("هذا الحساب غير مصرح له بالدخول إلى لوحة الإدارة."); }
      return data;
    },
    adminSession: async () => {
      if (cfg.DEMO_MODE) return sessionStorage.getItem("omanQuizDemoAdmin") === "1";
      if (!supabaseClient) return false;
      const {data} = await supabaseClient.auth.getSession();
      if (!data.session) return false;
      try { return !!(await callRpc("is_admin")); } catch (_) { return false; }
    },
    adminLogout: async () => {
      if (cfg.DEMO_MODE) sessionStorage.removeItem("omanQuizDemoAdmin");
      else if (supabaseClient) await supabaseClient.auth.signOut();
    },
    getAdminDashboard: async () => {
      if (cfg.DEMO_MODE) {
        const state = readDemo();
        const publicState = demoPublicState();
        return {
          ...publicState,
          activity: state.activity.slice(0,30),
          participants: state.participants.slice().sort((a,b) => new Date(b.joined_at) - new Date(a.joined_at)).map(p => {
            const winner = state.winners.find(w => w.participant_id === p.id);
            return {
              participant_id: p.id,
              display_name: p.display_name,
              joined_at: p.joined_at,
              started_at: p.started_at || null,
              correct_count: p.correct_count || 0,
              completed_at: p.completed_at || null,
              winner_place: winner ? winner.place : null
            };
          }),
          winners: state.winners.length === 3 ? state.winners.slice().sort((a,b)=>a.place-b.place) : [],
          completed_count: state.winners.length,
          status: state.status,
          answers_count: state.answers.length
        };
      }
      return await callRpc("admin_dashboard_state");
    },
    deleteParticipant: async (participantId) => {
      if (cfg.DEMO_MODE) {
        const state = readDemo();
        if (state.status !== "registration") {
          throw new Error("لا يمكن حذف المشاركين بعد بدء المسابقة. الحذف متاح أثناء التسجيل فقط.");
        }
        const participant = state.participants.find(p => p.id === participantId);
        if (!participant) throw new Error("المشارك غير موجود أو تم حذفه مسبقاً.");

        const participantName = participant.display_name;
        state.participants = state.participants.filter(p => p.id !== participantId);
        state.answers = state.answers.filter(a => a.participant_id !== participantId);
        state.activity = state.activity.filter(item => {
          if (item.participant_id) return item.participant_id !== participantId;
          // Older demo events did not store participant IDs; remove matching legacy name events.
          return item.participant_name !== participantName;
        });

        // Rebuild the first three places from all remaining completed participants.
        state.winners = state.participants
          .filter(p => p.completed_at)
          .sort((a,b) => new Date(a.completed_at) - new Date(b.completed_at))
          .slice(0,3)
          .map((p,index) => ({
            place:index+1,
            participant_id:p.id,
            display_name:p.display_name,
            achieved_at:p.completed_at
          }));

        writeDemo(state);
        return {success:true, deleted_participant_id:participantId, completed_count:state.winners.length};
      }
      return await callRpc("admin_delete_participant", {p_participant_id:participantId});
    },
    getAdminExport: async () => {
      if (cfg.DEMO_MODE) {
        const state = readDemo();
        return state.participants.map(p => {
          const winner = state.winners.find(w => w.participant_id === p.id);
          return {display_name:p.display_name, joined_at:p.joined_at, correct_count:p.correct_count, winner_place:winner ? winner.place : null};
        });
      }
      return await callRpc("admin_export_results");
    },
    setCompetitionStatus: async (status) => {
      if (cfg.DEMO_MODE) {
        const state = readDemo();
        if (status === "live" && ["registration","paused"].includes(state.status)) {
          state.status = "live";
          if (!state.started_at) state.started_at = new Date().toISOString();
        } else if (status === "paused" && state.status === "live") state.status = "paused";
        else if (status === "closed" && ["live","paused","registration"].includes(state.status)) { state.status="closed"; state.closed_at=new Date().toISOString(); }
        writeDemo(state);
        return demoPublicState();
      }
      return await callRpc("admin_set_competition_status", {p_status:status});
    },
    resetCompetition: async () => {
      if (cfg.DEMO_MODE) {
        const current = readDemo();
        if (!["closed", "revealing"].includes(current.status)) {
          throw new Error("يمكن بدء جولة جديدة بعد إنهاء الجولة الحالية فقط.");
        }
        const state = initialDemoState();
        writeDemo(state);
        return demoPublicState();
      }
      return await callRpc("admin_reset_competition");
    },
    subscribe: (callback) => {
      const handler = () => callback();
      window.addEventListener("quiz-demo-update", handler);
      window.addEventListener("storage", (event) => { if (event.key === DEMO_KEY) callback(); });
      if (demoChannel) demoChannel.addEventListener("message", handler);
      if (!cfg.DEMO_MODE && supabaseClient) {
        const channel = supabaseClient.channel("quiz-live-updates")
          .on("postgres_changes", {event:"*", schema:"public", table:"competition_state"}, callback)
          .on("postgres_changes", {event:"*", schema:"public", table:"activity_log"}, callback)
          .subscribe();
        return () => { window.removeEventListener("quiz-demo-update", handler); supabaseClient.removeChannel(channel); };
      }
      return () => { window.removeEventListener("quiz-demo-update", handler); if (demoChannel) demoChannel.removeEventListener("message", handler); };
    },
    getDemoModeLabel: () => cfg.DEMO_MODE ? "وضع تجريبي محلي" : "متصل بقاعدة البيانات"
  };

  window.QuizBackend = api;
})();
