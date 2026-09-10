import { describe, expect, test } from "bun:test";
import { reminderText, shouldRemind } from "../reminder.js";

describe("todo reminder", () => {
	test("silent with no open todos", () => {
		expect(shouldRemind(0, 5, -1)).toBe(false);
	});

	test("silent on fresh start (no completed turns)", () => {
		expect(shouldRemind(2, 0, -1)).toBe(false);
	});

	test("silent when last turn touched todos", () => {
		// turn 3 starting, activity in turn 2 → only turn-2 idle is not a full gap... activity turn 2, completed 2
		expect(shouldRemind(2, 2, 2)).toBe(false);
		expect(shouldRemind(2, 3, 2)).toBe(false);
	});

	test("reminds after a full idle turn", () => {
		expect(shouldRemind(2, 4, 2)).toBe(true);
		expect(shouldRemind(1, 3, -1)).toBe(true);
	});

	test("text lists subjects and caps at five", () => {
		const open = Array.from({ length: 7 }, (_, i) => ({ id: i + 1, subject: `t${i + 1}` }));
		const text = reminderText(open);
		expect(text).toContain("#1 t1");
		expect(text).toContain("(+2 more)");
		expect(text).toContain("todo tool");
	});
});
