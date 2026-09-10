let ME = null;          // 내 프로필 {uid, name, role, classId}
let ROUND = null;       // 현재 라운드 {id, ...}
let MY_WORRY = null;    // 내가 제출한 고민 문서
let RECEIVED_ASSIGN = null; // 내가 받은 편지의 assignment
let SENT_ASSIGN = null;     // 내 고민이 배정된 assignment (내가 보낸 것에 대한 답장 확인용)
let CURRENT_THREAD = null;  // 지금 열어본 대화 정보 {assignmentId, originalText, originalLabel, isReceiver}

requireLogin("student", async (profile) => {
  ME = profile;
  document.getElementById("welcome").textContent = `${ME.name}님`;
  await loadRound();
  document.getElementById("worry-card").addEventListener("click", openWorryView);
  document.getElementById("mailbox-card").addEventListener("click", openMailboxView);
});

async function loadRound() {
  const snap = await db.collection("rounds")
    .where("classId", "==", CLASS_ID)
    .where("status", "in", ["open", "closed", "deployed"])
    .get();
  if (snap.empty) {
    document.getElementById("worry-status").textContent = "아직 시작된 라운드가 없습니다.";
    return;
  }
  // 여러 개면 가장 최근(roundNumber 큰) 것 사용
  let latest = null;
  snap.forEach(d => {
    const data = d.data();
    if (!latest || data.roundNumber > latest.data.roundNumber) latest = { id: d.id, data };
  });
  ROUND = { id: latest.id, ...latest.data };

  await refreshWorryStatus();
  await refreshMailboxBadge();
}

async function refreshWorryStatus() {
  const q = await db.collection("worries")
    .where("roundId", "==", ROUND.id)
    .where("authorUid", "==", ME.uid)
    .get();
  MY_WORRY = q.empty ? null : { id: q.docs[0].id, ...q.docs[0].data() };

  const statusEl = document.getElementById("worry-status");
  if (ROUND.status === "open") {
    statusEl.innerHTML = MY_WORRY
      ? '<span class="status-ok">제출완료 (수정 가능)</span>'
      : '<span class="status-no">미제출</span>';
  } else {
    statusEl.innerHTML = MY_WORRY
      ? '<span class="status-ok">제출완료</span>'
      : '<span class="status-no">미제출 (마감됨)</span>';
  }
}

async function refreshMailboxBadge() {
  let hasNews = false;
  if (ROUND.status === "deployed") {
    const recvSnap = await db.collection("assignments")
      .where("roundId", "==", ROUND.id).where("receiverUid", "==", ME.uid).get();
    RECEIVED_ASSIGN = recvSnap.empty ? null : { id: recvSnap.docs[0].id, ...recvSnap.docs[0].data() };

    if (MY_WORRY) {
      const sentSnap = await db.collection("assignments")
        .where("roundId", "==", ROUND.id).where("authorUid", "==", ME.uid).get();
      SENT_ASSIGN = sentSnap.empty ? null : { id: sentSnap.docs[0].id, ...sentSnap.docs[0].data() };
    }
    if (RECEIVED_ASSIGN) {
      hasNews = true;
      const rr = await db.collection("replies").where("assignmentId", "==", RECEIVED_ASSIGN.id).get();
      if (rr.docs.some(d => d.data().authorUid === ME.uid && d.data().hearted)) hasNews = true;
    }
    if (SENT_ASSIGN) {
      const r = await db.collection("replies").where("assignmentId", "==", SENT_ASSIGN.id).get();
      if (!r.empty) hasNews = true;
      if (r.docs.some(d => d.data().authorUid === ME.uid && d.data().hearted)) hasNews = true;
    }
  }
  document.getElementById("mailbox-badge").classList.toggle("hidden", !hasNews);
}

