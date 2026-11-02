// A TCP forwarder: node forward.mjs <listen-port> <target-host> <target-port>.
// Under the Docker driver it publishes a sandbox's port on this machine (bin/sbx-docker
// ports), and inside a sandbox it maps a stack's HOST:CONTAINER port the way Docker's own
// publishing did under sbx (bin/docker/stack.mjs).
import { createServer, connect } from 'node:net'

const [listen, host, port] = process.argv.slice(2)
createServer(c => {
  const up = connect(Number(port), host)
  c.pipe(up); up.pipe(c)
  up.on('error', () => c.destroy()); c.on('error', () => up.destroy())
}).listen(Number(listen), '0.0.0.0')
