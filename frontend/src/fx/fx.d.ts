export {};

declare global {
  interface Window {
    FX?: {
      init(root?: ParentNode): void;
      replay(element: Element): void;
      trigger(element: Element, event?: Event): void;
    };
  }
}
