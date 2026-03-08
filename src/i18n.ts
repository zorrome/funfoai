export type AppLang = 'ja' | 'zh' | 'en';

const STORAGE_KEY = 'funfo_lang';

const dict: Record<AppLang, Record<string, string>> = {
  ja: {
    createApp: 'App作成',
    appStore: 'Appストア',
    workspace: 'ワークスペース',
    myApps: 'マイアプリ',
    docs: 'ドキュメント',
    myPage: 'マイページ',
    logout: 'ログアウト',
    loginRegister: 'ログイン / 登録',
    backendOk: 'Backend OK',
    backendNg: 'Backend NG',
    restartBackend: '重启后端',
    editProps: '属性編集',
    submitReview: '提审',
    published: '公開中',
    private: 'プライベート',
    draft: '下書き',
    msgInput: 'メッセージを入力...',
    sendHint: '⌘↩ 送信 · デザイン図をアップロードして参考にできます',
    designPattern: 'デザイン范式',
  },
  zh: {
    createApp: '创建App',
    appStore: 'App商店',
    workspace: '工作区',
    myApps: '我的App',
    docs: '文档',
    myPage: '个人中心',
    logout: '退出登录',
    loginRegister: '登录 / 注册',
    backendOk: '后端正常',
    backendNg: '后端异常',
    restartBackend: '重启后端',
    editProps: '编辑属性',
    submitReview: '提审',
    published: '已公开',
    private: '私有',
    draft: '草稿',
    msgInput: '请输入消息...',
    sendHint: '⌘↩ 发送 · 可上传设计图作为参考',
    designPattern: '设计范式',
  },
  en: {
    createApp: 'Create App',
    appStore: 'App Store',
    workspace: 'Workspace',
    myApps: 'My Apps',
    docs: 'Docs',
    myPage: 'My Page',
    logout: 'Log out',
    loginRegister: 'Log in / Sign up',
    backendOk: 'Backend OK',
    backendNg: 'Backend DOWN',
    restartBackend: 'Restart Backend',
    editProps: 'Edit Properties',
    submitReview: 'Submit Review',
    published: 'Published',
    private: 'Private',
    draft: 'Draft',
    msgInput: 'Type a message...',
    sendHint: '⌘↩ Send · You can upload design references',
    designPattern: 'Design Pattern',
  },
};

export function getLang(): AppLang {
  const v = (typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null) as AppLang | null;
  return v === 'zh' || v === 'en' || v === 'ja' ? v : 'ja';
}

export function setLang(lang: AppLang) {
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, lang);
}

export function tr(lang: AppLang, key: string) {
  return dict[lang]?.[key] || dict.ja[key] || key;
}
