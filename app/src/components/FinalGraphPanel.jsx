import { useMemo, useRef } from "react";
import { ReactFlow, Background } from "@xyflow/react";
import { Button } from "@carbon/react";
/** Показывает экземпляры после раскрытия и позволяет перейти к их исходным нодам, не изменяя граф карты. */
export function FinalGraphPanel({ applied, onClose, onSelect }) {
  const graph = applied.finalGraph;
  const flow = useRef();
  const nodes = useMemo(
    () =>
      (graph?.nodes ?? []).map((n, i) => ({
        id: n.id,
        position: { x: (i % 3) * 230, y: Math.floor(i / 3) * 120 },
        data: {
          label: (
            <div>
              <strong>{n.name}</strong>
              <p>{n.id}</p>
            </div>
          ),
        },
        style: {
          width: 210,
          minHeight: 70,
          padding: 12,
          fontSize: 14,
          background: "var(--cds-layer-02)",
          color: "var(--cds-text-primary)",
          border: "1px solid var(--cds-border-strong-01)",
        },
      })),
    [graph],
  );
  const edges = useMemo(
    () =>
      (graph?.links ?? []).map((l, i) => ({
        id: String(i),
        source: l.from,
        target: l.to,
        type: "default",
      })),
    [graph],
  );
  return (
    <section className="final-graph-panel" aria-label="Конечный граф">
      <div className="graph-heading">
        <h2>Конечный граф</h2>
        <Button kind="ghost" size="sm" onClick={onClose}>
          Закрыть
        </Button>
      </div>
      <p className="helper-text">
        Seed {applied.parameters.seed}, {nodes.length} элементов, {edges.length}{" "}
        связей. Каждый вызов фрагмента создаёт отдельные экземпляры.
      </p>
      <div className="final-graph-canvas">
        <ReactFlow
          key={applied.parameters.seed + ":" + nodes.map((n) => n.id).join(",")}
          onInit={(instance) => {
            flow.current = instance;
          }}
          nodes={nodes}
          edges={edges}
          nodesDraggable={false}
          nodesConnectable={false}
          deleteKeyCode={null}
          fitView
          minZoom={0.05}
          onNodeClick={(_, n) =>
            onSelect(graph.nodes.find((item) => item.id === n.id).sourceId)
          }
          colorMode="dark"
        >
          <Background />
        </ReactFlow>
      </div>
      <div className="button-row graph-navigation">
        <Button kind="ghost" size="sm" onClick={() => flow.current?.zoomOut()}>
          Уменьшить
        </Button>
        <Button kind="ghost" size="sm" onClick={() => flow.current?.zoomIn()}>
          Увеличить
        </Button>
        <Button
          kind="ghost"
          size="sm"
          onClick={() => flow.current?.fitView({ padding: 0.15 })}
        >
          Вписать
        </Button>
      </div>
      <details>
        <summary>Раскрытие: {graph?.trace.length ?? 0} переходов</summary>
        <div className="expansion-trace">
          {graph?.trace.map((t, i) => (
            <p key={i}>
              {t.call
                ? `${t.call}: фрагмент №${t.fragment}, вложение ${t.depth}`
                : `${t.choice}: выбран ${t.to}, повтор ${t.visit}`}
            </p>
          ))}
        </div>
      </details>
      {!graph && (
        <p className="helper-text">
          Конечный граф доступен для композиции версии 4.
        </p>
      )}
    </section>
  );
}
