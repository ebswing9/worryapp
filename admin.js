let ME = null;
let ROUND = null;
let STUDENTS = [];       // [{uid, name, ...}]
let WORRIES = [];        // 이번 라운드 제출된 고민들
let DRAFT_PAIRS = [];    // 매칭 초안 [{worryId, authorUid, receiverUid}]
let SETTINGS = { keywords: ["죽고싶", "자살", "자해", "폭행", "괴롭힘"], replyMode: "single" };

requireLogin("teacher", async (profile) => {
  ME = profile;
  await ensureSettings();
  await loadStudents();
  renderAccounts();
  await loadRound();
  setupTabs();
});

async function loadStudents() {
  const studentsSnap = await db.collection("users")
    .where("classId", "==", CLASS_ID).where("role", "==", "student").get();
  STUDENTS = studentsSnap.docs.map(d => ({ uid: d.id, ...d.data() }));
}

function setupTabs() {
  document.querySelectorAll(".tabs button").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tabs button").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(".tab-panel").forEach(p => p.classList.add("hidden"));
      document.getElementById("tab-" + btn.dataset.tab).classList.remove("hidden");
      if (btn.dataset.tab === "accounts") renderAccounts();
      if (btn.dataset.tab === "monitor") renderMonitor();
      if (btn.dataset.tab === "flagged") renderFlagged();
      if (btn.dataset.tab === "settings") renderSettings();
      if (btn.dataset.tab === "matching") loadDraft();
    });
  });
}

async function ensureSettings() {
  const doc = await db.collection("settings").doc(CLASS_ID).get();
  if (doc.exists) {
    SETTINGS = doc.data();
  } else {
    await db.collection("settings").doc(CLASS_ID).set(SETTINGS);
  }
}

// ---------- 라운드 로드 ----------
async function loadRound() {
  const snap = await db.collection("rounds")
    .where("classId", "==", CLASS_ID)
    .where("status", "in", ["open", "closed", "deployed"])
    .get();
  if (snap.empty) {
    document.getElementById("no-round-view").classList.remove("hidden");
    return;
  }
  let latest = null;
  snap.forEach(d => {
    const data = d.data();
    if (!latest || data.roundNumber > latest.data.roundNumber) latest = { id: d.id, data };
  });
  ROUND = { id: latest.id, ...latest.data };
  document.getElementById("main-view").classList.remove("hidden");
  document.getElementById("round-label").textContent =
    `${ROUND.roundNumber}라운드 · 상태: ${statusLabel(ROUND.status)}`;

  await loadStudents();

  const worriesSnap = await db.collection("worries").where("roundId", "==", ROUND.id).get();
  WORRIES = worriesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  renderSubmissions();
  document.getElementById("close-round-btn").disabled = ROUND.status !== "open";
  document.getElementById("reopen-round-btn").classList.toggle("hidden", ROUND.status !== "closed");
  document.getElementById("run-match-btn").disabled = ROUND.status === "deployed";
  document.getElementById("rematch-btn").disabled = ROUND.status === "deployed";
  document.getElementById("deploy-btn").disabled = ROUND.status !== "closed";
}

function statusLabel(s) {
  return { open: "제출 진행중", closed: "마감(매칭 대기)", deployed: "배포 완료", archived: "보관됨" }[s] || s;
}

