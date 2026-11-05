import assert from "node:assert/strict";
import { test } from "node:test";
import { dayKeyLocal, eachLocalDayKeys } from "../src/dates";

test("dayKeyLocal formats the local calendar day", () => {
  assert.equal(dayKeyLocal(new Date(2026, 0, 5, 23, 59).getTime()), "2026-01-05");
  assert.equal(dayKeyLocal(new Date(2026, 11, 31, 0, 1).getTime()), "2026-12-31");
});

test("eachLocalDayKeys is inclusive and crosses month ends", () => {
  const keys = eachLocalDayKeys(
    new Date(2026, 0, 30, 12).getTime(),
    new Date(2026, 1, 2, 12).getTime()
  );
  assert.deepEqual(keys, ["2026-01-30", "2026-01-31", "2026-02-01", "2026-02-02"]);
});

test("eachLocalDayKeys does not skip or duplicate around DST changes", () => {
  // 2026-03-29 is the European spring-forward; keys must stay consecutive
  // regardless of the host timezone.
  const keys = eachLocalDayKeys(
    new Date(2026, 2, 28, 12).getTime(),
    new Date(2026, 2, 30, 12).getTime()
  );
  assert.deepEqual(keys, ["2026-03-28", "2026-03-29", "2026-03-30"]);
});

test("eachLocalDayKeys with start after end yields nothing", () => {
  assert.deepEqual(
    eachLocalDayKeys(new Date(2026, 5, 2).getTime(), new Date(2026, 5, 1).getTime()),
    []
  );
});
