// LukeWrt 付费：激活码 + 支付宝当面付扫码
const KEY = "lukewrt_code";
export const getCode = () => (localStorage.getItem(KEY) || "").trim().toUpperCase();
const api = (p, o) => fetch((window.config && config.asu_url ? config.asu_url : "") + p, o).then((r) => r.json());

const css = `
#lw-pay{margin:.6em 0;padding:.6em .8em;border:1px solid #ccc;border-radius:6px;font-size:.92em}
#lw-pay input{width:13em;font-family:monospace}
#lw-pay button,#lw-modal button{margin:.2em .3em;padding:.3em .8em;cursor:pointer}
#lw-modal{position:fixed;inset:0;background:rgba(0,0,0,.55);display:none;align-items:center;justify-content:center;z-index:9999}
#lw-modal .box{background:#fff;color:#222;padding:1.2em 1.5em;border-radius:8px;max-width:22em;text-align:center}
#lw-modal img{width:200px;height:200px;image-rendering:pixelated}
#lw-modal .code{font:bold 1.2em monospace;user-select:all;margin:.5em 0}
`;

function el(html) { const d = document.createElement("div"); d.innerHTML = html.trim(); return d.firstChild; }

let poll;
function modal(html) {
  let m = document.getElementById("lw-modal");
  if (!m) {
    m = el('<div id="lw-modal"><div class="box"></div></div>');
    m.addEventListener("click", (e) => { if (e.target === m) close(); });
    document.body.appendChild(m);
  }
  m.querySelector(".box").innerHTML = html;
  m.style.display = "flex";
  return m;
}
function close() { clearInterval(poll); const m = document.getElementById("lw-modal"); if (m) m.style.display = "none"; }

function qrImg(text) {
  const q = window.qrcode(0, "M"); q.addData(text); q.make();
  return q.createDataURL(6, 2);
}

async function buy(plan) {
  modal("<p>正在生成订单…</p>");
  let r;
  try { r = await api("/api/pay/create", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ plan }) }); }
  catch { r = { error: "网络错误" }; }
  if (r.error || r.detail) { modal(`<p>下单失败：${r.error || r.detail}</p><button id="lw-x">关闭</button>`); document.getElementById("lw-x").onclick = close; return; }
  const name = plan === "forever" ? "永久版" : "单次";
  const mobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
  modal(`<h3>支付宝扫码支付 ¥${r.amount}（${name}）</h3>
    <img src="${qrImg(r.qr)}" alt="支付宝付款码">
    ${mobile ? `<p><a href="${r.qr}">手机上点这里直接打开支付宝</a></p>` : ""}
    <p id="lw-st">等待付款…（15 分钟内有效）</p><button id="lw-x">取消</button>`);
  document.getElementById("lw-x").onclick = close;
  const t0 = Date.now();
  poll = setInterval(async () => {
    if (Date.now() - t0 > 16 * 60e3) { clearInterval(poll); document.getElementById("lw-st").textContent = "订单已超时，请重新下单"; return; }
    try {
      const s = await api(`/api/pay/status/${r.order}`);
      if (s.code) {
        clearInterval(poll);
        localStorage.setItem(KEY, s.code);
        modal(`<h3>付款成功</h3><p>你的激活码（已自动保存在本浏览器，换设备时输入）：</p>
          <div class="code">${s.code}</div><p>请截图或抄下来保存。</p><button id="lw-x">好的</button>`);
        document.getElementById("lw-x").onclick = close;
        refresh();
      }
    } catch {}
  }, 3000);
}

async function refresh() {
  const box = document.getElementById("lw-pay-state");
  if (!box) return;
  const c = getCode();
  if (!c) { box.textContent = "免费：官方插件和科学上网插件随便选，不限次数。预置设置、插件大库、优先排队为高级功能。"; return; }
  try {
    const s = await api(`/api/pay/code/${encodeURIComponent(c)}`);
    box.textContent = !s.ok ? `激活码 ${c} 无效或次数已用完。` : s.left === -1 ? `永久版已激活（${c}），不限次数。` : `已激活（${c}），剩余付费次数 ${s.left}。`;
  } catch { box.textContent = ""; }
}

export function openPay(why) {
  modal(`<h3>LukeWrt 高级功能</h3><p>${why === "priority" ? "付款后再点一次【优先排队】即可插到前面。" : ""}预置设置（管理 IP、PPPoE、WiFi、旁路由）、首次启动脚本、插件大库、优先排队</p>
    <button id="lw-b1">单次 ¥3</button><button id="lw-b2">永久 ¥88</button>
    <p style="font-size:.85em">单次：编一次高级固件（或优先排队一次）。永久：不限次数、自动优先，以后上线的配置存档一键升级、N1 等特殊机型、固件保存 30 天都包含。</p>
    <button id="lw-x">关闭</button>`);
  document.getElementById("lw-b1").onclick = () => buy("single");
  document.getElementById("lw-b2").onclick = () => buy("forever");
  document.getElementById("lw-x").onclick = close;
}

export function initPay() {
  if (document.getElementById("lw-pay")) return;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
  const anchor = document.getElementById("asu-request-build");
  if (!anchor) return;
  const box = el(`<div id="lw-pay"><span id="lw-pay-state"></span>
    <div>激活码：<input id="lw-code" placeholder="LW-XXXX-XXXX-XXXX"><button id="lw-save">使用</button><button id="lw-buy">购买</button></div></div>`);
  anchor.parentNode.insertBefore(box, anchor);
  document.getElementById("lw-code").value = getCode();
  document.getElementById("lw-save").onclick = (e) => { e.preventDefault(); localStorage.setItem(KEY, document.getElementById("lw-code").value.trim().toUpperCase()); refresh(); };
  document.getElementById("lw-buy").onclick = (e) => { e.preventDefault(); openPay(); };
  refresh();
}