async function startFirstRound() {
  await createNewRound(1);
  location.reload();
}
async function createNewRound(num) {
  await db.collection("rounds").add({
    classId: CLASS_ID, roundNumber: num, status: "open",
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
}

// ---------- 계정관리 ----------
function renderAccounts() {
  const table = document.getElementById("account-table");
  if (!STUDENTS.length) {
    table.innerHTML = "<tr><td class='muted'>아직 등록된 학생이 없습니다.</td></tr>";
    return;
  }
  table.innerHTML = `<tr><th><input type="checkbox" id="select-all-students" onchange="toggleAllStudentChecks(this)"></th><th>이름</th><th>아이디</th></tr>` +
    STUDENTS.map(s => `
      <tr><td><input type="checkbox" class="student-check" value="${s.uid}"></td>
      <td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.username || "")}</td></tr>
    `).join("");
}

function toggleAllStudentChecks(master) {
  document.querySelectorAll(".student-check").forEach(cb => cb.checked = master.checked);
}

async function bulkDeleteAccounts() {
  const checked = Array.from(document.querySelectorAll(".student-check:checked")).map(cb => cb.value);
  if (!checked.length) { alert("삭제할 학생을 먼저 선택해주세요."); return; }
  const names = checked.map(uid => nameOf(uid)).join(", ");
  if (!confirm(`${names} 학생을 삭제할까요?\n(로그인은 즉시 막히지만, Firebase 인증 목록에는 흔적이 일부 남을 수 있어요)`)) return;

  const batch = db.batch();
  checked.forEach(uid => batch.delete(db.collection("users").doc(uid)));
  await batch.commit();
  await loadStudents();
  renderAccounts();
  alert("삭제되었습니다.");
}

function usernameToEmail(username) {
  return username.trim().toLowerCase() + "@ourclass.local";
}

document.getElementById("csv-file-input").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (evt) => {
    document.getElementById("roster-input").value = evt.target.result.trim();
  };
  reader.readAsText(file, "utf-8");
});

function downloadRosterCsv() {
  const rows = ["이름,아이디"].concat(STUDENTS.map(s => `${s.name},${s.username}`));
  downloadTextFile(rows.join("\n"), `학생명단-${Date.now()}.csv`);
}

function downloadTextFile(text, filename) {
  const blob = new Blob(["\uFEFF" + text], { type: "text/csv;charset=utf-8;" }); // BOM 추가로 엑셀에서 한글 안 깨지게
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
}

async function bulkCreateAccounts() {
  const raw = document.getElementById("roster-input").value.trim();
  const commonPassword = document.getElementById("default-password").value.trim();
  if (!raw) return;

  const lines = raw.split("\n").map(l => l.trim()).filter(Boolean);
  const resultBox = document.getElementById("account-result");
  resultBox.innerHTML = "";
  let successCount = 0;

  for (const line of lines) {
    const [namePart, usernamePart, passwordPart] = line.split(",").map(s => s && s.trim());
    if (!namePart) continue;
    const name = namePart;
    const username = usernamePart || ("student" + Math.floor(1000 + Math.random() * 9000));
    const password = passwordPart || commonPassword;
    const email = usernameToEmail(username);
    const logLine = document.createElement("div");
    logLine.className = "muted";

    if (!password || password.length < 6) {
      logLine.textContent = `❌ ${name} (${username}) — 비밀번호가 없거나 6자 미만이라 건너뜀`;
      resultBox.appendChild(logLine);
      continue;
    }

    try {
      // 보조 앱 인스턴스를 사용하므로, 계정을 만들어도 선생님의 로그인 세션은 그대로 유지됩니다.
      const cred = await secondaryAuth.createUserWithEmailAndPassword(email, password);
      await secondaryAuth.signOut();
      await db.collection("users").doc(cred.user.uid).set({
        name, username, role: "student", classId: CLASS_ID
      });
      logLine.textContent = `✅ ${name} (${username}) 생성 완료`;
      successCount++;
    } catch (e) {
      if (e.code === "auth/email-already-in-use") {
        logLine.textContent = `ℹ️ ${name} (${username}) — 이미 존재하는 아이디라 건너뜀`;
      } else {
        logLine.textContent = `❌ ${name} (${username}) — 실패: ${e.message}`;
      }
    }
    resultBox.appendChild(logLine);
  }
  resultBox.appendChild(Object.assign(document.createElement("div"), {
    textContent: `총 ${lines.length}명 중 ${successCount}명 새로 생성됨.`,
    className: "muted", style: "margin-top:6px;font-weight:600;"
  }));
  await loadStudents();
  renderAccounts();
}


