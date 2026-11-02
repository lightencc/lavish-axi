// Test-process tripwire, not a network simulator. Any real listen attempt fails the run.
import net from 'node:net';
net.Server.prototype.listen = function () { throw new Error('M0_TEST_FORBIDS_ALL_LISTENERS'); };
