import react from "@vitejs/plugin-react";
import { webcrypto } from "node:crypto";
import { defineConfig } from "vite";

import { handleApiRequest } from "../api/src/index";
import { MemoryDentLinkStore } from "../api/src/storage";

const devStore = new MemoryDentLinkStore();

export default defineConfig({
  plugins: [
    {
      name: "dentlink-dev-api",
      configureServer(server) {
        Object.defineProperty(globalThis, "crypto", {
          configurable: true,
          value: webcrypto
        });
        server.middlewares.use("/v1", async (request, response) => {
          const chunks: Buffer[] = [];
          for await (const chunk of request) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
          const headers = new Headers();
          for (const [name, value] of Object.entries(request.headers)) {
            if (Array.isArray(value)) {
              for (const item of value) headers.append(name, item);
            } else if (value !== undefined) {
              headers.set(name, value);
            }
          }
          const apiResponse = await handleApiRequest(
            new Request(`http://localhost/v1${request.url ?? ""}`, {
              method: request.method,
              headers,
              body
            }),
            { store: devStore }
          );
          response.statusCode = apiResponse.status;
          apiResponse.headers.forEach((value, name) => response.setHeader(name, value));
          response.end(Buffer.from(await apiResponse.arrayBuffer()));
        });
      }
    },
    react()
  ]
});
