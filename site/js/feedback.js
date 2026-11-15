// LukeWrt 意见反馈：提交到站长后台（/api/feedback），不再跳转官方论坛
(function () {
  const base = (window.config && config.asu_url) || "";
  const css = `#lw-fb{position:fixed;inset:0;background:rgba(0,0,0,.55);display:none;align-items:center;justify-content:center;z-index:9999}
#lw-fb .box{background:#fff;color:#222;padding:1.2em 1.5em;border-radius:8px;width:min(26em,92vw);text-align:left}
#lw-fb h3{margin:0 0 .6em}#lw-fb label{display:block;font-size:.9em;margin:.5em 0 .2em}
#lw-fb input,#lw-fb textarea{width:100%;box-sizing:border-box;padding:.4em;font:inherit;border:1px solid #bbb;border-radius:4px}
#lw-fb textarea{height:8em;resize:vertical}#lw-fb .row{text-align:right;margin-top:.8em}
#lw-fb button{margin-left:.5em;padding:.35em 1em;cursor:pointer}#lw-fb .msg{font-size:.9em;color:#a33;min-height:1.2em}`;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
  function model() {
    const i = document.getElementById("models");
    const v = document.getElementById("versions");
    return [i && i.value, v && v.value].filter(Boolean).join(" / ");
  }
  function open(e) {
    if (e) e.preventDefault();
    let m = document.getElementById("lw-fb");
    if (!m) {
      m = document.createElement("div"); m.id = "lw-fb";
      m.innerHTML = `<div class="box"><h3>意见反馈</h3>
        <label>遇到的问题或建议（必填）</label><textarea id="lw-fb-t" maxlength="2000" placeholder="比如：选了哪个机型、哪个版本，页面提示了什么"></textarea>
        <label>机型 / 版本</label><input id="lw-fb-m" maxlength="120">
        <label>联系方式（QQ、微信、邮箱，选填，方便回复你）</label><input id="lw-fb-c" maxlength="120">
        <div class="msg" id="lw-fb-s"></div>
        <div class="row"><button id="lw-fb-x">取消</button><button id="lw-fb-ok">提交</button></div></div>`;
      document.body.appendChild(m);
      m.addEventListener("click", (ev) => { if (ev.target === m) m.style.display = "none"; });
      m.querySelector("#lw-fb-x").onclick = () => (m.style.display = "none");
      m.querySelector("#lw-fb-ok").onclick = send;
    }
    m.querySelector("#lw-fb-m").value = model();
    m.querySelector("#lw-fb-s").textContent = "";
    m.style.display = "flex";
  }
  async function send() {
    const t = document.getElementById("lw-fb-t").value.trim();
    const s = document.getElementById("lw-fb-s");
    if (t.length < 2) { s.textContent = "请先写下问题或建议"; return; }
    const btn = document.getElementById("lw-fb-ok"); btn.disabled = true; s.textContent = "提交中…";
    try {
      const r = await fetch(base + "/api/feedback", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: t, model: document.getElementById("lw-fb-m").value, contact: document.getElementById("lw-fb-c").value, page: location.href }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || "提交失败");
      document.querySelector("#lw-fb .box").innerHTML = "<h3>谢谢！</h3><p>反馈已送到站长，留了联系方式的会尽快回复你。</p><div class='row'><button onclick=\"document.getElementById('lw-fb').remove()\">关闭</button></div>";
    } catch (e) { s.textContent = e.message || "提交失败，请稍后再试"; btn.disabled = false; }
  }
  function hook() { const a = document.getElementById("lw-fb-link"); if (a) a.addEventListener("click", open); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", hook); else hook();
})();
