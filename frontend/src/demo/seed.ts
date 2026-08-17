/**
 * 首访播种:把真实运行时产出的会话存档写进 localStorage。
 * 种子由浏览器驱动真实应用回放六条 Recorded Session 后导出(#33),
 * 键与格式与 threadStore/assistant-ui 完全一致——不存在手工构造的消息。
 * 标记键保证只播种一次:访客删除会话后刷新不会复活。
 */
import seed from "./fixtures/demo-seed.json";

const SEED_MARKER_KEY = "coursehub.demo.seeded.v1";

export function seedDemoThreads(): void {
  if (localStorage.getItem(SEED_MARKER_KEY)) return;
  for (const [key, value] of Object.entries(seed.storage as Record<string, string>)) {
    localStorage.setItem(key, value);
  }
  localStorage.setItem(SEED_MARKER_KEY, "1");
}