// ---------- 화면 전환 ----------
function showMain() {
  document.getElementById("view-main").classList.remove("hidden");
  document.getElementById("view-worry").classList.add("hidden");
  document.getElementById("view-mailbox").classList.add("hidden");
  document.getElementById("view-thread").classList.add("hidden");
  refreshWorryStatus();
  refreshMailboxBadge();
}
function openWorryView() {
  document.getElementById("view-main").classList.add("hidden");
  document.getElementById("view-worry").classList.remove("hidden");
  document.getElementById("worry-text").value = MY_WORRY ? MY_WORRY.text : "";
  const locked = ROUND.status !== "open";
  document.getElementById("worry-text").disabled = locked;
  document.getElementById("worry-submit-btn").classList.toggle("hidden", locked);
  document.getElementById("worry-locked-msg").classList.toggle("hidden", !locked);
}
function showMailbox() {
  document.getElementById("view-thread").classList.add("hidden");
  openMailboxView();
}
async function openMailboxView() {
  document.getElementById("view-main").classList.add("hidden");
  document.getElementById("view-mailbox").classList.remove("hidden");
  const list = document.getElementById("mailbox-list");
  list.innerHTML = "";

  if (ROUND.status !== "deployed") {
    list.innerHTML = '<p class="muted">아직 배포되지 않았어요. 선생님이 배포하면 알림이 표시됩니다.</p>';
    return;
  }

  const grid = document.createElement("div");
  grid.className = "mailbox-grid";

  // ---- 왼쪽 타일: 내가 받은 편지 ----
  const receivedTile = document.createElement("div");
  if (RECEIVED_ASSIGN) {
    const worryDoc = await db.collection("worries").doc(RECEIVED_ASSIGN.worryId).get();
    const rr = await db.collection("replies").where("assignmentId", "==", RECEIVED_ASSIGN.id).get();
    const gotHeart = rr.docs.some(d => d.data().authorUid === ME.uid && d.data().hearted);
    receivedTile.className = "mail-tile";
    receivedTile.innerHTML = `
      <div class="mail-tile-icon">📩</div>
      <div class="mail-tile-title">받은 편지</div>
      <div class="mail-tile-sub">익명의 친구가 보낸 고민</div>
      ${gotHeart ? '<div class="heart-tag" style="margin-top:8px;">❤️ 하트를 받았어요</div>' : ''}
    `;
    receivedTile.onclick = () => openThread({
      assignmentId: RECEIVED_ASSIGN.id,
      originalLabel: "익명의 친구가 보낸 고민",
      originalText: worryDoc.data().text,
      worryId: RECEIVED_ASSIGN.worryId,
      isReceiver: true
    });
  } else {
    receivedTile.className = "mail-tile disabled";
    receivedTile.innerHTML = `
      <div class="mail-tile-icon">📭</div>
      <div class="mail-tile-title">받은 편지</div>
      <div class="mail-tile-sub">아직 없어요</div>
    `;
  }
  grid.appendChild(receivedTile);

  // ---- 오른쪽 타일: 내가 보낸 고민에 온 답장 ----
  const sentTile = document.createElement("div");
  let sentHasReply = false, sentGotHeart = false;
  if (SENT_ASSIGN) {
    const repliesSnap = await db.collection("replies").where("assignmentId", "==", SENT_ASSIGN.id).get();
    sentHasReply = !repliesSnap.empty;
    sentGotHeart = repliesSnap.docs.some(d => d.data().authorUid === ME.uid && d.data().hearted);
  }
  if (sentHasReply) {
    sentTile.className = "mail-tile";
    sentTile.innerHTML = `
      <div class="mail-tile-icon">💌</div>
      <div class="mail-tile-title">답장 도착</div>
      <div class="mail-tile-sub">내가 보낸 고민에 답장이 왔어요</div>
      ${sentGotHeart ? '<div class="heart-tag" style="margin-top:8px;">❤️ 하트를 받았어요</div>' : ''}
    `;
    sentTile.onclick = () => openThread({
      assignmentId: SENT_ASSIGN.id,
      originalLabel: "내가 보낸 고민",
      originalText: MY_WORRY.text,
      worryId: MY_WORRY.id,
      isReceiver: false
    });
  } else {
    sentTile.className = "mail-tile disabled";
    sentTile.innerHTML = `
      <div class="mail-tile-icon">📪</div>
      <div class="mail-tile-title">답장 도착</div>
      <div class="mail-tile-sub">아직 답장이 없어요</div>
    `;
  }
  grid.appendChild(sentTile);

  list.appendChild(grid);
}

