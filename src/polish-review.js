import { safePolishTrace } from "./polish-trace.js";

// A trusted, in-process host owns the binding. Browsers can submit words, never receipts.
export function createPolishReview({ store, events, host, log = (_message) => {}, trace = (_stage, _metadata) => {} }) {
  trace = safePolishTrace(trace);
  const pumps = new Map();
  const wakeups = new Set();
  let closed = false;
  async function snapshot(key) {
    const session = await store.findByKey(key);
    if (!session?.review_delivery) throw new Error("NOT_BOUND");
    return {
      ...session.review_delivery,
      artifact_revision: session.artifact_revision,
      artifact_load_token: session.review_delivery.artifact_load_token || "",
      artifact_digest: session.review_delivery.artifact_digest || "",
    };
  }
  async function publish(key) {
    const state = await snapshot(key);
    events.emit("polish-review", key, state);
    if (state.lifecycle === "ended") events.emit("ended", key, "user");
    return state;
  }
  function pump(key) {
    if (closed) return Promise.resolve();
    if (pumps.has(key)) {
      wakeups.add(key);
      return pumps.get(key);
    }
    const work = (async () => {
      // Network/model work never holds the SessionStore lock.
      while (!closed) {
        const state = await store.feedbackSnapshot(key);
        if (!state || state.mode !== "bridge" || state.lifecycle === "ended") return;
        const result = await store.takeFeedback(key, await store.feedbackLease(key, "bridge"));
        if (result.status !== "feedback") return;
        await store.reserveFeedbackHost(key, result.delivery);
        trace("dispatch_reserved", { ...result.delivery });
        await publish(key);
        const message = (await store.feedbackSnapshot(key)).messages.find((m) => m.id === result.delivery.id);
        try {
          const proof = await host.deliver(message, result.delivery);
          await store.recordFeedback(key, result.delivery, proof);
        } catch (error) {
          await store.markFeedbackUnknown(key, result.delivery);
          log(`Polish delivery requires verification: ${error.message}`);
        }
        await publish(key);
      }
    })()
      .catch((error) => log(`Polish delivery stopped: ${error.message}`))
      .finally(() => {
        pumps.delete(key);
        if (wakeups.delete(key)) return pump(key);
      });
    pumps.set(key, work);
    return work;
  }
  async function receive(key, proof) {
    if (closed) return;
    const wasEnded = (await snapshot(key)).lifecycle === "ended";
    const updated =
      proof.kind === "unknown"
        ? await store.markFeedbackUnknown(key, proof)
        : await store.reconcileFeedback(key, proof);
    if (proof.kind === "reply") {
      const identity = { ...proof };
      delete identity.text;
      trace("reply_persisted", identity);
    }
    if (wasEnded || updated.epoch !== proof.epoch) return;
    await publish(key);
    // Do not await the delivery loop from a receipt callback inside host.deliver.
    setImmediate(() => void pump(key));
  }
  const onFeedback = (key) => {
    if (closed) return;
    void store
      .feedbackSnapshot(key)
      .then(async (state) => {
        if (state) {
          await publish(key);
          await pump(key);
        }
      })
      .catch((error) => log(error.message));
  };
  events.on("feedback", onFeedback);
  host.setReceiver(receive);
  return {
    snapshot,
    publish,
    pump,
    receive,
    binding(file) {
      return {
        artifact: file,
        instance: host.instance,
        session: host.session,
        ...(host.inputEvidence ? { inputEvidence: host.inputEvidence } : {}),
      };
    },
    async open(session, reopen = false) {
      const binding = this.binding(session.file);
      if (session.review_delivery?.lifecycle === "ended" && reopen) await store.reopenFeedback(session.key, binding);
      else await store.bindFeedback(session.key, binding);
      return snapshot(session.key);
    },
    async recover() {
      for (const session of await store.listSessions()) {
        const d = session.review_delivery;
        if (!d || d.binding.session !== host.session || d.binding.instance !== host.instance) continue;
        await store.recoverFeedback(session.key);
        for (const message of d.messages.filter((m) => m.claim && !m.reply)) {
          try {
            const proof = await host.query(message);
            if (proof) await store.reconcileFeedback(session.key, proof);
          } catch (error) {
            // An unavailable witness is not a rejection or permission to resend.
            log(`Polish recovery requires verification: ${error.message}`);
          }
        }
        await publish(session.key);
        void pump(session.key);
      }
    },
    async complete(key, request) {
      await store.completeFeedback(key, request);
      return publish(key);
    },
    async end(key, request) {
      const sealed = await store.beginFeedbackEnd(key, request);
      trace("end_sealed", { ...sealed.binding, epoch: sealed.epoch, id: sealed.end.id, ids: [...sealed.end.ids] });
      const state = await publish(key);
      if (sealed.mode === "poll") events.emit("feedback", key);
      void pump(key);
      return state;
    },
    close() {
      closed = true;
      events.off("feedback", onFeedback);
    },
  };
}