function renderSubmissions() {
  const submittedUids = new Set(WORRIES.map(w => w.authorUid));
  document.getElementById("submission-count").textContent =
    `제출 현황: ${submittedUids.size} / ${STUDENTS.length}명`;

  const table = document.getElementById("submission-table");
  table.innerHTML = "<tr><th>이름</th><th>상태</th></tr>" + STUDENTS.map(s => `
    <tr><td>${escapeHtml(s.name)}</td><td>${submittedUids.has(s.uid)
      ? '<span class="status-ok">✅ 제출완료</span>'
      : '<span class="status-no">❌ 미제출</span>'}</td></tr>
  `).join("");

  const preview = document.getElementById("preview-list");
  if (!WORRIES.length) {
    preview.innerHTML = "<p class='muted'>아직 제출된 고민이 없어요.</p>";
  } else {
    preview.innerHTML = WORRIES.map(w => `
      <div class="card">
        <div class="chip">${escapeHtml(nameOf(w.authorUid))}</div>
        <p style="white-space:pre-wrap;">${escapeHtml(w.text)}</p>
      </div>
    `).join("");
  }
}

async function closeRound() {
  if (!confirm("제출을 마감할까요? 이후 학생들은 고민을 제출/수정할 수 없습니다.")) return;
  await db.collection("rounds").doc(ROUND.id).update({ status: "closed" });
  await loadRound();
}

async function reopenRound() {
  if (!confirm("제출을 다시 열까요? 매칭을 이미 실행했다면 그 결과는 초기화됩니다.")) return;
  await db.collection("draftMatches").doc(ROUND.id).delete().catch(() => {});
  DRAFT_PAIRS = [];
  await db.collection("rounds").doc(ROUND.id).update({ status: "open" });
  await loadRound();
}

// ---------- 매칭 ----------
async function loadDraft() {
  const doc = await db.collection("draftMatches").doc(ROUND.id).get();
  DRAFT_PAIRS = doc.exists ? doc.data().pairs : [];
  renderMatchTable();
}

function nameOf(uid) {
  const s = STUDENTS.find(s => s.uid === uid);
  return s ? s.name : "(알수없음)";
}

function makeDerangement(items) {
  // items: authorUid 배열. 자기 자신을 받지 않는 무작위 순열을 찾을 때까지 셔플 반복
  if (items.length < 2) return null;
  let attempt = 0;
  while (attempt < 200) {
    const shuffled = [...items];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    if (shuffled.every((v, i) => v !== items[i])) return shuffled;
    attempt++;
  }
  return null; // 매우 드문 실패 (예: 인원이 2명일 때 계속 실패하는 경우 재시도로 해결됨)
}

async function runMatching() {
  if (ROUND.status !== "closed") { alert("먼저 제출을 마감해주세요."); return; }
  if (WORRIES.length < 2) { alert("매칭하려면 최소 2명 이상 제출해야 합니다."); return; }

  const authorUids = WORRIES.map(w => w.authorUid);
  const receivers = makeDerangement(authorUids);
  if (!receivers) { alert("매칭 생성에 실패했습니다. 다시 시도해주세요."); return; }

  DRAFT_PAIRS = WORRIES.map((w, i) => ({
    worryId: w.id, authorUid: w.authorUid, receiverUid: receivers[i]
  }));
  await db.collection("draftMatches").doc(ROUND.id).set({ pairs: DRAFT_PAIRS });
  renderMatchTable();
}

function renderMatchTable() {
  const table = document.getElementById("match-table");
  if (!DRAFT_PAIRS.length) {
    table.innerHTML = "<tr><td class='muted'>아직 매칭을 실행하지 않았습니다.</td></tr>";
  } else {
    table.innerHTML = "<tr><th>고민 작성자</th><th>받는 사람</th></tr>" + DRAFT_PAIRS.map(p => `
      <tr><td>${escapeHtml(nameOf(p.authorUid))}</td><td>${escapeHtml(nameOf(p.receiverUid))}</td></tr>
    `).join("");
  }
  const optionsHtml = DRAFT_PAIRS.map(p =>
    `<option value="${p.authorUid}">${escapeHtml(nameOf(p.authorUid))}의 고민</option>`).join("");
  document.getElementById("swap-a").innerHTML = optionsHtml;
  document.getElementById("swap-b").innerHTML = optionsHtml;
}

