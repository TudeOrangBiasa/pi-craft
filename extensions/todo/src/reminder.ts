// TodoReminder (playbook Director, poor version): event-based nudge, no timers.
// Tracks turn count + last todo-tool activity; injects one reminder message
// at turn start only when a full turn passed with zero todo touches.

export interface OpenTodo {
	id: number;
	subject: string;
}

/** True when a reminder is due: open todos exist and the previous full turn had no todo activity. */
export function shouldRemind(openCount: number, completedTurns: number, lastTodoTurn: number): boolean {
	if (openCount <= 0) return false;
	if (completedTurns <= 0) return false;
	return lastTodoTurn < completedTurns - 1;
}

export function reminderText(open: OpenTodo[]): string {
	const list = open
		.slice(0, 5)
		.map((t) => `#${t.id} ${t.subject}`)
		.join("; ");
	const more = open.length > 5 ? ` (+${open.length - 5} more)` : "";
	return `Reminder: ${open.length} open todo(s) (${list}${more}). No todo update happened last turn — update or close them via the todo tool before continuing.`;
}
