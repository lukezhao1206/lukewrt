import { $$, split } from "./utils.js";

// LukeWrt: Chinese brand aliases and loose matching.
const ALIASES = [
  ["红米", "REDMI"], ["小米", "XIAOMI"], ["华硕", "ASUS"], ["网件", "NETGEAR"],
  ["普联", "TP-LINK"], ["友讯", "D-LINK"], ["领势", "LINKSYS"], ["优倍快", "UBIQUITI"],
  ["合勤", "ZYXEL"], ["斐讯", "PHICOMM"], ["极路由", "HIWIFI"], ["新路由", "NEWIFI"],
  ["中兴", "ZTE"], ["华为", "HUAWEI"], ["荣耀", "HONOR"], ["腾达", "TENDA"],
  ["水星", "MERCUSYS"], ["磊科", "NETCORE"], ["京东云", "JDCLOUD"], ["树莓派", "RASPBERRY"],
  ["香橙派", "ORANGE PI"], ["友善", "FRIENDLYARM"], ["网心云", "ONETHING"], ["锐捷", "RUIJIE"],
  ["华三", "H3C"], ["中国移动", "CMCC"], ["移动", "CMCC"], ["网易", "NETEASE"],
  ["千兆", "GIGABIT"], ["百兆", "100M"], ["香蕉派", "BANANAPI"], ["瑞莎", "RADXA"],
  ["软路由", ""], ["无线路由器", ""], ["路由器", ""], ["路由", ""], ["版", ""],
];

export function normalizePattern(pattern) {
  let p = String(pattern || "");
  for (const [zh, en] of ALIASES) p = p.split(zh).join(" " + en + " ");
  // split CJK from latin/digits so "小米4a" works
  p = p.replace(/([\u4e00-\u9fff])([A-Za-z0-9])/g, "$1 $2")
       .replace(/([A-Za-z0-9])([\u4e00-\u9fff])/g, "$1 $2");
  return split(p.toUpperCase());
}

const compact = (s) => s.toUpperCase().replace(/[^A-Z0-9\u4e00-\u9fff]/g, "");

export function match(value, patterns) {
  const item = value.toUpperCase();
  const flat = compact(value);
  const flat2 = compact(value.replace(/\b(router|edition|wireless|wifi|mesh)\b/gi, ""));
  const matches = [];
  for (const p of patterns) {
    const i = item.indexOf(p);
    if (i !== -1) {
      matches.push({ begin: i, length: p.length });
      continue;
    }
    // loose: ignore spaces, dashes, dots ("mi4a", "tplink", "ax3000t")
    const cp = compact(p);
    if (cp && (flat.includes(cp) || flat2.includes(cp))) continue;
    return [];
  }
  if (matches.length === 0) return [{ begin: 0, length: 0 }];

  matches.sort((a, b) => a.begin - b.begin);

  let prev = null;
  const ranges = [];
  for (const m of matches) {
    if (prev && m.begin <= prev.begin + prev.length) {
      prev.length = Math.max(prev.length, m.begin + m.length - prev.begin);
    } else {
      ranges.push(m);
      prev = m;
    }
  }
  return ranges;
}

export function setupAutocompleteList(input, items, onbegin, onend) {
  let currentFocus = -1;
  const collator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: "base",
  });

  items.sort(collator.compare);

  input.oninput = function () {
    onbegin();

    const pattern = this.value;
    closeAllLists();

    if (pattern.length === 0) {
      return false;
    }

    if (items.includes(pattern)) {
      closeAllLists();
      onend(input);
      return false;
    }

    const list = document.createElement("DIV");
    list.setAttribute("id", this.id + "-autocomplete-list");
    list.setAttribute("class", "autocomplete-items");
    this.parentNode.appendChild(list);

    const patterns = normalizePattern(pattern);
    if (patterns.length === 0) return false;
    let count = 0;
    for (const item of items) {
      const matches = match(item, patterns);
      if (matches.length === 0) {
        continue;
      }

      count += 1;
      if (count >= 30) {
        const div = document.createElement("DIV");
        div.innerText = "...";
        list.appendChild(div);
        break;
      }

      const div = document.createElement("DIV");
      let prev = 0;
      for (const m of matches) {
        if (m.begin > prev) {
          div.appendChild(
            document.createTextNode(item.substr(prev, m.begin - prev))
          );
        }
        const strong = document.createElement("strong");
        strong.textContent = item.substr(m.begin, m.length);
        div.appendChild(strong);
        prev = m.begin + m.length;
      }
      if (prev < item.length) {
        div.appendChild(document.createTextNode(item.substr(prev)));
      }
      const hiddenInput = document.createElement("input");
      hiddenInput.type = "hidden";
      hiddenInput.value = item;
      div.appendChild(hiddenInput);

      div.addEventListener("click", function () {
        input.value = this.getElementsByTagName("input")[0].value;
        closeAllLists();
        onend(input);
      });

      list.appendChild(div);
    }
  };

  input.onkeydown = function (e) {
    let x = document.getElementById(this.id + "-autocomplete-list");
    if (x) x = x.getElementsByTagName("div");
    if (e.key === "ArrowDown" || e.keyCode === 40) {
      currentFocus += 1;
      setActive(x);
    } else if (e.key === "ArrowUp" || e.keyCode === 38) {
      currentFocus -= 1;
      setActive(x);
    } else if (e.key === "Enter" || e.keyCode === 13) {
      e.preventDefault();
      if (currentFocus > -1) {
        if (x) x[currentFocus].click();
      }
    }
  };

  input.onkeyup = function (e) {
    if (e && (e.key === "Enter" || e.keyCode === 13)) {
      onend(input);
    }
  };

  function setActive(xs) {
    if (!xs) return false;
    for (const x of xs) {
      x.classList.remove("autocomplete-active");
    }
    if (currentFocus >= xs.length) currentFocus = 0;
    if (currentFocus < 0) currentFocus = xs.length - 1;
    xs[currentFocus].classList.add("autocomplete-active");
    xs[currentFocus].setAttribute("tabindex", "0");
    xs[currentFocus].scrollIntoView({ block: "nearest" });
    return true;
  }

  input.setAttribute("tabindex", "0");

  function closeAllLists(elmnt) {
    for (const x of $$(".autocomplete-items")) {
      if (elmnt !== x && elmnt !== input) {
        x.parentNode.removeChild(x);
      }
    }
  }

  document.addEventListener("click", (e) => {
    closeAllLists(e.target);
  });
}
