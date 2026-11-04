import { defineConfig, type Plugin } from "vite";

function stripViemBytecodes(): Plugin {
  return {
    name: "strip-viem-bytecodes",
    transform(code, id) {
      if (id.includes("constants/contracts") || id.includes("constants\\contracts")) {
        return {
          code: code.replace(/export const \w+Byte[cC]ode\s*=\s*['"]0x[0-9a-fA-F]+['"]/g, (match) => {
            const varName = match.split("=")[0].trim();
            return `${varName} = "0x"`;
          }),
          map: null,
        };
      }
    },
  };
}

export default defineConfig({
  base: "/",
  plugins: [stripViemBytecodes()],
  build: {
    target: "es2022",
    sourcemap: false,
  },
});
