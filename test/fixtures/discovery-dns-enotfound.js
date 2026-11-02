import dns from "node:dns";
import dnsPromises from "node:dns/promises";
import { syncBuiltinESMExports } from "node:module";

// Explicit child-process preload, inherited by its detached test daemon. Never imported
// into the test runner: all other names and the user's resolver stay untouched.
const hostname = "lavish-unresolvable.invalid";
const lookup = dns.lookup;
const promiseLookup = dnsPromises.lookup;
const notFound = () =>
  Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), {
    code: "ENOTFOUND",
    syscall: "getaddrinfo",
    hostname,
  });

dns.lookup = /** @type {typeof dns.lookup} */ (
  function (...args) {
    if (args[0] !== hostname) return Reflect.apply(lookup, dns, args);
    const callback = args.at(-1);
    queueMicrotask(() => callback(notFound()));
  }
);
dnsPromises.lookup = async function (...args) {
  if (args[0] === hostname) throw notFound();
  return Reflect.apply(promiseLookup, dnsPromises, args);
};
syncBuiltinESMExports();
