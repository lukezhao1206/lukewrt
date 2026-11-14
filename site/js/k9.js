// LukeWrt 插件大库（高级功能）：kiddin9 第三方源，按设备架构列出官方没有的插件
window.lukewrtK9 = new Set();
const base = () => (window.config && config.asu_url ? config.asu_url : "");

function parsePackages(txt) {
  const out = [];
  for (const blk of txt.split(/\n\n+/)) {
    const m = {};
    let last = null;
    for (const line of blk.split("\n")) {
      if (/^\s/.test(line) && last) continue;
      const i = line.indexOf(":");
      if (i > 0) { last = line.slice(0, i); m[last] = line.slice(i + 1).trim(); }
    }
    if (m.Package) out.push(m);
  }
  return out;
}

const css = `
#lw-k9{margin:.6em 0 1em;padding:.6em .8em;border:1px solid #ccc;border-radius:6px;font-size:.92em}
#lw-k9 input[type=search]{width:16em}
#lw-k9 .list{max-height:22em;overflow:auto;margin-top:.4em}
#lw-k9 label{display:block;padding:.15em 0}
#lw-k9 small,#lw-k9 .hint{color:#888}
#lw-k9 .sel{margin:.3em 0;color:#2a7}
`;

let all = [], cur = { key: "" };

function render() {
  const list = document.querySelector("#lw-k9 .list");
  const q = document.getElementById("lw-k9-q").value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hit = all.filter((p) => q.every((w) => (p.Package + " " + (p.Description || "")).toLowerCase().includes(w)));
  list.innerHTML = "";
  hit.slice(0, 300).forEach((p) => {
    const l = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = window.lukewrtK9.has(p.Package);
    cb.onchange = () => { cb.checked ? window.lukewrtK9.add(p.Package) : window.lukewrtK9.delete(p.Package); sel(); };
    const t = document.createElement("span");
    t.innerHTML = " <b></b> <small></small>";
    t.querySelector("b").textContent = p.Package;
    t.querySelector("small").textContent = (p.Description || "").slice(0, 80);
    l.append(cb, t);
    list.appendChild(l);
  });
  if (hit.length > 300) list.insertAdjacentHTML("beforeend", `<p class="hint">还有 ${hit.length - 300} 个，请输入关键词缩小范围</p>`);
}

function sel() {
  const s = document.querySelector("#lw-k9 .sel");
  s.textContent = window.lukewrtK9.size ? `已选 ${window.lukewrtK9.size} 个：${[...window.lukewrtK9].join(" ")}（构建时需激活码）` : "";
}

async function load({ version, arch }) {
  const box = document.getElementById("lw-k9");
  const st = document.getElementById("lw-k9-st");
  window.lukewrtK9.clear(); sel();
  all = []; document.querySelector("#lw-k9 .list").innerHTML = "";
  const branch = (version || "").split(".").slice(0, 2).join(".");
  if (!arch || !/^\d+\.\d+\.\d+/.test(version || "")) { box.style.display = "none"; return; }
  box.style.display = "";
  if (+branch.split(".")[0] >= 25) { st.textContent = "插件大库目前只支持 24.10 版本，选 24.10.x 即可使用。"; document.getElementById("lw-k9-q").disabled = true; return; }
  document.getElementById("lw-k9-q").disabled = false;
  const key = branch + "/" + arch;
  cur.key = key;
  st.textContent = "正在加载插件列表…";
  try {
    const [k9, off] = await Promise.all([
      fetch(`${base()}/k9/packages-${branch}/${arch}/kiddin9/Packages`).then((r) => (r.ok ? r.text() : "")),
      fetch(`${base()}/dl/releases/${version}/packages/${arch}/luci/Packages`).then((r) => (r.ok ? r.text() : "")),
    ]);
    if (cur.key !== key) return;
    const official = new Set(parsePackages(off).map((p) => p.Package));
    all = parsePackages(k9).filter((p) => /^luci-(app|theme)-/.test(p.Package) && !official.has(p.Package))
      .sort((a, b) => a.Package.localeCompare(b.Package));
    st.textContent = all.length ? `共 ${all.length} 个官方源没有的插件（kiddin9 源，第三方编译，装前请自行判断）` : "这个架构暂时没有可用的插件大库。";
    render();
  } catch { st.textContent = "插件列表加载失败，稍后再试。"; }
}

export function initK9() {
  if (document.getElementById("lw-k9")) return;
  const anchor = document.getElementById("lw-preset") || document.getElementById("uci-defaults-label");
  if (!anchor) return;
  const s = document.createElement("style"); s.textContent = css; document.head.appendChild(s);
  const box = document.createElement("div");
  box.id = "lw-k9";
  box.style.display = "none";
  box.innerHTML = `<h4 style="margin:.2em 0">插件大库 <span class="hint">（高级功能，需激活码）</span></h4>
    <div id="lw-k9-st" class="hint"></div>
    <input type="search" id="lw-k9-q" placeholder="搜索插件，如 adguard、ddns、主题">
    <div class="sel"></div><div class="list"></div>`;
  anchor.parentNode.insertBefore(box, anchor);
  document.getElementById("lw-k9-q").addEventListener("input", render);
  window.addEventListener("lukewrt-device", (e) => load(e.detail));
}
