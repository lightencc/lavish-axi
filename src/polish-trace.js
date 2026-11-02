// Observers cannot change delivery semantics. Verification may deliberately terminate its own process.
export function safePolishTrace(observer) {
  return (stage, metadata) => {
    try {
      observer(stage, metadata);
    } catch {
      // A failed metrics sink is not a failed or uncertain agent delivery.
    }
  };
}
