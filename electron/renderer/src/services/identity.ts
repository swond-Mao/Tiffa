/**
 * identity — AI 身份 / 用户称呼配置（等价 app.js initIdentity）
 *
 * Phase 1：仅加载身份（aiName/userName/gender/persona 写入 uiStore）。
 * Phase 3：needsSetup 首次启动弹设置框（SettingsPanel 接管）。
 */
import { useUiStore } from '../stores/useUiStore';

export async function initIdentity(): Promise<void> {
  try {
    const id = await window.tiffaDesktop.getIdentity();
    if (id && id.aiName) useUiStore.getState().setAiName(id.aiName);
    if (id && id.userName) useUiStore.getState().setUserName(id.userName);
    if (id && id.gender) useUiStore.getState().setGender(id.gender);
    if (id && id.persona) useUiStore.getState().setPersona(id.persona);
  } catch {
    /* ignore */
  }
}
