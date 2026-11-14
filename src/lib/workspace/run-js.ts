// Runs user/AI-written JavaScript in a Worker that lives inside a sandboxed iframe
// (opaque origin: no cookies, no access to the app's API or storage). Output is relayed back.

const FRAME_HTML = `<script>
addEventListener("message", function (e) {
  if (!e.data || e.data.t !== "run") return;
  var pre = 'var __s=function(k,a){postMessage({k:k,a:a.map(function(x){try{return typeof x==="string"?x:(JSON.stringify(x,null,2)===undefined?String(x):JSON.stringify(x,null,2))}catch(_){return String(x)}})})};' +
    'console.log=function(){__s("out",[].slice.call(arguments))};console.info=console.log;console.debug=console.log;' +
    'console.warn=function(){__s("err",[].slice.call(arguments))};console.error=console.warn;' +
    'addEventListener("unhandledrejection",function(ev){__s("err",[String(ev.reason)])});' +
    '(async function(){try{\\n' + e.data.code + '\\n}catch(err){__s("err",[String(err&&err.stack||err)])}__s("done",[])})();';
  try {
    var w = new Worker(URL.createObjectURL(new Blob([pre], { type: "text/javascript" })));
    w.onmessage = function (m) { parent.postMessage({ t: "msg", k: m.data.k, a: m.data.a }, "*"); };
    w.onerror = function (m) { parent.postMessage({ t: "msg", k: "err", a: [String(m.message || "Script error")] }, "*"); parent.postMessage({ t: "msg", k: "done", a: [] }, "*"); };
  } catch (err) {
    parent.postMessage({ t: "msg", k: "err", a: ["Sandbox could not start a worker: " + err] }, "*");
    parent.postMessage({ t: "msg", k: "done", a: [] }, "*");
  }
});
parent.postMessage({ t: "ready" }, "*");
<\/script>`;

export type RunHandle = { stop: () => void; done: Promise<void> };

export function runJs(code: string, onOutput: (text: string, kind: "out" | "err") => void, timeoutMs = 8000): RunHandle {
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts");
  frame.style.display = "none";
  let finish!: () => void;
  const done = new Promise<void>((r) => (finish = r));
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    clearTimeout(timer);
    window.removeEventListener("message", onMsg);
    frame.remove();
    finish();
  };
  const timer = setTimeout(() => {
    onOutput(`Stopped: script ran longer than ${timeoutMs / 1000}s`, "err");
    end();
  }, timeoutMs);
  function onMsg(ev: MessageEvent) {
    if (ev.source !== frame.contentWindow) return;
    const d = ev.data as { t?: string; k?: string; a?: string[] };
    if (d?.t === "ready") frame.contentWindow?.postMessage({ t: "run", code }, "*");
    else if (d?.t === "msg") {
      if (d.k === "done") end();
      else onOutput((d.a ?? []).join(" "), d.k === "err" ? "err" : "out");
    }
  }
  window.addEventListener("message", onMsg);
  frame.srcdoc = FRAME_HTML;
  document.body.appendChild(frame);
  return { stop: () => { onOutput("Stopped", "err"); end(); }, done };
}
