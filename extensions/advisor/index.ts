/**
 * pi-advisor — Pi extension
 *
 * Registers the `advisor` tool, `/advisor` command, and four lifecycle
 * hooks (session_start restore, before_agent_start strip, model_select
 * re-evaluation, thinking_level_select re-evaluation) that together
 * implement the advisor-strategy pattern.
 *
 * Config persists at ~/.config/pi-advisor/advisor.json. The tool name and
 * /advisor command are preserved verbatim from the upstream advisor package.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	registerAdvisorBeforeAgentStart,
	registerAdvisorCommand,
	registerAdvisorSessionStart,
	registerAdvisorTool,
	registerModelSelectHandler,
	registerThinkingLevelSelectHandler,
} from "./advisor/index.js";

export default function (pi: ExtensionAPI) {
	registerAdvisorTool(pi);
	registerAdvisorCommand(pi);
	registerAdvisorBeforeAgentStart(pi);
	registerModelSelectHandler(pi);
	registerThinkingLevelSelectHandler(pi);
	registerAdvisorSessionStart(pi);
}
