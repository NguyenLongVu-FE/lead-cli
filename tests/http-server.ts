import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

export interface LocalHttpServer {
  url: string;
  close(): Promise<void>;
}

export async function startHttpServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void
): Promise<LocalHttpServer> {
  const server = createServer(handler);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('local test server did not expose a TCP address');
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
}