async function openThread(info) {
  CURRENT_THREAD = info;
  document.getElementById("view-mailbox").classList.add("hidden");
  document.getElementById("view-thread").classList.remove("hidden");
  document.getElementById("thread-title").textContent = info.isReceiver ? "받은 고민" : "내가 보낸 고민";
  document.getElementById("thread-original-label").textContent = info.originalLabel;
  document.getElementById("thread-original-text").textContent = info.originalText;
  await renderThreadMessages();
}

async function renderThreadMessages() {
  const msgBox = document.getElementById("thread-messages");
  msgBox.innerHTML = "";
  const snap = await db.collection("replies")
    .where("assignmentId", "==", CURRENT_THREAD.assignmentId).get();
  const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0));

  msgs.forEach(m => {
    const mine = m.authorUid === ME.uid;
    const div = document.createElement("div");
    div.className = "card";
    div.style.background = mine ? "#f3f0ff" : "#fff";
    let heartHtml = "";
    if (!mine) {
      heartHtml = m.hearted
        ? `<span class="heart-tag">❤️ 하트를 보냈어요</span>`
        : `<button class="btn-xs heart-btn" onclick="sendHeart('${m.id}')">🤍 하트 보내기</button>`;
    }
    div.innerHTML = `
      <div class="row">
        <div class="muted">${mine ? "나" : "상대방"}</div>
        ${heartHtml}
      </div>
      <p style="white-space:pre-wrap;margin:4px 0;">${escapeHtml(m.text)}</p>
    `;
    msgBox.appendChild(div);
  });

  // 답장 가능 여부 판단
  const replyBox = document.getElementById("thread-reply-box");
  const lockedMsg = document.getElementById("thread-locked-msg");
  const settingsDoc = await db.collection("settings").doc(CLASS_ID).get();
  const replyMode = ROUND.replyMode || (settingsDoc.exists ? settingsDoc.data().replyMode : "single");

  let canReply = true;
  if (replyMode === "single" && msgs.length >= 1) canReply = false;

  replyBox.classList.toggle("hidden", !canReply);
  lockedMsg.classList.toggle("hidden", canReply);
}

async function sendHeart(replyId) {
  await db.collection("replies").doc(replyId).update({
    hearted: true,
    heartedAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  await renderThreadMessages();
}

async function sendReply() {
  const text = document.getElementById("reply-text").value.trim();
  if (!text) return;
  const flag = checkKeywordFlag(text, await getKeywords());
  await db.collection("replies").add({
    assignmentId: CURRENT_THREAD.assignmentId,
    authorUid: ME.uid,
    text,
    flagged: flag.flagged,
    flagKeyword: flag.keyword || null,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  document.getElementById("reply-text").value = "";
  await renderThreadMessages();
}

async function reportContent() {
  const reason = prompt("신고 사유를 간단히 적어주세요 (예: 욕설, 불쾌한 내용 등)");
  if (reason === null) return;
  await db.collection("worries").doc(CURRENT_THREAD.worryId).update({
    flagged: true,
    reportedBy: ME.uid,
    reportReason: reason || "사유 미입력"
  });
  alert("신고가 접수되었습니다. 선생님께 전달됩니다.");
}

// ---------- 고민 제출 ----------
async function getKeywords() {
  const doc = await db.collection("settings").doc(CLASS_ID).get();
  return doc.exists && doc.data().keywords ? doc.data().keywords : ["죽고싶", "자살", "자해"];
}

function checkKeywordFlag(text, keywords) {
  for (const kw of keywords) {
    if (kw && text.includes(kw)) return { flagged: true, keyword: kw };
  }
  return { flagged: false };
}

async function submitWorry() {
  if (ROUND.status !== "open") return;
  const text = document.getElementById("worry-text").value.trim();
  if (!text) { alert("내용을 입력해주세요."); return; }

  const keywords = await getKeywords();
  const flag = checkKeywordFlag(text, keywords);

  if (MY_WORRY) {
    await db.collection("worries").doc(MY_WORRY.id).update({
      text, flagged: flag.flagged, flagKeyword: flag.keyword || null,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  } else {
    await db.collection("worries").add({
      roundId: ROUND.id, authorUid: ME.uid, text,
      flagged: flag.flagged, flagKeyword: flag.keyword || null,
      submittedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }
  alert("제출되었습니다.");
  await refreshWorryStatus();
  showMain();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
