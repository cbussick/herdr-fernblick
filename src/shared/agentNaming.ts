// Herdr requires a valid name when launching an agent. Keep its generated name
// deterministic so the UI can recognize it without renaming running agents.
export function getDefaultPiAgentName(paneId: string) {
  return `pi-${paneId.replace(/[^a-z0-9_-]/gi, "-").toLowerCase()}`.slice(0, 32);
}
