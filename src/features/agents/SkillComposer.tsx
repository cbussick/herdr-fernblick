import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAgentSkills } from "../../shared/api/apiClient";
import type { AgentSkill, Target } from "../../../packages/pi-live-chat/protocol";
import { BranchIcon, CloseIcon, ImageIcon, SendIcon } from "../../shared/ui/Icons";
import a11y from "../../styles/accessibility.module.css";
import styles from "./SkillComposer.module.css";
import { useSkillPickerOverlay } from "./useSkillPickerOverlay";

function insertSkill(text: string, name: string) {
  // Replace a leading skill, preserving instructions and other slash-prefixed text.
  const rest = text.replace(/^\/skill:[^\s]*(?:\s+|$)/, "");
  return `/skill:${name} ${rest}`;
}

interface Props {
  pane: string;
  target?: Target;
  available: boolean;
  connected: boolean;
  prompt: string;
  onChange: (text: string) => void;
  label: string;
  sending: boolean;
  canSend: boolean;
  canAttach: boolean;
  canOpenTree: boolean;
  onAttach: () => void;
  onOpenTree: () => void;
}

export function SkillComposer(props: Props) {
  const { prompt, target, sending, connected, available, onChange } = props;
  const [browsing, setBrowsing] = useState(false);
  const [search, setSearch] = useState("");
  const [active, setActive] = useState(0);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const selected = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const hintId = useId();
  const identity = target ? `${target.runtime}:${target.sessionId}:${target.epoch}` : "";
  const [previousIdentity, setPreviousIdentity] = useState(identity);
  if (previousIdentity !== identity) {
    setPreviousIdentity(identity);
    setBrowsing(false);
    setActive(0);
  }
  // Invalidate the picker, not the editor DOM: reconnect must not steal focus,
  // interrupt composition, or lose keystrokes arriving with the first snapshot.
  const open = !sending && browsing;
  const { mobile, dialogRef } = useSkillPickerOverlay(open);
  const catalog = useQuery({
    queryKey: ["agent-skills", props.pane, target?.runtime, target?.sessionId, target?.epoch],
    queryFn: ({ signal }) => getAgentSkills(props.pane, target!, signal),
    enabled: open && connected && available && Boolean(target),
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const skills = (catalog.data?.skills ?? []).filter((skill) =>
    `${skill.name} ${skill.description}`.toLowerCase().includes(search.toLowerCase()),
  );
  const index = Math.min(active, Math.max(0, skills.length - 1));
  const ready = connected && available && !catalog.isFetching && !catalog.isError;
  const activeId = open && ready && skills[index] ? `${listId}-${index}` : undefined;

  useEffect(() => {
    if (browsing) searchInput.current?.focus({ preventScroll: true });
  }, [browsing, mobile]);
  useEffect(() => {
    if (open) selected.current?.scrollIntoView({ block: "nearest" });
  }, [index, open, search]);

  function close(focus = true) {
    dialogRef.current?.close();
    setBrowsing(false);
    if (focus) textarea.current?.focus();
  }
  function choose(skill: AgentSkill) {
    if (!ready || sending) return;
    const next = insertSkill(prompt, skill.name);
    if (next.length > 32000) return;
    dialogRef.current?.close();
    onChange(next);
    setBrowsing(false);
    textarea.current?.focus();
  }
  function keys(event: KeyboardEvent) {
    if (!open || event.nativeEvent.isComposing) return;
    // Search is inside the send form. Enter must never implicitly send a draft,
    // including while loading, after an error, or with no matching skills.
    if (event.key === "Enter") event.preventDefault();
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (
      ready &&
      skills.length &&
      ["ArrowDown", "ArrowUp", "Enter", "Tab"].includes(event.key)
    ) {
      if (event.key === "Tab" && event.shiftKey) return;
      event.preventDefault();
      if (event.key === "Enter" || event.key === "Tab") choose(skills[index]);
      else
        setActive((index + (event.key === "ArrowDown" ? 1 : -1) + skills.length) % skills.length);
    }
  }

  const pickerContents = open ? (
    <>
      <header className={styles.header}>
        <strong>Skills</strong>
        <span>From this Pi session</span>
        <button
          type="button"
          className={styles.close}
          aria-label="Close skills"
          onClick={() => close()}
        >
          <CloseIcon />
        </button>
      </header>
      <input
        ref={searchInput}
        className={styles.search}
        aria-label="Search skills"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={activeId}
        aria-describedby={hintId}
        placeholder="Find a skill…"
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          setActive(0);
        }}
        onKeyDown={keys}
      />
      {!connected ? (
        <p className={styles.notice} role="status">
          Connect to Pi live chat to browse this agent’s skills.
        </p>
      ) : !available ? (
        <p className={styles.notice} role="status">
          Run /reload in Pi to enable skills in Fernblick.
        </p>
      ) : catalog.isFetching ? (
        <p className={styles.notice} role="status">
          Loading this agent’s skills…
        </p>
      ) : catalog.isError ? (
        <div className={styles.notice} role="alert">
          <p>{catalog.error.message}</p>
          <button type="button" className={styles.retry} onClick={() => void catalog.refetch()}>
            Try again
          </button>
        </div>
      ) : null}
      <div id={listId} role="listbox" aria-label="Available skills" className={styles.list}>
        {ready
          ? skills.map((skill, i) => (
              <button
                key={skill.name}
                ref={i === index ? selected : undefined}
                id={`${listId}-${i}`}
                type="button"
                role="option"
                aria-selected={i === index}
                tabIndex={-1}
                className={styles.option}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(skill)}
                disabled={insertSkill(prompt, skill.name).length > 32000}
                title={skill.path}
              >
                <span className={styles.name}>{skill.name}</span>
                <span className={styles.scope}>
                  {skill.scope === "user"
                    ? "Personal"
                    : skill.scope === "project"
                      ? "Project"
                      : "Session"}
                </span>
                <span className={styles.description}>{skill.description}</span>
                <span className={styles.path}>{skill.path}</span>
              </button>
            ))
          : null}
      </div>
      {ready && !skills.length ? (
        <p className={styles.notice} role="status">
          {catalog.data?.skills.length
            ? "No matching skills. Try a name or description."
            : "No skills loaded. Add a skill to Pi, then run /reload."}
        </p>
      ) : null}
      {ready && catalog.data?.truncated ? (
        <p className={styles.notice}>
          Showing the first {catalog.data.skills.length} skills; catalogue limit reached.
        </p>
      ) : null}
      {prompt.length > 31736 ? (
        <p className={styles.notice}>Shorten the draft if a skill won’t fit the message limit.</p>
      ) : null}
      <footer className={styles.hint} id={hintId}>
        Choose a skill, add instructions, then send.
      </footer>
    </>
  ) : null;
  return (
    <div
      className={styles.composer}
      onBlur={(event) => {
        if (!mobile && !event.currentTarget.contains(event.relatedTarget)) close(false);
      }}
    >
      {open ? (
        mobile ? (
          <dialog
            ref={dialogRef}
            className={`${styles.picker} ${styles.modal}`}
            aria-label="Skills"
            aria-modal="true"
            data-testid="skill-picker"
            onCancel={(event) => {
              event.preventDefault();
              close();
            }}
            onClose={() => close(false)}
          >
            {pickerContents}
          </dialog>
        ) : (
          <section className={styles.picker} aria-label="Skills" data-testid="skill-picker">
            {pickerContents}
          </section>
        )
      ) : null}
      <label htmlFor="agent-prompt" className={a11y["sr-only"]}>
        Message {props.label}
      </label>
      <textarea
        ref={textarea}
        id="agent-prompt"
        value={prompt}
        disabled={sending}
        onChange={(event) => onChange(event.target.value)}
        placeholder={`Message ${props.label}…`}
        rows={1}
        maxLength={32000}
      />
      <div className={styles.toolbar}>
        <button
          type="button"
          className={styles.action}
          disabled={sending || !props.canAttach}
          title="Attach images"
          aria-label="Attach images"
          onClick={props.onAttach}
        >
          <ImageIcon />
        </button>
        <button
          type="button"
          className={styles.action}
          disabled={sending || !props.canOpenTree}
          title="Conversation paths"
          aria-label="Open conversation paths"
          onClick={props.onOpenTree}
        >
          <BranchIcon />
        </button>
        <button
          type="button"
          className={styles.skills}
          disabled={sending}
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          onClick={() => {
            if (open) close();
            else {
              setBrowsing(true);
              setSearch("");
              setActive(0);
            }
          }}
        >
          <span aria-hidden="true">/</span> Skills
        </button>
        <button
          type="submit"
          className={styles.send}
          aria-label="Send message"
          aria-busy={sending}
          disabled={!props.canSend}
        >
          {sending ? (
            <span className={styles.spinner} data-testid="send-spinner" aria-hidden="true" />
          ) : (
            <SendIcon />
          )}
        </button>
      </div>
    </div>
  );
}