async function swapMatch() {
  const a = document.getElementById("swap-a").value;
  const b = document.getElementById("swap-b").value;
  if (!a || !b || a === b) { alert("서로 다른 두 항목을 선택해주세요."); return; }

  const pairA = DRAFT_PAIRS.find(p => p.authorUid === a);
  const pairB = DRAFT_PAIRS.find(p => p.authorUid === b);
  const newReceiverA = pairB.receiverUid;
  const newReceiverB = pairA.receiverUid;

  // 자기 자신을 받게 되는 경우가 생기면 취소
  if (newReceiverA === pairA.authorUid || newReceiverB === pairB.authorUid) {
    alert("이렇게 바꾸면 자기 자신의 고민을 받게 되어 바꿀 수 없습니다.");
    return;
  }
  pairA.receiverUid = newReceiverA;
  pairB.receiverUid = newReceiverB;
  await db.collection("draftMatches").doc(ROUND.id).set({ pairs: DRAFT_PAIRS });
  renderMatchTable();
}

async function deployMatch() {
  if (!DRAFT_PAIRS.length) { alert("먼저 매칭을 실행해주세요."); return; }
  if (!confirm("배포하면 학생들의 우체통에 바로 도착합니다. 계속할까요?")) return;

  const settingsDoc = await db.collection("settings").doc(CLASS_ID).get();
  const replyMode = settingsDoc.exists ? settingsDoc.data().replyMode : "single";

  const batch = db.batch();
  DRAFT_PAIRS.forEach(p => {
    const ref = db.collection("assignments").doc();
    batch.set(ref, {
      roundId: ROUND.id, worryId: p.worryId, authorUid: p.authorUid, receiverUid: p.receiverUid,
      deployedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    // 받는 사람이 고민 원문을 열람할 수 있도록 worries 문서에 assignedToUid를 기록 (보안 규칙용)
    batch.update(db.collection("worries").doc(p.worryId), { assignedToUid: p.receiverUid });
  });
  batch.update(db.collection("rounds").doc(ROUND.id), { status: "deployed", replyMode });
  await batch.commit();
  await loadRound();
  alert("배포 완료!");
}

// ---------- 모니터링 ----------
async function renderMonitor() {
  const list = document.getElementById("monitor-list");
  list.innerHTML = "<p class='muted'>불러오는 중...</p>";
  if (ROUND.status !== "deployed") {
    list.innerHTML = "<p class='muted'>아직 배포되지 않았습니다.</p>";
    document.getElementById("heart-summary").innerHTML = "<p class='muted'>아직 배포되지 않았습니다.</p>";
    return;
  }
  const assignSnap = await db.collection("assignments").where("roundId", "==", ROUND.id).get();
  const assignments = assignSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  const heartCounts = {}; // { authorUid: count }
  list.innerHTML = "";
  for (const a of assignments) {
    const worryDoc = await db.collection("worries").doc(a.worryId).get();
    const repliesSnap = await db.collection("replies").where("assignmentId", "==", a.id).get();
    const replies = repliesSnap.docs.map(d => d.data())
      .sort((x, y) => (x.createdAt?.toMillis?.() || 0) - (y.createdAt?.toMillis?.() || 0));

    replies.forEach(r => {
      if (r.hearted) heartCounts[r.authorUid] = (heartCounts[r.authorUid] || 0) + 1;
    });

    const div = document.createElement("div");
    div.className = "card";
    div.innerHTML = `
      <div class="chip">${escapeHtml(nameOf(a.authorUid))} → ${escapeHtml(nameOf(a.receiverUid))}</div>
      <p style="white-space:pre-wrap;">${escapeHtml(worryDoc.data().text)}</p>
      ${replies.length ? replies.map(r => `
        <div class="muted">↳ ${escapeHtml(nameOf(r.authorUid))}: <span style="color:#2c2c34;">${escapeHtml(r.text)}</span>${r.hearted ? ' <span class="heart-tag">❤️</span>' : ''}</div>
      `).join("") : '<div class="muted">(답장 대기중)</div>'}
    `;
    list.appendChild(div);
  }

  const heartBox = document.getElementById("heart-summary");
  const ranked = Object.entries(heartCounts).sort((a, b) => b[1] - a[1]);
  heartBox.innerHTML = ranked.length
    ? ranked.map(([uid, count]) => `
        <div class="row" style="padding:6px 0;">
          <span>${escapeHtml(nameOf(uid))}</span>
          <span class="heart-tag">❤️ × ${count}</span>
        </div>
      `).join("")
    : '<p class="muted">아직 하트를 받은 학생이 없어요.</p>';
}

// ---------- 확인필요(플래그) ----------
async function renderFlagged() {
  const list = document.getElementById("flagged-list");
  list.innerHTML = "<p class='muted'>불러오는 중...</p>";

  const worriesFlagged = WORRIES.filter(w => w.flagged);
  const repliesSnap = ROUND.status === "deployed"
    ? await db.collection("replies").get() // 클래스 규모가 작으므로 전체 조회 후 필터
    : { docs: [] };
  const repliesFlagged = repliesSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(r => r.flagged);

  list.innerHTML = "";
  if (!worriesFlagged.length && !repliesFlagged.length) {
    list.innerHTML = "<p class='muted'>현재 확인이 필요한 내용이 없습니다.</p>";
    return;
  }
  worriesFlagged.forEach(w => {
    const div = document.createElement("div");
    div.className = "card";
    div.innerHTML = `
      <div class="chip">고민 · ${escapeHtml(nameOf(w.authorUid))}</div>
      ${w.flagKeyword ? `<span class="badge warn">키워드: ${escapeHtml(w.flagKeyword)}</span>` : ""}
      ${w.reportedBy ? `<span class="badge">신고됨: ${escapeHtml(w.reportReason || "")}</span>` : ""}
      <p style="white-space:pre-wrap;">${escapeHtml(w.text)}</p>
    `;
    list.appendChild(div);
  });
  repliesFlagged.forEach(r => {
    const div = document.createElement("div");
    div.className = "card";
    div.innerHTML = `
      <div class="chip">답장 · ${escapeHtml(nameOf(r.authorUid))}</div>
      ${r.flagKeyword ? `<span class="badge warn">키워드: ${escapeHtml(r.flagKeyword)}</span>` : ""}
      <p style="white-space:pre-wrap;">${escapeHtml(r.text)}</p>
    `;
    list.appendChild(div);
  });
}

// ---------- 설정 ----------
async function renderSettings() {
  const doc = await db.collection("settings").doc(CLASS_ID).get();
  SETTINGS = doc.data();
  document.querySelectorAll('input[name="replyMode"]').forEach(r => {
    r.checked = r.value === SETTINGS.replyMode;
    r.onclick = async () => {
      await db.collection("settings").doc(CLASS_ID).update({ replyMode: r.value });
    };
  });
  renderKeywordChips();
  await renderArchivedRoundsList();
}

async function renderArchivedRoundsList() {
  const box = document.getElementById("archived-rounds-list");
  const snap = await db.collection("rounds")
    .where("classId", "==", CLASS_ID).where("status", "==", "archived").get();
  const rounds = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => b.roundNumber - a.roundNumber);

  if (!rounds.length) {
    box.innerHTML = "<p class='muted'>아직 보관된 라운드가 없어요.</p>";
    return;
  }
  box.innerHTML = rounds.map(r => `
    <div class="card clickable" onclick="viewArchivedRound('${r.id}', ${r.roundNumber})">
      <div class="row"><strong>${r.roundNumber}라운드</strong><span>›</span></div>
    </div>
  `).join("");
}

async function viewArchivedRound(roundId, roundNumber) {
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.add("hidden"));
  document.getElementById("tab-archived-detail").classList.remove("hidden");
  document.getElementById("archived-detail-title").textContent = `📦 ${roundNumber}라운드 기록`;
  const list = document.getElementById("archived-detail-list");
  list.innerHTML = "<p class='muted'>불러오는 중...</p>";

  const assignSnap = await db.collection("assignments").where("roundId", "==", roundId).get();
  const assignments = assignSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  if (!assignments.length) {
    list.innerHTML = "<p class='muted'>이 라운드는 배포 전에 초기화되어 기록이 없어요.</p>";
    return;
  }
  list.innerHTML = "";
  for (const a of assignments) {
    const worryDoc = await db.collection("worries").doc(a.worryId).get();
    const repliesSnap = await db.collection("replies").where("assignmentId", "==", a.id).get();
    const replies = repliesSnap.docs.map(d => d.data())
      .sort((x, y) => (x.createdAt?.toMillis?.() || 0) - (y.createdAt?.toMillis?.() || 0));
    const div = document.createElement("div");
    div.className = "card";
    div.innerHTML = `
      <div class="chip">${escapeHtml(nameOf(a.authorUid))} → ${escapeHtml(nameOf(a.receiverUid))}</div>
      <p style="white-space:pre-wrap;">${escapeHtml(worryDoc.exists ? worryDoc.data().text : "(삭제된 고민)")}</p>
      ${replies.length ? replies.map(r => `
        <div class="muted">↳ ${escapeHtml(nameOf(r.authorUid))}: <span style="color:#333340;">${escapeHtml(r.text)}</span></div>
      `).join("") : '<div class="muted">(답장 없음)</div>'}
    `;
    list.appendChild(div);
  }
}

