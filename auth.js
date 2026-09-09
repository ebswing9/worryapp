// 아이디(username)를 내부적으로 이메일 형식(username@ourclass.local)으로 변환해서
// Firebase Authentication의 이메일/비밀번호 로그인 기능을 그대로 활용합니다.
// (학생들은 이메일이라는 걸 몰라도 되고, 그냥 "아이디"로만 보면 됩니다)

function usernameToEmail(username) {
  return username.trim().toLowerCase() + "@ourclass.local";
}

const loginBtn = document.getElementById("login-btn");
const errorMsg = document.getElementById("error-msg");

if (loginBtn) {
  loginBtn.addEventListener("click", login);
  document.getElementById("password").addEventListener("keydown", e => {
    if (e.key === "Enter") login();
  });
}

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.style.display = "block";
}

async function login() {
  const username = document.getElementById("username").value;
  const password = document.getElementById("password").value;
  if (!username || !password) { showError("아이디와 비밀번호를 입력하세요."); return; }

  loginBtn.disabled = true;
  try {
    const email = usernameToEmail(username);
    const cred = await auth.signInWithEmailAndPassword(email, password);
    const userDoc = await db.collection("users").doc(cred.user.uid).get();

    if (!userDoc.exists) {
      showError("계정 정보를 찾을 수 없습니다. 선생님께 문의하세요.");
      await auth.signOut();
      loginBtn.disabled = false;
      return;
    }
    const data = userDoc.data();
    if (data.role === "teacher") {
      location.href = "admin.html";
    } else {
      location.href = "student.html";
    }
  } catch (e) {
    showError("아이디 또는 비밀번호가 올바르지 않습니다.");
    loginBtn.disabled = false;
  }
}

// 로그인된 사용자 정보를 가져오는 공통 함수 (student.js, admin.js에서 재사용)
function requireLogin(expectedRole, onReady) {
  auth.onAuthStateChanged(async (user) => {
    if (!user) { location.href = "index.html"; return; }
    const userDoc = await db.collection("users").doc(user.uid).get();
    if (!userDoc.exists) { location.href = "index.html"; return; }
    const profile = { uid: user.uid, ...userDoc.data() };
    if (profile.role !== expectedRole) {
      location.href = profile.role === "teacher" ? "admin.html" : "student.html";
      return;
    }
    onReady(profile);
  });
}

function logout() {
  auth.signOut().then(() => location.href = "index.html");
}
