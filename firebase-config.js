// ⚠️ Firebase 콘솔 > 프로젝트 설정 > "내 앱"에서 복사한 설정값을 여기에 붙여넣으세요.
// (README.md의 "1단계"를 참고하세요)
const firebaseConfig = {
  apiKey: "AIzaSyAjlbeNQpO1sORXRQSfs-V9anIlPDztr7g",
  authDomain: "worryapp-ffdaa.firebaseapp.com",
  projectId: "worryapp-ffdaa",
  storageBucket: "worryapp-ffdaa.firebasestorage.app",
  messagingSenderId: "35165545330",
  appId: "1:35165545330:web:00eb139f70756c4d08f3eb"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// 계정을 "만드는 동안" 선생님의 로그인 세션이 바뀌지 않도록,
// 완전히 별도의 보조 앱 인스턴스를 하나 더 띄워서 그쪽에서 계정 생성을 처리합니다.
const secondaryApp = firebase.initializeApp(firebaseConfig, "Secondary");
const secondaryAuth = secondaryApp.auth();

// 학급 아이디 (여러 학급을 쓸 계획이 없다면 그대로 두셔도 됩니다)
const CLASS_ID = "class-default";
