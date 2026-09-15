import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { ZodError } from "zod";
import {
  createAgentRequestSchema,
  optionalAgentNameSchema,
  type Agent,
  type Workspace,
} from "../../shared/api/contracts";
import { createAgent } from "../../shared/api/apiClient";

interface NewAgentDialogProps {
  onClose: () => void;
  onCreated: (agent: Agent) => void;
  onCreateWorkspace: () => void;
  open: boolean;
  workspaces: Workspace[];
}

export function NewAgentDialog({
  onClose,
  onCreated,
  onCreateWorkspace,
  open,
  workspaces,
}: NewAgentDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [tabLabel, setTabLabel] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const selectedWorkspaceId = workspaces.some((workspace) => workspace.workspace_id === workspaceId)
    ? workspaceId
    : (workspaces[0]?.workspace_id ?? "");

  const createMutation = useMutation({
    mutationFn: createAgent,
    onSuccess: (agent) => {
      setName("");
      setNameError(null);
      setTabLabel("");
      onCreated(agent);
      dialogRef.current?.close();
    },
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function validateName(value: string) {
    const result = optionalAgentNameSchema.safeParse(value);
    const message = result.success ? null : result.error.issues[0]?.message;
    setNameError(message ?? null);
    return result.success;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = createAgentRequestSchema.safeParse({
      name,
      tabLabel,
      workspaceId: selectedWorkspaceId,
    });

    if (!result.success) {
      const issue = result.error.issues.find((candidate) => candidate.path[0] === "name");
      setNameError(issue?.message ?? null);
      return;
    }

    setNameError(null);
    createMutation.mutate(result.data);
  }

  function handleClose() {
    createMutation.reset();
    setNameError(null);
    onClose();
  }

  return (
    <dialog ref={dialogRef} className="new-agent-dialog" onClose={handleClose}>
      <form className="new-agent-form" onSubmit={handleSubmit} noValidate>
        <div className="new-agent-form__header">
          <div>
            <h2>New Pi agent</h2>
            <p>Herdr will create a tab and start Pi inside it.</p>
          </div>
          <button
            type="button"
            className="new-agent-form__close"
            onClick={() => dialogRef.current?.close()}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <label htmlFor="new-agent-workspace">Workspace</label>
        <select
          id="new-agent-workspace"
          value={selectedWorkspaceId}
          onChange={(event) => setWorkspaceId(event.target.value)}
          required
          autoFocus
        >
          {workspaces.map((workspace) => (
            <option key={workspace.workspace_id} value={workspace.workspace_id}>
              {workspace.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="new-agent-form__inline-action"
          onClick={() => {
            dialogRef.current?.close();
            onCreateWorkspace();
          }}
        >
          + Create a new workspace
        </button>

        <label htmlFor="new-agent-name">Agent name (optional)</label>
        <input
          id="new-agent-name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            if (nameError) validateName(event.target.value);
          }}
          onBlur={(event) => validateName(event.currentTarget.value)}
          placeholder="pi"
          maxLength={32}
          aria-describedby="new-agent-name-help"
          aria-errormessage="new-agent-name-error"
          aria-invalid={nameError ? true : undefined}
        />
        <small id="new-agent-name-help">
          Defaults to the harness name. Custom names use lowercase letters, numbers, dashes, and
          underscores.
        </small>
        {nameError ? (
          <small id="new-agent-name-error" className="new-agent-form__field-error" role="alert">
            {nameError}
          </small>
        ) : null}

        <label htmlFor="new-agent-tab">Tab name (optional)</label>
        <input
          id="new-agent-tab"
          value={tabLabel}
          onChange={(event) => setTabLabel(event.target.value)}
          placeholder="Next tab number"
          maxLength={80}
        />

        {createMutation.isError ? (
          <p role="alert">
            {createMutation.error instanceof ZodError
              ? "Check the highlighted fields and try again."
              : createMutation.error.message}
          </p>
        ) : null}

        <div className="new-agent-form__actions">
          <button type="button" onClick={() => dialogRef.current?.close()}>
            Cancel
          </button>
          <button type="submit" disabled={!selectedWorkspaceId || createMutation.isPending}>
            {createMutation.isPending ? "Creating…" : "Create agent"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
