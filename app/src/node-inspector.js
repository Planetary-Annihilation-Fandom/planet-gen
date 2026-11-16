import { NODE_TYPES, getField } from "./node-types.js";

export function createNodeInspector(host, actions) {
  let current = null, signature = "", timer;
  const error = document.getElementById("nodeError");
  function show(node, instances = []) {
    current = node;
    if (!host.contains(document.activeElement)) error.textContent = "";
    document.getElementById("nodeTitle").textContent = node ? `${NODE_TYPES[node.kind].title}: ${node.name}` : "Выберите ноду для настройки";
    for (const id of ["deleteNode", "duplicateNode"]) document.getElementById(id).disabled = !node;
    document.getElementById("nodeDetails").textContent = node ? JSON.stringify({ id: node.id, instances: instances.map((z) => ({ id: z.id, owner: z.owner, inputs: z.inputs })) }, null, 2) : "";
    const fields = node ? NODE_TYPES[node.kind].fields.filter((f) => !f.when || f.when(node)) : [];
    const nextSignature = node ? node.id+":"+fields.map((f) => f.path).join(",") : "";
    if (nextSignature !== signature) {
      clearTimeout(timer); host.replaceChildren(); signature = nextSignature; error.textContent = "";
      for (const field of fields) {
        const label = document.createElement("label"); label.className = "field"; label.append(field.label);
        const input = document.createElement(field.type === "select" ? "select" : "input");
        input.dataset.field = field.path;
        if (field.type === "select") for (const [value, title] of field.options) input.add(new Option(title, value));
        else {
          input.type = field.type;
          if (field.type === "number") { input.min = field.min; input.max = field.max; input.step = field.step; }
          if (field.maxLength) input.maxLength = field.maxLength;
        }
        const commit = () => {
          clearTimeout(timer);
          if (!current) return;
          const value = field.type === "number" ? input.value === "" ? NaN : Number(input.value)/(field.scale ?? 1) : input.value;
          try { actions.change(current.id, field.path, value); error.textContent = ""; }
          catch (err) { error.textContent = err.message; }
        };
        input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(commit, 240); });
        input.addEventListener("change", commit);
        label.append(input); host.append(label);
      }
    }
    for (const field of fields) {
      const el = host.querySelector(`[data-field="${field.path}"]`);
      if (el === document.activeElement) continue;
      const value = getField(node, field.path);
      el.value = field.type === "number" ? Math.round(value*(field.scale ?? 1)*1000)/1000 : value;
    }
  }
  document.getElementById("deleteNode").onclick = () => { if (current) actions.remove(current.id); };
  document.getElementById("duplicateNode").onclick = () => { if (current) actions.duplicate(current.id); };
  return { show };
}
