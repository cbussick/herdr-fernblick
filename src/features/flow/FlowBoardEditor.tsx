import type { BoardEditorProps } from "../whiteboard/BoardEditor";
import type { BoardScene } from "../../../packages/pi-live-chat/boardProtocol";
import {
  toDiagram,
  fromDiagram,
  exportFlowScene,
  importFlowScene,
  verifySceneImages,
  MAX_FLOW_BACKUP_BYTES,
  replacementScene,
} from "./scene";
import "@xyflow/react/dist/style.css";
import "@fontsource/nunito/400.css";
import "@fontsource/nunito/600.css";
import "@fontsource/nunito/700.css";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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
import { Copy, Download, Pencil, RotateCcw, Search, Trash2, X } from "lucide-react";
import { ComponentView, EditContext, Icon } from "./Components";
import { PrimitiveView } from "./Primitives";
import { ColorPicker, ComponentEditor, Modal } from "./Editor";
import { DrawingTools, InkContext, InkSurface, InkView, type Tool } from "./Drawing";
import { applyInkCommand, isInk, maxBoardPoints, type InkNode } from "./ink";
import { useBoardHistory } from "./history";
import {
  catalog,
  defaults,
  edgeOptions,
  kinds,
  makeId,
  makeNode,
  type ComponentData,
  type ComponentNode,
  type CanvasNode,
  type Kind,
} from "./model";
import styles from "./Playground.module.css";

