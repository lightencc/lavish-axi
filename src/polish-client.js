/* global window, document */
/** @type {any} */ (window).mountPolishReview = function mountPolishReview({ key, frame, post, reload, currentLoad }) {
  const $ = (id) => document.getElementById(id);
  const bar = document.querySelector(".bar");
  const controls = document.createElement("div");
  controls.className = "polish-controls";
  controls.innerHTML =
    '<span id="polish-status" role="status">连接当前会话…</span><button id="polish-overall">整体意见</button><button id="polish-refresh">刷新查看</button><button id="polish-finish">确认并结束</button>';
  bar.insertBefore(controls, $("moreWrap"));
  const dialog = document.createElement("section");
  dialog.id = "polish-dialog";
  dialog.hidden = true;
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-label", "Polish 评论");
  dialog.innerHTML =
    '<div class="polish-head"><strong id="polish-title">整体意见</strong><label><input id="polish-complete" type="checkbox">完成</label><button id="polish-close" aria-label="收起">×</button></div><select id="polish-threads" aria-label="已有讨论"></select><blockquote id="polish-quote" hidden></blockquote><div id="polish-history"></div><p id="polish-message-status" role="status"></p><textarea id="polish-input" aria-label="意见" placeholder="对整页有什么意见？" maxlength="8000"></textarea><div class="polish-foot"><span>⌘ / Ctrl + Enter 发送</span><button id="polish-send">发送 ↑</button></div><p id="polish-error" role="alert" hidden></p>';
  document.body.appendChild(dialog);
  const endChoices = document.createElement("div");
  endChoices.hidden = true;
  endChoices.innerHTML =
    '<p>结束后停止此页通信。未发送内容保留在此浏览器。</p><button id="polish-end-send">发送当前意见并结束</button><button id="polish-end-keep">保留未发送内容并结束</button><button id="polish-end-cancel">取消</button>';
  dialog.appendChild(endChoices);
  const input = /** @type {HTMLTextAreaElement} */ ($("polish-input"));
  const complete = /** @type {HTMLInputElement} */ ($("polish-complete"));
  const labels = {
    accepted: "已保存 · 等待 agent 接收",
    dispatching: "正在投递",
    host_queued: "agent 正忙，已排队",
    unknown: "正在核实接收结果，请勿重复发送",
    delivered: "agent 已收到 · 正在处理",
    replied: "已回复 · 待你确认",
    failed: "处理失败",
  };
  const pendingLabel = "发送结果待核实 · 请勿重复发送";
  const interruptedLabel = "处理已中断，结果待核实，请勿重复发送";
  let state,
    viewed,
    active,
    busy = false,
    loading = false,
    closeWhenEnded = false,
    notice = "";
  let drafts = {},
    missingAnchors = new Set(),
    loadedReplies = new Map(),
    pending = null,
    pendingEnd = null,
    selecting = false,
    point = { x: 0, y: 0 };
  const historyNodes = new Map();
  let threadOptions = "";
  const storageKey = () => `polish:drafts:${key}:${state?.epoch || 1}`;
  const latest = (id) => state?.messages.findLast((m) => (m.prompt.comment_id || m.id) === id);
  const persist = () => localStorage.setItem(storageKey(), JSON.stringify({ drafts, pending, pendingEnd }));
  const messageText = (m) =>
    m?.resolved
      ? "已完成"
      : m?.execution_error
        ? `处理失败：${m.execution_error}`
        : m?.executionUnknown
          ? interruptedLabel
          : labels[m?.state] || "草稿 · 尚未发送";
  function error(text = "") {
    notice = text;
    $("polish-error").textContent = text;
    $("polish-error").hidden = !text;
    if (text) $("polish-status").textContent = text;
  }
  async function request(route, body) {
    const response = await fetch(
      `/api/${key}/${route}`,
      body === undefined
        ? undefined
        : {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          },
    );
    const result = await response.json();
    if (!response.ok)
      throw Object.assign(new Error(result.error || `请求失败 (${response.status})`), { status: response.status });
    return result;
  }
  function saveDraft() {
    if (active && !busy) {
      drafts[active.comment_id] = { ...active, draft: input.value };
      persist();
    }
  }
  function close(clearAnchor = true) {
    saveDraft();
    dialog.hidden = true;
    active = null;
    endChoices.hidden = true;
    if (clearAnchor) post({ type: "polish:close" });
  }
  function position() {
    if (dialog.hidden) return;
    const rect = dialog.getBoundingClientRect(),
      width = window.innerWidth,
      height = window.innerHeight;
    dialog.style.left = `${Math.max(12, Math.min(point.x + 12, width - rect.width - 12))}px`;
    dialog.style.top = `${Math.max(64, Math.min(point.y + 12, height - rect.height - 12))}px`;
  }
  function pins() {
    if (!state) return;
    const items = state.messages.filter(
      (m) => m.prompt.scope === "anchored" && !m.resolved && latest(m.prompt.comment_id) === m,
    );
    post({
      type: "polish:state",
      items: items.map((m) => ({
        id: m.prompt.comment_id,
        prompt: m.prompt,
        state: m.executionUnknown ? "unknown" : m.state,
        label: messageText(m),
        replied: m.state === "replied",
      })),
    });
  }
  function render() {
    if (!state) return;
    const processing = state.messages.some((m) => m.state === "delivered" && !m.executionUnknown);
    const interrupted = state.messages.some((m) => m.executionUnknown);
    const newReply = state.messages.some((m) => m.reply && !m.resolved);
    const waiting = state.messages.find(
      (m) => !m.consumed && ["accepted", "dispatching", "host_queued", "unknown"].includes(m.state),
    );
    const failed = state.messages.some((m) => m.state === "failed" && latest(m.prompt.comment_id || m.id) === m);
    $("polish-status").textContent =
      state.lifecycle === "ended"
        ? "通信已结束 · 可以关闭此页"
        : state.lifecycle === "ending"
          ? "等待 agent 接收最后反馈…"
          : pending
            ? busy
              ? "正在发送…"
              : pendingLabel
            : notice
              ? notice
              : processing
                ? "agent 正在处理"
                : waiting
                  ? labels[waiting.state]
                  : newReply
                    ? "回复已更新 · 打开讨论查看"
                    : interrupted
                      ? interruptedLabel
                      : failed
                        ? "有反馈处理失败 · 打开整体意见查看"
                        : notice || "当前会话";
    $("polish-status").classList.toggle("processing", processing);
    for (const id of ["polish-overall", "polish-finish"])
      /** @type {HTMLButtonElement} */ ($(id)).disabled = state.lifecycle !== "open";
    /** @type {HTMLButtonElement} */ ($("polish-send")).disabled =
      busy || !!pending || !!pendingEnd || state.lifecycle !== "open" || !input.value.trim();
    input.disabled = busy || !!pendingEnd || state.lifecycle !== "open";
    pins();
    if (!active || dialog.hidden) return;
    const m = latest(active.comment_id),
      entries = state.messages.filter((m) => (m.prompt.comment_id || m.id) === active.comment_id);
    $("polish-title").textContent = active.scope === "session" ? "整体意见" : "就地评论";
    $("polish-quote").hidden = active.scope === "session";
    $("polish-quote").textContent = active.scope === "session" ? "" : active.text;
    $("polish-message-status").textContent =
      (missingAnchors.has(active.comment_id) ? "原内容位置已变化 · " : "") +
      (pending?.prompt.comment_id === active.comment_id ? (busy ? "正在发送…" : pendingLabel) : messageText(m));
    complete.checked = !!m?.resolved;
    complete.disabled =
      busy ||
      !m?.reply ||
      !loadedReplies.has(m.id) ||
      !!input.value.trim() ||
      state.lifecycle !== "open" ||
      !viewed ||
      viewed.artifact_load_token !== currentLoad().token;
    // Reconcile by message identity. Rebuilding the history on every snapshot (or
    // keystroke) destroys text selection and scroll anchoring while the user reads.
    const history = $("polish-history"),
      scrollTop = history.scrollTop,
      dialogScrollTop = dialog.scrollTop,
      rows = [];
    for (const entry of entries) {
      rows.push({ id: `${entry.id}:user`, className: "polish-user", text: `你\n${entry.prompt.prompt}` });
      const reply = loadedReplies.get(entry.id);
      if (reply) rows.push({ id: `${entry.id}:agent`, className: "polish-agent", text: `agent\n${reply.text}` });
    }
    const desired = new Set(rows.map((row) => row.id));
    for (const [id, node] of historyNodes) {
      if (!desired.has(id)) {
        history.removeChild(node);
        historyNodes.delete(id);
      }
    }
    rows.forEach((row, index) => {
      let node = historyNodes.get(row.id);
      if (!node) {
        node = document.createElement("p");
        node.className = row.className;
        historyNodes.set(row.id, node);
      }
      if (node.textContent !== row.text) node.textContent = row.text;
      if (history.children[index] !== node) history.insertBefore(node, history.children[index] || null);
    });
    history.scrollTop = scrollTop;
    dialog.scrollTop = dialogScrollTop;
    const select = /** @type {HTMLSelectElement} */ ($("polish-threads"));
    const optionsKey = JSON.stringify(
      state.messages.map((item) => [
        item.id,
        item.kind,
        item.prompt,
        messageText(item),
        missingAnchors.has(item.prompt.comment_id || item.id),
      ]),
    );
    if (threadOptions !== optionsKey) {
      threadOptions = optionsKey;
      select.replaceChildren();
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "新建整体意见 / 查看已有讨论";
      select.appendChild(option);
      const seen = new Set();
      for (const item of [...state.messages].reverse()) {
        const id = item.prompt.comment_id || item.id;
        if (seen.has(id) || item.kind === "end") continue;
        seen.add(id);
        const option = document.createElement("option");
        option.value = id;
        option.textContent = `${item.prompt.scope === "anchored" ? (missingAnchors.has(id) ? "原内容位置已变化" : "定位评论") : "整体意见"} · ${messageText(item)} · ${item.prompt.prompt.slice(0, 35)}`;
        select.appendChild(option);
      }
    }
    select.value = m ? active.comment_id : "";
  }
  function open(context, location = { x: window.innerWidth - 480, y: 72 }, preserveAnchor = false) {
    if (busy) return;
    close(!preserveAnchor);
    point = location;
    const saved = Object.values(drafts).findLast(
      (d) =>
        d.draft &&
        d.scope === context.scope &&
        (context.scope === "session" || (d.selector === context.selector && d.text === context.text)),
    );
    active = { ...context, comment_id: context.comment_id || saved?.comment_id || crypto.randomUUID() };
    input.value = drafts[active.comment_id]?.draft || "";
    input.placeholder = active.scope === "session" ? "对整页有什么意见？" : "你希望如何修改这里？";
    dialog.hidden = false;
    error();
    render();
    position();
    input.focus({ preventScroll: true });
  }
  function sync(next) {
    if (state && next.version < state.version) return;
    if (!state || next.epoch !== state.epoch) {
      try {
        const saved = JSON.parse(localStorage.getItem(`polish:drafts:${key}:${next.epoch}`) || "{}");
        drafts = saved.drafts || {};
        if (!Object.keys(drafts).length && next.epoch > 1) {
          const previous = JSON.parse(localStorage.getItem(`polish:drafts:${key}:${next.epoch - 1}`) || "{}");
          drafts = Object.fromEntries(
            Object.entries(previous.drafts || {}).filter(
              ([id, d]) => /** @type {any} */ (d).draft && id !== previous.pending?.prompt?.comment_id,
            ),
          );
        }
        pending = saved.pending || null;
        pendingEnd = saved.pendingEnd || null;
        closeWhenEnded = pendingEnd?.mode === "confirm";
      } catch {
        drafts = {};
        pending = null;
        pendingEnd = null;
      }
      loadedReplies = new Map();
      missingAnchors = new Set();
      viewed = null;
    }
    state = next;
    // Versioned review snapshots already carry replies. Display them immediately;
    // only an actual iframe load may establish a new artifact-view proof.
    loadedReplies = new Map(next.messages.filter((m) => m.reply).map((m) => [m.id, m.reply]));
    if (
      viewed &&
      viewed.epoch === next.epoch &&
      viewed.artifact_load_token === currentLoad().token &&
      viewed.artifact_load_token === next.artifact_load_token &&
      viewed.artifact_digest === next.artifact_digest &&
      viewed.artifact_revision === next.artifact_revision
    ) {
      viewed = { ...viewed, state_version: next.version };
    }
    if (pendingEnd && state.end?.id === pendingEnd.body.id) {
      error();
      if (pendingEnd.draftId) {
        delete drafts[pendingEnd.draftId];
        if (active?.comment_id === pendingEnd.draftId) input.value = "";
        persist();
      }
      if (state.lifecycle === "ended") {
        pendingEnd = null;
        persist();
      }
    }
    if (pending && state.messages.some((m) => m.id === pending.prompt.prompt_id)) {
      error();
      const id = pending.prompt.comment_id;
      delete drafts[id];
      pending = null;
      persist();
      if (active?.comment_id === id) {
        input.value = "";
        close();
      }
    }
    render();
    if (state.lifecycle === "ended" && closeWhenEnded) {
      closeWhenEnded = false;
      window.close();
      $("polish-status").textContent = "通信已结束 · 可以关闭此页";
    }
  }
  async function captureView() {
    const next = await request("review");
    sync(next);
    if (next.artifact_load_token !== currentLoad().token || !next.artifact_digest) return;
    viewed = {
      epoch: next.epoch,
      artifact_revision: next.artifact_revision,
      artifact_load_token: next.artifact_load_token,
      artifact_digest: next.artifact_digest,
      state_version: next.version,
    };
    loadedReplies = new Map(next.messages.filter((m) => m.reply).map((m) => [m.id, m.reply]));
    error();
    render();
  }
  async function send() {
    if (!active || busy || pending || pendingEnd || !input.value.trim() || state?.lifecycle !== "open") return;
    saveDraft();
    const id = crypto.randomUUID(),
      text = input.value.trim();
    const prompt = {
      prompt_id: id,
      round_id: crypto.randomUUID(),
      comment_id: active.comment_id,
      scope: active.scope,
      prompt: text,
      ...(active.scope === "anchored"
        ? { selector: active.selector, text: active.text, tag: active.tag, target: active.target }
        : {}),
    };
    pending = { epoch: state.epoch, prompt };
    persist();
    busy = true;
    error();
    render();
    try {
      await request("prompts", { review_epoch: state.epoch, prompts: [prompt] });
      sync(await request("review"));
    } catch (err) {
      if (err.status >= 400 && err.status < 500 && err.status !== 408) {
        pending = null;
        persist();
      }
      error(`${err.message}。输入已保留，刷新核实接收结果后再操作。`);
      // A failed transport is uncertain; never invent a new message ID and resend it.
      try {
        sync(await request("review"));
        if (state.messages.some((m) => m.id === id)) error();
      } catch {
        /* keep original pending identity */
      }
    } finally {
      busy = false;
      render();
    }
  }
  async function end(mode = "manual") {
    if (!state || busy || state.lifecycle !== "open") return;
    saveDraft();
    const finalText =
      mode === "confirm"
        ? "我已确认当前 HTML 的整体修订，结束本轮评审通信。"
        : mode === "send"
          ? input.value.trim()
          : "";
    const requestBody = pendingEnd?.body || {
      id: crypto.randomUUID(),
      epoch: state.epoch,
      final: finalText ? { id: crypto.randomUUID(), epoch: state.epoch, text: finalText } : null,
      ...(mode === "confirm" ? { ...viewed, confirm: true } : {}),
    };
    if (!pendingEnd && mode === "confirm" && !viewed) {
      error("请先刷新查看当前修订");
      return;
    }
    pendingEnd ||= { body: requestBody, mode, draftId: mode === "send" ? active?.comment_id : null };
    closeWhenEnded = pendingEnd.mode === "confirm";
    persist();
    busy = true;
    render();
    try {
      sync(await request("review/end", requestBody));
    } catch (err) {
      if (err.status >= 400 && err.status < 500 && err.status !== 408) {
        pendingEnd = null;
        closeWhenEnded = false;
        persist();
      }
      error(err.message);
    } finally {
      busy = false;
      render();
    }
  }
  function requestEnd(mode = "manual") {
    if (!state || state.lifecycle !== "open" || busy) return;
    saveDraft();
    const draft = Object.values(drafts).find((d) => d.draft?.trim());
    if (!draft || pendingEnd) return end(mode);
    if (!active) open(draft);
    endChoices.hidden = false;
    $("polish-end-keep").onclick = () => end(mode);
    $("polish-end-send").onclick = () => end("send");
    $("polish-end-cancel").onclick = () => {
      endChoices.hidden = true;
    };
    /** @type {HTMLButtonElement} */ ($("polish-end-send")).disabled = !input.value.trim();
  }
  $("polish-overall").onclick = () => open({ scope: "session" });
  $("polish-close").onclick = () => close();
  $("polish-send").onclick = send;
  input.oninput = () => {
    saveDraft();
    render();
  };
  $("polish-threads").onchange = (event) => {
    const m = latest(/** @type {HTMLSelectElement} */ (event.target).value);
    open(m ? { ...m.prompt, comment_id: m.prompt.comment_id || m.id } : { scope: "session" }, point);
  };
  complete.onchange = async () => {
    const m = latest(active?.comment_id);
    if (!m || !complete.checked || !viewed) return;
    try {
      sync(
        await request("review/complete", {
          ...viewed,
          comment_id: m.prompt.comment_id,
          message_id: m.id,
          round_id: m.prompt.round_id,
          reply_version: loadedReplies.get(m.id)?.version,
        }),
      );
      close();
    } catch (err) {
      error(`${err.message}：请刷新后确认`);
      complete.checked = false;
    }
  };
  $("polish-refresh").onclick = async () => {
    if (loading) return;
    loading = true;
    saveDraft();
    try {
      await reload();
    } catch (err) {
      error(err.message);
    } finally {
      loading = false;
    }
  };
  $("polish-finish").onclick = () => void requestEnd("confirm");
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      void send();
    }
  });
  document.addEventListener("pointerdown", (event) => {
    const target = /** @type {Node} */ (event.target);
    if (!dialog.hidden && !dialog.contains(target) && !controls.contains(target)) close();
  });
  document.addEventListener(
    "pointerup",
    (event) => {
      if (!selecting) return;
      selecting = false;
      const rect = frame.getBoundingClientRect();
      post({ type: "polish:selectionEnd", x: event.clientX - rect.left, y: event.clientY - rect.top });
    },
    true,
  );
  document.addEventListener(
    "keydown",
    (event) => {
      if ((event.metaKey || event.ctrlKey) && event.altKey && event.key.toLowerCase() === "m" && !event.isComposing) {
        event.preventDefault();
        open({ scope: "session" });
      }
    },
    true,
  );
  window.addEventListener("resize", position);
  window.addEventListener("beforeunload", saveDraft);
  void request("review")
    .then(sync)
    .catch((err) => error(err.message));
  return {
    sync,
    end,
    requestEnd,
    disconnected() {
      $("polish-status").textContent = "连接中断 · 正在重新同步";
    },
    changed() {
      $("polish-status").textContent = "HTML 已更新 · 请刷新查看";
    },
    handleFrame(msg) {
      if (msg.type === "polish:selectionStart") selecting = true;
      if (msg.type === "polish:selectionDone") selecting = false;
      if (msg.type === "polish:overall") open({ scope: "session" });
      if (msg.type === "polish:anchors" && Array.isArray(msg.missing)) {
        const next = new Set(msg.missing.filter((id) => latest(id)?.prompt.scope === "anchored"));
        if (next.size !== missingAnchors.size || [...next].some((id) => !missingAnchors.has(id))) {
          missingAnchors = next;
          render();
        }
      }
      if (msg.type === "polish:ready") {
        void captureView().catch((err) => error(err.message));
        pins();
      }
      if (msg.type === "polish:open") {
        const c = msg.context;
        if (
          !c ||
          typeof c.selector !== "string" ||
          c.selector.length > 2000 ||
          typeof c.text !== "string" ||
          c.text.length > 12000
        )
          return;
        const rect = frame.getBoundingClientRect();
        const existing = state?.messages.findLast(
          (m) =>
            m.prompt.scope === "anchored" &&
            m.prompt.selector === c.selector &&
            m.prompt.text === c.text &&
            !m.resolved,
        );
        open(
          { ...c, scope: "anchored", comment_id: existing?.prompt.comment_id },
          { x: rect.left + (Number(msg.x) || 0), y: rect.top + (Number(msg.y) || 0) },
          true,
        );
      }
      if (msg.type === "polish:openThread") {
        const m = latest(String(msg.id));
        if (m) {
          const r = frame.getBoundingClientRect();
          open(m.prompt, { x: r.left + msg.x, y: r.top + msg.y });
        }
      }
    },
  };
};
