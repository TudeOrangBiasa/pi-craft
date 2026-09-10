export type CheckCommandInput = Readonly<{
    command: string;
    cwd: string;
}>;
export type CheckCommandResult = Readonly<{
    kind: 'allow';
}> | Readonly<{
    kind: 'deny';
    reason: string;
    ruleId?: string;
}>;
/**
 * Checks one shell command against the current CC Safety Net policy without
 * executing it, writing audit data, or touching the network. Reads local
 * policy and filesystem facts on every call. If this function throws, the
 * caller must not execute the command.
 */
export declare function checkCommand(input: CheckCommandInput): CheckCommandResult;
