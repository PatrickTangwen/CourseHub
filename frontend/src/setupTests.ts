import "@testing-library/jest-dom/vitest";

/* jsdom lacks a few browser APIs the chat UI touches. */
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (!("ResizeObserver" in globalThis)) {
  (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
}

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

if (!HTMLElement.prototype.scrollTo) {
  HTMLElement.prototype.scrollTo = () => {};
}

/* jsdom 不实现窗口滚动:保持同样的空操作语义,只去掉 "Not implemented" 噪音。 */
window.scrollTo = () => {};

/*
 * jsdom 没有 canvas 实现:getContext 本就返回 null(thinking-orbs 见 null 即
 * 早退,不画帧),但每次调用都会打印 "Not implemented" 噪音。这里保持同样的
 * 语义、只去掉噪音——不伪造 2D context,以免把画不出来的问题掩盖成画得出来。
 */
HTMLCanvasElement.prototype.getContext = () => null;

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}
