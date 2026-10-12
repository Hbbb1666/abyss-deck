/**
 * PWA 安装相关的小工具
 * - 安卓 / 桌面 Chrome：监听 beforeinstallprompt，可以主动弹安装框
 * - iOS Safari：没有这个事件，只能提示用户「分享 → 添加到主屏幕」
 * - 已经是独立窗口（装过了）：什么都不显示
 */

let deferredPrompt = null;
const listeners = new Set();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();          // 拦下浏览器自带的横幅，改由我们在菜单里给入口
    deferredPrompt = e;
    listeners.forEach(fn => fn());
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    listeners.forEach(fn => fn());
  });
}

export const isStandalone = () =>
  (typeof window !== 'undefined') &&
  (window.matchMedia?.('(display-mode: standalone)').matches ||
    window.matchMedia?.('(display-mode: fullscreen)').matches ||
    window.navigator.standalone === true);

export const isIOS = () =>
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

/** 打开了本地文件（单文件版）：浏览器不允许安装，只能当普通网页用 */
export const isFileProtocol = () => typeof location !== 'undefined' && location.protocol === 'file:';

/** 能弹原生安装框 */
export const canPrompt = () => !!deferredPrompt;

/**
 * 能不能"装到桌面"。
 * 只要不是已经装过、也不是 file:// 打开，就一律给入口 ——
 * 因为 beforeinstallprompt 往往要第二次访问才触发，
 * 光靠它会出现"第一次来根本看不到安装入口"的问题。
 * 有原生提示就弹框，没有就显示手动操作指引。
 */
export const installable = () => !isStandalone() && !isFileProtocol();

export function onInstallStateChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** 触发原生安装框；iOS 返回 false（得让用户手动操作） */
export async function promptInstall() {
  if (!deferredPrompt) return false;
  const e = deferredPrompt;
  deferredPrompt = null;
  try {
    e.prompt();
    const res = await e.userChoice;
    return res?.outcome === 'accepted';
  } catch { return false; }
}

export const iosHint = () => '点 Safari 底部的「分享」按钮，再选「添加到主屏幕」';
