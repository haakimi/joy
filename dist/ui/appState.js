export function completeSlashInput(_input, command) {
    return `/${command.name} `;
}
export function getTabAction(args) {
    if (args.slashMode && args.matches.length > 0) {
        const selected = args.matches[args.pickerIdx] ?? args.matches[0];
        return { handled: true, input: completeSlashInput(args.input, selected) };
    }
    if (args.hasExpandableTool) {
        return { handled: true, toggleLatestTool: true };
    }
    return { handled: false };
}
export function finishPendingTool(pendingToolIds, toolUseId) {
    const itemId = pendingToolIds.get(toolUseId);
    if (itemId)
        pendingToolIds.delete(toolUseId);
    return itemId;
}
export function nextCwdAfterCommand(_previousCwd, currentCwd) {
    return currentCwd;
}