function closeArchivedDetail() {
  document.getElementById("tab-archived-detail").classList.add("hidden");
  document.getElementById("tab-settings").classList.remove("hidden");
}

function renderKeywordChips() {
  const box = document.getElementById("keyword-chips");
  box.innerHTML = (SETTINGS.keywords || []).map(k => `
    <span class="keyword-chip">${escapeHtml(k)} <a href="#" onclick="removeKeyword('${escapeHtml(k)}');return false;">✕</a></span>
  `).join(" ");
}

async function addKeyword() {
  const input = document.getElementById("new-keyword");
  const val = input.value.trim();
  if (!val) return;
  SETTINGS.keywords = [...(SETTINGS.keywords || []), val];
  await db.collection("settings").doc(CLASS_ID).update({ keywords: SETTINGS.keywords });
  input.value = "";
  renderKeywordChips();
}
async function removeKeyword(k) {
  SETTINGS.keywords = (SETTINGS.keywords || []).filter(x => x !== k);
  await db.collection("settings").doc(CLASS_ID).update({ keywords: SETTINGS.keywords });
  renderKeywordChips();
}

// ---------- 백업 / 초기화 ----------
async function downloadBackup() {
  const assignSnap = await db.collection("assignments").where("roundId", "==", ROUND.id).get();
  const assignments = assignSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const replies = [];
  for (const a of assignments) {
    const rSnap = await db.collection("replies").where("assignmentId", "==", a.id).get();
    rSnap.forEach(d => replies.push({ id: d.id, ...d.data() }));
  }
  const backup = {
    round: ROUND, students: STUDENTS, worries: WORRIES, assignments, replies,
    exportedAt: new Date().toISOString()
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `worry-backup-round${ROUND.roundNumber}-${Date.now()}.json`;
  a.click();
}

async function resetRound() {
  if (!confirm("먼저 백업을 받으셨나요? 초기화하면 새 라운드가 시작됩니다.")) return;
  if (!confirm("정말 초기화할까요? (이전 데이터는 삭제되지 않고 보관 처리됩니다)")) return;
  await db.collection("rounds").doc(ROUND.id).update({ status: "archived" });
  await createNewRound(ROUND.roundNumber + 1);
  location.reload();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : str;
  return div.innerHTML;
}