const nodeTypes = { component: ComponentView, ink: InkView, primitive: PrimitiveView };
type Editing = {
  data: ComponentData;
  id?: string;
  position?: { x: number; y: number };
  parentId?: string;
};
function Playground(props: BoardEditorProps) {
  const { scene, generation, locked, onError } = props;
  const [initial] = useState(() => toDiagram(scene));
  const base = useRef(scene);
  const callbacks = useRef(props);
  callbacks.current = props;
  const appliedGeneration = useRef(generation);
  const pointerIds = useRef(new Set<number>());
  const idleFrame = useRef<number | null>(null);
  const [pendingImport, setPendingImport] = useState<BoardScene | null>(null);
  const replacementInFlight = useRef(false);
  const [replacementBusy, setReplacementBusy] = useState(false);
  const [nodes, setNodes] = useState(initial.nodes);
  const [edges, setEdges] = useState(initial.edges);
  const [, setViewport] = useState<Viewport | undefined>(undefined);
  const [query, setQuery] = useState("");
  const [picking, setPicking] = useState(false);
  const pickerTrigger = useRef<HTMLElement | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [edgeEditing, setEdgeEditing] = useState<Edge | null>(null);
  const [resetting, setResetting] = useState(false);
  const [tool, setTool] = useState<Tool>("select");
  const [penColor, setPenColor] = useState("#243044");
  const [penSize, setPenSize] = useState(5);
  const [hiddenInk, setHiddenInk] = useState(new Set<string>());
  const [message, setMessage] = useState("");
  const flow = useReactFlow<CanvasNode>();
  const changed = useRef(false);
  const historyGroup = useRef<symbol | undefined>(undefined);
  const historyFrame = useRef<number | null>(null);
  const [revision, setRevision] = useState(0);
  const touch = useCallback(() => {
    historyGroup.current ??= Symbol("local board edit");
    if (historyFrame.current !== null) cancelAnimationFrame(historyFrame.current);
    historyFrame.current = requestAnimationFrame(() => {
      historyFrame.current = null;
      if (!pointerIds.current.size) historyGroup.current = undefined;
    });
    changed.current = true;
    setRevision((v) => v + 1);
    setViewport(flow.getViewport());
  }, [flow]);
  const history = useBoardHistory(
    () => base.current,
    (next) => {
      if (callbacks.current.locked || pointerIds.current.size) return false;
      const diagram = toDiagram(next);
      base.current = next;
      changed.current = false;
      setNodes(diagram.nodes);
      setEdges(diagram.edges);
      callbacks.current.onChange(next);
      callbacks.current.onError("");
      canvas.current
        ?.closest<HTMLElement>('[data-testid="flow-board-editor"]')
        ?.focus({ preventScroll: true });
      setMessage("");
      return true;
    },
    setMessage,
  );
  function chooseTool(next: Tool) {
    setTool(next);
    setNodes((current) => current.map((n) => ({ ...n, selected: false })));
    setEdges((current) => current.map((e) => ({ ...e, selected: false })));
  }
  function commitInk(before: InkNode[], after: InkNode[]) {
    if (!before.length && !after.length) return;
    setNodes((current) => applyInkCommand(current, { before, after }, false));
    touch();
  }
  const canvas = useRef<HTMLDivElement>(null);
  const selected = nodes.filter((node) => node.selected);
  const selectedEdges = edges.filter((edge) => edge.selected);
  const one = selected.length === 1 ? selected[0] : undefined;
  const boundaries = nodes.filter(
    (node): node is ComponentNode => node.type === "component" && node.data.kind === "boundary",
  );
  const modal = !!(picking || editing || edgeEditing || resetting || pendingImport);
  const modalRef = useRef(modal);
  useEffect(() => {
    if (!modal && pickerTrigger.current) {
      if (!locked) pickerTrigger.current.focus({ preventScroll: true });
      pickerTrigger.current = null;
    }
  }, [modal, locked]);
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (
        locked ||
        !(
          document.activeElement instanceof Element &&
          document.activeElement.closest('[data-testid="flow-board-editor"]')
        ) ||
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
      } else if (event.key === "Escape" && tool !== "select") {
        event.stopPropagation();
        chooseTool("select");
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  // Effects are ordered: publish final edits before announcing gesture/modal idle.
  useLayoutEffect(() => {
    if (!changed.current || appliedGeneration.current !== generation) return;
    changed.current = false;
    try {
      const next = fromDiagram({ nodes, edges }, base.current);
      if (JSON.stringify(next) !== JSON.stringify(base.current)) {
        history.record(base.current, next, historyGroup.current);
        base.current = next;
        callbacks.current.onChange(next);
      }
      callbacks.current.onError("");
    } catch (error) {
      callbacks.current.onError(error instanceof Error ? error.message : "Invalid board");
    }
  }, [nodes, edges, revision, generation, history]);
  useLayoutEffect(() => {
    if (appliedGeneration.current === generation) return;
    try {
      const next = toDiagram(scene);
      history.reconcile(base.current, scene);
      base.current = scene;
      changed.current = false;
      setNodes(next.nodes);
      setEdges(next.edges);
      historyGroup.current = undefined;
      setHiddenInk(new Set());
      setPicking(false);
      setEditing(null);
      setEdgeEditing(null);
      setPendingImport(null);
      appliedGeneration.current = generation;
    } catch (error) {
      onError(String(error));
    }
  }, [generation, scene, history, onError]);
  useEffect(() => {
    callbacks.current.onReady({
      fit: () => {
        void flow.fitView({ padding: 0.18 });
      },
    });
    return () => {
      callbacks.current.onReady(null);
      if (idleFrame.current !== null) cancelAnimationFrame(idleFrame.current);
      if (historyFrame.current !== null) cancelAnimationFrame(historyFrame.current);
      callbacks.current.onInteraction?.(false);
    };
  }, [flow]);
  useLayoutEffect(() => {
    modalRef.current = modal;
    callbacks.current.onInteraction?.(modalRef.current || pointerIds.current.size > 0);
  }, [modal, revision]);
  useEffect(() => {
    const clearPointers = () => {
      pointerIds.current.clear();
      historyGroup.current = undefined;
      if (idleFrame.current !== null) cancelAnimationFrame(idleFrame.current);
      idleFrame.current = requestAnimationFrame(() =>
        callbacks.current.onInteraction?.(modalRef.current),
      );
    };
    const visibility = () => {
      if (document.hidden) clearPointers();
    };
    window.addEventListener("blur", clearPointers);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("blur", clearPointers);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [modal]);
  useEffect(() => {
    if (locked) {
      setPicking(false);
      chooseTool("select");
      setEditing(null);
      setEdgeEditing(null);
      setPendingImport(null);
    }
  }, [locked]);
  const edit = useCallback(
    (id: string) => {
      const node = flow.getNode(id);
      if (!locked && node?.type === "component") setEditing({ id, data: node.data });
    },
    [flow, locked],
  );
  function add(kind: Kind) {
    if (locked) return;
    setPicking(false);
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
    if (locked || !editing) return;
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
    if (locked) return;
    if (edges.length >= 1000) {
      setMessage("This playground is limited to 1,000 connections.");
      return;
    }
    setEdges((current) => addEdge({ ...connection, ...edgeOptions, id: makeId() }, current));
    touch();
  }
  function duplicate() {
    if (locked) return;
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
    setNodes((current) => [...current.map((n) => ({ ...n, selected: false })), ...copies]);
    setEdges((current) => [...current, ...copiedEdges]);
    touch();
  }
  function reparent(parentId: string) {
    if (locked || one?.type !== "component" || one.data.kind === "boundary") return;
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
  async function replaceDrawing(source: BoardScene) {
    if (locked || replacementInFlight.current) return;
    const before = base.current;
    replacementInFlight.current = true;
    setReplacementBusy(true);
    try {
      await callbacks.current.onBeforeReplace?.();
      if (callbacks.current.locked || base.current !== before)
        throw new Error("Drawing changed while preserving recovery. Try again.");
      const next = replacementScene(source, before);
      const diagram = toDiagram(next);
      base.current = next;
      changed.current = false;
      history.clear();
      chooseTool("select");
      setNodes(diagram.nodes);
      setEdges(diagram.edges);
      callbacks.current.onChange(next);
      callbacks.current.onError("");
      setPendingImport(null);
      setResetting(false);
      requestAnimationFrame(() => void flow.fitView({ padding: 0.18 }));
    } catch (error) {
      callbacks.current.onError(
        error instanceof Error ? error.message : "Could not preserve recovery",
      );
    } finally {
      replacementInFlight.current = false;
      setReplacementBusy(false);
    }
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob([exportFlowScene(base.current)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "whiteboard.flow.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const libraryContent = (
    <>
      <label className={styles["search"]}>
        <Search size={16} />
        <input
          aria-label="Find a component"
          placeholder="Find a component…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className={styles["library-items"]}>
        {kinds
          .filter((kind) =>
            `${catalog[kind].name} ${catalog[kind].description}`
              .toLowerCase()
              .includes(query.toLowerCase()),
          )
          .map((kind) => (
            <button
              key={kind}
              className={styles["library-item"]}
              disabled={locked}
              onClick={() => add(kind)}
              aria-label={`Add ${catalog[kind].name}`}
            >
              <span className={styles["library-icon"]}>
                <Icon name={catalog[kind].icon} size={21} />
              </span>
              <span>
                <strong>{catalog[kind].name}</strong>
                <small>{catalog[kind].description}</small>
              </span>
            </button>
          ))}
      </div>
    </>
  );
  return (
    <div
      className={styles["app"]}
      data-testid="flow-board-editor"
      tabIndex={-1}
      onPointerDownCapture={(e) => {
        if (!(e.target instanceof Element && e.target.closest("input,textarea,select,button")))
          e.currentTarget.focus({ preventScroll: true });
        if (locked) return;
        if (!pointerIds.current.size) historyGroup.current = Symbol("pointer edit");
        pointerIds.current.add(e.pointerId);
        callbacks.current.onInteraction?.(true);
      }}
      onPointerUpCapture={(e) => {
        pointerIds.current.delete(e.pointerId);
        if (idleFrame.current !== null) cancelAnimationFrame(idleFrame.current);
        idleFrame.current = requestAnimationFrame(() => {
          if (!pointerIds.current.size) historyGroup.current = undefined;
          callbacks.current.onInteraction?.(modalRef.current || pointerIds.current.size > 0);
        });
      }}
      onPointerCancelCapture={(e) => {
        pointerIds.current.delete(e.pointerId);
        if (idleFrame.current !== null) cancelAnimationFrame(idleFrame.current);
        idleFrame.current = requestAnimationFrame(() => {
          if (!pointerIds.current.size) historyGroup.current = undefined;
          callbacks.current.onInteraction?.(modalRef.current || pointerIds.current.size > 0);
        });
      }}
      onLostPointerCaptureCapture={(e) => {
        if (!pointerIds.current.delete(e.pointerId)) return;
        if (idleFrame.current !== null) cancelAnimationFrame(idleFrame.current);
        idleFrame.current = requestAnimationFrame(() => {
          if (!pointerIds.current.size) historyGroup.current = undefined;
          callbacks.current.onInteraction?.(modalRef.current || pointerIds.current.size > 0);
        });
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && (modal || tool !== "select")) {
          e.stopPropagation();
          if (!modal) {
            e.preventDefault();
            chooseTool("select");
          }
        }
      }}
    >
      <header className={styles["app-header"]}>
        <div className={styles["brand"]}>
          <span className={styles["brand-mark"]}>
            <Icon name="layout" size={24} />
          </span>
          <div>
            <h1>Component canvas</h1>
            <p>Conversation whiteboard</p>
          </div>
        </div>
        <div className={styles["header-actions"]}>
          <label className={styles["upload"]}>
            Import
            <input
              disabled={locked}
              type="file"
              aria-label="Import flow JSON"
              accept=".json,application/json"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                try {
                  if (file.size > MAX_FLOW_BACKUP_BYTES) throw new Error("Import exceeds 12 MiB");
                  const next = importFlowScene(await file.text());
                  await verifySceneImages(next);
                  if (!callbacks.current.locked) setPendingImport(next);
                } catch (error) {
                  onError(String(error));
                }
              }}
            />
          </label>
          <button
            className={styles["secondary"]}
            aria-label="Download"
            title="Download"
            aria-haspopup={props.onDownload ? "menu" : undefined}
            aria-expanded={props.onDownload ? !!props.downloadMenuOpen : undefined}
            aria-controls={props.downloadMenuOpen ? "board-download-menu" : undefined}
            onClick={(event) =>
              props.onDownload ? props.onDownload(event.currentTarget) : download()
            }
          >
            <Download size={16} />
            <span>Download</span>
          </button>
          <button
            disabled={locked}
            className={styles["secondary"]}
            onClick={() => setResetting(true)}
          >
            <RotateCcw size={16} />
            <span>Clear</span>
          </button>
        </div>
      </header>
      <div className={styles["workspace"]}>
        <aside className={styles["library"]} aria-label="Component library">
          <h2>Add a component</h2>
          {libraryContent}
          <div className={styles["library-help"]}>
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
            <small>Undo/redo your edits with Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z.</small>
          </div>
        </aside>
        <main
          ref={canvas}
          className={styles["canvas"]}
          aria-label="Diagram canvas"
          data-testid="canvas"
        >
          <EditContext.Provider value={edit}>
            <InkContext.Provider value={{ hidden: hiddenInk, start: () => {}, finish: () => {} }}>
              <ReactFlow<CanvasNode>
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                onNodesChange={(changes) => {
                  if (locked && changes.some((c) => c.type !== "dimensions" || c.resizing)) return;
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
                  if (locked) return;
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
                onNodeDoubleClick={(_, node) => edit(node.id)}
                onEdgeDoubleClick={(_, edge) => {
                  if (!locked) setEdgeEditing({ ...edge });
                }}
                defaultEdgeOptions={edgeOptions}
                fitView
                fitViewOptions={{ padding: 0.18 }}
                onMoveEnd={(_, next) => {
                  if (changed.current) setViewport(next);
                }}
                minZoom={0.15}
                maxZoom={2}
                noDragClassName={styles["no-drag"]}
                noPanClassName={styles["no-pan"]}
                noWheelClassName={styles["no-wheel"]}
                deleteKeyCode={
                  locked || modal || tool !== "select" ? null : ["Backspace", "Delete"]
                }
                nodesDraggable={!locked && !modal && tool === "select"}
                nodesConnectable={!locked && !modal && tool === "select"}
                elementsSelectable={!locked && !modal && tool === "select"}
                panOnDrag={tool === "select" || tool === "pan"}
                zoomOnDoubleClick={tool === "select" || tool === "pan"}
                elevateNodesOnSelect={false}
                proOptions={{ hideAttribution: false }}
              >
                <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#ccd5df" />
                {!locked && !modal && (tool === "draw" || tool === "erase") && (
                  <InkSurface
                    key={generation}
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
                  className={styles["minimap"]}
                  nodeColor={(node) =>
                    node.type === "primitive"
                      ? node.data.drawing.stroke
                      : node.data.color || "#cbd5e1"
                  }
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
                disabled={locked || modal}
                onAddComponent={() => {
                  pickerTrigger.current =
                    document.activeElement instanceof HTMLElement ? document.activeElement : null;
                  setQuery("");
                  setPicking(true);
                }}
              />
              {!locked &&
                tool === "select" &&
                (selected.length > 0 || selectedEdges.length > 0) && (
                  <div className={styles["selection-bar"]} aria-label="Selection actions">
                    <span>{selected.length + selectedEdges.length} selected</span>
                    {one?.type === "component" && (
                      <button onClick={() => edit(one.id)} className={styles["secondary"]}>
                        <Pencil size={15} /> Edit
                      </button>
                    )}
                    {!selected.length && selectedEdges.length === 1 && (
                      <button
                        className={styles["secondary"]}
                        onClick={() => setEdgeEditing({ ...selectedEdges[0]! })}
                      >
                        <Pencil size={15} /> Edit connection
                      </button>
                    )}
                    {!!selected.length && (
                      <button
                        onClick={duplicate}
                        className={styles["icon-button"]}
                        aria-label="Duplicate selection"
                      >
                        <Copy size={17} />
                      </button>
                    )}
                    {one?.type === "component" && one.data.kind !== "boundary" && (
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
                      className={styles["icon-button"]}
                      aria-label="Delete selection"
                    >
                      <Trash2 size={17} />
                    </button>
                    <button
                      onClick={() => {
                        setNodes((current) => current.map((n) => ({ ...n, selected: false })));
                        setEdges((current) => current.map((e) => ({ ...e, selected: false })));
                      }}
                      className={styles["icon-button"]}
                      aria-label="Clear selection"
                    >
                      <X size={16} />
                    </button>
                  </div>
                )}
              {nodes.length === 0 && (
                <div className={styles["empty"]}>
                  <Icon name="layout" size={34} />
                  <h2>Your canvas is ready</h2>
                  <p>Add a component from the library to get started.</p>
                </div>
              )}
              <div className={styles["status"]} role="status">
                {message}
              </div>
            </InkContext.Provider>
          </EditContext.Provider>
        </main>
      </div>
      {picking && (
        <Modal title="Add a component" onClose={() => setPicking(false)}>
          <div className={styles["component-picker"]}>{libraryContent}</div>
        </Modal>
      )}
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
            className={styles["connection-form"]}
            onSubmit={(event) => {
              event.preventDefault();
              if (locked) return;
              setEdges((current) =>
                current.map((edge) => (edge.id === edgeEditing.id ? edgeEditing : edge)),
              );
              touch();
              setEdgeEditing(null);
            }}
          >
            <label className={styles["form-field"]}>
              Label
              <input
                autoFocus
                maxLength={256}
                value={typeof edgeEditing.label === "string" ? edgeEditing.label : ""}
                onChange={(e) => setEdgeEditing({ ...edgeEditing, label: e.target.value })}
              />
            </label>
            <fieldset className={styles["fieldset"]}>
              <legend>Color</legend>
              <ColorPicker
                value={String(edgeEditing.style?.stroke || edgeOptions.style.stroke)}
                onChange={(stroke) =>
                  setEdgeEditing({
                    ...edgeEditing,
                    style: { ...edgeEditing.style, stroke },
                    markerEnd: { type: MarkerType.ArrowClosed, color: stroke },
                  })
                }
              />
            </fieldset>
            <footer className={styles["dialog-footer"]}>
              <button
                type="button"
                className={styles["secondary"]}
                onClick={() => setEdgeEditing(null)}
              >
                Cancel
              </button>
              <button className={styles["primary"]}>Save connection</button>
            </footer>
          </form>
        </Modal>
      )}
      {pendingImport && (
        <Modal
          title="Replace this drawing?"
          onClose={() => {
            if (!replacementInFlight.current) setPendingImport(null);
          }}
        >
          <div className={styles["reset-body"]}>
            <p>
              Import replaces the current drawing. A local recovery copy is saved first; download a
              backup for longer-term storage.
            </p>
            <footer className={styles["dialog-footer"]}>
              <button
                className={styles["secondary"]}
                disabled={replacementBusy}
                onClick={() => setPendingImport(null)}
              >
                Cancel
              </button>
              <button
                className={styles["primary"]}
                disabled={locked || replacementBusy}
                onClick={() => void replaceDrawing(pendingImport)}
              >
                Replace drawing
              </button>
            </footer>
          </div>
        </Modal>
      )}
      {resetting && (
        <Modal
          title="Clear the canvas?"
          onClose={() => {
            if (!replacementInFlight.current) setResetting(false);
          }}
        >
          <div className={styles["reset-body"]}>
            <p>
              This removes all live elements. A local recovery copy is saved first; download a
              backup for longer-term storage.
            </p>
            <footer className={styles["dialog-footer"]}>
              <button
                className={styles["secondary"]}
                disabled={replacementBusy}
                onClick={() => setResetting(false)}
              >
                Cancel
              </button>
              <button
                className={styles["primary"]}
                disabled={locked || replacementBusy}
                onClick={() =>
                  void replaceDrawing({
                    engine: "react-flow",
                    elements: [],
                    files: {},
                    background: base.current.background,
                  })
                }
              >
                Clear canvas
              </button>
            </footer>
          </div>
        </Modal>
      )}
    </div>
  );
}
export default function FlowBoardEditor(props: BoardEditorProps) {
  return (
    <ReactFlowProvider>
      <Playground {...props} />
    </ReactFlowProvider>
  );
}
