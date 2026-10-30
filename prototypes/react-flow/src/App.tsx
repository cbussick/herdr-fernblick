import { useCallback, useEffect, useRef, useState } from "react";
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type Viewport,
} from "@xyflow/react";
import { Copy, Download, Maximize, Pencil, RotateCcw, Search, Trash2, X } from "lucide-react";
import { ComponentView, EditContext, Icon } from "./Components";
import { ColorPicker, ComponentEditor, Modal } from "./Editor";
import { DrawingTools, InkContext, InkSurface, InkView, useInkHistory, type Tool } from "./Drawing";
import { applyInkCommand, isInk, maxBoardPoints, type InkNode } from "./ink";
import {
  catalog,
  defaults,
  example,
  kinds,
  makeId,
  makeNode,
  restore,
  serialize,
  storageKey,
  type ComponentData,
  type ComponentNode,
  type CanvasNode,
  type Diagram,
  type Kind,
} from "./model";
import styles from "./Playground.module.css";

const nodeTypes = { component: ComponentView, ink: InkView };
const edgeOptions = {
  type: "smoothstep",
  markerEnd: { type: MarkerType.ArrowClosed },
  style: { stroke: "#8290a3", strokeWidth: 1.6 },
};
function load(): Diagram & { message?: string } {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? restore(raw) : example();
  } catch {
    return {
      ...example(),
      message:
        "The saved canvas could not be loaded. The example is shown; your previous save is unchanged until you make an edit.",
    };
  }
}
type Editing = {
  data: ComponentData;
  id?: string;
  position?: { x: number; y: number };
  parentId?: string;
};
function Playground() {
  const [initial] = useState(load);
  const [nodes, setNodes] = useState(initial.nodes);
  const [edges, setEdges] = useState(initial.edges);
  const [viewport, setViewport] = useState<Viewport | undefined>(initial.viewport);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [edgeEditing, setEdgeEditing] = useState<Edge | null>(null);
  const [resetting, setResetting] = useState(false);
  const [tool, setTool] = useState<Tool>("select");
  const [penColor, setPenColor] = useState("#243044");
  const [penSize, setPenSize] = useState(5);
  const [hiddenInk, setHiddenInk] = useState(new Set<string>());
  const transformInk = useRef<InkNode[]>([]);
  const [message, setMessage] = useState(initial.message || "Saved in this browser only");
  const flow = useReactFlow<CanvasNode>();
  const changed = useRef(false);
  const [revision, setRevision] = useState(0);
  const touch = useCallback(() => {
    changed.current = true;
    setRevision((v) => v + 1);
    setViewport(flow.getViewport());
  }, [flow]);
  const history = useInkHistory((command, undo) => {
    const next = applyInkCommand(flow.getNodes(), command, undo);
    if (
      next.length > 300 ||
      next.filter(isInk).reduce((sum, n) => sum + n.data.points.length, 0) > maxBoardPoints
    ) {
      setMessage("Cannot restore drawing: delete some items to make room first.");
      return false;
    }
    setNodes(next);
    touch();
    return true;
  });
  function chooseTool(next: Tool) {
    setTool(next);
    setNodes((current) => current.map((n) => ({ ...n, selected: false })));
    setEdges((current) => current.map((e) => ({ ...e, selected: false })));
  }
  function commitInk(before: InkNode[], after: InkNode[]) {
    if (!before.length && !after.length) return;
    history.record(before, after);
    setNodes((current) => applyInkCommand(current, { before, after }, false));
    touch();
  }
  function startInkTransform(id?: string) {
    transformInk.current = flow
      .getNodes()
      .filter(isInk)
      .filter((n) => n.id === id || (!id && n.selected));
  }
  function finishInkTransform() {
    const before = transformInk.current;
    transformInk.current = [];
    if (!before.length) return;
    requestAnimationFrame(() =>
      history.record(
        before,
        flow
          .getNodes()
          .filter(isInk)
          .filter((n) => before.some((old) => old.id === n.id)),
      ),
    );
  }
  const canvas = useRef<HTMLDivElement>(null);
  const selected = nodes.filter((node) => node.selected);
  const selectedEdges = edges.filter((edge) => edge.selected);
  const one = selected.length === 1 ? selected[0] : undefined;
  const boundaries = nodes.filter(
    (node): node is ComponentNode => node.type === "component" && node.data.kind === "boundary",
  );
  const modal = !!(editing || edgeEditing || resetting);
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (
        modal ||
        (event.target instanceof Element &&
          event.target.closest("input, textarea, select, [contenteditable=true]"))
      )
        return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) history.redo();
        else history.undo();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        history.redo();
      } else if (event.key === "Escape") chooseTool("select");
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  useEffect(() => {
    if (!changed.current) return;
    try {
      localStorage.setItem(storageKey, serialize({ nodes, edges, viewport }));
      setMessage("Saved in this browser only");
    } catch {
      setMessage(
        "Not saved: browser storage is full or unavailable. Download your canvas to keep it.",
      );
    }
  }, [nodes, edges, viewport, revision]);
  const edit = useCallback(
    (id: string) => {
      const node = flow.getNode(id);
      if (node?.type === "component") setEditing({ id, data: node.data });
    },
    [flow],
  );
  function add(kind: Kind) {
    if (nodes.length >= 300) {
      setMessage("This playground is limited to 300 components.");
      return;
    }
    const rect = canvas.current!.getBoundingClientRect();
    const center = flow.screenToFlowPosition({
      x: rect.left + rect.width / 2 - 140,
      y: rect.top + rect.height / 2 - 80,
    });
    const parent = kind !== "boundary" && one?.data.kind === "boundary" ? one : undefined;
    setTool("select");
    setEditing({
      data: defaults(kind),
      position: parent ? { x: 45, y: 80 } : center,
      parentId: parent?.id,
    });
  }
  function save(data: ComponentData) {
    if (!editing) return;
    if (editing.id)
      setNodes((current) =>
        current.map((node) =>
          node.id === editing.id && node.type === "component" ? { ...node, data } : node,
        ),
      );
    else {
      const node = makeNode(data.kind, editing.position!.x, editing.position!.y, data);
      node.selected = true;
      if (editing.parentId) node.parentId = editing.parentId;
      setNodes((current) =>
        [...current.map((n) => ({ ...n, selected: false })), node].toSorted(
          (a, b) => Number(b.data.kind === "boundary") - Number(a.data.kind === "boundary"),
        ),
      );
    }
    touch();
    setEditing(null);
  }
  function connect(connection: Connection) {
    if (edges.length >= 1000) {
      setMessage("This playground is limited to 1,000 connections.");
      return;
    }
    setEdges((current) => addEdge({ ...connection, ...edgeOptions }, current));
    touch();
  }
  function duplicate() {
    const originals = nodes.filter(
      (n) => n.selected || (n.parentId && selected.some((parent) => parent.id === n.parentId)),
    );
    if (nodes.length + originals.length > 300) {
      setMessage("Not duplicated: the canvas would exceed 300 components.");
      return;
    }
    const ids = new Map(originals.map((n) => [n.id, makeId()]));
    const copies: CanvasNode[] = originals.map((n) => ({
      ...structuredClone(n),
      id: ids.get(n.id)!,
      selected: true,
      position: {
        x: n.position.x + (n.parentId && ids.has(n.parentId) ? 0 : 35),
        y: n.position.y + (n.parentId && ids.has(n.parentId) ? 0 : 35),
      },
      parentId: n.parentId ? ids.get(n.parentId) || n.parentId : undefined,
    }));
    const copiedEdges = edges
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e) => ({
        ...e,
        id: makeId(),
        source: ids.get(e.source)!,
        target: ids.get(e.target)!,
        selected: false,
      }));
    if (edges.length + copiedEdges.length > 1000) {
      setMessage("Not duplicated: the canvas would exceed 1,000 connections.");
      return;
    }
    if (
      [...nodes, ...copies].filter(isInk).reduce((sum, n) => sum + n.data.points.length, 0) >
      maxBoardPoints
    ) {
      setMessage("Not duplicated: the canvas would exceed the drawing point limit.");
      return;
    }
    history.record([], copies.filter(isInk));
    setNodes((current) => [...current.map((n) => ({ ...n, selected: false })), ...copies]);
    setEdges((current) => [...current, ...copiedEdges]);
    touch();
  }
  function reparent(parentId: string) {
    if (!one || isInk(one) || one.data.kind === "boundary") return;
    const oldParent = nodes.find((n) => n.id === one.parentId);
    const parent = nodes.find((n) => n.id === parentId);
    setNodes((current) =>
      current.map((n) =>
        n.id !== one.id
          ? n
          : {
              ...n,
              parentId: parent?.id,
              position: {
                x: n.position.x + (oldParent?.position.x || 0) - (parent?.position.x || 0),
                y: n.position.y + (oldParent?.position.y || 0) - (parent?.position.y || 0),
              },
            },
      ),
    );
    touch();
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob([serialize({ nodes, edges, viewport })], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "component-canvas.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className={styles.app}>
      <header className={styles.appHeader}>
        <div className={styles.brand}>
          <span className={styles.brandMark}>
            <Icon name="layout" size={24} />
          </span>
          <div>
            <h1>Component canvas</h1>
            <p>React Flow playground · separate from Fernblick</p>
          </div>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.secondary} onClick={download}>
            <Download size={16} />
            <span>Download</span>
          </button>
          <button className={styles.secondary} onClick={() => setResetting(true)}>
            <RotateCcw size={16} />
            <span>Reset</span>
          </button>
        </div>
      </header>
      <div className={styles.workspace}>
        <aside className={styles.library} aria-label="Component library">
          <h2>Add a component</h2>
          <label className={styles.search}>
            <Search size={16} />
            <input
              aria-label="Find a component"
              placeholder="Find a component…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div className={styles.libraryItems}>
            {kinds
              .filter((kind) =>
                `${catalog[kind].name} ${catalog[kind].description}`
                  .toLowerCase()
                  .includes(query.toLowerCase()),
              )
              .map((kind) => (
                <button
                  key={kind}
                  className={styles.libraryItem}
                  onClick={() => add(kind)}
                  aria-label={`Add ${catalog[kind].name}`}
                >
                  <span className={styles.libraryIcon}>
                    <Icon name={catalog[kind].icon} size={21} />
                  </span>
                  <span>
                    <strong>{catalog[kind].name}</strong>
                    <small>{catalog[kind].description}</small>
                  </span>
                </button>
              ))}
          </div>
          <div className={styles.libraryHelp}>
            <strong>Make it yours</strong>
            <p>Select a component, then choose Edit. Or double-click it.</p>
            <p>
              Drag between dots to connect. Shift-click to select more. Delete removes the
              selection.
            </p>
            <p>Select a boundary before adding to place a component inside it.</p>
            <p>
              Choose Draw to sketch over the canvas. Eraser removes whole strokes. Use Pan or two
              fingers to navigate.
            </p>
            <small>Undo/redo applies to drawing only. Agent tools are not connected.</small>
          </div>
        </aside>
        <main
          ref={canvas}
          className={styles.canvas}
          aria-label="Diagram canvas"
          data-testid="canvas"
        >
          <EditContext.Provider value={edit}>
            <InkContext.Provider
              value={{ hidden: hiddenInk, start: startInkTransform, finish: finishInkTransform }}
            >
              <ReactFlow<CanvasNode>
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                onNodesChange={(changes) => {
                  const removed = nodes
                    .filter(isInk)
                    .filter((n) => changes.some((c) => c.type === "remove" && c.id === n.id));
                  if (removed.length) history.record(removed, []);
                  setNodes((current) => applyNodeChanges(changes, current));
                  if (
                    changes.some(
                      (c) =>
                        (c.type !== "select" && c.type !== "dimensions") ||
                        (c.type === "dimensions" && c.resizing !== undefined),
                    )
                  )
                    touch();
                }}
                onEdgesChange={(changes) => {
                  setEdges((current) => applyEdgeChanges(changes, current));
                  if (changes.some((c) => c.type !== "select")) touch();
                }}
                onConnect={connect}
                connectionMode={ConnectionMode.Loose}
                isValidConnection={(connection) =>
                  connection.source !== connection.target &&
                  flow.getNode(connection.source)?.type === "component" &&
                  flow.getNode(connection.target)?.type === "component"
                }
                onNodeDragStart={() => startInkTransform()}
                onNodeDragStop={finishInkTransform}
                onNodeDoubleClick={(_, node) => edit(node.id)}
                onEdgeDoubleClick={(_, edge) => setEdgeEditing({ ...edge })}
                defaultEdgeOptions={edgeOptions}
                defaultViewport={initial.viewport}
                fitView={!initial.viewport}
                fitViewOptions={{ padding: 0.18 }}
                onMoveEnd={(_, next) => {
                  if (changed.current) setViewport(next);
                }}
                minZoom={0.15}
                maxZoom={2}
                noDragClassName={styles.noDrag}
                noPanClassName={styles.noPan}
                noWheelClassName={styles.noWheel}
                deleteKeyCode={modal || tool !== "select" ? null : ["Backspace", "Delete"]}
                nodesDraggable={!modal && tool === "select"}
                nodesConnectable={!modal && tool === "select"}
                elementsSelectable={!modal && tool === "select"}
                panOnDrag={tool === "select" || tool === "pan"}
                zoomOnDoubleClick={tool === "select" || tool === "pan"}
                elevateNodesOnSelect={false}
                proOptions={{ hideAttribution: false }}
              >
                <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#ccd5df" />
                {!modal && (tool === "draw" || tool === "erase") && (
                  <InkSurface
                    tool={tool}
                    color={penColor}
                    size={penSize}
                    nodes={nodes}
                    onCommit={commitInk}
                    onHidden={setHiddenInk}
                    onViewport={setViewport}
                    onMessage={setMessage}
                  />
                )}
                <Controls showInteractive={false} />
                <MiniMap<CanvasNode>
                  className={styles.minimap}
                  nodeColor={(node) => node.data.color || "#cbd5e1"}
                  pannable
                  zoomable
                />
              </ReactFlow>
              <DrawingTools
                tool={tool}
                setTool={chooseTool}
                color={penColor}
                setColor={setPenColor}
                size={penSize}
                setSize={setPenSize}
                history={history}
                disabled={modal}
              />
              {tool === "select" && (selected.length > 0 || selectedEdges.length > 0) && (
                <div className={styles.selectionBar} aria-label="Selection actions">
                  <span>{selected.length + selectedEdges.length} selected</span>
                  {one && !isInk(one) && (
                    <button onClick={() => edit(one.id)} className={styles.secondary}>
                      <Pencil size={15} /> Edit
                    </button>
                  )}
                  {!selected.length && selectedEdges.length === 1 && (
                    <button
                      className={styles.secondary}
                      onClick={() => setEdgeEditing({ ...selectedEdges[0]! })}
                    >
                      <Pencil size={15} /> Edit connection
                    </button>
                  )}
                  {!!selected.length && (
                    <button
                      onClick={duplicate}
                      className={styles.iconButton}
                      aria-label="Duplicate selection"
                    >
                      <Copy size={17} />
                    </button>
                  )}
                  {one && !isInk(one) && one.data.kind !== "boundary" && (
                    <select
                      aria-label="Component boundary"
                      value={one.parentId || ""}
                      onChange={(e) => reparent(e.target.value)}
                    >
                      <option value="">Outside boundaries</option>
                      {boundaries.map((b) => (
                        <option key={b.id} value={b.id}>
                          Inside {b.data.title}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    onClick={() => {
                      void flow.deleteElements({ nodes: selected, edges: selectedEdges });
                    }}
                    className={styles.iconButton}
                    aria-label="Delete selection"
                  >
                    <Trash2 size={17} />
                  </button>
                  <button
                    onClick={() => {
                      setNodes((current) => current.map((n) => ({ ...n, selected: false })));
                      setEdges((current) => current.map((e) => ({ ...e, selected: false })));
                    }}
                    className={styles.iconButton}
                    aria-label="Clear selection"
                  >
                    <X size={16} />
                  </button>
                </div>
              )}
              {nodes.length === 0 && (
                <div className={styles.empty}>
                  <Icon name="layout" size={34} />
                  <h2>Your canvas is ready</h2>
                  <p>Add a component from the library to get started.</p>
                </div>
              )}
              <button
                className={`${styles.fitButton} ${styles.secondary}`}
                onClick={() => void flow.fitView({ padding: 0.18 })}
              >
                <Maximize size={15} /> Fit canvas
              </button>
              <div className={styles.status} role="status">
                {message}
              </div>
            </InkContext.Provider>
          </EditContext.Provider>
        </main>
      </div>
      {editing && (
        <ComponentEditor
          initial={editing.data}
          isNew={!editing.id}
          onSave={save}
          onClose={() => setEditing(null)}
        />
      )}
      {edgeEditing && (
        <Modal title="Edit connection" onClose={() => setEdgeEditing(null)}>
          <form
            className={styles.connectionForm}
            onSubmit={(event) => {
              event.preventDefault();
              setEdges((current) =>
                current.map((edge) => (edge.id === edgeEditing.id ? edgeEditing : edge)),
              );
              touch();
              setEdgeEditing(null);
            }}
          >
            <label className={styles.formField}>
              Label
              <input
                autoFocus
                maxLength={10000}
                value={typeof edgeEditing.label === "string" ? edgeEditing.label : ""}
                onChange={(e) => setEdgeEditing({ ...edgeEditing, label: e.target.value })}
              />
            </label>
            <fieldset className={styles.fieldset}>
              <legend>Color</legend>
              <ColorPicker
                value={String(edgeEditing.style?.stroke || "#596579")}
                onChange={(stroke) =>
                  setEdgeEditing({
                    ...edgeEditing,
                    style: { ...edgeEditing.style, stroke },
                    markerEnd: { type: MarkerType.ArrowClosed, color: stroke },
                  })
                }
              />
            </fieldset>
            <footer className={styles.dialogFooter}>
              <button
                type="button"
                className={styles.secondary}
                onClick={() => setEdgeEditing(null)}
              >
                Cancel
              </button>
              <button className={styles.primary}>Save connection</button>
            </footer>
          </form>
        </Modal>
      )}
      {resetting && (
        <Modal title="Reset the canvas?" onClose={() => setResetting(false)}>
          <div className={styles.resetBody}>
            <p>
              This replaces this browser’s canvas with the example. Download it first if you want to
              keep your changes.
            </p>
            <footer className={styles.dialogFooter}>
              <button className={styles.secondary} onClick={() => setResetting(false)}>
                Cancel
              </button>
              <button
                className={styles.primary}
                onClick={() => {
                  const next = example();
                  history.clear();
                  chooseTool("select");
                  setNodes(next.nodes);
                  setEdges(next.edges);
                  setViewport(undefined);
                  touch();
                  setResetting(false);
                  requestAnimationFrame(
                    () => void flow.fitView({ nodes: next.nodes, padding: 0.18 }),
                  );
                }}
              >
                Reset to example
              </button>
            </footer>
          </div>
        </Modal>
      )}
    </div>
  );
}
export default function App() {
  return (
    <ReactFlowProvider>
      <Playground />
    </ReactFlowProvider>
  );
}
