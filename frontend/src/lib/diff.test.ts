import { expect, it } from "vitest";
import { parseDiff } from "./diff";

const DIFF = `diff --git a/a.py b/a.py
index 1..2 100644
--- a/a.py
+++ b/a.py
@@ -1,2 +1,2 @@
 garde
-ancien
+nouveau
diff --git a/b c.py b/b c.py
--- a/b c.py
+++ b/b c.py
@@ -1 +1,2 @@
 x
+y`;

it("découpe le diff par fichier", () => {
  const files = parseDiff(DIFF);
  expect(files.map((file) => file.path)).toEqual(["a.py", "b c.py"]);
});

it("ignore les en-têtes dans les compteurs", () => {
  const [first] = parseDiff(DIFF);
  expect(first).toMatchObject({ added: 1, removed: 1 });
});

it("classe chaque ligne", () => {
  const [first] = parseDiff(DIFF);
  expect(first?.lines.map((line) => line.kind)).toEqual(["hunk", "context", "del", "add"]);
});

it("renvoie une liste vide sans diff", () => {
  expect(parseDiff("")).toEqual([]);
});
