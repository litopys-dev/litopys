import { expect, test } from "bun:test";
import { PACKAGE_NAME, VERSION } from "../src/index.ts";

test("package exports name and version", () => {
  expect(PACKAGE_NAME).toBe("@litopys/core");
  expect(VERSION).toBe("0.1.0");
});
