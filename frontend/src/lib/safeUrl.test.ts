import { expect, it } from "vitest";
import { isSafeUrl } from "./safeUrl";

it("accepte le https", () => {
  expect(isSafeUrl("https://github.com/a/b/pull/1")).toBe(true);
});

it.each(["javascript:alert(1)", "data:text/html,x", "http://exemple.com", "", null, undefined])(
  "refuse %s",
  (url) => {
    expect(isSafeUrl(url)).toBe(false);
  },
);
