// Localization (Korean & English) + agent/reason-aware dynamic speech lines.
const { app } = require('electron');

const LANGS = [
  ['ko', '한국어'],
  ['en', 'English'],
];

function resolve(pref) {
  if (pref && pref !== 'auto' && T[pref]) return pref;
  try {
    const sys = (app ? app.getLocale() : Intl.DateTimeFormat().resolvedOptions().locale || 'ko').toLowerCase();
    if (sys.startsWith('ko')) return 'ko';
  } catch {}
  return 'en';
}

const PHRASES = {
  ko: {
    antigravity: {
      question: [
        '잠깐만요! Antigravity가 선택을 기다려요 🚀',
        '똑똑! 확인해 주실 질문이 도착했어요!',
        '무중력 교신 중! 답변 한 번만 부탁드려요 ✨',
        '결정이 필요해요! 확인해 주시면 바로 이어갈게요!',
        'Antigravity에서 의견 여쭤보고 있어요!',
      ],
      permission: [
        '잠깐! Antigravity가 실행 승인을 기다려요 🛡️',
        '권한 확인 요청! 괜찮은지 봐주실래요?',
        '승인 버튼 하나면 바로 출발합니다 🚀',
      ],
      complete: [
        'Antigravity 작업 완료! 결과를 확인해 주세요 ✨',
        '임무 완수! 다 끝났는데 한번 봐주실래요? 🚀',
        '딩동~ Antigravity가 일을 마쳤어요!',
        '기다리고 있었어요! 다음 지시를 내려주세요!',
        '휴~ 깔끔하게 끝냈어요! 확인 부탁드려요!',
      ],
      error: [
        '앗! Antigravity 작업 중 확인이 필요해요 ⚠️',
        '비상 교신! 멈춘 구간을 한번 살펴봐 주세요!',
        '오류가 발생했어요! 잠깐만 확인해 주세요!',
      ],
    },
    claude: {
      question: [
        '저기요! Claude가 답변을 기다리고 있어요!',
        '똑똑! Claude에게 선택을 알려주세요!',
        'Claude에서 확인 요청이 왔어요 ✨',
        '잠깐 Claude 창 한번만 봐주실래요?',
      ],
      permission: [
        'Claude가 권한 승인을 기다리고 있어요!',
        '똑똑! 이 명령 실행해도 될까요? (Claude)',
        '잠깐만요! Claude 승인 버튼을 눌러주세요!',
      ],
      complete: [
        'Claude가 작업을 마쳤어요! 확인해 보세요 ✨',
        '딩동~ Claude 응답이 완료되었어요!',
        'Claude가 다음 지시를 기다리고 있어요!',
      ],
      error: [
        '앗! Claude에서 확인이 필요한 상태예요!',
        'Claude 작업을 한번 점검해 주세요!',
      ],
    },
    grumpy: [
      '저기요오~? 아직 안 보셨나요…?',
      '우주 미아 되겠어요… 한 번만 봐주세요…',
      '제바알~ 확인 한 번이면 바로 끝나는데…',
      '흥… 저 무시하시는 거 아니죠? 😤',
      '기다리다 산소 탱크 다 쓰겠어요…',
      '중얼중얼… 딴짓 중이신 게 분명해…',
    ],
    angry: [
      '대답 좀 해주세요!!!',
      '딴짓 그만!! 프로젝트 멈춰 있단 말이에요!!',
      '진짜 화났어요!! 당장 확인해 주세요!!',
      '얼마나 더 기다려야 해요?!',
      '지금 화면 다 가려버릴 거예요?!',
      '작업표시줄 위에서 시위 중입니다!! 쾅쾅!!',
      '여기요!! 저 보라고요!! 그르르르!!',
    ],
  },
  en: {
    antigravity: {
      question: [
        'Psst! Antigravity is waiting for your choice 🚀',
        'Knock knock! A question needs your input!',
        'Zero-G signal incoming! Take a quick look ✨',
        'Antigravity needs your decision to continue!',
      ],
      permission: [
        'Hold up! Antigravity needs your permission 🛡️',
        'Quick approval needed in Antigravity!',
        'Give the green light so we can launch 🚀',
      ],
      complete: [
        'Antigravity finished the task! Come check it out ✨',
        'Mission accomplished! Ready for your review 🚀',
        'Ding-dong! Antigravity wrapped up its work!',
        'Standing by for your next command, Captain!',
      ],
      error: [
        'Heads up! Antigravity hit an issue and paused ⚠️',
        'Mayday! Please check on Antigravity!',
      ],
    },
    claude: {
      question: [
        'Hey! Claude is waiting for your answer!',
        'Knock knock! Claude has a question for you!',
        'Psst… take a quick look at Claude ✨',
      ],
      permission: [
        'Claude needs your permission to proceed!',
        'Quick approval needed over in Claude!',
        'Hey! Check Claude’s permission prompt!',
      ],
      complete: [
        'Claude finished replying! Take a look ✨',
        'Claude wrapped up its turn and awaits you!',
        'All done in Claude! Ready when you are!',
      ],
      error: [
        'Heads up! Claude paused and needs attention!',
      ],
    },
    grumpy: [
      'Hello-o-o? Are you still there…?',
      'Drifting in space here… please check in…',
      'Pretty ple-e-ease, just one quick look…',
      'Hmm… am I being ignored right now?',
      'Running low on oxygen waiting for you…',
      'Mumble mumble… distracted again, huh…',
    ],
    angry: [
      'ANSWER ALREADY!!!',
      'STOP MULTITASKING! YOUR AGENT IS WAITING!!',
      'I AM OFFICIALLY MAD NOW!!',
      'How much longer is this gonna take?!',
      'I will block the whole taskbar!! STOMP STOMP!!',
      'LOOK AT ME RIGHT NOW!! GRRRRR!!',
    ],
  },
};

