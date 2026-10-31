import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Plus, Trash2, Upload, X } from "lucide-react";
import { ComponentContent, componentStyle, Icon, icons } from "./Components";
import { catalog, colors, validData, type ComponentData } from "./model";
import { flowIcons } from "../../../packages/pi-live-chat/flowProtocol";
import styles from "./Playground.module.css";

export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      data-ui="flow-component-editor"
      onKeyDown={(event) => {
        if (event.key === "Escape") event.stopPropagation();
      }}
      className={styles["dialog"]}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const rect = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            onClose();
        }
      }}
    >
      <header className={styles["dialog-heading"]}>
        <h2>{title}</h2>
        <button
          type="button"
          className={styles["icon-button"]}
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
function TextField({
  label,
  value,
  onChange,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
}) {
  return (
    <label className={styles["form-field"]}>
      <span>{label}</span>
      {multiline ? (
        <textarea
          value={value}
          maxLength={10000}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
        />
      ) : (
        <input value={value} maxLength={10000} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}
export function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <div className={styles["color-picker"]}>
      {colors.map((color) => (
        <button
          type="button"
          key={color}
          className={styles["swatch"]}
          style={{ background: color }}
          aria-label={`Use ${color}`}
          aria-pressed={value === color}
          onClick={() => onChange(color)}
        />
      ))}
      <label className={styles["custom-color"]}>
        Custom
        <input
          type="color"
          aria-label="Custom accent color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
    </div>
  );
}
export function ComponentEditor({
  initial,
  isNew,
  onSave,
  onClose,
}: {
  initial: ComponentData;
  isNew: boolean;
  onSave: (data: ComponentData) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => structuredClone(initial));
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const patch = (change: Partial<ComponentData>) => setDraft((d) => ({ ...d, ...change }));
  const kind = draft.kind;
  const subtitle = ["icon", "detail", "table", "comment"].includes(kind);
  const title = `${isNew ? "Add" : "Edit"} ${catalog[kind].name}`;
  async function upload(file?: File) {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type) || file.size > 2 * 1024 * 1024) {
      setError("Choose a PNG, JPEG, WebP, or GIF smaller than 2 MiB.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const url = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      await new Promise<void>((resolve, reject) => {
        const image = new window.Image();
        image.onload = () => resolve();
        image.onerror = reject;
        image.src = url;
      });
      if (alive.current) patch({ image: url });
    } catch {
      if (alive.current) setError("That image could not be loaded. Try another file.");
    } finally {
      if (alive.current) setLoading(false);
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!validData(draft)) {
      setError("Some component content is invalid or too large.");
      return;
    }
    onSave(draft);
  }
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit} className={styles["editor-form"]}>
        <div className={styles["editor-body"]}>
          <div className={styles["editor-fields"]}>
            <TextField
              label={kind === "boundary" ? "Label" : "Title"}
              value={draft.title}
              onChange={(title) => patch({ title })}
            />
            {subtitle && (
              <TextField
                label="Subtitle"
                value={draft.subtitle}
                onChange={(subtitle) => patch({ subtitle })}
              />
            )}
            {(kind === "card" || kind === "comment") && (
              <TextField
                label="Body"
                value={draft.body}
                onChange={(body) => patch({ body })}
                multiline
              />
            )}
            <fieldset className={styles["fieldset"]}>
              <legend>Accent color</legend>
              <ColorPicker value={draft.color} onChange={(color) => patch({ color })} />
            </fieldset>
            <fieldset className={styles["fieldset"]}>
              <legend>Icon or image</legend>
              <input
                aria-label="Search icons"
                placeholder="Search icons…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <div className={styles["icon-grid"]}>
                <button
                  type="button"
                  aria-pressed={!draft.icon && !draft.image}
                  onClick={() => patch({ icon: "", image: "" })}
                >
                  None
                </button>
                {flowIcons
                  .filter(
                    (key) =>
                      key !== "" && icons[key]!.label.toLowerCase().includes(query.toLowerCase()),
                  )
                  .map((key) => (
                    <button
                      key={key}
                      type="button"
                      title={icons[key]!.label}
                      aria-label={`Icon: ${icons[key]!.label}`}
                      aria-pressed={draft.icon === key && !draft.image}
                      onClick={() => patch({ icon: key, image: "" })}
                    >
                      <Icon name={key} size={22} />
                    </button>
                  ))}
              </div>
              <label className={styles["upload"]}>
                <Upload size={16} />
                {loading ? "Loading image…" : "Upload image"}
                <input
                  type="file"
                  aria-label="Upload image"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  disabled={loading}
                  onChange={(e) => {
                    void upload(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
              {draft.image && (
                <button
                  type="button"
                  className={styles["text-button"]}
                  onClick={() => patch({ image: "" })}
                >
                  Remove image
                </button>
              )}
              <small>Local images only, up to 2 MiB. No external requests.</small>
            </fieldset>
            {kind === "detail" && (
              <fieldset className={styles["fieldset"]}>
                <legend>Fields</legend>
                {draft.fields.map((field, index) => {
                  const update = (change: Partial<typeof field>) =>
                    patch({
                      fields: draft.fields.map((f, i) => (i === index ? { ...f, ...change } : f)),
                    });
                  return (
                    <div className={styles["field-editor"]} key={index}>
                      <div className={styles["field-toolbar"]}>
                        <strong>Field {index + 1}</strong>
                        <button
                          type="button"
                          aria-label={`Remove field ${index + 1}`}
                          className={styles["icon-button"]}
                          onClick={() =>
                            patch({ fields: draft.fields.filter((_, i) => i !== index) })
                          }
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                      <TextField
                        label={`Field ${index + 1} label`}
                        value={field.label}
                        onChange={(label) => update({ label })}
                      />
                      <label className={styles["form-field"]}>
                        <span>Type</span>
                        <select
                          value={field.type}
                          onChange={(e) => update({ type: e.target.value as "text" | "group" })}
                        >
                          <option value="text">Text</option>
                          <option value="group">Grouped text</option>
                        </select>
                      </label>
                      <TextField
                        label={`Field ${index + 1} value`}
                        value={field.value}
                        onChange={(value) => update({ value })}
                        multiline={field.type === "group"}
                      />
                      <label className={styles["highlight"]}>
                        <span>Row highlight</span>
                        <input
                          type="color"
                          aria-label={`Field ${index + 1} highlight`}
                          value={field.color || "#ffffff"}
                          onChange={(e) => update({ color: e.target.value })}
                        />
                        <button
                          type="button"
                          className={styles["text-button"]}
                          onClick={() => update({ color: "" })}
                        >
                          Clear
                        </button>
                      </label>
                    </div>
                  );
                })}
                <button
                  type="button"
                  className={styles["secondary"]}
                  disabled={draft.fields.length >= 100}
                  onClick={() =>
                    patch({
                      fields: [...draft.fields, { label: "", value: "", color: "", type: "text" }],
                    })
                  }
                >
                  <Plus size={16} /> Add field
                </button>
              </fieldset>
            )}
            {kind === "table" && (
              <fieldset className={styles["fieldset"]}>
                <legend>Columns and rows</legend>
                <div className={styles["table-editor"]}>
                  <table>
                    <thead>
                      <tr>
                        {draft.columns.map((column, j) => (
                          <th key={j}>
                            <input
                              aria-label={`Column ${j + 1} name`}
                              value={column}
                              maxLength={10000}
                              onChange={(e) =>
                                patch({
                                  columns: draft.columns.map((c, k) =>
                                    k === j ? e.target.value : c,
                                  ),
                                })
                              }
                            />
                            <button
                              type="button"
                              aria-label={`Remove column ${j + 1}`}
                              disabled={draft.columns.length <= 1}
                              onClick={() =>
                                patch({
                                  columns: draft.columns.filter((_, k) => k !== j),
                                  rows: draft.rows.map((row) => row.filter((_, k) => k !== j)),
                                })
                              }
                            >
                              <X size={13} />
                            </button>
                          </th>
                        ))}
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {draft.rows.map((row, i) => (
                        <tr key={i}>
                          {row.map((cell, j) => (
                            <td key={j}>
                              <input
                                aria-label={`Row ${i + 1} column ${j + 1}`}
                                value={cell}
                                maxLength={10000}
                                onChange={(e) =>
                                  patch({
                                    rows: draft.rows.map((r, k) =>
                                      k === i ? r.map((c, l) => (l === j ? e.target.value : c)) : r,
                                    ),
                                  })
                                }
                              />
                            </td>
                          ))}
                          <td>
                            <button
                              type="button"
                              aria-label={`Remove row ${i + 1}`}
                              onClick={() => patch({ rows: draft.rows.filter((_, k) => k !== i) })}
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className={styles["button-row"]}>
                  <button
                    type="button"
                    className={styles["secondary"]}
                    disabled={draft.columns.length >= 20}
                    onClick={() =>
                      patch({
                        columns: [...draft.columns, "New column"],
                        rows: draft.rows.map((row) => [...row, ""]),
                      })
                    }
                  >
                    <Plus size={15} /> Column
                  </button>
                  <button
                    type="button"
                    className={styles["secondary"]}
                    disabled={draft.rows.length >= 100}
                    onClick={() => patch({ rows: [...draft.rows, draft.columns.map(() => "")] })}
                  >
                    <Plus size={15} /> Row
                  </button>
                </div>
              </fieldset>
            )}
          </div>
          <aside className={styles["preview"]}>
            <span>Live preview</span>
            <div className={styles["preview-surface"]}>
              <div
                className={styles["component"]}
                data-kind={draft.kind}
                style={componentStyle(draft)}
              >
                <ComponentContent data={draft} />
              </div>
            </div>
            <p>These are React components, not flattened drawings.</p>
          </aside>
        </div>
        <footer className={styles["dialog-footer"]}>
          {error && (
            <p role="alert" className={styles["error"]}>
              {error}
            </p>
          )}
          <button type="button" className={styles["secondary"]} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={styles["primary"]} disabled={loading}>
            {isNew ? "Add component" : "Save changes"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