const T = {
  ko: {
    name: 'Antigravity Mascot',
    tooltip: 'Antigravity & Claude 알림 마스코트',
    openDashboard: '설정 및 컨트롤 데크 열기…',
    testAgy: '테스트 알림: Antigravity',
    testClaude: '테스트 알림: Claude',
    dismissNow: '지금 마스코트 숨기기',
    size: '마스코트 크기',
    sizes: ['작게 (100%)', '보통 (140%)', '크게 (180%)'],
    language: '언어 (Language)',
    langAuto: '시스템 자동',
    sound: '효과음 및 목소리 켜기',
    autostart: 'Windows 시작 시 자동 실행',
    agySection: 'Antigravity 연동 (플러그인 훅)',
    agyStopHook: 'Antigravity 작업 완료 시 알림 (Stop)',
    claudeSection: 'Claude Code 연동 (훅)',
    claudeStopHook: 'Claude 응답 완료 시에도 알림 (Stop)',
    toasts: 'Windows 데스크탑 알림 감지 (보조)',
    quit: '종료',
    already: 'Antigravity Mascot이 이미 트레이에서 실행 중입니다.',
    started: 'Antigravity Mascot 실행됨',
    startedOk: '작업표시줄 우측 하단에서 Antigravity와 Claude의 완료·질문 알림을 지켜보고 있어요!',
    portBusy: port => `포트 ${port}번이 이미 사용 중입니다. 다른 마스코트 인스턴스가 실행 중인지 확인해 주세요.`,
    portErr: (port, msg) => `로컬 훅 서버(${port}) 시작 실패: ${msg}`,
    clickTipAgy: '클릭하면 Antigravity 창으로 바로 이동합니다',
    clickTipClaude: '클릭하면 Claude 창으로 바로 이동합니다',
  },
  en: {
    name: 'Antigravity Mascot',
    tooltip: 'Antigravity & Claude Taskbar Mascot',
    openDashboard: 'Open Settings & Control Deck…',
    testAgy: 'Test Alert: Antigravity',
    testClaude: 'Test Alert: Claude',
    dismissNow: 'Dismiss Mascot Now',
    size: 'Mascot Size',
    sizes: ['Small (100%)', 'Medium (140%)', 'Large (180%)'],
    language: 'Language',
    langAuto: 'System Default',
    sound: 'Sound & Voice Effects',
    autostart: 'Start with Windows',
    agySection: 'Antigravity Integration (Plugin Hook)',
    agyStopHook: 'Alert when Antigravity finishes (Stop)',
    claudeSection: 'Claude Code Integration (Hook)',
    claudeStopHook: 'Also alert after every Claude reply (Stop)',
    toasts: 'Watch Windows Desktop Notifications',
    quit: 'Quit',
    already: 'Antigravity Mascot is already running in the system tray.',
    started: 'Antigravity Mascot Active',
    startedOk: 'Watching Antigravity & Claude from your taskbar corner!',
    portBusy: port => `Port ${port} is already in use. Check if another instance is running.`,
    portErr: (port, msg) => `Failed to start local hook server on port ${port}: ${msg}`,
    clickTipAgy: 'Click to bring Antigravity to front',
    clickTipClaude: 'Click to bring Claude to front',
  },
};

module.exports = { LANGS, T, PHRASES, resolve };
